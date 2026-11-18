import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  getLast7DaysRevenue,
  getTodayPaymentBreakdown,
  getWorkerOrderCounts,
  getPopularServices,
} from '../api'
import { formatRupiah, initials } from '../lib/format'
import {
  getPeriodRange,
  getDayRange,
  todayDateInput,
  formatPeriodLabel,
  businessDayStart,
} from '../lib/dateRange'
import { useAuth } from '../context/useAuth'
import { isAdmin as checkIsAdmin } from '../lib/roles'
import { useLanguage } from '../context/useLanguage'
import { dateLocale, translateServiceName } from '../lib/i18n'

const PAYMENT_LABELS = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer' }
const PAYMENT_COLORS = { cash: '#2c6a9e', qris: '#7bb2d9', transfer: '#dce9f3' }

const WORKER_PERIOD_OPTIONS = [
  { value: 'daily', label: 'Harian' },
  { value: 'weekly', label: 'Mingguan' },
  { value: 'monthly', label: 'Bulanan' },
  { value: 'yearly', label: 'Tahunan' },
]

function dayLabel(date) {
  const label = date.toLocaleDateString(dateLocale(), { weekday: 'short' })
  return label.charAt(0).toUpperCase() + label.slice(1, 3)
}

export default function Laporan() {
  const { profile } = useAuth()
  const { t, language } = useLanguage()
  const isAdmin = checkIsAdmin(profile)
  // The day being reported, kept in the URL (?tanggal=2026-10-15) so a past
  // day can be bookmarked or shared. Like the period pickers below, looking
  // back is admin-only: everyone else is pinned to today, and a missing,
  // malformed or future value falls back to today too.
  const [searchParams, setSearchParams] = useSearchParams()
  const today = todayDateInput()
  const requestedDate = searchParams.get('tanggal') ?? ''
  const date = isAdmin && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && requestedDate <= today ? requestedDate : today
  const isToday = date === today

  function changeDate(value) {
    setSearchParams(value && value !== today ? { tanggal: value } : {}, { replace: true })
  }

  // 'daily' follows the picked day; weekly/monthly/yearly stay relative to now.
  function rangeFor(period) {
    return period === 'daily' ? getDayRange(date) : getPeriodRange(period)
  }

  const [last7, setLast7] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [workerPeriod, setWorkerPeriod] = useState('daily')
  const [workerCounts, setWorkerCounts] = useState([])
  const [workerLoading, setWorkerLoading] = useState(true)
  // Non-admin staff only ever see today's leaderboard — the period picker
  // is admin-only, so their stored workerPeriod (always 'daily', since they
  // have no control to change it) is redundant here, but this keeps the
  // fetch pinned to daily even if that ever changes.
  const effectiveWorkerPeriod = isAdmin ? workerPeriod : 'daily'
  // Same rule as the worker leaderboard: admins pick a period, everyone
  // else is pinned to today.
  const [servicePeriod, setServicePeriod] = useState('daily')
  const [popularServices, setPopularServices] = useState([])
  const [servicesLoading, setServicesLoading] = useState(true)
  const effectiveServicePeriod = isAdmin ? servicePeriod : 'daily'

  useEffect(() => {
    const { start, end } = rangeFor(effectiveServicePeriod)
    getPopularServices(start, end)
      .then(setPopularServices)
      .catch(() => setError('Gagal memuat layanan terpopuler'))
      .finally(() => setServicesLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveServicePeriod, date])

  const topServices = useMemo(() => {
    const top = popularServices.slice(0, 5)
    const max = Math.max(1, ...top.map((s) => s.quantity))
    return top.map((s) => ({ ...s, widthPct: Math.round((s.quantity / max) * 100) }))
  }, [popularServices])

  useEffect(() => {
    // Staff only get today's numbers — the 7-day trend is history, admin-only.
    Promise.all([isAdmin ? getLast7DaysRevenue(date) : Promise.resolve([]), getTodayPaymentBreakdown(date)])
      .then(([last7Data, paymentsData]) => {
        setLast7(last7Data)
        setPayments(paymentsData)
      })
      .catch(() => setError('Gagal memuat laporan'))
      .finally(() => setLoading(false))
  }, [isAdmin, date])

  // Doesn't flip workerLoading back to true on a period switch — only the
  // very first load shows "Memuat...", later switches just swap the table
  // in place once the new counts arrive instead of flashing a spinner.
  function loadWorkerCounts(period) {
    const { start, end } = rangeFor(period)
    getWorkerOrderCounts(start, end)
      .then(setWorkerCounts)
      .catch(() => setError('Gagal memuat peringkat pekerja'))
      .finally(() => setWorkerLoading(false))
  }

  useEffect(() => {
    loadWorkerCounts(effectiveWorkerPeriod)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveWorkerPeriod, date])

  // Revenue/count/avg all come from payments actually collected today, not
  // from treatment totals — a queued-but-unpaid job isn't revenue yet.
  const stats = useMemo(() => {
    const revenue = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
    const count = payments.length
    return { revenue, count, avg: count ? Math.round(revenue / count) : 0 }
  }, [payments])

  const revBars = useMemo(() => {
    // Each bar is a business day (04:00–04:00), labelled by the day it opened.
    // The last bar is the day being reported (today unless a date is picked).
    const lastDay = getDayRange(date).start
    const days = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(lastDay)
      d.setDate(d.getDate() - i)
      days.push({ date: d, key: d.toDateString(), label: dayLabel(d), revenue: 0 })
    }
    const byDay = new Map(days.map((d) => [d.key, d]))
    for (const p of last7) {
      const bucket = byDay.get(businessDayStart(new Date(p.paid_at)).toDateString())
      if (bucket) bucket.revenue += Number(p.amount || 0)
    }
    const max = Math.max(1, ...days.map((d) => d.revenue))
    const selectedKey = lastDay.toDateString()
    return days.map((d) => ({
      ...d,
      heightPct: Math.round((d.revenue / max) * 100),
      isToday: d.key === selectedKey,
    }))
    // language: the weekday labels are localized.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last7, language, date])

  const paymentBreakdown = useMemo(() => {
    const totals = { cash: 0, qris: 0, transfer: 0 }
    for (const p of payments) {
      if (totals[p.payment_method] !== undefined) totals[p.payment_method] += Number(p.amount || 0)
    }
    const grandTotal = totals.cash + totals.qris + totals.transfer
    return Object.entries(totals).map(([method, amount]) => ({
      method,
      label: t(PAYMENT_LABELS[method]),
      color: PAYMENT_COLORS[method],
      amount,
      pct: grandTotal ? Math.round((amount / grandTotal) * 100) : 0,
    }))
  }, [payments, t])

  if (loading) return <div className="loading-screen">{t('Memuat...')}</div>

  return (
    <div className="laporan-screen">
      <div className="laporan-header">
        <h1>{t('Laporan Harian')}</h1>
        {isAdmin && (
          <div className="laporan-date">
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => changeDate(e.target.value)}
              aria-label={t('Tanggal')}
            />
            {!isToday && (
              <button type="button" className="btn-secondary" onClick={() => changeDate(today)}>
                {t('Hari Ini')}
              </button>
            )}
          </div>
        )}
      </div>
      {error && <p className="form-error">{t(error)}</p>}

      <div className="stat-cards">
        <div className="stat-card">
          <span className="stat-card-label">{isToday ? t('Pendapatan Hari Ini') : t('Pendapatan')}</span>
          <span className="stat-card-value stat-card-value-accent">{formatRupiah(stats.revenue)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-card-label">{t('Transaksi')}</span>
          <span className="stat-card-value">{stats.count}</span>
        </div>
        <div className="stat-card">
          <span className="stat-card-label">{t('Rata-rata Transaksi')}</span>
          <span className="stat-card-value">{formatRupiah(stats.avg)}</span>
        </div>
      </div>

      <div className="laporan-panels">
        {isAdmin && (
          <div className="laporan-panel laporan-chart">
            <div className="laporan-panel-title">{t('Pendapatan — 7 Hari Terakhir')}</div>
            <div className="rev-bars">
              {revBars.map((d) => (
                <div key={d.key} className="rev-bar-col">
                  <span className="rev-bar-amount">{formatRupiah(d.revenue)}</span>
                  <div
                    className={`rev-bar ${d.isToday ? 'rev-bar-today' : ''}`}
                    style={{ height: `${Math.max(d.heightPct, 3)}%` }}
                    title={formatRupiah(d.revenue)}
                  />
                  <span className="rev-bar-label">{d.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="laporan-panel laporan-payments">
          <div className="laporan-panel-title">{t('Metode Pembayaran')}</div>
          <div className="payment-breakdown-bar">
            {paymentBreakdown.map((p) => (
              <div key={p.method} style={{ width: `${p.pct}%`, background: p.color }} />
            ))}
          </div>
          <div className="payment-breakdown-legend">
            {paymentBreakdown.map((p) => (
              <div key={p.method} className="payment-breakdown-row">
                <span>{p.label}</span>
                <span>{formatRupiah(p.amount)} ({p.pct}%)</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="laporan-panel laporan-services">
        <div className="laporan-panel-header">
          <div>
            <div className="laporan-panel-title">{t('Layanan Terpopuler')}</div>
            <p className="laporan-panel-subtitle">{formatPeriodLabel(effectiveServicePeriod, date)}</p>
          </div>
          {isAdmin && (
            <select value={servicePeriod} onChange={(e) => setServicePeriod(e.target.value)}>
              {WORKER_PERIOD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.label)}
                </option>
              ))}
            </select>
          )}
        </div>

        {servicesLoading && <p className="riwayat-loading">{t('Memuat...')}</p>}
        {!servicesLoading && topServices.length === 0 && (
          <p className="riwayat-empty">{t('Belum ada layanan terjual pada periode ini')}</p>
        )}
        {!servicesLoading && topServices.length > 0 && (
          <div className="popular-services">
            {topServices.map((s, i) => (
              <div key={s.name} className={`popular-service-row ${i === 0 ? 'is-top' : ''}`}>
                <span className="popular-service-rank">{i + 1}</span>
                <div className="popular-service-info">
                  <div className="popular-service-head">
                    <span className="popular-service-name">{translateServiceName(s.name, language)}</span>
                    <span className="popular-service-count">{s.quantity}×</span>
                  </div>
                  <div className="popular-service-track">
                    <div className="popular-service-fill" style={{ width: `${s.widthPct}%` }} />
                  </div>
                  <span className="popular-service-revenue">{formatRupiah(s.revenue)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="laporan-panel laporan-workers">
        <div className="laporan-panel-header">
          <div>
            <div className="laporan-panel-title">{t('Peringkat Pekerja')}</div>
            <p className="laporan-panel-subtitle">{formatPeriodLabel(effectiveWorkerPeriod, date)}</p>
          </div>
          {isAdmin && (
            <select value={workerPeriod} onChange={(e) => setWorkerPeriod(e.target.value)}>
              {WORKER_PERIOD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.label)}
                </option>
              ))}
            </select>
          )}
        </div>

        {workerLoading && <p className="riwayat-loading">{t('Memuat...')}</p>}
        {!workerLoading && workerCounts.length === 0 && (
          <p className="riwayat-empty">{t('Belum ada transaksi dengan petugas tercatat pada periode ini')}</p>
        )}
        {!workerLoading && workerCounts.length > 0 && (
          <div className="worker-leaderboard">
            {workerCounts.map((w, i) => {
              const rank = i + 1
              const tier = rank <= 3 ? rank : 'other'
              const isYou = w.name === profile?.full_name
              return (
                <div
                  key={w.name}
                  className={`worker-leaderboard-row tier-${tier} ${isYou ? 'is-you' : ''}`}
                >
                  <span className={`worker-rank-badge tier-${tier}`}>{rank}</span>
                  <span className="worker-avatar">{initials(w.name)}</span>
                  <div className="worker-leaderboard-info">
                    <span className="worker-leaderboard-name">
                      {w.name}
                      {isYou && <span className="worker-you-tag">{t('Anda')}</span>}
                    </span>
                    <span className="worker-leaderboard-sub">
                      {t('{wash} Cuci · {qc} QC', { wash: w.washCount, qc: w.qcCount })}
                    </span>
                  </div>
                  <span className="worker-leaderboard-total">{w.total}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
