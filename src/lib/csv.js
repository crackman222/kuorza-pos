import { formatDateTime } from './format'
import { translate as t, dateLocale } from './i18n'

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

// Labels are Indonesian keys, translated when the file is built.
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
  return d.toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' })
}

function escapeCell(value) {
  const str = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

// Revenue counts the same thing the PDF does: paid, non-voided tickets.
function revenueOf(treatments) {
  return treatments
    .filter((row) => row.status !== 'voided' && row.isPaid)
    .reduce((sum, row) => sum + Number(row.total || 0), 0)
}

function summaryRow(label, treatments) {
  const cells = new Array(HEADER.length).fill('')
  cells[1] = label
  cells[3] = t('{count} transaksi', { count: treatments.length })
  cells[HEADER.length - 1] = revenueOf(treatments)
  return cells
}

// Rows run oldest-first, grouped by month and then by day, with a subtotal
// row after each day and a total row after each month — so the sheet reads
// top to bottom like a ledger. Amounts are plain numbers (no "Rp", no
// thousands separator) so Excel can sum and filter them.
export function exportTreatmentsToCsv(treatments, periodLabel) {
  const sorted = [...treatments].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

  const months = new Map()
  for (const treatment of sorted) {
    const created = new Date(treatment.created_at)
    const mKey = monthKey(created)
    if (!months.has(mKey)) months.set(mKey, { label: monthLabel(created), days: new Map() })
    const days = months.get(mKey).days
    const dKey = dateKey(created)
    if (!days.has(dKey)) days.set(dKey, [])
    days.get(dKey).push(treatment)
  }

  const rows = [
    [`Nineteen Details - ${t('Riwayat Transaksi')}`],
    [t('Periode'), periodLabel],
    [t('Dibuat'), formatDateTime(new Date())],
    [],
    HEADER.map((label) => t(label)),
  ]

  for (const { label, days } of months.values()) {
    const monthTreatments = []
    for (const [dKey, dayTreatments] of days) {
      for (const row of dayTreatments) {
        const created = new Date(row.created_at)
        rows.push([
          label,
          dKey,
          `${pad(created.getHours())}:${pad(created.getMinutes())}`,
          row.treatment_code,
          row.plate_number || '-',
          row.treatment_type || '-',
          row.customer_name || '-',
          row.serviceSummary || '-',
          t(STATUS_LABELS[row.status] || row.status),
          row.isPaid ? t('Lunas') : t('Belum'),
          (row.payments ?? []).map((p) => t(PAYMENT_LABELS[p.payment_method] || p.payment_method)).join(', ') || '-',
          Number(row.subtotal || 0),
          Number(row.discount || 0),
          Number(row.total || 0),
        ])
      }
      rows.push(summaryRow(`${t('Subtotal')} ${dKey}`, dayTreatments))
      monthTreatments.push(...dayTreatments)
    }
    rows.push(summaryRow(`${t('Total')} ${label}`, monthTreatments))
    rows.push([])
  }

  rows.push(summaryRow(t('Total Keseluruhan'), sorted))

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
