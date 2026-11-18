import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '../context/useLanguage'
import { startCameraStream, stopCameraStream, captureFrame, describeCameraError } from '../lib/camera'
import { Icon } from './Icon'

// Full-screen camera sheet: live preview -> shutter -> review the shot ->
// either keep it (onCapture receives a File) or retake. Camera only — there
// is no "pick a file" escape hatch, so wash proof is always a live photo. A
// camera failure shows its reason here and the sheet closes via onClose.
export function CameraCapture({ onCapture, onClose }) {
  const { t } = useLanguage()
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  // { file, url } — the object URL is created alongside the file and revoked
  // whenever it's replaced or the sheet goes away, so retaking repeatedly
  // doesn't leak one URL per shot.
  const [shot, setShot] = useState(null)
  const shotUrlRef = useRef('')
  const [busy, setBusy] = useState(false)

  function replaceShot(file) {
    if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current)
    shotUrlRef.current = file ? URL.createObjectURL(file) : ''
    setShot(file ? { file, url: shotUrlRef.current } : null)
  }

  useEffect(() => {
    let cancelled = false

    startCameraStream()
      .then((stream) => {
        // The sheet can be closed before the permission prompt resolves —
        // without this the stream stays live and the camera light stays on.
        if (cancelled) {
          stopCameraStream(stream)
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
        setReady(true)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Gagal membuka kamera:', err)
        setError(describeCameraError(err))
      })

    return () => {
      cancelled = true
      stopCameraStream(streamRef.current)
      streamRef.current = null
      if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current)
      shotUrlRef.current = ''
    }
  }, [])

  async function handleShutter() {
    setBusy(true)
    setError('')
    try {
      replaceShot(await captureFrame(videoRef.current))
    } catch (err) {
      setError(err.message || 'Gagal mengambil foto')
    } finally {
      setBusy(false)
    }
  }

  function handleUse() {
    stopCameraStream(streamRef.current)
    streamRef.current = null
    onCapture(shot.file)
  }

  return (
    <div className="camera-sheet" role="dialog" aria-modal="true" aria-label={t('Ambil foto')}>
      <div className="camera-stage">
        {shot ? (
          <img src={shot.url} alt={t('Hasil foto')} className="camera-preview" />
        ) : (
          <video ref={videoRef} className="camera-preview" autoPlay playsInline muted />
        )}
        {!ready && !error && !shot && <p className="camera-hint">{t('Membuka kamera...')}</p>}
      </div>

      {error && <p className="camera-error">{t(error)}</p>}

      <div className="camera-actions">
        <button type="button" className="btn-secondary" onClick={onClose}>
          {t('Batal')}
        </button>
        {shot ? (
          <>
            <button type="button" className="btn-secondary" onClick={() => replaceShot(null)}>
              <Icon name="refresh" size={18} />
              {t('Ulangi')}
            </button>
            <button type="button" className="btn-primary" onClick={handleUse}>
              <Icon name="check" size={18} />
              {t('Pakai Foto')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn-primary"
            onClick={handleShutter}
            disabled={!ready || busy}
          >
            <Icon name="photo_camera" size={18} />
            {t('Ambil Foto')}
          </button>
        )}
      </div>
    </div>
  )
}
