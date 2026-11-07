// Services are grouped by the first word of their name — the menu is named
// "Motor Basic Wash - S", "Mobil Coating - XL", "Helm Spa - Branded" (see
// migration 011). A service added in the Supabase dashboard joins a category
// just by following that naming; anything else lands in "Lainnya".
const CATEGORIES = [
  { key: 'motor', label: 'Motor' },
  { key: 'mobil', label: 'Mobil' },
  { key: 'helm', label: 'Helm' },
]

const OTHER = { key: 'lainnya', label: 'Lainnya' }

export function getServiceCategory(service) {
  const firstWord = (service.name || '').trim().split(/\s+/)[0].toLowerCase()
  return CATEGORIES.find((c) => c.key === firstWord) ?? OTHER
}

// [{ key, label, services }] in fixed menu order, empty categories dropped.
// Keeps the incoming order of services within each group (sort_order).
export function groupServicesByCategory(services) {
  const groups = [...CATEGORIES, OTHER].map((c) => ({ ...c, services: [] }))
  for (const service of services) {
    const { key } = getServiceCategory(service)
    groups.find((g) => g.key === key).services.push(service)
  }
  return groups.filter((g) => g.services.length > 0)
}
