import { useEffect, useMemo, useState } from 'react'
import { PaymentMethodSelector } from './PaymentMethodSelector'
import { CameraCapture } from './CameraCapture'
import { paymentNeedsProof } from '../api'
import { isCameraSupported } from '../lib/camera'
import { formatRupiah } from '../lib/format'
import { useLanguage } from '../context/useLanguage'

// Recording a payment so the ticket can be closed. Cash is confirmed as is;
// QRIS and transfer need a camera photo of the payment confirmation screen
// before the confirm button unlocks — see isPaymentVerified() in
// api/treatments.js. Camera only, same as the wash proof: no file picker.
//
// proofOnly: the payment is already recorded (method fixed) and only the
// proof photo is missing — skips the method step.
// onConfirm({ paymentMethod, proofFile }) — proofFile is null for cash.
export function PaymentModal({ total, busy, error, proofOnly = false, initialMethod = 'cash', onConfirm, onCancel }) {
  const { t } = useLanguage()
  const [method, setMethod] = useState(initialMethod)
  const [proofFile, setProofFile] = useState(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const needsProof = proofOnly || paymentNeedsProof(method)

  // Preview of the shot; revoked when replaced or when the modal closes.
  const proofUrl = useMemo(() => (proofFile ? URL.createObjectURL(proofFile) : ''), [proofFile])
  useEffect(() => () => proofUrl && URL.revokeObjectURL(proofUrl), [proofUrl])

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && !busy && !cameraOpen) onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [busy, cameraOpen, onCancel])

  function openCamera() {
    if (!isCameraSupported()) {
      setCameraError('Kamera tidak tersedia di browser ini — buka aplikasi lewat https')
      return
    }
    setCameraError('')
    setCameraOpen(true)
  }

  function changeMethod(next) {
    setMethod(next)
    // A photo of a QRIS screen isn't proof of a transfer, and cash needs none.
    setProofFile(null)
  }

  const canConfirm = !busy && (!needsProof || proofFile)

  return (
    <div className="start-modal-overlay" onClick={busy ? undefined : onCancel}>
      <div
        className="start-modal payment-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="payment-modal-title" className="start-modal-title">
          {proofOnly ? t('Foto Bukti Pembayaran') : t('Verifikasi Pembayaran')}
        </h2>
        <div className="payment-modal-total">
          <span>{t('Total')}</span>
          <span>{formatRupiah(total)}</span>
        </div>

        {!proofOnly && (
          <>
            <p className="start-modal-hint">{t('Pilih metode pembayaran yang diterima.')}</p>
            <PaymentMethodSelector value={method} onChange={changeMethod} />
          </>
        )}

        {needsProof ? (
          <div className="payment-modal-proof">
            <p className="start-modal-hint">
              {method === 'transfer'
                ? t('Foto layar bukti pembayaran transfer dari pelanggan.')
                : t('Foto layar bukti pembayaran QRIS dari pelanggan.')}
            </p>
            {proofUrl && <img src={proofUrl} alt={t('Bukti pembayaran')} className="payment-modal-proof-img" />}
            <button type="button" className="btn-secondary" onClick={openCamera} disabled={busy}>
              📷 {proofFile ? t('Ulangi Foto') : t('Ambil Foto Bukti')}
            </button>
          </div>
        ) : (
          <p className="start-modal-hint">{t('Pastikan uang tunai sudah diterima sebelum konfirmasi.')}</p>
        )}

        {(cameraError || error) && <p className="form-error">{t(cameraError || error)}</p>}

        <div className="start-modal-actions">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            {t('Batal')}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onConfirm({ paymentMethod: method, proofFile: needsProof ? proofFile : null })}
            disabled={!canConfirm}
          >
            {busy ? t('Menyimpan...') : t('Konfirmasi')}
          </button>
        </div>
      </div>

      {cameraOpen && (
        <span onClick={(e) => e.stopPropagation()}>
          <CameraCapture
            onCapture={(file) => {
              setCameraOpen(false)
              setProofFile(file)
            }}
            onClose={() => setCameraOpen(false)}
          />
        </span>
      )}
    </div>
  )
}
