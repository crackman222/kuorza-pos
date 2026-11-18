import { supabase } from '../lib/supabase'
import { getDayRange } from '../lib/dateRange'

// Setoran Harian — the end-of-day cash reconciliation (migration 023).
//
// Income is never entered here: it is read from payments, the same source as
// Laporan. What is recorded is the money going out and what was counted.
// Channels are 'cash' and 'transfer'; 'transfer' stands for the whole
// non-cash side (QRIS and bank transfer land in the same account, which is how
// the paper sheet's "TF/QR" column treats them).
//
// Every write is a supervisor-gated database function and refuses a day that
// has been closed. The functions raise Indonesian messages ("Hari ini sudah
// ditutup"), which are passed through as written.

export const CASH_CHANNELS = { CASH: 'cash', TRANSFER: 'transfer' }

// Everything one day's reconciliation needs, as raw rows. The page does the
// arithmetic (see computeSetoran) so the screen and the closing snapshot use
// the same inputs the database does.
export async function getSetoranDay(date) {
  const { start, end } = getDayRange(date)

  const [dayResult, expensesResult, paymentsResult, loansResult] = await Promise.all([
    supabase.from('cash_days').select('*').eq('business_date', date).maybeSingle(),
    supabase.from('cash_expenses').select('*').eq('business_date', date).order('created_at'),
    supabase
      .from('payments')
      .select('payment_method, amount')
      .gte('paid_at', start.toISOString())
      .lt('paid_at', end.toISOString()),
    supabase
      .from('kasbon_entries')
      .select('id, profile_id, amount, note, channel')
      .eq('entry_date', date)
      .eq('type', 'pinjam')
      .order('created_at'),
  ])
  for (const result of [dayResult, expensesResult, paymentsResult, loansResult]) {
    if (result.error) throw result.error
  }

  return {
    day: dayResult.data, // null until opening cash is set or the day is closed
    expenses: expensesResult.data,
    payments: paymentsResult.data,
    loans: loansResult.data, // kasbon advances handed out that day
  }
}

// The sheet's "Total Setoran" block. Income by channel comes from payments;
// outflows are wages paid, other expenses and kasbon advances. Expected cash
// is what the till should hold: opening cash + cash income - cash outflows.
export function computeSetoran({ day, expenses, payments, loans }) {
  const sum = (rows) => rows.reduce((total, row) => total + Number(row.amount || 0), 0)

  const income = {
    cash: sum(payments.filter((p) => p.payment_method === 'cash')),
    qris: sum(payments.filter((p) => p.payment_method === 'qris')),
    transfer: sum(payments.filter((p) => p.payment_method === 'transfer')),
  }
  const noncashIncome = income.qris + income.transfer

  const cashOut = sum(expenses.filter((e) => e.channel === CASH_CHANNELS.CASH))
    + sum(loans.filter((l) => l.channel === CASH_CHANNELS.CASH))
  const noncashOut = sum(expenses.filter((e) => e.channel === CASH_CHANNELS.TRANSFER))
    + sum(loans.filter((l) => l.channel === CASH_CHANNELS.TRANSFER))

  const openingCash = Number(day?.opening_cash ?? 0)
  return {
    income,
    noncashIncome,
    openingCash,
    cashOut,
    noncashOut,
    expectedCash: openingCash + income.cash - cashOut,
    noncashBalance: noncashIncome - noncashOut,
    closed: Boolean(day?.closed_at),
  }
}

export async function setOpeningCash(date, amount) {
  const { error } = await supabase.rpc('set_opening_cash', { p_date: date, p_amount: amount })
  if (error) throw new Error(error.message || 'Gagal menyimpan modal awal')
}

// Other expenses ('operasional' | 'lain'); wages go through payWage.
export async function addCashExpense({ date, channel, category, amount, note }) {
  const { error } = await supabase.rpc('add_cash_expense', {
    p_date: date,
    p_channel: channel,
    p_category: category,
    p_amount: amount,
    p_note: note?.trim() || null,
  })
  if (error) throw new Error(error.message || 'Gagal menyimpan pengeluaran')
}

// Records what was actually paid to one person for the day, replacing an
// earlier payout for them.
export async function payWage({ profileId, date, amount, channel }) {
  const { error } = await supabase.rpc('pay_wage', {
    p_profile_id: profileId,
    p_date: date,
    p_amount: amount,
    p_channel: channel,
  })
  if (error) throw new Error(error.message || 'Gagal menyimpan pembayaran upah')
}

export async function deleteCashExpense(id) {
  const { error } = await supabase.rpc('delete_cash_expense', { p_id: id })
  if (error) throw new Error(error.message || 'Gagal menghapus pengeluaran')
}

// Locks the day. The database works out expected cash itself and stores it
// next to what was counted and the difference.
export async function closeCashDay(date, countedCash) {
  const { error } = await supabase.rpc('close_cash_day', { p_date: date, p_counted_cash: countedCash })
  if (error) throw new Error(error.message || 'Gagal menutup hari')
}

// Admin only.
export async function reopenCashDay(date) {
  const { error } = await supabase.rpc('reopen_cash_day', { p_date: date })
  if (error) throw new Error(error.message || 'Gagal membuka kembali hari')
}
