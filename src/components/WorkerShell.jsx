import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { logout } from '../api'
import { initials } from '../lib/format'
import { useAuth } from '../context/useAuth'
import { useLanguage } from '../context/useLanguage'
import { LanguageToggle } from './LanguageToggle'
import { Icon } from './Icon'

// The phone shell for role='staff' — the people on the floor, who work off a
// handset rather than the counter machine. Same routes and same pages as the
// desk shell (AppShell); what changes is the chrome: an M3 small top app bar
// and a thumb-reachable navigation bar instead of the drawer.
//
// Only the two destinations a worker starts from get a tab. Detail Treatment
// and Struk are reached by tapping a ticket, exactly as on the desk shell, so
// they stay out of the nav — see the comment on the routes in App.jsx.
const WORKER_NAV = [
  { to: '/', label: 'Antrian', title: 'Antrian Kerja', icon: 'format_list_bulleted', end: true },
  { to: '/transaksi-baru', label: 'Transaksi', title: 'Transaksi Baru', icon: 'add_circle', end: false },
]

// Detail and Struk have no tab, so they get a title of their own rather than
// inheriting 'Antrian'.
function screenTitle(pathname) {
  if (pathname.startsWith('/treatment/')) return 'Detail Transaksi'
  if (pathname.startsWith('/struk/')) return 'Struk'
  const tab = WORKER_NAV.find((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to)))
  return tab ? tab.title : 'Kuorza'
}

export function WorkerShell() {
  const { profile, setProfile } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  async function handleLogout() {
    await logout()
    setProfile(null)
    navigate('/login', { replace: true })
  }

  return (
    // `worker-ui` is the style namespace for the whole phone treatment: the
    // shared pages underneath are restyled through it rather than forked, so
    // Antrian/Detail/Struk stay single components. See App.css.
    <div className="worker-ui worker-shell">
      <header className="worker-topbar">
        <span className="app-brand-mark">
          <Icon name="brand" size={20} />
        </span>
        <span className="worker-topbar-title">{t(screenTitle(pathname))}</span>
        <LanguageToggle className="language-toggle-compact" />
        {profile && (
          // The avatar doubles as the logout control — there is no room on a
          // phone app bar for both, and 40px is already a full touch target.
          <button
            type="button"
            className="app-avatar app-avatar-btn"
            onClick={handleLogout}
            title={t('{name} — ketuk untuk keluar', { name: profile.full_name })}
            aria-label={t('Keluar dari akun {name}', { name: profile.full_name })}
          >
            {initials(profile.full_name)}
          </button>
        )}
      </header>

      <main className="worker-content">
        <Outlet />
      </main>

      <nav className="worker-navbar" aria-label={t('Menu utama')}>
        {WORKER_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `worker-nav-item ${isActive ? 'active' : ''}`}
          >
            {({ isActive }) => (
              <>
                <span className="worker-nav-indicator">
                  <Icon name={item.icon} fill={isActive} />
                </span>
                <span className="worker-nav-label">{t(item.label)}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
