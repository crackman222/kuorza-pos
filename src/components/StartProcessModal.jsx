import { useEffect, useState } from 'react'
import { MultiStaffPicker } from './MultiStaffPicker'
import { parseStaffNames } from '../lib/staffNames'

// Shown when a worker taps "Mulai Proses": a ticket can't start without
// saying who is washing it. Pre-filled with whoever is already assigned, so
// re-opening a ticket that had a crew picked doesn't make them start over.
// onConfirm receives the full array of wash staff names.
export function StartProcessModal({ treatment, busy, onConfirm, onCancel }) {
  const [names, setNames] = useState(() => parseStaffNames(treatment.wash_staff))

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [busy, onCancel])

  return (
    <div className="start-modal-overlay" onClick={busy ? undefined : onCancel}>
      <div
        className="start-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="start-modal-title" className="start-modal-title">
          Siapa yang mengerjakan?
        </h2>
        <p className="start-modal-hint">Pilih petugas cuci untuk antrian ini sebelum memulai proses.</p>
        <MultiStaffPicker value={names} onChange={setNames} disabled={busy} />
        <div className="start-modal-actions">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Batal
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onConfirm(names)}
            disabled={busy || names.length === 0}
          >
            {busy ? 'Memulai...' : 'Mulai Proses'}
          </button>
        </div>
      </div>
    </div>
  )
}
