import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentProfile } from '../api'
import { AuthContext } from './auth-context'

// How long a signed-in tab can go with no interaction (or spend backgrounded)
// before the session is force-logged-out. This is a shared POS device, not a
// personal one — a tab left open at the counter, or open in the background
// for a while, shouldn't stay signed in indefinitely. Session storage key so
// Login.jsx can tell "logged out from idle" apart from a normal logout.
const IDLE_TIMEOUT_MS = 15 * 60 * 1000
const IDLE_LOGOUT_FLAG = 'nd_idle_logout'

// How often a signed-in tab re-reads its own profile to notice it was
// deactivated. RLS (migration 014) already blocks a deactivated user's data
// access on the very next request, and migration 015 deletes their Auth
// sessions so the next token refresh fails — this just gets them off the
// screen promptly instead of leaving them on empty pages until the access
// token expires (up to an hour).
const ACTIVE_CHECK_MS = 60 * 1000
const DEACTIVATED_LOGOUT_FLAG = 'nd_deactivated_logout'

function signOutDeactivated() {
  sessionStorage.setItem(DEACTIVATED_LOGOUT_FLAG, '1')
  return supabase.auth.signOut()
}

export function AuthProvider({ children }) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const idleTimerRef = useRef(null)
  const hiddenAtRef = useRef(null)

  useEffect(() => {
    let mounted = true

    async function loadProfile() {
      try {
        const current = await getCurrentProfile()
        // A restored session (page reload, new tab) never went through
        // login()'s is_active check, so apply it here too.
        if (current && !current.is_active) {
          if (mounted) setProfile(null)
          await signOutDeactivated()
          return
        }
        if (mounted) setProfile(current)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    loadProfile()

    const { data } = supabase.auth.onAuthStateChange(() => {
      loadProfile()
    })

    return () => {
      mounted = false
      data.subscription.unsubscribe()
    }
  }, [])

  // Deactivation check while signed in: on an interval and whenever the tab
  // comes back into view. Transient errors (offline) are ignored — the next
  // tick retries, and RLS is what actually enforces access anyway.
  useEffect(() => {
    if (!profile) return
    let cancelled = false

    async function checkStillActive() {
      try {
        const current = await getCurrentProfile()
        if (!cancelled && current && !current.is_active) {
          setProfile(null)
          await signOutDeactivated()
        }
      } catch {
        // ignore — retry on next tick
      }
    }

    function handleVisible() {
      if (!document.hidden) checkStillActive()
    }

    const interval = setInterval(checkStillActive, ACTIVE_CHECK_MS)
    document.addEventListener('visibilitychange', handleVisible)
    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisible)
    }
  }, [profile])

  // Idle/away auto-logout. Only runs while someone is actually signed in —
  // there's nothing to protect on the login screen itself.
  useEffect(() => {
    if (!profile) return

    function forceLogout() {
      sessionStorage.setItem(IDLE_LOGOUT_FLAG, '1')
      supabase.auth.signOut()
    }

    function resetIdleTimer() {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      idleTimerRef.current = setTimeout(forceLogout, IDLE_TIMEOUT_MS)
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        // Most browsers throttle/pause timers in a backgrounded tab, so the
        // in-tab timer above can't be trusted while hidden — track wall-clock
        // time instead and check it back on return.
        hiddenAtRef.current = Date.now()
        return
      }
      if (hiddenAtRef.current && Date.now() - hiddenAtRef.current >= IDLE_TIMEOUT_MS) {
        forceLogout()
        return
      }
      resetIdleTimer()
    }

    const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll']
    activityEvents.forEach((event) => window.addEventListener(event, resetIdleTimer))
    document.addEventListener('visibilitychange', handleVisibilityChange)

    resetIdleTimer()

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      activityEvents.forEach((event) => window.removeEventListener(event, resetIdleTimer))
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [profile])

  return (
    <AuthContext.Provider value={{ profile, loading, setProfile }}>
      {children}
    </AuthContext.Provider>
  )
}
