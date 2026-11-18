import { supabase } from '../lib/supabase'

// Kasbon: advances on pay (migration 022). The balance is never stored — it is
// the sum of kasbon_entries, so it is always computed here from the rows:
//   saldo_awal / pinjam add to it, bayar / koreksi take from it.
// All writes go through supervisor-gated database functions; the tables are
// read-only from the client. The functions raise Indonesian messages
// ("Cicilan melebihi sisa kasbon"), which are passed through as written.

export const KASBON_TYPES = {
  OPENING: 'saldo_awal',
  LOAN: 'pinjam',
  REPAYMENT: 'bayar',
  CORRECTION: 'koreksi',
}

export async function getKasbonEntries() {
  const { data, error } = await supabase
    .from('kasbon_entries')
    .select('id, profile_id, entry_date, type, amount, note, created_at')
    .order('entry_date')
    .order('created_at')
  if (error) throw error
  return data
}

// profile id -> what they currently owe.
export function kasbonBalances(entries) {
  const balances = new Map()
  for (const entry of entries) {
    const sign = entry.type === KASBON_TYPES.OPENING || entry.type === KASBON_TYPES.LOAN ? 1 : -1
    balances.set(entry.profile_id, (balances.get(entry.profile_id) ?? 0) + sign * Number(entry.amount))
  }
  return balances
}

// The share (0-100) of a day's service wages the pay screen suggests as the
// day's repayment. A default, not a limit — a supervisor can go above it.
export async function getKasbonRepayPercent() {
  const { data, error } = await supabase
    .from('wage_settings')
    .select('value')
    .eq('key', 'kasbon_repay_percent')
    .maybeSingle()
  if (error) throw error
  return Number(data?.value ?? 0)
}

export async function setKasbonRepayPercent(percent) {
  const { error } = await supabase.rpc('set_kasbon_repay_percent', { p_percent: percent })
  if (error) throw new Error(error.message || 'Gagal menyimpan persentase cicilan')
}

// type: saldo_awal (once per person), pinjam, or koreksi (needs a note).
// date is a "YYYY-MM-DD" string.
export async function addKasbonEntry({ profileId, date, type, amount, note }) {
  const { error } = await supabase.rpc('add_kasbon_entry', {
    p_profile_id: profileId,
    p_date: date,
    p_type: type,
    p_amount: amount,
    p_note: note?.trim() || null,
  })
  if (error) throw new Error(error.message || 'Gagal menyimpan kasbon')
}

// The day's repayment out of wages, replacing any earlier one for that person
// and day; 0 clears it. `override` means it is above the suggested share and
// `reason` explains why.
export async function setKasbonRepayment({ profileId, date, amount, override = false, reason = null }) {
  const { error } = await supabase.rpc('set_kasbon_repayment', {
    p_profile_id: profileId,
    p_date: date,
    p_amount: amount,
    p_override: override,
    p_reason: reason?.trim() || null,
  })
  if (error) throw new Error(error.message || 'Gagal menyimpan cicilan kasbon')
}
