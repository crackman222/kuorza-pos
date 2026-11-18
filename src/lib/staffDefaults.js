// Who a new ticket's QC is pre-filled with on Transaksi Baru. Staff can still
// pick someone else (or nobody) before saving — this is only the starting
// value. "Mr. Washee Washee" is a placeholder roster entry standing in until
// the real QC person (Dian) is on the roster — swap the name here then.
export const DEFAULT_QC_STAFF_NAME = 'Mr. Washee Washee'

// Resolve the default against the live roster rather than writing the
// constant blindly: qc_staff is a full_name snapshot, so it has to match a
// real active person exactly. Matches the full name first, then the first
// word (e.g. "Dian" → "Dian Lestari"). Returns null when nobody matches — e.g. the
// person was deactivated — so the picker reads "Belum ditentukan" instead of
// silently saving a name that isn't on the roster.
export function findDefaultQcStaff(workers) {
  const target = DEFAULT_QC_STAFF_NAME.trim().toLowerCase()
  if (!target) return null
  const names = (workers ?? []).map((w) => w.full_name).filter(Boolean)
  const exact = names.find((name) => name.trim().toLowerCase() === target)
  if (exact) return exact
  return names.find((name) => name.trim().split(/\s+/)[0].toLowerCase() === target) ?? null
}
