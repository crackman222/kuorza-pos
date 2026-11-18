import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getDailyWageSummary,
  getSetoranDay,
  computeSetoran,
  setOpeningCash,
  addCashExpense,
  payWage,
  deleteCashExpense,
  closeCashDay,
  reopenCashDay,
  CASH_CHANNELS,
} from '../api'
import { formatRupiah } from '../lib/format'
import { todayDateInput } from '../lib/dateRange'
import { useAuth } from '../context/useAuth'
import { isAdmin as checkIsAdmin } from '../lib/roles'
import { useLanguage } from '../context/useLanguage'
import { dateLocale } from '../lib/i18n'

const CHANNEL_LABELS = {
  [CASH_CHANNELS.CASH]: 'Tunai',
  [CASH_CHANNELS.TRANSFER]: 'Transfer/QR',
}

const CATEGORY_LABELS = { operasional: 'Operasional', lain: 'Lain-lain' }

// The end-of-day reconciliation (the "Total Setoran" block on the paper
// sheet). Income is read from payments — the same numbers as Laporan Harian —
// and is never typed in. What is entered here is the money going out: wages
// paid, other expenses, and kasbon advances (those come from the Kasbon
// ledger). Closing the day locks it; only an admin can reopen it.
export default function SetoranHarian({ onError }) {
  const { t } = useLanguage()
  const { profile } = useAuth()
  const isAdmin = checkIsAdmin(profile)
  const [date, setDate] = useState(todayDateInput())
  const [data, setData] = useState(null)
  const [wages, setWages] = useState([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    Promise.all([getSetoranDay(date), getDailyWageSummary(date)])
      .then(([dayData, wageRows]) => {
        setData(dayData)
        setWages(wageRows)
      })
      .catch(() => onError('Gagal memuat setoran harian'))
      .finally(() => setLoading(false))
  }, [date, onError])

  useEffect(() => {
    reload()
  }, [reload])

  const summary = useMemo(() => (data ? computeSetoran(data) : null), [data])
  const nameById = useMemo(() => new Map(wages.map((w) => [w.profileId, w.fullName])), [wages])

  return (
    <section className="staf-section">
      <div className="staf-section-header">
        <h2 className="transaksi-section-label">{t('Setoran Harian')}</h2>
        <input
          type="date"
          value={date}
          max={todayDateInput()}
          onChange={(e) => {
            setLoading(true)
            setDate(e.target.value || todayDateInput())
          }}
          aria-label={t('Tanggal')}
        />
      </div>

      {loading && <p className="riwayat-loading">{t('Memuat...')}</p>}

      {!loading && data && summary && (
        <>
          <p className="staf-section-note">
            {summary.closed
              ? t('Hari ini sudah ditutup — tidak ada yang bisa diubah.')
              : t('Pemasukan diambil dari pembayaran yang tercatat, sama dengan Laporan Harian.')}
          </p>

          <IncomeBlock summary={summary} />
          <OpeningCashBlock
            key={`${date}:${summary.openingCash}`}
            date={date}
            value={summary.openingCash}
            locked={summary.closed}
            onSaved={reload}
            onError={onError}
          />
          <WagePayoutBlock
            date={date}
            wages={wages}
            expenses={data.expenses}
            locked={summary.closed}
            onChanged={reload}
            onError={onError}
          />
          <ExpensesBlock
            date={date}
            expenses={data.expenses}
            loans={data.loans}
            nameById={nameById}
            locked={summary.closed}
            onChanged={reload}
            onError={onError}
          />
          <RecapBlock
            date={date}
            day={data.day}
            summary={summary}
            isAdmin={isAdmin}
            onChanged={reload}
            onError={onError}
          />
        </>
      )}
    </section>
  )
}

function IncomeBlock({ summary }) {
  const { t } = useLanguage()
  const total = summary.income.cash + summary.noncashIncome
  return (
    <div className="setoran-block">
      <h3 className="setoran-block-title">{t('Pemasukan')}</h3>
      <div className="setoran-lines">
        <div><span>{t('Tunai')}</span><span>{formatRupiah(summary.income.cash)}</span></div>
        <div><span>QRIS</span><span>{formatRupiah(summary.income.qris)}</span></div>
        <div><span>Transfer</span><span>{formatRupiah(summary.income.transfer)}</span></div>
        <div className="setoran-line-total">
          <span>{t('Total Uang Masuk')}</span>
          <span>{formatRupiah(total)}</span>
        </div>
      </div>
    </div>
  )
}

function OpeningCashBlock({ date, value, locked, onSaved, onError }) {
  const { t } = useLanguage()
  // Keyed on the saved value by the parent's reload, so a fresh load resets it.
  const [input, setInput] = useState(String(value))
  const [busy, setBusy] = useState(false)
  const dirty = input !== '' && Math.round(Number(input)) !== value

  async function handleSave() {
    const amount = Math.round(Number(input))
    if (!Number.isFinite(amount) || amount < 0) {
      onError('Modal awal harus berupa angka Rupiah, minimal 0')
      return
    }
    setBusy(true)
    onError('')
    try {
      await setOpeningCash(date, amount)
      onSaved()
    } catch (err) {
      onError(err.message || 'Gagal menyimpan modal awal')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="setoran-block">
      <h3 className="setoran-block-title">{t('Modal Awal Kas')}</h3>
      <div className="upah-meal-row">
        <span className="upah-rate-input">
          <span>Rp</span>
          <input
            type="number"
            min="0"
            step="500"
            inputMode="numeric"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy || locked}
            aria-label={t('Modal awal kas')}
          />
        </span>
        {!locked && (
          <button type="button" className="btn-secondary" onClick={handleSave} disabled={busy || !dirty}>
            {busy ? t('Menyimpan...') : t('Simpan')}
          </button>
        )}
      </div>
    </div>
  )
}

// What each person is owed for the day (net wage from Kelola Upah) and
// whether it has been paid, and from which side. Paying records the net wage
// as it is right now; if the wage changes afterwards the row says so and
// paying again replaces the earlier payout.
function WagePayoutBlock({ date, wages, expenses, locked, onChanged, onError }) {
  const { t } = useLanguage()
  const [busyId, setBusyId] = useState(null)
  const payouts = new Map(expenses.filter((e) => e.category === 'gaji').map((e) => [e.profile_id, e]))
  // Anyone with something to pay, plus anyone already paid.
  const rows = wages.filter((w) => w.netWage > 0 || payouts.has(w.profileId))

  async function pay(row, channel) {
    setBusyId(row.profileId)
    onError('')
    try {
      await payWage({ profileId: row.profileId, date, amount: row.netWage, channel })
      onChanged()
    } catch (err) {
      onError(err.message || 'Gagal menyimpan pembayaran upah')
    } finally {
      setBusyId(null)
    }
  }

  async function unpay(payout) {
    setBusyId(payout.profile_id)
    onError('')
    try {
      await deleteCashExpense(payout.id)
      onChanged()
    } catch (err) {
      onError(err.message || 'Gagal menghapus pengeluaran')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="setoran-block">
      <h3 className="setoran-block-title">{t('Pembayaran Upah')}</h3>
      {rows.length === 0 ? (
        <p className="riwayat-empty">{t('Belum ada upah yang perlu dibayar pada tanggal ini')}</p>
      ) : (
        <div className="riwayat-table setoran-wage-table">
          <div className="riwayat-table-row riwayat-table-head">
            <span>{t('Nama')}</span>
            <span>{t('Nominal')}</span>
            <span>{t('Status')}</span>
            <span></span>
          </div>
          {rows.map((row) => {
            const payout = payouts.get(row.profileId)
            const changed = payout && Number(payout.amount) !== row.netWage
            const busy = busyId === row.profileId
            return (
              <div key={row.profileId} className="riwayat-table-row">
                <span className="riwayat-plate">{row.fullName}</span>
                <span className="riwayat-total">{formatRupiah(row.netWage)}</span>
                <span>
                  {!payout && <span className="status-badge status-voided">{t('Belum dibayar')}</span>}
                  {payout && (
                    <span className="status-badge status-closed">
                      {t('Dibayar')} {formatRupiah(payout.amount)} · {t(CHANNEL_LABELS[payout.channel])}
                    </span>
                  )}
                  {changed && (
                    <span className="setoran-warning">
                      {t('Upah berubah menjadi {amount}', { amount: formatRupiah(row.netWage) })}
                    </span>
                  )}
                </span>
                <span className="staf-row-actions">
                  {!locked && (
                    <>
                      {(!payout || changed || payout.channel !== CASH_CHANNELS.CASH) && (
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={busy || row.netWage <= 0}
                          onClick={() => pay(row, CASH_CHANNELS.CASH)}
                        >
                          {t('Bayar Tunai')}
                        </button>
                      )}
                      {(!payout || changed || payout.channel !== CASH_CHANNELS.TRANSFER) && (
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={busy || row.netWage <= 0}
                          onClick={() => pay(row, CASH_CHANNELS.TRANSFER)}
                        >
                          {t('Bayar Transfer')}
                        </button>
                      )}
                      {payout && (
                        <button type="button" className="btn-secondary" disabled={busy} onClick={() => unpay(payout)}>
                          {t('Batal')}
                        </button>
                      )}
                    </>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Everything paid out apart from wages: shop expenses entered here, and the
// kasbon advances handed out that day (read-only — they live in the Kasbon
// ledger, where they are recorded once and counted here).
function ExpensesBlock({ date, expenses, loans, nameById, locked, onChanged, onError }) {
  const { t } = useLanguage()
  const other = expenses.filter((e) => e.category !== 'gaji')
  const [category, setCategory] = useState('operasional')
  const [channel, setChannel] = useState(CASH_CHANNELS.CASH)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleAdd(e) {
    e.preventDefault()
    onError('')
    const value = Math.round(Number(amount))
    if (!Number.isFinite(value) || value <= 0) {
      onError('Jumlah harus lebih dari nol')
      return
    }
    if (!note.trim()) {
      onError('Keterangan pengeluaran wajib diisi')
      return
    }
    setBusy(true)
    try {
      await addCashExpense({ date, channel, category, amount: value, note })
      setAmount('')
      setNote('')
      onChanged()
    } catch (err) {
      onError(err.message || 'Gagal menyimpan pengeluaran')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id) {
    setBusy(true)
    onError('')
    try {
      await deleteCashExpense(id)
      onChanged()
    } catch (err) {
      onError(err.message || 'Gagal menghapus pengeluaran')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="setoran-block">
      <h3 className="setoran-block-title">{t('Pengeluaran Lain')}</h3>
      {other.length === 0 && loans.length === 0 ? (
        <p className="riwayat-empty">{t('Belum ada pengeluaran')}</p>
      ) : (
        <div className="riwayat-table setoran-expense-table">
          <div className="riwayat-table-row riwayat-table-head">
            <span>{t('Kategori')}</span>
            <span>{t('Nominal')}</span>
            <span>{t('Keterangan')}</span>
            <span>{t('Sumber dana')}</span>
            <span></span>
          </div>
          {loans.map((loan) => (
            <div key={`loan-${loan.id}`} className="riwayat-table-row">
              <span>
                <span className="status-badge status-voided">{t('Kasbon')}</span>
              </span>
              <span className="riwayat-total">{formatRupiah(loan.amount)}</span>
              <span>{nameById.get(loan.profile_id) ?? '-'}</span>
              <span>{t(CHANNEL_LABELS[loan.channel])}</span>
              <span></span>
            </div>
          ))}
          {other.map((expense) => (
            <div key={expense.id} className="riwayat-table-row">
              <span>
                <span className="status-badge status-voided">{t(CATEGORY_LABELS[expense.category])}</span>
              </span>
              <span className="riwayat-total">{formatRupiah(expense.amount)}</span>
              <span>{expense.note}</span>
              <span>{t(CHANNEL_LABELS[expense.channel])}</span>
              <span className="staf-row-actions">
                {!locked && (
                  <button type="button" className="btn-secondary" disabled={busy} onClick={() => handleDelete(expense.id)}>
                    {t('Hapus')}
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {!locked && (
        <form className="upah-adjustment-form" onSubmit={handleAdd}>
          <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy} aria-label={t('Kategori')}>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
          <select value={channel} onChange={(e) => setChannel(e.target.value)} disabled={busy} aria-label={t('Sumber dana')}>
            {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="0"
            inputMode="numeric"
            placeholder={t('Jumlah (Rp)')}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy}
          />
          <input
            type="text"
            placeholder={t('Keterangan')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
          />
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? t('Menyimpan...') : t('Tambah')}
          </button>
        </form>
      )}
    </div>
  )
}

// The "Total Setoran" block: what the till should hold, what was counted, and
// the difference — then closing the day.
function RecapBlock({ date, day, summary, isAdmin, onChanged, onError }) {
  const { t } = useLanguage()
  const [counted, setCounted] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const closed = summary.closed
  // Once closed, the stored snapshot is the record; live numbers can still
  // move (a late payment), the snapshot never does.
  const expected = closed ? Number(day.expected_cash) : summary.expectedCash
  const countedValue = closed ? Number(day.counted_cash) : Math.round(Number(counted))
  const difference = closed ? Number(day.difference) : countedValue - expected
  const hasCounted = closed || counted !== ''

  async function handleClose() {
    if (!Number.isFinite(countedValue) || countedValue < 0) {
      onError('Uang tunai terhitung harus berupa angka Rupiah, minimal 0')
      return
    }
    setBusy(true)
    onError('')
    try {
      await closeCashDay(date, countedValue)
      setConfirming(false)
      onChanged()
    } catch (err) {
      onError(err.message || 'Gagal menutup hari')
    } finally {
      setBusy(false)
    }
  }

  async function handleReopen() {
    setBusy(true)
    onError('')
    try {
      await reopenCashDay(date)
      onChanged()
    } catch (err) {
      onError(err.message || 'Gagal membuka kembali hari')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="setoran-block setoran-recap">
      <h3 className="setoran-block-title">{t('Total Setoran')}</h3>
      <div className="setoran-recap-grid">
        <div className="setoran-lines">
          <div className="setoran-lines-title">{t('Tunai')}</div>
          <div><span>{t('Modal awal')}</span><span>{formatRupiah(summary.openingCash)}</span></div>
          <div><span>{t('Pemasukan tunai')}</span><span>{formatRupiah(summary.income.cash)}</span></div>
          <div><span>{t('Pengeluaran tunai')}</span><span>-{formatRupiah(summary.cashOut)}</span></div>
          <div className="setoran-line-total">
            <span>{t('Sisa')}</span>
            <span>{formatRupiah(expected)}</span>
          </div>
        </div>
        <div className="setoran-lines">
          <div className="setoran-lines-title">{t('Transfer/QR')}</div>
          <div><span>{t('Pemasukan')}</span><span>{formatRupiah(summary.noncashIncome)}</span></div>
          <div><span>{t('Pengeluaran')}</span><span>-{formatRupiah(summary.noncashOut)}</span></div>
          <div className="setoran-line-total">
            <span>{t('Sisa')}</span>
            <span>{formatRupiah(summary.noncashBalance)}</span>
          </div>
        </div>
      </div>

      <div className="setoran-count">
        {closed ? (
          <div className="setoran-lines">
            <div><span>{t('Uang tunai terhitung')}</span><span>{formatRupiah(countedValue)}</span></div>
          </div>
        ) : (
          <label className="setoran-count-input">
            {t('Uang tunai terhitung')}
            <span className="upah-rate-input">
              <span>Rp</span>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={counted}
                onChange={(e) => {
                  setCounted(e.target.value)
                  setConfirming(false)
                }}
                disabled={busy}
              />
            </span>
          </label>
        )}

        {hasCounted && (
          <div className={`setoran-difference ${difference === 0 ? 'ok' : 'off'}`}>
            {t('Selisih')}: {difference > 0 ? '+' : ''}
            {formatRupiah(difference)}
            {difference === 0 && ` · ${t('Cocok')}`}
          </div>
        )}
      </div>

      {closed ? (
        <div className="setoran-closed">
          <span className="status-badge status-closed">
            {t('Ditutup')} ·{' '}
            {new Date(day.closed_at).toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
          {isAdmin && (
            <button type="button" className="btn-secondary" onClick={handleReopen} disabled={busy}>
              {t('Buka Kembali')}
            </button>
          )}
        </div>
      ) : (
        <div className="setoran-actions">
          {!confirming ? (
            <button
              type="button"
              className="btn-primary"
              disabled={busy || counted === ''}
              onClick={() => setConfirming(true)}
            >
              {t('Tutup Hari')}
            </button>
          ) : (
            <>
              <span className="setoran-warning">
                {t('Setelah ditutup, kehadiran, upah, kasbon, dan pengeluaran tanggal ini tidak bisa diubah.')}
              </span>
              <button type="button" className="btn-primary" disabled={busy} onClick={handleClose}>
                {busy ? t('Menyimpan...') : t('Ya, Tutup Hari')}
              </button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>
                {t('Batal')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
