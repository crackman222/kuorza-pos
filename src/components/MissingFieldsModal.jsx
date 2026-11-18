import { useEffect, useRef } from 'react'
import { useLanguage } from '../context/useLanguage'
import { Icon } from './Icon'

// Shown when a form is submitted with required fields left empty. Lists every
// problem at once rather than one at a time, so staff fix them all in one
// pass. `issues` is an array of { key, label }; onClose runs when dismissed,
// which is where the caller moves focus to the first highlighted field.
export function MissingFieldsModal({ issues, onClose }) {
  const { t } = useLanguage()
  const buttonRef = useRef(null)

  useEffect(() => {
    buttonRef.current?.focus()
    function handleKeyDown(e) {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="start-modal-overlay" onClick={onClose}>
      <div
        className="start-modal missing-fields-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="missing-fields-title"
        aria-describedby="missing-fields-list"
        onClick={(e) => e.stopPropagation()}
      >
        <Icon name="error" className="missing-fields-icon" />
        <h2 id="missing-fields-title" className="start-modal-title">
          {t('Data belum lengkap')}
        </h2>
        <p className="start-modal-hint">
          {t('Lengkapi data berikut sebelum melanjutkan. Kolom yang perlu diisi ditandai merah.')}
        </p>
        <ul id="missing-fields-list" className="missing-fields-list">
          {issues.map((issue) => (
            <li key={issue.key}>{issue.label}</li>
          ))}
        </ul>
        <div className="start-modal-actions">
          <button ref={buttonRef} type="button" className="btn-primary" onClick={onClose}>
            {t('Oke, lengkapi')}
          </button>
        </div>
      </div>
    </div>
  )
}
