import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getTreatmentDetail,
  closeTreatment,
  voidTreatment,
  startProcessing,
  markSelesai,
  hasRequiredStaff,
  recordVerifiedPayment,
  uploadPaymentProofPhoto,
  isPaymentVerified,
  assignWashStaff,
  assignQcStaff,
  getWashProofPhoto,
  getWashProofSignedUrl,
  getPromoProofPhoto,
  uploadPromoProofPhoto,
  needsPromoProof,
} from '../api'
import { useWashProofUpload } from '../components/useWashProofUpload'
import { PaymentModal } from '../components/PaymentModal'
import { StaffPicker } from '../components/StaffPicker'
import { MultiStaffPicker } from '../components/MultiStaffPicker'
import { StartProcessModal } from '../components/StartProcessModal'
import { formatRupiah, formatDateTime } from '../lib/format'
import { parseStaffNames } from '../lib/staffNames'
import { useAuth } from '../context/useAuth'
import { isStaff } from '../lib/roles'
import { useLanguage } from '../context/useLanguage'

const STATUS_LABELS = {
  created: 'Dibuat',
  paid: 'Dibayar',
  diproses: 'Diproses',
  qc: 'QC',
  selesai: 'Selesai',
  closed: 'Ditutup',
  voided: 'Dibatalkan',
}

const PAYMENT_METHOD_LABELS = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
}

export default function DetailTreatment() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { t } = useLanguage()
  // The phone shell already names the screen in its top bar, so repeating it
  // as an <h1> here just burns a line of a short screen. Workers get a back
  // button in its place; the desk shell has no title of its own, so it keeps
  // the heading.
  const workerView = isStaff(profile)
  const [treatment, setTreatment] = useState(null)
  const [hasPhoto, setHasPhoto] = useState(false)
  const [photoUrl, setPhotoUrl] = useState(null)
  const [paymentProofUrl, setPaymentProofUrl] = useState(null)
  // Promo eligibility photo (migration 024): hasPromoPhoto gates closing,
  // promoPhotoUrl is the signed URL for the thumbnail.
  const [hasPromoPhoto, setHasPromoPhoto] = useState(false)
  const [promoPhotoUrl, setPromoPhotoUrl] = useState(null)
  // Which photo the lightbox is showing (wash proof or payment proof), or null.
  const [lightboxUrl, setLightboxUrl] = useState(null)
  const [error, setError] = useState('')
  const [photoError, setPhotoError] = useState('')
  const [busy, setBusy] = useState(false)
  const [startOpen, setStartOpen] = useState(false)
  // null | 'pay' (record payment) | 'proof' (recorded, photo missing)
  const [payMode, setPayMode] = useState(null)
  const [payError, setPayError] = useState('')

  const load = useCallback(() => {
    getTreatmentDetail(id)
      .then(async (data) => {
        setTreatment(data)
        const proofPath = data.payment?.proof_url
        setPaymentProofUrl(proofPath ? await getWashProofSignedUrl(proofPath).catch(() => null) : null)
      })
      .catch(() => setError('Gagal memuat transaksi'))
    getWashProofPhoto(id)
      .then(async (path) => {
        setHasPhoto(Boolean(path))
        setPhotoUrl(path ? await getWashProofSignedUrl(path) : null)
      })
      .catch(() => {})
    getPromoProofPhoto(id)
      .then(async (path) => {
        setHasPromoPhoto(Boolean(path))
        setPromoPhotoUrl(path ? await getWashProofSignedUrl(path).catch(() => null) : null)
      })
      .catch(() => {})
  }, [id])

  const washProof = useWashProofUpload({
    treatmentId: id,
    onUploaded: () => {
      setPhotoError('')
      load()
    },
    onError: setPhotoError,
  })

  const promoProof = useWashProofUpload({
    treatmentId: id,
    uploadFn: uploadPromoProofPhoto,
    onUploaded: () => {
      setPhotoError('')
      load()
    },
    onError: setPhotoError,
  })

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!lightboxUrl) return
    function handleKeyDown(e) {
      if (e.key === 'Escape') setLightboxUrl(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [lightboxUrl])

  // Errors stay inside the payment modal rather than replacing the whole
  // screen. Reload either way: a failed proof upload can still leave the
  // payment itself recorded.
  async function handlePay({ paymentMethod, proofFile }) {
    setBusy(true)
    setPayError('')
    try {
      if (payMode === 'proof') {
        await uploadPaymentProofPhoto(id, proofFile)
      } else {
        await recordVerifiedPayment(id, { paymentMethod, proofFile })
      }
      setPayMode(null)
    } catch (err) {
      setPayError(err.message || 'Gagal menyimpan pembayaran')
    } finally {
      setBusy(false)
      load()
    }
  }

  async function handleAssignWash(staffNames) {
    setBusy(true)
    try {
      await assignWashStaff(id, staffNames)
      load()
    } catch {
      setError('Gagal menetapkan petugas cuci')
    } finally {
      setBusy(false)
    }
  }

  async function handleAssignQc(staffName) {
    setBusy(true)
    try {
      await assignQcStaff(id, staffName)
      load()
    } catch {
      setError('Gagal menetapkan petugas QC')
    } finally {
      setBusy(false)
    }
  }

  async function handleStartProcessing(washStaffNames) {
    setBusy(true)
    try {
      await startProcessing(id, washStaffNames)
      setStartOpen(false)
      load()
    } catch {
      setError('Gagal memulai proses')
    } finally {
      setBusy(false)
    }
  }

  async function handleMarkSelesai() {
    if (!hasRequiredStaff(treatment) || !hasPhoto) return
    setBusy(true)
    try {
      await markSelesai(id)
      load()
    } catch (err) {
      setError(err.message || 'Gagal menyelesaikan transaksi')
    } finally {
      setBusy(false)
    }
  }

  async function handleClose() {
    setBusy(true)
    try {
      await closeTreatment(id)
      load()
    } catch (err) {
      setError(err.message || 'Gagal menutup transaksi')
    } finally {
      setBusy(false)
    }
  }

  async function handleVoid() {
    if (treatment.payment) return
    if (!confirm(t('Batalkan transaksi ini?'))) return
    setBusy(true)
    try {
      await voidTreatment(id)
      load()
    } catch (err) {
      setError(err.message || 'Gagal membatalkan transaksi')
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <div className="detail-screen">
        <p className="form-error">{t(error)}</p>
      </div>
    )
  }
  if (!treatment) {
    return <div className="loading-screen">{t('Memuat...')}</div>
  }

  const isFinal = treatment.status === 'voided' || treatment.status === 'closed'
  const isPaid = Boolean(treatment.payment)
  // Closing needs a verified payment: cash, or QRIS/transfer with a proof photo.
  const paymentVerified = isPaymentVerified(treatment.payment)
  const staffReady = hasRequiredStaff(treatment)
  // A promo ticket also needs the promo eligibility photo to close.
  const promoTicket = needsPromoProof(treatment, treatment.items)
  const promoVerified = !promoTicket || hasPromoPhoto
  // In progress → done. 'qc' is a retired stage; old tickets still in it
  // finish the same way.
  const canFinish = treatment.status === 'diproses' || treatment.status === 'qc'

  return (
    <div className="detail-screen">
      {workerView ? (
        <button type="button" className="worker-back-btn" onClick={() => navigate('/')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t('Kembali')}
        </button>
      ) : (
        <h1>{t('Detail Transaksi')}</h1>
      )}

      <div className="detail-card">
        <div className="detail-card-header">
          <div>
            <div className="detail-card-code">{treatment.treatment_code}</div>
            <div className="detail-card-plate">{treatment.plate_number || '-'}</div>
          </div>
          <div className="detail-card-badges">
            <span className={`status-badge status-${treatment.status}`}>
              {t(STATUS_LABELS[treatment.status] || treatment.status)}
            </span>
            <span
              className={`status-badge ${
                paymentVerified ? 'status-closed' : isPaid ? 'status-diproses' : 'status-created'
              }`}
            >
              {paymentVerified ? t('Lunas') : isPaid ? t('Bukti Bayar Belum Ada') : t('Belum Dibayar')}
            </span>
          </div>
        </div>

        {treatment.customer_name && (
          <div className="struk-row">
            <span>{t('Pelanggan')}</span>
            <span>{treatment.customer_name}</span>
          </div>
        )}
        <div className="struk-row">
          <span>{t('Kendaraan')}</span>
          <span>{treatment.treatment_type || '-'}</span>
        </div>
        <div className="struk-row">
          <span>{t('Staf')}</span>
          <span>{treatment.pic}</span>
        </div>
        <div className="struk-row struk-row-picker">
          <span>{t('Petugas Cuci')}</span>
          <MultiStaffPicker
            value={parseStaffNames(treatment.wash_staff)}
            onChange={handleAssignWash}
            disabled={busy || isFinal}
          />
        </div>
        <div className="struk-row">
          <span>{t('Petugas QC')}</span>
          <StaffPicker value={treatment.qc_staff} onChange={handleAssignQc} disabled={busy || isFinal} />
        </div>
        <div className="struk-row">
          <span>{t('Tanggal')}</span>
          <span>{formatDateTime(treatment.created_at)}</span>
        </div>
        <div className="struk-row">
          <span>{t('Bukti Foto')}</span>
          <span className="detail-promo-proof">
            {photoUrl ? (
              <button
                type="button"
                className="wash-proof-thumb-btn"
                onClick={() => setLightboxUrl(photoUrl)}
                aria-label={t('Perbesar bukti foto cuci')}
              >
                <img src={photoUrl} alt={t('Bukti foto cuci')} className="wash-proof-thumb" />
              </button>
            ) : (
              <span>{t('Belum ada foto')}</span>
            )}
            <button
              type="button"
              className="wash-proof-btn"
              onClick={washProof.open}
              disabled={busy || washProof.uploading}
              aria-label={hasPhoto ? t('Ganti bukti foto cuci') : t('Unggah bukti foto cuci')}
            >
              {washProof.uploading ? '…' : hasPhoto ? `📷 ${t('Ulangi Foto')}` : `📷 ${t('Foto')}`}
            </button>
          </span>
        </div>
        {promoTicket && (
          <div className="struk-row">
            <span>{t('Bukti Promo')}</span>
            <span className="detail-promo-proof">
              {promoPhotoUrl ? (
                <button
                  type="button"
                  className="wash-proof-thumb-btn"
                  onClick={() => setLightboxUrl(promoPhotoUrl)}
                  aria-label={t('Perbesar bukti promo')}
                >
                  <img src={promoPhotoUrl} alt={t('Bukti promo')} className="wash-proof-thumb" />
                </button>
              ) : (
                <span>{t('Belum ada foto')}</span>
              )}
              {!isFinal && (
                <button
                  type="button"
                  className="wash-proof-btn"
                  onClick={promoProof.open}
                  disabled={busy || promoProof.uploading}
                >
                  {promoProof.uploading ? '…' : hasPromoPhoto ? `📷 ${t('Ulangi Foto')}` : `📷 ${t('Foto')}`}
                </button>
              )}
            </span>
          </div>
        )}
        {photoError && <p className="form-error">{t(photoError)}</p>}
        {isPaid && (
          <div className="struk-row">
            <span>{t('Pembayaran')}</span>
            <span>{t(PAYMENT_METHOD_LABELS[treatment.payment.payment_method] || treatment.payment.payment_method)}</span>
          </div>
        )}
        {isPaid && treatment.payment.payment_method !== 'cash' && (
          <div className="struk-row">
            <span>{t('Bukti Bayar')}</span>
            {paymentProofUrl ? (
              <button
                type="button"
                className="wash-proof-thumb-btn"
                onClick={() => setLightboxUrl(paymentProofUrl)}
                aria-label={t('Perbesar bukti pembayaran')}
              >
                <img src={paymentProofUrl} alt={t('Bukti pembayaran')} className="wash-proof-thumb" />
              </button>
            ) : (
              <span>{t('Belum ada foto')}</span>
            )}
          </div>
        )}

        <hr />
        <div className="struk-items">
          {treatment.items.map((item) => (
            <div key={item.id} className="struk-item">
              <span>
                {item.service_name} x{item.quantity}
              </span>
              <span>{formatRupiah(item.subtotal)}</span>
            </div>
          ))}
        </div>
        <hr />

        <div className="struk-row">
          <span>{t('Subtotal')}</span>
          <span>{formatRupiah(treatment.subtotal)}</span>
        </div>
        {treatment.discount > 0 && (
          <div className="struk-row">
            <span>{t('Diskon')}</span>
            <span>-{formatRupiah(treatment.discount)}</span>
          </div>
        )}
        <div className="struk-row struk-total">
          <span>{t('Total')}</span>
          <span>{formatRupiah(treatment.total)}</span>
        </div>

        {!isFinal && !paymentVerified && (
          <div className="payment-form">
            <button
              type="button"
              className="btn-primary payment-form-trigger"
              onClick={() => setPayMode(isPaid ? 'proof' : 'pay')}
              disabled={busy}
            >
              {isPaid ? `📷 ${t('Foto Bukti Bayar')}` : `💳 ${t('Verifikasi Pembayaran')}`}
            </button>
          </div>
        )}

        {treatment.status === 'selesai' && !paymentVerified && (
          <p className="detail-hint">
            {isPaid
              ? t('Foto bukti pembayaran QRIS/transfer diperlukan sebelum transaksi bisa ditutup.')
              : t('Pembayaran harus diverifikasi sebelum transaksi bisa ditutup.')}
          </p>
        )}

        {treatment.status === 'selesai' && !promoVerified && (
          <p className="detail-hint">{t('Foto bukti promo diperlukan sebelum transaksi bisa ditutup.')}</p>
        )}

        {canFinish && !hasPhoto && (
          <p className="detail-hint">{t('Unggah bukti foto cuci terlebih dahulu sebelum menandai selesai.')}</p>
        )}

        {canFinish && !staffReady && (
          <p className="detail-hint">{t('Isi petugas cuci dan petugas QC terlebih dahulu sebelum menandai selesai.')}</p>
        )}

        {treatment.notes && (
          <p className="struk-notes">
            {t('Catatan')}: {treatment.notes}
          </p>
        )}

        <div className="detail-actions">
          <button type="button" className="btn-secondary" onClick={() => navigate(`/struk/${treatment.id}`)}>
            {t('Lihat Struk')}
          </button>
          {!isFinal && (
            <>
              {(treatment.status === 'created' || treatment.status === 'paid') && (
                <button type="button" className="btn-primary" onClick={() => setStartOpen(true)} disabled={busy}>
                  {t('Mulai Proses')}
                </button>
              )}
              {canFinish && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleMarkSelesai}
                  disabled={busy || !staffReady || !hasPhoto}
                  title={
                    !hasPhoto
                      ? t('Unggah bukti foto cuci terlebih dahulu')
                      : staffReady
                        ? undefined
                        : t('Isi petugas cuci dan petugas QC terlebih dahulu')
                  }
                >
                  {t('Tandai Selesai')}
                </button>
              )}
              {treatment.status === 'selesai' && paymentVerified && promoVerified && (
                <button type="button" className="btn-primary" onClick={handleClose} disabled={busy}>
                  {t('Tutup Transaksi')}
                </button>
              )}
              <button
                type="button"
                className="btn-danger"
                onClick={handleVoid}
                disabled={busy || isPaid}
                title={isPaid ? t('Transaksi yang sudah dibayar tidak bisa dibatalkan') : undefined}
              >
                {t('Batalkan')}
              </button>
            </>
          )}
        </div>
      </div>

      {startOpen && (
        <StartProcessModal
          treatment={treatment}
          busy={busy}
          onCancel={() => setStartOpen(false)}
          onConfirm={handleStartProcessing}
        />
      )}

      {payMode && (
        <PaymentModal
          total={treatment.total}
          busy={busy}
          error={payError}
          proofOnly={payMode === 'proof'}
          initialMethod={payMode === 'proof' ? treatment.payment?.payment_method : 'cash'}
          onCancel={() => {
            setPayMode(null)
            setPayError('')
          }}
          onConfirm={handlePay}
        />
      )}

      {washProof.capture}
      {promoProof.capture}

      {lightboxUrl && (
        <div className="photo-lightbox-overlay" onClick={() => setLightboxUrl(null)}>
          <button
            type="button"
            className="photo-lightbox-close"
            onClick={() => setLightboxUrl(null)}
            aria-label={t('Tutup')}
          >
            ✕
          </button>
          <img
            src={lightboxUrl}
            alt={t('Bukti foto')}
            className="photo-lightbox-image"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
