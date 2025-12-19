import Link from 'next/link'
import { useRouter } from 'next/router'
import { useSession } from 'next-auth/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type AnnouncementLike = { id?: string | number | null }

const useMobileTopChromeVisible = (pathname: string | undefined, authenticated: boolean) => {
  if (!authenticated) return false
  if (!pathname) return false

  // Full-screen / no-distraction learning surfaces.
  if (pathname === '/board') return false
  if (pathname === '/jaas-demo') return false

  return true
}

export default function MobileTopChrome() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const isVisible = useMobileTopChromeVisible(router.pathname, status === 'authenticated')

  const [open, setOpen] = useState(false)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [unreadCount, setUnreadCount] = useState(0)
  const [announcements, setAnnouncements] = useState<AnnouncementLike[]>([])
  const [readIds, setReadIds] = useState<string[]>([])
  const fetchAbortRef = useRef<AbortController | null>(null)

  const userKey = useMemo(() => {
    if (!session) return 'anon'
    const s: any = session
    return session.user?.email || s?.user?.id || session.user?.name || 'anon'
  }, [session])

  const readStorageKey = useMemo(() => `pa:readAnnouncements:${userKey}`, [userKey])

  const readSet = useMemo(() => new Set(readIds), [readIds])

  const computeUnread = useCallback((items: AnnouncementLike[], ids: Set<string>) => {
    if (!items || items.length === 0) return 0
    let count = 0
    for (const a of items) {
      const id = a?.id
      if (id != null && !ids.has(String(id))) count += 1
    }
    return count
  }, [])

  useEffect(() => {
    if (!isVisible) return
    if (typeof window === 'undefined') return

    try {
      const raw = window.localStorage.getItem(readStorageKey)
      const parsed = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed)) setReadIds(parsed.map(String))
      else setReadIds([])
    } catch {
      setReadIds([])
    }

    const handleStorage = (e: StorageEvent) => {
      if (!e.key || e.key !== readStorageKey) return
      try {
        const parsed = e.newValue ? JSON.parse(e.newValue) : []
        if (Array.isArray(parsed)) setReadIds(parsed.map(String))
        else setReadIds([])
      } catch {
        setReadIds([])
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [isVisible, readStorageKey])

  useEffect(() => {
    if (!isVisible) return
    if (status !== 'authenticated') return

    if (fetchAbortRef.current) fetchAbortRef.current.abort()
    const controller = new AbortController()
    fetchAbortRef.current = controller

    const grade = (session as any)?.user?.grade as string | undefined
    const role = (session as any)?.user?.role as string | undefined

    const url = (() => {
      // Admin endpoint needs a grade query param; fall back to session grade when available.
      if (role === 'admin' && grade) return `/api/announcements?grade=${encodeURIComponent(grade)}`
      return '/api/announcements'
    })()

    ;(async () => {
      try {
        const res = await fetch(url, { signal: controller.signal })
        if (!res.ok) {
          setAnnouncements([])
          return
        }
        const json = await res.json()
        if (Array.isArray(json)) setAnnouncements(json)
        else setAnnouncements([])
      } catch {
        // ignore
      }
    })()

    return () => controller.abort()
  }, [isVisible, session, status])

  useEffect(() => {
    if (!isVisible) return
    setUnreadCount(computeUnread(announcements, readSet))
  }, [announcements, computeUnread, isVisible, readSet])

  const showChrome = useCallback(() => {
    setOpen(true)
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
    hideTimeoutRef.current = setTimeout(() => {
      setOpen(false)
      hideTimeoutRef.current = null
    }, 1500)
  }, [])

  useEffect(() => {
    if (!isVisible) return
    if (typeof window === 'undefined') return

    const onAnyPointer = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return

      // Ignore taps inside the chrome itself.
      if (target.closest('[data-mobile-top-chrome]')) return

      // Ignore taps inside regions that should not toggle the chrome.
      if (target.closest('[data-mobile-chrome-ignore]')) return

      // "Empty" means: not an interactive element.
      if (target.closest('a,button,input,textarea,select,[role="button"],[data-mobile-chrome-interactive]')) return

      showChrome()
    }

    // Use pointerdown + capture so it works reliably on mobile (before routing/link clicks).
    window.addEventListener('pointerdown', onAnyPointer, { capture: true })
    return () => window.removeEventListener('pointerdown', onAnyPointer, { capture: true } as any)
  }, [isVisible, showChrome])

  useEffect(() => {
    const handleRoute = () => setOpen(false)
    router.events.on('routeChangeStart', handleRoute)
    return () => router.events.off('routeChangeStart', handleRoute)
  }, [router.events])

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current)
    }
  }, [])

  if (!isVisible) return null

  return (
    <>
      <div
        data-mobile-top-chrome
        className={`fixed top-2 left-2 right-2 z-50 md:hidden transition-opacity ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <div className="mx-auto w-fit max-w-full rounded-2xl border border-white/15 bg-white/10 backdrop-blur px-2 py-2">
          <div className="flex items-center justify-center gap-2">
            <Link
              href="/dashboard"
              aria-label="Home"
              className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-white/15 bg-white/5"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10.5Z" fill="currentColor" />
              </svg>
            </Link>

            <Link
              href={{ pathname: '/dashboard', query: { panel: 'sessions' } }}
              aria-label="Sessions"
              className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-white/15 bg-white/5"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M7 2v2H5a2 2 0 0 0-2 2v2h18V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7Zm14 8H3v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V10Zm-13 3h4v4H8v-4Z" fill="currentColor" />
              </svg>
            </Link>

            <Link
              href={{ pathname: '/dashboard', query: { panel: 'announcements' } }}
              aria-label="Announcements"
              className="relative inline-flex items-center justify-center h-10 w-10 rounded-xl border border-white/15 bg-white/5"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2Zm6-6V11c0-3.07-1.63-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2Z" fill="currentColor" />
              </svg>
              {unreadCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-[10px] leading-4 text-white text-center"
                  aria-label={`${unreadCount} unread announcements`}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>

            <Link
              href="/profile"
              aria-label="Settings"
              className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-white/15 bg-white/5"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 12.9 1h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L1.71 7.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.3.6.22l2.39-.96c.51.4 1.05.71 1.63.94l.36 2.54c.04.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM11 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" fill="currentColor" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}
