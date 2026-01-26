import { useRouter } from 'next/router'
import { useSession } from 'next-auth/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import AccountControlOverlay from './AccountControlOverlay'
import FullScreenGlassOverlay from './FullScreenGlassOverlay'
import UserLink from './UserLink'

type AnnouncementLike = {
  id?: string | number | null
  title?: string | null
  content?: string | null
  createdAt?: string | null
  grade?: string | null
}

type GroupInviteLike = {
  id: string
  createdAt?: string | null
  group?: { id: string; name?: string | null; grade?: string | null; type?: string | null } | null
  invitedBy?: { id?: string | null; name?: string | null; email?: string | null } | null
}

type GroupJoinRequestLike = {
  id: string
  createdAt?: string | null
  group?: { id: string; name?: string | null; grade?: string | null; type?: string | null } | null
  requestedBy?: { id?: string | null; name?: string | null; email?: string | null } | null
}

type ActivityNotification = {
  id: string
  type?: string | null
  title?: string | null
  body?: string | null
  createdAt?: string | null
  readAt?: string | null
  data?: any
  actor?: { id: string; name?: string | null; email?: string | null; avatar?: string | null; role?: string | null } | null
}

const useMobileTopChromeVisible = (pathname: string | undefined, authenticated: boolean) => {
  if (!authenticated) return false
  if (!pathname) return false

  // Full-screen / no-distraction learning surfaces.
  if (pathname === '/board') return false
  if (pathname === '/diagram') return false
  if (pathname === '/jaas-demo') return false
  if (pathname === '/sessions/[sessionId]/assignments/[assignmentId]/q/[questionId]') return false

  return true
}

export default function MobileTopChrome() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const isVisible = useMobileTopChromeVisible(router.pathname, status === 'authenticated')

  const [open, setOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [accountControlOpen, setAccountControlOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [unreadCount, setUnreadCount] = useState(0)
  const [announcements, setAnnouncements] = useState<AnnouncementLike[]>([])
  const [readIds, setReadIds] = useState<string[]>([])
  const fetchAbortRef = useRef<AbortController | null>(null)

  const [actionLoading, setActionLoading] = useState(false)
  const [actionInvites, setActionInvites] = useState<GroupInviteLike[]>([])
  const [actionJoinRequests, setActionJoinRequests] = useState<GroupJoinRequestLike[]>([])
  const [activityFeed, setActivityFeed] = useState<ActivityNotification[]>([])
  const [expandedInviteId, setExpandedInviteId] = useState<string | null>(null)
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null)
  const [newNotificationIds, setNewNotificationIds] = useState<string[]>([])
  const notificationSessionRef = useRef<string>('')

  const userKey = useMemo(() => {
    if (!session) return 'anon'
    const s: any = session
    return session.user?.email || s?.user?.id || session.user?.name || 'anon'
  }, [session])

  const readStorageKey = useMemo(() => `pa:readAnnouncements:${userKey}`, [userKey])
  const seenNotificationKey = useMemo(() => `pa:seenNotifications:${userKey}`, [userKey])
  const claimedNotificationKey = useMemo(() => `pa:claimedNotifications:${userKey}`, [userKey])

  const readSet = useMemo(() => new Set(readIds), [readIds])

  const persistReadIds = useCallback((next: string[]) => {
    setReadIds(next)
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(readStorageKey, JSON.stringify(next))
    } catch {}
  }, [readStorageKey])

  const markRead = useCallback((id: string) => {
    if (!id) return
    if (readSet.has(id)) return
    const next = Array.from(new Set([...readIds, id]))
    persistReadIds(next)
  }, [persistReadIds, readIds, readSet])

  const computeUnread = useCallback((items: AnnouncementLike[], ids: Set<string>) => {
    if (!items || items.length === 0) return 0
    let count = 0
    for (const a of items) {
      const id = a?.id
      if (id != null && !ids.has(String(id))) count += 1
    }
    return count
  }, [])

  const loadActionNotifications = useCallback(async () => {
    if (status !== 'authenticated') return
    setActionLoading(true)
    try {
      const res = await fetch('/api/notifications', { credentials: 'same-origin' })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setActionInvites([])
        setActionJoinRequests([])
        setActivityFeed([])
        return
      }
      setActionInvites(Array.isArray(data?.invites) ? data.invites : [])
      setActionJoinRequests(Array.isArray(data?.joinRequests) ? data.joinRequests : [])
      setActivityFeed(Array.isArray(data?.activity) ? data.activity : [])
    } catch {
      setActionInvites([])
      setActionJoinRequests([])
      setActivityFeed([])
    } finally {
      setActionLoading(false)
    }
  }, [status])

  const respondInvite = useCallback(async (inviteId: string, action: 'accept' | 'decline') => {
    if (!inviteId) return
    try {
      const res = await fetch(`/api/groups/invites/${encodeURIComponent(inviteId)}/respond`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        alert(data?.message || 'Failed')
        return
      }
      setExpandedInviteId(null)
      await loadActionNotifications()
    } catch (err: any) {
      alert(err?.message || 'Failed')
    }
  }, [loadActionNotifications])

  const respondJoinRequest = useCallback(async (requestId: string, action: 'accept' | 'decline') => {
    if (!requestId) return
    try {
      const res = await fetch(`/api/groups/requests/${encodeURIComponent(requestId)}/respond`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        alert(data?.message || 'Failed')
        return
      }
      setExpandedRequestId(null)
      await loadActionNotifications()
    } catch (err: any) {
      alert(err?.message || 'Failed')
    }
  }, [loadActionNotifications])

  useEffect(() => {
    if (!isVisible) return
    if (typeof window === 'undefined') return

    const existingSessionId = window.sessionStorage.getItem('pa:notificationSessionId')
    if (existingSessionId) {
      notificationSessionRef.current = existingSessionId
    } else {
      const nextId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      notificationSessionRef.current = nextId
      window.sessionStorage.setItem('pa:notificationSessionId', nextId)
    }

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

    const queryGradeRaw = Array.isArray(router.query?.grade) ? router.query.grade[0] : router.query?.grade
    const queryGrade = typeof queryGradeRaw === 'string' ? queryGradeRaw : undefined

    const gradeForAdmin = queryGrade || grade

    if (role === 'admin' && !gradeForAdmin) {
      // Admin announcement endpoint requires a grade query parameter.
      setAnnouncements([])
      return () => controller.abort()
    }

    const url = (() => {
      // Admin endpoint needs a grade query param; fall back to session grade when available.
      if (role === 'admin' && gradeForAdmin) return `/api/announcements?grade=${encodeURIComponent(gradeForAdmin)}`
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
    if (status !== 'authenticated') return

    void loadActionNotifications()
    const intervalId = window.setInterval(() => {
      void loadActionNotifications()
    }, 30000)

    const handleFocus = () => {
      void loadActionNotifications()
    }
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleFocus)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleFocus)
    }
  }, [isVisible, loadActionNotifications, status])

  useEffect(() => {
    if (!isVisible) return
    const announcementUnread = computeUnread(announcements, readSet)
    const actionUnread = (actionInvites?.length || 0) + (actionJoinRequests?.length || 0)
    const activityUnread = activityFeed.filter((n) => !n?.readAt).length
    setUnreadCount(announcementUnread + actionUnread + activityUnread)
  }, [actionInvites, actionJoinRequests, activityFeed, announcements, computeUnread, isVisible, readSet])

  useEffect(() => {
    if (!isVisible) return
    if (typeof window === 'undefined') return
    if (!notificationSessionRef.current) return

    const collectIds = () => {
      const ids: string[] = []
      announcements.forEach(a => a?.id != null && ids.push(`announcement:${String(a.id)}`))
      actionInvites.forEach(inv => inv?.id && ids.push(`invite:${String(inv.id)}`))
      actionJoinRequests.forEach(req => req?.id && ids.push(`join:${String(req.id)}`))
      activityFeed.forEach(act => act?.id && ids.push(`activity:${String(act.id)}`))
      return ids
    }

    const readSetFromStorage = () => {
      try {
        const raw = window.localStorage.getItem(seenNotificationKey)
        const parsed = raw ? JSON.parse(raw) : []
        return new Set(Array.isArray(parsed) ? parsed.map(String) : [])
      } catch {
        return new Set<string>()
      }
    }

    const readClaims = () => {
      try {
        const raw = window.localStorage.getItem(claimedNotificationKey)
        const parsed = raw ? JSON.parse(raw) : {}
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    const writeClaims = (claims: Record<string, string>) => {
      try {
        window.localStorage.setItem(claimedNotificationKey, JSON.stringify(claims))
      } catch {}
    }

    const ids = collectIds()
    const seen = readSetFromStorage()
    announcements.forEach(a => {
      const id = a?.id == null ? '' : String(a.id)
      if (!id) return
      if (readSet.has(id)) seen.add(`announcement:${id}`)
    })
    const claims = readClaims()
    const nextNew: string[] = []
    let claimsChanged = false

    ids.forEach((id) => {
      if (seen.has(id)) return
      const claimedBy = claims[id]
      if (claimedBy && claimedBy !== notificationSessionRef.current) return
      if (!claimedBy) {
        claims[id] = notificationSessionRef.current
        claimsChanged = true
      }
      nextNew.push(id)
    })

    if (claimsChanged) writeClaims(claims)
    setNewNotificationIds(nextNew)
  }, [actionInvites, actionJoinRequests, activityFeed, announcements, claimedNotificationKey, isVisible, readSet, seenNotificationKey])

  const showChrome = useCallback(() => {
    setOpen(true)
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
    // Keep chrome visible while notifications sheet is open.
    if (!notificationsOpen) {
      hideTimeoutRef.current = setTimeout(() => {
        setOpen(false)
        hideTimeoutRef.current = null
      }, 1500)
    }
  }, [])

  useEffect(() => {
    // If the notifications overlay is opened, keep the chrome visible.
    if (!notificationsOpen) return
    setOpen(true)
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
  }, [notificationsOpen])


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

  const acknowledgeNewNotifications = () => {
    if (typeof window === 'undefined') return
    if (newNotificationIds.length === 0) return
    try {
      const raw = window.localStorage.getItem(seenNotificationKey)
      const parsed = raw ? JSON.parse(raw) : []
      const seen = new Set(Array.isArray(parsed) ? parsed.map(String) : [])
      newNotificationIds.forEach(id => seen.add(id))
      window.localStorage.setItem(seenNotificationKey, JSON.stringify(Array.from(seen)))
    } catch {}

    try {
      const raw = window.localStorage.getItem(claimedNotificationKey)
      const claims = raw ? JSON.parse(raw) : {}
      if (claims && typeof claims === 'object') {
        newNotificationIds.forEach(id => delete claims[id])
        window.localStorage.setItem(claimedNotificationKey, JSON.stringify(claims))
      }
    } catch {}

    setNewNotificationIds([])
  }

  const openNotifications = () => {
    setNotificationsOpen(true)
    setOpen(true)
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
    acknowledgeNewNotifications()
    void loadActionNotifications()
  }

  const markActivityNotificationRead = useCallback(async (id: string) => {
    const targetId = String(id || '')
    if (!targetId) return
    const match = activityFeed.find((n) => String(n.id) === targetId)
    if (match?.readAt) return
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [targetId] }),
      })
      const nowIso = new Date().toISOString()
      setActivityFeed((prev) => prev.map((n) => String(n.id) === targetId ? { ...n, readAt: nowIso } : n))
    } catch {
      // ignore
    }
  }, [activityFeed])

  const closeNotifications = () => {
    setNotificationsOpen(false)
    setExpandedId(null)
    setExpandedInviteId(null)
    setExpandedRequestId(null)
  }

  const openNotificationTarget = useCallback((n: ActivityNotification) => {
    const type = String(n?.type || '')
    const payload = (n as any)?.data || {}
    const challengeId = typeof payload?.challengeId === 'string' ? payload.challengeId : ''
    const responderId = typeof payload?.responderId === 'string' ? payload.responderId : ''
    const responseId = typeof payload?.responseId === 'string' ? payload.responseId : ''
    const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : ''
    const assignmentId = typeof payload?.assignmentId === 'string' ? payload.assignmentId : ''
    const assignmentUserId = typeof payload?.userId === 'string' ? payload.userId : ''
    const followerId = typeof payload?.followerId === 'string' ? payload.followerId : ''
    const groupId = typeof payload?.groupId === 'string' ? payload.groupId : ''
    const newUserId = typeof payload?.newUserId === 'string' ? payload.newUserId : ''
    const updatedById = typeof payload?.updatedById === 'string' ? payload.updatedById : ''
    const schoolUserId = newUserId || updatedById

    if (type === 'challenge_response') {
      const query: Record<string, string> = {
        manageChallenge: challengeId || '',
        userId: responderId || '',
      }
      if (responseId) query.responseId = responseId
      if (query.manageChallenge && query.userId) {
        closeNotifications()
        void router.push({ pathname: '/dashboard', query })
        return true
      }
    }

    if (type === 'challenge_graded') {
      if (challengeId) {
        closeNotifications()
        void router.push({ pathname: '/dashboard', query: { viewChallengeResponse: challengeId } })
        return true
      }
      if (responseId) {
        closeNotifications()
        void router.push({ pathname: '/dashboard', query: { viewChallengeResponse: responseId } })
        return true
      }
    }

    if (type === 'assignment_submitted') {
      if (sessionId && assignmentId) {
        const query: Record<string, string> = {
          panel: 'sessions',
          assignmentSessionId: sessionId,
          assignmentId,
        }
        if (assignmentUserId) query.submissionUserId = assignmentUserId
        closeNotifications()
        void router.push({ pathname: '/dashboard', query })
        return true
      }
    }

    if (type === 'assignment_graded') {
      if (sessionId && assignmentId) {
        closeNotifications()
        void router.push({ pathname: '/dashboard', query: { panel: 'sessions', assignmentSessionId: sessionId, assignmentId } })
        return true
      }
    }

    if (type === 'new_follower') {
      if (followerId) {
        closeNotifications()
        void router.push(`/u/${encodeURIComponent(followerId)}`)
        return true
      }
    }

    if (type === 'new_challenge') {
      if (challengeId) {
        closeNotifications()
        void router.push(`/challenges/${encodeURIComponent(challengeId)}`)
        return true
      }
    }

    if (
      type === 'group_invite' ||
      type === 'group_invite_response' ||
      type === 'group_join_request' ||
      type === 'group_join_request_response' ||
      type === 'group_joined'
    ) {
      const query: Record<string, string> = { panel: 'groups' }
      if (groupId) query.groupId = groupId
      closeNotifications()
      void router.push({ pathname: '/dashboard', query })
      return true
    }

    if (type === 'account_verified') {
      closeNotifications()
      void router.push('/profile')
      return true
    }

    if (type === 'school_manual_entry') {
      if (schoolUserId) {
        closeNotifications()
        void router.push(`/u/${encodeURIComponent(schoolUserId)}`)
        return true
      }
      closeNotifications()
      void router.push({ pathname: '/dashboard', query: { panel: 'users' } })
      return true
    }

    return false
  }, [router])

  const notificationTypeMeta = (rawType: string) => {
    const type = String(rawType || '')
    if (type === 'new_follower') {
      return {
        badgeClass: 'bg-emerald-500',
        icon: (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" fill="currentColor" />
            <path d="M4 20a8 8 0 0 1 16 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ),
      }
    }
    if (type === 'challenge_response' || type === 'new_challenge') {
      return {
        badgeClass: 'bg-blue-500',
        icon: (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 20h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        ),
      }
    }
    if (type === 'challenge_graded' || type === 'assignment_graded' || type === 'assignment_submitted') {
      return {
        badgeClass: 'bg-amber-500',
        icon: (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 12l4 4 12-12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      }
    }
    if (type === 'group_invite' || type === 'group_invite_response' || type === 'group_join_request' || type === 'group_join_request_response' || type === 'group_joined') {
      return {
        badgeClass: 'bg-purple-500',
        icon: (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M16 11a3 3 0 1 0-2.999-3A3 3 0 0 0 16 11Z" stroke="currentColor" strokeWidth="2" />
            <path d="M8 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3Z" stroke="currentColor" strokeWidth="2" />
            <path d="M16 13c2.761 0 5 1.567 5 3.5V19H11v-2.5C11 14.567 13.239 13 16 13Z" stroke="currentColor" strokeWidth="2" />
            <path d="M8 13c2.761 0 5 1.567 5 3.5V19H3v-2.5C3 14.567 5.239 13 8 13Z" stroke="currentColor" strokeWidth="2" />
          </svg>
        ),
      }
    }
    if (type === 'account_verified') {
      return {
        badgeClass: 'bg-sky-500',
        icon: (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9.0 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" fill="currentColor" />
          </svg>
        ),
      }
    }
    return {
      badgeClass: 'bg-white/40',
      icon: (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2Zm6-6V11c0-3.07-1.63-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2Z" fill="currentColor" />
        </svg>
      ),
    }
  }

  const closeAccountControl = () => {
    setAccountControlOpen(false)
  }

  const toggleAnnouncement = (idRaw: string | number | null | undefined) => {
    const id = idRaw == null ? '' : String(idRaw)
    if (!id) return
    setExpandedId(prev => (prev === id ? null : id))
    markRead(id)
  }

  const toggleInvite = (idRaw: string | null | undefined) => {
    const id = idRaw ? String(idRaw) : ''
    if (!id) return
    setExpandedInviteId(prev => (prev === id ? null : id))
  }

  const toggleJoinRequest = (idRaw: string | null | undefined) => {
    const id = idRaw ? String(idRaw) : ''
    if (!id) return
    setExpandedRequestId(prev => (prev === id ? null : id))
  }

  return (
    <>
      {newNotificationIds.length > 0 && !notificationsOpen && (
        <div className="fixed top-2 left-2 right-2 z-50 md:hidden">
          <div className="mx-auto w-fit">
            <button
              type="button"
              aria-label={`${newNotificationIds.length} new notifications`}
              className="relative inline-flex items-center justify-center h-10 w-10 text-white"
              onClick={() => {
                openNotifications()
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2Zm6-6V11c0-3.07-1.63-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2Z" fill="currentColor" />
              </svg>
              <span
                className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-[10px] leading-4 text-white text-center"
                aria-label={`${newNotificationIds.length} new notifications`}
              >
                {newNotificationIds.length > 99 ? '99+' : newNotificationIds.length}
              </span>
            </button>
          </div>
        </div>
      )}
      <div
        data-mobile-top-chrome
        className={`fixed top-2 left-2 right-2 z-50 md:hidden transition-opacity ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <div className="mx-auto w-fit max-w-full rounded-2xl border border-white/15 bg-white/10 backdrop-blur px-2 py-2">
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              aria-label="Home"
              className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-white/15 bg-white/5"
              onClick={() => router.push('/dashboard')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10.5Z" fill="currentColor" />
              </svg>
            </button>

            <button
              type="button"
              aria-label="Sessions"
              className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-white/15 bg-white/5"
              onClick={() => router.push({ pathname: '/dashboard', query: { panel: 'sessions' } })}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M7 2v2H5a2 2 0 0 0-2 2v2h18V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7Zm14 8H3v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V10Zm-13 3h4v4H8v-4Z" fill="currentColor" />
              </svg>
            </button>

            <button
              type="button"
              aria-label="Notifications"
              className="relative inline-flex items-center justify-center h-10 w-10 rounded-xl border border-white/15 bg-white/5"
              onClick={() => {
                // If already open, close; otherwise open as an overlay sheet.
                if (notificationsOpen) {
                  closeNotifications()
                } else {
                  openNotifications()
                }
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2Zm6-6V11c0-3.07-1.63-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2Z" fill="currentColor" />
              </svg>
              {unreadCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-[10px] leading-4 text-white text-center"
                  aria-label={`${unreadCount} unread notifications`}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            <button
              type="button"
              aria-label="Settings"
              className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-white/15 bg-white/5"
              onClick={() => {
                closeNotifications()
                setAccountControlOpen(true)
                setOpen(true)
                if (hideTimeoutRef.current) {
                  clearTimeout(hideTimeoutRef.current)
                  hideTimeoutRef.current = null
                }
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 12.9 1h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L1.71 7.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.3.6.22l2.39-.96c.51.4 1.05.71 1.63.94l.36 2.54c.04.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM11 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" fill="currentColor" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {notificationsOpen && (
        <FullScreenGlassOverlay
          title="Notifications"
          onClose={closeNotifications}
          onBackdropClick={closeNotifications}
          zIndexClassName="z-[60] md:hidden"
          className="md:hidden"
          mobileChromeIgnore
          frameClassName="absolute inset-0 px-2 pt-14 pb-3"
          panelClassName="rounded-3xl bg-white/5"
          contentClassName="p-3"
        >
          <div className="space-y-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">Group invites</div>
                    <button
                      type="button"
                      className="text-xs text-white/80 underline"
                      onClick={() => void loadActionNotifications()}
                      disabled={actionLoading}
                    >
                      Refresh
                    </button>
                  </div>

                  {actionLoading ? (
                    <div className="mt-2 text-sm text-white/70">Loading…</div>
                  ) : actionInvites.length === 0 ? (
                    <div className="mt-2 text-sm text-white/70">No invites.</div>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {actionInvites.map((inv) => {
                        const id = String(inv.id)
                        const isExpanded = expandedInviteId === id
                        const title = inv.group?.name ? `Join ${inv.group.name}` : 'Group invite'
                        const by = inv.invitedBy?.name || inv.invitedBy?.email || 'someone'
                        const invitedById = inv.invitedBy?.id ?? null
                        return (
                          <div key={id} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-3">
                            <button type="button" className="w-full text-left" onClick={() => toggleInvite(id)}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-white truncate">{title}</div>
                                  <div className="text-xs text-white/70 truncate">
                                    Invited by{' '}
                                    <UserLink userId={invitedById} className="text-white/80 hover:underline" title="View profile">
                                      {by}
                                    </UserLink>
                                  </div>
                                  {inv.createdAt ? <div className="text-[11px] text-white/60">{new Date(inv.createdAt).toLocaleString()}</div> : null}
                                </div>
                                <div className="shrink-0 text-white/70">{isExpanded ? '▲' : '▼'}</div>
                              </div>
                            </button>
                            {isExpanded && (
                              <div className="mt-2 flex gap-2">
                                <button type="button" className="btn btn-secondary" onClick={() => void respondInvite(id, 'accept')}>
                                  Accept
                                </button>
                                <button type="button" className="btn btn-ghost border border-white/20 text-white" onClick={() => void respondInvite(id, 'decline')}>
                                  Reject
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {actionJoinRequests.length > 0 && (
                  <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-3">
                    <div className="text-sm font-semibold text-white">Join requests (your groups)</div>
                    <div className="mt-2 space-y-2">
                      {actionJoinRequests.map((r) => {
                        const id = String(r.id)
                        const isExpanded = expandedRequestId === id
                        const who = r.requestedBy?.name || r.requestedBy?.email || 'Learner'
                        const whoId = r.requestedBy?.id ?? null
                        const groupName = r.group?.name || 'Group'
                        return (
                          <div key={id} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-3">
                            <button type="button" className="w-full text-left" onClick={() => toggleJoinRequest(id)}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-white truncate">
                                    <UserLink userId={whoId} className="text-white hover:underline" title="View profile">
                                      {who}
                                    </UserLink>{' '}
                                    → {groupName}
                                  </div>
                                  {r.createdAt ? <div className="text-[11px] text-white/60">{new Date(r.createdAt).toLocaleString()}</div> : null}
                                </div>
                                <div className="shrink-0 text-white/70">{isExpanded ? '▲' : '▼'}</div>
                              </div>
                            </button>
                            {isExpanded && (
                              <div className="mt-2 flex gap-2">
                                <button type="button" className="btn btn-secondary" onClick={() => void respondJoinRequest(id, 'accept')}>
                                  Accept
                                </button>
                                <button type="button" className="btn btn-ghost border border-white/20 text-white" onClick={() => void respondJoinRequest(id, 'decline')}>
                                  Reject
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">Activity</div>
                    <button
                      type="button"
                      className="text-xs text-white/80 underline"
                      onClick={() => void loadActionNotifications()}
                      disabled={actionLoading}
                    >
                      Refresh
                    </button>
                  </div>

                  {actionLoading ? (
                    <div className="mt-2 text-sm text-white/70">Loading…</div>
                  ) : activityFeed.length === 0 ? (
                    <div className="mt-2 text-sm text-white/70">No activity yet.</div>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {activityFeed.map((n) => {
                        const id = String(n.id)
                        const isUnread = !n.readAt
                        const title = String(n.title || 'Notification')
                        const body = String(n.body || '')
                        const createdAt = n.createdAt ? new Date(n.createdAt).toLocaleString() : ''
                        const actor = n.actor || null
                        const actorName = (actor?.name || actor?.email || 'System').trim()
                        const actorInitial = actorName ? actorName.slice(0, 1).toUpperCase() : 'U'
                        const meta = notificationTypeMeta(String(n.type || ''))
                        return (
                          <div
                            key={id}
                            className={`rounded-2xl border backdrop-blur p-3 ${isUnread ? 'border-blue-300/40 bg-white/10' : 'border-white/10 bg-white/5'}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              void markActivityNotificationRead(id)
                              openNotificationTarget(n)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                void markActivityNotificationRead(id)
                                openNotificationTarget(n)
                              }
                            }}
                          >
                            <div className="flex items-start gap-3">
                              <div className="relative h-10 w-10 rounded-full border border-white/15 bg-white/5 overflow-hidden flex items-center justify-center text-white/90 shrink-0">
                                {actor?.avatar ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={actor.avatar} alt={actorName} className="h-full w-full object-cover" />
                                ) : (
                                  <span className="text-sm font-semibold">{actorInitial}</span>
                                )}
                                <span className={`absolute -bottom-1 -right-1 h-5 w-5 rounded-full border border-white/20 text-white flex items-center justify-center ${meta.badgeClass}`}>
                                  {meta.icon}
                                </span>
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-sm font-semibold text-white truncate">{actorName}</div>
                                  {createdAt ? <div className="text-[11px] text-white/60 shrink-0">{createdAt}</div> : null}
                                </div>
                                <div className="text-xs text-white/80 mt-1 whitespace-pre-wrap break-words">{title}</div>
                                {body ? <div className="text-xs text-white/70 mt-1 whitespace-pre-wrap break-words">{body}</div> : null}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-3">
                  <div className="text-sm font-semibold text-white">Announcements</div>
                  {announcements.length === 0 ? (
                    <div className="mt-2 text-sm text-white/70">No announcements.</div>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {announcements.map((a) => {
                        const id = a?.id == null ? '' : String(a.id)
                        const isExpanded = id && expandedId === id
                        const isRead = id ? readSet.has(id) : true
                        return (
                          <div
                            key={id || Math.random().toString(36)}
                            className={`rounded-2xl border backdrop-blur p-3 ${isRead ? 'border-white/10 bg-white/5' : 'border-blue-300/40 bg-white/10'}`}
                          >
                            <button
                              type="button"
                              className="w-full text-left"
                              onClick={() => toggleAnnouncement(a?.id ?? null)}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-white truncate">{a?.title || 'Announcement'}</div>
                                  {a?.createdAt && (
                                    <div className="text-xs text-white/70">{new Date(a.createdAt).toLocaleString()}</div>
                                  )}
                                </div>
                                <div className="shrink-0 text-white/70">{isExpanded ? '▲' : '▼'}</div>
                              </div>
                              {isExpanded && a?.content && (
                                <div className="mt-2 text-sm text-white/85 whitespace-pre-wrap">{a.content}</div>
                              )}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {actionInvites.length === 0 && actionJoinRequests.length === 0 && announcements.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4 text-sm text-white/80">
                    No notifications yet.
                  </div>
                ) : null}
          </div>
        </FullScreenGlassOverlay>
      )}

      {accountControlOpen && typeof window !== 'undefined' && (
        createPortal(
          <AccountControlOverlay onRequestClose={closeAccountControl} />,
          document.body
        )
      )}
    </>
  )
}
