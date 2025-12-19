import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import JitsiRoom, { JitsiControls } from '../components/JitsiRoom'
import LiveOverlayWindow from '../components/LiveOverlayWindow'
import { getSession, useSession } from 'next-auth/react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { gradeToLabel, GRADE_VALUES, GradeValue, normalizeGradeInput } from '../lib/grades'

import BrandLogo from '../components/BrandLogo'

const StackedCanvasWindow = dynamic(() => import('../components/StackedCanvasWindow'), { ssr: false })
const WINDOW_PADDING_X = 0
const WINDOW_PADDING_Y = 12
const MOBILE_HERO_BG_MIN_WIDTH = 1280
const MOBILE_HERO_BG_MIN_HEIGHT = 720
const MOBILE_HERO_BG_MAX_WIDTH = 1920
const DASHBOARD_SECTIONS = [
  { id: 'overview', label: 'Overview', description: 'Grade & quick actions', roles: ['admin', 'teacher', 'student', 'guest'] },
  { id: 'live', label: 'Live Class', description: 'Join lessons & board', roles: ['admin', 'teacher', 'student'] },
  { id: 'announcements', label: 'Announcements', description: 'Communicate updates', roles: ['admin', 'teacher', 'student'] },
  { id: 'sessions', label: 'Sessions', description: 'Schedule classes & materials', roles: ['admin', 'teacher', 'student'] },
  { id: 'users', label: 'Learners', description: 'Manage enrolments', roles: ['admin'] },
  { id: 'billing', label: 'Billing', description: 'Subscription plans', roles: ['admin'] }
] as const

type SectionId = typeof DASHBOARD_SECTIONS[number]['id']
type SectionRole = typeof DASHBOARD_SECTIONS[number]['roles'][number]

type Announcement = {
  id: string
  title: string
  content: string
  grade: GradeValue
  createdAt: string
  createdBy?: string | null
}

type LessonMaterial = {
  id: string
  sessionId: string
  title: string
  filename: string
  url: string
  contentType?: string | null
  size?: number | null
  createdAt: string
  createdBy?: string | null
}

type LatexSave = {
  id: string
  sessionKey: string
  userId?: string | null
  userEmail?: string | null
  title: string
  latex: string
  shared: boolean
  filename?: string | null
  url?: string | null
  createdAt: string
}

type LiveWindowKind = 'canvas'

type WindowSnapshot = {
  position: { x: number; y: number }
  size: { width: number; height: number }
}

type LiveWindowConfig = {
  id: string
  kind: LiveWindowKind
  title: string
  subtitle?: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  minimized: boolean
  z: number
  mode: 'windowed' | 'fullscreen'
  windowedSnapshot: WindowSnapshot | null
}

export default function Dashboard() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const gradeOptions = useMemo(() => GRADE_VALUES.map(value => ({ value, label: gradeToLabel(value) })), [])
  const [selectedGrade, setSelectedGrade] = useState<GradeValue | null>(null)
  const [gradeReady, setGradeReady] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [title, setTitle] = useState('')
  const [joinUrl, setJoinUrl] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [minStartsAt, setMinStartsAt] = useState('')
  const [sessions, setSessions] = useState<any[]>([])
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [users, setUsers] = useState<any[] | null>(null)
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState('student')
  const [newGrade, setNewGrade] = useState<GradeValue | ''>('')
  const [plans, setPlans] = useState<any[]>([])
  const [planName, setPlanName] = useState('')
  const [planAmount, setPlanAmount] = useState<number | ''>('')
  const [plansLoading, setPlansLoading] = useState(false)
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [editPlanName, setEditPlanName] = useState('')
  const [editPlanAmount, setEditPlanAmount] = useState<number | ''>('')
  const [editPlanActive, setEditPlanActive] = useState(false)
  const [planSaving, setPlanSaving] = useState(false)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [expandedAnnouncementId, setExpandedAnnouncementId] = useState<string | null>(null)
  const [announcementsLoading, setAnnouncementsLoading] = useState(false)
  const [announcementsError, setAnnouncementsError] = useState<string | null>(null)
  const [subscriptionActive, setSubscriptionActive] = useState<boolean | null>(null)
  const [announcementTitle, setAnnouncementTitle] = useState('')
  const [announcementContent, setAnnouncementContent] = useState('')
  const [creatingAnnouncement, setCreatingAnnouncement] = useState(false)
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)
  const [materials, setMaterials] = useState<LessonMaterial[]>([])
  const [materialsLoading, setMaterialsLoading] = useState(false)
  const [materialsError, setMaterialsError] = useState<string | null>(null)
  const [materialTitle, setMaterialTitle] = useState('')
  const [materialFile, setMaterialFile] = useState<File | null>(null)
  const [materialUploading, setMaterialUploading] = useState(false)
  const [latexSaves, setLatexSaves] = useState<{ shared: LatexSave[]; mine: LatexSave[] }>({ shared: [], mine: [] })
  const [latexSavesLoading, setLatexSavesLoading] = useState(false)
  const [latexSavesError, setLatexSavesError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<SectionId>('overview')
  const [liveOverlayOpen, setLiveOverlayOpen] = useState(false)
  const [liveOverlayDismissed, setLiveOverlayDismissed] = useState(false)
  const [liveOverlayChromeVisible, setLiveOverlayChromeVisible] = useState(false)
  const [liveControls, setLiveControls] = useState<JitsiControls | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [liveWindows, setLiveWindows] = useState<LiveWindowConfig[]>([])
  const [mobilePanels, setMobilePanels] = useState<{ announcements: boolean; sessions: boolean }>({ announcements: false, sessions: false })
  const [stageBounds, setStageBounds] = useState({ width: 0, height: 0 })
  const [readAnnouncementIds, setReadAnnouncementIds] = useState<string[]>([])
  const [mobileHeroBgUrl, setMobileHeroBgUrl] = useState<string>(() => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#020b35"/>
      <stop offset="0.55" stop-color="#041448"/>
      <stop offset="1" stop-color="#031641"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1d4ed8" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#60a5fa" stop-opacity="0.15"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#sky)"/>
  <circle cx="1540" cy="260" r="220" fill="url(#glow)"/>
  <path d="M0 850 L420 620 L720 760 L980 560 L1280 720 L1600 600 L1920 760 L1920 1080 L0 1080 Z" fill="#041a5a" opacity="0.9"/>
  <path d="M0 910 L360 740 L660 860 L920 720 L1220 860 L1500 760 L1920 900 L1920 1080 L0 1080 Z" fill="#052a7a" opacity="0.55"/>
  <path d="M0 980 L420 920 L860 1000 L1220 940 L1580 1010 L1920 960 L1920 1080 L0 1080 Z" fill="#00122f" opacity="0.65"/>
</svg>`
    return `data:image/svg+xml,${encodeURIComponent(svg)}`
  })
  const [mobileHeroBgDragActive, setMobileHeroBgDragActive] = useState(false)
  const [mobileHeroBgEditVisible, setMobileHeroBgEditVisible] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const heroBgInputRef = useRef<HTMLInputElement | null>(null)
  const heroBgEditHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const windowZCounterRef = useRef(50)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const materialsRequestIdRef = useRef(0)
  const latexSavesRequestIdRef = useRef(0)

  const [subscriptionGatingEnabled, setSubscriptionGatingEnabled] = useState<boolean | null>(null)
  const [subscriptionGatingSaving, setSubscriptionGatingSaving] = useState(false)
  const [subscriptionGatingError, setSubscriptionGatingError] = useState<string | null>(null)

  const [sessionDetailsOpen, setSessionDetailsOpen] = useState(false)
  const [sessionDetailsIds, setSessionDetailsIds] = useState<string[]>([])
  const [sessionDetailsIndex, setSessionDetailsIndex] = useState(0)
  const [sessionDetailsView, setSessionDetailsView] = useState<'pastList' | 'details'>('details')
  const [sessionDetailsTab, setSessionDetailsTab] = useState<'materials' | 'latex'>('materials')

  const overlayBounds = useMemo(() => {
    const fallbackWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
    const fallbackHeight = typeof window === 'undefined' ? 768 : window.innerHeight
    return {
      width: stageBounds.width || fallbackWidth,
      height: stageBounds.height || fallbackHeight
    }
  }, [stageBounds.width, stageBounds.height])

  const sessionById = useMemo(() => {
    const map = new Map<string, any>()
    for (const s of sessions || []) {
      if (s?.id) map.set(String(s.id), s)
    }
    return map
  }, [sessions])

  const activeGradeLabel = gradeReady
    ? (selectedGrade ? gradeToLabel(selectedGrade) : 'Select a grade')
    : 'Resolving grade'
  const learnerName = session?.user?.name || session?.user?.email || 'Guest learner'
  const learnerAvatarUrl = (session as any)?.user?.image as string | undefined
  const learnerInitials = useMemo(() => {
    if (learnerName) {
      const parts = learnerName.trim().split(/\s+/).filter(Boolean)
      const letters = parts.slice(0, 2).map(part => part[0]?.toUpperCase() ?? '')
      const joined = letters.join('')
      if (joined) return joined
    }
    if (session?.user?.email) {
      return session.user.email.slice(0, 2).toUpperCase()
    }
    return 'PA'
  }, [learnerName, session?.user?.email])
  const learnerGradeText = status === 'authenticated' ? activeGradeLabel : 'Grade pending'
  const userRole = (session as any)?.user?.role as SectionRole | undefined
  const normalizedRole: SectionRole = userRole ?? 'guest'
  const isAdmin = normalizedRole === 'admin'
  const canManageAnnouncements = normalizedRole === 'admin' || normalizedRole === 'teacher'
  const isLearner = normalizedRole === 'student'
  const learnerNotesLabel = isLearner ? 'Saved notes' : 'LaTeX saves'
  const learnerNotesLabelLower = isLearner ? 'saved notes' : 'LaTeX saves'
  const effectiveSubscriptionGatingEnabled = subscriptionGatingEnabled ?? true
  const isSubscriptionBlocked = isLearner && effectiveSubscriptionGatingEnabled && subscriptionActive === false

  const announcementReadStorageKey = useMemo(() => {
    const userKey = session?.user?.email || (session as any)?.user?.id || session?.user?.name || 'anon'
    return `pa:readAnnouncements:${userKey}`
  }, [session])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(announcementReadStorageKey)
      const parsed = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed)) setReadAnnouncementIds(parsed.map(String))
    } catch {
      setReadAnnouncementIds([])
    }
  }, [announcementReadStorageKey])

  const readAnnouncementSet = useMemo(() => new Set(readAnnouncementIds), [readAnnouncementIds])
  const unreadAnnouncementCount = useMemo(() => {
    if (!announcements || announcements.length === 0) return 0
    let count = 0
    for (const a of announcements) {
      if (a?.id && !readAnnouncementSet.has(String(a.id))) count += 1
    }
    return count
  }, [announcements, readAnnouncementSet])

  const markAllAnnouncementsRead = useCallback(() => {
    if (typeof window === 'undefined') return
    if (!announcements || announcements.length === 0) return
    const next = new Set(readAnnouncementSet)
    for (const a of announcements) {
      if (a?.id) next.add(String(a.id))
    }
    const nextArr = Array.from(next)
    setReadAnnouncementIds(nextArr)
    try {
      window.localStorage.setItem(announcementReadStorageKey, JSON.stringify(nextArr))
    } catch {}
  }, [announcements, announcementReadStorageKey, readAnnouncementSet])

  const markAnnouncementRead = useCallback((announcementId: string) => {
    if (typeof window === 'undefined') return
    if (!announcementId) return
    if (readAnnouncementSet.has(String(announcementId))) return
    const next = new Set(readAnnouncementSet)
    next.add(String(announcementId))
    const nextArr = Array.from(next)
    setReadAnnouncementIds(nextArr)
    try {
      window.localStorage.setItem(announcementReadStorageKey, JSON.stringify(nextArr))
    } catch {}
  }, [announcementReadStorageKey, readAnnouncementSet])

  const mobileHeroBgStorageKey = useMemo(() => {
    const userKey = session?.user?.email || (session as any)?.user?.id || session?.user?.name || 'anon'
    return `pa:mobileHeroBg:${userKey}`
  }, [session])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(mobileHeroBgStorageKey)
      if (raw && typeof raw === 'string') setMobileHeroBgUrl(raw)
    } catch {}
  }, [mobileHeroBgStorageKey])

  const applyMobileHeroBackgroundFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please choose an image file.')
      return
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsDataURL(file)
    })

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not load image'))
      el.src = dataUrl
    })

    const w = img.naturalWidth || 0
    const h = img.naturalHeight || 0
    if (w < MOBILE_HERO_BG_MIN_WIDTH || h < MOBILE_HERO_BG_MIN_HEIGHT) {
      alert(`Image is too small. Minimum is ${MOBILE_HERO_BG_MIN_WIDTH}×${MOBILE_HERO_BG_MIN_HEIGHT}.`)
      return
    }
    if (w < h) {
      alert('Please use a landscape (wide) image.')
      return
    }

    const scale = Math.min(1, MOBILE_HERO_BG_MAX_WIDTH / w)
    const targetW = Math.max(1, Math.round(w * scale))
    const targetH = Math.max(1, Math.round(h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      alert('Could not process this image.')
      return
    }
    ctx.drawImage(img, 0, 0, targetW, targetH)

    const compressed = canvas.toDataURL('image/jpeg', 0.86)
    setMobileHeroBgUrl(compressed)
    try {
      window.localStorage.setItem(mobileHeroBgStorageKey, compressed)
    } catch {
      // Ignore storage failures (quota exceeded)
    }
  }, [mobileHeroBgStorageKey])

  useEffect(() => {
    if (status !== 'authenticated') {
      setSubscriptionActive(null)
      setSubscriptionGatingEnabled(null)
      setSubscriptionGatingError(null)
      return
    }
    let cancelled = false
    fetch('/api/subscription/status', { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return
        const gatingEnabled = typeof data?.gatingEnabled === 'boolean' ? data.gatingEnabled : true
        setSubscriptionGatingEnabled(gatingEnabled)
        setSubscriptionActive(isLearner ? Boolean(data?.active) : true)
      })
      .catch(() => {
        if (cancelled) return
        // Fail closed for learners.
        setSubscriptionGatingEnabled(true)
        setSubscriptionActive(isLearner ? false : true)
      })
    return () => { cancelled = true }
  }, [status, isLearner])

  const updateSubscriptionGating = useCallback(async (enabled: boolean) => {
    setSubscriptionGatingSaving(true)
    setSubscriptionGatingError(null)
    try {
      const res = await fetch('/api/subscription/gating', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ enabled })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || 'Failed to update gating')
      }
      setSubscriptionGatingEnabled(Boolean(data?.enabled))
    } catch (err: any) {
      setSubscriptionGatingError(err?.message || 'Failed to update gating')
    } finally {
      setSubscriptionGatingSaving(false)
    }
  }, [])
  const canUploadMaterials = normalizedRole === 'admin' || normalizedRole === 'teacher'
  const ownerEmail = process.env.NEXT_PUBLIC_OWNER_EMAIL || process.env.OWNER_EMAIL
  const isOwnerUser = Boolean(((session as any)?.user?.email && ownerEmail && (session as any)?.user?.email === ownerEmail) || isAdmin)
  const formatFileSize = (bytes?: number | null) => {
    if (!bytes || bytes <= 0) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  const gradeTokenEndpoint = useMemo(() => {
    if (!gradeReady || !selectedGrade) return null
    return `/api/sessions/grade/${selectedGrade}/token`
  }, [gradeReady, selectedGrade])
  const canLaunchCanvasOverlay = status === 'authenticated' && Boolean(selectedGrade)
  const canJoinLiveClass = canLaunchCanvasOverlay
  const getNextWindowZ = useCallback(() => {
    windowZCounterRef.current += 1
    return windowZCounterRef.current
  }, [])

  const clampWindowPosition = useCallback((win: LiveWindowConfig, position: { x: number; y: number }) => {
    if (win.mode === 'fullscreen') {
      return { x: 0, y: 0 }
    }
    const widthBase = Math.max(overlayBounds.width, win.size.width + WINDOW_PADDING_X * 2)
    const heightBase = Math.max(overlayBounds.height, (win.minimized ? 64 : win.size.height) + WINDOW_PADDING_Y * 2)
    const maxX = Math.max(WINDOW_PADDING_X, widthBase - win.size.width - WINDOW_PADDING_X)
    const maxY = Math.max(WINDOW_PADDING_Y, heightBase - (win.minimized ? 64 : win.size.height) - WINDOW_PADDING_Y)
    return {
      x: Math.min(Math.max(position.x, WINDOW_PADDING_X), maxX),
      y: Math.min(Math.max(position.y, WINDOW_PADDING_Y), maxY)
    }
  }, [overlayBounds.height, overlayBounds.width])

  const focusLiveWindow = useCallback((id: string) => {
    setLiveWindows(prev => prev.map(win => (win.id === id ? { ...win, z: getNextWindowZ() } : win)))
  }, [getNextWindowZ])

  const closeLiveWindow = useCallback((id: string) => {
    setLiveWindows(prev => prev.filter(win => win.id !== id))
  }, [])

  const toggleMinimizeLiveWindow = useCallback((id: string) => {
    setLiveWindows(prev => prev.map(win => {
      if (win.id !== id) return win
      if (win.mode === 'fullscreen') return win
      const nextMin = !win.minimized
      const clampedPosition = clampWindowPosition({ ...win, minimized: nextMin }, win.position)
      return { ...win, minimized: nextMin, position: clampedPosition, z: getNextWindowZ() }
    }))
  }, [clampWindowPosition, getNextWindowZ])

  const updateLiveWindowPosition = useCallback((id: string, position: { x: number; y: number }) => {
    setLiveWindows(prev => prev.map(win => {
      if (win.id !== id) return win
      if (win.mode === 'fullscreen') return win
      return { ...win, position: clampWindowPosition(win, position) }
    }))
  }, [clampWindowPosition])

  const resizeLiveWindow = useCallback((id: string, payload: { width: number; height: number; position: { x: number; y: number } }) => {
    setLiveWindows(prev => prev.map(win => {
      if (win.id !== id) return win
      if (win.mode === 'fullscreen') return win
      return { ...win, size: { width: payload.width, height: payload.height }, position: payload.position }
    }))
  }, [])

  const toggleMobilePanel = useCallback((panel: 'announcements' | 'sessions') => {
    setMobilePanels(prev => ({ ...prev, [panel]: !prev[panel] }))
  }, [])

  const closeMobileAnnouncements = useCallback(() => {
    setMobilePanels(prev => ({ ...prev, announcements: false }))
  }, [])

  const openMobileAnnouncements = useCallback(() => {
    setMobilePanels(prev => ({ ...prev, announcements: true }))
  }, [])

  useEffect(() => {
    if (!isMobile) return
    if (!router.isReady) return
    const rawPanel = Array.isArray(router.query.panel) ? router.query.panel[0] : router.query.panel
    const panel = typeof rawPanel === 'string' ? rawPanel : null
    if (panel === 'announcements') {
      openMobileAnnouncements()
    }
    if (panel === 'sessions') {
      setMobilePanels(prev => ({ ...prev, sessions: true }))
    }
  }, [isMobile, openMobileAnnouncements, router.isReady, router.query.panel])

  const showMobileHeroEdit = useCallback(() => {
    setMobileHeroBgEditVisible(true)
    if (heroBgEditHideTimeoutRef.current) {
      clearTimeout(heroBgEditHideTimeoutRef.current)
      heroBgEditHideTimeoutRef.current = null
    }
    heroBgEditHideTimeoutRef.current = setTimeout(() => {
      setMobileHeroBgEditVisible(false)
      heroBgEditHideTimeoutRef.current = null
    }, 2500)
  }, [])

  useEffect(() => {
    return () => {
      if (heroBgEditHideTimeoutRef.current) {
        clearTimeout(heroBgEditHideTimeoutRef.current)
      }
    }
  }, [])

  const toggleFullscreenLiveWindow = useCallback((id: string) => {
    setLiveWindows(prev => prev.map(win => {
      if (win.id !== id) return win
      if (win.mode === 'windowed') {
        const snapshot = { position: win.position, size: win.size }
        return {
          ...win,
          minimized: false,
          mode: 'fullscreen',
          windowedSnapshot: snapshot,
          position: { x: 0, y: 0 },
          size: { width: overlayBounds.width, height: overlayBounds.height },
          z: getNextWindowZ()
        }
      }
      const fallbackSnapshot = win.windowedSnapshot ?? {
        position: { x: WINDOW_PADDING_X, y: WINDOW_PADDING_Y },
        size: {
          width: Math.max(Math.round(overlayBounds.width * 0.65), 420),
          height: Math.max(Math.round(overlayBounds.height * 0.6), 320)
        }
      }
      const restoredPosition = clampWindowPosition({ ...win, minimized: false, size: fallbackSnapshot.size }, fallbackSnapshot.position)
      return {
        ...win,
        mode: 'windowed',
        windowedSnapshot: null,
        position: restoredPosition,
        size: fallbackSnapshot.size,
        z: getNextWindowZ()
      }
    }))
  }, [overlayBounds.height, overlayBounds.width, clampWindowPosition, getNextWindowZ])

  const showCanvasWindow = useCallback((sessionId?: string | null) => {
    if (!canLaunchCanvasOverlay) {
      alert('Sign in and choose a grade to open the shared canvas overlay.')
      return
    }

    if (isSubscriptionBlocked) {
      alert('A subscription is required to use session resources.')
      return
    }
    const nextSessionId = sessionId ?? activeSessionId
    if (!nextSessionId) {
      alert('Select a session before opening the canvas so your work is saved to the correct session.')
      return
    }
    if (nextSessionId !== activeSessionId) setActiveSessionId(nextSessionId)

    setLiveOverlayDismissed(false)
    setLiveOverlayOpen(true)
    const windowId = 'canvas-live-window'
    setLiveWindows(prev => {
      const existing = prev.find(win => win.id === windowId)
      if (existing) {
        return prev.map(win => win.id === windowId ? { ...win, minimized: false, z: getNextWindowZ() } : win)
      }
      const stageWidth = overlayBounds.width || (typeof window !== 'undefined' ? window.innerWidth : 1024)
      const stageHeight = overlayBounds.height || (typeof window !== 'undefined' ? window.innerHeight : 768)
      const windowedWidth = Math.max(Math.round(stageWidth * 0.65), 420)
      const windowedHeight = Math.max(Math.round(stageHeight * 0.6), 320)
      const windowedPosition = {
        x: Math.max((stageWidth - windowedWidth) / 2, WINDOW_PADDING_X),
        y: Math.max((stageHeight - windowedHeight) / 2, WINDOW_PADDING_Y)
      }
      const baseWindow: LiveWindowConfig = {
        id: windowId,
        kind: 'canvas',
        title: gradeReady ? activeGradeLabel : 'Canvas',
        subtitle: 'Canvas',
        position: { x: 0, y: 0 },
        size: { width: stageWidth, height: stageHeight },
        minimized: false,
        z: getNextWindowZ(),
        mode: 'fullscreen',
        windowedSnapshot: { position: windowedPosition, size: { width: windowedWidth, height: windowedHeight } }
      }
      return [...prev, baseWindow]
    })
  }, [canLaunchCanvasOverlay, isSubscriptionBlocked, overlayBounds.height, overlayBounds.width, gradeReady, activeGradeLabel, clampWindowPosition, getNextWindowZ, activeSessionId])

  const openLiveForSession = useCallback((sessionId: string) => {
    if (isSubscriptionBlocked) {
      alert('A subscription is required to join sessions.')
      return
    }
    setActiveSessionId(sessionId)
    setLiveOverlayDismissed(false)
    setLiveOverlayOpen(true)
  }, [isSubscriptionBlocked])

  const startLiveForSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/present`, {
        method: 'POST',
        credentials: 'same-origin'
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        alert(data?.message || `Failed to start session (${res.status})`)
        return
      }
      openLiveForSession(sessionId)
    } catch (err: any) {
      alert(err?.message || 'Network error')
    }
  }, [openLiveForSession])
  const handleShowLiveOverlay = () => {
    if (!canJoinLiveClass) return
    setLiveOverlayDismissed(false)
    setLiveOverlayOpen(true)
  }
  const closeLiveOverlay = () => {
    setLiveOverlayOpen(false)
    setLiveOverlayDismissed(true)
  }
  const handleLiveControl = (action: 'mute' | 'video' | 'leave') => {
    if (!liveControls) return
    if (action === 'mute') {
      liveControls.toggleAudio()
      return
    }
    if (action === 'video') {
      liveControls.toggleVideo()
      return
    }
    if (action === 'leave') {
      liveControls.hangup()
      setLiveOverlayOpen(false)
      setLiveOverlayDismissed(true)
    }
  }
  const gradeSlug = useMemo(() => (selectedGrade ? selectedGrade.toLowerCase().replace(/_/g, '-') : null), [selectedGrade])
  const gradeRoomName = useMemo(() => {
    const appId = process.env.NEXT_PUBLIC_JAAS_APP_ID || ''
    const baseSlug = gradeSlug ?? 'public-room'
    const base = `philani-${baseSlug}`
    return appId ? `${appId}/${base}` : base
  }, [gradeSlug])
  const boardRoomId = useMemo(() => (gradeSlug ? `myscript-grade-${gradeSlug}` : 'myscript-grade-public'), [gradeSlug])
  const overlayCanvasLabel = selectedGrade ? `Canvas (${gradeToLabel(selectedGrade)})` : 'Canvas workspace'
  const realtimeUserId = useMemo(() => {
    const candidate = (session as any)?.user?.id as string | undefined
    if (candidate && typeof candidate === 'string') return candidate
    if (session?.user?.email) return session.user.email
    if (session?.user?.name) return session.user.name
    return 'guest'
  }, [session])
  const realtimeDisplayName = session?.user?.name || session?.user?.email || 'Participant'
  const userGrade = normalizeGradeInput((session as any)?.user?.grade as string | undefined)
  const accountGradeLabel = status === 'authenticated'
    ? (userGrade ? gradeToLabel(userGrade) : 'Unassigned')
    : 'N/A'
  const formatPhoneDisplay = (value?: string | null) => {
    if (!value) return '—'
    if (value.startsWith('+27') && value.length === 12) return `0${value.slice(3)}`
    if (value.startsWith('27') && value.length === 11) return `0${value.slice(2)}`
    return value
  }
  const availableSections = useMemo(
    () => DASHBOARD_SECTIONS.filter(section => (section.roles as ReadonlyArray<SectionRole>).includes(normalizedRole)),
    [normalizedRole]
  )

  useEffect(() => {
    if (availableSections.length === 0) return
    if (!availableSections.some(section => section.id === activeSection)) {
      setActiveSection(availableSections[0].id)
    }
  }, [availableSections, activeSection])


  useEffect(() => {
    if (typeof window === 'undefined') return
    const updateViewport = () => {
      setIsMobile(window.innerWidth < 768)
    }
    updateViewport()
    window.addEventListener('resize', updateViewport)
    return () => window.removeEventListener('resize', updateViewport)
  }, [])

  const updateGradeSelection = (grade: GradeValue) => {
    if (selectedGrade === grade) return
    setSelectedGrade(grade)
    if (router.isReady) {
      const nextQuery = { ...router.query, grade }
      router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true })
    }
  }

  async function createSession(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedGrade) {
      alert('Select a grade before creating a session')
      return
    }
    try {
      // convert local datetime-local value to an ISO UTC string before sending
      let startsAtIso = startsAt
      if (startsAt) {
        const dt = new Date(startsAt)
        startsAtIso = dt.toISOString()
      }

      const res = await fetch('/api/create-session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, joinUrl, startsAt: startsAtIso, grade: selectedGrade })
      })

      if (res.ok) {
        alert('Session created')
        setTitle('')
        setJoinUrl('')
        setStartsAt('')
        fetchSessionsForGrade(selectedGrade)
        return
      }

      // Try to parse JSON response; fall back to plain text so we always show an error
      let data: any = null
      try {
        data = await res.json()
      } catch (err) {
        const txt = await res.text().catch(() => '')
        data = { message: txt || `HTTP ${res.status}` }
      }
      alert(data?.message || `Error: ${res.status}`)
    } catch (err: any) {
      // Network or unexpected error
      console.error('createSession error', err)
      alert(err?.message || 'Network error')
    }
  }

  async function fetchSessionsForGrade(gradeOverride?: GradeValue | null) {
    const gradeToFetch = gradeOverride ?? selectedGrade
    if (!gradeToFetch) {
      setSessions([])
      setSessionsError('Select a grade to view sessions.')
      return
    }
    setSessionsError(null)
    setSessions([])
    try {
      const res = await fetch(`/api/sessions?grade=${encodeURIComponent(gradeToFetch)}`, { credentials: 'same-origin' })
      if (res.ok) {
        const data = await res.json()
        setSessions(data)
        setSessionsError(null)
      } else {
        const data = await res.json().catch(() => ({}))
        if (res.status === 401) {
          setSessionsError('Please sign in to view grade-specific sessions.')
        } else {
          setSessionsError(data?.message || `Failed to load sessions (${res.status})`)
        }
      }
    } catch (err) {
      // Network or unexpected error
      console.error('fetchSessions error', err)
      setSessionsError(err instanceof Error ? err.message : 'Network error')
    }
  }

  async function fetchAnnouncementsForGrade(gradeOverride?: GradeValue | null) {
    const gradeToFetch = gradeOverride ?? selectedGrade
    if (!gradeToFetch) {
      setAnnouncements([])
      setAnnouncementsError('Select a grade to view announcements.')
      return
    }
    setAnnouncementsError(null)
    setAnnouncementsLoading(true)
    try {
      const res = await fetch(`/api/announcements?grade=${encodeURIComponent(gradeToFetch)}`, { credentials: 'same-origin' })
      if (res.ok) {
        const data = await res.json()
        setAnnouncements(Array.isArray(data) ? data : [])
      } else {
        const data = await res.json().catch(() => ({}))
        if (res.status === 401) {
          setAnnouncementsError('Please sign in to view announcements.')
        } else {
          setAnnouncementsError(data?.message || `Failed to load announcements (${res.status})`)
        }
        setAnnouncements([])
      }
    } catch (err) {
      console.error('fetchAnnouncements error', err)
      setAnnouncementsError(err instanceof Error ? err.message : 'Network error')
      setAnnouncements([])
    } finally {
      setAnnouncementsLoading(false)
    }
  }

  async function fetchMaterials(sessionId: string) {
    const requestId = ++materialsRequestIdRef.current
    setMaterialsError(null)
    setMaterialsLoading(true)
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/materials`, { credentials: 'same-origin' })
      if (res.ok) {
        const data = await res.json()
        if (materialsRequestIdRef.current !== requestId) return
        setMaterials(Array.isArray(data) ? data : [])
      } else {
        const data = await res.json().catch(() => ({}))
        if (materialsRequestIdRef.current !== requestId) return
        if (res.status === 401) {
          setMaterialsError('Please sign in to view lesson materials.')
        } else {
          setMaterialsError(data?.message || `Failed to load materials (${res.status})`)
        }
        setMaterials([])
      }
    } catch (err) {
      console.error('fetchMaterials error', err)
      if (materialsRequestIdRef.current !== requestId) return
      setMaterialsError(err instanceof Error ? err.message : 'Network error')
      setMaterials([])
    } finally {
      if (materialsRequestIdRef.current === requestId) setMaterialsLoading(false)
    }
  }

  async function fetchLatexSaves(sessionId: string) {
    const requestId = ++latexSavesRequestIdRef.current
    setLatexSavesError(null)
    setLatexSavesLoading(true)
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/latex-saves`, { credentials: 'same-origin' })
      if (res.ok) {
        const data = await res.json()
        const shared = Array.isArray(data?.shared) ? data.shared : []
        const mine = Array.isArray(data?.mine) ? data.mine : []
        if (latexSavesRequestIdRef.current !== requestId) return
        setLatexSaves({ shared, mine })
      } else {
        const data = await res.json().catch(() => ({}))
        if (latexSavesRequestIdRef.current !== requestId) return
        setLatexSavesError(data?.message || `Failed to load ${learnerNotesLabelLower} (${res.status})`)
        setLatexSaves({ shared: [], mine: [] })
      }
    } catch (err) {
      console.error('fetchLatexSaves error', err)
      if (latexSavesRequestIdRef.current !== requestId) return
      setLatexSavesError(err instanceof Error ? err.message : 'Network error')
      setLatexSaves({ shared: [], mine: [] })
    } finally {
      if (latexSavesRequestIdRef.current === requestId) setLatexSavesLoading(false)
    }
  }

  async function renameLatexSave(sessionId: string, saveId: string, currentTitle: string) {
    const nextTitle = prompt(isLearner ? 'Rename saved notes' : 'Rename LaTeX save', currentTitle)
    if (nextTitle === null) return
    const trimmed = nextTitle.trim()
    if (!trimmed) return
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/latex-saves/${encodeURIComponent(saveId)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data?.message || `Failed to rename save (${res.status})`)
        return
      }
      const updated = await res.json()
      setLatexSaves(prev => ({
        shared: prev.shared.map(s => s.id === saveId ? { ...s, title: updated.title } : s),
        mine: prev.mine.map(s => s.id === saveId ? { ...s, title: updated.title } : s)
      }))
    } catch (err: any) {
      alert(err?.message || 'Network error')
    }
  }

  async function deleteLatexSave(sessionId: string, saveId: string) {
    if (!confirm(isLearner ? 'Delete these saved notes? This cannot be undone.' : 'Delete this LaTeX save? This cannot be undone.')) return
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/latex-saves/${encodeURIComponent(saveId)}`, {
        method: 'DELETE',
        credentials: 'same-origin'
      })
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}))
        alert(data?.message || `Failed to delete save (${res.status})`)
        return
      }
      setLatexSaves(prev => ({
        shared: prev.shared.filter(s => s.id !== saveId),
        mine: prev.mine.filter(s => s.id !== saveId)
      }))
    } catch (err: any) {
      alert(err?.message || 'Network error')
    }
  }

  function resetMaterialForm() {
    setMaterialTitle('')
    setMaterialFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleMaterialFileChange(file: File | null) {
    setMaterialFile(file)
    if (file) {
      setMaterialTitle(prev => prev || file.name.replace(/\.[^.]+$/, ''))
    } else {
      setMaterialTitle('')
    }
  }

  const toggleMaterialsForSession = (sessionId: string) => {
    // Legacy name: this now opens the session details overlay.
    const id = String(sessionId || '')
    if (!id) return
    setSessionDetailsIds([id])
    setSessionDetailsIndex(0)
    setSessionDetailsView('details')
    setSessionDetailsTab('materials')
    setSessionDetailsOpen(true)
  }

  const closeSessionDetails = useCallback(() => {
    setSessionDetailsOpen(false)
    setSessionDetailsIds([])
    setSessionDetailsIndex(0)
    setSessionDetailsView('details')
    setSessionDetailsTab('materials')
    setExpandedSessionId(null)
    setMaterials([])
    setMaterialsError(null)
    setLatexSaves({ shared: [], mine: [] })
    setLatexSavesError(null)
    resetMaterialForm()
  }, [])

  const openSessionDetails = useCallback((ids: string[], initialIndex = 0) => {
    const safeIds = (ids || []).map(String).filter(Boolean)
    if (!safeIds.length) return
    const idx = Math.max(0, Math.min(initialIndex, safeIds.length - 1))
    setSessionDetailsIds(safeIds)
    setSessionDetailsIndex(idx)
    setSessionDetailsView('details')
    setSessionDetailsTab('materials')
    setSessionDetailsOpen(true)
  }, [])

  const openPastSessionsList = useCallback((ids: string[]) => {
    const safeIds = (ids || []).map(String).filter(Boolean)
    if (!safeIds.length) return
    setSessionDetailsIds(safeIds)
    setSessionDetailsIndex(0)
    setSessionDetailsView('pastList')
    setSessionDetailsTab('materials')
    setSessionDetailsOpen(true)
  }, [])

  const sessionDetailsSessionId = sessionDetailsIds[sessionDetailsIndex] || null
  const sessionDetailsSession = sessionDetailsSessionId ? sessionById.get(sessionDetailsSessionId) : null

  useEffect(() => {
    if (!sessionDetailsOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [sessionDetailsOpen])

  useEffect(() => {
    if (!sessionDetailsOpen) return
    if (sessionDetailsView !== 'details') return
    if (!sessionDetailsSessionId) return
    setActiveSessionId(sessionDetailsSessionId)
    setExpandedSessionId(sessionDetailsSessionId)
    setMaterials([])
    setMaterialsError(null)
    setLatexSaves({ shared: [], mine: [] })
    setLatexSavesError(null)
    resetMaterialForm()
    fetchMaterials(sessionDetailsSessionId)
    fetchLatexSaves(sessionDetailsSessionId)
  }, [sessionDetailsOpen, sessionDetailsView, sessionDetailsSessionId])

  async function uploadMaterial(e: React.FormEvent) {
    e.preventDefault()
    if (!expandedSessionId) {
      alert('Select a session before uploading materials')
      return
    }
    if (!materialFile) {
      alert('Choose a file to upload')
      return
    }
    const trimmedTitle = materialTitle.trim()
    const formData = new FormData()
    if (trimmedTitle) formData.append('title', trimmedTitle)
    formData.append('file', materialFile)

    setMaterialUploading(true)
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(expandedSessionId)}/materials`, {
        method: 'POST',
        credentials: 'same-origin',
        body: formData
      })
      if (res.ok) {
        resetMaterialForm()
        await fetchMaterials(expandedSessionId)
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data?.message || `Failed to upload material (${res.status})`)
      }
    } catch (err: any) {
      alert(err?.message || 'Network error')
    } finally {
      setMaterialUploading(false)
    }
  }

  async function deleteMaterial(id: string) {
    if (!confirm('Delete this material? This cannot be undone.')) return
    try {
      const res = await fetch(`/api/materials/${id}`, { method: 'DELETE', credentials: 'same-origin' })
      if (res.ok || res.status === 204) {
        setMaterials(prev => prev.filter(m => m.id !== id))
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data?.message || `Failed to delete material (${res.status})`)
      }
    } catch (err: any) {
      alert(err?.message || 'Network error')
    }
  }

  async function fetchUsers() {
    setUsersError(null)
    setUsersLoading(true)
    try {
      const res = await fetch('/api/users', { credentials: 'same-origin' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setUsersError(data?.message || `Error: ${res.status}`)
        setUsers(null)
      } else {
        const data = await res.json()
        setUsers(data)
      }
    } catch (err: any) {
      setUsersError(err?.message || 'Network error')
      setUsers(null)
    } finally {
      setUsersLoading(false)
    }
  }

  async function createAnnouncement(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedGrade) {
      alert('Select a grade before posting an announcement')
      return
    }
    const trimmedTitle = announcementTitle.trim()
    const trimmedContent = announcementContent.trim()
    if (!trimmedTitle || !trimmedContent) {
      alert('Title and content are required')
      return
    }
    setCreatingAnnouncement(true)
    try {
      const res = await fetch('/api/announcements', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: trimmedTitle, content: trimmedContent, grade: selectedGrade })
      })
      if (res.ok) {
        setAnnouncementTitle('')
        setAnnouncementContent('')
        fetchAnnouncementsForGrade(selectedGrade)
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data?.message || `Failed to create announcement (${res.status})`)
      }
    } catch (err: any) {
      alert(err?.message || 'Network error')
    } finally {
      setCreatingAnnouncement(false)
    }
  }

  async function deleteAnnouncement(id: string) {
    if (!confirm('Delete this announcement? This cannot be undone.')) return
    try {
      const res = await fetch(`/api/announcements/${id}`, { method: 'DELETE', credentials: 'same-origin' })
      if (res.ok || res.status === 204) {
        setAnnouncements(prev => prev.filter(a => a.id !== id))
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data?.message || `Failed to delete announcement (${res.status})`)
      }
    } catch (err: any) {
      alert(err?.message || 'Network error')
    }
  }

  const queryGradeParam = router.query?.grade
  const queryGradeString = Array.isArray(queryGradeParam) ? queryGradeParam[0] : queryGradeParam

  useEffect(() => {
    if (!router.isReady || gradeReady) return
    const normalizedQuery = normalizeGradeInput(typeof queryGradeString === 'string' ? queryGradeString : undefined)
    const sessionGrade = normalizeGradeInput((session as any)?.user?.grade as string | undefined)
    const role = (session as any)?.user?.role as string | undefined

    let resolved: GradeValue | null = normalizedQuery || null
    if (!resolved) {
      if ((role === 'student' || role === 'teacher') && sessionGrade) {
        resolved = sessionGrade
      }
    }
    if (!resolved) {
      resolved = 'GRADE_8'
    }

    if (resolved) {
      if (resolved !== normalizedQuery) {
        if (selectedGrade !== resolved) setSelectedGrade(resolved)
        const nextQuery = { ...router.query, grade: resolved }
        router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true })
      } else if (selectedGrade !== resolved) {
        setSelectedGrade(resolved)
      }
    }
    setGradeReady(true)
  }, [router.isReady, router.pathname, gradeReady, session, queryGradeString, selectedGrade])

  useEffect(() => {
    if (!gradeReady || !selectedGrade) return
    fetchSessionsForGrade(selectedGrade)
  }, [gradeReady, selectedGrade])

  useEffect(() => {
    if (activeSessionId) return
    if (!sessions || sessions.length === 0) return
    setActiveSessionId(sessions[0].id)
  }, [sessions, activeSessionId])

  useEffect(() => {
    if (!gradeReady || !selectedGrade) return
    fetchAnnouncementsForGrade(selectedGrade)
  }, [gradeReady, selectedGrade])

  const measureStage = useCallback(() => {
    if (!stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    setStageBounds({ width: rect.width, height: rect.height })
  }, [])

  useEffect(() => {
    measureStage()
    if (typeof window === 'undefined') return
    window.addEventListener('resize', measureStage)
    return () => window.removeEventListener('resize', measureStage)
  }, [measureStage])

  useEffect(() => {
    if (!liveOverlayOpen) return
    measureStage()
  }, [liveOverlayOpen, measureStage])

  useEffect(() => {
    setExpandedSessionId(null)
    setMaterials([])
    setMaterialsError(null)
    setMaterialTitle('')
    setMaterialFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [selectedGrade])

  useEffect(() => {
    setLiveWindows(prev => prev.map(win => (win.kind === 'canvas' ? { ...win, title: gradeReady ? activeGradeLabel : win.title } : win)))
  }, [gradeReady, activeGradeLabel])

  useEffect(() => {
    if (canLaunchCanvasOverlay) return
    setLiveWindows(prev => prev.filter(win => win.kind !== 'canvas'))
  }, [canLaunchCanvasOverlay])

  useEffect(() => {
    setLiveWindows(prev => prev.map(win => {
      if (win.mode === 'fullscreen') {
        const nextSize = { width: overlayBounds.width, height: overlayBounds.height }
        const isSameSize = win.size.width === nextSize.width && win.size.height === nextSize.height
        if (isSameSize && win.position.x === 0 && win.position.y === 0) return win
        return { ...win, size: nextSize, position: { x: 0, y: 0 } }
      }
      const clamped = clampWindowPosition(win, win.position)
      if (clamped.x === win.position.x && clamped.y === win.position.y) return win
      return { ...win, position: clamped }
    }))
  }, [overlayBounds, clampWindowPosition])


  useEffect(() => {
    if (!gradeReady) return
    if (liveOverlayDismissed) return
    if (status === 'authenticated' && normalizedRole !== 'guest') {
      setLiveOverlayOpen(true)
    }
  }, [status, normalizedRole, gradeReady, liveOverlayDismissed])

  useEffect(() => {
    if (!liveOverlayOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [liveOverlayOpen])

  useEffect(() => {
    if (!gradeReady) return
    if (newRole === 'admin') {
      setNewGrade('')
    } else if (!newGrade && selectedGrade) {
      setNewGrade(selectedGrade)
    }
  }, [newRole, selectedGrade, newGrade, gradeReady])
  // Prefill startsAt with the next minute and set a sensible min value
  useEffect(() => {
    const pad = (n: number) => n.toString().padStart(2, '0')
    const now = new Date()
    now.setSeconds(0, 0)
    now.setMinutes(now.getMinutes() + 1)
    const yyyy = now.getFullYear()
    const mm = pad(now.getMonth() + 1)
    const dd = pad(now.getDate())
    const hh = pad(now.getHours())
    const min = pad(now.getMinutes())
    const local = `${yyyy}-${mm}-${dd}T${hh}:${min}`
    setStartsAt(local)
    setMinStartsAt(local)
  }, [])
  useEffect(() => {
    // fetch users only for admins
    if ((session as any)?.user?.role === 'admin') {
      fetchUsers()
    }
  }, [session])

  useEffect(() => {
    // fetch plans for admins
    if ((session as any)?.user?.role === 'admin') {
      fetchPlans()
    }
    // Mark window global for JitsiRoom so it can disable prejoin for owner quickly
    try {
      const isOwner = ((session as any)?.user?.email === process.env.NEXT_PUBLIC_OWNER_EMAIL) || (session as any)?.user?.role === 'admin'
      ;(window as any).__JITSI_IS_OWNER__ = Boolean(isOwner)
    } catch (e) {}
  }, [session])
  async function fetchPlans() {
    setPlansLoading(true)
    try {
      const res = await fetch('/api/plans', { credentials: 'same-origin' })
      if (res.ok) {
        const data = await res.json()
        setPlans(data || [])
      }
    } catch (err) {
      // ignore for now
    } finally {
      setPlansLoading(false)
    }
  }

  function resetPlanEdit() {
    setEditingPlanId(null)
    setEditPlanName('')
    setEditPlanAmount('')
    setEditPlanActive(false)
    setPlanSaving(false)
  }

  function beginEditPlan(plan: any) {
    setEditingPlanId(plan.id)
    setEditPlanName(plan.name || '')
    setEditPlanAmount(typeof plan.amount === 'number' ? plan.amount : '')
    setEditPlanActive(Boolean(plan.active))
    setPlanSaving(false)
  }

  async function savePlanChanges() {
    if (!editingPlanId) return
    const trimmedName = editPlanName.trim()
    if (!trimmedName) {
      alert('Plan name is required')
      return
    }
    if (editPlanAmount === '' || editPlanAmount === null) {
      alert('Plan amount is required (cents)')
      return
    }
    const amountValue = typeof editPlanAmount === 'string' ? parseInt(editPlanAmount, 10) : editPlanAmount
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      alert('Plan amount must be greater than zero (in cents)')
      return
    }
    if (amountValue < 500) {
      alert('PayFast subscriptions require at least 500 cents (R5.00)')
      return
    }
    setPlanSaving(true)
    try {
      const res = await fetch(`/api/plans/${editingPlanId}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          amount: amountValue,
          active: editPlanActive
        })
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data?.message || `Failed to update plan (${res.status})`)
        return
      }

      resetPlanEdit()
      fetchPlans()
    } catch (err: any) {
      alert(err?.message || 'Network error while updating plan')
    } finally {
      setPlanSaving(false)
    }
  }

  const renderGradeWorkspaceCard = () => (
    <div className="card dashboard-card space-y-3">
      <h2 className="text-lg font-semibold">Grade workspace</h2>
      {status !== 'authenticated' ? (
        <p className="text-sm muted">Sign in to manage a grade workspace.</p>
      ) : !gradeReady ? (
        <p className="text-sm muted">Loading grade options...</p>
      ) : isAdmin ? (
        <div className="space-y-3">
          <p className="text-sm muted">Switch the active grade to manage sessions and announcements.</p>
          <div className="flex flex-wrap gap-3">
            {gradeOptions.map(option => (
              <label
                key={option.value}
                className={`px-3 py-2 rounded border text-sm cursor-pointer transition ${
                  selectedGrade === option.value ? 'border-blue-500 bg-blue-50 font-semibold' : 'border-slate-200 hover:border-blue-200'
                }`}
              >
                <input
                  type="radio"
                  name="active-grade"
                  value={option.value}
                  checked={selectedGrade === option.value}
                  onChange={() => updateGradeSelection(option.value)}
                  className="sr-only"
                />
                {option.label}
              </label>
            ))}
          </div>
          <p className="text-xs muted">Learners only see sessions, notes, and announcements for the selected grade.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm muted">
            You are currently in the <span className="font-medium text-white">{activeGradeLabel}</span> workspace.
          </p>
        </div>
      )}
    </div>
  )

  const renderAccountSnapshotCard = () => (
    <div className="card dashboard-card space-y-3">
      <h2 className="text-lg font-semibold">Account snapshot</h2>
      <dl className="grid gap-2 text-sm text-white">
        <div>
          <dt className="font-medium text-white">Email</dt>
          <dd>{session?.user?.email || 'Not signed in'}</dd>
        </div>
        <div>
          <dt className="font-medium text-white">Role</dt>
          <dd className="capitalize">{userRole || 'guest'}</dd>
        </div>
        <div>
          <dt className="font-medium text-white">Grade</dt>
          <dd>{status === 'authenticated' ? accountGradeLabel : 'N/A'}</dd>
        </div>
      </dl>
      <div className="flex flex-col sm:flex-row gap-2">
        <Link href="/profile" className="btn btn-ghost w-full sm:w-auto">Update profile</Link>
        <Link href="/subscribe" className="btn btn-primary w-full sm:w-auto">Manage subscription</Link>
      </div>
    </div>
  )

  const renderOverviewCards = (options?: { hideGradeWorkspace?: boolean }) => {
    const showGradeWorkspace = !options?.hideGradeWorkspace
    if (!showGradeWorkspace) {
      return (
        <div className="space-y-6">
          {renderAccountSnapshotCard()}
        </div>
      )
    }
    return (
      <div className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-2">
          {renderGradeWorkspaceCard()}
          {renderAccountSnapshotCard()}
        </div>
      </div>
    )
  }

  const OverviewSection = () => renderOverviewCards()

  const LiveSection = () => {
    const liveStatusMessage = () => {
      if (status !== 'authenticated') return 'Please sign in to join the live class.'
      if (!selectedGrade) return 'Select a grade to unlock the live class.'
      if (liveOverlayDismissed) return 'Reopen the live view any time to jump back into class.'
      return 'Opening the live view puts the video call on top of the dashboard automatically.'
    }

    return (
      <div className="space-y-6">
        <div className="card space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-lg font-semibold">Live class — {activeGradeLabel}</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleShowLiveOverlay}
                disabled={!canJoinLiveClass}
                title={canJoinLiveClass ? 'Bring the live video back on top.' : 'Sign in and pick a grade to join.'}
              >
                {canJoinLiveClass ? 'Open live view' : 'Join class'}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => showCanvasWindow(activeSessionId)}
                disabled={!canLaunchCanvasOverlay}
              >
                Canvas window
              </button>
            </div>
          </div>
          <p className="text-xs text-white">The live view takes over the screen for video, and canvases layer on top as draggable windows.</p>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
            {liveStatusMessage()}
          </div>
        </div>
      </div>
    )
  }

  const AnnouncementsSection = () => (
    <div className="space-y-6">
      {canManageAnnouncements && (
        <div className="card space-y-3">
          <h2 className="text-lg font-semibold">Create announcement</h2>
          {!selectedGrade ? (
            <div className="text-sm muted">Select a grade before posting an announcement.</div>
          ) : (
            <form onSubmit={createAnnouncement} className="space-y-2">
              <input
                className="input"
                placeholder="Title"
                value={announcementTitle}
                onChange={e => setAnnouncementTitle(e.target.value)}
              />
              <textarea
                className="input min-h-[120px]"
                placeholder="Share important updates for this grade"
                value={announcementContent}
                onChange={e => setAnnouncementContent(e.target.value)}
              />
              <div>
                <button className="btn btn-primary" type="submit" disabled={creatingAnnouncement}>
                  {creatingAnnouncement ? 'Saving...' : 'Post announcement'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <div className="card space-y-3">
        <h2 className="text-lg font-semibold">Grade updates — {activeGradeLabel}</h2>
        {status !== 'authenticated' ? (
          <div className="text-sm muted">Please sign in to view announcements.</div>
        ) : !selectedGrade ? (
          <div className="text-sm muted">Select a grade to view announcements.</div>
        ) : announcementsError ? (
          <div className="text-sm text-red-600">{announcementsError}</div>
        ) : announcementsLoading ? (
          <div className="text-sm muted">Loading announcements...</div>
        ) : announcements.length === 0 ? (
          <div className="text-sm muted">No announcements yet.</div>
        ) : (
          <ul className="space-y-3">
            {announcements.map(a => {
              const isRead = a?.id ? readAnnouncementSet.has(String(a.id)) : true
              return (
                <li key={a.id} className={`border rounded overflow-hidden ${isRead ? '' : 'border-white/30'}`}>
                  <button
                    type="button"
                    className="w-full text-left p-3"
                    onClick={() => {
                      setExpandedAnnouncementId(curr => {
                        const next = curr === a.id ? null : a.id
                        if (next) markAnnouncementRead(String(a.id))
                        return next
                      })
                    }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {!isRead && <span className="inline-block w-2 h-2 rounded-full bg-red-500" aria-label="Unread" />}
                          <div className="font-medium break-words">{a.title}</div>
                        </div>
                        <div className="text-xs muted">
                          {new Date(a.createdAt).toLocaleString()}
                          {a.createdBy ? ` • ${a.createdBy}` : ''}
                        </div>
                      </div>
                      <div className="shrink-0 text-sm muted">
                        {expandedAnnouncementId === a.id ? 'Hide' : 'View'}
                      </div>
                    </div>
                  </button>

                  {expandedAnnouncementId === a.id && (
                    <div className="px-3 pb-3">
                      {canManageAnnouncements && (
                        <div className="flex justify-end mb-2">
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => deleteAnnouncement(a.id)}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                      <p className="text-sm whitespace-pre-line">{a.content}</p>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )

  const renderSessionsSection = () => {
    const canCreateSession = Boolean(session && (session as any).user?.role && ((session as any).user.role === 'admin' || (session as any).user.role === 'teacher'))

    const nowMs = Date.now()
    const sortedSessions = [...(sessions || [])].sort((a, b) => new Date(a?.startsAt).getTime() - new Date(b?.startsAt).getTime())
    const upcomingSessions = sortedSessions.filter(s => new Date(s?.startsAt).getTime() >= nowMs)
    const pastSessions = sortedSessions
      .filter(s => new Date(s?.startsAt).getTime() < nowMs)
      .sort((a, b) => new Date(b?.startsAt).getTime() - new Date(a?.startsAt).getTime())
    const pastSessionIds = pastSessions.map(s => String(s.id)).filter(Boolean)

    return (
      <div className="space-y-6">
        {canCreateSession && (
          <div className="card space-y-3">
            <h2 className="text-lg font-semibold">Create session</h2>
            {!selectedGrade ? (
              <div className="text-sm muted">Select a grade before creating a session.</div>
            ) : (
              <form onSubmit={createSession} className="space-y-3">
                <p className="text-sm muted">This session will be visible only to {activeGradeLabel} learners.</p>
                <input className="input" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
                <input className="input" placeholder="Join URL (Teams, Padlet, Zoom)" value={joinUrl} onChange={e => setJoinUrl(e.target.value)} />
                <input className="input" type="datetime-local" value={startsAt} min={minStartsAt} step={60} onChange={e => setStartsAt(e.target.value)} />
                <div>
                  <button className="btn btn-primary" type="submit">Create</button>
                </div>
              </form>
            )}
          </div>
        )}

        <div className="card space-y-3">
          <h2 className="text-lg font-semibold">Upcoming sessions — {activeGradeLabel}</h2>
          {isAdmin && (
            <div className="p-3 border rounded bg-slate-50 space-y-2">
              <div className="font-medium">Subscription gating</div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={effectiveSubscriptionGatingEnabled}
                  disabled={subscriptionGatingSaving || subscriptionGatingEnabled === null}
                  onChange={(e) => updateSubscriptionGating(e.target.checked)}
                />
                <span>Require an active subscription for learners to join sessions and view materials</span>
              </label>
              {subscriptionGatingEnabled === null && (
                <div className="text-xs muted">Loading current setting…</div>
              )}
              {subscriptionGatingError && (
                <div className="text-sm text-red-600">{subscriptionGatingError}</div>
              )}
            </div>
          )}
          {isSubscriptionBlocked && (
            <div className="p-3 border rounded bg-slate-50">
              <div className="font-medium">Subscription required</div>
              <div className="text-sm muted">Subscribe to join sessions and access lesson materials.</div>
              <div className="mt-2">
                <a className="btn btn-primary" href="/subscribe">Subscribe</a>
              </div>
            </div>
          )}
          {sessionsError ? (
            <div className="text-sm text-red-600">{sessionsError}</div>
          ) : sortedSessions.length === 0 ? (
            <div className="text-sm muted">No sessions scheduled for this grade yet.</div>
          ) : (
            <div className="space-y-3">
              {pastSessionIds.length > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost w-full justify-center"
                  onClick={() => openPastSessionsList(pastSessionIds)}
                  disabled={isSubscriptionBlocked}
                >
                  Browse past sessions
                </button>
              )}
              <ul className="space-y-3">
              {upcomingSessions.length === 0 ? (
                <li className="p-3 border rounded">
                  <div className="text-sm muted">No upcoming sessions right now.</div>
                </li>
              ) : upcomingSessions.map(s => (
                <li key={s.id} className="p-3 border rounded">
                  {isMobile ? (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <div className="font-medium leading-snug break-words">{s.title}</div>
                        <div className="text-xs muted">{new Date(s.startsAt).toLocaleString()}</div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {canCreateSession && (
                          <button
                            type="button"
                            className="btn btn-primary w-full justify-center"
                            onClick={() => startLiveForSession(s.id)}
                          >
                            Start class
                          </button>
                        )}
                        <button
                          type="button"
                          className={`btn w-full justify-center ${canCreateSession ? '' : 'btn-primary'}`}
                          onClick={() => openLiveForSession(s.id)}
                          disabled={isSubscriptionBlocked}
                        >
                          Open class
                        </button>
                        <button
                          type="button"
                          className="btn w-full justify-center"
                          onClick={() => showCanvasWindow(s.id)}
                          disabled={!canLaunchCanvasOverlay || isSubscriptionBlocked}
                        >
                          Canvas
                        </button>
                        <button
                          type="button"
                          className="btn w-full justify-center"
                          onClick={() => openSessionDetails([String(s.id)], 0)}
                          disabled={isSubscriptionBlocked}
                        >
                          Materials
                        </button>
                        <a
                          href={s.joinUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={`btn btn-ghost w-full justify-center ${canCreateSession ? 'col-span-2' : ''} ${isSubscriptionBlocked ? 'pointer-events-none opacity-50' : ''}`}
                        >
                          Link
                        </a>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">{s.title}</div>
                        <div className="text-sm muted">{new Date(s.startsAt).toLocaleString()}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {canCreateSession && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => startLiveForSession(s.id)}
                          >
                            Start class
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn"
                          onClick={() => openLiveForSession(s.id)}
                          disabled={isSubscriptionBlocked}
                        >
                          Open class
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => showCanvasWindow(s.id)}
                          disabled={!canLaunchCanvasOverlay || isSubscriptionBlocked}
                        >
                          Canvas
                        </button>
                        <a
                          href={s.joinUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={`btn btn-ghost${isSubscriptionBlocked ? ' pointer-events-none opacity-50' : ''}`}
                        >
                          Link
                        </a>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => openSessionDetails([String(s.id)], 0)}
                          disabled={isSubscriptionBlocked}
                        >
                          Materials
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
              </ul>
            </div>
          )}
        </div>

        {sessionDetailsOpen && (
          <div className="fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/40" onClick={closeSessionDetails} />
            <div className="absolute inset-x-0 bottom-0 sm:inset-x-8 sm:inset-y-8" onClick={closeSessionDetails}>
              <div
                className="card h-full max-h-[92vh] overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                {sessionDetailsView === 'pastList' ? (
                  <>
                    <div className="p-3 border-b flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold break-words">Past sessions — {activeGradeLabel}</div>
                        <div className="text-sm muted">Tap a session to view materials and {isLearner ? 'saved notes' : 'LaTeX saves'}.</div>
                      </div>
                      <button type="button" className="btn btn-ghost" onClick={closeSessionDetails}>
                        Close
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3">
                      <ul className="border rounded divide-y overflow-hidden">
                        {sessionDetailsIds.map((id, idx) => {
                          const s = sessionById.get(id)
                          return (
                            <li key={id}>
                              <button
                                type="button"
                                className="w-full text-left p-3"
                                onClick={() => {
                                  setSessionDetailsIndex(idx)
                                  setSessionDetailsView('details')
                                  setSessionDetailsTab('materials')
                                }}
                              >
                                <div className="font-medium break-words">{s?.title || 'Session'}</div>
                                {s?.startsAt && (
                                  <div className="text-sm muted">{new Date(s.startsAt).toLocaleString()}</div>
                                )}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="p-3 border-b flex items-start justify-between gap-3">
                      <div className="w-24 shrink-0">
                        {sessionDetailsIds.length > 1 ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => setSessionDetailsView('pastList')}
                          >
                            Back
                          </button>
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1 text-center">
                        <div className="font-semibold break-words">{sessionDetailsSession?.title || 'Session details'}</div>
                        {sessionDetailsSession?.startsAt && (
                          <div className="text-sm muted">{new Date(sessionDetailsSession.startsAt).toLocaleString()}</div>
                        )}
                      </div>
                      <div className="w-24 shrink-0 flex justify-end">
                        <button type="button" className="btn btn-ghost" onClick={closeSessionDetails}>
                          Close
                        </button>
                      </div>
                    </div>

                    <div className="p-3 border-b">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          className={`btn w-full justify-center ${sessionDetailsTab === 'materials' ? 'btn-primary' : 'btn-ghost'}`}
                          onClick={() => setSessionDetailsTab('materials')}
                        >
                          Materials
                        </button>
                        <button
                          type="button"
                          className={`btn w-full justify-center ${sessionDetailsTab === 'latex' ? 'btn-primary' : 'btn-ghost'}`}
                          onClick={() => setSessionDetailsTab('latex')}
                        >
                          {learnerNotesLabel}
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3">
                      {sessionDetailsTab === 'materials' ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="font-semibold text-sm">Materials</div>
                            {expandedSessionId && (
                              <button type="button" className="btn btn-ghost text-xs" onClick={() => fetchMaterials(expandedSessionId)}>
                                Refresh
                              </button>
                            )}
                          </div>

                          {canUploadMaterials && (
                            <form onSubmit={uploadMaterial} className="space-y-2">
                              <input
                                className="input"
                                placeholder="Material title"
                                value={materialTitle}
                                onChange={e => setMaterialTitle(e.target.value)}
                              />
                              <input
                                ref={fileInputRef}
                                className="input"
                                type="file"
                                accept=".pdf,.doc,.docx,.ppt,.pptx,.pps,.ppsx,.key,.txt,.xlsx,.xls,.zip,.rar,.jpg,.jpeg,.png,.mp4,.mov"
                                onChange={e => handleMaterialFileChange(e.target.files?.[0] ?? null)}
                              />
                              <div>
                                <button className="btn btn-primary" type="submit" disabled={materialUploading || !materialFile}>
                                  {materialUploading ? 'Uploading...' : 'Upload material'}
                                </button>
                              </div>
                            </form>
                          )}

                          {materialsError ? (
                            <div className="text-sm text-red-600">{materialsError}</div>
                          ) : materialsLoading ? (
                            <div className="text-sm muted">Loading materials...</div>
                          ) : materials.length === 0 ? (
                            <div className="text-sm muted">No materials uploaded yet.</div>
                          ) : (
                            <ul className="space-y-2">
                              {materials.map(m => (
                                <li key={m.id} className="p-2 border rounded flex items-start justify-between gap-4">
                                  <div className="min-w-0">
                                    <a href={m.url} target="_blank" rel="noreferrer" className="font-medium hover:underline break-words">{m.title}</a>
                                    <div className="text-xs muted">
                                      {new Date(m.createdAt).toLocaleString()}
                                      {m.createdBy ? ` • ${m.createdBy}` : ''}
                                      {m.size ? ` • ${formatFileSize(m.size)}` : ''}
                                    </div>
                                  </div>
                                  {canUploadMaterials && (
                                    <button type="button" className="btn btn-danger" onClick={() => deleteMaterial(m.id)}>
                                      Delete
                                    </button>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="font-semibold text-sm">{learnerNotesLabel}</div>
                            {expandedSessionId && (
                              <button
                                type="button"
                                className="btn btn-ghost text-xs"
                                onClick={() => fetchLatexSaves(expandedSessionId)}
                                disabled={latexSavesLoading}
                              >
                                {latexSavesLoading ? 'Refreshing…' : 'Refresh'}
                              </button>
                            )}
                          </div>

                          {latexSavesError ? (
                            <div className="text-sm text-red-600">{latexSavesError}</div>
                          ) : latexSavesLoading ? (
                            <div className="text-sm muted">Loading {isLearner ? 'saved notes' : 'saved LaTeX'}…</div>
                          ) : (
                            <div className="space-y-3">
                              <div>
                                <p className="text-xs uppercase tracking-wide muted mb-1">{isLearner ? 'Class notes' : 'Class saves'}</p>
                                {latexSaves.shared.length === 0 ? (
                                  <div className="text-sm muted">{isLearner ? 'No class notes yet.' : 'No class saves yet.'}</div>
                                ) : (
                                  <ul className="border rounded divide-y overflow-hidden">
                                    {latexSaves.shared.map(save => (
                                      <li key={save.id} className="p-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="min-w-0">
                                          <div className="font-medium text-sm break-words">{save.title}</div>
                                          <div className="text-xs muted">{new Date(save.createdAt).toLocaleString()}</div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 sm:justify-end sm:flex-nowrap">
                                          {save.url && (
                                            <a href={save.url} target="_blank" rel="noreferrer" className="btn btn-secondary text-xs">
                                              Download
                                            </a>
                                          )}
                                          {normalizedRole === 'admin' && (
                                            <>
                                              <button
                                                type="button"
                                                className="btn btn-ghost text-xs"
                                                onClick={() => expandedSessionId && renameLatexSave(expandedSessionId, save.id, save.title)}
                                              >
                                                Rename
                                              </button>
                                              <button
                                                type="button"
                                                className="btn btn-danger text-xs"
                                                onClick={() => expandedSessionId && deleteLatexSave(expandedSessionId, save.id)}
                                              >
                                                Delete
                                              </button>
                                            </>
                                          )}
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-wide muted mb-1">{isLearner ? 'My notes' : 'My saves'}</p>
                                {latexSaves.mine.length === 0 ? (
                                  <div className="text-sm muted">{isLearner ? 'No saved notes yet.' : 'No personal saves yet.'}</div>
                                ) : (
                                  <ul className="border rounded divide-y overflow-hidden">
                                    {latexSaves.mine.map(save => (
                                      <li key={save.id} className="p-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="min-w-0">
                                          <div className="font-medium text-sm break-words">{save.title}</div>
                                          <div className="text-xs muted">{new Date(save.createdAt).toLocaleString()}</div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 sm:justify-end sm:flex-nowrap">
                                          {save.url && (
                                            <a href={save.url} target="_blank" rel="noreferrer" className="btn btn-secondary text-xs">
                                              Download
                                            </a>
                                          )}
                                          <button
                                            type="button"
                                            className="btn btn-ghost text-xs"
                                            onClick={() => expandedSessionId && renameLatexSave(expandedSessionId, save.id, save.title)}
                                          >
                                            Rename
                                          </button>
                                          <button
                                            type="button"
                                            className="btn btn-danger text-xs"
                                            onClick={() => expandedSessionId && deleteLatexSave(expandedSessionId, save.id)}
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  const UsersSection = () => (
    <div className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Manage users</h2>
        <p className="text-sm muted">Create learners and instructors, update their access, and remove accounts when needed.</p>
      </div>

      <div className="space-y-2">
        <h3 className="font-medium">Create user</h3>
        <div className="grid gap-2 lg:grid-cols-2">
          <input className="input" placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)} />
          <input className="input" placeholder="Email" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
          <input className="input" placeholder="Password" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          <select className="input" value={newRole} onChange={e => setNewRole(e.target.value)}>
            <option value="student">student</option>
            <option value="teacher">teacher</option>
            <option value="admin">admin</option>
          </select>
          {(newRole === 'student' || newRole === 'teacher') && (
            <select
              className="input"
              value={newGrade}
              onChange={e => setNewGrade(e.target.value as GradeValue | '')}
            >
              <option value="">Select grade</option>
              {gradeOptions.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          )}
        </div>
        <div>
          <button className="btn btn-primary" onClick={async () => {
            if ((newRole === 'student' || newRole === 'teacher') && !newGrade) {
              alert('Please assign a grade to the new user')
              return
            }
            try {
              const res = await fetch('/api/users', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: newName,
                  email: newEmail,
                  password: newPassword,
                  role: newRole,
                  grade: newRole === 'admin' ? undefined : newGrade
                })
              })
              if (res.ok) {
                setNewName('')
                setNewEmail('')
                setNewPassword('')
                setNewRole('student')
                setNewGrade(selectedGrade ?? '')
                fetchUsers()
                alert('User created')
              } else {
                const data = await res.json().catch(() => ({}))
                alert(data?.message || `Failed to create user (${res.status})`)
              }
            } catch (err: any) {
              alert(err?.message || 'Network error')
            }
          }}>Create user</button>
        </div>
      </div>

      {usersLoading ? (
        <div className="text-sm muted">Loading users...</div>
      ) : usersError ? (
        <div className="text-sm text-red-600">{usersError}</div>
      ) : users && users.length === 0 ? (
        <div className="text-sm muted">No users found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th className="px-2 py-1">Email</th>
                <th className="px-2 py-1">Learner</th>
                <th className="px-2 py-1">Contact</th>
                <th className="px-2 py-1">Emergency</th>
                <th className="px-2 py-1">Address</th>
                <th className="px-2 py-1">Created</th>
                <th className="px-2 py-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users && users.map(u => (
                <tr key={u.id} className="border-t">
                  <td className="px-2 py-2 align-top">{u.email}</td>
                  <td className="px-2 py-2 align-top">
                    <div className="font-medium">{u.firstName || u.name || '—'} {u.lastName || ''}</div>
                    <div className="text-xs muted capitalize">Role: {u.role}</div>
                    <div className="text-xs muted">Grade: {u.grade ? gradeToLabel(u.grade) : 'Unassigned'}</div>
                    <div className="text-xs muted">School: {u.schoolName || '—'}</div>
                  </td>
                  <td className="px-2 py-2 align-top">
                    <div>{formatPhoneDisplay(u.phoneNumber)}</div>
                    <div className="text-xs muted">Alt: {formatPhoneDisplay(u.alternatePhone)}</div>
                    <div className="text-xs muted">Recovery: {u.recoveryEmail || '—'}</div>
                  </td>
                  <td className="px-2 py-2 align-top">
                    <div>{u.emergencyContactName || '—'}</div>
                    <div className="text-xs muted">{u.emergencyContactRelationship || ''}</div>
                    <div className="text-xs muted">{u.emergencyContactPhone ? formatPhoneDisplay(u.emergencyContactPhone) : 'No number'}</div>
                  </td>
                  <td className="px-2 py-2 align-top">
                    <div>{u.addressLine1 || '—'}</div>
                    <div className="text-xs muted">{u.city || ''} {u.province ? `(${u.province})` : ''}</div>
                    <div className="text-xs muted">{u.postalCode || ''}</div>
                  </td>
                  <td className="px-2 py-2 align-top">{new Date(u.createdAt).toLocaleString()}</td>
                  <td className="px-2 py-2">
                    <button
                      className="btn btn-danger"
                      onClick={async () => {
                        if (!confirm(`Delete user ${u.email}? This cannot be undone.`)) return
                        try {
                          const res = await fetch(`/api/users/${u.id}`, { method: 'DELETE', credentials: 'same-origin' })
                          if (res.ok) {
                            setUsers(prev => prev ? prev.filter(x => x.id !== u.id) : prev)
                          } else {
                            const data = await res.json().catch(() => ({}))
                            alert(data?.message || `Failed to delete (${res.status})`)
                          }
                        } catch (err: any) {
                          alert(err?.message || 'Network error')
                        }
                      }}
                    >Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  const BillingSection = () => (
    <div className="space-y-6">
      <div className="card space-y-3">
        <h2 className="text-lg font-semibold">Create subscription plan</h2>
        <div className="space-y-2">
          <input className="input" placeholder="Plan name" value={planName} onChange={e => setPlanName(e.target.value)} />
          <input className="input" placeholder="Amount (cents)" type="number" value={planAmount as any} onChange={e => setPlanAmount(e.target.value ? parseInt(e.target.value, 10) : '')} />
          <div className="text-xs muted">PayFast subscriptions are billed in ZAR.</div>
          <div>
            <button className="btn btn-primary" onClick={async () => {
              if (!planName || !planAmount) return alert('Name and amount required')
              if (typeof planAmount === 'number' && planAmount < 500) {
                alert('PayFast subscriptions require at least 500 cents (R5.00)')
                return
              }
              try {
                const res = await fetch('/api/payfast/create-plan', {
                  method: 'POST',
                  credentials: 'same-origin',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: planName, amount: planAmount })
                })

                if (!res.ok) {
                  const data = await res.json().catch(() => ({}))
                  return alert(data?.message || `Failed to create PayFast plan (${res.status})`)
                }

                setPlanName('')
                setPlanAmount('')
                fetchPlans()
                alert('Plan created')
              } catch (err: any) {
                alert(err?.message || 'Network error')
              }
            }}>Create plan</button>
          </div>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="text-lg font-semibold">Existing plans</h2>
        {plansLoading ? <div className="text-sm muted">Loading...</div> : (
          plans.length === 0 ? <div className="text-sm muted">No plans found.</div> : (
            <ul className="space-y-2">
              {plans.map(p => (
                <li key={p.id} className="p-2 border rounded">
                  {editingPlanId === p.id ? (
                    <div className="space-y-2">
                      <input className="input" value={editPlanName} onChange={e => setEditPlanName(e.target.value)} placeholder="Plan name" />
                      <input className="input" type="number" value={editPlanAmount as any} onChange={e => setEditPlanAmount(e.target.value ? parseInt(e.target.value, 10) : '')} placeholder="Amount (cents)" />
                      <div className="text-sm muted">Currency: {(p.currency || 'zar').toUpperCase()}</div>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={editPlanActive} onChange={e => setEditPlanActive(e.target.checked)} />
                        <span>Active</span>
                      </label>
                      <div className="flex gap-2">
                        <button className="btn btn-primary" onClick={savePlanChanges} disabled={planSaving}>
                          {planSaving ? 'Saving...' : 'Save changes'}
                        </button>
                        <button className="btn btn-ghost" onClick={resetPlanEdit} disabled={planSaving}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-sm muted">{(p.amount / 100).toFixed(2)} {p.currency?.toUpperCase()} {p.active ? '(active)' : '(inactive)'}</div>
                      </div>
                      <div className="flex gap-2">
                        <button className="btn btn-ghost" onClick={() => beginEditPlan(p)}>Edit</button>
                        <button className="btn btn-danger" onClick={async () => {
                          if (!confirm('Delete plan?')) return
                          try {
                            const res = await fetch(`/api/plans`, { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id }) })
                            if (res.ok) fetchPlans()
                            else alert('Failed to delete')
                          } catch (err) {
                            alert('Network error')
                          }
                        }}>Delete</button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </div>
  )

  const renderSection = () => {
    switch (activeSection) {
      case 'live':
        return <LiveSection />
      case 'announcements':
        return <AnnouncementsSection />
      case 'sessions':
        return renderSessionsSection()
      case 'users':
        return <UsersSection />
      case 'billing':
        return <BillingSection />
      default:
        return <OverviewSection />
    }
  }

  const SectionNav = () => {
    if (availableSections.length <= 1) return null

    return (
      <div className="space-y-3">
        <div className="hidden lg:grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          {availableSections.map(section => {
            const isActive = activeSection === section.id
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                className={`rounded-2xl border px-4 py-3 text-left transition focus:outline-none focus:ring-2 ${
                  isActive
                    ? 'border-blue-500 bg-white text-slate-900 shadow-lg focus:ring-blue-200'
                    : 'border-white/10 bg-white/5 text-white/80 hover:border-white/30 focus:ring-white/10'
                }`}
              >
                <div className="text-sm font-semibold tracking-wide uppercase">{section.label}</div>
                <div className="text-xs opacity-70">{section.description}</div>
              </button>
            )
          })}
        </div>

        <div className="lg:hidden grid grid-cols-2 gap-3">
          {availableSections.map(section => {
            const isActive = activeSection === section.id
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 ${
                  isActive
                    ? 'bg-white text-[#04123b] border-white focus:ring-white/40 shadow-lg'
                    : 'bg-white/10 border-white/20 text-white focus:ring-white/20'
                }`}
              >
                {section.label}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <>
      <main className={`${isMobile ? 'mobile-dashboard-theme bg-gradient-to-b from-[#010924] via-[#041550] to-[#071e63] text-white overflow-x-hidden' : 'deep-page'} min-h-screen pb-16`}>
      <div className={`${isMobile ? 'w-full px-2 pt-3 pb-6 space-y-5' : 'w-full px-2 py-8 space-y-6'}`}>
        {isMobile ? (
          <>
            {mobilePanels.announcements && (
              <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
                <div className="absolute inset-0 bg-black/60" onClick={closeMobileAnnouncements} />
                <div className="absolute inset-x-2 top-3 bottom-3 rounded-3xl border border-white/10 bg-[#06184a] shadow-2xl overflow-hidden">
                  <div className="p-3 border-b border-white/10 flex items-center justify-between gap-3">
                    <div className="font-semibold text-white">Announcements</div>
                    <button type="button" className="btn btn-ghost" onClick={closeMobileAnnouncements}>
                      Close
                    </button>
                  </div>
                  <div className="p-4 overflow-auto h-full">
                    <AnnouncementsSection />
                  </div>
                </div>
              </div>
            )}

            <section
              data-mobile-chrome-ignore
              className={`relative overflow-hidden rounded-3xl border border-white/10 px-5 pt-6 pb-24 text-center shadow-2xl space-y-5 ${mobileHeroBgDragActive ? 'ring-2 ring-white/40' : ''}`}
              onDragEnter={(e) => {
                e.preventDefault()
                setMobileHeroBgDragActive(true)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setMobileHeroBgDragActive(true)
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                setMobileHeroBgDragActive(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setMobileHeroBgDragActive(false)
                const file = e.dataTransfer?.files?.[0]
                if (file) applyMobileHeroBackgroundFile(file)
              }}
              onClickCapture={(e) => {
                const target = e.target as HTMLElement | null
                if (!target) return
                const tag = target.tagName?.toLowerCase()
                if (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'textarea' || tag === 'select') return
                showMobileHeroEdit()
              }}
            >
              <div
                className="absolute inset-0"
                style={{ backgroundImage: `url(${mobileHeroBgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                aria-hidden="true"
              />
              <div className="absolute inset-0 bg-gradient-to-br from-[#020b35]/80 via-[#041448]/70 to-[#031641]/80" aria-hidden="true" />
              <input
                ref={heroBgInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) applyMobileHeroBackgroundFile(file)
                  e.target.value = ''
                }}
              />

              <button
                type="button"
                aria-label="Edit background"
                className={`absolute bottom-3 right-3 inline-flex items-center justify-center h-10 w-10 rounded-xl border border-white/20 bg-white/10 backdrop-blur transition-opacity ${mobileHeroBgEditVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                onClick={(e) => {
                  e.stopPropagation()
                  heroBgInputRef.current?.click()
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm18-11.5a1 1 0 0 0 0-1.41l-1.34-1.34a1 1 0 0 0-1.41 0l-1.13 1.13 3.75 3.75L21 5.75Z" fill="currentColor" />
                </svg>
              </button>
              <div className="absolute left-5 bottom-5 z-10 flex items-end gap-3 text-left">
                <div className="w-20 h-20 rounded-full border border-white/25 bg-white/5 flex items-center justify-center text-2xl font-semibold text-white overflow-hidden">
                  {learnerAvatarUrl ? (
                    <img src={learnerAvatarUrl} alt={learnerName} className="w-full h-full object-cover" />
                  ) : (
                    <span>{learnerInitials}</span>
                  )}
                </div>
                <div className="pb-1">
                  <p className="text-xl font-semibold leading-tight">{learnerName}</p>
                  <p className="text-sm text-blue-100/80">{learnerGradeText}</p>
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  className="px-5 py-2 rounded-full bg-white text-[#05133e] font-semibold shadow-lg"
                  onClick={() => {
                    setActiveSection('live')
                    handleShowLiveOverlay()
                  }}
                >
                  Live class
                </button>
                <button
                  type="button"
                  className="px-5 py-2 rounded-full border border-white/30 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent"
                  onClick={() => showCanvasWindow(activeSessionId)}
                  disabled={!canLaunchCanvasOverlay}
                >
                  Canvas
                </button>
              </div>
            </section>

            <section className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-white">Sessions</div>
                <button
                  type="button"
                  className="btn btn-ghost text-xs"
                  onClick={() => toggleMobilePanel('sessions')}
                >
                  {mobilePanels.sessions ? 'Hide' : 'Show'}
                </button>
              </div>
              {mobilePanels.sessions && <div className="space-y-4">{renderSessionsSection()}</div>}
            </section>

            {renderOverviewCards({ hideGradeWorkspace: true })}
          </>
        ) : (
          <>
            <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <BrandLogo height={56} className="drop-shadow-[0_20px_45px_rgba(3,5,20,0.6)]" />
                <div>
                  <h1 className="text-3xl font-bold">Dashboard</h1>
                  <p className="text-sm muted">Manage your classes, communicate with learners, and handle billing from one place.</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {session ? (
                  <div className="text-sm muted">Signed in as <span className="font-medium text-white">{session.user?.email}</span></div>
                ) : (
                  <Link href="/api/auth/signin" className="btn btn-primary">Sign in</Link>
                )}
              </div>
            </header>

            <SectionNav />

            <section className="min-w-0 space-y-6">
              {renderSection()}
            </section>
          </>
        )}
      </div>
      </main>
      {liveOverlayOpen && (
        <div
          className={`live-call-overlay${liveWindows.some(win => win.kind === 'canvas' && !win.minimized) ? ' live-call-overlay--canvas-open' : ''}${liveOverlayChromeVisible ? ' live-call-overlay--chrome-visible' : ''}`}
          role="dialog"
          aria-modal="true"
        >
          <div className="live-call-overlay__backdrop" />
          <div className="live-call-overlay__panel" ref={stageRef}>
            <div className="live-call-overlay__video">
              <div className="live-call-overlay__floating-actions">
                <button
                  type="button"
                  onClick={() => showCanvasWindow(activeSessionId)}
                  disabled={!canLaunchCanvasOverlay}
                  className="live-call-overlay__canvas-toggle"
                  aria-label="Open canvas"
                >
                  Canvas
                </button>
                <button type="button" className="live-call-overlay__close" onClick={closeLiveOverlay} aria-label="Close live class">
                  ×
                </button>
              </div>
              {canJoinLiveClass && activeSessionId ? (
                <JitsiRoom
                  roomName={gradeRoomName}
                  displayName={session?.user?.name || session?.user?.email}
                  sessionId={activeSessionId}
                  tokenEndpoint={null}
                  passwordEndpoint={null}
                  isOwner={isOwnerUser}
                  onControlsChange={setLiveControls}
                />
              ) : (
                <div className="live-call-overlay__placeholder">
                  <p className="text-xs uppercase tracking-[0.3em] text-white/60">Select a session</p>
                  <p className="text-white text-lg font-semibold text-center">Choose a scheduled session to join the live class.</p>
                </div>
              )}
            </div>
            {liveWindows.length > 0 && (
              <div className="live-overlay-stage">
                {liveWindows.map(win => (
                  <LiveOverlayWindow
                    key={win.id}
                    id={win.id}
                    title={win.title}
                    subtitle={win.subtitle}
                    className={
                      win.kind === 'canvas'
                        ? `live-window--canvas${liveOverlayChromeVisible ? ' live-window--chrome-visible' : ''}`
                        : undefined
                    }
                    position={win.position}
                    size={win.size}
                    minimized={win.minimized}
                    zIndex={win.z}
                    bounds={overlayBounds}
                    minSize={{ width: 360, height: 320 }}
                    isResizable
                    isFullscreen={win.mode === 'fullscreen'}
                    onFocus={focusLiveWindow}
                    onClose={closeLiveWindow}
                    onToggleMinimize={toggleMinimizeLiveWindow}
                    onRequestFullscreen={toggleFullscreenLiveWindow}
                    onPositionChange={updateLiveWindowPosition}
                    onResize={resizeLiveWindow}
                  >
                    {win.kind === 'canvas' && (
                      <StackedCanvasWindow
                        gradeLabel={selectedGrade ? activeGradeLabel : null}
                        roomId={activeSessionId ?? boardRoomId}
                        boardId={activeSessionId ?? undefined}
                        userId={realtimeUserId}
                        userDisplayName={realtimeDisplayName}
                        isAdmin={isOwnerUser}
                        isVisible={!win.minimized}
                        defaultOrientation="portrait"
                        onOverlayChromeVisibilityChange={setLiveOverlayChromeVisible}
                      />
                    )}
                  </LiveOverlayWindow>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

export async function getServerSideProps(context: any) {
  // protect page server-side if desired
  const session = await getSession(context)
  return { props: { session } }
}
