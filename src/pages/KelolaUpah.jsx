import { useCallback, useEffect, useState } from 'react'
import {
  getActiveServices,
  getServiceWageRates,
  setServiceWageRate,
  getDailyWageSummary,
  addWageAdjustment,
  deleteWageAdjustment,
  getMealAllowance,
  setMealAllowance,
  setAttendance,
  setKasbonRepayment,
} from '../api'
import { formatRupiah } from '../lib/format'
import { todayDateInput } from '../lib/dateRange'
import { groupServicesByCategory } from '../lib/serviceCategories'
import { useLanguage } from '../context/useLanguage'

// Supervisor/admin only (see SupervisorRoute in App.jsx). Two things:
//   - Upah per Layanan: a fixed rupiah amount each service pays out (e.g.
//     Cuci Motor -> Rp7.000), never a percentage and never per staff member
//   - Upah Harian: what that turns into today (or any past day) once
//     multiplied out against tickets, plus one-off bonuses/deductions a
//     supervisor logs by hand — also flat rupiah, never a percentage
// The commission itself is never stored — see getDailyWageSummary in
// src/api/wages.js for how it's computed from today's tickets.
export default function KelolaUpah() {
  const { t } = useLanguage()
  const [services, setServices] = useState([])
  const [rates, setRates] = useState([])
  const [ratesLoading, setRatesLoading] = useState(true)
  const [error, setError] = useState('')
  // Bumped whenever a service's wage changes, so the daily earnings table
  // (computed from these rates but not the thing that changed) refetches
  // even without its own date changing.
  const [ratesVersion, setRatesVersion] = useState(0)

  useEffect(() => {
    Promise.all([getActiveServices(), getServiceWageRates()])
      .then(([s, r]) => {
        setServices(s)
        setRates(r)
      })
      .catch(() => setError('Gagal memuat layanan'))
      .finally(() => setRatesLoading(false))
  }, [])

  function reloadRates() {
    setError('')
    Promise.all([getActiveServices(), getServiceWageRates()])
      .then(([s, r]) => {
        setServices(s)
        setRates(r)
      })
      .catch(() => setError('Gagal memuat layanan'))
      .finally(() => setRatesLoading(false))
  }

  function handleRateChanged() {
    reloadRates()
    setRatesVersion((v) => v + 1)
  }

  return (
    <div className="upah-screen">
      <h1>{t('Kelola Upah')}</h1>
      {error && <p className="form-error">{t(error)}</p>}

      {/* The two settings are set rarely, so they sit as compact cards above
          the daily table, which is what's actually checked every day. */}
      <div className="upah-settings">
        <ServiceWageSection
          services={services}
          rates={rates}
          loading={ratesLoading}
          onChanged={handleRateChanged}
          onError={setError}
        />
        <MealAllowanceSection onError={setError} />
      </div>
      <DailyWageSection ratesVersion={ratesVersion} onError={setError} />
    </div>
  )
}

// Fixed wage per service: what a staff member earns for performing it once,
// regardless of the service's list price. Applies to whoever's listed as
// wash staff on the ticket, same as elsewhere in the app.
function ServiceWageSection({ services, rates, loading, onChanged, onError }) {
  const { t } = useLanguage()
  const wageByService = new Map(rates.map((r) => [r.service_id, Number(r.wage_amount)]))
  const groups = groupServicesByCategory(services)
  // The whole section starts collapsed to one card; opening it expands in
  // place. Inside, every category starts closed. Several can be open at once,
  // and they stay open across saves — this component isn't remounted when
  // rates reload.
  const [sectionOpen, setSectionOpen] = useState(false)
  const [openKeys, setOpenKeys] = useState(() => new Set())

  function toggleGroup(key) {
    setOpenKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <section className={`upah-settings-card ${sectionOpen ? 'open' : ''}`}>
      <button
        type="button"
        className="upah-settings-toggle"
        aria-expanded={sectionOpen}
        aria-controls="upah-rate-panel"
        onClick={() => setSectionOpen((open) => !open)}
      >
        <h2 className="upah-settings-title">{t('Upah per Layanan')}</h2>
        {!loading && (
          <span className="service-category-meta">{t('{count} layanan', { count: services.length })}</span>
        )}
        <span className="service-category-chevron" aria-hidden="true" />
      </button>

      {sectionOpen && loading && <p className="riwayat-loading">{t('Memuat...')}</p>}
      {sectionOpen && !loading && services.length === 0 && (
        <p className="riwayat-empty">{t('Belum ada layanan')}</p>
      )}
      {sectionOpen && !loading && services.length > 0 && (
        <div id="upah-rate-panel" className="service-category-list upah-rate-panel">
          {groups.map((group) => {
            const isOpen = openKeys.has(group.key)
            const panelId = `upah-category-${group.key}`
            return (
              <div key={group.key} className={`service-category ${isOpen ? 'open' : ''}`}>
                <button
                  type="button"
                  className="service-category-header"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggleGroup(group.key)}
                >
                  <span className="service-category-label">{group.label}</span>
                  <span className="service-category-meta">{group.services.length} layanan</span>
                  <span className="service-category-chevron" aria-hidden="true" />
                </button>

                {isOpen && (
                  <div id={panelId} className="riwayat-table upah-rate-table katalog-category-panel">
                    <div className="riwayat-table-row riwayat-table-head">
                      <span>Layanan</span>
                      <span>Upah</span>
                      <span></span>
                    </div>
                    {group.services.map((service) => {
                      const currentWage = wageByService.get(service.id) ?? 0
                      return (
                        // Keyed on the wage too, not just the service — remounts the
                        // row (resetting its local input) whenever the saved value
                        // changes, instead of syncing it back with an effect.
                        <ServiceWageRow
                          key={`${service.id}:${currentWage}`}
                          service={service}
                          currentWage={currentWage}
                          onChanged={onChanged}
                          onError={onError}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ServiceWageRow({ service, currentWage, onChanged, onError }) {
  const { t } = useLanguage()
  const [value, setValue] = useState(String(currentWage))
  const [busy, setBusy] = useState(false)
  const dirty = value !== '' && Math.round(Number(value)) !== currentWage

  async function handleSave() {
    const wage = Math.round(Number(value))
    if (!Number.isFinite(wage) || wage < 0) {
      onError('Upah harus berupa angka Rupiah, minimal 0')
      return
    }
    setBusy(true)
    onError('')
    try {
      await setServiceWageRate(service.id, wage)
      onChanged()
    } catch {
      onError('Gagal menyimpan upah layanan')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="riwayat-table-row upah-rate-row">
      <span className="riwayat-plate">{service.name}</span>
      <span className="upah-rate-input">
        <span>Rp</span>
        <input
          type="number"
          min="0"
          step="500"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
          aria-label={t('Upah {name}', { name: service.name })}
        />
      </span>
      <span className="staf-row-actions">
        <button type="button" className="btn-secondary" onClick={handleSave} disabled={busy || !dirty}>
          {busy ? t('Menyimpan...') : t('Simpan')}
        </button>
      </span>
    </div>
  )
}

// Uang makan: the flat amount paid for each day someone is marked present
// (Hadir) in Upah Harian below. Changing it only affects days marked from now
// on — a day already marked keeps the amount it was marked with.
function MealAllowanceSection({ onError }) {
  const { t } = useLanguage()
  const [saved, setSaved] = useState(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getMealAllowance()
      .then((amount) => {
        setSaved(amount)
        setValue(String(amount))
      })
      .catch(() => onError('Gagal memuat uang makan'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dirty = saved !== null && value !== '' && Math.round(Number(value)) !== saved

  async function handleSave() {
    const amount = Math.round(Number(value))
    if (!Number.isFinite(amount) || amount < 0) {
      onError('Uang makan harus berupa angka Rupiah, minimal 0')
      return
    }
    setBusy(true)
    onError('')
    try {
      await setMealAllowance(amount)
      setSaved(amount)
      setValue(String(amount))
    } catch {
      onError('Gagal menyimpan uang makan')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="upah-settings-card upah-meal-card">
      <div className="upah-meal-text">
        <h2 className="upah-settings-title">{t('Uang hadir')}</h2>
        {/* <p className="staf-section-note">
          {t('Per hari hadir. Perubahan hanya berlaku untuk hari yang dicatat setelah ini.')}
        </p> */}
      </div>
      <div className="upah-meal-row">
        <span className="upah-rate-input">
          <span>Rp</span>
          <input
            type="number"
            min="0"
            step="500"
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy || saved === null}
            aria-label={t('Uang makan per hari')}
          />
        </span>
        <button type="button" className="btn-secondary" onClick={handleSave} disabled={busy || !dirty}>
          {busy ? t('Menyimpan...') : t('Simpan')}
        </button>
      </div>
    </section>
  )
}

// What each staff member earned on one day: fixed-wage services they
// washed, plus uang makan if present, plus bonuses, minus deductions.
function DailyWageSection({ ratesVersion, onError }) {
  const { t } = useLanguage()
  const [date, setDate] = useState(todayDateInput())
  const [summary, setSummary] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)

  // ratesVersion isn't read in the body — it's here purely so a rate change
  // elsewhere on the page (which doesn't touch `date`) still gets a new
  // `reload` identity and re-triggers the effect below.
  const reload = useCallback(() => {
    getDailyWageSummary(date)
      .then(setSummary)
      .catch(() => onError('Gagal memuat upah harian'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, onError, ratesVersion])

  // Only the very first load shows "Memuat..." — a date or rate change just
  // swaps the table in place once the new summary arrives, same convention
  // as Laporan's worker-period switch.
  useEffect(() => {
    reload()
  }, [reload])

  const isToday = date === todayDateInput()
  const totals = summary.reduce(
    (acc, row) => ({
      present: acc.present + (row.present ? 1 : 0),
      service: acc.service + row.serviceEarnings,
      meal: acc.meal + row.mealAllowance,
      bonus: acc.bonus + row.bonusTotal,
      deduction: acc.deduction + row.deductionTotal,
      kasbon: acc.kasbon + row.kasbonRepayment,
      net: acc.net + row.netWage,
    }),
    { present: 0, service: 0, meal: 0, bonus: 0, deduction: 0, kasbon: 0, net: 0 },
  )

  return (
    <section className="staf-section">
      <div className="staf-section-header upah-daily-header">
        <h2 className="transaksi-section-label">{t('Upah Harian')}</h2>
        <div className="upah-date-nav">
          <button
            type="button"
            className="btn-secondary upah-date-step"
            onClick={() => setDate((d) => shiftDate(d, -1))}
            aria-label={t('Hari sebelumnya')}
          >
            ‹
          </button>
          <input
            type="date"
            value={date}
            max={todayDateInput()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label={t('Tanggal')}
          />
          <button
            type="button"
            className="btn-secondary upah-date-step"
            onClick={() => setDate((d) => shiftDate(d, 1))}
            disabled={isToday}
            aria-label={t('Hari berikutnya')}
          >
            ›
          </button>
          {isToday ? (
            <span className="upah-today-badge">{t('Hari ini')}</span>
          ) : (
            <button type="button" className="btn-secondary upah-today-btn" onClick={() => setDate(todayDateInput())}>
              {t('Hari ini')}
            </button>
          )}
        </div>
      </div>

      {loading && <p className="riwayat-loading">{t('Memuat...')}</p>}

      {!loading && (
        <>
          <div className="stat-cards upah-stat-cards">
            <div className="stat-card upah-stat-card-main">
              <span className="stat-card-label">{t('Total Upah Bersih')}</span>
              <span className="stat-card-value stat-card-value-accent">{formatRupiah(totals.net)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-card-label">{t('Hadir')}</span>
              <span className="stat-card-value">
                {totals.present}{' '}
                <span className="upah-stat-sub">{t('/ {count} staf', { count: summary.length })}</span>
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-card-label">{t('Upah Jasa')}</span>
              <span className="stat-card-value">{formatRupiah(totals.service)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-card-label">{t('Uang Makan')}</span>
              <span className="stat-card-value">{formatRupiah(totals.meal)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-card-label">{t('Bonus / Potongan & Kasbon')}</span>
              <span className="stat-card-value">
                <span className="upah-plus">+{formatNumber(totals.bonus)}</span>
                <span className="upah-stat-sub"> / </span>
                <span className="upah-minus">−{formatNumber(totals.deduction + totals.kasbon)}</span>
              </span>
            </div>
          </div>

          {summary.length === 0 ? (
            <p className="riwayat-empty">{t('Belum ada staf aktif')}</p>
          ) : (
            <div className="riwayat-table upah-daily-table">
              {/* Read left to right as the sum: Jasa + Makan + Bonus − Potongan − Kasbon = Bersih */}
              <div className="riwayat-table-row riwayat-table-head">
                <span>{t('Nama')}</span>
                <span>{t('Hadir')}</span>
                <span className="upah-num">{t('Upah Jasa')}</span>
                <span className="upah-num">+ {t('Makan')}</span>
                <span className="upah-num">+ {t('Bonus')}</span>
                <span className="upah-num">− {t('Potongan')}</span>
                <span className="upah-num">− {t('Kasbon')}</span>
                <span className="upah-num">= {t('Bersih')}</span>
                <span></span>
              </div>
              {summary.map((row) => (
                <DailyWageRow
                  key={row.profileId}
                  row={row}
                  date={date}
                  expanded={expandedId === row.profileId}
                  onToggle={() => setExpandedId((id) => (id === row.profileId ? null : row.profileId))}
                  onChanged={reload}
                  onError={onError}
                />
              ))}
              <div className="riwayat-table-row upah-total-row">
                <span>{t('Total · {count} staf', { count: summary.length })}</span>
                <span className="upah-total-present">{t('{count} hadir', { count: totals.present })}</span>
                <span className="upah-num">{formatRupiah(totals.service)}</span>
                <MoneyCell amount={totals.meal} />
                <MoneyCell amount={totals.bonus} tone="plus" />
                <MoneyCell amount={totals.deduction} tone="minus" />
                <MoneyCell amount={totals.kasbon} tone="minus" />
                <span className={`upah-num upah-net ${totals.net < 0 ? 'upah-net-negative' : ''}`}>
                  {formatRupiah(totals.net)}
                </span>
                <span></span>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

// "YYYY-MM-DD" moved by whole days, in local time.
function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const next = new Date(y, m - 1, d + days)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
}

// formatRupiah without the "Rp " — for the narrow columns, where the header
// already says what the number is.
function formatNumber(amount) {
  return Number(amount).toLocaleString('id-ID')
}

// A table amount that reads as a dash when zero, so the few non-zero
// bonuses/deductions stand out instead of a column of "Rp 0".
function MoneyCell({ amount, tone }) {
  if (!amount) return <span className="upah-num upah-zero">–</span>
  const toneClass = tone === 'plus' ? 'upah-plus' : tone === 'minus' ? 'upah-minus' : ''
  return <span className={`upah-num ${toneClass}`}>{formatNumber(amount)}</span>
}

function DailyWageRow({ row, date, expanded, onToggle, onChanged, onError }) {
  const { t } = useLanguage()
  const [attendanceBusy, setAttendanceBusy] = useState(false)

  async function handleAttendance(present) {
    setAttendanceBusy(true)
    onError('')
    try {
      await setAttendance(row.profileId, date, present)
      onChanged()
    } catch {
      onError('Gagal menyimpan kehadiran')
    } finally {
      setAttendanceBusy(false)
    }
  }

  // sharedCount comes from the even-split wage calculation; rows without it
  // just don't show the "dibagi" part.
  const vehicleCount = row.serviceBreakdown.reduce((sum, line) => sum + line.count, 0)
  const sharedCount = row.serviceBreakdown.reduce((sum, line) => sum + (line.sharedCount ?? 0), 0)
  const subline =
    vehicleCount === 0
      ? t('Belum ada layanan')
      : sharedCount > 0
        ? t('{count} kendaraan · {shared} dibagi', { count: vehicleCount, shared: sharedCount })
        : t('{count} kendaraan', { count: vehicleCount })
  const idle = !row.present && row.netWage === 0 && vehicleCount === 0

  return (
    <>
      {/* The whole row opens the detail on click as a mouse shortcut; the
          chevron button is the real (keyboard-reachable) control. */}
      <div
        className={`riwayat-table-row upah-daily-row ${expanded ? 'expanded' : ''} ${idle ? 'idle' : ''}`}
        onClick={onToggle}
      >
        <span className="upah-name-cell">
          <span className="riwayat-plate">{row.fullName}</span>
          <span className="upah-name-sub">{subline}</span>
        </span>
        <span>
          <button
            type="button"
            className={`upah-present-pill ${row.present ? 'on' : ''}`}
            aria-pressed={row.present}
            aria-label={t('Hadir {name}', { name: row.fullName })}
            disabled={attendanceBusy}
            onClick={(e) => {
              e.stopPropagation()
              handleAttendance(!row.present)
            }}
          >
            {row.present ? `✓ ${t('Hadir')}` : t('Tandai hadir')}
          </button>
        </span>
        <span className="upah-num">{row.serviceEarnings ? formatRupiah(row.serviceEarnings) : '–'}</span>
        <MoneyCell amount={row.present ? row.mealAllowance : 0} />
        <MoneyCell amount={row.bonusTotal} tone="plus" />
        <MoneyCell amount={row.deductionTotal} tone="minus" />
        <MoneyCell amount={row.kasbonRepayment} tone="minus" />
        <span className={`upah-num upah-net ${row.netWage < 0 ? 'upah-net-negative' : ''}`}>
          {formatRupiah(row.netWage)}
        </span>
        <span className="upah-chevron-cell">
          <button
            type="button"
            className="upah-row-toggle"
            aria-expanded={expanded}
            aria-label={expanded ? t('Tutup rincian {name}', { name: row.fullName }) : t('Buka rincian {name}', { name: row.fullName })}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          >
            <span className="service-category-chevron" aria-hidden="true" />
          </button>
        </span>
      </div>
      {expanded && (
        <div className="expand-wrap">
          <div className="expand-inner">
            <div className="upah-adjustments-panel">
              <div className="upah-detail-card upah-detail-breakdown">
                <h3 className="upah-detail-title">{t('Rincian Jasa')}</h3>
                <ServiceBreakdown rows={row.serviceBreakdown} />
              </div>
              <WageSlip row={row} />
              {(row.kasbonAvailable > 0 || row.kasbonRepayment > 0) && (
                <KasbonRepaymentForm
                  key={`${row.profileId}:${row.kasbonRepayment}:${row.kasbonSuggested}`}
                  row={row}
                  date={date}
                  onSaved={onChanged}
                  onError={onError}
                />
              )}
              <div className="upah-detail-card">
                <h3 className="upah-detail-title">{t('Bonus & Potongan')}</h3>
                <AddAdjustmentForm profileId={row.profileId} date={date} onAdded={onChanged} onError={onError} />
                {row.adjustments.length > 0 && (
                  <ul className="upah-adjustments-list">
                    {row.adjustments.map((adj) => (
                      <AdjustmentListItem key={adj.id} adjustment={adj} onDeleted={onChanged} onError={onError} />
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// How one person's net wage for the day is reached, line by line.
function WageSlip({ row }) {
  const { t } = useLanguage()
  const lines = [
    { label: t('Upah Jasa'), amount: row.serviceEarnings, sign: '' },
    { label: t('Uang Makan'), amount: row.present ? row.mealAllowance : 0, sign: '+' },
    { label: t('Bonus'), amount: row.bonusTotal, sign: '+', tone: 'upah-plus' },
    { label: t('Potongan'), amount: row.deductionTotal, sign: '−', tone: 'upah-minus' },
    { label: t('Cicilan Kasbon'), amount: row.kasbonRepayment, sign: '−', tone: 'upah-minus' },
  ]
  return (
    <div className="upah-detail-card upah-slip">
      <h3 className="upah-detail-title">{t('Slip Hari Ini')}</h3>
      {lines.map((line) => (
        <div key={line.label} className={`upah-slip-line ${line.amount ? '' : 'upah-zero'}`}>
          <span>{line.label}</span>
          <span className={line.amount ? line.tone : ''}>
            {line.amount ? `${line.sign ? `${line.sign} ` : ''}${formatRupiah(line.amount)}` : '–'}
          </span>
        </div>
      ))}
      <div className={`upah-slip-line upah-slip-total ${row.netWage < 0 ? 'upah-net-negative' : ''}`}>
        <span>{t('Bersih')}</span>
        <span>{formatRupiah(row.netWage)}</span>
      </div>
    </div>
  )
}

// The day's kasbon repayment out of this person's wages. The suggestion is a
// set share of their service wages (never more than they owe); a supervisor
// can go above it, but has to say why. The database enforces the one hard
// limit — never more than the balance — and requires the reason.
function KasbonRepaymentForm({ row, date, onSaved, onError }) {
  const { t } = useLanguage()
  const [amount, setAmount] = useState(row.kasbonRepayment > 0 ? String(row.kasbonRepayment) : '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const typed = Math.round(Number(amount) || 0)
  const override = typed > row.kasbonSuggested
  const unchanged = typed === row.kasbonRepayment

  async function save(value, isOverride) {
    if (!Number.isFinite(value) || value < 0) {
      onError('Jumlah cicilan tidak valid')
      return
    }
    if (value > row.kasbonAvailable) {
      onError('Cicilan melebihi sisa kasbon')
      return
    }
    if (isOverride && !reason.trim()) {
      onError('Alasan wajib diisi jika cicilan melebihi saran')
      return
    }
    setBusy(true)
    onError('')
    try {
      await setKasbonRepayment({
        profileId: row.profileId,
        date,
        amount: value,
        override: isOverride,
        reason,
      })
      onSaved()
    } catch (err) {
      onError(err.message || 'Gagal menyimpan cicilan kasbon')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="upah-detail-card upah-kasbon-panel">
      <div className="upah-kasbon-head">
        <h3 className="upah-detail-title">{t('Cicilan Kasbon')}</h3>
        <span>
          {t('Sisa kasbon')} <strong>{formatRupiah(row.kasbonBalance)}</strong>
        </span>
      </div>
      <p className="upah-kasbon-note">
        {t('Saran')}: {formatRupiah(row.kasbonSuggested)} —{' '}
        {t('{percent}% dari upah jasa', { percent: row.kasbonRepayPercent })}
      </p>
      {row.kasbonRepaymentNote && <p className="upah-kasbon-note">{row.kasbonRepaymentNote}</p>}
      <div className="upah-adjustment-form">
        <span className="upah-rate-input">
          <span>Rp</span>
          <input
            type="number"
            min="0"
            max={row.kasbonAvailable}
            inputMode="numeric"
            placeholder={t('Jumlah (Rp)')}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy}
            aria-label={t('Jumlah cicilan')}
          />
        </span>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy || row.kasbonSuggested === typed}
          onClick={() => setAmount(String(row.kasbonSuggested))}
        >
          {t('Pakai saran')}
        </button>
        {override && (
          <input
            type="text"
            placeholder={t('Alasan melebihi saran')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
          />
        )}
        <button
          type="button"
          className="btn-primary"
          disabled={busy || unchanged}
          onClick={() => save(typed, override)}
        >
          {busy ? t('Menyimpan...') : t('Simpan Cicilan')}
        </button>
        {row.kasbonRepayment > 0 && (
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => save(0, false)}>
            {t('Hapus')}
          </button>
        )}
      </div>
    </div>
  )
}

// Per-service tally behind one worker's Upah Jasa: how many of each service
// they washed that day, their share of the sale value of those lines, and
// their share of the wage — a wash shared by several staff is split evenly.
function ServiceBreakdown({ rows }) {
  const { t } = useLanguage()
  if (rows.length === 0) {
    return <p className="upah-breakdown-empty">{t('Belum ada layanan dikerjakan pada tanggal ini')}</p>
  }
  const totalCount = rows.reduce((sum, r) => sum + r.count, 0)
  const totalNominal = rows.reduce((sum, r) => sum + r.nominal, 0)
  const totalWage = rows.reduce((sum, r) => sum + r.wage, 0)
  return (
    <table className="upah-breakdown">
      <thead>
        <tr>
          <th>{t('Layanan')}</th>
          <th>{t('Jumlah')}</th>
          <th>{t('Nominal')}</th>
          <th>{t('Upah')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.serviceName}>
            <td>{r.serviceName}</td>
            <td>
              {r.count}
              {r.sharedCount > 0 && (
                <span className="upah-breakdown-shared"> ({t('{count} dibagi', { count: r.sharedCount })})</span>
              )}
            </td>
            <td>{formatRupiah(r.nominal)}</td>
            <td>{formatRupiah(r.wage)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td>{t('Total')}</td>
          <td>{totalCount}</td>
          <td>{formatRupiah(totalNominal)}</td>
          <td>{formatRupiah(totalWage)}</td>
        </tr>
      </tfoot>
    </table>
  )
}

// Bonus/deduction amounts are always a flat rupiah nominal, typed in by the
// supervisor — never a percentage of anything.
function AddAdjustmentForm({ profileId, date, onAdded, onError }) {
  const { t } = useLanguage()
  const [type, setType] = useState('bonus')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    onError('')
    const value = Math.round(Number(amount))
    if (!Number.isFinite(value) || value <= 0) {
      onError('Jumlah harus lebih dari nol')
      return
    }
    setSubmitting(true)
    try {
      await addWageAdjustment({ profileId, date, type, amount: value, reason })
      setAmount('')
      setReason('')
      onAdded()
    } catch {
      onError(type === 'bonus' ? 'Gagal menambah bonus' : 'Gagal menambah potongan')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="upah-adjustment-form" onSubmit={handleSubmit}>
      <div className="upah-type-toggle" role="group" aria-label={t('Jenis')}>
        <button
          type="button"
          className={type === 'bonus' ? 'on bonus' : ''}
          aria-pressed={type === 'bonus'}
          onClick={() => setType('bonus')}
          disabled={submitting}
        >
          + {t('Bonus')}
        </button>
        <button
          type="button"
          className={type === 'deduction' ? 'on deduction' : ''}
          aria-pressed={type === 'deduction'}
          onClick={() => setType('deduction')}
          disabled={submitting}
        >
          − {t('Potongan')}
        </button>
      </div>
      <input
        type="number"
        min="0"
        inputMode="numeric"
        placeholder={t('Jumlah (Rp)')}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        disabled={submitting}
      />
      <input
        type="text"
        placeholder={t('Alasan (opsional)')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={submitting}
      />
      <button type="submit" className="btn-primary" disabled={submitting}>
        {submitting ? t('Menyimpan...') : t('Tambah')}
      </button>
    </form>
  )
}

function AdjustmentListItem({ adjustment, onDeleted, onError }) {
  const { t } = useLanguage()
  const [busy, setBusy] = useState(false)

  async function handleDelete() {
    setBusy(true)
    onError('')
    try {
      await deleteWageAdjustment(adjustment.id)
      onDeleted()
    } catch {
      onError('Gagal menghapus catatan')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="upah-adjustment-item">
      <span className={`upah-adjustment-amount ${adjustment.type === 'bonus' ? 'upah-plus' : 'upah-minus'}`}>
        {adjustment.type === 'bonus' ? '+' : '−'} {formatRupiah(adjustment.amount)}
      </span>
      <span className="upah-adjustment-reason">{adjustment.reason || '-'}</span>
      <button type="button" className="upah-link-danger" onClick={handleDelete} disabled={busy}>
        {busy ? '...' : t('Hapus')}
      </button>
    </li>
  )
}
