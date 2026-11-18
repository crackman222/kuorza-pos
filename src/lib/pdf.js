import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatRupiah, formatDateTime } from './format'
import { translate as t } from './i18n'

const STATUS_LABELS = {
  created: 'Dibuat',
  paid: 'Dibayar',
  diproses: 'Diproses',
  qc: 'QC',
  selesai: 'Selesai',
  closed: 'Ditutup',
  voided: 'Dibatalkan',
}

export function exportTreatmentsToPdf(treatments, periodLabel) {
  const doc = new jsPDF()

  doc.setFontSize(16)
  doc.text('Nineteen Details', 14, 18)
  doc.setFontSize(11)
  doc.text(t('Riwayat Transaksi'), 14, 26)
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text(periodLabel, 14, 32)
  doc.text(`${t('Dibuat')}: ${formatDateTime(new Date())}`, 14, 37)

  const paid = treatments.filter((row) => row.status !== 'voided' && row.isPaid)
  const revenue = paid.reduce((sum, row) => sum + Number(row.total || 0), 0)

  doc.setTextColor(0)
  doc.setFontSize(10)
  doc.text(`${t('Total Transaksi')}: ${treatments.length}`, 14, 46)
  doc.text(`${t('Total Pendapatan')}: ${formatRupiah(revenue)}`, 14, 51)

  autoTable(doc, {
    startY: 58,
    head: [['Plat', 'Kendaraan', 'Tanggal', 'Status', 'Bayar', 'Total'].map((label) => t(label))],
    body: treatments.map((row) => [
      row.plate_number || '-',
      row.treatment_type || '-',
      formatDateTime(row.created_at),
      t(STATUS_LABELS[row.status] || row.status),
      row.isPaid ? t('Lunas') : t('Belum'),
      formatRupiah(row.total),
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [44, 106, 158] },
  })

  const fileSafeLabel = periodLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  doc.save(`riwayat-transaksi-${fileSafeLabel}.pdf`)
}
