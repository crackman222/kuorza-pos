import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatRupiah } from '../lib/format'
import { getServicePrice, hasPromo, PRICE_MODES } from '../lib/servicePrice'
import { groupServicesByVehicleAndKind } from '../lib/serviceCategories'
import { useLanguage } from '../context/useLanguage'

// The full menu is ~50 cards, far too long to scroll on a phone, and a ticket
// is almost always one treatment on one kind of vehicle. So the picker shows
// just the sections — Cuci Motor, Poles Mobil, Coating Helm — and tapping one
// opens its cards in a popup. Lines already on the ticket stay there when the
// popup closes; each section tile shows how many came from it.
//
// priceMode decides which price the cards show — see getServicePrice.
export function ServicePicker({ services, selectedItems, onAdd, worker = false, priceMode = PRICE_MODES.PROMO }) {
  const { t } = useLanguage()
  const groups = groupServicesByVehicleAndKind(services)
  const [openKey, setOpenKey] = useState(null)

  if (services.length === 0) {
    return <p className="service-picker-empty">{t('Belum ada layanan aktif')}</p>
  }

  const openGroup = groups.find((g) => g.key === openKey) ?? null

  // Quantity on the ticket that came out of this section, for its tile badge.
  function selectedCount(group) {
    return selectedItems
      .filter((item) => group.services.some((s) => s.id === item.serviceId))
      .reduce((sum, item) => sum + item.quantity, 0)
  }

  return (
    <>
      <div className="service-menu-grid">
        {groups.map((group) => {
          const count = selectedCount(group)
          return (
            <button
              key={group.key}
              type="button"
              className={`service-menu-tile ${count > 0 ? 'has-selection' : ''}`}
              onClick={() => setOpenKey(group.key)}
            >
              <span className="service-menu-tile-label">{groupLabel(t, group)}</span>
              <span className="service-menu-tile-meta">
                {t('{count} layanan', { count: group.services.length })}
              </span>
              {count > 0 && <span className="service-category-count">{count}</span>}
            </button>
          )
        })}
      </div>

      {openGroup && (
        <ServiceMenuModal
          /* Keyed by section so the draft state is rebuilt, never carried
             over, if one section ever opens straight into another. */
          key={openGroup.key}
          group={openGroup}
          selectedItems={selectedItems}
          onAdd={onAdd}
          worker={worker}
          priceMode={priceMode}
          onClose={() => setOpenKey(null)}
        />
      )}
    </>
  )
}

// "Cuci Motor" in Indonesian, "Motorbike Wash" in English — the word order
// differs, so the label is assembled from its parts rather than translated
// whole. The flat "Lainnya" group has no parts.
function groupLabel(t, group) {
  if (!group.kindLabel) return t(group.label)
  return t('{kind} {vehicle}', { kind: t(group.kindLabel), vehicle: t(group.vehicleLabel) })
}

// A staging area, not a live editor: taps build up a local draft and only
// Selesai writes it to the ticket. Kembali — and tapping outside or pressing
// Escape, which are the same gesture — throws the draft away, so opening the
// wrong section and backing out of it leaves no trace. The draft starts from
// what this section already put on the ticket, so re-opening it shows those
// lines rather than looking empty, and backing out keeps them.
//
// It stays open across taps on purpose: a ticket often takes two sizes from
// the same section, and reopening the popup for each one is a tap wasted.
//
// Rendered through a portal into <body>, not in place. The wizard page it
// would otherwise sit inside keeps a transform after its slide-in animation
// (fill mode `both`), and a transformed ancestor becomes the containing block
// for position: fixed — so the overlay was being sized against that section
// instead of the viewport, which is what clipped it. From <body> it covers
// the whole screen, over the top bar, action bar and tab bar alike.
function ServiceMenuModal({ group, selectedItems, onAdd, worker, priceMode, onClose }) {
  const { t, tService } = useLanguage()
  const dialogRef = useRef(null)

  // Captured once, on open: what this section had on the ticket already.
  // Committing writes only the difference, so these lines aren't doubled.
  const [committed] = useState(() => {
    const counts = {}
    for (const item of selectedItems) {
      if (group.services.some((s) => s.id === item.serviceId)) {
        counts[item.serviceId] = item.quantity
      }
    }
    return counts
  })
  const [draft, setDraft] = useState(committed)

  function pick(service) {
    setDraft((current) => ({ ...current, [service.id]: (current[service.id] ?? 0) + 1 }))
  }

  // onAdd adds one unit per call, so each service goes out as many times as
  // the draft gained it.
  function confirm() {
    for (const service of group.services) {
      const added = (draft[service.id] ?? 0) - (committed[service.id] ?? 0)
      for (let i = 0; i < added; i += 1) onAdd(service)
    }
    onClose()
  }

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Nothing behind the popup scrolls while it's open — on a phone a stray
  // drag on the overlay would otherwise carry the page underneath with it.
  useEffect(() => {
    document.body.classList.add('service-menu-open')
    return () => document.body.classList.remove('service-menu-open')
  }, [])

  // Move focus into the popup so the keyboard and screen readers follow it
  // there, and hand focus back to whatever opened it on the way out.
  useEffect(() => {
    const previous = document.activeElement
    dialogRef.current?.focus()
    return () => {
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])

  const titleId = `service-menu-${group.key}`
  const pickedCount = Object.values(draft).reduce((sum, qty) => sum + qty, 0)

  return createPortal(
    <div
      className={`start-modal-overlay service-menu-overlay ${worker ? 'service-menu-overlay-worker' : ''}`}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="start-modal service-menu-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="start-modal-title">
          {groupLabel(t, group)}
        </h2>
        <p className="start-modal-hint">
          {t('Ketuk layanan untuk memilih, lalu tekan Selesai untuk menambah ke transaksi.')}
        </p>

        <div className="service-picker-grid service-menu-modal-grid">
          {group.services.map((service) => {
            const quantity = draft[service.id] ?? 0
            const showPromo = priceMode === PRICE_MODES.PROMO && hasPromo(service)
            return (
              <button
                key={service.id}
                type="button"
                className={`service-card ${quantity > 0 ? 'selected' : ''}`}
                onClick={() => pick(service)}
              >
                {quantity > 0 && <span className="service-card-qty">{quantity}</span>}
                <span className="service-card-name">{tService(service.name)}</span>
                <span className="service-card-price">
                  {formatRupiah(getServicePrice(service, priceMode))}
                  {showPromo && (
                    <span className="service-card-normal-price">{formatRupiah(service.price)}</span>
                  )}
                </span>
              </button>
            )
          })}
        </div>

        {/* Kembali discards the draft; Selesai only lights up once something
            is in it, so it can't read as a confirmation of nothing. */}
        <div className="start-modal-actions service-menu-modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('Kembali')}
          </button>
          <button type="button" className="btn-primary" onClick={confirm} disabled={pickedCount === 0}>
            {t('Selesai')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
