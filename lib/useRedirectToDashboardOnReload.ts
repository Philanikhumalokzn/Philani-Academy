import { useEffect } from 'react'
import { useRouter } from 'next/router'

function isBrowserReload(): boolean {
  if (typeof window === 'undefined') return false

  try {
    const entries = performance.getEntriesByType?.('navigation') as PerformanceNavigationTiming[] | undefined
    const nav = entries && entries.length ? entries[0] : undefined
    if (nav && typeof nav.type === 'string') {
      return nav.type === 'reload'
    }
  } catch {
    // ignore
  }

  // Legacy fallback
  try {
    const legacyType = (performance as any)?.navigation?.type
    // 1 === TYPE_RELOAD
    return legacyType === 1
  } catch {
    return false
  }
}

/**
 * If the user refreshes/reloads while on a canvas-heavy route,
 * send them back to /dashboard to avoid inconsistent canvas state.
 */
export default function useRedirectToDashboardOnReload(enabled = true) {
  const router = useRouter()

  useEffect(() => {
    if (!enabled) return
    if (!router.isReady) return
    if (!isBrowserReload()) return

    // Avoid accidental loops if used on dashboard.
    if (router.pathname === '/dashboard') return

    router.replace('/dashboard')
  }, [enabled, router])
}
