import { supabase } from '../lib/supabase'
import { formatStaffNames, parseStaffNames } from '../lib/staffNames'
import { getBusinessDayRange, getDayRange } from '../lib/dateRange'
import { uploadPaymentProofPhoto, uploadPromoProofPhoto, PROMO_PROOF_TYPE } from './photos'
import { PRICE_MODES } from '../lib/servicePrice'

// Payment verification: a ticket can only be closed once its payment is
// verified. Cash is verified the moment it's recorded — the money is in hand.
// QRIS and transfer also need a camera photo of the confirmation screen
// (payments.proof_url), since "the customer said they paid" isn't proof.
export const PROOF_REQUIRED_METHODS = ['qris', 'transfer']

export function paymentNeedsProof(method) {
  return PROOF_REQUIRED_METHODS.includes(method)
}

export function isPaymentVerified(payment) {
  if (!payment) return false
  return !paymentNeedsProof(payment.payment_method) || Boolean(payment.proof_url)
}

// Promo verification: a ticket with a service sold below its list price
// (unit_price < normal_unit_price, migration 020) needs a photo proving the
// customer qualified for the promo before it can close — see migration 024,
// which enforces the same rule. Lines from before 020 (normal_unit_price
// null) never count, and neither do tickets created before 024
// (treatments.requires_promo_proof = false).
export function isPromoLine(item) {
  return (
    item.shelf_item_id == null &&
    item.normal_unit_price != null &&
    Number(item.unit_price) < Number(item.normal_unit_price)
  )
}

export function needsPromoProof(treatment, items) {
  return Boolean(treatment?.requires_promo_proof) && (items ?? []).some(isPromoLine)
}

async function logAction(treatmentId, action) {
  const { error } = await supabase.from('treatment_logs').insert({ treatment_id: treatmentId, action })
  if (error) throw error
}

async function logStatusChange(treatmentId, status) {
  await logAction(treatmentId, `status changed to ${status}`)
}

// Payment is optional at creation time — a job can be queued and worked on
// before anyone pays. Pass paymentMethod only when the customer is paying
// up front; omit it to leave the treatment at status 'created' with no
// payment row, to be settled later via recordPayment().
//
// The whole ticket is written by the create_treatment() RPC (migration 018)
// in one transaction: it looks prices up from services/shelf_items itself,
// so only ids, quantities and the price mode are sent — never amounts. PIC
// is the signed-in user. If stock runs out mid-submit, nothing is saved.
export async function createTreatment({
  customerName,
  customerPhone,
  plateNumber,
  treatmentType,
  notes,
  items,
  priceMode = PRICE_MODES.PROMO,
  discount = 0,
  paymentMethod,
  washStaffNames,
  qcStaff,
}) {
  const { data, error } = await supabase.rpc('create_treatment', {
    p_customer_name: customerName,
    p_customer_phone: customerPhone,
    p_items: items.map((item) =>
      item.shelfItemId != null
        ? { shelf_item_id: item.shelfItemId, quantity: item.quantity }
        : { service_id: item.serviceId, quantity: item.quantity }
    ),
    // Null for services with no vehicle involved (e.g. Cuci Helm); the RPC
    // uppercases and trims it.
    p_plate_number: plateNumber || null,
    p_treatment_type: treatmentType || null,
    p_notes: notes || null,
    p_price_mode: priceMode,
    p_discount: discount,
    // Crew can be assigned up front from Transaksi Baru, or left empty and
    // picked later (Mulai Proses / Detail Transaksi).
    p_wash_staff: formatStaffNames(washStaffNames),
    p_qc_staff: qcStaff?.trim() || null,
    p_payment_method: paymentMethod || null,
  })
  if (error) {
    if (error.message?.includes('Stok tidak mencukupi')) {
      throw new Error('Stok barang tidak mencukupi — muat ulang halaman')
    }
    throw error
  }
  return data
}

// Creates a ticket and, when it was sold at promo price, attaches the promo
// eligibility photo. The ticket has to exist first since the photo is filed
// under its id. If the upload fails the ticket is still saved — the error
// carries treatmentId so the caller can send staff to retry it from Detail
// Transaksi (closing stays blocked until then).
export async function createTreatmentWithPromoProof(fields, promoProofFile) {
  const treatment = await createTreatment(fields)
  if (promoProofFile) {
    try {
      await uploadPromoProofPhoto(treatment.id, promoProofFile)
    } catch {
      const error = new Error('Transaksi tersimpan, tapi foto bukti promo gagal diunggah — ulangi dari sini')
      error.treatmentId = treatment.id
      throw error
    }
  }
  return treatment
}

// Over-the-counter sale: a ticket with only shelf items has no work to queue,
// so it's paid and closed in one go at checkout. Order matters — payment row
// first (createTreatment sets 'paid'), then the QRIS/transfer proof photo onto
// it, then close (the verified-payment trigger checks that proof). If the
// photo upload fails, the ticket is left 'paid' in the queue, where "Foto
// Bukti Bayar" retries it like any other unverified payment.
export async function checkoutTreatment(fields, { paymentMethod, proofFile }) {
  if (paymentNeedsProof(paymentMethod) && !proofFile) {
    throw new Error('Foto bukti pembayaran wajib untuk QRIS/transfer')
  }
  const treatment = await createTreatment({ ...fields, paymentMethod })
  if (proofFile) {
    try {
      await uploadPaymentProofPhoto(treatment.id, proofFile)
    } catch {
      const error = new Error('Pembayaran tercatat, tapi foto bukti gagal diunggah — ulangi dari antrian')
      error.treatmentId = treatment.id
      throw error
    }
  }
  try {
    await closeTreatment(treatment.id)
  } catch {
    const error = new Error('Pembayaran tercatat, tapi transaksi gagal ditutup — tutup dari antrian')
    error.treatmentId = treatment.id
    throw error
  }
  return treatment
}

// Settle payment on a treatment that was queued without paying up front.
// Done by the record_payment() RPC (migration 019): the amount is always the
// ticket's stored total, never sent from here, and a ticket takes one
// payment. If work hasn't started yet (still 'created'), it also advances
// status to 'paid'; further along, status is left alone and a log entry
// records that payment came in.
export async function recordPayment(treatmentId, { paymentMethod }) {
  const { error } = await supabase.rpc('record_payment', {
    p_treatment_id: treatmentId,
    p_payment_method: paymentMethod,
  })
  if (error) throw error
}

// Records the payment and, for QRIS/transfer, attaches the proof photo in one
// go. The payment row goes in first because the proof is written onto it. If
// the photo upload fails after that, the payment stays recorded but
// unverified — the screens then offer "Foto Bukti Bayar" to retry, and the
// ticket can't close in the meantime.
export async function recordVerifiedPayment(treatmentId, { paymentMethod, proofFile }) {
  if (paymentNeedsProof(paymentMethod) && !proofFile) {
    throw new Error('Foto bukti pembayaran wajib untuk QRIS/transfer')
  }
  await recordPayment(treatmentId, { paymentMethod })
  if (proofFile) await uploadPaymentProofPhoto(treatmentId, proofFile)
}

// Work pipeline: created/paid -> diproses -> selesai -> closed.
// There used to be a separate 'qc' stage between diproses and selesai; it was
// dropped as a required step — but a QC person still has to be named on the
// ticket before it can finish. A few old rows may still sit in 'qc' — they finish with
// markSelesai like a 'diproses' ticket does.
// Any staff can move a treatment through these stages; the wash-proof photo
// is required to finish (enforced by the caller before invoking markSelesai),
// and so are at least one wash worker and a QC worker — markSelesai checks
// that itself.
//
// washStaffNames is optional: when given, the wash crew is saved in the same
// update that starts the job, so a ticket can't end up 'diproses' with the
// crew write lost halfway. Omit it to leave whatever is assigned untouched.
export async function startProcessing(id, washStaffNames) {
  const update = { status: 'diproses', updated_at: new Date().toISOString() }
  const washStaff = washStaffNames === undefined ? undefined : formatStaffNames(washStaffNames)
  if (washStaff !== undefined) update.wash_staff = washStaff

  const { error } = await supabase.from('treatments').update(update).eq('id', id)
  if (error) throw error
  if (washStaff) await logAction(id, `wash staff assigned: ${washStaff}`)
  await logStatusChange(id, 'diproses')
}

export async function markSelesai(id) {
  // Re-read rather than trust the caller's copy: someone may have cleared the
  // assignment on another device since the screen loaded. The UI gates the
  // button too, this is the guard for anything that reaches here anyway.
  const { data: current, error: readError } = await supabase
    .from('treatments')
    .select('wash_staff, qc_staff')
    .eq('id', id)
    .single()
  if (readError) throw readError
  if (!hasRequiredStaff(current)) {
    throw new Error('Petugas cuci dan petugas QC wajib diisi sebelum transaksi diselesaikan')
  }

  const { error } = await supabase
    .from('treatments')
    .update({ status: 'selesai', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
  await logStatusChange(id, 'selesai')
}

// A finished job has to say who did it: at least one wash worker and a QC
// worker. Shared by markSelesai and the screens that gate its button.
export function hasRequiredStaff(treatment) {
  return parseStaffNames(treatment?.wash_staff).length > 0 && Boolean(treatment?.qc_staff?.trim())
}

// Worker assignment — who's actually washing/QC'ing the vehicle, separate
// from status. Names are plain-text snapshots (same convention as
// treatments.pic), not live FKs.
//
// Wash takes a list: a car is often washed by two or three people. They're
// stored comma-separated in the one wash_staff column — see lib/staffNames.
// Pass an empty array to clear the assignment.
export async function assignWashStaff(id, staffNames) {
  const value = formatStaffNames(staffNames)
  const { error } = await supabase
    .from('treatments')
    .update({ wash_staff: value, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
  await logAction(id, value ? `wash staff assigned: ${value}` : 'wash staff unassigned')
}

export async function assignQcStaff(id, staffName) {
  const { error } = await supabase
    .from('treatments')
    .update({ qc_staff: staffName, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
  await logAction(id, staffName ? `qc staff assigned: ${staffName}` : 'qc staff unassigned')
}

export async function closeTreatment(id) {
  // Same pattern as markSelesai: the screens gate the button, this re-reads
  // the payment so nothing closes on a stale copy.
  const [treatmentResult, paymentsResult, itemsResult, promoPhotoResult] = await Promise.all([
    supabase.from('treatments').select('requires_promo_proof').eq('id', id).single(),
    supabase
      .from('payments')
      .select('payment_method, proof_url')
      .eq('treatment_id', id)
      .order('paid_at', { ascending: false })
      .limit(1),
    supabase.from('treatment_items').select('shelf_item_id, unit_price, normal_unit_price').eq('treatment_id', id),
    supabase.from('photos').select('id').eq('treatment_id', id).eq('photo_type', PROMO_PROOF_TYPE).limit(1),
  ])
  if (treatmentResult.error) throw treatmentResult.error
  if (paymentsResult.error) throw paymentsResult.error
  if (itemsResult.error) throw itemsResult.error
  if (promoPhotoResult.error) throw promoPhotoResult.error
  const payments = paymentsResult.data
  if (!isPaymentVerified(payments?.[0])) {
    throw new Error(
      payments?.[0]
        ? 'Bukti pembayaran belum diunggah — transaksi belum bisa ditutup'
        : 'Pembayaran belum dicatat — transaksi belum bisa ditutup'
    )
  }
  if (needsPromoProof(treatmentResult.data, itemsResult.data) && !promoPhotoResult.data?.length) {
    throw new Error('Bukti promo belum diunggah — transaksi belum bisa ditutup')
  }

  const { error } = await supabase
    .from('treatments')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
  await logStatusChange(id, 'closed')
}

// A ticket that has any payment recorded can't be cancelled — the money is
// already in, so it has to go through to close. The screens disable the
// button; this re-reads so a stale screen can't void a ticket paid elsewhere.
export async function voidTreatment(id) {
  const { data: payments, error: readError } = await supabase
    .from('payments')
    .select('id')
    .eq('treatment_id', id)
    .limit(1)
  if (readError) throw readError
  if (payments?.length) {
    throw new Error('Transaksi yang sudah dibayar tidak bisa dibatalkan')
  }

  const { error } = await supabase
    .from('treatments')
    .update({ status: 'voided', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
  await logStatusChange(id, 'voided')
}

// The list views (queue, history) all need the same shape: paid-or-not plus a
// readable summary of what was ordered, so they share one select and one
// mapper.
const LIST_SELECT =
  '*, payments(payment_method, proof_url, paid_at), treatment_items(service_name, shelf_item_id, unit_price, normal_unit_price), photos(photo_type)'

function mapTreatmentRow(t) {
  const payment =
    [...(t.payments ?? [])].sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)))[0] ?? null
  return {
    ...t,
    payment,
    isPaid: Boolean(payment),
    isPaymentVerified: isPaymentVerified(payment),
    needsPromoProof: needsPromoProof(t, t.treatment_items),
    hasPromoProof: (t.photos ?? []).some((photo) => photo.photo_type === PROMO_PROOF_TYPE),
    serviceSummary: (t.treatment_items ?? []).map((item) => item.service_name).join(', '),
  }
}

export async function getTodayTreatments() {
  const { start, end } = getBusinessDayRange()

  const { data, error } = await supabase
    .from('treatments')
    .select(LIST_SELECT)
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString())
    .order('created_at', { ascending: false })
  if (error) throw error
  return data.map(mapTreatmentRow)
}

// end is exclusive — pass the start of the day/period after the one you want.
export async function getTreatmentsInRange(start, end) {
  const { data, error } = await supabase
    .from('treatments')
    .select(LIST_SELECT)
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString())
    .order('created_at', { ascending: false })
  if (error) throw error
  return data.map(mapTreatmentRow)
}

// The queue is everything not yet closed: new tickets, jobs in progress, and
// finished ('selesai') jobs still waiting on payment verification and close —
// the worker settles payment and closes from the queue card, so a 'selesai'
// ticket has to stay here until then. 'closed' and 'voided' drop off and live
// on in Riwayat/Laporan.
//
// Deliberately NOT limited to today: a car left overnight, or a ticket nobody
// closed before going home, is still outstanding work and has to stay visible
// the next morning. What removes a treatment from the queue is its status, not
// the calendar. Riwayat and Laporan remain the date-scoped views.
const QUEUE_STATUSES = ['created', 'paid', 'diproses', 'qc', 'selesai']

export async function getActiveQueue() {
  const { data, error } = await supabase
    .from('treatments')
    .select(LIST_SELECT)
    .in('status', QUEUE_STATUSES)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data.map(mapTreatmentRow)
}

// Live queue: calls onChange whenever a row the queue is built from changes
// (tickets, payments, wash/payment proof photos), from any signed-in user.
// These tables are in the supabase_realtime publication (migration 014), and
// Realtime applies each table's SELECT RLS. The payload isn't passed on —
// callers refetch, since one action can touch several tables and a status
// change can move a ticket out of the queue. Returns an unsubscribe function.
export function subscribeToQueueChanges(onChange) {
  const channel = supabase.channel(`queue-${Math.random().toString(36).slice(2)}`)
  for (const table of ['treatments', 'payments', 'photos']) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => onChange())
  }
  channel.subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}

// Revenue is money actually collected, so this reads from payments
// (by paid_at) rather than treatment totals — a queued-but-unpaid treatment
// shouldn't show up as revenue.
// Days here are business days (04:00–04:00, see src/lib/dateRange.js): the
// current shift plus the six before it.
//
// `dateStr` ("YYYY-MM-DD", see getDayRange) names the last of the seven days;
// omitted, that is the current business day.
export async function getLast7DaysRevenue(dateStr) {
  const { start: lastDayStart, end } = dateStr ? getDayRange(dateStr) : getBusinessDayRange()
  const start = new Date(lastDayStart)
  start.setDate(start.getDate() - 6)

  const { data, error } = await supabase
    .from('payments')
    .select('paid_at, amount')
    .gte('paid_at', start.toISOString())
    .lt('paid_at', end.toISOString())
  if (error) throw error
  return data
}

// Payments collected during one business day (shift 07:00–04:00, plus the
// closed hours before it): the current one, or the "YYYY-MM-DD" day given.
export async function getTodayPaymentBreakdown(dateStr) {
  const { start, end } = dateStr ? getDayRange(dateStr) : getBusinessDayRange()

  const { data, error } = await supabase
    .from('payments')
    .select('payment_method, amount, paid_at')
    .gte('paid_at', start.toISOString())
    .lt('paid_at', end.toISOString())
  if (error) throw error
  return data
}

// Columns the Riwayat search box matches against: plate, treatment code,
// vehicle brand (treatment_type), customer name, and the staff names.
const SEARCH_COLUMNS = ['plate_number', 'treatment_code', 'treatment_type', 'customer_name', 'pic', 'wash_staff', 'qc_staff']

// Prefixes the search box understands, e.g. "staff:budi merek:cbr". Each maps
// to the columns it narrows to; several names per key are just aliases.
const SEARCH_PREFIXES = {
  staff: ['pic', 'wash_staff', 'qc_staff'],
  pic: ['pic'],
  cuci: ['wash_staff'],
  qc: ['qc_staff'],
  merek: ['treatment_type'],
  plat: ['plate_number'],
  kode: ['treatment_code'],
  nama: ['customer_name'],
  pelanggan: ['customer_name'],
}

// Strip characters that are syntax in a PostgREST or() filter (commas,
// parens) or wildcards in ilike, so typed text can't break the filter.
function sanitizeSearchTerm(text) {
  return text.replace(/[,()%*\\"]/g, ' ').replace(/\s+/g, ' ').trim()
}

// Splits "staff:budi merek:cbr vario" into prefixed filters plus leftover
// free text. A value with spaces can be quoted: nama:"budi santoso". An
// unknown prefix (e.g. "jam:10") stays in the free text, matched literally.
export function parseSearchQuery(query) {
  const filters = []
  const free = query.replace(/(\w+):(?:"([^"]*)"|(\S+))/g, (match, key, quoted, bare) => {
    const columns = SEARCH_PREFIXES[key.toLowerCase()]
    const value = sanitizeSearchTerm(quoted ?? bare)
    if (!columns || !value) return match
    filters.push({ columns, value })
    return ' '
  })
  return { filters, text: sanitizeSearchTerm(free) }
}

function ilikeAny(columns, value) {
  return columns.map((col) => `${col}.ilike.%${value}%`).join(',')
}

// todayOnly restricts results to today's rows — staff can only search within
// today's queue, while admins can search the full transaction history.
// Free text matches any SEARCH_COLUMNS; each prefixed filter must also match
// (filters are ANDed together, so "staff:budi merek:cbr" needs both).
export async function searchTreatments(query, { todayOnly = false } = {}) {
  const { filters, text } = parseSearchQuery(query)
  if (!text && filters.length === 0) return []

  let request = supabase
    .from('treatments')
    .select(LIST_SELECT)
    .order('created_at', { ascending: false })

  if (text) request = request.or(ilikeAny(SEARCH_COLUMNS, text))
  for (const { columns, value } of filters) {
    request = request.or(ilikeAny(columns, value))
  }

  if (todayOnly) {
    // Today = the current business day (shift), not the calendar day.
    const { start, end } = getBusinessDayRange()
    request = request.gte('created_at', start.toISOString()).lt('created_at', end.toISOString())
  }

  const { data, error } = await request
  if (error) throw error
  return data.map(mapTreatmentRow)
}

// Ranks field workers by orders handled in a period, split into wash vs QC
// duty. Computed from treatments.wash_staff/qc_staff rather than a stored
// counter — those columns are already the source of truth (see schema
// notes on the treatments table), so a separate tally would just be a copy
// that can drift out of sync. Voided treatments don't count as handled work.
export async function getWorkerOrderCounts(start, end) {
  const { data, error } = await supabase
    .from('treatments')
    .select('wash_staff, qc_staff, status')
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString())
    .neq('status', 'voided')
  if (error) throw error

  const counts = new Map()
  // A wash shared by several workers credits each of them one order — the
  // column holds every assigned name, so parse before tallying.
  function bump(value, field) {
    for (const name of parseStaffNames(value)) {
      if (!counts.has(name)) counts.set(name, { name, washCount: 0, qcCount: 0 })
      counts.get(name)[field] += 1
    }
  }
  for (const t of data) {
    bump(t.wash_staff, 'washCount')
    bump(t.qc_staff, 'qcCount')
  }

  return Array.from(counts.values())
    .map((w) => ({ ...w, total: w.washCount + w.qcCount }))
    .sort((a, b) => b.total - a.total)
}

// Service lines sold in [start, end), tallied by name and ranked by quantity.
// Shelf items are excluded — this is about which service people pick, not
// what goes off the shelf. Grouped by the snapshot name, so each size
// ("Motor Basic Wash - S" vs "- M") ranks separately.
export async function getPopularServices(start, end) {
  const { data, error } = await supabase
    .from('treatment_items')
    .select('service_name, quantity, subtotal, treatments!inner(created_at, status)')
    .is('shelf_item_id', null)
    .gte('treatments.created_at', start.toISOString())
    .lt('treatments.created_at', end.toISOString())
    .neq('treatments.status', 'voided')
  if (error) throw error

  const tally = new Map()
  for (const item of data) {
    const name = item.service_name
    if (!tally.has(name)) tally.set(name, { name, quantity: 0, revenue: 0 })
    const entry = tally.get(name)
    entry.quantity += Number(item.quantity || 0)
    entry.revenue += Number(item.subtotal || 0)
  }

  return Array.from(tally.values()).sort(
    (a, b) => b.quantity - a.quantity || b.revenue - a.revenue,
  )
}

export async function getTreatmentDetail(id) {
  const [treatmentResult, itemsResult, paymentsResult] = await Promise.all([
    supabase.from('treatments').select('*').eq('id', id).single(),
    supabase.from('treatment_items').select('*').eq('treatment_id', id).order('id'),
    supabase.from('payments').select('*').eq('treatment_id', id).order('paid_at', { ascending: false }),
  ])

  if (treatmentResult.error) throw treatmentResult.error
  if (itemsResult.error) throw itemsResult.error
  if (paymentsResult.error) throw paymentsResult.error

  return {
    ...treatmentResult.data,
    items: itemsResult.data ?? [],
    payment: paymentsResult.data?.[0] ?? null,
  }
}
