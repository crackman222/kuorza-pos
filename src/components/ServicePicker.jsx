import { useState } from 'react'
import { formatRupiah } from '../lib/format'
import { getServicePrice, hasPromo } from '../lib/servicePrice'
import { groupServicesByCategory } from '../lib/serviceCategories'

// One collapsible section per category (Motor / Mobil / Helm). The full menu
// is ~50 cards, far too long to scroll on a phone, and a ticket is almost
// always for one kind of vehicle — so only one section is open at a time.
// Lines already on the ticket stay there when a section closes; its header
// shows how many came from it.
export function ServicePicker({ services, selectedItems, onAdd }) {
  const groups = groupServicesByCategory(services)
  // undefined = nothing chosen yet, so the first category starts open;
  // null = the user closed everything.
  const [openKey, setOpenKey] = useState(undefined)

  if (services.length === 0) {
    return <p className="service-picker-empty">Belum ada layanan aktif</p>
  }

  const currentKey = openKey === undefined ? groups[0]?.key : openKey

  return (
    <div className="service-category-list">
      {groups.map((group) => {
        const isOpen = group.key === currentKey
        const selectedCount = selectedItems
          .filter((item) => group.services.some((s) => s.id === item.serviceId))
          .reduce((sum, item) => sum + item.quantity, 0)
        const panelId = `service-category-${group.key}`

        return (
          <div key={group.key} className={`service-category ${isOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="service-category-header"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpenKey(isOpen ? null : group.key)}
            >
              <span className="service-category-label">{group.label}</span>
              <span className="service-category-meta">{group.services.length} layanan</span>
              {selectedCount > 0 && <span className="service-category-count">{selectedCount}</span>}
              <span className="service-category-chevron" aria-hidden="true" />
            </button>

            {isOpen && (
              <div id={panelId} className="service-picker-grid service-category-panel">
                {group.services.map((service) => {
                  const selected = selectedItems.find((item) => item.serviceId === service.id)
                  return (
                    <button
                      key={service.id}
                      type="button"
                      className={`service-card ${selected ? 'selected' : ''}`}
                      onClick={() => onAdd(service)}
                    >
                      {selected && <span className="service-card-qty">{selected.quantity}</span>}
                      <span className="service-card-name">{service.name}</span>
                      <span className="service-card-price">
                        {formatRupiah(getServicePrice(service))}
                        {hasPromo(service) && (
                          <span className="service-card-normal-price">{formatRupiah(service.price)}</span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
