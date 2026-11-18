import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { searchTreatments, getTreatmentsInRange, getWashProofPhoto, getWashProofSignedUrl } from '../api'
import { parseStaffNames } from '../lib/staffNames'
import { formatRupiah, formatDateTime } from '../lib/format'
import { getPeriodRange, formatPeriodLabel } from '../lib/dateRange'
import { useAuth } from '../context/useAuth'
import { isAdmin as checkIsAdmin } from '../lib/roles'
import { useLanguage } from '../context/useLanguage'

const PERIOD_OPTIONS = [
  { value: 'daily', label: 'Harian' },
  { value: 'weekly', label: 'Mingguan' },
  { value: 'monthly', label: 'Bulanan' },
  { value: 'yearly', label: 'Tahunan' },
]

// Toggle buttons, not a single-choice list: any number can be on at once and
// a row shows if it matches any of them. None on means no filter at all.
const PAYMENT_FILTER_OPTIONS = [
  { value: 'cash', label: 'Tunai' },
  { value: 'qris', label: 'QRIS' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'unpaid', label: 'Belum Dibayar' },
]

const STATUS_LABELS = {
  created: 'Dibuat',
  paid: 'Dibayar',
  diproses: 'Diproses',
  qc: 'QC',
  selesai: 'Selesai',
  closed: 'Ditutup',
  voided: 'Dibatalkan',
}

// A history row that expands in place instead of navigating away: shows who
// washed and QC'd the ticket, the wash-proof photo, and links on to the
// receipt and the full treatment page. The photo is only fetched the first
// time the row is opened, not for every row in the list.
function RiwayatRow({ treatment: row, expanded, onToggle }) {
  const { t } = useLanguage()
  const [photoUrl, setPhotoUrl] = useState(null)
  const [photoState, setPhotoState] = useState('idle') // idle (not fetched yet) | done | error

  useEffect(() => {
    if (!expanded || photoState !== 'idle') return
    getWashProofPhoto(row.id)
      .then(async (path) => setPhotoUrl(path ? await getWashProofSignedUrl(path) : null))
      .then(() => setPhotoState('done'))
      .catch(() => setPhotoState('error'))
  }, [expanded, photoState, row.id])

  const washers = parseStaffNames(row.wash_staff)
  const qcers = parseStaffNames(row.qc_staff)

  return (
    <>
      <div
        className="riwayat-table-row riwayat-row-toggle"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
      >
        <span className="riwayat-service">{row.serviceSummary || '-'}</span>
        <span>{row.treatment_type || '-'}</span>
        <span>{formatDateTime(row.created_at)}</span>
        <span className={`status-badge status-${row.status}`}>{t(STATUS_LABELS[row.status] || row.status)}</span>
        <span className={`status-badge ${row.isPaid ? 'status-closed' : 'status-created'}`}>
          {row.isPaid ? t('Lunas') : t('Belum')}
        </span>
        <span className="riwayat-total">{formatRupiah(row.total)}</span>
      </div>
      {expanded && (
        <div className="expand-wrap">
        <div className="expand-inner">
        <div className="riwayat-expand">
          <div className="riwayat-expand-info">
            <dl>
              <dt>{t('Plat')}</dt>
              <dd>{row.plate_number || '-'}</dd>
              <dt>{t('Petugas Cuci')}</dt>
              <dd>{washers.length ? washers.join(', ') : t('Belum ditugaskan')}</dd>
              <dt>{t('Petugas QC')}</dt>
              <dd>{qcers.length ? qcers.join(', ') : t('Belum ditugaskan')}</dd>
            </dl>
            <div className="riwayat-expand-actions">
              <Link to={`/struk/${row.id}`} className="btn-primary">
                {t('Lihat Struk')}
              </Link>
              <Link to={`/treatment/${row.id}`} className="btn-secondary">
                {t('Detail Transaksi')}
              </Link>
            </div>
          </div>
          <div className="riwayat-expand-photo">
            {photoState === 'idle' && <p className="riwayat-loading">{t('Memuat foto...')}</p>}
            {photoState === 'error' && <p className="form-error">{t('Gagal memuat foto')}</p>}
            {photoState === 'done' && !photoUrl && (
              <p className="upah-breakdown-empty">{t('Belum ada foto bukti cuci')}</p>
            )}
            {photoUrl && (
              <a href={photoUrl} target="_blank" rel="noreferrer">
                <img src={photoUrl} alt={t('Bukti foto cuci')} className="riwayat-expand-image" />
              </a>
            )}
          </div>
        </div>
        </div>
        </div>
      )}
    </>
  )
}

export default function RiwayatTransaksi() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const isAdmin = checkIsAdmin(profile)
  const [treatments, setTreatments] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isFiltered, setIsFiltered] = useState(false)
  const [period, setPeriod] = useState('daily')
  const [exporting, setExporting] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [paymentFilters, setPaymentFilters] = useState([])

  function togglePaymentFilter(value) {
    setPaymentFilters((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]))
  }
  // Same arrangement as Laporan's leaderboard: the period picker is admin-only,
  // so staff stay pinned to today's rows no matter what's in state.
  const effectivePeriod = isAdmin ? period : 'daily'

  useEffect(() => {
    loadPeriod(effectivePeriod)
  }, [effectivePeriod])

  function loadPeriod(p) {
    setLoading(true)
    setError('')
    setIsFiltered(false)
    const { start, end } = getPeriodRange(p)
    getTreatmentsInRange(start, end)
      .then(setTreatments)
      .catch(() => setError('Gagal memuat riwayat'))
      .finally(() => setLoading(false))
  }

  async function handleSearch(e) {
    e.preventDefault()
    if (!query.trim()) {
      loadPeriod(effectivePeriod)
      return
    }
    setLoading(true)
    setError('')
    try {
      const results = await searchTreatments(query, { todayOnly: !isAdmin })
      setTreatments(results)
      setIsFiltered(true)
    } catch {
      setError('Gagal mencari transaksi')
    } finally {
      setLoading(false)
    }
  }

  // Both exports pull the whole period fresh rather than reusing the rows on
  // screen, so the search and payment filter don't leak into the file.
  async function handleExport(format) {
    setExporting(format)
    setError('')
    try {
      const { start, end } = getPeriodRange(period)
      if (format === 'pdf') {
        const [results, { exportTreatmentsToPdf }] = await Promise.all([
          getTreatmentsInRange(start, end),
          import('../lib/pdf'),
        ])
        exportTreatmentsToPdf(results, formatPeriodLabel(period))
      } else {
        const [results, { exportTreatmentsToCsv }] = await Promise.all([
          getTreatmentsInRange(start, end),
          import('../lib/csv'),
        ])
        exportTreatmentsToCsv(results, formatPeriodLabel(period))
      }
    } catch {
      setError(format === 'pdf' ? 'Gagal membuat PDF' : 'Gagal membuat file Excel')
    } finally {
      setExporting(null)
    }
  }

  // The payment filter is applied client-side on the rows already loaded, so
  // it composes with both the period picker and the search. A ticket
  // matches a method if any of its payments used it; 'unpaid' has none.
  // Several toggles on combine with OR.
  const visibleTreatments = useMemo(() => {
    if (paymentFilters.length === 0) return treatments
    return treatments.filter((row) =>
      paymentFilters.some((f) =>
        f === 'unpaid' ? !row.isPaid : row.payments.some((p) => p.payment_method === f),
      ),
    )
  }, [treatments, paymentFilters])

  const stats = useMemo(() => {
    // Revenue reflects money actually collected — treatments can now sit in
    // the queue unpaid, so only paid ones count toward it.
    const paid = visibleTreatments.filter((t) => t.status !== 'voided' && t.isPaid)
    const revenue = paid.reduce((sum, t) => sum + Number(t.total || 0), 0)
    const avg = paid.length ? Math.round(revenue / paid.length) : 0
    return {
      count: visibleTreatments.length,
      revenue,
      avg,
    }
  }, [visibleTreatments])

  return (
    <div className="riwayat-screen">
      <div className="riwayat-header">
        <h1>{t('Riwayat Transaksi')}</h1>
        <form onSubmit={handleSearch} className="riwayat-search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari plat, kode, nama, merek... (staff:budi merek:cbr)"
            title="Filter: staff:, merek:, plat:, kode:, nama:, cuci:, qc:, pic: — pakai tanda kutip untuk spasi, mis. nama:&quot;budi santoso&quot;"
          />
          <button type="submit">{t('Cari')}</button>
        </form>
      </div>
      <div className="riwayat-payment-filters" role="group" aria-label={t('Filter metode pembayaran')}>
        <button
          type="button"
          className={`riwayat-payment-toggle ${paymentFilters.length === 0 ? 'active' : ''}`}
          aria-pressed={paymentFilters.length === 0}
          onClick={() => setPaymentFilters([])}
        >
          {t('Semua Pembayaran')}
        </button>
        {PAYMENT_FILTER_OPTIONS.map((opt) => {
          const on = paymentFilters.includes(opt.value)
          return (
            <button
              key={opt.value}
              type="button"
              className={`riwayat-payment-toggle ${on ? 'active' : ''}`}
              aria-pressed={on}
              onClick={() => togglePaymentFilter(opt.value)}
            >
              {t(opt.label)}
            </button>
          )
        })}
      </div>
      {!isAdmin && (
        <p className="riwayat-scope-note">{t('Pencarian dan riwayat hanya menampilkan transaksi hari ini.')}</p>
      )}

      {isAdmin && (
        <div className="riwayat-export">
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.label)}
              </option>
            ))}
          </select>
          <button type="button" className="btn-secondary" onClick={() => handleExport('pdf')} disabled={!!exporting}>
            {exporting === 'pdf' ? t('Membuat PDF...') : t('Unduh PDF')}
          </button>
          <button type="button" className="btn-secondary" onClick={() => handleExport('csv')} disabled={!!exporting}>
            {exporting === 'csv' ? t('Membuat Excel...') : t('Unduh Excel (CSV)')}
          </button>
          <span className="riwayat-period-label">{formatPeriodLabel(period)}</span>
        </div>
      )}

      {!isFiltered && (
        <div className="stat-cards">
          <div className="stat-card">
            <span className="stat-card-label">{isAdmin ? t('Jumlah Transaksi') : t('Transaksi Hari Ini')}</span>
            <span className="stat-card-value">{stats.count}</span>
          </div>
          <div className="stat-card">
            <span className="stat-card-label">{isAdmin ? t('Pendapatan') : t('Pendapatan Hari Ini')}</span>
            <span className="stat-card-value stat-card-value-accent">{formatRupiah(stats.revenue)}</span>
          </div>
          <div className="stat-card">
            <span className="stat-card-label">{t('Rata-rata Transaksi')}</span>
            <span className="stat-card-value">{formatRupiah(stats.avg)}</span>
          </div>
        </div>
      )}

      {error && <p className="form-error">{t(error)}</p>}
      {loading && <p className="riwayat-loading">{t('Memuat...')}</p>}

      {!loading && visibleTreatments.length > 0 && (
        <div className="riwayat-table">
          <div className="riwayat-table-row riwayat-table-head">
            <span>{t('Layanan')}</span>
            <span>{t('Merek')}</span>
            <span>{t('Waktu')}</span>
            <span>{t('Status')}</span>
            <span>{t('Bayar')}</span>
            <span>{t('Total')}</span>
          </div>
          {visibleTreatments.map((row) => (
            <RiwayatRow
              key={row.id}
              treatment={row}
              expanded={expandedId === row.id}
              onToggle={() => setExpandedId((id) => (id === row.id ? null : row.id))}
            />
          ))}
        </div>
      )}
      {!loading && visibleTreatments.length === 0 && <p className="riwayat-empty">{t('Tidak ada transaksi')}</p>}
    </div>
  )
}
