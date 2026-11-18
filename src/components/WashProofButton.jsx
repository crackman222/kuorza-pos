import { useWashProofUpload } from './useWashProofUpload'
import { useLanguage } from '../context/useLanguage'
import { Icon } from './Icon'

export function WashProofButton({ treatmentId, hasPhoto, onUploaded, onError }) {
  const { t } = useLanguage()
  const { open, uploading, error, capture } = useWashProofUpload({ treatmentId, onUploaded, onError })

  return (
    <>
      <span
        className={`wash-proof-btn ${hasPhoto ? 'has-photo' : ''} ${error ? 'has-error' : ''}`}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          open()
        }}
        title={error ? t(error) : hasPhoto ? t('Ganti bukti foto') : t('Unggah bukti foto')}
        role="button"
        aria-label={hasPhoto ? t('Ganti bukti foto cuci') : t('Unggah bukti foto cuci')}
      >
        <Icon name={uploading ? 'progress_activity' : hasPhoto ? 'check' : 'photo_camera'} size={18} />
        {t('Foto')}
      </span>
      {capture}
    </>
  )
}
