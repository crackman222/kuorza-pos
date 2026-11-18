import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { logout } from '../api'
import { initials } from '../lib/format'
import { useAuth } from '../context/useAuth'
import { isAdmin, isStaff, isSupervisor, ROLE_LABELS } from '../lib/roles'
import { WorkerShell } from './WorkerShell'
import { LanguageToggle } from './LanguageToggle'
import { Icon } from './Icon'
import { useLanguage } from '../context/useLanguage'
import { dateLocale } from '../lib/i18n'

// `access` mirrors the route guards in App.jsx — keep the two in step, since
// this only decides what's shown and the guards decide what's reachable.
const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true, access: 'all' },
  { to: '/transaksi-baru', label: 'Transaksi Baru', icon: 'add_circle', end: false, access: 'all' },
  { to: '/katalog', label: 'Katalog Layanan', icon: 'menu_book', end: false, access: 'supervisor' },
  { to: '/riwayat', label: 'Riwayat Transaksi', icon: 'receipt_long', end: false, access: 'supervisor' },
  { to: '/laporan', label: 'Laporan Harian', icon: 'monitoring', end: false, access: 'supervisor' },
  { to: '/upah', label: 'Kelola Upah', icon: 'wage', end: false, access: 'supervisor' },
  { to: '/staf', label: 'Kelola Staf', icon: 'group', end: false, access: 'admin' },
]

function todayLabel() {
  const label = new Date().toLocaleDateString(dateLocale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

// Desk shell: an M3 navigation drawer beside a small top app bar. At wide
// widths the drawer is standard (always visible); below 1024px it becomes a
// modal drawer over a scrim, opened from the app bar's menu button.
export function AppShell() {
  const { profile, setProfile } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [navOpen, setNavOpen] = useState(false)

  // A modal drawer closes itself on Escape, like any other M3 modal surface.
  useEffect(() => {
    if (!navOpen) return undefined
    function handleKeyDown(e) {
      if (e.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navOpen])

  // Workers are on a phone, so they get a different shell entirely — bottom
  // navigation instead of a drawer. Same routes underneath: this swaps the
  // chrome around <Outlet/>, it is not a second route table. Placed after the
  // hooks above so the hook order stays identical either way.
  if (isStaff(profile)) return <WorkerShell />

  function canSee(item) {
    if (item.access === 'admin') return isAdmin(profile)
    if (item.access === 'supervisor') return isSupervisor(profile)
    return true
  }

  async function handleLogout() {
    await logout()
    setProfile(null)
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <div
        className={`app-drawer-scrim ${navOpen ? 'open' : ''}`}
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />
      <aside className={`app-drawer ${navOpen ? 'open' : ''}`} aria-label={t('Menu utama')}>
        <div className="app-drawer-brand">
          <span className="app-brand-mark">
            <Icon name="brand" />
          </span>
          <div className="app-drawer-brand-text">
            <span className="app-drawer-brand-name">Kuorza</span>
            <span className="app-drawer-brand-sub">Point of Sale</span>
          </div>
        </div>
        <nav className="app-drawer-nav">
          {NAV_ITEMS.filter(canSee).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setNavOpen(false)}
              className={({ isActive }) => `app-drawer-item ${isActive ? 'active' : ''}`}
            >
              {({ isActive }) => (
                <>
                  <Icon name={item.icon} fill={isActive} />
                  <span>{t(item.label)}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        {profile && (
          <div className="app-drawer-user">
            <span className="app-avatar">{initials(profile.full_name)}</span>
            <div className="app-drawer-user-text">
              <span className="app-drawer-user-name">{profile.full_name}</span>
              <span className="app-drawer-user-role">{t(ROLE_LABELS[profile.role] || profile.role)}</span>
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={handleLogout}
              title={t('Keluar')}
              aria-label={t('Keluar')}
            >
              <Icon name="logout" />
            </button>
          </div>
        )}
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <button
            type="button"
            className="icon-btn app-menu-btn"
            onClick={() => setNavOpen((open) => !open)}
            aria-label={navOpen ? t('Tutup menu') : t('Buka menu')}
            aria-expanded={navOpen}
          >
            <Icon name="menu" />
          </button>
          <div className="app-topbar-titles">
            <Icon name="calendar_today" size={20} />
            <span className="app-topbar-title">{todayLabel()}</span>
          </div>
          <div className="app-topbar-actions">
            <LanguageToggle />
          </div>
        </header>
        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
