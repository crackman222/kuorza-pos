import { formatDateTime } from './format'

const STATUS_LABELS = {
  created: 'Dibuat',
  paid: 'Dibayar',
  diproses: 'Diproses',
  qc: 'QC',
  selesai: 'Selesai',
  closed: 'Ditutup',
  voided: 'Dibatalkan',
}

const PAYMENT_LABELS = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer' }

const HEADER = [
  'Bulan',
  'Tanggal',
  'Jam',
  'Kode',
  'Plat',
  'Kendaraan',
  'Pelanggan',
  'Layanan',
  'Status',
  'Pembayaran',
  'Metode',
  'Subtotal',
  'Diskon',
  'Total',
]

// Local-time keys, not toISOString — that's UTC and would file a ticket made
// just after midnight in Indonesia under the previous day.
function pad(n) {
  return String(n).padStart(2, '0')
}

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function monthKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

function monthLabel(d) {
  return d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
}

function escapeCell(value) {
  const str = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

// Revenue counts the same thing the PDF does: paid, non-voided tickets.
function revenueOf(treatments) {
  return treatments
    .filter((t) => t.status !== 'voided' && t.isPaid)
    .reduce((sum, t) => sum + Number(t.total || 0), 0)
}

function summaryRow(label, treatments) {
  const row = new Array(HEADER.length).fill('')
  row[1] = label
  row[3] = `${treatments.length} transaksi`
  row[HEADER.length - 1] = revenueOf(treatments)
  return row
}

// Rows run oldest-first, grouped by month and then by day, with a subtotal
// row after each day and a total row after each month — so the sheet reads
// top to bottom like a ledger. Amounts are plain numbers (no "Rp", no
// thousands separator) so Excel can sum and filter them.
export function exportTreatmentsToCsv(treatments, periodLabel) {
  const sorted = [...treatments].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

  const months = new Map()
  for (const t of sorted) {
    const created = new Date(t.created_at)
    const mKey = monthKey(created)
    if (!months.has(mKey)) months.set(mKey, { label: monthLabel(created), days: new Map() })
    const days = months.get(mKey).days
    const dKey = dateKey(created)
    if (!days.has(dKey)) days.set(dKey, [])
    days.get(dKey).push(t)
  }

  const rows = [
    ['Nineteen Details - Riwayat Transaksi'],
    ['Periode', periodLabel],
    ['Dibuat', formatDateTime(new Date())],
    [],
    HEADER,
  ]

  for (const { label, days } of months.values()) {
    const monthTreatments = []
    for (const [dKey, dayTreatments] of days) {
      for (const t of dayTreatments) {
        const created = new Date(t.created_at)
        rows.push([
          label,
          dKey,
          `${pad(created.getHours())}:${pad(created.getMinutes())}`,
          t.treatment_code,
          t.plate_number || '-',
          t.treatment_type || '-',
          t.customer_name || '-',
          t.serviceSummary || '-',
          STATUS_LABELS[t.status] || t.status,
          t.isPaid ? 'Lunas' : 'Belum',
          (t.payments ?? []).map((p) => PAYMENT_LABELS[p.payment_method] || p.payment_method).join(', ') || '-',
          Number(t.subtotal || 0),
          Number(t.discount || 0),
          Number(t.total || 0),
        ])
      }
      rows.push(summaryRow(`Subtotal ${dKey}`, dayTreatments))
      monthTreatments.push(...dayTreatments)
    }
    rows.push(summaryRow(`Total ${label}`, monthTreatments))
    rows.push([])
  }

  rows.push(summaryRow('Total Keseluruhan', sorted))

  // "sep=," makes Excel split on commas whatever the machine's regional list
  // separator is — Indonesian-locale Excel otherwise expects semicolons and
  // dumps every row into one column.
  const csv = ['sep=,', ...rows.map((row) => row.map(escapeCell).join(','))].join('\r\n')

  const fileSafeLabel = periodLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `riwayat-transaksi-${fileSafeLabel}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
