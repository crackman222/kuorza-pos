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

// The treatment kind, read out of the rest of the name: "Motor Premium Wash
// - L" is a wash, "Mobil Full Polish - S" a polish. Helm Spa is a deep wash
// and Motor Ojek Online a wash package, so both count as Cuci. Checked
// coating-first because no name carries two of these words.
const KINDS = [
  { key: 'cuci', label: 'Cuci', test: /wash|cuci|spa|ojek/i },
  { key: 'poles', label: 'Poles', test: /polish|poles/i },
  { key: 'coating', label: 'Coating', test: /coating/i },
]

const OTHER_KIND = { key: 'lain', label: 'Lainnya' }

export function getServiceKind(service) {
  const name = service.name || ''
  return KINDS.find((k) => k.test.test(name)) ?? OTHER_KIND
}

// [{ key, label, services }] split both ways — "Cuci Motor", "Poles Motor",
// "Coating Motor", then the same for Mobil and Helm. The ticket picker uses
// this rather than the vehicle-only grouping above: a worker is choosing one
// treatment, and a single Motor section meant scrolling past every wash tier
// to reach coating. Empty combinations are dropped; order within a group is
// the incoming order (sort_order).
//
// Anything with no recognised vehicle goes into one flat "Lainnya" group,
// kind and all: that bucket is the handful of pre-migration-011 generic rows
// (Cuci Motor, Poles Body, Coating Kaca), and splitting three leftovers into
// three sections of one is noise.
export function groupServicesByVehicleAndKind(services) {
  const groups = []
  for (const vehicle of CATEGORIES) {
    for (const kind of [...KINDS, OTHER_KIND]) {
      groups.push({
        key: `${vehicle.key}-${kind.key}`,
        label: `${kind.label} ${vehicle.label}`,
        // The parts, so the UI can reorder them for English.
        kindLabel: kind.label,
        vehicleLabel: vehicle.label,
        services: [],
      })
    }
  }
  groups.push({ ...OTHER, services: [] })

  for (const service of services) {
    const vehicle = getServiceCategory(service)
    const key = vehicle.key === OTHER.key ? OTHER.key : `${vehicle.key}-${getServiceKind(service).key}`
    groups.find((g) => g.key === key).services.push(service)
  }
  return groups.filter((g) => g.services.length > 0)
}
