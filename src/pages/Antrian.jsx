import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  getActiveQueue,
  getWashProofMap,
  startProcessing,
  markSelesai,
  closeTreatment,
  recordVerifiedPayment,
  uploadPaymentProofPhoto,
  subscribeToQueueChanges,
} from '../api'
import { formatRupiah, formatDateTime, ticketLabel } from '../lib/format'
import { WashProofButton } from '../components/WashProofButton'
import { QueueCard } from '../components/QueueCard'
import { useAuth } from '../context/useAuth'
import { useLanguage } from '../context/useLanguage'
import { isStaff } from '../lib/roles'
import { TASK_REMINDER_DAYS, daysOpen, isOverdue } from '../lib/taskReminder'

// Only the statuses that can appear in the queue — 'closed' and 'voided' drop
// out of it (see QUEUE_STATUSES in api/treatments.js).
const STATUS_LABELS = {
  created: 'Dibuat',
  paid: 'Dibayar',
  diproses: 'Diproses',
  qc: 'QC',
  selesai: 'Selesai',
}

// Advancing a ticket from the queue card. Same calls DetailTreatment makes,
// keyed by the action name QueueCard hands back. 'close' refuses a ticket
// whose payment isn't verified (see closeTreatment).
const ADVANCE = {
  start: startProcessing,
  done: markSelesai,
  close: closeTreatment,
}

export default function Antrian() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { t } = useLanguage()
  // Workers are on a phone: the queue reads as cards, and the money figure
  // stays on the desk view. 'Belum Dibayar' does not — a worker has to know
  // not to release a vehicle that hasn't paid.
  const workerView = isStaff(profile)
  const [queue, setQueue] = useState([])
  const [photoMap, setPhotoMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [busyId, setBusyId] = useState(null)

  const loadQueue = useCallback(
    () =>
      getActiveQueue()
        .then((data) => {
          setQueue(data)
          return getWashProofMap(data.map((t) => t.id))
        })
        .then((map) => map && setPhotoMap(map))
        .catch(() => setError('Gagal memuat antrian')),
    []
  )

  useEffect(() => {
    loadQueue().finally(() => setLoading(false))
  }, [loadQueue])

  // Live updates from other users. Creating one ticket fires several inserts
  // (treatment, items, payment) in quick succession, so changes are debounced
  // into a single refetch.
  useEffect(() => {
    let timer
    const unsubscribe = subscribeToQueueChanges(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        loadQueue()
      }, 300)
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [loadQueue])

  // Refetch rather than patch the row in place: 'closed' drops a ticket out
  // of the queue entirely (see QUEUE_STATUSES), so the list itself changes.
  // extra is only used by 'start', which carries the wash crew picked in the
  // modal.
  async function handleAdvance(id, action, extra) {
    setBusyId(id)
    setError('')
    try {
      await ADVANCE[action](id, extra)
      await loadQueue()
    } catch (err) {
      // closeTreatment's refusal names what's missing — show it.
      setError(action === 'close' && err.message ? err.message : 'Gagal memperbarui status transaksi')
    } finally {
      setBusyId(null)
    }
  }

  // Payment verification from the queue card. Throws back to the card so
  // the error shows inside the payment modal; the queue is reloaded either
  // way, since a failed proof upload can still leave the payment recorded.
  async function handlePay(treatment, { paymentMethod, proofFile, proofOnly }) {
    setBusyId(treatment.id)
    try {
      if (proofOnly) {
        await uploadPaymentProofPhoto(treatment.id, proofFile)
      } else {
        await recordVerifiedPayment(treatment.id, { paymentMethod, proofFile })
      }
    } finally {
      await loadQueue()
      setBusyId(null)
    }
  }

  function markPhotoUploaded(treatmentId) {
    setPhotoMap((map) => ({ ...map, [treatmentId]: true }))
  }

  const stats = useMemo(() => {
    const unpaid = queue.filter((t) => !t.isPaid).length
    const revenue = queue.reduce((sum, t) => sum + Number(t.total || 0), 0)
    // Work not started yet covers both 'created' and 'paid' — paying up front
    // doesn't move the job along, it's still waiting for someone to start it.
    const byStatus = (statuses) => queue.filter((t) => statuses.includes(t.status)).length
    return {
      count: queue.length,
      unpaid,
      revenue,
      belumDiproses: byStatus(['created', 'paid']),
      // 'qc' is a retired stage — any old ticket still in it counts as in
      // progress, since that's where it's finished from now.
      diproses: byStatus(['diproses', 'qc']),
      selesai: byStatus(['selesai']),
    }
  }, [queue])

  const overdueTreatments = useMemo(() => queue.filter((t) => isOverdue(t.created_at)), [queue])

  // The worker view's filter chips. Each one is a stat card that also filters,
  // which is what the counts were really for — the desk view keeps the plain
  // cards. Statuses match the byStatus() groupings above.
  const FILTERS = [
    { key: 'all', label: 'Semua', count: stats.count },
    { key: 'belum', label: 'Belum Diproses', count: stats.belumDiproses },
    { key: 'diproses', label: 'Diproses', count: stats.diproses },
    { key: 'selesai', label: 'Selesai', count: stats.selesai },
  ]

  const visibleQueue = useMemo(() => {
    if (filter === 'belum') return queue.filter((t) => t.status === 'created' || t.status === 'paid')
    if (filter === 'all') return queue
    if (filter === 'diproses') return queue.filter((t) => t.status === 'diproses' || t.status === 'qc')
    return queue.filter((t) => t.status === filter)
  }, [queue, filter])

  return (
    <div className="antrian-screen">
      <div className="riwayat-header">
        <h1>{t('Dashboard')}</h1>
        <Link to="/transaksi-baru" className="btn-primary antrian-new-link">
          + {t('Transaksi Baru')}
        </Link>
      </div>

      {workerView && (
        <div className="worker-filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`worker-chip ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
            >
              {t(f.label)}
              <span className="worker-chip-count">({f.count})</span>
            </button>
          ))}
        </div>
      )}

      {!workerView && (
        <>
      <div className="stat-cards">
        <div className="stat-card">
          <span className="stat-card-label">{t('Dalam Antrian')}</span>
          <span className="stat-card-value">{stats.count}</span>
        </div>
        <div className="stat-card">
          <span className="stat-card-label">{t('Belum Dibayar')}</span>
          <span className="stat-card-value stat-card-value-accent">{stats.unpaid}</span>
        </div>
        <div className="stat-card">
          <span className="stat-card-label">{t('Nilai Antrian')}</span>
          <span className="stat-card-value">{formatRupiah(stats.revenue)}</span>
        </div>
      </div>

      <div className="stat-cards">
        <div className="stat-card">
          <span className="stat-card-label">
            <span className="status-badge status-created">{t('Belum Diproses')}</span>
          </span>
          <span className="stat-card-value">{stats.belumDiproses}</span>
        </div>
        <div className="stat-card">
          <span className="stat-card-label">
            <span className="status-badge status-diproses">{t('Diproses')}</span>
          </span>
          <span className="stat-card-value">{stats.diproses}</span>
        </div>
        <div className="stat-card">
          <span className="stat-card-label">
            <span className="status-badge status-selesai">{t('Selesai')}</span>
          </span>
          <span className="stat-card-value">{stats.selesai}</span>
        </div>
      </div>
        </>
      )}

      {!loading && overdueTreatments.length > 0 && (
        <div className="overdue-alert" role="alert">
          <span className="overdue-alert-icon">⚠️</span>
          <span>
            {t('{count} transaksi sudah {days} hari atau lebih belum selesai — segera tindak lanjuti:', {
              count: overdueTreatments.length,
              days: TASK_REMINDER_DAYS,
            })}{' '}
            {overdueTreatments.map((row, i) => (
              <span key={row.id}>
                {i > 0 && ', '}
                <Link to={`/treatment/${row.id}`} className="overdue-alert-link">
                  {ticketLabel(row)}
                </Link>
              </span>
            ))}
          </span>
        </div>
      )}

      {error && <p className="form-error">{t(error)}</p>}
      {loading && <p className="riwayat-loading">{t('Memuat...')}</p>}

      {!loading && workerView && visibleQueue.length > 0 && (
        <div className="queue-cards">
          {visibleQueue.map((row) => (
            <QueueCard
              key={row.id}
              treatment={row}
              statusLabel={t(STATUS_LABELS[row.status] || row.status)}
              hasPhoto={Boolean(photoMap[row.id])}
              busy={busyId === row.id}
              onUploaded={markPhotoUploaded}
              onAdvance={handleAdvance}
              onPay={handlePay}
            />
          ))}
        </div>
      )}

      {!loading && workerView && visibleQueue.length === 0 && !error && (
        <p className="riwayat-empty">
          {queue.length === 0
            ? t('Tidak ada antrian aktif — semua transaksi sudah selesai')
            : t('Tidak ada transaksi di daftar ini')}
        </p>
      )}

      {!loading && queue.length > 0 && !workerView && (
        <div className="riwayat-table antrian-table">
          <div className="riwayat-table-row riwayat-table-head">
            <span>{t('Layanan')}</span>
            <span>{t('Merek')}</span>
            <span>{t('Staf')}</span>
            <span>{t('Status')}</span>
            <span>{t('Bayar')}</span>
            <span>{t('Waktu')}</span>
            <span>{t('Bukti Foto')}</span>
          </div>
          {queue.map((row) => {
            const overdue = isOverdue(row.created_at)
            return (
            <div
              key={row.id}
              className={`riwayat-table-row ${overdue ? 'overdue' : ''}`}
              role="link"
              tabIndex={0}
              onClick={() => navigate(`/treatment/${row.id}`)}
              onKeyDown={(e) => e.key === 'Enter' && navigate(`/treatment/${row.id}`)}
            >
              <span className="riwayat-service">{row.serviceSummary || '-'}</span>
              <span className="antrian-vehicle-cell">
                <span className="antrian-vehicle">{row.treatment_type || '-'}</span>
                {row.plate_number && <span className="antrian-vehicle-plate">{row.plate_number}</span>}
              </span>
              <span>{row.pic || '-'}</span>
              <span className={`status-badge status-${row.status}`}>
                {t(STATUS_LABELS[row.status] || row.status)}
              </span>
              <span
                className={`status-badge ${
                  row.isPaymentVerified ? 'status-closed' : row.isPaid ? 'status-diproses' : 'status-created'
                }`}
                title={row.isPaid && !row.isPaymentVerified ? t('Bukti pembayaran belum diunggah') : undefined}
              >
                {row.isPaymentVerified ? t('Lunas') : row.isPaid ? t('Tanpa Bukti') : t('Belum')}
              </span>
              <span>
                {formatDateTime(row.created_at)}
                {overdue && (
                  <span
                    className="overdue-badge"
                    title={t('Sudah {days} hari belum selesai', { days: daysOpen(row.created_at) })}
                  >
                    ⚠️ {t('{days} hari', { days: daysOpen(row.created_at) })}
                  </span>
                )}
              </span>
              <span>
                <WashProofButton
                  treatmentId={row.id}
                  hasPhoto={Boolean(photoMap[row.id])}
                  onUploaded={markPhotoUploaded}
                />
              </span>
            </div>
            )
          })}
        </div>
      )}
      {!loading && !workerView && queue.length === 0 && !error && (
        <p className="riwayat-empty">{t('Tidak ada antrian aktif — semua transaksi sudah selesai')}</p>
      )}
    </div>
  )
}
