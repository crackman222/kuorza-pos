import { supabase } from '../lib/supabase'
import { parseStaffNames } from '../lib/staffNames'
import { getDayRange } from '../lib/dateRange'
import { getKasbonEntries, getKasbonRepayPercent, kasbonBalances, KASBON_TYPES } from './kasbon'

// Wage management (supervisor/admin only — see SupervisorRoute and
// src/pages/KelolaUpah.jsx). Two things are stored by hand:
//   - service_wage_rates: a fixed rupiah amount per service (e.g. Cuci Motor
//     -> 7000), never a percentage and never per staff member
//   - wage_adjustments: one-off bonuses/deductions logged against a day,
//     also a flat rupiah amount
// Everything else — how much a worker actually earned on a given day — is
// computed here from treatments + treatment_items, never stored, so it can
// never drift out of sync with the tickets it's based on.

// Roster for the wage page: active staff only, same view StaffPicker uses.
// Not `profiles` directly — a supervisor (unlike an admin) has no RLS
// access to that table, only to this name-only view.
export async function getWageStaffRoster() {
  const { data, error } = await supabase.from('active_staff_names').select('id, full_name').order('full_name')
  if (error) throw error
  return data
}

export async function getServiceWageRates() {
  const { data, error } = await supabase.from('service_wage_rates').select('service_id, wage_amount')
  if (error) throw error
  return data
}

// Upsert: a service with no row yet reads as Rp0 until a supervisor sets one.
export async function setServiceWageRate(serviceId, wageAmount) {
  const { error } = await supabase.from('service_wage_rates').upsert({
    service_id: serviceId,
    wage_amount: wageAmount,
    updated_at: new Date().toISOString(),
  })
  if (error) throw error
}

export async function addWageAdjustment({ profileId, date, type, amount, reason }) {
  const { error } = await supabase.from('wage_adjustments').insert({
    profile_id: profileId,
    adjustment_date: date,
    type,
    amount,
    reason: reason?.trim() || null,
  })
  if (error) throw error
}

// Correcting a mistaken entry means deleting it and adding a new one — see
// the migration note on wage_adjustments (no update policy).
export async function deleteWageAdjustment(id) {
  const { error } = await supabase.from('wage_adjustments').delete().eq('id', id)
  if (error) throw error
}

// service_wage_rates is keyed by service_id (a live FK, so renaming a
// service in the Supabase dashboard doesn't orphan its wage), but
// treatment_items only ever carries a service_name snapshot — same
// convention as staff names below. So the two are joined here, once, into a
// name -> fixed wage map for the day's attribution pass.
async function getServiceWageByName() {
  const [servicesResult, ratesResult] = await Promise.all([
    supabase.from('services').select('id, name'),
    getServiceWageRates(),
  ])
  if (servicesResult.error) throw servicesResult.error

  const wageByServiceId = new Map(ratesResult.map((r) => [r.service_id, Number(r.wage_amount)]))
  return new Map(servicesResult.data.map((s) => [s.name, wageByServiceId.get(s.id) ?? 0]))
}

// Splits a whole-rupiah amount into `parts` integer shares that add back up
// to exactly `amount` — no float arithmetic. The leftover rupiah (at most
// parts - 1) go one each to the first shares, i.e. the first names listed.
function splitEvenly(amount, parts) {
  const base = Math.floor(amount / parts)
  const remainder = amount - base * parts
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0))
}

// What each vehicle's wash staff earned that day: every service line on the
// ticket (never shelf items) pays its own fixed wage times quantity. Keyed
// by staff *name*, the same way getWorkerOrderCounts() tallies wash counts:
// wash_staff is a comma-separated text snapshot, not a live FK. A shared
// wash splits each line's wage (and its sale value) evenly between the names
// listed, so the ticket pays out its wage once in total, not once per person.
async function getServiceEarningsByName(date) {
  const { start, end } = getDayRange(date)
  const [wageByName, treatmentsResult] = await Promise.all([
    getServiceWageByName(),
    supabase
      .from('treatments')
      .select('wash_staff, treatment_items(service_name, quantity, subtotal, shelf_item_id)')
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
      .neq('status', 'voided'),
  ])
  if (treatmentsResult.error) throw treatmentsResult.error

  // name -> { earnings, services: Map(serviceName -> { count, sharedCount,
  // nominal, wage }) }. count is every unit they worked on, shared or not;
  // sharedCount is how many of those were split with someone else. nominal
  // is their share of the sale value (what the customer paid for those
  // lines), wage their share of the fixed wage.
  const byName = new Map()
  for (const t of treatmentsResult.data) {
    const names = parseStaffNames(t.wash_staff)
    if (names.length === 0) continue
    const serviceLines = (t.treatment_items ?? []).filter((item) => item.shelf_item_id == null)
    if (serviceLines.length === 0) continue
    for (const name of names) {
      if (!byName.has(name)) byName.set(name, { earnings: 0, services: new Map() })
    }
    const shared = names.length > 1
    for (const item of serviceLines) {
      const wageShares = splitEvenly((wageByName.get(item.service_name) ?? 0) * item.quantity, names.length)
      const nominalShares = splitEvenly(Number(item.subtotal || 0), names.length)
      names.forEach((name, i) => {
        const entry = byName.get(name)
        const line = entry.services.get(item.service_name) ?? { count: 0, sharedCount: 0, nominal: 0, wage: 0 }
        line.count += item.quantity
        if (shared) line.sharedCount += item.quantity
        line.nominal += nominalShares[i]
        line.wage += wageShares[i]
        entry.earnings += wageShares[i]
        entry.services.set(item.service_name, line)
      })
    }
  }
  return { byName }
}

// Uang makan: the flat daily meal allowance paid to everyone marked present
// (migration 021). The rate lives in wage_settings; each attendance row keeps
// the amount it was marked with, so changing the rate never rewrites a past
// day. Both writes go through supervisor-gated functions, not direct inserts.
export async function getMealAllowance() {
  const { data, error } = await supabase
    .from('wage_settings')
    .select('value')
    .eq('key', 'meal_allowance')
    .maybeSingle()
  if (error) throw error
  return Number(data?.value ?? 0)
}

export async function setMealAllowance(amount) {
  const { error } = await supabase.rpc('set_meal_allowance', { p_amount: amount })
  if (error) throw new Error(error.message || 'Gagal menyimpan uang makan')
}

// Present writes the day's row at the current rate (a no-op if it exists);
// not present removes it. date is a "YYYY-MM-DD" string.
export async function setAttendance(profileId, date, present) {
  const { error } = await supabase.rpc('set_attendance', {
    p_profile_id: profileId,
    p_date: date,
    p_present: present,
  })
  if (error) throw new Error(error.message || 'Gagal menyimpan kehadiran')
}

// One row per active staff member for the given day: what the fixed-wage
// services they washed add up to, their uang makan if marked present, every
// bonus/deduction logged against that day, and the net wage. date is a
// "YYYY-MM-DD" string.
export async function getDailyWageSummary(date) {
  const [roster, { byName: washByName }, adjustmentsResult, attendanceResult, kasbonEntries, repayPercent] =
    await Promise.all([
      getWageStaffRoster(),
      getServiceEarningsByName(date),
      supabase.from('wage_adjustments').select('*').eq('adjustment_date', date).order('created_at'),
      supabase.from('attendance').select('profile_id, meal_allowance').eq('attendance_date', date),
      getKasbonEntries(),
      getKasbonRepayPercent(),
    ])
  if (adjustmentsResult.error) throw adjustmentsResult.error
  if (attendanceResult.error) throw attendanceResult.error

  const mealByProfile = new Map(attendanceResult.data.map((a) => [a.profile_id, Number(a.meal_allowance)]))
  const balanceByProfile = kasbonBalances(kasbonEntries)
  // The day's repayment out of wages, one per person (the database allows
  // only one 'bayar' per person per day).
  const repaymentByProfile = new Map(
    kasbonEntries
      .filter((e) => e.type === KASBON_TYPES.REPAYMENT && e.entry_date === date)
      .map((e) => [e.profile_id, e]),
  )

  const adjustmentsByProfile = new Map()
  for (const adj of adjustmentsResult.data) {
    if (!adjustmentsByProfile.has(adj.profile_id)) adjustmentsByProfile.set(adj.profile_id, [])
    adjustmentsByProfile.get(adj.profile_id).push(adj)
  }

  return roster.map((worker) => {
    const wash = washByName.get(worker.full_name)
    const serviceEarnings = wash?.earnings || 0
    const serviceBreakdown = [...(wash?.services ?? [])]
      .map(([serviceName, line]) => ({
        serviceName,
        count: line.count,
        sharedCount: line.sharedCount,
        nominal: line.nominal,
        wage: line.wage,
      }))
      .sort((a, b) => b.count - a.count || a.serviceName.localeCompare(b.serviceName))
    const adjustments = adjustmentsByProfile.get(worker.id) || []
    const bonusTotal = adjustments.filter((a) => a.type === 'bonus').reduce((sum, a) => sum + Number(a.amount), 0)
    const deductionTotal = adjustments
      .filter((a) => a.type === 'deduction')
      .reduce((sum, a) => sum + Number(a.amount), 0)

    const present = mealByProfile.has(worker.id)
    const mealAllowance = mealByProfile.get(worker.id) ?? 0
    const repayment = repaymentByProfile.get(worker.id)
    const kasbonRepayment = Number(repayment?.amount ?? 0)
    // What they owe right now, with this day's repayment counted as paid.
    const kasbonBalance = balanceByProfile.get(worker.id) ?? 0
    // The most that could be repaid today: what is owed if today's repayment
    // were not yet taken. The pay screen caps the input and the suggestion at
    // this; the database enforces the same limit.
    const kasbonAvailable = kasbonBalance + kasbonRepayment
    const kasbonSuggested = Math.min(Math.floor((serviceEarnings * repayPercent) / 100), kasbonAvailable)

    return {
      profileId: worker.id,
      fullName: worker.full_name,
      serviceEarnings,
      serviceBreakdown,
      present,
      mealAllowance,
      kasbonRepayment,
      kasbonRepaymentNote: repayment?.note ?? null,
      kasbonBalance,
      kasbonAvailable,
      kasbonSuggested,
      kasbonRepayPercent: repayPercent,
      adjustments,
      bonusTotal,
      deductionTotal,
      // Not clamped at zero — if deductions outweigh what was earned, the
      // deficit is real and the page should show it, not hide it.
      netWage: serviceEarnings + mealAllowance + bonusTotal - deductionTotal - kasbonRepayment,
    }
  })
}
