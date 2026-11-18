import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { useLanguage } from '../context/useLanguage'

export function ProtectedRoute() {
  const { profile, loading } = useAuth()
  const { t } = useLanguage()

  if (loading) return <div className="loading-screen">{t('Memuat...')}</div>
  if (!profile) return <Navigate to="/login" replace />

  return <Outlet />
}
