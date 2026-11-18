import { translate as t, dateLocale } from './i18n'

// The shop's working day runs 07:00 to 04:00 the next morning, so a "day" in
// the reports is that shift, not a calendar day — a car washed at 01:00 is
// part of the previous evening's takings. The closed hours between 04:00 and
// 07:00 roll into the shift that opens next, so the boundary between one
// business day and the next is 04:00: business day D = [D 04:00, D+1 04:00).
// Every period (daily, weekly, monthly, yearly) and the wage day use it.
export const BUSINESS_DAY_START_HOUR = 7 // opening time, for labels only
export const BUSINESS_DAY_END_HOUR = 4 // on the following calendar day
const BOUNDARY_HOUR = BUSINESS_DAY_END_HOUR

// Midnight of the calendar date naming the business day `date` belongs to —
// before 04:00 that's still the previous date.
function businessDate(date = new Date()) {
  const d = new Date(date)
  if (d.getHours() < BOUNDARY_HOUR) d.setDate(d.getDate() - 1)
  d.setHours(0, 0, 0, 0)
  return d
}

// The 04:00 boundary on a given calendar date (y, m, d in local time).
function boundaryOn(year, month, day) {
  return new Date(year, month, day, BOUNDARY_HOUR, 0, 0, 0)
}

// Start (04:00) of the business day `date` belongs to.
export function businessDayStart(date = new Date()) {
  const d = businessDate(date)
  return boundaryOn(d.getFullYear(), d.getMonth(), d.getDate())
}

// [04:00, 04:00 next day) for the business day `date` belongs to.
export function getBusinessDayRange(date = new Date()) {
  const start = businessDayStart(date)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

// Calendar-aligned periods for reporting — weekly is Mon-Sun, not a trailing
// 7 days, so figures match how a bookkeeping report is normally read. All of
// them are made of whole business days, so each starts and ends at 04:00.
export function getPeriodRange(period) {
  const today = businessDate()
  const y = today.getFullYear()
  const m = today.getMonth()

  if (period === 'daily') {
    return getBusinessDayRange()
  }

  if (period === 'weekly') {
    const mondayOffset = (today.getDay() + 6) % 7
    const start = boundaryOn(y, m, today.getDate() - mondayOffset)
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    return { start, end }
  }

  if (period === 'monthly') {
    return { start: boundaryOn(y, m, 1), end: boundaryOn(y, m + 1, 1) }
  }

  if (period === 'yearly') {
    return { start: boundaryOn(y, 0, 1), end: boundaryOn(y + 1, 0, 1) }
  }

  throw new Error(`Unknown period: ${period}`)
}

// The business day named by a "YYYY-MM-DD" value, like a <input type="date">
// gives you — used by the wage management page's day picker. Parsed as local
// time (not UTC) so the boundary lands where the shop actually is.
export function getDayRange(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const start = boundaryOn(y, m - 1, d)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

// Today's business date as a "YYYY-MM-DD" string, for defaulting a date input
// (at 02:00 that's still yesterday's date). Not toISOString — that's UTC,
// which drifts a day off around midnight in Indonesia (UTC+7/+8/+9).
export function todayDateInput() {
  const now = businessDate()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// `dateStr` ("YYYY-MM-DD") only matters for 'daily': it labels that day
// instead of today.
export function formatPeriodLabel(period, dateStr) {
  const { start, end } = period === 'daily' && dateStr ? getDayRange(dateStr) : getPeriodRange(period)

  if (period === 'daily') {
    const hours = `${String(BUSINESS_DAY_START_HOUR).padStart(2, '0')}.00–${String(BUSINESS_DAY_END_HOUR).padStart(2, '0')}.00`
    return `${t('Harian')} - ${start.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long', year: 'numeric' })} `
  }

  if (period === 'weekly') {
    // end is 04:00 the next Monday, so step back a whole day to Sunday.
    const lastDay = new Date(end)
    lastDay.setDate(lastDay.getDate() - 1)
    const fmt = (d) => d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
    return `${t('Mingguan')} - ${t('{start} s/d {end}', { start: fmt(start), end: fmt(lastDay) })}`
  }

  if (period === 'monthly') {
    return `${t('Bulanan')} - ${start.toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' })}`
  }

  return `${t('Tahunan')} - ${start.getFullYear()}`
}
