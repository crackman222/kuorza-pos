import { useState } from 'react'
import { formatRupiah } from '../lib/format'
import { getServicePrice, hasPromo } from '../lib/servicePrice'
import { groupServicesByCategory } from '../lib/serviceCategories'

// One category (Motor / Mobil / Helm) at a time — the full menu is ~50 cards,
// and a ticket is almost always for one kind of vehicle. Lines already on the
// ticket stay there when switching tabs; the tab count shows how many came
// from each category.
export function ServicePicker({ services, selectedItems, onAdd }) {
  const groups = groupServicesByCategory(services)
  const [activeKey, setActiveKey] = useState(groups[0]?.key)

  if (services.length === 0) {
    return <p className="service-picker-empty">Belum ada layanan aktif</p>
  }

  const activeGroup = groups.find((g) => g.key === activeKey) ?? groups[0]

  return (
    <>
      {groups.length > 1 && (
        <div className="service-category-tabs" role="tablist" aria-label="Kategori layanan">
          {groups.map((group) => {
            const selectedCount = selectedItems
              .filter((item) => group.services.some((s) => s.id === item.serviceId))
              .reduce((sum, item) => sum + item.quantity, 0)
            return (
              <button
                key={group.key}
                type="button"
                role="tab"
                aria-selected={group.key === activeGroup.key}
                className={`service-category-tab ${group.key === activeGroup.key ? 'active' : ''}`}
                onClick={() => setActiveKey(group.key)}
              >
                {group.label}
                {selectedCount > 0 && <span className="service-category-tab-count">{selectedCount}</span>}
              </button>
            )
          })}
        </div>
      )}

      <div className="service-picker-grid">
        {activeGroup.services.map((service) => {
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
    </>
  )
}
