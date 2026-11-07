import { useState } from 'react'
import { uploadWashProofPhoto } from '../api'
import { CameraCapture } from './CameraCapture'
import { isCameraSupported } from '../lib/camera'

// The capture-and-upload half of the wash proof, with no opinion about what
// the control looks like. Two very different controls need it: the small
// `WashProofButton` chip (desk table, Detail Treatment) and the worker queue
// card's one chunky button, which is the photo step and the status step at
// once. Only the trigger differs, so only the trigger is duplicated.
//
// Returns the handler plus `capture`, the camera sheet the caller has to
// render somewhere in its own tree.
//
// Camera only, by design: the proof has to be a photo taken on the spot, not
// something picked from the gallery. There is deliberately no file input —
// even with capture="environment", some Android browsers still offer the
// gallery from it.
export function useWashProofUpload({ treatmentId, onUploaded, onError }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)

  function fail(message) {
    setError(message)
    onError?.(message)
  }

  async function upload(file) {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      await uploadWashProofPhoto(treatmentId, file)
      onUploaded?.(treatmentId)
    } catch (err) {
      console.error('Upload bukti foto cuci gagal:', err)
      fail(err.message || 'Gagal mengunggah foto')
    } finally {
      setUploading(false)
    }
  }

  // getUserMedia only exists on a secure origin (https or localhost). Without
  // it there is no camera to offer, and no fallback either — say so.
  function open() {
    if (uploading) return
    if (!isCameraSupported()) {
      fail('Kamera tidak tersedia di browser ini — buka aplikasi lewat https')
      return
    }
    setError('')
    setCameraOpen(true)
  }

  const capture = cameraOpen && (
    // Stop clicks inside the sheet from reaching whatever sits underneath
    // — both the desk table row and the queue card navigate on click.
    <span onClick={(e) => e.stopPropagation()}>
      <CameraCapture
        onCapture={(file) => {
          setCameraOpen(false)
          upload(file)
        }}
        onClose={() => setCameraOpen(false)}
      />
    </span>
  )

  return { open, uploading, error, capture }
}
