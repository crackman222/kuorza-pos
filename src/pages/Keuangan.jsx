import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getWageStaffRoster,
  getKasbonEntries,
  kasbonBalances,
  KASBON_TYPES,
  addKasbonEntry,
  getKasbonRepayPercent,
  setKasbonRepayPercent,
} from '../api'
import { formatRupiah } from '../lib/format'
import { todayDateInput } from '../lib/dateRange'
import { useLanguage } from '../context/useLanguage'
import SetoranHarian from './SetoranHarian'

const TABS = [
  { key: 'setoran', label: 'Setoran Harian' },
  { key: 'kasbon', label: 'Kasbon' },
]

// Supervisor/admin only (see SupervisorRoute in App.jsx). One menu for the
// shop's money records. Setoran Harian is the end-of-day cash reconciliation;
// Kasbon is the ledger — who owes what, new advances, and the history behind
// every balance. The kasbon repayment itself is decided on Kelola Upah while
// looking at that day's pay.
export default function Keuangan() {
  const { t } = useLanguage()
  const [error, setError] = useState('')
  const [tab, setTab] = useState('setoran')

  return (
    <div className="upah-screen">
      <h1>{t('Keuangan')}</h1>
      <div className="keuangan-tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`keuangan-tab ${tab === item.key ? 'active' : ''}`}
            onClick={() => {
              setError('')
              setTab(item.key)
            }}
          >
            {t(item.label)}
          </button>
        ))}
      </div>
      {error && <p className="form-error">{t(error)}</p>}
      {tab === 'setoran' && <SetoranHarian onError={setError} />}
      {tab === 'kasbon' && <KasbonSection onError={setError} />}
    </div>
  )
}

const TYPE_LABELS = {
  [KASBON_TYPES.OPENING]: 'Saldo Awal',
  [KASBON_TYPES.LOAN]: 'Pinjaman',
  [KASBON_TYPES.REPAYMENT]: 'Cicilan',
  [KASBON_TYPES.CORRECTION]: 'Koreksi',
}

// Opening balances and loans raise what is owed; repayments and corrections
// lower it.
function addsToBalance(type) {
  return type === KASBON_TYPES.OPENING || type === KASBON_TYPES.LOAN
}

function KasbonSection({ onError }) {
  const { t } = useLanguage()
  const [roster, setRoster] = useState([])
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)

  const reload = useCallback(() => {
    Promise.all([getWageStaffRoster(), getKasbonEntries()])
      .then(([people, rows]) => {
        setRoster(people)
        setEntries(rows)
      })
      .catch(() => onError('Gagal memuat kasbon'))
      .finally(() => setLoading(false))
  }, [onError])

  useEffect(() => {
    reload()
  }, [reload])

  const balances = useMemo(() => kasbonBalances(entries), [entries])
  const entriesByProfile = useMemo(() => {
    const map = new Map()
    for (const entry of entries) {
      if (!map.has(entry.profile_id)) map.set(entry.profile_id, [])
      map.get(entry.profile_id).push(entry)
    }
    return map
  }, [entries])
  const totalOwed = roster.reduce((sum, person) => sum + (balances.get(person.id) ?? 0), 0)

  return (
    <section className="staf-section">
      <div className="staf-section-header">
        <h2 className="transaksi-section-label">{t('Kasbon')}</h2>
        <RepayPercentSetting onError={onError} />
      </div>

      {loading && <p className="riwayat-loading">{t('Memuat...')}</p>}

      {!loading && (
        <>
          <div className="stat-cards upah-stat-cards">
            <div className="stat-card">
              <span className="stat-card-label">{t('Total Sisa Kasbon')}</span>
              <span className="stat-card-value stat-card-value-accent">{formatRupiah(totalOwed)}</span>
            </div>
          </div>

          {roster.length === 0 ? (
            <p className="riwayat-empty">{t('Belum ada staf aktif')}</p>
          ) : (
            <div className="riwayat-table kasbon-table">
              <div className="riwayat-table-row riwayat-table-head">
                <span>{t('Nama')}</span>
                <span>{t('Sisa Kasbon')}</span>
                <span></span>
              </div>
              {roster.map((person) => {
                const expanded = expandedId === person.id
                const personEntries = entriesByProfile.get(person.id) ?? []
                return (
                  <KasbonRow
                    key={person.id}
                    person={person}
                    balance={balances.get(person.id) ?? 0}
                    entries={personEntries}
                    expanded={expanded}
                    onToggle={() => setExpandedId((id) => (id === person.id ? null : person.id))}
                    onChanged={reload}
                    onError={onError}
                  />
                )
              })}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function KasbonRow({ person, balance, entries, expanded, onToggle, onChanged, onError }) {
  const { t } = useLanguage()
  // Newest first; entries arrive oldest first.
  const history = [...entries].reverse()

  return (
    <>
      <div className="riwayat-table-row">
        <span className="riwayat-plate">{person.full_name}</span>
        <span className={`riwayat-total ${balance > 0 ? '' : 'kasbon-clear'}`}>{formatRupiah(balance)}</span>
        <span className="staf-row-actions">
          <button type="button" className="btn-secondary" onClick={onToggle}>
            {expanded ? t('Tutup') : t('Detail')}
          </button>
        </span>
      </div>
      {expanded && (
        <div className="expand-wrap">
          <div className="expand-inner">
            <div className="upah-adjustments-panel">
              <AddKasbonForm
                profileId={person.id}
                hasEntries={entries.length > 0}
                balance={balance}
                onAdded={onChanged}
                onError={onError}
              />
              {history.length === 0 ? (
                <p className="upah-breakdown-empty">{t('Belum ada catatan kasbon')}</p>
              ) : (
                <ul className="upah-adjustments-list">
                  {history.map((entry) => (
                    <li key={entry.id} className="upah-adjustment-item">
                      <span className={`status-badge ${addsToBalance(entry.type) ? 'status-voided' : 'status-closed'}`}>
                        {t(TYPE_LABELS[entry.type])}
                      </span>
                      <span className="upah-adjustment-amount">
                        {addsToBalance(entry.type) ? '+' : '-'}
                        {formatRupiah(entry.amount)}
                      </span>
                      <span className="upah-adjustment-reason">
                        {entry.entry_date}
                        {entry.note ? ` · ${entry.note}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// New advance (pinjam), the opening balance copied from the paper book (once,
// before anything else), or a correction that reverses a mistaken entry —
// history is never edited or deleted, a mistake is fixed with a koreksi.
function AddKasbonForm({ profileId, hasEntries, balance, onAdded, onError }) {
  const { t } = useLanguage()
  const [type, setType] = useState(KASBON_TYPES.LOAN)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayDateInput())
  const [note, setNote] = useState('')
  // Where an advance is paid from — Setoran Harian counts it as an outflow of
  // that side, so it is only asked for on a new loan.
  const [channel, setChannel] = useState('cash')
  const [busy, setBusy] = useState(false)

  const needsNote = type === KASBON_TYPES.CORRECTION

  async function handleSubmit(e) {
    e.preventDefault()
    onError('')
    const value = Math.round(Number(amount))
    if (!Number.isFinite(value) || value <= 0) {
      onError('Jumlah harus lebih dari nol')
      return
    }
    if (type === KASBON_TYPES.CORRECTION && value > balance) {
      onError('Koreksi melebihi sisa kasbon')
      return
    }
    if (needsNote && !note.trim()) {
      onError('Alasan koreksi wajib diisi')
      return
    }
    setBusy(true)
    try {
      await addKasbonEntry({ profileId, date, type, amount: value, note, channel })
      setAmount('')
      setNote('')
      onAdded()
    } catch (err) {
      onError(err.message || 'Gagal menyimpan kasbon')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="upah-adjustment-form" onSubmit={handleSubmit}>
      <select value={type} onChange={(e) => setType(e.target.value)} disabled={busy} aria-label={t('Jenis')}>
        <option value={KASBON_TYPES.LOAN}>{t('Pinjaman baru')}</option>
        <option value={KASBON_TYPES.OPENING} disabled={hasEntries}>
          {t('Saldo awal')}
        </option>
        <option value={KASBON_TYPES.CORRECTION} disabled={balance <= 0}>
          {t('Koreksi')}
        </option>
      </select>
      {type === KASBON_TYPES.LOAN && (
        <select value={channel} onChange={(e) => setChannel(e.target.value)} disabled={busy} aria-label={t('Sumber dana')}>
          <option value="cash">{t('Tunai')}</option>
          <option value="transfer">{t('Transfer/QR')}</option>
        </select>
      )}
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
        type="date"
        value={date}
        max={todayDateInput()}
        onChange={(e) => setDate(e.target.value)}
        disabled={busy}
        aria-label={t('Tanggal')}
      />
      <input
        type="text"
        placeholder={needsNote ? t('Alasan koreksi') : t('Catatan (opsional)')}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={busy}
      />
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? t('Menyimpan...') : t('Tambah')}
      </button>
    </form>
  )
}

// The share of a day's service wages the pay screen suggests as repayment.
// A default, not a limit: Kelola Upah lets a supervisor go above it.
function RepayPercentSetting({ onError }) {
  const { t } = useLanguage()
  const [saved, setSaved] = useState(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getKasbonRepayPercent()
      .then((percent) => {
        setSaved(percent)
        setValue(String(percent))
      })
      .catch(() => onError('Gagal memuat persentase cicilan'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dirty = saved !== null && value !== '' && Math.round(Number(value)) !== saved

  async function handleSave() {
    const percent = Math.round(Number(value))
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      onError('Persentase harus antara 0 dan 100')
      return
    }
    setBusy(true)
    onError('')
    try {
      await setKasbonRepayPercent(percent)
      setSaved(percent)
      setValue(String(percent))
    } catch {
      onError('Gagal menyimpan persentase cicilan')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="kasbon-percent">
      <label>
        {t('Saran cicilan harian')}
        <span className="upah-rate-input">
          <input
            type="number"
            min="0"
            max="100"
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy || saved === null}
          />
          <span>%</span>
        </span>
      </label>
      <button type="button" className="btn-secondary" onClick={handleSave} disabled={busy || !dirty}>
        {busy ? t('Menyimpan...') : t('Simpan')}
      </button>
    </div>
  )
}
