import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import JitsiRoom, { JitsiControls, JitsiMuteState } from '../components/JitsiRoom'
import LiveOverlayWindow from '../components/LiveOverlayWindow'
import BrandLogo from '../components/BrandLogo'
import GradePillSelector, { type PillAnchorRect } from '../components/GradePillSelector'
import UserLink from '../components/UserLink'
import DiagramOverlayModule from '../components/DiagramOverlayModule'
import TextOverlayModule from '../components/TextOverlayModule'
import AssignmentSubmissionOverlay from '../components/AssignmentSubmissionOverlay'
import FullScreenGlassOverlay from '../components/FullScreenGlassOverlay'
import TaskManageMenu from '../components/TaskManageMenu'
import PdfViewerOverlay from '../components/PdfViewerOverlay'
import { getSession, signOut, useSession } from 'next-auth/react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { gradeToLabel, GRADE_VALUES, GradeValue, normalizeGradeInput } from '../lib/grades'
import { isSpecialTestStudentEmail } from '../lib/testUsers'
import { renderKatexDisplayHtml as renderKatexDisplayHtmlRaw, splitLatexIntoSteps as splitLatexIntoStepsRaw } from '../lib/latexRender'
import { renderTextWithKatex as renderTextWithKatexRaw } from '../lib/renderTextWithKatex'
import { useTapToPeek } from '../lib/useTapToPeek'
import { useOverlayRestore } from '../lib/overlayRestore'
import { toDisplayFileName } from '../lib/fileName'

const StackedCanvasWindow = dynamic(() => import('../components/StackedCanvasWindow'), { ssr: false })
const ImageCropperModal = dynamic(() => import('../components/ImageCropperModal'), { ssr: false })

const MOBILE_HERO_BG_MIN_WIDTH = 1200
const MOBILE_HERO_BG_MIN_HEIGHT = 600
const MOBILE_HERO_BG_MAX_WIDTH = 2000
const WINDOW_PADDING_X = 24
const WINDOW_PADDING_Y = 24

const buildDefaultMobileHeroSvg = () => {
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
}

const DASHBOARD_SECTIONS = [
  { id: 'overview', label: 'Overview', description: 'Grade & quick actions', roles: ['admin', 'teacher', 'student', 'guest'] },
  { id: 'live', label: 'Live Class', description: 'Join lessons & board', roles: ['admin', 'teacher', 'student'] },
  { id: 'announcements', label: 'Announcements', description: 'Communicate updates', roles: ['admin', 'teacher', 'student'] },
  { id: 'sessions', label: 'Sessions', description: 'Schedule classes & materials', roles: ['admin', 'teacher', 'student'] },
  { id: 'groups', label: 'Groups', description: 'Classmates & groupmates', roles: ['admin', 'teacher', 'student'] },
  { id: 'discover', label: 'Discover', description: 'Find people & join groups', roles: ['admin', 'teacher', 'student'] },
  { id: 'users', label: 'Learners', description: 'Manage enrolments', roles: ['admin'] },
  { id: 'billing', label: 'Billing', description: 'Subscription plans', roles: ['admin'] }
] as const

type SectionId = typeof DASHBOARD_SECTIONS[number]['id']
type SectionRole = typeof DASHBOARD_SECTIONS[number]['roles'][number]
type OverlaySectionId = Exclude<SectionId, 'overview'>

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

type ResourceBankItem = {
  id: string
  grade: GradeValue
  title: string
  url: string
  filename?: string | null
  contentType?: string | null
  size?: number | null
  createdAt: string
  tag?: string | null
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
  roomIdOverride?: string
  boardIdOverride?: string
  isAdminOverride?: boolean
  quizMode?: boolean
  lessonAuthoring?: { phaseKey: string; pointId: string }
  autoOpenDiagramTray?: boolean
  position: { x: number; y: number }
  size: { width: number; height: number }
  minimized: boolean
  z: number
  mode: 'windowed' | 'fullscreen'
  windowedSnapshot: WindowSnapshot | null
}

const OverlayPortal = ({ children }: { children: React.ReactNode }) => {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted || typeof document === 'undefined') return null
  return createPortal(children, document.body)
}

type LocalCacheEntry<T> = {
  updatedAt: string
  data: T
}

const readLocalCache = <T,>(key: string): LocalCacheEntry<T> | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as LocalCacheEntry<T>
  } catch {
    return null
  }
}

const writeLocalCache = <T,>(key: string, data: T) => {
  if (typeof window === 'undefined') return
  try {
    const payload: LocalCacheEntry<T> = {
      updatedAt: new Date().toISOString(),
      data
    }
    window.localStorage.setItem(key, JSON.stringify(payload))
  } catch {
    // ignore storage errors
  }
}

export default function Dashboard() {
  const renderInlineEmphasis = useCallback((text: string, keyPrefix: string) => {
    const input = typeof text === 'string' ? text : ''
    if (!input) return input

    const out: any[] = []
    let i = 0
    let k = 0

    const pushText = (s: string) => {
      if (!s) return
      out.push(<span key={`${keyPrefix}-p-${k++}`}>{s}</span>)
    }

    while (i < input.length) {
      if (input.startsWith('**', i)) {
        const end = input.indexOf('**', i + 2)
        if (end > i + 2) {
          const inner = input.slice(i + 2, end)
          out.push(<strong key={`${keyPrefix}-b-${k++}`}>{inner}</strong>)
          i = end + 2
          continue
        }
      }

      if (input[i] === '_' && (i === 0 || input[i - 1] !== '\\')) {
        const end = input.indexOf('_', i + 1)
        if (end > i + 1) {
          const inner = input.slice(i + 1, end)
          out.push(<em key={`${keyPrefix}-i-${k++}`}>{inner}</em>)
          i = end + 1
          continue
        }
      }

      if (input[i] === '*' && input[i + 1] !== '*' && (i === 0 || input[i - 1] !== '\\')) {
        const end = input.indexOf('*', i + 1)
        if (end > i + 1) {
          const inner = input.slice(i + 1, end)
          out.push(<em key={`${keyPrefix}-it-${k++}`}>{inner}</em>)
          i = end + 1
          continue
        }
      }

      let j = i + 1
      while (j < input.length) {
        const c = input[j]
        if (c === '*' || c === '_') break
        j += 1
      }
      pushText(input.slice(i, j))
      i = j
    }

    return out
  }, [])

  const renderKatexDisplayHtml = useCallback((latex: unknown) => {
    return renderKatexDisplayHtmlRaw(latex)
  }, [])

  const splitLatexIntoSteps = useCallback((latex: unknown) => {
    return splitLatexIntoStepsRaw(latex)
  }, [])

  const normalizeChallengeGrade = useCallback((gradingJson: any, stepCount: number) => {
    if (!gradingJson) return null

    const mapGrade = (grade: string) => {
      const g = String(grade || '')
      if (g === 'tick') return { awardedMarks: 1, isCorrect: true, isSignificant: true }
      if (g === 'dot-green') return { awardedMarks: 0, isCorrect: true, isSignificant: false }
      if (g === 'cross') return { awardedMarks: 0, isCorrect: false, isSignificant: true }
      if (g === 'dot-red') return { awardedMarks: 0, isCorrect: false, isSignificant: false }
      return { awardedMarks: 0, isCorrect: false, isSignificant: true }
    }

    if (Array.isArray(gradingJson?.steps)) {
      const steps = gradingJson.steps.map((s: any, idx: number) => {
        const stepNum = Number(s?.step)
        const step = Number.isFinite(stepNum) && stepNum > 0 ? Math.trunc(stepNum) : idx + 1
        const awardedMarks = Number(s?.awardedMarks ?? 0)
        const safeAwarded = Number.isFinite(awardedMarks) ? Math.max(0, Math.trunc(awardedMarks)) : 0
        const isCorrect = (typeof s?.isCorrect === 'boolean') ? Boolean(s.isCorrect) : (safeAwarded > 0)
        const isSignificant = (typeof s?.isSignificant === 'boolean') ? Boolean(s.isSignificant) : (!isCorrect)
        const feedback = String(s?.feedback ?? '').trim()
        return { step, awardedMarks: safeAwarded, isCorrect, isSignificant, feedback }
      })
      const earnedMarks = Number.isFinite(Number(gradingJson.earnedMarks))
        ? Math.max(0, Math.trunc(Number(gradingJson.earnedMarks)))
        : steps.reduce((sum: number, s: any) => sum + Math.max(0, Number(s.awardedMarks || 0)), 0)
      const totalMarks = Number.isFinite(Number(gradingJson.totalMarks))
        ? Math.max(1, Math.trunc(Number(gradingJson.totalMarks)))
        : Math.max(1, stepCount || steps.length || 1)
      return { steps, earnedMarks, totalMarks }
    }

    if (Array.isArray(gradingJson)) {
      const steps = gradingJson.map((g: any, idx: number) => {
        const stepNum = Number(g?.step)
        const step = Number.isFinite(stepNum) && stepNum > 0 ? Math.trunc(stepNum) : idx + 1
        const mapped = mapGrade(String(g?.grade || ''))
        const feedback = String(g?.feedback ?? '').trim()
        return { step, feedback, ...mapped }
      })
      const earnedMarks = steps.reduce((sum: number, s: any) => sum + Math.max(0, Number(s.awardedMarks || 0)), 0)
      const totalMarks = Math.max(1, stepCount || steps.length || 1)
      return { steps, earnedMarks, totalMarks }
    }

    return null
  }, [])

  const renderTextWithKatex = useCallback((text: unknown) => {
    return renderTextWithKatexRaw(text, { renderInlineEmphasis })
  }, [renderInlineEmphasis])

  const formatSessionDate = useCallback((value: unknown) => {
    if (!value) return ''
    const dt = value instanceof Date ? value : new Date(String(value))
    if (Number.isNaN(dt.getTime())) return ''
    const dow = dt.toLocaleDateString(undefined, { weekday: 'short' })
    const main = dt.toLocaleString(undefined, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    return `(${dow}) ${main}`
  }, [])

  const formatSessionRange = useCallback((start: unknown, end?: unknown) => {
    const startLabel = formatSessionDate(start)
    const endLabel = formatSessionDate(end ?? start)
    if (startLabel && endLabel) return `${startLabel} → ${endLabel}`
    return startLabel || endLabel
  }, [formatSessionDate])
  const router = useRouter()
  const { data: session, status, update: updateSession } = useSession()
  const { queueRestore, discardRestore, popRestore, hasRestore } = useOverlayRestore()
  const gradeOptions = useMemo(() => GRADE_VALUES.map(value => ({ value, label: gradeToLabel(value) })), [])
  const [selectedGrade, setSelectedGrade] = useState<GradeValue | null>(null)
  const [gradeReady, setGradeReady] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const dashboardMainRef = useRef<HTMLElement | null>(null)
  const [pullRefreshOffset, setPullRefreshOffset] = useState(0)
  const [pullRefreshActive, setPullRefreshActive] = useState(false)
  const [pullRefreshLoading, setPullRefreshLoading] = useState(false)
  const currentLessonCardRef = useRef<HTMLDivElement | null>(null)
  const [currentLessonCardNaturalHeight, setCurrentLessonCardNaturalHeight] = useState(0)
  const currentLessonCardNaturalHeightRef = useRef(0)
  const [currentLessonCardCollapsePx, setCurrentLessonCardCollapsePx] = useState(0)
  const currentLessonCardCollapsePxRef = useRef(0)
  const [title, setTitle] = useState('')
  const [joinUrl, setJoinUrl] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)

  useEffect(() => {
    currentLessonCardNaturalHeightRef.current = currentLessonCardNaturalHeight
  }, [currentLessonCardNaturalHeight])

  useEffect(() => {
    currentLessonCardCollapsePxRef.current = currentLessonCardCollapsePx
  }, [currentLessonCardCollapsePx])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const measure = () => {
      const el = currentLessonCardRef.current
      if (!el) return
      const h = el.getBoundingClientRect().height
      if (!Number.isFinite(h) || h <= 0) return
      const next = Math.max(currentLessonCardNaturalHeightRef.current || 0, Math.round(h))
      if (next !== currentLessonCardNaturalHeightRef.current) {
        currentLessonCardNaturalHeightRef.current = next
        setCurrentLessonCardNaturalHeight(next)
      }
    }

    // Initial + resize re-measure.
    const onResize = () => {
      window.requestAnimationFrame(measure)
    }

    window.requestAnimationFrame(measure)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    let lastY = window.scrollY || 0
    let rafId: number | null = null

    const onScroll = () => {
      const y = window.scrollY || 0
      if (rafId) return
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        const delta = y - lastY
        lastY = y

        const maxH = currentLessonCardNaturalHeightRef.current || 0
        if (!maxH) return

        // 1:1 proportional collapse: every px scrolled down collapses 1px; scrolling up expands 1px.
        let next = currentLessonCardCollapsePxRef.current + delta
        if (next < 0) next = 0
        if (next > maxH) next = maxH
        if (next === currentLessonCardCollapsePxRef.current) return
        currentLessonCardCollapsePxRef.current = next
        setCurrentLessonCardCollapsePx(next)
      })
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (rafId) window.cancelAnimationFrame(rafId)
    }
  }, [])
  type LessonPhaseKey = 'engage' | 'explore' | 'explain' | 'elaborate' | 'evaluate'
  type LessonDiagramSnapshot = { title: string; imageUrl: string; annotations: any }
  type LessonPointDraft = {
    id: string
    title: string
    text: string
    diagramSnapshot: LessonDiagramSnapshot | null
    latex: string
    latexHistory?: string[]
  }

  const LESSON_AUTHORING_STORAGE_KEY = 'philani:lesson-authoring:draft-v2'
  const buildLessonAuthoringBoardId = (kind: 'diagram' | 'latex' | 'canvas', phaseKey: LessonPhaseKey, pointId: string) => {
    return `lesson-author-${kind}-${phaseKey}-${pointId}`
  }

  const sanitizeIdentifier = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60)
  const boardIdToSessionKey = (boardId: string) => `myscript:${sanitizeIdentifier(boardId).toLowerCase()}`

  const isTeacherOrAdminUser = Boolean(session && (session as any)?.user?.role && (((session as any).user.role === 'admin') || ((session as any).user.role === 'teacher')))

  const newPointDraft = (): LessonPointDraft => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: '',
    text: '',
    diagramSnapshot: null,
    latex: '',
    latexHistory: [],
  })

  const [lessonScriptDraft, setLessonScriptDraft] = useState<Record<LessonPhaseKey, LessonPointDraft[]>>({
    engage: [],
    explore: [],
    explain: [],
    elaborate: [],
    evaluate: [],
  })

  const diagramUploadInputRef = useRef<HTMLInputElement | null>(null)
  const [diagramUploadTarget, setDiagramUploadTarget] = useState<null | { phaseKey: LessonPhaseKey; pointId: string; boardId: string }>(null)
  const [diagramUploading, setDiagramUploading] = useState(false)
  const [lessonAuthoringDiagramOverlay, setLessonAuthoringDiagramOverlay] = useState<null | {
    phaseKey: LessonPhaseKey
    pointId: string
    boardId: string
  }>(null)
  const [lessonAuthoringDiagramCloseSignal, setLessonAuthoringDiagramCloseSignal] = useState(0)

  const [createOverlayOpen, setCreateOverlayOpen] = useState(false)
  const [createKind, setCreateKind] = useState<'quiz'>('quiz')
  const [editingChallengeId, setEditingChallengeId] = useState<string | null>(null)
  const [challengeAudiencePickerOpen, setChallengeAudiencePickerOpen] = useState(false)
  const [challengeTitleDraft, setChallengeTitleDraft] = useState('')
  const [challengePromptDraft, setChallengePromptDraft] = useState('')
  const [challengeAudienceDraft, setChallengeAudienceDraft] = useState<'public' | 'grade' | 'private'>('public')
  const [challengeMaxAttempts, setChallengeMaxAttempts] = useState<string>('unlimited')
  const [challengeImageUrl, setChallengeImageUrl] = useState<string | null>(null)
  const [challengeParseOnUpload, setChallengeParseOnUpload] = useState(false)
  const [challengeParsedJsonText, setChallengeParsedJsonText] = useState<string | null>(null)
  const [challengeParsedOpen, setChallengeParsedOpen] = useState(false)
  const [challengeUploading, setChallengeUploading] = useState(false)
  const [challengePosting, setChallengePosting] = useState(false)
  const [challengeDeleting, setChallengeDeleting] = useState(false)
  const challengeUploadInputRef = useRef<HTMLInputElement | null>(null)

  const openCreateChallengeComposer = useCallback(() => {
    setCreateOverlayOpen(true)
  }, [])

  const openCreateChallengeScreenshotPicker = useCallback(() => {
    setCreateOverlayOpen(true)
    if (typeof window === 'undefined') return
    let attempts = 0
    const tick = () => {
      const input = challengeUploadInputRef.current
      if (input) {
        try {
          input.click()
        } catch {
          // ignore
        }
        return
      }
      attempts += 1
      if (attempts > 12) return
      window.setTimeout(tick, 50)
    }
    window.setTimeout(tick, 0)
  }, [])

  const [challengeImageEditOpen, setChallengeImageEditOpen] = useState(false)
  const [challengeImageEditFile, setChallengeImageEditFile] = useState<File | null>(null)
  const [challengeImageSourceFile, setChallengeImageSourceFile] = useState<File | null>(null)

  const openDiagramPickerForPoint = useCallback((phaseKey: LessonPhaseKey, pointId: string) => {
    const boardId = buildLessonAuthoringBoardId('diagram', phaseKey, pointId)
    setDiagramUploadTarget({ phaseKey, pointId, boardId })
    try {
      diagramUploadInputRef.current?.click()
    } catch {
      // ignore
    }
  }, [])

  const persistLessonScriptDraftToStorage = useCallback((draft: Record<LessonPhaseKey, LessonPointDraft[]>) => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(LESSON_AUTHORING_STORAGE_KEY, JSON.stringify({ updatedAt: Date.now(), draft }))
    } catch {
      // ignore
    }
  }, [])

  const onDiagramFilePicked = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!diagramUploadTarget) return

    const fallbackTitle = toDisplayFileName(file.name) || file.name
    const title = (typeof window !== 'undefined' ? window.prompt('Diagram title?', fallbackTitle) : null) ?? fallbackTitle
    setDiagramUploading(true)
    try {
      const sessionKey = boardIdToSessionKey(diagramUploadTarget.boardId)
      const form = new FormData()
      form.append('file', file)
      form.append('sessionKey', sessionKey)

      const uploadRes = await fetch('/api/diagrams/upload', {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
      })

      if (!uploadRes.ok) {
        const msg = await uploadRes.text().catch(() => '')
        throw new Error(msg || `Upload failed (${uploadRes.status})`)
      }

      const uploadJson = (await uploadRes.json().catch(() => null)) as { url?: string } | null
      const url = uploadJson?.url
      if (!url) throw new Error('Upload succeeded but returned no URL')

      const createRes = await fetch('/api/diagrams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ sessionKey, imageUrl: url, title }),
      })
      if (!createRes.ok) {
        const msg = await createRes.text().catch(() => '')
        throw new Error(msg || `Create failed (${createRes.status})`)
      }

      setLessonScriptDraft(prev => {
        const snapshot = { title, imageUrl: url, annotations: null }
        const next = {
          ...prev,
          [diagramUploadTarget.phaseKey]: (prev[diagramUploadTarget.phaseKey] || []).map(p =>
            p.id === diagramUploadTarget.pointId ? { ...p, diagramSnapshot: snapshot } : p
          ),
        }
        persistLessonScriptDraftToStorage(next)
        return next
      })

      // Diagram authoring should pop over the current authoring page (no canvas underneath).
      setLessonAuthoringDiagramOverlay({
        phaseKey: diagramUploadTarget.phaseKey,
        pointId: diagramUploadTarget.pointId,
        boardId: diagramUploadTarget.boardId
      })
      setLessonAuthoringDiagramCloseSignal(0)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Diagram upload failed')
    } finally {
      setDiagramUploading(false)
      setDiagramUploadTarget(null)
    }
  }, [diagramUploadTarget, persistLessonScriptDraftToStorage])

  const loadLessonScriptDraftFromStorage = useCallback(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(LESSON_AUTHORING_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      const next = parsed?.draft
      if (!next || typeof next !== 'object') return
      setLessonScriptDraft(curr => {
        // Replace with stored draft to reflect edits saved from the authoring board.
        return next
      })
    } catch {
      // ignore
    }
  }, [])

  const uploadChallengeImage = useCallback(async (file: File) => {
    setChallengeUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      if (challengeParseOnUpload) form.append('parse', '1')
      const res = await fetch('/api/challenges/upload', {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || `Upload failed (${res.status})`)
      }
      const url = typeof data?.url === 'string' ? data.url.trim() : ''
      if (!url) throw new Error('Upload succeeded but returned no URL')
      setChallengeImageUrl(url)

      if (challengeParseOnUpload) {
        const parsed = data?.parsed
        const parseErr = typeof data?.parseError === 'string' ? data.parseError.trim() : ''
        if (parsed) {
          setChallengeParsedJsonText(JSON.stringify(parsed, null, 2))
          setChallengeParsedOpen(true)
        } else if (parseErr) {
          setChallengeParsedJsonText(parseErr)
          setChallengeParsedOpen(true)
        } else {
          setChallengeParsedJsonText(null)
          setChallengeParsedOpen(false)
        }

        const parsedPrompt = typeof data?.parsedPrompt === 'string' ? data.parsedPrompt.trim() : ''
        if (parsedPrompt) {
          setChallengePromptDraft((prev) => (prev.trim() ? prev : parsedPrompt))
        }
      }
    } finally {
      setChallengeUploading(false)
    }
  }, [challengeParseOnUpload])

  const onChallengeFilePicked = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setChallengeImageEditFile(file)
    setChallengeImageEditOpen(true)
  }, [])

  const closeCreateOverlay = useCallback(() => {
    setCreateOverlayOpen(false)
    setEditingChallengeId(null)
    setChallengeAudiencePickerOpen(false)
  }, [])

  const postChallenge = useCallback(async () => {
    if (status !== 'authenticated') return
    if (createKind !== 'quiz') return

    const title = challengeTitleDraft.trim()
    const prompt = challengePromptDraft.trim()
    const audience = challengeAudienceDraft

    if (!prompt && !challengeImageUrl) {
      return alert('Please type a prompt or upload a screenshot.')
    }

    const grade = selectedGrade || normalizeGradeInput((session as any)?.user?.grade as string | undefined) || null
    const maxAttempts = challengeMaxAttempts === 'unlimited' ? null : parseInt(challengeMaxAttempts, 10)
    setChallengePosting(true)
    try {
      const isEditing = Boolean(editingChallengeId)
      const endpoint = isEditing
        ? `/api/challenges/${encodeURIComponent(editingChallengeId as string)}`
        : '/api/challenges'
      const res = await fetch(endpoint, {
        method: isEditing ? 'PATCH' : 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          prompt,
          imageUrl: challengeImageUrl,
          audience,
          maxAttempts,
          ...(isEditing ? {} : { grade }),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        return alert(data?.message || `Failed to ${isEditing ? 'save' : 'post'} (${res.status})`)
      }

      if (isEditing && editingChallengeId) {
        const id = String(editingChallengeId)
        const patch = {
          id,
          title,
          prompt,
          imageUrl: challengeImageUrl,
          audience,
          maxAttempts,
        }
        setSelectedChallengeData((prev: any) => (prev && String(prev?.id) === id ? { ...prev, ...patch } : prev))
        setTimelineChallenges((prev: any[]) => (Array.isArray(prev) ? prev.map(p => (String((p as any)?.id) === id ? { ...(p as any), ...patch } : p)) : prev))
        setStudentFeedPosts((prev: any[]) => (Array.isArray(prev) ? prev.map(p => (String((p as any)?.id) === id ? { ...(p as any), ...patch } : p)) : prev))
      }

      discardRestore()
      closeCreateOverlay()
      setChallengeTitleDraft('')
      setChallengePromptDraft('')
      setChallengeAudienceDraft('public')
      setChallengeMaxAttempts('unlimited')
      setChallengeImageUrl(null)
      setChallengeImageSourceFile(null)
      setChallengeParsedJsonText(null)
      setChallengeParsedOpen(false)
      alert(editingChallengeId ? 'Saved' : 'Posted')
    } catch (err: any) {
      alert(err?.message || `Failed to ${editingChallengeId ? 'save' : 'post'}`)
    } finally {
      setChallengePosting(false)
    }
  }, [status, createKind, challengeTitleDraft, challengePromptDraft, challengeAudienceDraft, challengeImageUrl, selectedGrade, session, challengeMaxAttempts, editingChallengeId, closeCreateOverlay, discardRestore])

  const closeChallengeImageEdit = useCallback(() => {
    setChallengeImageEditOpen(false)
    setChallengeImageEditFile(null)
  }, [])

  const cancelChallengeImageEdit = useCallback(() => {
    closeChallengeImageEdit()
    if (!createOverlayOpen) return
    if (!hasRestore()) return
    closeCreateOverlay()
    const restore = popRestore()
    if (!restore) return
    window.setTimeout(() => {
      try {
        restore()
      } catch {
        // ignore
      }
    }, 0)
  }, [closeChallengeImageEdit, createOverlayOpen, hasRestore, closeCreateOverlay, popRestore])

  const confirmChallengeImageEdit = useCallback(async (file: File) => {
    try {
      closeChallengeImageEdit()
      setChallengeImageSourceFile(file)
      await uploadChallengeImage(file)
    } catch (err: any) {
      alert(err?.message || 'Failed to upload image')
    }
  }, [closeChallengeImageEdit, uploadChallengeImage])

  useEffect(() => {
    loadLessonScriptDraftFromStorage()
    if (typeof window === 'undefined') return
    const onFocus = () => loadLessonScriptDraftFromStorage()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadLessonScriptDraftFromStorage])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onDraftUpdated = () => loadLessonScriptDraftFromStorage()
    window.addEventListener('philani:lesson-authoring:draft-updated', onDraftUpdated as any)
    return () => window.removeEventListener('philani:lesson-authoring:draft-updated', onDraftUpdated as any)
  }, [loadLessonScriptDraftFromStorage])

  useEffect(() => {
    persistLessonScriptDraftToStorage(lessonScriptDraft)
  }, [lessonScriptDraft, persistLessonScriptDraftToStorage])
  const [minStartsAt, setMinStartsAt] = useState('')
  const [minEndsAt, setMinEndsAt] = useState('')
  const [sessions, setSessions] = useState<any[]>([])
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [users, setUsers] = useState<any[] | null>(null)
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [usersRoleFilter, setUsersRoleFilter] = useState<'all' | 'student' | 'teacher' | 'admin'>('student')
  const [usersVerifiedFilter, setUsersVerifiedFilter] = useState<'all' | 'verified' | 'unverified'>('all')
  const [usersSearch, setUsersSearch] = useState('')
  const [usersSort, setUsersSort] = useState<'newest' | 'oldest' | 'name'>('newest')
  const [usersFiltersOpen, setUsersFiltersOpen] = useState(false)
  const [usersCreateOpen, setUsersCreateOpen] = useState(false)
  const [usersListOpen, setUsersListOpen] = useState(false)
  const [selectedUserDetail, setSelectedUserDetail] = useState<any | null>(null)
  const [userDetailOverlayOpen, setUserDetailOverlayOpen] = useState(false)
  const [userDetailLoading, setUserDetailLoading] = useState(false)
  const [bulkVerifyLoading, setBulkVerifyLoading] = useState(false)
  const [userTempPassword, setUserTempPassword] = useState<string | null>(null)
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
  const [myResponses, setMyResponses] = useState<any[]>([])
  const [myResponsesLoading, setMyResponsesLoading] = useState(false)
  const [myResponsesError, setMyResponsesError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<SectionId>('overview')
  const [dashboardSectionOverlay, setDashboardSectionOverlay] = useState<OverlaySectionId | null>(null)
  const [accountSnapshotOverlayOpen, setAccountSnapshotOverlayOpen] = useState(false)
    useEffect(() => {
      if (!router.isReady) return
      const section = router.query.section
      if (typeof section !== 'string') return
      const valid = (DASHBOARD_SECTIONS as readonly any[]).some(s => s?.id === section)
      if (valid) {
        const next = section as SectionId
        if (next === 'overview') {
          setActiveSection('overview')
          setDashboardSectionOverlay(null)
        } else {
          setActiveSection(next)
          setDashboardSectionOverlay(next as OverlaySectionId)
          setAccountSnapshotOverlayOpen(false)
        }
      }
    }, [router.isReady, router.query.section])

  const [liveOverlayOpen, setLiveOverlayOpen] = useState(false)
  const [liveOverlayDismissed, setLiveOverlayDismissed] = useState(false)
  const [liveOverlayChromeVisible, setLiveOverlayChromeVisible] = useState(false)
  const [closeLiveOverlayOnCanvasClose, setCloseLiveOverlayOnCanvasClose] = useState(false)
  const [liveControls, setLiveControls] = useState<JitsiControls | null>(null)
  const [liveMuteState, setLiveMuteState] = useState<JitsiMuteState>({ audioMuted: true, videoMuted: true })
  const [liveTeacherAudioEnabled, setLiveTeacherAudioEnabled] = useState(true)
  const pendingLiveMicToggleRef = useRef(false)

  useEffect(() => {
    if (!liveControls) return
    if (!pendingLiveMicToggleRef.current) return
    pendingLiveMicToggleRef.current = false
    try {
      liveControls.toggleAudio()
    } catch {}
  }, [liveControls])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [liveOverrideSessionId, setLiveOverrideSessionId] = useState<string | null>(null)
  const [resolvedLiveSessionId, setResolvedLiveSessionId] = useState<string | null>(null)
  const [liveSelectionBusy, setLiveSelectionBusy] = useState(false)
  const [liveWindows, setLiveWindows] = useState<LiveWindowConfig[]>([])
  const [mobilePanels, setMobilePanels] = useState<{ announcements: boolean; sessions: boolean }>({ announcements: false, sessions: false })
  const [stageBounds, setStageBounds] = useState({ width: 0, height: 0 })
  const [readAnnouncementIds, setReadAnnouncementIds] = useState<string[]>([])
  const [mobileHeroBgUrl, setMobileHeroBgUrl] = useState<string>(() => buildDefaultMobileHeroSvg())
  const [mobileThemeBgUrl, setMobileThemeBgUrl] = useState<string>(() => buildDefaultMobileHeroSvg())
  const mobileHeroHasCustom = useMemo(() => {
    if (!mobileHeroBgUrl) return false
    // Default hero is an inline SVG data URL; user-uploaded images will be image/jpeg, image/png, etc.
    return !mobileHeroBgUrl.startsWith('data:image/svg+xml,')
  }, [mobileHeroBgUrl])
  const [mobileHeroBgDragActive, setMobileHeroBgDragActive] = useState(false)
  const { visible: mobileHeroBgEditVisible, peek: showMobileHeroEdit } = useTapToPeek({ autoHideMs: 2500 })
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const heroBgInputRef = useRef<HTMLInputElement | null>(null)
  const themeBgInputRef = useRef<HTMLInputElement | null>(null)
  const windowZCounterRef = useRef(50)
  const stageRef = useRef<HTMLDivElement | null>(null)

  // One shared hidden input so the dashboard button can open the file picker as a direct user gesture.
  // This keeps diagram upload standalone and avoids navigation.
  // eslint-disable-next-line @next/next/no-img-element

  const materialsRequestIdRef = useRef(0)
  const latexSavesRequestIdRef = useRef(0)

  const [subscriptionGatingEnabled, setSubscriptionGatingEnabled] = useState<boolean | null>(null)
  const [subscriptionGatingSaving, setSubscriptionGatingSaving] = useState(false)
  const [subscriptionGatingError, setSubscriptionGatingError] = useState<string | null>(null)

  const [sessionDetailsOpen, setSessionDetailsOpen] = useState(false)
  const [sessionDetailsIds, setSessionDetailsIds] = useState<string[]>([])
  const [sessionDetailsIndex, setSessionDetailsIndex] = useState(0)
  const [sessionDetailsView, setSessionDetailsView] = useState<'pastList' | 'details'>('details')
  const [sessionDetailsTab, setSessionDetailsTab] = useState<'assignments' | 'responses'>('assignments')

  const [assignmentOverlayOpen, setAssignmentOverlayOpen] = useState(false)
  const [assignmentQuestionOverlayOpen, setAssignmentQuestionOverlayOpen] = useState(false)
  const [selectedAssignmentQuestionId, setSelectedAssignmentQuestionId] = useState<string | null>(null)

  const [createLessonOverlayOpen, setCreateLessonOverlayOpen] = useState(false)
  const [liveLessonSelectorOverlayOpen, setLiveLessonSelectorOverlayOpen] = useState(false)

  const topStackOverlayOpen =
    Boolean(liveOverlayOpen) ||
    Boolean(lessonAuthoringDiagramOverlay) ||
    Boolean(createLessonOverlayOpen) ||
    Boolean(liveLessonSelectorOverlayOpen)

  const isCapacitorWrappedApp = useMemo(() => {
    if (typeof window === 'undefined') return false
    const cap = (window as any)?.Capacitor
    try {
      if (typeof cap?.isNativePlatform === 'function') return Boolean(cap.isNativePlatform())
    } catch {
      // ignore runtime detection errors
    }
    return Boolean(cap?.isNative)
  }, [])

  const sessionDetailsHiddenByChildOverlay = assignmentOverlayOpen || assignmentQuestionOverlayOpen

  const openDashboardOverlay = useCallback((section: OverlaySectionId) => {
    setDashboardSectionOverlay(section)
    setActiveSection(section)
    setAccountSnapshotOverlayOpen(false)
  }, [])

  const closeDashboardOverlay = useCallback(() => {
    setDashboardSectionOverlay(null)
    setActiveSection('overview')
  }, [])

  const [assignments, setAssignments] = useState<any[]>([])
  const [assignmentsLoading, setAssignmentsLoading] = useState(false)
  const [assignmentsError, setAssignmentsError] = useState<string | null>(null)
  const [assignmentImporting, setAssignmentImporting] = useState(false)
  const [assignmentImportError, setAssignmentImportError] = useState<string | null>(null)
  const [assignmentFile, setAssignmentFile] = useState<File | null>(null)
  const [assignmentTitle, setAssignmentTitle] = useState('')
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null)
  const [selectedAssignment, setSelectedAssignment] = useState<any | null>(null)
  const [selectedAssignmentLoading, setSelectedAssignmentLoading] = useState(false)
  const [selectedAssignmentError, setSelectedAssignmentError] = useState<string | null>(null)
  const [assignmentResponsesByQuestionId, setAssignmentResponsesByQuestionId] = useState<Record<string, any>>({})
  const [assignmentResponsesLoading, setAssignmentResponsesLoading] = useState(false)
  const [assignmentResponsesError, setAssignmentResponsesError] = useState<string | null>(null)
  const [assignmentSubmittedAt, setAssignmentSubmittedAt] = useState<string | null>(null)
  const [assignmentSubmitting, setAssignmentSubmitting] = useState(false)
  const [assignmentSubmitError, setAssignmentSubmitError] = useState<string | null>(null)
  const [assignmentGradeLoading, setAssignmentGradeLoading] = useState(false)
  const [assignmentGradeError, setAssignmentGradeError] = useState<string | null>(null)
  const [assignmentGradeByQuestionId, setAssignmentGradeByQuestionId] = useState<Record<string, 'correct' | 'incorrect'>>({})
  const [assignmentEarnedMarksByQuestionId, setAssignmentEarnedMarksByQuestionId] = useState<Record<string, number>>({})
  const [assignmentTotalMarksByQuestionId, setAssignmentTotalMarksByQuestionId] = useState<Record<string, number>>({})
  const [assignmentStepFeedbackByQuestionId, setAssignmentStepFeedbackByQuestionId] = useState<Record<string, any[]>>({})
  const [assignmentGradeSummary, setAssignmentGradeSummary] = useState<{ earnedPoints: number; totalPoints: number; percentage: number } | null>(null)

  const [adminAssignmentSubmissions, setAdminAssignmentSubmissions] = useState<any[]>([])
  const [adminAssignmentSubmissionsLoading, setAdminAssignmentSubmissionsLoading] = useState(false)
  const [adminAssignmentSubmissionsError, setAdminAssignmentSubmissionsError] = useState<string | null>(null)
  const [adminSelectedSubmissionUserId, setAdminSelectedSubmissionUserId] = useState<string | null>(null)
  const [adminSelectedSubmissionDetail, setAdminSelectedSubmissionDetail] = useState<any | null>(null)
  const [adminSelectedSubmissionLoading, setAdminSelectedSubmissionLoading] = useState(false)
  const [adminSelectedSubmissionError, setAdminSelectedSubmissionError] = useState<string | null>(null)
  const [adminSubmissionOverlayOpen, setAdminSubmissionOverlayOpen] = useState(false)
  const [adminRegradeLoading, setAdminRegradeLoading] = useState(false)
  const [adminRegradeError, setAdminRegradeError] = useState<string | null>(null)

  const [learnerSubmissionOverlayOpen, setLearnerSubmissionOverlayOpen] = useState(false)
  const [assignmentSolutionsByQuestionId, setAssignmentSolutionsByQuestionId] = useState<Record<string, any>>({})
  const [assignmentSolutionsLoading, setAssignmentSolutionsLoading] = useState(false)
  const [assignmentSolutionsError, setAssignmentSolutionsError] = useState<string | null>(null)
  const [assignmentSolutionUploadFilesByQuestionId, setAssignmentSolutionUploadFilesByQuestionId] = useState<Record<string, File | null>>({})
  const [assignmentSolutionUploadNonceByQuestionId, setAssignmentSolutionUploadNonceByQuestionId] = useState<Record<string, number>>({})
  const [assignmentSolutionUploadingQuestionId, setAssignmentSolutionUploadingQuestionId] = useState<string | null>(null)

  const [assignmentSolutionMarkingPlanDraftByQuestionId, setAssignmentSolutionMarkingPlanDraftByQuestionId] = useState<Record<string, string>>({})
  const [assignmentSolutionMarkingPlanEditingByQuestionId, setAssignmentSolutionMarkingPlanEditingByQuestionId] = useState<Record<string, boolean>>({})
  const [assignmentSolutionMarkingPlanSavingQuestionId, setAssignmentSolutionMarkingPlanSavingQuestionId] = useState<string | null>(null)
  const [assignmentSolutionMarkingPlanGeneratingQuestionId, setAssignmentSolutionMarkingPlanGeneratingQuestionId] = useState<string | null>(null)

  const [assignmentSolutionWorkedSolutionDraftByQuestionId, setAssignmentSolutionWorkedSolutionDraftByQuestionId] = useState<Record<string, string>>({})
  const [assignmentSolutionWorkedSolutionEditingByQuestionId, setAssignmentSolutionWorkedSolutionEditingByQuestionId] = useState<Record<string, boolean>>({})
  const [assignmentSolutionWorkedSolutionSavingQuestionId, setAssignmentSolutionWorkedSolutionSavingQuestionId] = useState<string | null>(null)
  const [assignmentSolutionWorkedSolutionGeneratingQuestionId, setAssignmentSolutionWorkedSolutionGeneratingQuestionId] = useState<string | null>(null)

  const [timelineOpen, setTimelineOpen] = useState(false)
  const [timelineChallenges, setTimelineChallenges] = useState<any[]>([])
  const [timelineChallengesLoading, setTimelineChallengesLoading] = useState(false)
  const [timelineChallengesError, setTimelineChallengesError] = useState<string | null>(null)
  const [timelineUserId, setTimelineUserId] = useState<string | null>(null)
  const timelineFetchedOnceRef = useRef(false)
  const [readTimelinePostIds, setReadTimelinePostIds] = useState<string[]>([])
  
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [challengeGradingOverlayOpen, setChallengeGradingOverlayOpen] = useState(false)
  const [selectedChallengeId, setSelectedChallengeId] = useState<string | null>(null)
  const [selectedChallengeData, setSelectedChallengeData] = useState<any | null>(null)
  const [selectedChallengeLoading, setSelectedChallengeLoading] = useState(false)
  const [selectedChallengeError, setSelectedChallengeError] = useState<string | null>(null)
  const [challengeSubmissions, setChallengeSubmissions] = useState<any[]>([])
  const [challengeSubmissionsLoading, setChallengeSubmissionsLoading] = useState(false)
  const [challengeSubmissionsError, setChallengeSubmissionsError] = useState<string | null>(null)
  const [selectedSubmissionUserId, setSelectedSubmissionUserId] = useState<string | null>(null)
  const [selectedSubmissionDetail, setSelectedSubmissionDetail] = useState<any | null>(null)
  const [selectedSubmissionLoading, setSelectedSubmissionLoading] = useState(false)
  const [selectedSubmissionError, setSelectedSubmissionError] = useState<string | null>(null)
  const [challengeGradingResponseId, setChallengeGradingResponseId] = useState<string | null>(null)
  const [challengeGradingByStep, setChallengeGradingByStep] = useState<Record<number, string>>({})
  const [challengeGradingFeedback, setChallengeGradingFeedback] = useState('')
  const [challengeGradingStepFeedback, setChallengeGradingStepFeedback] = useState<Record<number, string>>({})
  const [challengeGradingStepMarks, setChallengeGradingStepMarks] = useState<Record<number, number>>({})
  const [challengeGradingSaving, setChallengeGradingSaving] = useState(false)
  const suppressChallengeAutoOpenRef = useRef(false)

  const [challengeResponseOverlayOpen, setChallengeResponseOverlayOpen] = useState(false)
  const [selectedChallengeResponseId, setSelectedChallengeResponseId] = useState<string | null>(null)
  const [challengeResponseLoading, setChallengeResponseLoading] = useState(false)
  const [challengeResponseError, setChallengeResponseError] = useState<string | null>(null)
  const [challengeResponseChallenge, setChallengeResponseChallenge] = useState<any | null>(null)
  const [challengeMyResponses, setChallengeMyResponses] = useState<any[]>([])

  const [studentFeedPosts, setStudentFeedPosts] = useState<any[]>([])
  const [studentFeedLoading, setStudentFeedLoading] = useState(false)
  const [studentFeedError, setStudentFeedError] = useState<string | null>(null)

  useEffect(() => {
    if (status !== 'authenticated') return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/profile', { credentials: 'same-origin' })
        if (!res.ok) return
        const data = await res.json().catch(() => ({}))
        const userId = typeof data?.id === 'string' ? data.id : ''
        if (!cancelled && userId) setViewerId(userId)
      } catch {
        // ignore
      }
    })()
    return () => {
      cancelled = true
    }
  }, [status])

  const [studentMobileTab, setStudentMobileTab] = useState<'timeline' | 'sessions' | 'groups' | 'discover'>('timeline')
  const [studentQuickOverlay, setStudentQuickOverlay] = useState<'timeline' | 'sessions' | 'groups' | 'discover' | 'admin' | null>(null)
  const [booksOverlayOpen, setBooksOverlayOpen] = useState(false)
  const [booksLoading, setBooksLoading] = useState(false)
  const [booksError, setBooksError] = useState<string | null>(null)
  const [booksItems, setBooksItems] = useState<ResourceBankItem[]>([])
  const [offlineDocUrls, setOfflineDocUrls] = useState<string[]>([])
  const [offlineDocSavingUrls, setOfflineDocSavingUrls] = useState<string[]>([])
  const [offlineDocErrorByUrl, setOfflineDocErrorByUrl] = useState<Record<string, string>>({})
  type PdfViewerSnapshot = {
    page: number
    zoom: number
    scrollTop: number
  }
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false)
  const [pdfViewerUrl, setPdfViewerUrl] = useState('')
  const [pdfViewerTitle, setPdfViewerTitle] = useState('')
  const [pdfViewerSubtitle, setPdfViewerSubtitle] = useState('')
  const [pdfViewerInitialState, setPdfViewerInitialState] = useState<PdfViewerSnapshot | null>(null)
  const [pdfViewerOfflineObjectUrl, setPdfViewerOfflineObjectUrl] = useState<string | null>(null)
  const [gradeWorkspaceSelectorOpen, setGradeWorkspaceSelectorOpen] = useState(false)
  const [gradeWorkspaceSelectorAnchor, setGradeWorkspaceSelectorAnchor] = useState<PillAnchorRect | null>(null)
  const [gradeWorkspaceSelectorExternalDrag, setGradeWorkspaceSelectorExternalDrag] = useState<{ pointerId: number; startClientY: number } | null>(null)
  const [gradeWorkspaceSelectorPreview, setGradeWorkspaceSelectorPreview] = useState<GradeValue | null>(null)
  const studentMobilePanelsRef = useRef<HTMLDivElement | null>(null)
  const studentMobilePanelRefs = useRef<{
    timeline: HTMLDivElement | null
    sessions: HTMLDivElement | null
    groups: HTMLDivElement | null
    discover: HTMLDivElement | null
  }>({ timeline: null, sessions: null, groups: null, discover: null })
  const studentMobileScrollRafRef = useRef<number | null>(null)
  const studentMobileScrollEndTimeoutRef = useRef<number | null>(null)

  const [sessionThumbnailUrlDraft, setSessionThumbnailUrlDraft] = useState<string | null>(null)
  const [sessionThumbnailUploading, setSessionThumbnailUploading] = useState(false)
  const sessionThumbnailInputRef = useRef<HTMLInputElement | null>(null)

  const [updatingSessionThumbnailId, setUpdatingSessionThumbnailId] = useState<string | null>(null)
  const [updatingSessionThumbnailBusy, setUpdatingSessionThumbnailBusy] = useState(false)
  const updateSessionThumbnailInputRef = useRef<HTMLInputElement | null>(null)

  const [assignmentMasterGradingPrompt, setAssignmentMasterGradingPrompt] = useState('')
  const [assignmentMasterGradingPromptEditing, setAssignmentMasterGradingPromptEditing] = useState(false)
  const [assignmentGradingPromptByQuestionId, setAssignmentGradingPromptByQuestionId] = useState<Record<string, string>>({})
  const [assignmentGradingPromptEditingByQuestionId, setAssignmentGradingPromptEditingByQuestionId] = useState<Record<string, boolean>>({})
  const [assignmentGradingPromptSavingScope, setAssignmentGradingPromptSavingScope] = useState<string | null>(null)
  const [lessonScriptTemplates, setLessonScriptTemplates] = useState<any[]>([])
  const [lessonScriptTemplatesLoading, setLessonScriptTemplatesLoading] = useState(false)
  const [lessonScriptTemplatesError, setLessonScriptTemplatesError] = useState<string | null>(null)
  const [lessonScriptVersions, setLessonScriptVersions] = useState<any[]>([])
  const [lessonScriptVersionsLoading, setLessonScriptVersionsLoading] = useState(false)
  const [lessonScriptVersionsError, setLessonScriptVersionsError] = useState<string | null>(null)
  const [lessonScriptResolved, setLessonScriptResolved] = useState<any | null>(null)
  const [lessonScriptAssignment, setLessonScriptAssignment] = useState<any | null>(null)
  const [lessonScriptSource, setLessonScriptSource] = useState<string>('none')
  const [lessonScriptLoading, setLessonScriptLoading] = useState(false)
  const [lessonScriptError, setLessonScriptError] = useState<string | null>(null)
  const [lessonScriptSelectedTemplateId, setLessonScriptSelectedTemplateId] = useState('')
  const [lessonScriptSelectedVersionId, setLessonScriptSelectedVersionId] = useState('')
  const [lessonScriptOverrideText, setLessonScriptOverrideText] = useState('')
  const [lessonScriptSaving, setLessonScriptSaving] = useState(false)
  const lessonScriptLastLoadedSessionIdRef = useRef<string | null>(null)

  const [newLessonScriptTitle, setNewLessonScriptTitle] = useState('')
  const [newLessonScriptSubject, setNewLessonScriptSubject] = useState('')
  const [newLessonScriptTopic, setNewLessonScriptTopic] = useState('')
  const [newLessonScriptContentText, setNewLessonScriptContentText] = useState(
    '{\n  "schemaVersion": 1,\n  "title": "New lesson",\n  "phases": []\n}'
  )
  const [newLessonScriptVersionContentText, setNewLessonScriptVersionContentText] = useState(
    '{\n  "schemaVersion": 1,\n  "title": "Updated lesson",\n  "phases": []\n}'
  )

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
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null)
  const [profileStatusBio, setProfileStatusBio] = useState<string | null>(null)
  const [profileUiHandedness, setProfileUiHandedness] = useState<'left' | 'right'>('right')
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarEditArmed, setAvatarEditArmed] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const effectiveAvatarUrl = (profileAvatarUrl || learnerAvatarUrl || '').trim() || null
  const [statusBioEditing, setStatusBioEditing] = useState(false)
  const [statusBioDraft, setStatusBioDraft] = useState('')
  const [statusBioSaving, setStatusBioSaving] = useState(false)

  type MyGroupRow = {
    membershipId: string
    memberRole: string
    joinedAt: string
    group: {
      id: string
      name: string
      type: string
      grade: string | null
      joinCodeActive: boolean
      allowJoinRequests?: boolean
      membersCount: number
      createdAt: string
      updatedAt: string
    }
  }

  type GroupMemberRow = {
    membershipId: string
    memberRole: string
    joinedAt: string
    user: {
      id: string
      name: string
      role: string
      grade: string | null
      avatar: string | null
      statusBio: string | null
      profileVisibility?: string | null
    }
  }

  const [myGroups, setMyGroups] = useState<MyGroupRow[]>([])
  const [myGroupsLoading, setMyGroupsLoading] = useState(false)
  const [myGroupsError, setMyGroupsError] = useState<string | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<GroupMemberRow[]>([])
  const [selectedGroupLoading, setSelectedGroupLoading] = useState(false)
  const [selectedGroupJoinCode, setSelectedGroupJoinCode] = useState<string | null>(null)
  const [selectedGroupAllowJoinRequests, setSelectedGroupAllowJoinRequests] = useState<boolean>(true)
  const [selectedGroupCreatedById, setSelectedGroupCreatedById] = useState<string | null>(null)
  const [regenerateJoinCodeBusy, setRegenerateJoinCodeBusy] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)

  const [discoverQuery, setDiscoverQuery] = useState('')
  const [discoverLoading, setDiscoverLoading] = useState(false)
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [discoverResults, setDiscoverResults] = useState<any[]>([])
  const discoverLiveSearchTimeoutRef = useRef<number | null>(null)

  const discoverCacheKey = useMemo(() => {
    const id = String((session as any)?.user?.id || session?.user?.email || 'anon')
    return `pa:discover:recs:v1:${id}`
  }, [session])

  const discoverLastQueryKey = useMemo(() => {
    const id = String((session as any)?.user?.id || session?.user?.email || 'anon')
    return `pa:discover:lastQuery:v1:${id}`
  }, [session])

  const [actionInvites, setActionInvites] = useState<any[]>([])
  const [actionJoinRequests, setActionJoinRequests] = useState<any[]>([])
  const [activityFeed, setActivityFeed] = useState<any[]>([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)

  const [createGroupName, setCreateGroupName] = useState('')
  const [createGroupType, setCreateGroupType] = useState<'class' | 'cohort' | 'study_group'>('study_group')
  const [createGroupGrade, setCreateGroupGrade] = useState<string>('')
  const [createGroupBusy, setCreateGroupBusy] = useState(false)

  const [joinCode, setJoinCode] = useState('')
  const [joinBusy, setJoinBusy] = useState(false)

  const [profilePeek, setProfilePeek] = useState<null | {
    id: string
    name: string
    role: string
    grade: string | null
    avatar: string | null
    statusBio: string | null
    schoolName?: string | null
    verified: boolean
  }>(null)
  const [profilePeekError, setProfilePeekError] = useState<string | null>(null)

  useEffect(() => {
    if (!avatarEditArmed) return
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-avatar-edit-container="1"]')) return
      setAvatarEditArmed(false)
    }

    document.addEventListener('mousedown', handlePointerDown, true)
    document.addEventListener('touchstart', handlePointerDown, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true)
      document.removeEventListener('touchstart', handlePointerDown, true)
    }
  }, [avatarEditArmed])
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
  const isInstructor = normalizedRole === 'teacher'
  const isVerifiedAccount = isAdmin || isInstructor
  const roleFlagText = useMemo(() => {
    if (normalizedRole === 'admin') return 'Admin'
    if (normalizedRole === 'teacher') return 'Instructor'
    if (normalizedRole === 'student') {
      const gradeText = status === 'authenticated' ? activeGradeLabel : ''
      return gradeText ? `Student (${gradeText})` : 'Student'
    }
    return 'Guest'
  }, [activeGradeLabel, normalizedRole, status])
  const canManageAnnouncements = normalizedRole === 'admin' || normalizedRole === 'teacher'
  const isLearner = normalizedRole === 'student'
  const isTestStudent = useMemo(() => isSpecialTestStudentEmail(session?.user?.email || ''), [session?.user?.email])
  const learnerNotesLabel = 'Notes'
  const learnerNotesLabelLower = 'notes'
  const effectiveSubscriptionGatingEnabled = subscriptionGatingEnabled ?? true
  const isSubscriptionBlocked = isLearner && effectiveSubscriptionGatingEnabled && subscriptionActive === false

  const offlineCachePrefix = useMemo(() => {
    const userKey = session?.user?.email || (session as any)?.user?.id || session?.user?.name || 'anon'
    return `pa:offline:${userKey}`
  }, [session])

  const makeOfflineCacheKey = useCallback((suffix: string) => {
    return `${offlineCachePrefix}:${suffix}`
  }, [offlineCachePrefix])

  const offlineDocsKey = useMemo(() => makeOfflineCacheKey('offline-docs'), [makeOfflineCacheKey])

  const announcementReadStorageKey = useMemo(() => {
    const userKey = session?.user?.email || (session as any)?.user?.id || session?.user?.name || 'anon'
    return `pa:readAnnouncements:${userKey}`
  }, [session])

  const timelineReadStorageKey = useMemo(() => {
    const userKey = session?.user?.email || (session as any)?.user?.id || session?.user?.name || 'anon'
    return `pa:readTimelinePosts:${userKey}`
  }, [session])

  useEffect(() => {
    if (status !== 'authenticated') return
    let cancelled = false
    const cacheKey = makeOfflineCacheKey('profile')
    const cached = readLocalCache<{ avatar?: string | null; uiHandedness?: string | null; statusBio?: string | null }>(cacheKey)
    if (cached?.data && !cancelled) {
      const cachedAvatar = typeof cached.data.avatar === 'string' ? cached.data.avatar.trim() : ''
      const cachedHand = typeof cached.data.uiHandedness === 'string' ? cached.data.uiHandedness.trim().toLowerCase() : ''
      const cachedStatus = typeof cached.data.statusBio === 'string' ? cached.data.statusBio.trim() : ''
      setProfileAvatarUrl(cachedAvatar || null)
      setProfileUiHandedness(cachedHand === 'left' ? 'left' : 'right')
      setProfileStatusBio(cachedStatus || null)
      setStatusBioDraft(cachedStatus || '')
    }
    ;(async () => {
      try {
        const res = await fetch('/api/profile', { credentials: 'same-origin' })
        if (!res.ok) return
        const data = await res.json().catch(() => ({}))
        const next = typeof data?.avatar === 'string' ? data.avatar.trim() : ''
        if (!cancelled) setProfileAvatarUrl(next || null)

        const nextHand = typeof data?.uiHandedness === 'string' ? data.uiHandedness.trim().toLowerCase() : ''
        if (!cancelled) setProfileUiHandedness(nextHand === 'left' ? 'left' : 'right')

        const nextStatus = typeof data?.statusBio === 'string' ? data.statusBio.trim() : ''
        if (!cancelled) {
          setProfileStatusBio(nextStatus || null)
          setStatusBioDraft(nextStatus || '')
        }
        if (!cancelled) {
          writeLocalCache(cacheKey, {
            avatar: next || null,
            uiHandedness: nextHand || null,
            statusBio: nextStatus || null
          })
        }
      } catch {
        // ignore
      }
    })()
    return () => {
      cancelled = true
    }
  }, [status])

  const loadMyGroups = useCallback(async () => {
    if (status !== 'authenticated') return
    setMyGroupsLoading(true)
    setMyGroupsError(null)
    try {
      const res = await fetch('/api/groups/mine', { credentials: 'same-origin' })
      const data = await res.json().catch(() => ([]))
      if (!res.ok) {
        setMyGroups([])
        setMyGroupsError(data?.message || `Failed to load groups (${res.status})`)
        return
      }
      setMyGroups(Array.isArray(data) ? data : [])
    } catch (err: any) {
      setMyGroups([])
      setMyGroupsError(err?.message || 'Failed to load groups')
    } finally {
      setMyGroupsLoading(false)
    }
  }, [status])

  const loadGroupMembers = useCallback(async (groupId: string) => {
    if (!groupId) return
    setSelectedGroupLoading(true)
    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}`, { credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data?.message || `Failed to load group (${res.status})`)
        setSelectedGroupMembers([])
        return
      }
      const nextMembers = Array.isArray(data?.members) ? data.members : []
      setSelectedGroupMembers(nextMembers)
      setSelectedGroupId(groupId)
      setSelectedGroupJoinCode(typeof data?.joinCode === 'string' && data.joinCode.trim() ? data.joinCode.trim() : null)
      setSelectedGroupAllowJoinRequests(typeof data?.allowJoinRequests === 'boolean' ? data.allowJoinRequests : true)
      setSelectedGroupCreatedById(typeof data?.createdById === 'string' ? data.createdById : null)
    } catch (err: any) {
      alert(err?.message || 'Failed to load group')
      setSelectedGroupMembers([])
    } finally {
      setSelectedGroupLoading(false)
    }
  }, [])

  const loadNotifications = useCallback(async () => {
    if (status !== 'authenticated') return
    setNotificationsLoading(true)
    try {
      const res = await fetch('/api/notifications', { credentials: 'same-origin' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.message || 'Failed to load notifications')
      setActionInvites(Array.isArray(data?.invites) ? data.invites : [])
      setActionJoinRequests(Array.isArray(data?.joinRequests) ? data.joinRequests : [])
      setActivityFeed(Array.isArray(data?.activity) ? data.activity : [])
    } catch (err: any) {
      console.warn('loadNotifications error', err)
    } finally {
      setNotificationsLoading(false)
    }
  }, [status])

  const searchDiscover = useCallback(async (query: string) => {
    const q = query.trim()
    const role = ((session as any)?.user?.role as string | undefined) || 'student'
    const isPrivileged = role === 'admin' || role === 'teacher'

    // Allow empty query for recommendations and 1-char live search.
    // Privileged users may still see more results due to server-side rules.

    setDiscoverLoading(true)
    setDiscoverError(null)
    try {
      let hint = ''
      try {
        hint = (typeof window !== 'undefined' ? (window.localStorage.getItem(discoverLastQueryKey) || '') : '')
      } catch {}

      const url = q.length >= 1
        ? `/api/discover/users?q=${encodeURIComponent(q)}&hint=${encodeURIComponent(q)}`
        : `/api/discover/users?hint=${encodeURIComponent(hint)}`
      const res = await fetch(url, { credentials: 'same-origin' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.message || 'Search failed')
      setDiscoverResults(Array.isArray(data) ? data : [])

      try {
        if (typeof window !== 'undefined') {
          if (q.length >= 1) window.localStorage.setItem(discoverLastQueryKey, q)
          if (q.length === 0) window.localStorage.setItem(discoverCacheKey, JSON.stringify(Array.isArray(data) ? data : []))
        }
      } catch {
        // ignore
      }
    } catch (err: any) {
      setDiscoverError(err?.message || 'Search failed')
    } finally {
      setDiscoverLoading(false)
    }
  }, [discoverCacheKey, discoverLastQueryKey, session])

  const discoverPanelActive = dashboardSectionOverlay === 'discover' || studentQuickOverlay === 'discover'
  const discoverPanelActiveRef = useRef(false)

  useEffect(() => {
    // When opening Discover (either the full overlay or the mobile quick overlay),
    // show cached recommendations instantly and reset the query.
    if (!discoverPanelActive) {
      discoverPanelActiveRef.current = false
      return
    }

    if (discoverPanelActiveRef.current) return
    discoverPanelActiveRef.current = true

    setDiscoverError(null)
    setDiscoverQuery('')

    try {
      if (typeof window !== 'undefined') {
        const raw = window.localStorage.getItem(discoverCacheKey)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) setDiscoverResults(parsed)
        } else {
          setDiscoverResults([])
        }
      }
    } catch {
      setDiscoverResults([])
    }
  }, [discoverCacheKey, discoverPanelActive])

  useEffect(() => {
    if (!discoverPanelActive) return
    if (typeof window === 'undefined') return

    if (discoverLiveSearchTimeoutRef.current) {
      window.clearTimeout(discoverLiveSearchTimeoutRef.current)
      discoverLiveSearchTimeoutRef.current = null
    }

    const q = discoverQuery
    const trimmed = q.trim()

    // Empty query: fetch recommendations immediately.
    if (trimmed.length === 0) {
      void searchDiscover('')
      return
    }

    // Live refine from the first character with a small debounce.
    const delayMs = trimmed.length <= 1 ? 120 : 180
    discoverLiveSearchTimeoutRef.current = window.setTimeout(() => {
      discoverLiveSearchTimeoutRef.current = null
      void searchDiscover(q)
    }, delayMs)

    return () => {
      if (discoverLiveSearchTimeoutRef.current) {
        window.clearTimeout(discoverLiveSearchTimeoutRef.current)
        discoverLiveSearchTimeoutRef.current = null
      }
    }
  }, [discoverPanelActive, discoverQuery, searchDiscover])

  useEffect(() => {
    if (status !== 'authenticated') return
    void loadNotifications()
    const intervalId = window.setInterval(() => {
      void loadNotifications()
    }, 30000)
    const handleFocus = () => void loadNotifications()
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleFocus)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleFocus)
    }
  }, [status, loadNotifications])

  const respondInvite = useCallback(async (inviteId: string, action: 'accept' | 'decline') => {
    try {
      const res = await fetch(`/api/groups/invites/${encodeURIComponent(inviteId)}/respond`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.message || 'Failed')
      await loadNotifications()
      await loadMyGroups()
    } catch (err: any) {
      alert(err?.message || 'Failed')
    }
  }, [loadMyGroups, loadNotifications])

  const respondJoinRequest = useCallback(async (requestId: string, action: 'accept' | 'decline') => {
    try {
      const res = await fetch(`/api/groups/requests/${encodeURIComponent(requestId)}/respond`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.message || 'Failed')
      await loadNotifications()
      if (selectedGroupId) await loadGroupMembers(selectedGroupId)
    } catch (err: any) {
      alert(err?.message || 'Failed')
    }
  }, [loadGroupMembers, loadNotifications, selectedGroupId])

  useEffect(() => {
    if (dashboardSectionOverlay !== 'groups') return
    setSelectedGroupId(null)
    setSelectedGroupMembers([])
    setSelectedGroupJoinCode(null)
    setSelectedGroupAllowJoinRequests(true)
    setSelectedGroupCreatedById(null)
    setInviteEmail('')
    setProfilePeek(null)
    setProfilePeekError(null)
    void loadMyGroups()
    void loadNotifications()
  }, [dashboardSectionOverlay, loadMyGroups, loadNotifications])

  useEffect(() => {
    // Keep the legacy overlay effect as a no-op (behavior moved to discoverPanelActive effect).
  }, [dashboardSectionOverlay, searchDiscover, session])

  const createGroup = useCallback(async () => {
    const name = createGroupName.trim()
    if (!name) return
    setCreateGroupBusy(true)
    try {
      const payload: any = { name, type: createGroupType }
      if (createGroupGrade) payload.grade = createGroupGrade
      const res = await fetch('/api/groups', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data?.message || `Failed to create group (${res.status})`)
        return
      }
      setCreateGroupName('')
      setCreateGroupGrade('')
      await loadMyGroups()
      if (typeof data?.id === 'string') {
        await loadGroupMembers(data.id)
        if (typeof data?.joinCode === 'string' && data.joinCode.trim()) {
          try {
            await navigator.clipboard?.writeText(data.joinCode.trim())
          } catch {
            // ignore
          }
          alert(`Group created. Join code copied: ${data.joinCode}`)
        } else {
          alert('Group created.')
        }
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to create group')
    } finally {
      setCreateGroupBusy(false)
    }
  }, [createGroupGrade, createGroupName, createGroupType, loadGroupMembers, loadMyGroups])

  const joinGroupByCode = useCallback(async () => {
    const code = joinCode.trim()
    if (!code) return
    setJoinBusy(true)
    try {
      const res = await fetch('/api/groups/join', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data?.message || `Failed to join (${res.status})`)
        return
      }
      setJoinCode('')
      await loadMyGroups()
      if (typeof data?.id === 'string') await loadGroupMembers(data.id)
      alert('Joined group.')
    } catch (err: any) {
      alert(err?.message || 'Failed to join group')
    } finally {
      setJoinBusy(false)
    }
  }, [joinCode, loadGroupMembers, loadMyGroups])

  const regenerateSelectedGroupJoinCode = useCallback(async () => {
    if (!selectedGroupId) return
    setRegenerateJoinCodeBusy(true)
    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(selectedGroupId)}/regenerate-join-code`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to regenerate (${res.status})`)
      const code = typeof data?.joinCode === 'string' ? data.joinCode.trim() : ''
      setSelectedGroupJoinCode(code || null)
      if (code) {
        try {
          await navigator.clipboard?.writeText(code)
        } catch {
          // ignore
        }
      }
      alert(code ? `New join code copied: ${code}` : 'Join code regenerated')
    } catch (err: any) {
      alert(err?.message || 'Failed to regenerate join code')
    } finally {
      setRegenerateJoinCodeBusy(false)
    }
  }, [selectedGroupId])

  const sendSelectedGroupInvite = useCallback(async () => {
    if (!selectedGroupId) return
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return
    setInviteBusy(true)
    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(selectedGroupId)}/invite`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to invite (${res.status})`)
      setInviteEmail('')
      await loadNotifications()
      alert('Invite sent')
    } catch (err: any) {
      alert(err?.message || 'Failed to send invite')
    } finally {
      setInviteBusy(false)
    }
  }, [inviteEmail, loadNotifications, selectedGroupId])

  const openProfilePeek = useCallback(async (userId: string) => {
    if (!userId) return
    setProfilePeek(null)
    setProfilePeekError(null)
    try {
      const res = await fetch(`/api/profile/view/${encodeURIComponent(userId)}`, { credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setProfilePeekError(data?.message || `Unable to view profile (${res.status})`)
        return
      }
      setProfilePeek(data)
    } catch (err: any) {
      setProfilePeekError(err?.message || 'Unable to view profile')
    }
  }, [])

  const saveStatusBio = useCallback(async (nextRaw: string) => {
    const next = (nextRaw || '').trim().slice(0, 100)
    setStatusBioSaving(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statusBio: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data?.message || (Array.isArray(data?.errors) ? data.errors.join(' • ') : `Failed to save status (${res.status})`))
        return false
      }
      const saved = typeof data?.statusBio === 'string' ? data.statusBio.trim() : next
      setProfileStatusBio(saved || null)
      setStatusBioDraft(saved || '')
      return true
    } catch (err: any) {
      alert(err?.message || 'Failed to save status')
      return false
    } finally {
      setStatusBioSaving(false)
    }
  }, [])

  const uploadAvatar = useCallback(async (file: File) => {
    if (!file) return
    setAvatarUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/profile/avatar', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data?.message || `Failed to upload avatar (${res.status})`)
        return
      }
      const url = typeof data?.url === 'string' ? data.url.trim() : ''
      if (url) {
        setProfileAvatarUrl(url)
        try {
          await updateSession?.({ image: url } as any)
        } catch {
          // ignore
        }
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to upload avatar')
    } finally {
      setAvatarUploading(false)
    }
  }, [updateSession])

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

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(timelineReadStorageKey)
      const parsed = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed)) setReadTimelinePostIds(parsed.map(String))
    } catch {
      setReadTimelinePostIds([])
    }
  }, [timelineReadStorageKey])

  const readTimelinePostSet = useMemo(() => new Set(readTimelinePostIds), [readTimelinePostIds])
  const unreadTimelineCount = useMemo(() => {
    if (!timelineChallenges || timelineChallenges.length === 0) return 0
    let count = 0
    for (const c of timelineChallenges) {
      if (c?.id && !readTimelinePostSet.has(String(c.id))) count += 1
    }
    return count
  }, [timelineChallenges, readTimelinePostSet])

  const markTimelinePostsRead = useCallback((ids: string[]) => {
    if (typeof window === 'undefined') return
    if (!ids.length) return
    setReadTimelinePostIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) next.add(String(id))
      const nextArr = Array.from(next)
      try {
        window.localStorage.setItem(timelineReadStorageKey, JSON.stringify(nextArr))
      } catch {}
      return nextArr
    })
  }, [timelineReadStorageKey])

  const unreadNotificationsCount = useMemo(() => {
    const actionUnread = (actionInvites?.length || 0) + (actionJoinRequests?.length || 0)
    const activityUnread = Array.isArray(activityFeed) ? activityFeed.filter((n) => !n?.readAt).length : 0
    return actionUnread + activityUnread
  }, [actionInvites, actionJoinRequests, activityFeed])

  const openNotificationsOverlay = useCallback(() => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('pa:open-notifications'))
  }, [])

  const mobileHeroBgStorageKey = useMemo(() => {
    const userKey = session?.user?.email || (session as any)?.user?.id || session?.user?.name || 'anon'
    return `pa:mobileHeroCover:${userKey}`
  }, [session])

  const mobileThemeBgStorageKey = useMemo(() => {
    const userKey = session?.user?.email || (session as any)?.user?.id || session?.user?.name || 'anon'
    return `pa:mobileThemeBg:${userKey}`
  }, [session])

  const roleLabel = useCallback((raw: unknown) => {
    const v = String(raw || '').trim().toLowerCase()
    if (!v) return ''
    if (v === 'student') return 'Learner'
    if (v === 'admin') return 'Admin'
    if (v === 'teacher') return 'Teacher'
    return v.slice(0, 1).toUpperCase() + v.slice(1)
  }, [])

  useEffect(() => {
    if (status !== 'authenticated') return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/profile', { credentials: 'same-origin' })
        const data = await res.json().catch(() => ({}))
        const nextCover = typeof (data as any)?.profileCoverUrl === 'string' ? String((data as any).profileCoverUrl).trim() : ''
        const nextTheme = typeof (data as any)?.profileThemeBgUrl === 'string' ? String((data as any).profileThemeBgUrl).trim() : ''
        let hasCover = false
        let hasTheme = false
        if (!cancelled && nextCover) {
          setMobileHeroBgUrl(nextCover)
          hasCover = true
        } else if (!cancelled && nextTheme) {
          setMobileHeroBgUrl(nextTheme)
        }
        if (!cancelled && nextTheme) {
          setMobileThemeBgUrl(nextTheme)
          hasTheme = true
        }
        if (hasCover && hasTheme) return
      } catch {
        // ignore
      }

      // Backwards-compat fallback: previously this was stored in localStorage as a data URL.
      if (typeof window === 'undefined') return
      try {
        const rawCover = window.localStorage.getItem(mobileHeroBgStorageKey)
        if (!cancelled && rawCover && typeof rawCover === 'string') {
          setMobileHeroBgUrl(rawCover)
        }
        const rawTheme = window.localStorage.getItem(mobileThemeBgStorageKey)
        if (!cancelled && rawTheme && typeof rawTheme === 'string') {
          setMobileThemeBgUrl(rawTheme)
        }

        const legacyKey = mobileHeroBgStorageKey.replace('pa:mobileHeroCover:', 'pa:mobileHeroBg:')
        const legacyRaw = window.localStorage.getItem(legacyKey)
        if (!cancelled && legacyRaw && typeof legacyRaw === 'string') {
          setMobileThemeBgUrl(legacyRaw)
          if (!rawCover) setMobileHeroBgUrl(legacyRaw)
        }
      } catch {}
    })()

    return () => {
      cancelled = true
    }
  }, [mobileHeroBgStorageKey, mobileThemeBgStorageKey, status])

  const applyMobileHeroBackgroundFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please choose an image file.')
      return
    }

    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/profile/cover', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data?.message || `Failed to upload background (${res.status})`)
        return
      }
      const url = typeof data?.url === 'string' ? data.url.trim() : ''
      if (!url) {
        alert('Upload succeeded but returned no URL')
        return
      }
      setMobileHeroBgUrl(url)
    } catch (err: any) {
      alert(err?.message || 'Failed to upload background')
    }
  }, [])

  const applyMobileThemeBackgroundFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please choose an image file.')
      return
    }

    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/profile/theme-bg', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data?.message || `Failed to upload theme (${res.status})`)
        return
      }
      const url = typeof data?.url === 'string' ? data.url.trim() : ''
      if (!url) {
        alert('Upload succeeded but returned no URL')
        return
      }
      setMobileThemeBgUrl(url)
    } catch (err: any) {
      alert(err?.message || 'Failed to upload theme')
    }
  }, [])

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

  const [liveParticipantsVersion, setLiveParticipantsVersion] = useState(0)
  const bumpLiveParticipantsVersion = useCallback(() => {
    setLiveParticipantsVersion(v => v + 1)
  }, [])

  useEffect(() => {
    if (!liveOverlayOpen) return
    if (isOwnerUser) return
    setLiveTeacherAudioEnabled(true)
  }, [isOwnerUser, liveOverlayOpen])

  const handleToggleLiveTeacherAudio = useCallback(() => {
    if (isOwnerUser) return
    setLiveTeacherAudioEnabled(prev => !prev)
  }, [isOwnerUser])

  const applyLiveTeacherAudioVolume = useCallback(async (enabled: boolean) => {
    if (isOwnerUser) return
    const controls: any = liveControls as any
    if (!controls || typeof controls.getRoomsInfo !== 'function' || typeof controls.setParticipantVolume !== 'function') return
    try {
      const info = await controls.getRoomsInfo()
      const rooms = Array.isArray(info?.rooms) ? info.rooms : []
      const mainRoom = rooms.find((r: any) => r?.isMainRoom) || rooms[0]
      const participants = Array.isArray(mainRoom?.participants) ? mainRoom.participants : []
      const moderatorIds = participants
        .filter((p: any) => p?.role === 'moderator' && typeof p?.id === 'string')
        .map((p: any) => p.id as string)

      const volume = enabled ? 1 : 0
      moderatorIds.forEach((id: string) => {
        try {
          controls.setParticipantVolume(id, volume)
        } catch {}
      })
    } catch {
      // ignore; volume control is best-effort
    }
  }, [isOwnerUser, liveControls])

  useEffect(() => {
    void applyLiveTeacherAudioVolume(liveTeacherAudioEnabled)
  }, [applyLiveTeacherAudioVolume, liveTeacherAudioEnabled, liveParticipantsVersion])

  const handleToggleLiveStudentMic = useCallback(() => {
    if (!isOwnerUser) {
      setLiveTeacherAudioEnabled(true)
    }
    if (!liveControls) {
      pendingLiveMicToggleRef.current = true
      return
    }
    try {
      liveControls.toggleAudio()
    } catch {}
  }, [isOwnerUser, liveControls])

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
    setLiveWindows(prev => {
      const next = prev.filter(win => win.id !== id)
      if (id === 'canvas-live-window' && closeLiveOverlayOnCanvasClose && next.length === 0) {
        setLiveOverlayOpen(false)
        setLiveOverlayDismissed(true)
        setCloseLiveOverlayOnCanvasClose(false)
      }
      return next
    })
  }, [closeLiveOverlayOnCanvasClose])

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
    if (!panel) return
    const normalized = panel.toLowerCase()
    if (normalized === 'announcements') {
      openMobileAnnouncements()
      return
    }
    if (normalized === 'sessions') {
      setMobilePanels(prev => ({ ...prev, sessions: true }))
      return
    }

    // Support deep-links like /dashboard?panel=discover on mobile for all roles.
    // Admins also use the full section navigation (including Users/Billing).
    if (normalized === 'overview') {
      setActiveSection('overview')
      setDashboardSectionOverlay(null)
      return
    }

    if (normalized === 'discover' || normalized === 'groups') {
      openDashboardOverlay(normalized as OverlaySectionId)
      return
    }

    if (isAdmin) {
      const allowed: SectionId[] = ['live', 'announcements', 'sessions', 'groups', 'discover', 'users', 'billing']
      const next = allowed.find(x => x === normalized)
      if (next) openDashboardOverlay(next as OverlaySectionId)
    }
  }, [isMobile, isAdmin, activeSection, openDashboardOverlay, openMobileAnnouncements, router.isReady, router.query.panel])

  useEffect(() => {
    if (!router.isReady) return
    const groupId = typeof router.query.groupId === 'string' ? router.query.groupId : ''
    if (!groupId) return

    if (selectedGroupId !== groupId) {
      void loadGroupMembers(groupId)
    }

    const nextQuery: Record<string, any> = { ...router.query }
    delete nextQuery.groupId
    void router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true })
  }, [router.isReady, router.query, router.pathname, selectedGroupId, loadGroupMembers])


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

  const showCanvasWindow = useCallback((sessionId?: string | null, opts?: { quizMode?: boolean }) => {
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

    // If the live overlay is not already open, this canvas open should behave like a standard overlay.
    // Closing the canvas should fall back to the layer beneath (dashboard overlay), not leave the live overlay shell open.
    setCloseLiveOverlayOnCanvasClose(!liveOverlayOpen)

    setLiveOverlayDismissed(false)
    setLiveOverlayOpen(true)
    // Chrome should start hidden; it is revealed by tapping the top display.
    setLiveOverlayChromeVisible(false)
    const windowId = 'canvas-live-window'
    const quizMode = Boolean(opts?.quizMode)
    setLiveWindows(prev => {
      const stageWidth = overlayBounds.width || (typeof window !== 'undefined' ? window.innerWidth : 1024)
      const stageHeight = overlayBounds.height || (typeof window !== 'undefined' ? window.innerHeight : 768)
      const windowedWidth = Math.max(Math.round(stageWidth * 0.65), 420)
      const windowedHeight = Math.max(Math.round(stageHeight * 0.6), 320)
      const windowedPosition = {
        x: Math.max((stageWidth - windowedWidth) / 2, WINDOW_PADDING_X),
        y: Math.max((stageHeight - windowedHeight) / 2, WINDOW_PADDING_Y)
      }

      const existing = prev.find(win => win.id === windowId)
      if (existing) {
        return prev.map(win => {
          if (win.id !== windowId) return win
          // Always reopen the canvas in the standard fullscreen mode for consistency,
          // regardless of where it was opened from (or whether it was previously resized/windowed).
          return {
            ...win,
            minimized: false,
            mode: 'fullscreen',
            position: { x: 0, y: 0 },
            size: { width: stageWidth, height: stageHeight },
            z: getNextWindowZ(),
            quizMode,
            windowedSnapshot: win.windowedSnapshot ?? { position: windowedPosition, size: { width: windowedWidth, height: windowedHeight } }
          }
        })
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
        quizMode,
        windowedSnapshot: { position: windowedPosition, size: { width: windowedWidth, height: windowedHeight } }
      }
      return [...prev, baseWindow]
    })
  }, [canLaunchCanvasOverlay, isSubscriptionBlocked, activeSessionId, liveOverlayOpen, overlayBounds.height, overlayBounds.width, gradeReady, activeGradeLabel, clampWindowPosition, getNextWindowZ])

  const showLessonAuthoringCanvasWindow = useCallback((opts: { phaseKey: LessonPhaseKey; pointId: string }) => {
    if (!isTeacherOrAdminUser) {
      alert('You do not have permission to author lesson modules.')
      return
    }

    setLiveOverlayDismissed(false)
    setLiveOverlayOpen(true)

    const boardId = buildLessonAuthoringBoardId('canvas', opts.phaseKey, opts.pointId)
    const roomId = boardIdToSessionKey(boardId)
    const windowId = 'canvas-lesson-authoring-window'

    setLiveWindows(prev => {
      const existing = prev.find(win => win.id === windowId)
      if (existing) {
        return prev.map(win => {
          if (win.id !== windowId) return win
          return {
            ...win,
            minimized: false,
            z: getNextWindowZ(),
            boardIdOverride: boardId,
            roomIdOverride: roomId,
            isAdminOverride: isTeacherOrAdminUser,
            lessonAuthoring: { phaseKey: opts.phaseKey, pointId: opts.pointId }
          }
        })
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
        boardIdOverride: boardId,
        roomIdOverride: roomId,
        isAdminOverride: isTeacherOrAdminUser,
        lessonAuthoring: { phaseKey: opts.phaseKey, pointId: opts.pointId },
        position: { x: 0, y: 0 },
        size: { width: stageWidth, height: stageHeight },
        minimized: false,
        z: getNextWindowZ(),
        mode: 'fullscreen',
        windowedSnapshot: { position: windowedPosition, size: { width: windowedWidth, height: windowedHeight } }
      }

      return [...prev, baseWindow]
    })
  }, [activeGradeLabel, boardIdToSessionKey, buildLessonAuthoringBoardId, getNextWindowZ, gradeReady, isTeacherOrAdminUser, overlayBounds.height, overlayBounds.width])

  const pickCurrentOrNextSessionId = useCallback(() => {
    const activeId = activeSessionId ? String(activeSessionId) : null
    if (activeId && sessionById.has(activeId)) return activeId

    const nowMs = Date.now()
    const upcoming = [...(sessions || [])]
      .filter(s => s?.id && s?.startsAt && new Date(s.startsAt).getTime() >= nowMs)
      .sort((a, b) => new Date(a?.startsAt).getTime() - new Date(b?.startsAt).getTime())

    if (upcoming.length > 0) return String(upcoming[0].id)
    return null
  }, [activeSessionId, sessionById, sessions])

  const openLiveForSession = useCallback((sessionId: string) => {
    if (isSubscriptionBlocked) {
      alert('A subscription is required to join sessions.')
      return
    }
    setActiveSessionId(sessionId)
    setCloseLiveOverlayOnCanvasClose(false)
    setLiveOverlayDismissed(false)
    setLiveOverlayOpen(true)
    // Chrome should start hidden; it is revealed by tapping the top display.
    setLiveOverlayChromeVisible(false)
  }, [isSubscriptionBlocked])

  const openHeroLive = useCallback(() => {
    const sessionId = pickCurrentOrNextSessionId()
    if (!sessionId) {
      alert('No live class right now.')
      return
    }
    openLiveForSession(sessionId)
  }, [openLiveForSession, pickCurrentOrNextSessionId])

  const openHeroCanvas = useCallback(() => {
    const sessionId = pickCurrentOrNextSessionId()
    if (!sessionId) {
      alert('No session right now.')
      return
    }
    showCanvasWindow(sessionId)
  }, [pickCurrentOrNextSessionId, showCanvasWindow])

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
    setCloseLiveOverlayOnCanvasClose(false)
    setLiveOverlayDismissed(false)
    setLiveOverlayOpen(true)
    // Keep chrome hidden by default.
    setLiveOverlayChromeVisible(false)
  }
  const closeLiveOverlay = () => {
    setLiveOverlayOpen(false)
    setLiveOverlayDismissed(true)
    setCloseLiveOverlayOnCanvasClose(false)
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
  const currentUserId = (session as any)?.user?.id as string | undefined
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

  const sessionRole = (((session as any)?.user?.role as string | undefined) || 'student')
  const canManageSessionThumbnails = sessionRole === 'admin' || sessionRole === 'teacher'

  const studentMobileTabIndex = (tab: 'timeline' | 'sessions' | 'groups' | 'discover') => {
    if (tab === 'timeline') return 0
    if (tab === 'sessions') return 1
    if (tab === 'groups') return 2
    return 3
  }

  const scrollStudentPanelsToTab = useCallback((tab: 'timeline' | 'sessions' | 'groups' | 'discover') => {
    const el = studentMobilePanelsRef.current
    if (!el) return
    const panel = studentMobilePanelRefs.current[tab]
    if (panel) {
      const elRect = el.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      const targetLeft = el.scrollLeft + (panelRect.left - elRect.left)
      if (typeof el.scrollTo === 'function') {
        el.scrollTo({ left: targetLeft, behavior: 'smooth' })
      } else {
        el.scrollLeft = targetLeft
      }
      return
    }
    const width = el.clientWidth || 0
    if (!width) {
      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(() => scrollStudentPanelsToTab(tab))
      }
      return
    }
    const idx = studentMobileTabIndex(tab)
    const left = idx * width
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ left, behavior: 'smooth' })
    } else {
      el.scrollLeft = left
    }
  }, [studentMobileTabIndex])

  const openStudentQuickOverlay = useCallback((tab: 'timeline' | 'sessions' | 'groups' | 'discover' | 'admin') => {
    setStudentQuickOverlay(tab)
    if (tab === 'timeline') setTimelineOpen(true)
  }, [])

  const closeStudentQuickOverlay = useCallback(() => {
    setStudentQuickOverlay(null)
  }, [])

  const isPdfResource = useCallback((item: ResourceBankItem) => {
    const filename = (item.filename || '').toLowerCase()
    const url = (item.url || '').toLowerCase()
    const contentType = (item.contentType || '').toLowerCase()
    return contentType.includes('application/pdf') || filename.endsWith('.pdf') || url.includes('.pdf')
  }, [])

  const fetchBooksForGrade = useCallback(async () => {
    if (status !== 'authenticated') {
      setBooksItems([])
      setBooksError('Sign in to view materials.')
      return
    }
    if (!selectedGrade) {
      setBooksItems([])
      setBooksError('Select a grade to view materials.')
      return
    }

    const cacheKey = makeOfflineCacheKey(`resources:${selectedGrade}`)
    const cached = readLocalCache<ResourceBankItem[]>(cacheKey)
    if (cached?.data?.length) {
      setBooksItems(cached.data)
    }

    setBooksLoading(true)
    setBooksError(null)
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (cached?.data?.length) {
        setBooksError('Offline. Showing last saved materials.')
      } else {
        setBooksItems([])
        setBooksError('Offline. No saved materials yet.')
      }
      setBooksLoading(false)
      return
    }
    try {
      const url = isAdmin
        ? `/api/resources?grade=${encodeURIComponent(selectedGrade)}`
        : '/api/resources'
      const res = await fetch(url, { credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to load materials (${res.status})`)
      const items = Array.isArray(data?.items) ? data.items : []
      setBooksItems(items)
      writeLocalCache(cacheKey, items)
    } catch (err: any) {
      setBooksError(err?.message || 'Failed to load materials')
      if (!cached?.data?.length) setBooksItems([])
    } finally {
      setBooksLoading(false)
    }
  }, [isAdmin, makeOfflineCacheKey, selectedGrade, status])

  const openBooksOverlay = useCallback(() => {
    setBooksOverlayOpen(true)
    void fetchBooksForGrade()
  }, [fetchBooksForGrade])

  useEffect(() => {
    if (!booksOverlayOpen) return
    const cached = readLocalCache<string[]>(offlineDocsKey)
    setOfflineDocUrls(Array.isArray(cached?.data) ? cached.data : [])
  }, [booksOverlayOpen, offlineDocsKey])

  const setOfflineDocs = useCallback((next: string[]) => {
    setOfflineDocUrls(next)
    writeLocalCache(offlineDocsKey, next)
  }, [offlineDocsKey])

  const isDocSavedOffline = useCallback((url: string) => {
    return offlineDocUrls.includes(url)
  }, [offlineDocUrls])

  const saveDocOffline = useCallback(async (item: ResourceBankItem) => {
    const url = item.url
    if (!url) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setOfflineDocErrorByUrl(prev => ({ ...prev, [url]: 'Connect to the internet to save offline.' }))
      return
    }
    if (offlineDocSavingUrls.includes(url)) return
    setOfflineDocSavingUrls(prev => [...prev, url])
    setOfflineDocErrorByUrl(prev => ({ ...prev, [url]: '' }))
    try {
      if (!('caches' in window)) throw new Error('Offline storage unavailable.')
      const cache = await caches.open('pa-docs-v1')
      const isSameOrigin = (() => {
        try {
          const resolved = new URL(url, window.location.origin)
          return resolved.origin === window.location.origin
        } catch {
          return false
        }
      })()
      const response = await fetch(url, isSameOrigin ? undefined : { mode: 'no-cors' })
      if (!response) throw new Error('Unable to download file.')
      if (response.type === 'opaque') {
        throw new Error('This file cannot be saved offline (server blocks access).')
      }
      await cache.put(url, response.clone())
      if (!offlineDocUrls.includes(url)) {
        setOfflineDocs([...offlineDocUrls, url])
      }
    } catch (err: any) {
      setOfflineDocErrorByUrl(prev => ({ ...prev, [url]: err?.message || 'Failed to save offline.' }))
    } finally {
      setOfflineDocSavingUrls(prev => prev.filter(u => u !== url))
    }
  }, [offlineDocSavingUrls, offlineDocUrls, setOfflineDocs])

  const removeDocOffline = useCallback(async (item: ResourceBankItem) => {
    const url = item.url
    if (!url) return
    try {
      if ('caches' in window) {
        const cache = await caches.open('pa-docs-v1')
        await cache.delete(url)
      }
    } catch {
      // ignore
    }
    if (offlineDocUrls.includes(url)) {
      setOfflineDocs(offlineDocUrls.filter(u => u !== url))
    }
  }, [offlineDocUrls, setOfflineDocs])

  const openPdfViewer = useCallback((item: ResourceBankItem) => {
    setPdfViewerTitle(item.title || 'Document')
    // Avoid showing filepaths/URLs in the UI.
    setPdfViewerSubtitle('')
    const openWithUrl = (url: string) => {
      setPdfViewerUrl(url)
      setPdfViewerInitialState(null)
      setPdfViewerOpen(true)
    }

    const tryOffline = async () => {
      if (!item.url) return false
      if (typeof navigator !== 'undefined' && navigator.onLine) return false
      if (!isDocSavedOffline(item.url)) return false
      if (!('caches' in window)) return false
      try {
        const cache = await caches.open('pa-docs-v1')
        const match = await cache.match(item.url)
        if (!match) return false
        if (match.type === 'opaque') return false
        const blob = await match.blob()
        const objectUrl = URL.createObjectURL(blob)
        setPdfViewerOfflineObjectUrl(objectUrl)
        openWithUrl(objectUrl)
        return true
      } catch {
        return false
      }
    }

    void (async () => {
      const openedOffline = await tryOffline()
      if (!openedOffline && item.url) {
        openWithUrl(item.url)
      }
    })()
  }, [isDocSavedOffline])

  const handlePdfPostCapture = useCallback((file: File, snapshot?: PdfViewerSnapshot) => {
    queueRestore(() => {
      setPdfViewerTitle(pdfViewerTitle)
      setPdfViewerSubtitle(pdfViewerSubtitle)
      setPdfViewerUrl(pdfViewerUrl)
      setPdfViewerInitialState({
        page: snapshot?.page ?? 1,
        zoom: snapshot?.zoom ?? 110,
        scrollTop: snapshot?.scrollTop ?? 0,
      })
      setPdfViewerOpen(true)
    })
    setPdfViewerOpen(false)
    setCreateKind('quiz')
    setEditingChallengeId(null)
    setChallengeAudiencePickerOpen(false)
    setChallengeImageUrl(null)
    setChallengeImageSourceFile(null)
    setChallengeParsedJsonText(null)
    setChallengeParsedOpen(false)
    setCreateOverlayOpen(true)
    setChallengeImageEditFile(file)
    setChallengeImageEditOpen(true)
  }, [pdfViewerSubtitle, pdfViewerTitle, pdfViewerUrl, queueRestore])

  useEffect(() => {
    return () => {
      if (pdfViewerOfflineObjectUrl) {
        URL.revokeObjectURL(pdfViewerOfflineObjectUrl)
      }
    }
  }, [pdfViewerOfflineObjectUrl])

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Keep scroll position aligned to the active tab.
    scrollStudentPanelsToTab(studentMobileTab)
  }, [studentMobileTab, scrollStudentPanelsToTab])

  const onStudentPanelsScroll = useCallback(() => {
    const el = studentMobilePanelsRef.current
    if (!el) return
    if (typeof window === 'undefined') return
    if (studentMobileScrollRafRef.current) return

    const tabForIndex = (idx: number) =>
      (idx <= 0 ? 'timeline' : idx === 1 ? 'sessions' : idx === 2 ? 'groups' : 'discover') as
        | 'timeline'
        | 'sessions'
        | 'groups'
        | 'discover'

    studentMobileScrollRafRef.current = window.requestAnimationFrame(() => {
      studentMobileScrollRafRef.current = null
      const width = el.clientWidth || 0
      if (!width) return
      const thresholdPx = width / 3
      const rawIdx = Math.floor((el.scrollLeft + thresholdPx) / width)
      const nextTab = tabForIndex(rawIdx)
      setStudentMobileTab(prev => {
        const prevIdx = studentMobileTabIndex(prev)
        const nextIdx = studentMobileTabIndex(nextTab)
        if (nextIdx > prevIdx + 1) return tabForIndex(prevIdx + 1)
        if (nextIdx < prevIdx - 1) return tabForIndex(prevIdx - 1)
        return prev === nextTab ? prev : nextTab
      })
    })

    if (studentMobileScrollEndTimeoutRef.current) {
      window.clearTimeout(studentMobileScrollEndTimeoutRef.current)
    }
    studentMobileScrollEndTimeoutRef.current = window.setTimeout(() => {
      studentMobileScrollEndTimeoutRef.current = null
      const width = el.clientWidth || 0
      if (!width) return
      const thresholdPx = width / 3
      const rawIdx = Math.floor((el.scrollLeft + thresholdPx) / width)
      const currentIdx = studentMobileTabIndex(studentMobileTab)
      const cappedIdx = rawIdx > currentIdx + 1 ? currentIdx + 1 : rawIdx < currentIdx - 1 ? currentIdx - 1 : rawIdx
      const tab = tabForIndex(cappedIdx)
      scrollStudentPanelsToTab(tab)
    }, 60)
  }, [scrollStudentPanelsToTab, studentMobileTab, studentMobileTabIndex])

  useEffect(() => {
    if (status !== 'authenticated') return
    if (sessionRole !== 'student' && sessionRole !== 'admin' && sessionRole !== 'teacher') return

    let cancelled = false
    setStudentFeedLoading(true)
    setStudentFeedError(null)
    void (async () => {
      try {
        const res = await fetch('/api/challenges/feed', { credentials: 'same-origin' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (!cancelled) {
            setStudentFeedError(data?.message || `Unable to load posts (${res.status})`)
            setStudentFeedPosts([])
          }
          return
        }
        const posts = Array.isArray(data?.posts) ? data.posts : []
        if (!cancelled) setStudentFeedPosts(posts)
      } catch (err: any) {
        if (!cancelled) {
          setStudentFeedError(err?.message || 'Unable to load posts')
          setStudentFeedPosts([])
        }
      } finally {
        if (!cancelled) setStudentFeedLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [status, sessionRole])

  const uploadSessionThumbnail = useCallback(async (file: File) => {
    if (!file) return null
    setSessionThumbnailUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/sessions/upload-thumbnail', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data?.message || `Failed to upload thumbnail (${res.status})`)
        return null
      }
      const url = typeof data?.url === 'string' ? data.url.trim() : ''
      return url || null
    } catch (err: any) {
      alert(err?.message || 'Failed to upload thumbnail')
      return null
    } finally {
      setSessionThumbnailUploading(false)
    }
  }, [])

  const updateSessionThumbnail = useCallback(async (sessionId: string, nextUrl: string | null) => {
    if (!sessionId) return
    setUpdatingSessionThumbnailBusy(true)
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/thumbnail`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thumbnailUrl: nextUrl || '' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data?.message || `Failed to update thumbnail (${res.status})`)
        return
      }

      // Update local session cache so UI updates without refetch.
      setSessions(prev =>
        (prev || []).map((s: any) => (String(s?.id) === String(sessionId) ? { ...s, thumbnailUrl: data?.thumbnailUrl ?? null } : s))
      )
    } catch (err: any) {
      alert(err?.message || 'Failed to update thumbnail')
    } finally {
      setUpdatingSessionThumbnailBusy(false)
    }
  }, [])

  const fetchChallengeSubmissions = useCallback(async (challengeId: string) => {
    if (!challengeId) return
    setChallengeSubmissionsLoading(true)
    setChallengeSubmissionsError(null)
    try {
      const res = await fetch(`/api/challenges/${encodeURIComponent(challengeId)}`, { credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setChallengeSubmissionsError(data?.message || `Failed to load submissions (${res.status})`)
        setChallengeSubmissions([])
        return
      }

      const submissions = Array.isArray(data?.takers) ? data.takers : []
      setChallengeSubmissions(submissions)
      setSelectedChallengeData(data)
    } catch (err: any) {
      setChallengeSubmissionsError(err?.message || 'Failed to load submissions')
      setChallengeSubmissions([])
    } finally {
      setChallengeSubmissionsLoading(false)
    }
  }, [])

  const fetchSubmissionDetail = useCallback(async (challengeId: string, userId: string) => {
    if (!challengeId || !userId) return
    setSelectedSubmissionLoading(true)
    setSelectedSubmissionError(null)
    try {
      const res = await fetch(`/api/challenges/${encodeURIComponent(challengeId)}`, { credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSelectedSubmissionError(data?.message || `Failed to load submission (${res.status})`)
        setSelectedSubmissionDetail(null)
        return
      }

      const responses = Array.isArray(data?.attempts) ? data.attempts : []
      const userResponses = responses.filter((r: any) => String(r.userId) === String(userId))

      setSelectedSubmissionDetail({ userId, responses: userResponses })
    } catch (err: any) {
      setSelectedSubmissionError(err?.message || 'Failed to load submission')
      setSelectedSubmissionDetail(null)
    } finally {
      setSelectedSubmissionLoading(false)
    }
  }, [])

  const openChallengeSubmissionForGrading = useCallback((challengeId: string, userId: string, responseId?: string) => {
    const safeChallengeId = String(challengeId || '')
    const safeUserId = String(userId || '')
    if (!safeChallengeId || !safeUserId) return
    setSelectedChallengeId(safeChallengeId)
    setSelectedSubmissionUserId(safeUserId)
    if (responseId) setChallengeGradingResponseId(String(responseId))
    setChallengeGradingOverlayOpen(true)
    fetchSubmissionDetail(safeChallengeId, safeUserId)
  }, [fetchSubmissionDetail])

  const clearChallengeOverlayQuery = useCallback(() => {
    const nextQuery: Record<string, any> = { ...router.query }
    const keys = ['manageChallenge', 'userId', 'responseId', 'viewUserChallenge', 'viewChallengeResponse']
    let changed = false
    keys.forEach((k) => {
      if (k in nextQuery) {
        delete nextQuery[k]
        changed = true
      }
    })
    if (changed) {
      void router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true })
    }
  }, [router])

  const openEditSelectedChallenge = useCallback(() => {
    const id = selectedChallengeId ? String(selectedChallengeId) : ''
    if (!id) return

    const c = selectedChallengeData
    if (!c || String(c?.id || '') !== id) {
      alert('Please wait for the quiz details to load, then try again.')
      return
    }

    const audienceRaw = typeof c?.audience === 'string' ? c.audience : 'public'
    const audience = (audienceRaw === 'public' || audienceRaw === 'grade' || audienceRaw === 'private') ? audienceRaw : 'public'

    setCreateKind('quiz')
    setEditingChallengeId(id)
    setChallengeTitleDraft(String(c?.title || ''))
    setChallengePromptDraft(String(c?.prompt || ''))
    setChallengeAudienceDraft(audience)
    setChallengeMaxAttempts(typeof c?.maxAttempts === 'number' ? String(c.maxAttempts) : 'unlimited')
    setChallengeImageUrl(typeof c?.imageUrl === 'string' ? c.imageUrl : null)
    setChallengeParsedJsonText(null)
    setChallengeParsedOpen(false)

    setChallengeGradingOverlayOpen(false)
    setSelectedSubmissionUserId(null)
    setSelectedSubmissionDetail(null)
    setCreateOverlayOpen(true)
  }, [selectedChallengeData, selectedChallengeId])

  const deleteChallenge = useCallback(async (challengeId: string) => {
    const id = challengeId ? String(challengeId) : ''
    if (!id) return

    const ok = typeof window !== 'undefined'
      ? window.confirm('Delete this quiz post? This will remove it from your timeline and delete all submissions.')
      : false
    if (!ok) return

    setChallengeDeleting(true)
    try {
      const res = await fetch(`/api/challenges/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data?.message || `Failed to delete (${res.status})`)
        return
      }

      setTimelineChallenges(prev => (Array.isArray(prev) ? prev.filter((c: any) => String(c?.id || '') !== id) : prev))
      setStudentFeedPosts(prev => (Array.isArray(prev) ? prev.filter((c: any) => String(c?.id || '') !== id) : prev))

      setChallengeGradingOverlayOpen(false)
      setSelectedChallengeId(null)
      setSelectedChallengeData(null)
      setSelectedSubmissionUserId(null)
      setSelectedSubmissionDetail(null)

      alert('Deleted')
    } catch (err: any) {
      alert(err?.message || 'Failed to delete')
    } finally {
      setChallengeDeleting(false)
    }
  }, [])

  const activeChallengeGradingResponse = useMemo(() => {
    if (!challengeGradingResponseId) return null
    const responses = Array.isArray(selectedSubmissionDetail?.responses) ? selectedSubmissionDetail.responses : []
    return responses.find((r: any) => String(r?.id) === String(challengeGradingResponseId)) || null
  }, [challengeGradingResponseId, selectedSubmissionDetail])

  const openChallengeGrading = useCallback((resp: any) => {
    const grading: Record<number, string> = {}
    const stepFeedback: Record<number, string> = {}
    const stepMarks: Record<number, number> = {}
    if (Array.isArray(resp?.gradingJson)) {
      resp.gradingJson.forEach((g: any) => {
        const step = typeof g?.step === 'number' ? g.step : null
        const grade = typeof g?.grade === 'string' ? g.grade : null
        if (step !== null && grade) grading[step] = grade
      })
    } else if (Array.isArray(resp?.gradingJson?.steps)) {
      resp.gradingJson.steps.forEach((g: any, idx: number) => {
        const stepNum = Number(g?.step)
        const step = Number.isFinite(stepNum) && stepNum > 0 ? Math.trunc(stepNum) - 1 : idx
        const awardedMarks = Number(g?.awardedMarks ?? 0)
        const isCorrect = (typeof g?.isCorrect === 'boolean') ? Boolean(g.isCorrect) : (awardedMarks > 0)
        const isSignificant = (typeof g?.isSignificant === 'boolean') ? Boolean(g.isSignificant) : (!isCorrect)
        // Prefer explicit correctness/significance. Marks alone shouldn't force a tick.
        const grade = isCorrect
          ? (awardedMarks > 0 ? 'tick' : 'dot-green')
          : (isSignificant ? 'cross' : 'dot-red')
        grading[step] = grade
        if (Number.isFinite(awardedMarks)) stepMarks[step] = Math.max(0, Math.trunc(awardedMarks))
        const fb = String(g?.feedback ?? '').trim()
        if (fb) stepFeedback[step] = fb
      })
    }
    setChallengeGradingByStep(grading)
    setChallengeGradingStepFeedback(stepFeedback)
    setChallengeGradingStepMarks(stepMarks)
    setChallengeGradingFeedback(typeof resp?.feedback === 'string' ? resp.feedback : '')
    setChallengeGradingResponseId(resp?.id ? String(resp.id) : null)
  }, [])

  const closeChallengeGrading = useCallback(() => {
    setChallengeGradingResponseId(null)
    setChallengeGradingByStep({})
    setChallengeGradingFeedback('')
    setChallengeGradingStepFeedback({})
    setChallengeGradingStepMarks({})
    setChallengeGradingSaving(false)
  }, [])

  const saveChallengeGrading = useCallback(async () => {
    if (!selectedChallengeId || !challengeGradingResponseId) return
    setChallengeGradingSaving(true)
    try {
      const activeResp = activeChallengeGradingResponse
      const steps = splitLatexIntoSteps(activeResp?.latex || '')
      const stepCount = Math.max(1, steps.length || 0)
      const gradingSteps = Array.from({ length: stepCount }, (_, idx) => {
        const grade = challengeGradingByStep[idx] || null
        const fb = String(challengeGradingStepFeedback[idx] || '').trim()
        const rawMarks = Number(challengeGradingStepMarks[idx])
        const awardedMarks = Number.isFinite(rawMarks)
          ? Math.max(0, Math.trunc(rawMarks))
          : (grade === 'tick' ? 1 : 0)
        const isCorrect = grade === 'tick' || grade === 'dot-green'
        const isSignificant = grade === 'cross'
          ? true
          : grade === 'dot-red'
            ? false
            : !isCorrect
        return {
          step: idx + 1,
          awardedMarks,
          isCorrect,
          isSignificant,
          feedback: fb || undefined,
        }
      })
      const earnedMarks = gradingSteps.reduce((sum, s) => sum + Math.max(0, Number(s.awardedMarks || 0)), 0)
      const totalMarks = Math.max(1, stepCount)
      const gradingJson = { totalMarks, earnedMarks, steps: gradingSteps }

      const res = await fetch(`/api/sessions/challenge:${encodeURIComponent(selectedChallengeId)}/responses`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          responseId: challengeGradingResponseId,
          gradingJson,
          feedback: challengeGradingFeedback,
        }),
      })

      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(payload?.message || `Failed to save grading (${res.status})`)
      }

      // Update local UI immediately (avoids stale ticks/marks if the refetch is slow).
      setSelectedSubmissionDetail((prev: any) => {
        if (!prev || !Array.isArray(prev?.responses)) return prev
        const nextResponses = prev.responses.map((r: any) =>
          String(r?.id) === String(challengeGradingResponseId)
            ? {
              ...r,
              gradingJson: payload?.gradingJson ?? gradingJson,
              feedback: typeof payload?.feedback === 'string' ? payload.feedback : challengeGradingFeedback,
            }
            : r
        )
        return { ...prev, responses: nextResponses }
      })

      if (selectedSubmissionUserId) {
        await fetchSubmissionDetail(selectedChallengeId, selectedSubmissionUserId)
      }
      closeChallengeGrading()
    } catch (err: any) {
      alert(err?.message || 'Failed to save grading')
    } finally {
      setChallengeGradingSaving(false)
    }
  }, [activeChallengeGradingResponse, challengeGradingByStep, challengeGradingFeedback, challengeGradingResponseId, challengeGradingStepFeedback, selectedChallengeId, selectedSubmissionUserId, fetchSubmissionDetail, closeChallengeGrading, splitLatexIntoSteps])

  const fetchMyChallengeResponse = useCallback(async (challengeId: string) => {
    if (!challengeId) return
    setChallengeResponseLoading(true)
    setChallengeResponseError(null)
    try {
      const [challengeRes, responsesRes] = await Promise.all([
        fetch(`/api/challenges/${encodeURIComponent(challengeId)}`, { credentials: 'same-origin' }),
        fetch(`/api/sessions/${encodeURIComponent(`challenge:${challengeId}`)}/responses`, { credentials: 'same-origin' }),
      ])

      const challengeData = await challengeRes.json().catch(() => ({}))
      if (!challengeRes.ok) {
        setChallengeResponseError(challengeData?.message || `Failed to load quiz (${challengeRes.status})`)
        setChallengeResponseChallenge(null)
        setChallengeMyResponses([])
        return
      }

      const responsesData = await responsesRes.json().catch(() => ({}))
      if (!responsesRes.ok) {
        setChallengeResponseError(responsesData?.message || `Failed to load responses (${responsesRes.status})`)
        setChallengeResponseChallenge(challengeData)
        setChallengeMyResponses([])
        return
      }

      // The responses API is already scoped to the current user.
      const mine = Array.isArray(responsesData?.responses) ? responsesData.responses : []
      mine.sort((a: any, b: any) => {
        const aT = a?.createdAt ? new Date(a.createdAt).getTime() : 0
        const bT = b?.createdAt ? new Date(b.createdAt).getTime() : 0
        return bT - aT
      })

      setChallengeResponseChallenge(challengeData)
      setChallengeMyResponses(mine)
    } catch (err: any) {
      setChallengeResponseError(err?.message || 'Failed to load responses')
      setChallengeResponseChallenge(null)
      setChallengeMyResponses([])
    } finally {
      setChallengeResponseLoading(false)
    }
  }, [viewerId, currentUserId])

  const displayChallengeResponses = useMemo(() => {
    if (!Array.isArray(challengeMyResponses) || challengeMyResponses.length === 0) return []
    if (challengeMyResponses.length === 1) return challengeMyResponses

    const getTs = (resp: any) => {
      const updated = resp?.updatedAt ? new Date(resp.updatedAt).getTime() : 0
      const created = resp?.createdAt ? new Date(resp.createdAt).getTime() : 0
      return Math.max(updated || 0, created || 0)
    }

    const graded = challengeMyResponses.filter(r => r?.gradingJson || r?.feedback)
    if (graded.length > 0) {
      const latestGraded = graded.slice().sort((a, b) => getTs(b) - getTs(a))[0]
      return latestGraded ? [latestGraded] : [challengeMyResponses[0]]
    }

    const latest = challengeMyResponses.slice().sort((a, b) => getTs(b) - getTs(a))[0]
    return latest ? [latest] : [challengeMyResponses[0]]
  }, [challengeMyResponses])

  useEffect(() => {
    if (!challengeGradingOverlayOpen || !selectedChallengeId) return
    void fetchChallengeSubmissions(selectedChallengeId)
  }, [challengeGradingOverlayOpen, selectedChallengeId, fetchChallengeSubmissions])

  useEffect(() => {
    if (!challengeGradingOverlayOpen || !selectedChallengeId || !selectedSubmissionUserId) return
    void fetchSubmissionDetail(selectedChallengeId, selectedSubmissionUserId)
  }, [challengeGradingOverlayOpen, selectedChallengeId, selectedSubmissionUserId, fetchSubmissionDetail])

  useEffect(() => {
    if (suppressChallengeAutoOpenRef.current) {
      suppressChallengeAutoOpenRef.current = false
      return
    }
    const manageChallenge = typeof router.query.manageChallenge === 'string' ? router.query.manageChallenge : ''
    if (!manageChallenge) return
    const targetUserId = typeof router.query.userId === 'string' ? router.query.userId : ''
    const targetResponseId = typeof router.query.responseId === 'string' ? router.query.responseId : ''

    if (targetUserId) {
      openChallengeSubmissionForGrading(manageChallenge, targetUserId, targetResponseId || undefined)
    } else if (!(selectedChallengeId === manageChallenge && challengeGradingOverlayOpen)) {
      setSelectedChallengeId(manageChallenge)
      setChallengeGradingOverlayOpen(true)
    }

  }, [router, router.query, selectedChallengeId, challengeGradingOverlayOpen, openChallengeSubmissionForGrading])

  useEffect(() => {
    if (suppressChallengeAutoOpenRef.current) {
      suppressChallengeAutoOpenRef.current = false
      return
    }
    const viewUserChallenge = typeof router.query.viewUserChallenge === 'string' ? router.query.viewUserChallenge : ''
    const targetUserId = typeof router.query.userId === 'string' ? router.query.userId : ''
    const targetResponseId = typeof router.query.responseId === 'string' ? router.query.responseId : ''
    if (!viewUserChallenge || !targetUserId) return
    if (selectedChallengeId === viewUserChallenge && selectedSubmissionUserId === targetUserId && challengeGradingOverlayOpen) return

    openChallengeSubmissionForGrading(viewUserChallenge, targetUserId, targetResponseId || undefined)

  }, [router, router.query, selectedChallengeId, selectedSubmissionUserId, challengeGradingOverlayOpen, openChallengeSubmissionForGrading])

  useEffect(() => {
    const viewChallengeResponse = typeof router.query.viewChallengeResponse === 'string' ? router.query.viewChallengeResponse : ''
    if (!viewChallengeResponse) return
    if (selectedChallengeResponseId === viewChallengeResponse && challengeResponseOverlayOpen) return

    setSelectedChallengeResponseId(viewChallengeResponse)
    setChallengeResponseOverlayOpen(true)

    const nextQuery: Record<string, any> = { ...router.query }
    delete nextQuery.viewChallengeResponse
    void router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true })
  }, [router, router.query, selectedChallengeResponseId, challengeResponseOverlayOpen])

  useEffect(() => {
    if (!challengeResponseOverlayOpen || !selectedChallengeResponseId) return
    void fetchMyChallengeResponse(selectedChallengeResponseId)
  }, [challengeResponseOverlayOpen, selectedChallengeResponseId, fetchMyChallengeResponse])

  useEffect(() => {
    if (!timelineOpen) return
    if (timelineFetchedOnceRef.current) return

    timelineFetchedOnceRef.current = true
    setTimelineChallengesLoading(true)
    setTimelineChallengesError(null)
    void (async () => {
      try {
        // First, get the user ID from the profile API
        const profileRes = await fetch('/api/profile', { credentials: 'same-origin' })
        if (!profileRes.ok) {
          setTimelineChallengesError('Failed to load profile')
          setTimelineChallengesLoading(false)
          return
        }
        const profileData = await profileRes.json().catch(() => ({}))
        const userId = profileData?.id as string | undefined
        
        if (!userId) {
          setTimelineChallengesError('Timeline unavailable: missing user id')
          setTimelineChallengesLoading(false)
          return
        }

        setTimelineUserId(userId)
        setViewerId(userId)

        const res = await fetch(`/api/profile/view/${encodeURIComponent(userId)}/challenges`, { credentials: 'same-origin' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setTimelineChallengesError(data?.message || `Unable to load timeline (${res.status})`)
          setTimelineChallenges([])
          return
        }
        const items = Array.isArray(data?.challenges) ? data.challenges : []
        setTimelineChallenges(items)
      } catch (err: any) {
        setTimelineChallengesError(err?.message || 'Unable to load timeline')
        setTimelineChallenges([])
      } finally {
        setTimelineChallengesLoading(false)
      }
    })()
  }, [timelineOpen])

  useEffect(() => {
    if (!timelineOpen) return
    if (timelineChallengesLoading || timelineChallengesError) return
    if (!timelineChallenges || timelineChallenges.length === 0) return
    const ids = timelineChallenges.map((c: any) => String(c?.id || '')).filter(Boolean)
    markTimelinePostsRead(ids)
  }, [timelineOpen, timelineChallengesLoading, timelineChallengesError, timelineChallenges, markTimelinePostsRead])

  const renderTimelineItems = (items: any[]) => (
    <ul className="space-y-2">
      {items.map((c: any) => {
        const title = (c?.title || '').trim() || 'Quiz'
        const createdAt = c?.createdAt ? new Date(c.createdAt).toLocaleString() : ''
        const myAttemptCount = typeof c?.myAttemptCount === 'number' ? c.myAttemptCount : 0
        const maxAttempts = typeof c?.maxAttempts === 'number' ? c.maxAttempts : null
        const attemptsOpen = c?.attemptsOpen !== false

        const isOwner = viewerId && c?.createdById && String(c.createdById) === String(viewerId)
        const hasAttempted = myAttemptCount > 0
        const canAttempt = attemptsOpen && (maxAttempts === null || myAttemptCount < maxAttempts)
        const href = c?.id ? `/challenges/${encodeURIComponent(String(c.id))}` : '#'

        return (
          <li key={String(c?.id || title)} className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-white break-words">{title}</div>
                {createdAt ? <div className="text-xs text-white/60">{createdAt}</div> : null}
              </div>
              {c?.id ? (
                isOwner ? (
                  <button
                    type="button"
                    className="btn btn-primary shrink-0"
                    onClick={() => {
                      setSelectedChallengeId(String(c.id))
                      setChallengeGradingOverlayOpen(true)
                    }}
                  >
                    Manage
                  </button>
                ) : (
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {canAttempt ? (
                      <Link href={href} className="btn btn-primary shrink-0">
                        Attempt
                      </Link>
                    ) : hasAttempted ? (
                      <button
                        type="button"
                        className="btn btn-primary shrink-0"
                        onClick={() => {
                          setSelectedChallengeResponseId(String(c.id))
                          setChallengeResponseOverlayOpen(true)
                        }}
                      >
                        My response
                      </button>
                    ) : (
                      <button type="button" className="btn btn-ghost shrink-0" disabled>
                        Closed
                      </button>
                    )}

                    {hasAttempted && canAttempt ? (
                      <button
                        type="button"
                        className="btn btn-ghost text-xs shrink-0"
                        onClick={() => {
                          setSelectedChallengeResponseId(String(c.id))
                          setChallengeResponseOverlayOpen(true)
                        }}
                      >
                        My response
                      </button>
                    ) : null}
                  </div>
                )
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )

  const renderTimelineCard = () => (
    <section className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div />
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-primary text-xs"
            onClick={() => setCreateOverlayOpen(true)}
          >
            Create
          </button>
          <button
            type="button"
            className="btn btn-ghost text-xs relative"
            onClick={() => setTimelineOpen(true)}
          >
            My posts
            {unreadTimelineCount > 0 && (
              <span
                className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-[10px] leading-4 text-white text-center"
                aria-label={`${unreadTimelineCount} unread posts`}
              >
                {unreadTimelineCount > 99 ? '99+' : unreadTimelineCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="text-sm text-white/70">Your posted quizzes live on your timeline.</div>
    </section>
  )

  const renderAdminToolsQuickPanel = () => {
    if (!isAdmin) return null

    const adminSections = availableSections.filter(s => s.id !== 'overview')

    return (
      <section className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="font-semibold text-white">Admin tools</div>
          <button
            type="button"
            className="btn btn-ghost text-xs"
            onClick={closeStudentQuickOverlay}
          >
            Close
          </button>
        </div>

        {adminSections.length === 0 ? (
          <div className="text-sm text-white/70">No admin sections available.</div>
        ) : (
          <div className="grid gap-2">
            <button
              type="button"
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:border-white/20 focus:outline-none focus:ring-2 focus:ring-white/20"
              onClick={() => {
                closeStudentQuickOverlay()
                void router.push('/resource-bank')
              }}
            >
              <div className="text-sm font-semibold text-white">Resource Bank</div>
              <div className="text-xs text-white/60">Shared resources & uploads</div>
            </button>
            {adminSections.map(section => (
              <button
                key={section.id}
                type="button"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:border-white/20 focus:outline-none focus:ring-2 focus:ring-white/20"
                onClick={() => {
                  closeStudentQuickOverlay()
                  openDashboardOverlay(section.id as OverlaySectionId)
                }}
              >
                <div className="text-sm font-semibold text-white">{section.label}</div>
                <div className="text-xs text-white/60">{section.description}</div>
              </button>
            ))}
          </div>
        )}
      </section>
    )
  }

  const renderStudentQuickActionsRow = () => {
    const baseBtn = isAdmin
      ? 'inline-flex flex-col items-center justify-center gap-1 h-12 w-12 rounded-2xl border border-white/10 bg-white/5 text-white/90 active:scale-[0.98] transition focus:outline-none focus:ring-2 focus:ring-white/20'
      : 'inline-flex flex-col items-center justify-center gap-1 h-14 w-14 rounded-2xl border border-white/10 bg-white/5 text-white/90 active:scale-[0.98] transition focus:outline-none focus:ring-2 focus:ring-white/20'

    const activeBtn = 'bg-white/10 border-white/20 text-white'

    const btnClass = (tab: 'timeline' | 'sessions' | 'groups' | 'discover') =>
      `${baseBtn} ${studentMobileTab === tab ? activeBtn : ''}`

    const labelClass = (tab: 'timeline' | 'sessions' | 'groups' | 'discover') =>
      `text-[10px] leading-none transition-opacity ${studentMobileTab === tab ? 'opacity-80' : 'opacity-0'} text-white`

    const quickActionCount = isAdmin ? 7 : 6
    const buttonWidth = `calc(100% / ${quickActionCount})`

    return (
      <section
        className="mobile-row-width w-full overflow-x-auto snap-x snap-mandatory"
        style={{ WebkitOverflowScrolling: 'touch', overscrollBehaviorX: 'contain' }}
      >
        <div className="flex items-center justify-between w-max min-w-full">
        <button
          type="button"
          className={`${btnClass('timeline')} flex-none snap-start`}
          style={{ width: buttonWidth }}
          aria-label="Timeline"
          title="Timeline"
          onClick={() => openStudentQuickOverlay('timeline')}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M12 8v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="currentColor" strokeWidth="2" />
          </svg>
          <span className={labelClass('timeline')}>Timeline</span>
        </button>

        <button
          type="button"
          className={`${btnClass('sessions')} flex-none snap-start`}
          style={{ width: buttonWidth }}
          onClick={() => openStudentQuickOverlay('sessions')}
          aria-label="Sessions"
          title="Sessions"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M15 10.5 19 8v8l-4-2.5V10.5Z" fill="currentColor" />
            <path d="M5 7h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="2" />
          </svg>
          <span className={labelClass('sessions')}>Sessions</span>
        </button>

        <button
          type="button"
          className={`${baseBtn} flex-none snap-start`}
          style={{ width: buttonWidth }}
          onClick={openBooksOverlay}
          aria-label="Books & materials"
          title="Books & materials"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H18a2 2 0 0 1 2 2v13.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M4 5.5V18a3 3 0 0 0 3 3h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M7.5 7h8.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="text-[10px] leading-none opacity-80 text-white">Books</span>
        </button>

        <button
          type="button"
          className={`${btnClass('groups')} flex-none snap-start`}
          style={{ width: buttonWidth }}
          onClick={() => openStudentQuickOverlay('groups')}
          aria-label="Groups"
          title="Groups"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M16 11a3 3 0 1 0-2.999-3A3 3 0 0 0 16 11Z" stroke="currentColor" strokeWidth="2" />
            <path d="M8 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3Z" stroke="currentColor" strokeWidth="2" />
            <path d="M16 13c2.761 0 5 1.567 5 3.5V19H11v-2.5C11 14.567 13.239 13 16 13Z" stroke="currentColor" strokeWidth="2" />
            <path d="M8 13c2.761 0 5 1.567 5 3.5V19H3v-2.5C3 14.567 5.239 13 8 13Z" stroke="currentColor" strokeWidth="2" />
          </svg>
          <span className={labelClass('groups')}>Groups</span>
        </button>

        <button
          type="button"
          className={`${baseBtn} relative flex-none snap-start`}
          style={{ width: buttonWidth }}
          onClick={openNotificationsOverlay}
          aria-label="Notifications"
          title="Notifications"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2Zm6-6V11c0-3.07-1.63-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2Z" fill="currentColor" />
          </svg>
          {unreadNotificationsCount > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-[10px] leading-4 text-white text-center"
              aria-label={`${unreadNotificationsCount} unread notifications`}
            >
              {unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount}
            </span>
          )}
          <span className="text-[10px] leading-none opacity-80 text-white">Alerts</span>
        </button>

        <button
          type="button"
          className={`${btnClass('discover')} flex-none snap-start`}
          style={{ width: buttonWidth }}
          onClick={() => openStudentQuickOverlay('discover')}
          aria-label="Discover"
          title="Discover"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" stroke="currentColor" strokeWidth="2" />
            <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className={labelClass('discover')}>Discover</span>
        </button>

        {isAdmin && (
          <button
            type="button"
            className={`${baseBtn} flex-none snap-start`}
            style={{ width: buttonWidth }}
            onClick={() => openStudentQuickOverlay('admin')}
            aria-label="Admin tools"
            title="Admin tools"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="currentColor" strokeWidth="2" />
              <path
                d="M19.4 15a7.98 7.98 0 0 0 .1-1 7.98 7.98 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a8.2 8.2 0 0 0-1.7-1l-.4-2.6h-4l-.4 2.6a8.2 8.2 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7.98 7.98 0 0 0-.1 1c0 .34.03.67.1 1l-2 1.5 2 3.5 2.4-1c.52.41 1.09.75 1.7 1l.4 2.6h4l.4-2.6c.61-.25 1.18-.59 1.7-1l2.4 1 2-3.5-2-1.5Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-[10px] leading-none opacity-80 text-white">Admin</span>
          </button>
        )}
        </div>
      </section>
    )
  }

  const renderStudentHomeFeed = () => {
    if (status !== 'authenticated') return null
    if (sessionRole !== 'student' && sessionRole !== 'admin' && sessionRole !== 'teacher') return null

    const nowMs = Date.now()
    const getStartMs = (s: any) => (s?.startsAt ? new Date(s.startsAt).getTime() : 0)
    const getEndMs = (s: any) => {
      if (s?.endsAt) return new Date(s.endsAt).getTime()
      const startMs = getStartMs(s)
      return startMs ? startMs + 60 * 60 * 1000 : 0
    }
    const isCurrentWindow = (s: any) => {
      const startMs = getStartMs(s)
      const endMs = getEndMs(s)
      return Boolean(startMs && endMs && startMs <= nowMs && nowMs <= endMs)
    }

    const sortedSessions = [...(sessions || [])].sort((a, b) => getStartMs(a) - getStartMs(b))
    const currentSessions = sortedSessions.filter(s => isCurrentWindow(s))
    const pastSessions = sortedSessions
      .filter(s => getEndMs(s) < nowMs)
      .sort((a, b) => getStartMs(b) - getStartMs(a))
    const pastSessionIds = pastSessions.map(s => String(s?.id || '')).filter(Boolean)
    const defaultCurrentSessionId = currentSessions.length
      ? String([...currentSessions].sort((a, b) => getStartMs(b) - getStartMs(a))[0].id)
      : null

    const resolvedCurrentLessonId =
      (resolvedLiveSessionId && sessionById.has(String(resolvedLiveSessionId)) ? String(resolvedLiveSessionId) : null) ??
      (defaultCurrentSessionId && sessionById.has(String(defaultCurrentSessionId)) ? String(defaultCurrentSessionId) : null)

    const resolvedCurrentLesson = resolvedCurrentLessonId ? sessionById.get(resolvedCurrentLessonId) : null
    const lessonThumb = typeof (resolvedCurrentLesson as any)?.thumbnailUrl === 'string' ? (resolvedCurrentLesson as any).thumbnailUrl : ''

    return (
      <section className="space-y-3">
        <div
          className="overflow-hidden"
          style={(() => {
            const maxH = currentLessonCardNaturalHeight || 0
            if (!maxH) return undefined
            const collapsed = Math.min(maxH, Math.max(0, currentLessonCardCollapsePx))
            const progress = maxH ? collapsed / maxH : 0
            const heightPx = Math.max(0, Math.round(maxH - collapsed))
            return {
              height: `${heightPx}px`,
              opacity: String(Math.max(0, 1 - progress)),
              pointerEvents: progress >= 1 ? 'none' : 'auto',
            } as React.CSSProperties
          })()}
        >
          <div ref={currentLessonCardRef}>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold text-white">Current lesson</div>
                {sessionRole === 'admin' || sessionRole === 'teacher' ? (
                  <div className="flex items-center gap-1 text-xs font-semibold text-white/70">
                    <span>Grade</span>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center min-w-[32px] h-8 px-3 rounded-full border border-white/15 bg-white/10 backdrop-blur hover:bg-white/15 text-white touch-none"
                      onPointerDown={(e) => {
                        // Touch/pen: allow press + slide to select in one gesture.
                        if ((e as any).pointerType === 'mouse') return
                        const el = e.currentTarget as HTMLElement
                        const r = el.getBoundingClientRect()
                        setGradeWorkspaceSelectorAnchor({
                          top: r.top,
                          right: r.right,
                          bottom: r.bottom,
                          left: r.left,
                          width: r.width,
                          height: r.height,
                        })
                        setGradeWorkspaceSelectorPreview(null)
                        setGradeWorkspaceSelectorExternalDrag({ pointerId: e.pointerId, startClientY: e.clientY })
                        setGradeWorkspaceSelectorOpen(true)

                        // Prevent the browser from treating this as a scroll gesture.
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                      onClick={(e) => {
                        // Mouse: keep simple click-to-open.
                        const el = e.currentTarget as HTMLElement
                        const r = el.getBoundingClientRect()
                        setGradeWorkspaceSelectorAnchor({
                          top: r.top,
                          right: r.right,
                          bottom: r.bottom,
                          left: r.left,
                          width: r.width,
                          height: r.height,
                        })
                        setGradeWorkspaceSelectorPreview(null)
                        setGradeWorkspaceSelectorOpen(true)
                      }}
                      aria-label="Select grade workspace"
                      title="Select grade workspace"
                    >
                      {(() => {
                        const g = gradeWorkspaceSelectorPreview ?? selectedGrade
                        return g ? String(g).replace('GRADE_', '') : '—'
                      })()}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="text-xs font-semibold text-white/70 hover:text-white disabled:opacity-50 justify-self-end"
                    onClick={() => selectedGrade && fetchSessionsForGrade(selectedGrade)}
                    disabled={sessionsLoading || !selectedGrade}
                  >
                    {sessionsLoading ? 'Refreshing…' : 'Refresh'}
                  </button>
                )}
              </div>

              {!resolvedCurrentLesson ? (
                <div className="text-sm text-white/70">No current lesson right now.</div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
                  {lessonThumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={lessonThumb} alt="Lesson thumbnail" className="w-full h-40 object-cover" />
                  ) : null}

                  <div className="p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium text-white break-words">{resolvedCurrentLesson.title || 'Lesson'}</div>
                      {resolvedCurrentLesson.startsAt ? (
                        <div className="text-xs text-white/60">
                          {formatSessionRange(resolvedCurrentLesson.startsAt, (resolvedCurrentLesson as any).endsAt || resolvedCurrentLesson.startsAt)}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => showCanvasWindow(String(resolvedCurrentLesson.id), { quizMode: false })}
                        disabled={!canLaunchCanvasOverlay || isSubscriptionBlocked}
                      >
                        Enter class
                      </button>

                      <button
                        type="button"
                        className="text-sm font-semibold text-white/70 hover:text-white disabled:opacity-50"
                        onClick={() => openSessionDetails([String(resolvedCurrentLesson.id)], 0, 'responses')}
                        disabled={!canLaunchCanvasOverlay || isSubscriptionBlocked}
                      >
                        Quizzes
                      </button>

                      <button
                        type="button"
                        className="text-sm font-semibold text-white/70 hover:text-white disabled:opacity-50"
                        onClick={() => openSessionDetails([String(resolvedCurrentLesson.id)], 0, 'assignments')}
                        disabled={isSubscriptionBlocked}
                      >
                        Assignments
                      </button>
                      {(() => {
                        const isOwner = viewerId && String((resolvedCurrentLesson as any)?.createdBy || '') === String(viewerId)
                        const canManage = (sessionRole === 'admin' || sessionRole === 'teacher') && isOwner
                        if (!canManage) return null
                        return (
                          <TaskManageMenu
                            actions={[
                              {
                                label: 'Manage assignments',
                                onClick: () => openSessionDetails([String(resolvedCurrentLesson.id)], 0, 'assignments'),
                              },
                              {
                                label: 'Manage quizzes',
                                onClick: () => openSessionDetails([String(resolvedCurrentLesson.id)], 0, 'responses'),
                              },
                            ]}
                          />
                        )
                      })()}
                    </div>
                  </div>
                </div>
              )}

            </div>

            <div className="mt-3 rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold text-white">Past lessons</div>
                <button
                  type="button"
                  className="btn btn-ghost text-xs"
                  onClick={() => openPastSessionsList(pastSessionIds)}
                  disabled={pastSessionIds.length === 0}
                >
                  Open
                </button>
              </div>
              {pastSessionIds.length === 0 ? (
                <div className="mt-2 text-sm text-white/70">No past lessons yet.</div>
              ) : (
                <div className="mt-2 text-sm text-white/70">
                  {pastSessionIds.length} past lesson{pastSessionIds.length === 1 ? '' : 's'}
                </div>
              )}
            </div>
          </div>
        </div>

          <div className="space-y-3">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-white">Share a challenge</div>
                  <div className="text-xs text-white/60">Posts</div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost text-xs"
                  onClick={() => setTimelineOpen(true)}
                >
                  My posts
                </button>
              </div>

              <div className="mt-3 flex items-center gap-3">
                <div className="relative overflow-visible shrink-0">
                  <div className="h-10 w-10 aspect-square rounded-full border border-white/15 bg-white/10 overflow-hidden flex items-center justify-center profile-avatar-container">
                    {effectiveAvatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={effectiveAvatarUrl} alt={learnerName} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-sm font-semibold text-white">{String(learnerName || 'U').slice(0, 1).toUpperCase()}</span>
                    )}
                  </div>
                  {isVerifiedAccount ? (
                    <span
                      className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-blue-500 text-white flex items-center justify-center border border-white/50 shadow-md pointer-events-none"
                      aria-label="Verified"
                      title="Verified"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M9.00016 16.2L4.80016 12L3.40016 13.4L9.00016 19L21.0002 7.00001L19.6002 5.60001L9.00016 16.2Z" fill="currentColor" />
                      </svg>
                    </span>
                  ) : null}
                </div>

                <button
                  type="button"
                  className="group flex-1 h-11 rounded-2xl border border-blue-300/30 bg-white/10 hover:bg-white/15 px-4 text-left"
                  onClick={openCreateChallengeComposer}
                >
                  <span className="w-full inline-flex items-center justify-between gap-3 text-sm text-white/80 group-hover:text-white">
                    <span>Post a challenge</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="text-white/70 group-hover:text-white/90">
                      <path d="M12 20h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>

                <button
                  type="button"
                  className="h-11 w-11 shrink-0 flex items-center justify-center rounded-full border border-white/15 bg-white/10 text-white/80 hover:text-white hover:bg-white/15"
                  aria-label="Upload screenshot"
                  onClick={openCreateChallengeScreenshotPicker}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M4 7.5C4 6.11929 5.11929 5 6.5 5H8.5L9.2 3.6C9.538 2.924 10.229 2.5 10.985 2.5H13.015C13.771 2.5 14.462 2.924 14.8 3.6L15.5 5H17.5C18.8807 5 20 6.11929 20 7.5V18.5C20 19.8807 18.8807 21 17.5 21H6.5C5.11929 21 4 19.8807 4 18.5V7.5Z" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M12 17.5C14.2091 17.5 16 15.7091 16 13.5C16 11.2909 14.2091 9.5 12 9.5C9.79086 9.5 8 11.2909 8 13.5C8 15.7091 9.79086 17.5 12 17.5Z" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-white">Feed</div>
                  <div className="text-xs text-white/60">From your circle</div>
                </div>
              </div>

              {studentFeedLoading ? (
                <div className="text-sm text-white/70">Loading…</div>
              ) : studentFeedError ? (
                <div className="text-sm text-red-400">{studentFeedError}</div>
              ) : studentFeedPosts.length === 0 ? (
                <div className="text-sm text-white/70">No posts yet.</div>
              ) : (
                <ul className="space-y-2">
                  {studentFeedPosts.slice(0, 15).map((p: any, index: number, arr: any[]) => {
                const title = (p?.title || '').trim() || 'Quiz'
                const createdAt = p?.createdAt ? new Date(p.createdAt).toLocaleString() : ''
                const authorName = (p?.createdBy?.name || '').trim() || 'Learner'
                const authorId = p?.createdBy?.id ? String(p.createdBy.id) : null
                const authorAvatar = typeof p?.createdBy?.avatar === 'string' ? p.createdBy.avatar.trim() : ''
                const authorRole = String(p?.createdBy?.role || '').toLowerCase()
                const authorVerified = authorRole === 'admin' || authorRole === 'teacher'
                const authorHasAvatar = Boolean(authorAvatar)
                const showAuthorAvatarTick = authorVerified && authorHasAvatar
                const showAuthorNameTick = authorVerified && !authorHasAvatar
                const prompt = (p?.prompt || '').trim()
                const imageUrl = typeof p?.imageUrl === 'string' ? p.imageUrl.trim() : ''
                const myAttemptCount = typeof p?.myAttemptCount === 'number' ? p.myAttemptCount : 0
                const maxAttempts = typeof p?.maxAttempts === 'number' ? p.maxAttempts : null
                const attemptsOpen = p?.attemptsOpen !== false
                
                const isOwner = viewerId && p?.createdById && String(p.createdById) === String(viewerId)
                const hasAttempted = myAttemptCount > 0
                const canAttempt = attemptsOpen && (maxAttempts === null || myAttemptCount < maxAttempts)
                const href = p?.id ? `/challenges/${encodeURIComponent(String(p.id))}` : '#'
                
                const isLast = index === arr.length - 1
                return (
                  <li key={String(p?.id || title)} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <UserLink userId={authorId} className="shrink-0" title="View profile">
                            <div className="relative overflow-visible">
                              <div className="h-9 w-9 aspect-square rounded-full border border-white/10 bg-white/5 overflow-hidden flex items-center justify-center profile-avatar-container">
                                {authorAvatar ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={authorAvatar} alt={authorName} className="h-full w-full object-cover" />
                                ) : (
                                  <span className="text-xs font-semibold text-white">{authorName.slice(0, 1).toUpperCase()}</span>
                                )}
                              </div>
                              {showAuthorAvatarTick ? (
                                <span
                                  className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-blue-500 text-white flex items-center justify-center border border-white/50 shadow-md pointer-events-none"
                                  aria-label="Verified"
                                  title="Verified"
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                    <path d="M9.00016 16.2L4.80016 12L3.40016 13.4L9.00016 19L21.0002 7.00001L19.6002 5.60001L9.00016 16.2Z" fill="currentColor" />
                                  </svg>
                                </span>
                              ) : null}
                            </div>
                          </UserLink>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <UserLink userId={authorId} className="text-sm font-semibold text-white hover:underline truncate" title="View profile">
                                {authorName}
                              </UserLink>
                              {showAuthorNameTick ? (
                                <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-blue-500 text-white" aria-label="Verified" title="Verified">
                                  <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" aria-hidden="true">
                                    <path
                                      d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.12 7.18a1 1 0 0 1-1.42.006L3.29 9.01a1 1 0 1 1 1.414-1.414l3.17 3.17 6.412-6.47a1 1 0 0 1 1.418-.006z"
                                      fill="currentColor"
                                    />
                                  </svg>
                                </span>
                              ) : null}
                            </div>
                            {createdAt ? <div className="text-xs text-white/60">{createdAt}</div> : null}
                          </div>
                        </div>

                        <div className="mt-2 font-medium text-white break-words">{title}</div>
                        {prompt ? <div className="mt-1 text-sm text-white/70 break-words">{prompt.slice(0, 160)}{prompt.length > 160 ? '…' : ''}</div> : null}
                        {imageUrl ? (
                          <div className="mt-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={imageUrl}
                              alt="Post screenshot"
                              className="max-h-[220px] w-full rounded-lg border border-white/10 object-contain"
                            />
                          </div>
                        ) : null}
                      </div>
                      {p?.id ? (
                        isOwner ? (
                          <button
                            type="button"
                            className="btn btn-primary shrink-0"
                            onClick={() => {
                              setSelectedChallengeId(String(p.id))
                              setChallengeGradingOverlayOpen(true)
                            }}
                          >
                            Manage
                          </button>
                        ) : (
                          <div className="flex flex-col items-end gap-2 shrink-0">
                            {canAttempt ? (
                              <Link href={href} className="btn btn-primary shrink-0">
                                Attempt
                              </Link>
                            ) : hasAttempted ? (
                              <button
                                type="button"
                                className="btn btn-primary shrink-0"
                                onClick={() => {
                                  setSelectedChallengeResponseId(String(p.id))
                                  setChallengeResponseOverlayOpen(true)
                                }}
                              >
                                My response
                              </button>
                            ) : (
                              <button type="button" className="btn btn-ghost shrink-0" disabled>
                                Closed
                              </button>
                            )}

                            {hasAttempted && canAttempt ? (
                              <button
                                type="button"
                                className="btn btn-ghost text-xs shrink-0"
                                onClick={() => {
                                  setSelectedChallengeResponseId(String(p.id))
                                  setChallengeResponseOverlayOpen(true)
                                }}
                              >
                                My response
                              </button>
                            ) : null}
                          </div>
                        )
                      ) : null}
                    </div>
                    {!isLast && <div className="mt-3 border-t border-white/10" />}
                  </li>
                )
                  })}
                </ul>
              )}
            </div>
          </div>
      </section>
    )
  }

  const renderStudentTimelinePanel = () => (
    <div className="space-y-3">
      {renderStudentHomeFeed()}
    </div>
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

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!isMobile || !isCapacitorWrappedApp) return
    if (pullRefreshLoading) return

    const root = dashboardMainRef.current
    if (!root) return

    const THRESHOLD = 84
    const MAX_PULL = 132
    let tracking = false
    let startY = 0
    let armed = false

    const resetPull = () => {
      armed = false
      setPullRefreshOffset(0)
      setPullRefreshActive(false)
    }

    const isInsideDialog = (target: EventTarget | null) => {
      if (!target || !(target instanceof Element)) return false
      return Boolean(target.closest('[role="dialog"]'))
    }

    const hasAnyDialogOpen = () => {
      if (typeof document === 'undefined') return false
      return Boolean(document.querySelector('[role="dialog"]'))
    }

    const canStart = (target?: EventTarget | null) => {
      if (hasAnyDialogOpen()) return false
      if (topStackOverlayOpen || liveOverlayOpen) return false
      if (isInsideDialog(target ?? null)) return false
      return window.scrollY <= 0
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      if (!canStart(event.target)) return
      tracking = true
      armed = false
      startY = event.touches[0].clientY
      setPullRefreshActive(true)
      setPullRefreshOffset(0)
    }

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking) return
      if (!canStart()) {
        tracking = false
        resetPull()
        return
      }
      const currentY = event.touches[0]?.clientY ?? startY
      const deltaY = currentY - startY

      if (deltaY <= 0) {
        setPullRefreshOffset(0)
        armed = false
        return
      }

      const damped = Math.min(MAX_PULL, deltaY * 0.52)
      setPullRefreshOffset(damped)
      armed = damped >= THRESHOLD

      if (deltaY > 4) event.preventDefault()
    }

    const endGesture = () => {
      if (!tracking) return
      tracking = false
      const shouldRefresh = armed
      resetPull()
      if (!shouldRefresh) return

      setPullRefreshLoading(true)
      window.setTimeout(() => {
        try {
          window.location.reload()
        } catch {
          setPullRefreshLoading(false)
        }
      }, 60)
    }

    root.addEventListener('touchstart', onTouchStart, { passive: true })
    root.addEventListener('touchmove', onTouchMove, { passive: false })
    root.addEventListener('touchend', endGesture, { passive: true })
    root.addEventListener('touchcancel', endGesture, { passive: true })

    return () => {
      root.removeEventListener('touchstart', onTouchStart)
      root.removeEventListener('touchmove', onTouchMove)
      root.removeEventListener('touchend', endGesture)
      root.removeEventListener('touchcancel', endGesture)
    }
  }, [isMobile, isCapacitorWrappedApp, liveOverlayOpen, pullRefreshLoading, topStackOverlayOpen])

  const updateGradeSelection = (grade: GradeValue) => {
    if (selectedGrade === grade) return
    setSelectedGrade(grade)
    if (router.isReady) {
      const nextQuery = { ...router.query, grade }
      router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true })
    }
  }

  const toLocalDateTimeValue = (value: unknown) => {
    if (!value) return ''
    const dt = value instanceof Date ? value : new Date(String(value))
    if (Number.isNaN(dt.getTime())) return ''
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`
  }

  const buildLessonDraftFromOverride = (override: any) => {
    const emptyDraft = { engage: [], explore: [], explain: [], elaborate: [], evaluate: [] } as Record<LessonPhaseKey, LessonPointDraft[]>
    if (!override || typeof override !== 'object') return emptyDraft
    if (override.schemaVersion !== 2 || !Array.isArray(override.phases)) return emptyDraft

    const next = { ...emptyDraft }
    override.phases.forEach((phase: any) => {
      const key = phase?.key as LessonPhaseKey
      if (!key || !(key in next)) return
      const points = Array.isArray(phase?.points) ? phase.points : []
      next[key] = points.map((point: any, idx: number) => {
        const draft = newPointDraft()
        draft.id = String(point?.id || `${key}-${idx}`)
        draft.title = typeof point?.title === 'string' ? point.title : ''
        const modules = Array.isArray(point?.modules) ? point.modules : []
        modules.forEach((mod: any) => {
          if (mod?.type === 'text' && typeof mod.text === 'string') {
            draft.text = mod.text
          }
          if (mod?.type === 'latex' && typeof mod.latex === 'string') {
            const lines = mod.latex.split('\\').map((line: string) => line.trim()).filter(Boolean)
            draft.latex = lines.join('\n')
          }
          if (mod?.type === 'diagram') {
            const diagram = mod.diagram
            if (diagram && typeof diagram === 'object') {
              draft.diagramSnapshot = {
                title: typeof diagram.title === 'string' ? diagram.title : '',
                imageUrl: typeof diagram.imageUrl === 'string' ? diagram.imageUrl : '',
                annotations: diagram.annotations ?? null,
              }
            }
          }
        })
        return draft
      })
    })
    return next
  }

  const openEditSession = useCallback(async (sessionId: string) => {
    const safeId = String(sessionId || '').trim()
    if (!safeId) return
    const sessionRec = sessionById.get(safeId)
    if (!sessionRec) return

    setEditingSessionId(safeId)
    setCreateLessonOverlayOpen(true)
    setTitle(String(sessionRec.title || ''))
    setJoinUrl(String(sessionRec.joinUrl || ''))
    const startsLocal = toLocalDateTimeValue(sessionRec.startsAt)
    const endsLocal = toLocalDateTimeValue((sessionRec as any).endsAt || sessionRec.startsAt)
    setStartsAt(startsLocal)
    setEndsAt(endsLocal)
    if (startsLocal) {
      setMinStartsAt(startsLocal)
      setMinEndsAt(startsLocal)
    }
    setSessionThumbnailUrlDraft((sessionRec as any)?.thumbnailUrl || null)

    setLessonScriptDraft({ engage: [], explore: [], explain: [], elaborate: [], evaluate: [] })
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(safeId)}/lesson-script`, { credentials: 'same-origin' })
      if (!res.ok) return
      const data = await res.json().catch(() => null)
      if (data?.resolved) {
        setLessonScriptDraft(buildLessonDraftFromOverride(data.resolved))
      }
    } catch {
      // ignore
    }
  }, [sessionById])

  async function createSession(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedGrade) {
      alert('Select a grade before creating a session')
      return
    }

    const parseLines = (raw: string) =>
      (raw || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)

    const buildLessonScriptOverride = () => {
      const phaseOrder: LessonPhaseKey[] = ['engage', 'explore', 'explain', 'elaborate', 'evaluate']
      const phases = phaseOrder
        .map(key => {
          const points = (lessonScriptDraft[key] || [])
            .map((p, idx) => {
              const text = (p.text || '').trim()
              const diagram = p.diagramSnapshot && typeof p.diagramSnapshot === 'object'
                ? {
                    title: (p.diagramSnapshot.title || '').trim(),
                    imageUrl: (p.diagramSnapshot.imageUrl || '').trim(),
                    annotations: p.diagramSnapshot.annotations ?? null,
                  }
                : null
              const latexLines = parseLines(p.latex || '')
              const latex = latexLines.join(' \\\\ ').trim()

              const modules: any[] = []
              if (text) modules.push({ type: 'text', text })
              if (diagram && diagram.title && diagram.imageUrl) modules.push({ type: 'diagram', diagram })
              if (latex) modules.push({ type: 'latex', latex })
              if (modules.length === 0) return null

              return {
                id: String(p.id || `${key}-${idx}`),
                title: (p.title || '').trim(),
                modules,
              }
            })
            .filter(Boolean)

          if (points.length === 0) return null
          return {
            key,
            label: key.charAt(0).toUpperCase() + key.slice(1),
            points,
          }
        })
        .filter(Boolean)

      if (phases.length === 0) return null

      return {
        schemaVersion: 2,
        model: '5E',
        title: (title || '').trim() || 'Lesson',
        grade: selectedGrade,
        phases,
      }
    }

    try {
      // convert local datetime-local value to an ISO UTC string before sending
      let startsAtIso = startsAt
      let endsAtIso = endsAt
      if (startsAt) {
        const dt = new Date(startsAt)
        startsAtIso = dt.toISOString()
      }
      if (endsAt) {
        const dt = new Date(endsAt)
        endsAtIso = dt.toISOString()
      }

      const overridePayload = buildLessonScriptOverride()

      if (editingSessionId) {
        const res = await fetch(`/api/sessions/${encodeURIComponent(editingSessionId)}`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            joinUrl,
            startsAt: startsAtIso,
            endsAt: endsAtIso,
            grade: selectedGrade,
            thumbnailUrl: sessionThumbnailUrlDraft,
          })
        })

        if (!res.ok) {
          let data: any = null
          try {
            data = await res.json()
          } catch (err) {
            const txt = await res.text().catch(() => '')
            data = { message: txt || `HTTP ${res.status}` }
          }
          alert(data?.message || `Error: ${res.status}`)
          return
        }

        await fetch(`/api/sessions/${encodeURIComponent(editingSessionId)}/lesson-script`, {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ overrideContent: overridePayload ?? null }),
        })

        alert('Session updated')
        setEditingSessionId(null)
        setCreateLessonOverlayOpen(false)
        fetchSessionsForGrade(selectedGrade)
        return
      }

      const res = await fetch('/api/create-session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          joinUrl,
          startsAt: startsAtIso,
          endsAt: endsAtIso,
          grade: selectedGrade,
          lessonScriptOverrideContent: overridePayload,
          thumbnailUrl: sessionThumbnailUrlDraft,
        })
      })

      if (res.ok) {
        alert('Session created')
        setTitle('')
        setJoinUrl('')
        setStartsAt('')
        setEndsAt('')
        setLessonScriptDraft({ engage: [], explore: [], explain: [], elaborate: [], evaluate: [] })
        setSessionThumbnailUrlDraft(null)
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
      setSessionsLoading(false)
      return
    }
    const cacheKey = makeOfflineCacheKey(`sessions:${gradeToFetch}`)
    const cached = readLocalCache<any[]>(cacheKey)
    if (cached?.data?.length) {
      setSessions(cached.data)
    }
    setSessionsLoading(true)
    setSessionsError(null)
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (cached?.data?.length) {
        setSessionsError('Offline. Showing last saved sessions.')
      } else {
        setSessions([])
        setSessionsError('Offline. No saved sessions yet.')
      }
      setSessionsLoading(false)
      return
    }
    try {
      const res = await fetch(`/api/sessions?grade=${encodeURIComponent(gradeToFetch)}`, { credentials: 'same-origin' })
      if (res.ok) {
        const data = await res.json()
        setSessions(data)
        writeLocalCache(cacheKey, data)
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
    } finally {
      setSessionsLoading(false)
    }
  }

  async function fetchLiveSelectionForGrade(gradeOverride?: GradeValue | null) {
    const gradeToFetch = gradeOverride ?? selectedGrade
    if (!gradeToFetch) {
      setLiveOverrideSessionId(null)
      setResolvedLiveSessionId(null)
      return
    }
    try {
      const res = await fetch(`/api/sessions/live?grade=${encodeURIComponent(gradeToFetch)}`, { credentials: 'same-origin' })
      if (!res.ok) return
      const data = await res.json().catch(() => null)
      setLiveOverrideSessionId(data?.overrideSessionId ? String(data.overrideSessionId) : null)
      setResolvedLiveSessionId(data?.resolvedLiveSessionId ? String(data.resolvedLiveSessionId) : null)
    } catch {
      // ignore
    }
  }

  async function fetchAnnouncementsForGrade(gradeOverride?: GradeValue | null) {
    const gradeToFetch = gradeOverride ?? selectedGrade
    if (!gradeToFetch) {
      setAnnouncements([])
      setAnnouncementsError('Select a grade to view announcements.')
      return
    }
    const cacheKey = makeOfflineCacheKey(`announcements:${gradeToFetch}`)
    const cached = readLocalCache<Announcement[]>(cacheKey)
    if (cached?.data?.length) {
      setAnnouncements(cached.data)
    }
    setAnnouncementsError(null)
    setAnnouncementsLoading(true)
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (cached?.data?.length) {
        setAnnouncementsError('Offline. Showing last saved announcements.')
      } else {
        setAnnouncements([])
        setAnnouncementsError('Offline. No saved announcements yet.')
      }
      setAnnouncementsLoading(false)
      return
    }
    try {
      const res = await fetch(`/api/announcements?grade=${encodeURIComponent(gradeToFetch)}`, { credentials: 'same-origin' })
      if (res.ok) {
        const data = await res.json()
        setAnnouncements(Array.isArray(data) ? data : [])
        writeLocalCache(cacheKey, Array.isArray(data) ? data : [])
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
      if (!cached?.data?.length) setAnnouncements([])
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

  async function fetchMyResponses(sessionId: string) {
    setMyResponsesError(null)
    setMyResponsesLoading(true)
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/responses`, { credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        const responses = Array.isArray(data?.responses) ? data.responses : []
        setMyResponses(responses)
        return
      }
      setMyResponses([])
      setMyResponsesError(data?.message || `Failed to load responses (${res.status})`)
    } catch (err: any) {
      setMyResponses([])
      setMyResponsesError(err?.message || 'Network error')
    } finally {
      setMyResponsesLoading(false)
    }
  }

  async function fetchAssignments(sessionId: string) {
    setAssignmentsError(null)
    setAssignmentsLoading(true)
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/assignments`, { credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setAssignments(Array.isArray(data) ? data : [])
        return
      }
      setAssignments([])
      setAssignmentsError(data?.message || `Failed to load assignments (${res.status})`)
    } catch (err: any) {
      setAssignments([])
      setAssignmentsError(err?.message || 'Network error')
    } finally {
      setAssignmentsLoading(false)
    }
  }

  async function fetchAssignmentDetails(sessionId: string, assignmentId: string) {
    setSelectedAssignmentError(null)
    setSelectedAssignmentLoading(true)
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}`,
        { credentials: 'same-origin' }
      )
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setSelectedAssignment(data)
        setAssignmentMasterGradingPrompt(String((data as any)?.gradingPrompt || ''))
        setAssignmentGradingPromptByQuestionId(() => {
          const map: Record<string, string> = {}
          const qs = Array.isArray((data as any)?.questions) ? (data as any).questions : []
          for (const q of qs) {
            if (!q?.id) continue
            map[String(q.id)] = String(q?.gradingPrompt || '')
          }
          return map
        })
        setAssignmentResponsesByQuestionId({})
        setAssignmentResponsesError(null)
        setAssignmentSubmittedAt(null)
        setAssignmentSubmitError(null)
        setAssignmentGradeByQuestionId({})
        setAssignmentGradeSummary(null)
        setAssignmentGradeError(null)

        setAdminAssignmentSubmissions([])
        setAdminAssignmentSubmissionsError(null)
        setAdminSelectedSubmissionUserId(null)
        setAdminSelectedSubmissionDetail(null)
        setAdminSelectedSubmissionError(null)
        setAssignmentSolutionsByQuestionId({})
        setAssignmentSolutionsError(null)
        setAssignmentSolutionUploadFilesByQuestionId({})
        setAssignmentSolutionUploadNonceByQuestionId({})
        setAssignmentSolutionMarkingPlanDraftByQuestionId({})
        setAssignmentSolutionMarkingPlanSavingQuestionId(null)
        setAssignmentSolutionMarkingPlanGeneratingQuestionId(null)
        setAssignmentSolutionWorkedSolutionDraftByQuestionId({})
        setAssignmentSolutionWorkedSolutionSavingQuestionId(null)
        setAssignmentSolutionWorkedSolutionGeneratingQuestionId(null)
        if (isLearner) {
          void fetchAssignmentResponses(sessionId, assignmentId)
        } else {
          void fetchAssignmentSolutions(sessionId, assignmentId)
          if (isAdmin) {
            void fetchAdminAssignmentSubmissions(sessionId, assignmentId)
          }
        }
        return
      }
      setSelectedAssignment(null)
      setSelectedAssignmentError(data?.message || `Failed to load assignment (${res.status})`)
      setAssignmentResponsesByQuestionId({})
      setAssignmentSubmittedAt(null)
      setAssignmentGradeByQuestionId({})
      setAssignmentGradeSummary(null)
      setAssignmentGradeError(null)
      setAssignmentSolutionsByQuestionId({})
      setAssignmentSolutionMarkingPlanDraftByQuestionId({})
      setAssignmentSolutionWorkedSolutionDraftByQuestionId({})
    } catch (err: any) {
      setSelectedAssignment(null)
      setSelectedAssignmentError(err?.message || 'Network error')
      setAssignmentResponsesByQuestionId({})
      setAssignmentSubmittedAt(null)
      setAssignmentGradeByQuestionId({})
      setAssignmentGradeSummary(null)
      setAssignmentGradeError(null)
      setAssignmentSolutionsByQuestionId({})
      setAssignmentMasterGradingPrompt('')
      setAssignmentGradingPromptByQuestionId({})
      setAssignmentSolutionUploadFilesByQuestionId({})
      setAssignmentSolutionUploadNonceByQuestionId({})
      setAssignmentSolutionMarkingPlanDraftByQuestionId({})
      setAssignmentSolutionMarkingPlanSavingQuestionId(null)
      setAssignmentSolutionMarkingPlanGeneratingQuestionId(null)
      setAssignmentSolutionWorkedSolutionDraftByQuestionId({})
      setAssignmentSolutionWorkedSolutionSavingQuestionId(null)
      setAssignmentSolutionWorkedSolutionGeneratingQuestionId(null)
    } finally {
      setSelectedAssignmentLoading(false)
    }
  }

  async function updateAssignmentTitle(sessionId: string, assignmentId: string, nextTitle: string) {
    if (!nextTitle.trim()) return
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}`,
        {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: nextTitle.trim() }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to update assignment (${res.status})`)
      setAssignments(prev => prev.map(a => (String(a?.id || '') === assignmentId ? { ...a, title: data?.title || nextTitle.trim() } : a)))
      setSelectedAssignment(prev => (prev && String(prev?.id || '') === assignmentId ? { ...prev, title: data?.title || nextTitle.trim() } : prev))
    } catch (err: any) {
      setAssignmentsError(err?.message || 'Unable to update assignment')
    }
  }

  async function deleteAssignment(sessionId: string, assignmentId: string) {
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}`,
        { method: 'DELETE', credentials: 'same-origin' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to delete assignment (${res.status})`)
      setAssignments(prev => prev.filter(a => String(a?.id || '') !== assignmentId))
      if (selectedAssignment && String(selectedAssignment?.id || '') === assignmentId) {
        setSelectedAssignment(null)
        setAssignmentOverlayOpen(false)
      }
    } catch (err: any) {
      setAssignmentsError(err?.message || 'Unable to delete assignment')
    }
  }

  async function fetchAdminAssignmentSubmissions(sessionId: string, assignmentId: string) {
    if (!isTeacherOrAdminUser) return
    if (adminAssignmentSubmissionsLoading) return
    setAdminAssignmentSubmissionsError(null)
    setAdminAssignmentSubmissionsLoading(true)
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}/submissions`,
        { credentials: 'same-origin' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAdminAssignmentSubmissions([])
        setAdminAssignmentSubmissionsError(data?.message || `Failed to load submissions (${res.status})`)
        return
      }
      setAdminAssignmentSubmissions(Array.isArray(data?.submissions) ? data.submissions : [])
    } catch (err: any) {
      setAdminAssignmentSubmissions([])
      setAdminAssignmentSubmissionsError(err?.message || 'Network error')
    } finally {
      setAdminAssignmentSubmissionsLoading(false)
    }
  }

  async function fetchAdminSubmissionDetail(sessionId: string, assignmentId: string, userId: string) {
    if (!isTeacherOrAdminUser) return
    if (!userId) return
    if (adminSelectedSubmissionLoading) return

    setAdminSelectedSubmissionError(null)
    setAdminSelectedSubmissionLoading(true)
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}/submissions/${encodeURIComponent(userId)}`,
        { credentials: 'same-origin' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAdminSelectedSubmissionDetail(null)
        setAdminSelectedSubmissionError(data?.message || `Failed to load submission (${res.status})`)
        return
      }
      setAdminSelectedSubmissionDetail(data)
    } catch (err: any) {
      setAdminSelectedSubmissionDetail(null)
      setAdminSelectedSubmissionError(err?.message || 'Network error')
    } finally {
      setAdminSelectedSubmissionLoading(false)
    }
  }

  async function adminRegradeSubmission(sessionId: string, assignmentId: string, userId: string) {
    if (!isAdmin) return
    if (!userId) return
    if (adminRegradeLoading) return

    setAdminRegradeError(null)
    setAdminRegradeLoading(true)
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}/grade?userId=${encodeURIComponent(userId)}&force=1`,
        { credentials: 'same-origin' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAdminRegradeError(data?.message || `Failed to re-grade (${res.status})`)
        return
      }

      void fetchAdminSubmissionDetail(sessionId, assignmentId, userId)
    } catch (err: any) {
      setAdminRegradeError(err?.message || 'Network error')
    } finally {
      setAdminRegradeLoading(false)
    }
  }

  async function saveAssignmentGradingPrompt(sessionId: string, assignmentId: string, prompt: string) {
    if (isLearner) return
    if (assignmentGradingPromptSavingScope) return
    setAssignmentGradingPromptSavingScope('assignment')
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}/grading-prompts`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: 'assignment', prompt }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Save failed (${res.status})`)
      alert('Assignment grading prompt saved.')
      void fetchAssignmentDetails(sessionId, assignmentId)
    } catch (err: any) {
      alert(err?.message || 'Save failed')
    } finally {
      setAssignmentGradingPromptSavingScope(null)
    }
  }

  async function saveQuestionGradingPrompt(sessionId: string, assignmentId: string, questionId: string, prompt: string) {
    if (isLearner) return
    if (assignmentGradingPromptSavingScope) return
    setAssignmentGradingPromptSavingScope(`q:${questionId}`)
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}/grading-prompts`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: 'question', questionId, prompt }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Save failed (${res.status})`)
      alert('Question grading prompt saved.')
      void fetchAssignmentDetails(sessionId, assignmentId)
    } catch (err: any) {
      alert(err?.message || 'Save failed')
    } finally {
      setAssignmentGradingPromptSavingScope(null)
    }
  }

  async function fetchAssignmentResponses(sessionId: string, assignmentId: string) {
    setAssignmentResponsesError(null)
    setAssignmentResponsesLoading(true)
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}/responses`,
        { credentials: 'same-origin' }
      )
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setAssignmentResponsesByQuestionId((data?.byQuestionId && typeof data.byQuestionId === 'object') ? data.byQuestionId : {})
        const submittedAt = data?.submittedAt ? String(data.submittedAt) : null
        setAssignmentSubmittedAt(submittedAt)
        if (submittedAt) {
          void fetchAssignmentGrade(sessionId, assignmentId)
        } else {
          setAssignmentGradeByQuestionId({})
          setAssignmentEarnedMarksByQuestionId({})
          setAssignmentTotalMarksByQuestionId({})
          setAssignmentStepFeedbackByQuestionId({})
          setAssignmentGradeSummary(null)
          setAssignmentGradeError(null)
        }
        return
      }
      setAssignmentResponsesByQuestionId({})
      setAssignmentResponsesError(data?.message || `Failed to load assignment responses (${res.status})`)
      setAssignmentSubmittedAt(null)
      setAssignmentGradeByQuestionId({})
      setAssignmentEarnedMarksByQuestionId({})
      setAssignmentTotalMarksByQuestionId({})
      setAssignmentStepFeedbackByQuestionId({})
      setAssignmentGradeSummary(null)
    } catch (err: any) {
      setAssignmentResponsesByQuestionId({})
      setAssignmentResponsesError(err?.message || 'Network error')
      setAssignmentSubmittedAt(null)
      setAssignmentGradeByQuestionId({})
      setAssignmentEarnedMarksByQuestionId({})
      setAssignmentTotalMarksByQuestionId({})
      setAssignmentStepFeedbackByQuestionId({})
      setAssignmentGradeSummary(null)
    } finally {
      setAssignmentResponsesLoading(false)
    }
  }

  async function fetchAssignmentGrade(sessionId: string, assignmentId: string) {
    if (!isLearner) return
    if (assignmentGradeLoading) return

    setAssignmentGradeError(null)
    setAssignmentGradeLoading(true)
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}/grade`,
        { credentials: 'same-origin' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAssignmentGradeByQuestionId({})
        setAssignmentEarnedMarksByQuestionId({})
        setAssignmentTotalMarksByQuestionId({})
        setAssignmentStepFeedbackByQuestionId({})
        setAssignmentGradeSummary(null)
        // 409 = assignment not submitted yet; keep silent.
        if (res.status !== 409) {
          setAssignmentGradeError(data?.message || `Failed to load grade (${res.status})`)
        }
        return
      }

      const grade = data?.grade
      const results: any[] = Array.isArray(grade?.results) ? grade.results : []
      const next: Record<string, 'correct' | 'incorrect'> = {}
      const earned: Record<string, number> = {}
      const totals: Record<string, number> = {}
      const stepsByQ: Record<string, any[]> = {}
      for (const r of results) {
        const qid = String(r?.questionId || '')
        const correctness = String(r?.correctness || '')
        if (!qid) continue
        next[qid] = correctness === 'correct' ? 'correct' : 'incorrect'

        if (typeof r?.earnedMarks === 'number' || typeof r?.earnedMarks === 'string') {
          const n = Number(r.earnedMarks)
          if (Number.isFinite(n)) earned[qid] = Math.trunc(n)
        }
        if (typeof r?.totalMarks === 'number' || typeof r?.totalMarks === 'string') {
          const n = Number(r.totalMarks)
          if (Number.isFinite(n)) totals[qid] = Math.trunc(n)
        }
        const stepArr = Array.isArray(r?.steps) ? r.steps : (Array.isArray(r?.stepFeedback) ? r.stepFeedback : null)
        if (Array.isArray(stepArr)) stepsByQ[qid] = stepArr
      }

      setAssignmentGradeByQuestionId(next)
      setAssignmentEarnedMarksByQuestionId(earned)
      setAssignmentTotalMarksByQuestionId(totals)
      setAssignmentStepFeedbackByQuestionId(stepsByQ)
      setAssignmentGradeSummary({
        earnedPoints: Number(grade?.earnedPoints || 0) || 0,
        totalPoints: Number(grade?.totalPoints || 0) || 0,
        percentage: Number(grade?.percentage || 0) || 0,
      })
    } catch (err: any) {
      setAssignmentGradeByQuestionId({})
      setAssignmentEarnedMarksByQuestionId({})
      setAssignmentTotalMarksByQuestionId({})
      setAssignmentStepFeedbackByQuestionId({})
      setAssignmentGradeSummary(null)
      setAssignmentGradeError(err?.message || 'Network error')
    } finally {
      setAssignmentGradeLoading(false)
    }
  }

  async function fetchAssignmentSolutions(sessionId: string, assignmentId: string) {
    setAssignmentSolutionsError(null)
    setAssignmentSolutionsLoading(true)
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}/solutions`,
        { credentials: 'same-origin' }
      )
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        const byQ = (data?.byQuestionId && typeof data.byQuestionId === 'object') ? data.byQuestionId : {}
        setAssignmentSolutionsByQuestionId(byQ)
        setAssignmentSolutionMarkingPlanDraftByQuestionId(() => {
          const next: Record<string, string> = {}
          for (const [qid, sol] of Object.entries(byQ)) {
            const teacher = String((sol as any)?.teacherMarkingPlan || '')
            const ai = String((sol as any)?.aiMarkingPlan || '')
            next[String(qid)] = teacher.trim() ? teacher : ai
          }
          return next
        })
        setAssignmentSolutionWorkedSolutionDraftByQuestionId(() => {
          const next: Record<string, string> = {}
          for (const [qid, sol] of Object.entries(byQ)) {
            const teacher = String((sol as any)?.teacherWorkedSolution || '')
            const ai = String((sol as any)?.aiWorkedSolution || '')
            next[String(qid)] = teacher.trim() ? teacher : ai
          }
          return next
        })
        return
      }
      setAssignmentSolutionsByQuestionId({})
      setAssignmentSolutionsError(data?.message || `Failed to load solutions (${res.status})`)
    } catch (err: any) {
      setAssignmentSolutionsByQuestionId({})
      setAssignmentSolutionsError(err?.message || 'Network error')
    } finally {
      setAssignmentSolutionsLoading(false)
    }
  }

  async function uploadAssignmentSolutionFile(sessionId: string, assignmentId: string, questionId: string, file: File) {
    if (isLearner) return
    if (!file) return
    if (assignmentSolutionUploadingQuestionId === String(questionId)) return

    setAssignmentSolutionUploadingQuestionId(String(questionId))
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('questionId', String(questionId))
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}/solutions/upload`,
        { method: 'POST', credentials: 'same-origin', body: form }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Upload failed (${res.status})`)

      setAssignmentSolutionUploadFilesByQuestionId(prev => ({ ...prev, [String(questionId)]: null }))
      setAssignmentSolutionUploadNonceByQuestionId(prev => ({
        ...prev,
        [String(questionId)]: (prev[String(questionId)] || 0) + 1,
      }))

      void fetchAssignmentSolutions(sessionId, assignmentId)
      alert('Solution uploaded.')
    } catch (err: any) {
      alert(err?.message || 'Upload failed')
    } finally {
      setAssignmentSolutionUploadingQuestionId(null)
    }
  }

  async function saveAssignmentSolutionMarkingPlan(sessionId: string, assignmentId: string, questionId: string, planText: string) {
    if (isLearner) return
    if (assignmentSolutionMarkingPlanSavingQuestionId === String(questionId)) return

    setAssignmentSolutionMarkingPlanSavingQuestionId(String(questionId))
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}/solutions/marking-plan`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save', questionId: String(questionId), planText: String(planText || '') }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Save failed (${res.status})`)
      alert('Marking plan saved.')
      void fetchAssignmentSolutions(sessionId, assignmentId)
    } catch (err: any) {
      alert(err?.message || 'Save failed')
    } finally {
      setAssignmentSolutionMarkingPlanSavingQuestionId(null)
    }
  }

  async function generateAssignmentSolutionMarkingPlan(sessionId: string, assignmentId: string, questionId: string) {
    if (isLearner) return
    if (assignmentSolutionMarkingPlanGeneratingQuestionId === String(questionId)) return

    setAssignmentSolutionMarkingPlanGeneratingQuestionId(String(questionId))
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}/solutions/marking-plan`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generate', questionId: String(questionId) }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Generate failed (${res.status})`)
      alert('Gemini marking plan generated.')
      void fetchAssignmentSolutions(sessionId, assignmentId)
    } catch (err: any) {
      alert(err?.message || 'Generate failed')
    } finally {
      setAssignmentSolutionMarkingPlanGeneratingQuestionId(null)
    }
  }

  async function saveAssignmentSolutionWorkedSolution(sessionId: string, assignmentId: string, questionId: string, solutionText: string) {
    if (isLearner) return
    if (assignmentSolutionWorkedSolutionSavingQuestionId === String(questionId)) return

    setAssignmentSolutionWorkedSolutionSavingQuestionId(String(questionId))
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}/solutions/worked-solution`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save', questionId: String(questionId), solutionText: String(solutionText || '') }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Save failed (${res.status})`)
      alert('Worked solution saved.')
      void fetchAssignmentSolutions(sessionId, assignmentId)
    } catch (err: any) {
      alert(err?.message || 'Save failed')
    } finally {
      setAssignmentSolutionWorkedSolutionSavingQuestionId(null)
    }
  }

  async function generateAssignmentSolutionWorkedSolution(sessionId: string, assignmentId: string, questionId: string) {
    if (isLearner) return
    if (assignmentSolutionWorkedSolutionGeneratingQuestionId === String(questionId)) return

    setAssignmentSolutionWorkedSolutionGeneratingQuestionId(String(questionId))
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}/solutions/worked-solution`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generate', questionId: String(questionId) }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Generate failed (${res.status})`)
      alert('Gemini worked solution generated.')
      void fetchAssignmentSolutions(sessionId, assignmentId)
    } catch (err: any) {
      alert(err?.message || 'Generate failed')
    } finally {
      setAssignmentSolutionWorkedSolutionGeneratingQuestionId(null)
    }
  }

  async function submitAssignment(sessionId: string, assignmentId: string) {
    if (!isLearner) return
    if (assignmentSubmitting) return
    setAssignmentSubmitError(null)

    if (!isTestStudent) {
      alert('Submitting will lock this assignment. You will no longer be able to edit your answers after submission.')
    }

    const ok = confirm(
      isTestStudent
        ? assignmentSubmittedAt
          ? 'Resubmit this assignment now? (Test account: editing stays unlocked)'
          : 'Submit this assignment now? (Test account: editing stays unlocked)'
        : 'Submit this assignment now?'
    )
    if (!ok) return

    setAssignmentSubmitting(true)
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}/submit`,
        { method: 'POST', credentials: 'same-origin' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || `Submit failed (${res.status})`)
      }
      setAssignmentSubmittedAt(data?.submittedAt ? String(data.submittedAt) : new Date().toISOString())
      if (isTestStudent) {
        setAssignmentGradeSummary(null)
        setAssignmentGradeError(null)
      }
      alert(isTestStudent && assignmentSubmittedAt ? 'Assignment resubmitted.' : 'Assignment submitted.')
      void fetchAssignmentResponses(sessionId, assignmentId)
    } catch (err: any) {
      setAssignmentSubmitError(err?.message || 'Submit failed')
      alert(err?.message || 'Submit failed')
    } finally {
      setAssignmentSubmitting(false)
    }
  }

  async function importAssignment(sessionId: string) {
    if (!assignmentFile) {
      setAssignmentImportError('Choose a PDF or image first.')
      return
    }
    setAssignmentImportError(null)
    setAssignmentImporting(true)
    try {
      const form = new FormData()
      form.append('file', assignmentFile)
      if (assignmentTitle.trim()) form.append('title', assignmentTitle.trim())
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/assignments/import`, {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || `Import failed (${res.status})`)
      }
      setAssignmentFile(null)
      setAssignmentTitle('')
      await fetchAssignments(sessionId)
      if (data?.id) {
        setSelectedAssignmentId(String(data.id))
        await fetchAssignmentDetails(sessionId, String(data.id))
      }
    } catch (err: any) {
      setAssignmentImportError(err?.message || 'Import failed')
    } finally {
      setAssignmentImporting(false)
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
      setMaterialTitle(prev => prev || toDisplayFileName(file.name) || file.name)
    } else {
      setMaterialTitle('')
    }
  }

  const toggleMaterialsForSession = (sessionId: string) => {
    // Legacy name: this now opens the session details overlay (Assignments).
    const id = String(sessionId || '')
    if (!id) return
    setSessionDetailsIds([id])
    setSessionDetailsIndex(0)
    setSessionDetailsView('details')
    setSessionDetailsTab('assignments')
    setSessionDetailsOpen(true)
  }

  const closeSessionDetails = useCallback(() => {
    setSessionDetailsOpen(false)
    setSessionDetailsIds([])
    setSessionDetailsIndex(0)
    setSessionDetailsView('details')
    setSessionDetailsTab('assignments')
    setExpandedSessionId(null)
    setMaterials([])
    setMaterialsError(null)
    setLatexSaves({ shared: [], mine: [] })
    setLatexSavesError(null)
    setMyResponses([])
    setMyResponsesError(null)
    resetMaterialForm()
  }, [])

  const openSessionDetails = useCallback((ids: string[], initialIndex = 0, initialTab: 'assignments' | 'responses' = 'assignments') => {
    const safeIds = (ids || []).map(String).filter(Boolean)
    if (!safeIds.length) return
    const idx = Math.max(0, Math.min(initialIndex, safeIds.length - 1))
    setSessionDetailsIds(safeIds)
    setSessionDetailsIndex(idx)
    setSessionDetailsView('details')
    setSessionDetailsTab(initialTab)
    setSessionDetailsOpen(true)
  }, [])

  const openPastSessionsList = useCallback((ids: string[]) => {
    const safeIds = (ids || []).map(String).filter(Boolean)
    if (!safeIds.length) return
    setSessionDetailsIds(safeIds)
    setSessionDetailsIndex(0)
    setSessionDetailsView('pastList')
    setSessionDetailsTab('assignments')
    setSessionDetailsOpen(true)
  }, [])

  const sessionDetailsSessionId = sessionDetailsIds[sessionDetailsIndex] || null
  const sessionDetailsSession = sessionDetailsSessionId ? sessionById.get(sessionDetailsSessionId) : null

  useEffect(() => {
    const targetSessionId = typeof router.query.assignmentSessionId === 'string' ? router.query.assignmentSessionId : ''
    const targetAssignmentId = typeof router.query.assignmentId === 'string' ? router.query.assignmentId : ''
    const targetSubmissionUserId = typeof router.query.submissionUserId === 'string' ? router.query.submissionUserId : ''
    if (!targetSessionId || !targetAssignmentId) return

    const alreadyOpen =
      assignmentOverlayOpen &&
      selectedAssignmentId === targetAssignmentId &&
      sessionDetailsSessionId === targetSessionId &&
      (!targetSubmissionUserId || (adminSubmissionOverlayOpen && adminSelectedSubmissionUserId === targetSubmissionUserId))

    if (!alreadyOpen) {
      openSessionDetails([targetSessionId], 0, 'assignments')
      setSelectedAssignmentId(targetAssignmentId)
      setSelectedAssignmentQuestionId(null)
      setAssignmentQuestionOverlayOpen(false)
      setAssignmentOverlayOpen(true)
      fetchAssignmentDetails(targetSessionId, targetAssignmentId)
      void fetchAssignmentResponses(targetSessionId, targetAssignmentId)
      void fetchAssignmentGrade(targetSessionId, targetAssignmentId)
      if (targetSubmissionUserId) {
        setAdminSelectedSubmissionUserId(targetSubmissionUserId)
        setAdminSubmissionOverlayOpen(true)
        void fetchAdminSubmissionDetail(targetSessionId, targetAssignmentId, targetSubmissionUserId)
      }
    }

    const nextQuery: Record<string, any> = { ...router.query }
    delete nextQuery.assignmentSessionId
    delete nextQuery.assignmentId
    delete nextQuery.submissionUserId
    void router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true })
  }, [
    router,
    router.query,
    router.pathname,
    assignmentOverlayOpen,
    selectedAssignmentId,
    sessionDetailsSessionId,
    adminSubmissionOverlayOpen,
    adminSelectedSubmissionUserId,
    openSessionDetails,
    fetchAssignmentDetails,
    fetchAdminSubmissionDetail,
  ])

  const safeParseJsonObject = (raw: string) => {
    const trimmed = (raw || '').trim()
    if (!trimmed) throw new Error('JSON is empty')
    let parsed: any
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error('Invalid JSON')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON must be an object')
    return parsed
  }

  const fetchLessonScriptTemplates = useCallback(async () => {
    setLessonScriptTemplatesLoading(true)
    setLessonScriptTemplatesError(null)
    try {
      const q = selectedGrade ? `?grade=${encodeURIComponent(selectedGrade)}` : ''
      const res = await fetch(`/api/lesson-scripts/templates${q}`, { credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setLessonScriptTemplates([])
        setLessonScriptTemplatesError(data?.message || `Failed to load templates (${res.status})`)
        return
      }
      const templates = Array.isArray(data?.templates) ? data.templates : []
      setLessonScriptTemplates(templates)
    } catch (err: any) {
      setLessonScriptTemplates([])
      setLessonScriptTemplatesError(err?.message || 'Network error')
    } finally {
      setLessonScriptTemplatesLoading(false)
    }
  }, [selectedGrade])

  const fetchLessonScriptVersions = useCallback(async (templateId: string) => {
    const safeId = String(templateId || '').trim()
    if (!safeId) {
      setLessonScriptVersions([])
      setLessonScriptVersionsError(null)
      return
    }
    setLessonScriptVersionsLoading(true)
    setLessonScriptVersionsError(null)
    try {
      const res = await fetch(`/api/lesson-scripts/templates/${encodeURIComponent(safeId)}/versions`, { credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setLessonScriptVersions([])
        setLessonScriptVersionsError(data?.message || `Failed to load versions (${res.status})`)
        return
      }
      setLessonScriptVersions(Array.isArray(data?.versions) ? data.versions : [])
    } catch (err: any) {
      setLessonScriptVersions([])
      setLessonScriptVersionsError(err?.message || 'Network error')
    } finally {
      setLessonScriptVersionsLoading(false)
    }
  }, [])

  const fetchResolvedLessonScript = useCallback(async (sessionId: string) => {
    const safeSessionId = String(sessionId || '').trim()
    if (!safeSessionId) return
    setLessonScriptLoading(true)
    setLessonScriptError(null)
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(safeSessionId)}/lesson-script`, { credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setLessonScriptResolved(null)
        setLessonScriptAssignment(null)
        setLessonScriptSource('none')
        setLessonScriptError(data?.message || `Failed to load lesson script (${res.status})`)
        return
      }

      setLessonScriptResolved(data?.resolved ?? null)
      setLessonScriptAssignment(data?.assignment ?? null)
      setLessonScriptSource(typeof data?.source === 'string' ? data.source : 'none')

      // Initialize form defaults once per session selection.
      if (lessonScriptLastLoadedSessionIdRef.current !== safeSessionId) {
        lessonScriptLastLoadedSessionIdRef.current = safeSessionId
        const assignment = data?.assignment ?? null
        const templateId = assignment?.templateId ? String(assignment.templateId) : ''
        const versionId = assignment?.templateVersionId ? String(assignment.templateVersionId) : ''
        setLessonScriptSelectedTemplateId(templateId)
        setLessonScriptSelectedVersionId(versionId)
        if (assignment?.overrideContent) {
          try {
            setLessonScriptOverrideText(JSON.stringify(assignment.overrideContent, null, 2))
          } catch {
            setLessonScriptOverrideText('')
          }
        } else {
          setLessonScriptOverrideText('')
        }
      }
    } catch (err: any) {
      setLessonScriptResolved(null)
      setLessonScriptAssignment(null)
      setLessonScriptSource('none')
      setLessonScriptError(err?.message || 'Network error')
    } finally {
      setLessonScriptLoading(false)
    }
  }, [])

  const saveLessonScriptAssignment = useCallback(async (sessionId: string, payload: { templateId: string | null; templateVersionId: string | null; overrideContent?: any }) => {
    const safeSessionId = String(sessionId || '').trim()
    if (!safeSessionId) return
    setLessonScriptSaving(true)
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(safeSessionId)}/lesson-script`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data?.message || `Failed to save (${res.status})`)
        return
      }
      await fetchResolvedLessonScript(safeSessionId)
      await fetchLessonScriptTemplates()
    } catch (err: any) {
      alert(err?.message || 'Network error')
    } finally {
      setLessonScriptSaving(false)
    }
  }, [fetchLessonScriptTemplates, fetchResolvedLessonScript])

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
    if (sessionDetailsTab === 'assignments') {
      fetchAssignments(sessionDetailsSessionId)
    }
    if (sessionDetailsTab === 'responses') {
      fetchMyResponses(sessionDetailsSessionId)
    }
  }, [sessionDetailsOpen, sessionDetailsView, sessionDetailsSessionId, sessionDetailsTab])

  useEffect(() => {
    if (!lessonScriptSelectedTemplateId) {
      setLessonScriptVersions([])
      setLessonScriptVersionsError(null)
      return
    }
    fetchLessonScriptVersions(lessonScriptSelectedTemplateId)
  }, [fetchLessonScriptVersions, lessonScriptSelectedTemplateId])

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

  async function markUserVerified(userId: string) {
    if (!userId) return
    setUserDetailLoading(true)
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipVerification: true })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to verify (${res.status})`)
      setUsers(prev => prev ? prev.map(u => u.id === userId ? { ...u, emailVerifiedAt: data.emailVerifiedAt || new Date().toISOString() } : u) : prev)
      setSelectedUserDetail(prev => prev && prev.id === userId ? { ...prev, emailVerifiedAt: data.emailVerifiedAt || new Date().toISOString() } : prev)
    } catch (err: any) {
      alert(err?.message || 'Failed to verify user')
    } finally {
      setUserDetailLoading(false)
    }
  }

  async function markAllUsersVerified() {
    const safeUsers = Array.isArray(users) ? users : []
    const targets = safeUsers
      .filter(u => !u?.emailVerifiedAt)
      .map(u => String(u?.id || ''))
      .filter(Boolean)

    if (targets.length === 0) {
      alert('All users are already verified.')
      return
    }

    if (!confirm(`Skip verification for ${targets.length} users?`)) return

    setBulkVerifyLoading(true)
    try {
      const results = await Promise.allSettled(targets.map(async (userId) => {
        const res = await fetch(`/api/users/${encodeURIComponent(userId)}`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skipVerification: true })
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data?.message || `Failed to verify (${res.status})`)
        }
        return res.json().catch(() => ({}))
      }))

      const failed = results.filter(r => r.status === 'rejected').length
      const nowIso = new Date().toISOString()

      setUsers(prev => prev
        ? prev.map(u => targets.includes(String(u.id)) ? { ...u, emailVerifiedAt: u.emailVerifiedAt || nowIso } : u)
        : prev
      )

      if (failed > 0) {
        alert(`Completed with ${failed} failures.`)
      } else {
        alert('All users verified.')
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to verify users')
    } finally {
      setBulkVerifyLoading(false)
    }
  }

  async function generateTempPassword(userId: string) {
    if (!userId) return
    setUserDetailLoading(true)
    setUserTempPassword(null)
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetPassword: true })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to reset password (${res.status})`)
      setUserTempPassword(data?.tempPassword || null)
    } catch (err: any) {
      alert(err?.message || 'Failed to generate password')
    } finally {
      setUserDetailLoading(false)
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
    fetchLiveSelectionForGrade(selectedGrade)
  }, [gradeReady, selectedGrade])

  useEffect(() => {
    if (!sessions || sessions.length === 0) return
    // If an admin has selected a past session override, it becomes the current lesson and
    // takes precedence until unselected.
    if (liveOverrideSessionId && resolvedLiveSessionId) {
      if (String(activeSessionId || '') !== String(resolvedLiveSessionId)) {
        setActiveSessionId(String(resolvedLiveSessionId))
      }
      return
    }

    // If no active session is selected yet, default to the resolved live session.
    if (!activeSessionId && resolvedLiveSessionId) {
      setActiveSessionId(String(resolvedLiveSessionId))
      return
    }
    // If selected session no longer exists, fall back.
    if (activeSessionId && !sessionById.has(String(activeSessionId)) && resolvedLiveSessionId) {
      setActiveSessionId(String(resolvedLiveSessionId))
    }
  }, [sessions, activeSessionId, resolvedLiveSessionId, sessionById, liveOverrideSessionId])

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


  // Session-scoped: live overlay opens only when a session is joined.

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
    // Default to a 60 minute session.
    const end = new Date(now)
    end.setMinutes(end.getMinutes() + 60)
    const endLocal = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`
    setEndsAt(endLocal)
    setMinEndsAt(local)
  }, [])

  useEffect(() => {
    if (!startsAt) return
    // Keep the end time sensible when start time changes.
    setMinEndsAt(startsAt)
    try {
      const startMs = new Date(startsAt).getTime()
      const endMs = endsAt ? new Date(endsAt).getTime() : 0
      if (!endMs || Number.isNaN(endMs) || endMs <= startMs) {
        const end = new Date(startMs)
        end.setMinutes(end.getMinutes() + 60)
        const pad = (n: number) => n.toString().padStart(2, '0')
        const endLocal = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`
        setEndsAt(endLocal)
      }
    } catch {
      // ignore
    }
  }, [startsAt])
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

  const renderAccountSnapshotBody = () => (
    <>
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
      <div className="flex flex-col sm:flex-row items-start gap-2">
        <Link href="/profile" className="btn btn-ghost">Update profile</Link>
        <Link href="/subscribe" className="btn btn-primary">Manage subscription</Link>
      </div>
    </>
  )

  const renderAccountSnapshotCard = () => (
    <div className="card dashboard-card space-y-3">
      <h2 className="text-lg font-semibold">Account snapshot</h2>
      {renderAccountSnapshotBody()}
    </div>
  )

  const renderOverviewCards = (options?: { hideGradeWorkspace?: boolean }) => {
    const showGradeWorkspace = !options?.hideGradeWorkspace
    if (!showGradeWorkspace) {
      return (
        <div className="space-y-6">
          <div className="card dashboard-card">
            <button
              type="button"
              className="w-full flex items-center justify-between gap-3 text-left"
              onClick={() => {
                setAccountSnapshotOverlayOpen(true)
                setDashboardSectionOverlay(null)
                setActiveSection('overview')
              }}
            >
              <span className="text-lg font-semibold">Account snapshot</span>
              <span className="text-sm muted">Open</span>
            </button>
          </div>

          {status === 'authenticated' && (
            <div className="card dashboard-card">
              <button
                type="button"
                className="w-full flex items-center justify-between gap-3 text-left"
                onClick={() => setCreateOverlayOpen(true)}
              >
                <span className="text-lg font-semibold">Create</span>
                <span className="text-sm muted">Open</span>
              </button>
            </div>
          )}

          {status === 'authenticated' && (
            <div className="card dashboard-card">
              <Link href="/resource-bank" className="w-full flex items-center justify-between gap-3 text-left">
                <span className="text-lg font-semibold">Resource Bank</span>
                <span className="text-sm muted">Open</span>
              </Link>
            </div>
          )}

        </div>
      )
    }
    return (
      <div className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-2">
          {renderGradeWorkspaceCard()}
          <div className="card dashboard-card">
            <button
              type="button"
              className="w-full flex items-center justify-between gap-3 text-left"
              onClick={() => {
                setAccountSnapshotOverlayOpen(true)
                setDashboardSectionOverlay(null)
                setActiveSection('overview')
              }}
            >
              <span className="text-lg font-semibold">Account snapshot</span>
              <span className="text-sm muted">Open</span>
            </button>
          </div>
        </div>

        {status === 'authenticated' && (
          <div className="card dashboard-card">
            <button
              type="button"
              className="w-full flex items-center justify-between gap-3 text-left"
              onClick={() => setCreateOverlayOpen(true)}
            >
              <span className="text-lg font-semibold">Create</span>
              <span className="text-sm muted">Open</span>
            </button>
          </div>
        )}

        {status === 'authenticated' && (
          <div className="card dashboard-card">
            <Link href="/resource-bank" className="w-full flex items-center justify-between gap-3 text-left">
              <span className="text-lg font-semibold">Resource Bank</span>
              <span className="text-sm muted">Open</span>
            </Link>
          </div>
        )}

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
          </div>
          <div className="text-sm muted">{liveStatusMessage()}</div>
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
    const canAuthorLessonModules = canCreateSession

    const nowMs = Date.now()
    const getStartMs = (s: any) => (s?.startsAt ? new Date(s.startsAt).getTime() : 0)
    const getEndMs = (s: any) => {
      if (s?.endsAt) return new Date(s.endsAt).getTime()
      const startMs = getStartMs(s)
      return startMs ? startMs + 60 * 60 * 1000 : 0
    }
    const isCurrentWindow = (s: any) => {
      const startMs = getStartMs(s)
      const endMs = getEndMs(s)
      return Boolean(startMs && endMs && startMs <= nowMs && nowMs <= endMs)
    }

    const sortedSessions = [...(sessions || [])].sort((a, b) => getStartMs(a) - getStartMs(b))
    const currentSessions = sortedSessions.filter(s => isCurrentWindow(s))
    const scheduledSessions = sortedSessions.filter(s => getStartMs(s) > nowMs)
    const pastSessions = sortedSessions
      .filter(s => getEndMs(s) < nowMs)
      .sort((a, b) => getStartMs(b) - getStartMs(a))
    const pastSessionIds = pastSessions.map(s => String(s.id)).filter(Boolean)

    const defaultCurrentSessionId = currentSessions.length
      ? String([...currentSessions].sort((a, b) => getStartMs(b) - getStartMs(a))[0].id)
      : null

    const resolvedCurrentLessonId =
      (resolvedLiveSessionId && sessionById.has(String(resolvedLiveSessionId)) ? String(resolvedLiveSessionId) : null) ??
      (defaultCurrentSessionId && sessionById.has(String(defaultCurrentSessionId)) ? String(defaultCurrentSessionId) : null)

    const resolvedCurrentLesson = resolvedCurrentLessonId ? sessionById.get(resolvedCurrentLessonId) : null

    return (
      <div className="space-y-6">
        <div className="card space-y-3">
          <h2 className="text-lg font-semibold text-center">Current lesson — {activeGradeLabel}</h2>
          {sessionsError ? (
            <div className="text-sm text-red-600">{sessionsError}</div>
          ) : sortedSessions.length === 0 ? (
            <div className="text-sm muted">No sessions scheduled for this grade yet.</div>
          ) : resolvedCurrentLesson ? (
            <div className="p-3 border rounded space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium leading-snug break-words">{resolvedCurrentLesson.title}</div>
                    {resolvedCurrentLesson.startsAt ? (
                      <div className="text-xs muted">
                        {formatSessionRange(resolvedCurrentLesson.startsAt, (resolvedCurrentLesson as any).endsAt || resolvedCurrentLesson.startsAt)}
                      </div>
                    ) : null}
                  </div>
                  {liveOverrideSessionId ? (
                    null
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-4">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => showCanvasWindow(String(resolvedCurrentLesson.id), { quizMode: false })}
                    disabled={!canLaunchCanvasOverlay || isSubscriptionBlocked}
                  >
                    Enter class
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => openEditSession(String(resolvedCurrentLesson.id))}
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-sm font-semibold text-white/70 hover:text-white disabled:opacity-50"
                    onClick={() => openSessionDetails([String(resolvedCurrentLesson.id)], 0, 'responses')}
                    disabled={!canLaunchCanvasOverlay || isSubscriptionBlocked}
                  >
                    Quizzes
                  </button>
                  <button
                    type="button"
                    className="text-sm font-semibold text-white/70 hover:text-white disabled:opacity-50"
                    onClick={() => openSessionDetails([String(resolvedCurrentLesson.id)], 0, 'assignments')}
                    disabled={isSubscriptionBlocked}
                  >
                    Assignments
                  </button>
                </div>
              </div>
            </div>
          ) : currentSessions.length === 0 ? (
            <div className="text-sm muted">No current session right now (outside all scheduled time windows).</div>
          ) : (
            <ul className="space-y-3">
              {currentSessions.map(s => (
                <li key={s.id} className="p-3 border rounded">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium leading-snug break-words">{s.title}</div>
                        <div className="text-xs muted">
                          {formatSessionRange(s.startsAt, s.endsAt || s.startsAt)}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-4">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => showCanvasWindow(s.id, { quizMode: false })}
                        disabled={!canLaunchCanvasOverlay || isSubscriptionBlocked}
                      >
                        Enter class
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => openEditSession(String(s.id))}
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-sm font-semibold text-white/70 hover:text-white disabled:opacity-50"
                        onClick={() => openSessionDetails([String(s.id)], 0, 'responses')}
                        disabled={!canLaunchCanvasOverlay || isSubscriptionBlocked}
                      >
                        Quizzes
                      </button>
                      <button
                        type="button"
                        className="text-sm font-semibold text-white/70 hover:text-white disabled:opacity-50"
                        onClick={() => openSessionDetails([String(s.id)], 0, 'assignments')}
                        disabled={isSubscriptionBlocked}
                      >
                        Assignments
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {canCreateSession && (
          <>
            <div className="card">
              <button
                type="button"
                className="w-full flex items-center justify-between gap-3 text-left"
                onClick={() => {
                  setEditingSessionId(null)
                  setCreateLessonOverlayOpen(true)
                }}
              >
                <span className="text-lg font-semibold">Create lesson</span>
                <span className="text-sm muted">Open</span>
              </button>
            </div>

            {createLessonOverlayOpen && (
              <OverlayPortal>
                <FullScreenGlassOverlay
                  title={editingSessionId ? 'Edit lesson' : 'Create lesson'}
                  subtitle={
                    editingSessionId
                      ? `Update the session for ${activeGradeLabel} learners.`
                      : `Create a session for ${activeGradeLabel} learners.`
                  }
                  onClose={() => {
                    setCreateLessonOverlayOpen(false)
                    setEditingSessionId(null)
                  }}
                  zIndexClassName="z-50"
                >
                  <div className="space-y-3">
                    {!selectedGrade ? (
                      <div className="text-sm muted">Select a grade before creating a session.</div>
                    ) : (
                      <form onSubmit={createSession} className="space-y-3">
                        <p className="text-sm muted">This session will be visible only to {activeGradeLabel} learners.</p>
                        <input className="input" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
                        <input className="input" placeholder="Join URL (Teams, Padlet, Zoom)" value={joinUrl} onChange={e => setJoinUrl(e.target.value)} />
                        <input className="input" type="datetime-local" value={startsAt} min={minStartsAt} step={60} onChange={e => setStartsAt(e.target.value)} />
                        <input className="input" type="datetime-local" value={endsAt} min={minEndsAt} step={60} onChange={e => setEndsAt(e.target.value)} />

                        <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold">Lesson thumbnail — optional</p>
                            <div className="flex items-center gap-2">
                              <input
                                ref={sessionThumbnailInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={async (e) => {
                                  const file = e.currentTarget.files?.[0]
                                  if (!file) return
                                  const url = await uploadSessionThumbnail(file)
                                  if (url) setSessionThumbnailUrlDraft(url)
                                  e.currentTarget.value = ''
                                }}
                              />
                              <button
                                type="button"
                                className="btn btn-ghost text-xs"
                                onClick={() => sessionThumbnailInputRef.current?.click()}
                                disabled={sessionThumbnailUploading}
                              >
                                {sessionThumbnailUploading ? 'Uploading…' : 'Upload'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost text-xs"
                                onClick={() => setSessionThumbnailUrlDraft(null)}
                                disabled={!sessionThumbnailUrlDraft}
                              >
                                Clear
                              </button>
                            </div>
                          </div>

                          {sessionThumbnailUrlDraft ? (
                            <div className="space-y-2">
                              <div className="text-xs muted break-all">{sessionThumbnailUrlDraft}</div>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={sessionThumbnailUrlDraft}
                                alt="Thumbnail preview"
                                className="w-full max-h-48 object-cover rounded-xl border border-white/10"
                              />
                            </div>
                          ) : (
                            <div className="text-xs muted">No thumbnail uploaded.</div>
                          )}
                        </div>

                            <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-3">
                              <p className="text-sm font-semibold">Lesson script (5E) — optional</p>
                              <p className="text-xs muted">Phases contain Points. Each Point can include up to 3 modules: Text, Diagram, LaTeX. Leave a module blank to omit it.</p>

                              {([
                                { key: 'engage', label: 'Engage' },
                                { key: 'explore', label: 'Explore' },
                                { key: 'explain', label: 'Explain' },
                                { key: 'elaborate', label: 'Elaborate' },
                                { key: 'evaluate', label: 'Evaluate' },
                              ] as Array<{ key: LessonPhaseKey; label: string }>).map(phase => (
                                <div key={phase.key} className="space-y-2">
                                  <p className="text-sm font-medium">{phase.label}</p>

                                  {(lessonScriptDraft[phase.key] || []).length === 0 ? (
                                    <div className="text-xs muted">No points yet.</div>
                                  ) : null}

                                  {(lessonScriptDraft[phase.key] || []).map((point, pointIndex) => (
                                    <div key={point.id} className="rounded-md border border-white/10 bg-white/5 p-2 space-y-2">
                                      <div className="flex items-center justify-between gap-2">
                                        <p className="text-xs font-semibold">Point {pointIndex + 1}</p>
                                        <button
                                          type="button"
                                          className="btn btn-ghost"
                                          onClick={() => {
                                            setLessonScriptDraft(prev => ({
                                              ...prev,
                                              [phase.key]: (prev[phase.key] || []).filter(p => p.id !== point.id),
                                            }))
                                          }}
                                        >
                                          Delete
                                        </button>
                                      </div>
                                      <input
                                        className="input"
                                        placeholder="Point title (optional)"
                                        value={point.title}
                                        onChange={e => {
                                          const value = e.target.value
                                          setLessonScriptDraft(prev => ({
                                            ...prev,
                                            [phase.key]: (prev[phase.key] || []).map(p => (p.id === point.id ? { ...p, title: value } : p)),
                                          }))
                                        }}
                                      />
                                      <textarea
                                        className="input min-h-[80px]"
                                        placeholder="Text module (headings, prompts, explanations)"
                                        value={point.text}
                                        onChange={e => {
                                          const value = e.target.value
                                          setLessonScriptDraft(prev => ({
                                            ...prev,
                                            [phase.key]: (prev[phase.key] || []).map(p => (p.id === point.id ? { ...p, text: value } : p)),
                                          }))
                                        }}
                                      />

                                      <div className="rounded-md border border-white/10 bg-white/5 p-2 space-y-2">
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="text-xs font-semibold">Diagram module</div>
                                          <div className="flex items-center gap-2">
                                            <button
                                              type="button"
                                              className="btn btn-ghost"
                                              onClick={() => {
                                                if (!canAuthorLessonModules) return
                                                if (typeof window !== 'undefined') {
                                                  persistLessonScriptDraftToStorage(lessonScriptDraft)
                                                }
                                                openDiagramPickerForPoint(phase.key, point.id)
                                              }}
                                              disabled={!canAuthorLessonModules || diagramUploading}
                                            >
                                              {diagramUploading && diagramUploadTarget?.pointId === point.id ? 'Uploading…' : 'Open diagram module'}
                                            </button>
                                            <button
                                              type="button"
                                              className="btn btn-ghost"
                                              onClick={() => {
                                                setLessonScriptDraft(prev => ({
                                                  ...prev,
                                                  [phase.key]: (prev[phase.key] || []).map(p => (p.id === point.id ? { ...p, diagramSnapshot: null } : p)),
                                                }))
                                              }}
                                              disabled={!point.diagramSnapshot}
                                            >
                                              Clear
                                            </button>
                                          </div>
                                        </div>
                                        <div className="text-xs muted">
                                          {point.diagramSnapshot ? `Saved: ${point.diagramSnapshot.title}` : 'No diagram saved to this point yet.'}
                                        </div>
                                      </div>

                                      <div className="rounded-md border border-white/10 bg-white/5 p-2 space-y-2">
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="text-xs font-semibold">LaTeX module</div>
                                          <div className="flex items-center gap-2">
                                            <button
                                              type="button"
                                              className="btn btn-ghost"
                                              onClick={() => {
                                                if (typeof window !== 'undefined') {
                                                  persistLessonScriptDraftToStorage(lessonScriptDraft)
                                                }
                                                showLessonAuthoringCanvasWindow({ phaseKey: phase.key, pointId: point.id })
                                              }}
                                              disabled={!canAuthorLessonModules}
                                            >
                                              Open canvas
                                            </button>
                                            <button
                                              type="button"
                                              className="btn btn-ghost"
                                              onClick={() => {
                                                setLessonScriptDraft(prev => ({
                                                  ...prev,
                                                  [phase.key]: (prev[phase.key] || []).map(p => (p.id === point.id ? { ...p, latex: '', latexHistory: [] } : p)),
                                                }))
                                              }}
                                              disabled={!point.latex}
                                            >
                                              Clear
                                            </button>
                                          </div>
                                        </div>
                                        <div className="text-xs muted">
                                          {point.latex ? `Saved: ${(point.latex || '').slice(0, 80)}${point.latex.length > 80 ? '…' : ''}` : 'No LaTeX saved to this point yet.'}
                                        </div>
                                      </div>
                                    </div>
                                  ))}

                                  <button
                                    type="button"
                                    className="btn"
                                    onClick={() => {
                                      setLessonScriptDraft(prev => ({
                                        ...prev,
                                        [phase.key]: [...(prev[phase.key] || []), newPointDraft()],
                                      }))
                                    }}
                                  >
                                    Add point
                                  </button>
                                </div>
                              ))}
                            </div>

                        <div>
                          <button className="btn btn-primary" type="submit">
                            {editingSessionId ? 'Save changes' : 'Create'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </FullScreenGlassOverlay>
              </OverlayPortal>
            )}
          </>
        )}

        {/* Lesson authoring should mirror delivery: use the same canvas overlay experience. */}

        {isAdmin && selectedGrade && (
          <>
            <div className="card">
              <button
                type="button"
                className="w-full flex items-center justify-between gap-3 text-left"
                onClick={() => setLiveLessonSelectorOverlayOpen(true)}
              >
                <span className="text-lg font-semibold">Live lesson selector</span>
                <span className="text-sm muted">Open</span>
              </button>
            </div>

            {liveLessonSelectorOverlayOpen && (
              <OverlayPortal>
                <FullScreenGlassOverlay
                  title="Live lesson selector"
                  subtitle="Override the automatically resolved live lesson."
                  onClose={() => setLiveLessonSelectorOverlayOpen(false)}
                  zIndexClassName="z-50"
                >
                  <div className="space-y-3">
                    <p className="text-sm muted">
                      Current lessons are determined by the scheduled timeframe. By default, the current lesson is live.
                      You can override by selecting a past session.
                    </p>
                    <div className="space-y-2">
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name="live-session"
                              checked={!liveOverrideSessionId}
                              onChange={async () => {
                                setLiveOverrideSessionId(null)
                                setLiveSelectionBusy(true)
                                try {
                                  await fetch(`/api/sessions/live?grade=${encodeURIComponent(selectedGrade)}`, {
                                    method: 'PUT',
                                    credentials: 'same-origin',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ grade: selectedGrade, overrideSessionId: '' }),
                                  })
                                  await fetchLiveSelectionForGrade(selectedGrade)
                                } finally {
                                  setLiveSelectionBusy(false)
                                }
                              }}
                              disabled={liveSelectionBusy}
                            />
                            <span>Auto (use the current lesson in its timeframe)</span>
                          </label>
                          {pastSessions.length === 0 ? (
                            <div className="text-sm muted">No past sessions to override yet.</div>
                          ) : (
                            <div className="space-y-2">
                              {pastSessions.slice(0, 8).map(s => (
                                <label key={s.id} className="flex items-start gap-2 text-sm">
                                  <input
                                    type="radio"
                                    name="live-session"
                                    checked={liveOverrideSessionId === String(s.id)}
                                    onChange={async () => {
                                      const nextOverrideId = String(s.id)
                                      setLiveOverrideSessionId(nextOverrideId)
                                      setResolvedLiveSessionId(nextOverrideId)
                                      setLiveSelectionBusy(true)
                                      try {
                                        const res = await fetch(`/api/sessions/live?grade=${encodeURIComponent(selectedGrade)}`, {
                                          method: 'PUT',
                                          credentials: 'same-origin',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ grade: selectedGrade, overrideSessionId: nextOverrideId }),
                                        })
                                        if (!res.ok) {
                                          const data = await res.json().catch(() => ({}))
                                          alert(data?.message || `Failed to set live session (${res.status})`)
                                        }
                                        await fetchLiveSelectionForGrade(selectedGrade)
                                      } finally {
                                        setLiveSelectionBusy(false)
                                      }
                                    }}
                                    disabled={liveSelectionBusy}
                                  />
                                    <span className="min-w-0">
                                    <span className="font-medium break-words">{s.title}</span>
                                    <span className="text-xs muted">{formatSessionRange(s.startsAt, s.endsAt || s.startsAt)}</span>
                                  </span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="text-sm">
                          <span className="font-medium">Resolved live session:</span>{' '}
                          {resolvedLiveSessionId && sessionById.get(resolvedLiveSessionId)
                            ? sessionById.get(resolvedLiveSessionId).title
                            : defaultCurrentSessionId && sessionById.get(defaultCurrentSessionId)
                            ? sessionById.get(defaultCurrentSessionId).title
                            : 'None'}
                        </div>
                  </div>
                </FullScreenGlassOverlay>
              </OverlayPortal>
            )}
          </>
        )}

        <div className="card space-y-3">
          <h2 className="text-lg font-semibold text-center">Scheduled lesson — {activeGradeLabel}</h2>
          {isAdmin && (
            <div className="p-3 border border-white/10 rounded bg-white/5 space-y-2">
              <div className="font-medium">Subscription gating</div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={effectiveSubscriptionGatingEnabled}
                  disabled={subscriptionGatingSaving || subscriptionGatingEnabled === null}
                  onChange={(e) => updateSubscriptionGating(e.target.checked)}
                />
                <span>Require an active subscription for learners to join sessions and view assignments</span>
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
            <div className="p-3 border border-white/10 rounded bg-white/5">
              <div className="font-medium">Subscription required</div>
              <div className="text-sm muted">Subscribe to join sessions and access assignments.</div>
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
                  className="btn btn-ghost justify-center"
                  onClick={() => openPastSessionsList(pastSessionIds)}
                  disabled={isSubscriptionBlocked}
                >
                  Browse past sessions
                </button>
              )}
              <ul className="space-y-3">
              {scheduledSessions.length === 0 ? (
                <li className="p-3 border rounded">
                  <div className="text-sm muted">No upcoming sessions right now.</div>
                </li>
              ) : scheduledSessions.map(s => (
                <li key={s.id} className="p-3 border rounded">
                  {isMobile ? (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <div className="font-medium leading-snug break-words">{s.title}</div>
                        <div className="text-xs muted">{formatSessionRange(s.startsAt, s.endsAt || s.startsAt)}</div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          className={`btn justify-center justify-self-start ${canCreateSession ? '' : 'btn-primary'}`}
                          onClick={() => openLiveForSession(s.id)}
                          disabled={isSubscriptionBlocked}
                        >
                          Open class
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            className="btn justify-center justify-self-start"
                            onClick={() => openEditSession(String(s.id))}
                          >
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn justify-center justify-self-start"
                          onClick={() => showCanvasWindow(s.id)}
                          disabled={!canLaunchCanvasOverlay || isSubscriptionBlocked}
                        >
                          Canvas
                        </button>
                        <a
                          href={s.joinUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={`justify-self-start text-sm font-semibold text-white/70 hover:text-white ${isSubscriptionBlocked ? ' pointer-events-none opacity-50' : ''}`}
                        >
                          Link
                        </a>
                        <button
                          type="button"
                          className="justify-self-start text-sm font-semibold text-white/70 hover:text-white disabled:opacity-50"
                          onClick={() => openSessionDetails([String(s.id)], 0, 'assignments')}
                          disabled={isSubscriptionBlocked}
                        >
                          Assignments
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium">{s.title}</div>
                          <div className="text-sm muted">{formatSessionDate(s.startsAt)}</div>
                        </div>
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
                        {isAdmin && (
                          <button
                            type="button"
                            className="btn"
                            onClick={() => openEditSession(String(s.id))}
                          >
                            Edit
                          </button>
                        )}
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
                          className={`text-sm font-semibold text-white/70 hover:text-white ${isSubscriptionBlocked ? ' pointer-events-none opacity-50' : ''}`}
                        >
                          Link
                        </a>
                        <button
                          type="button"
                          className="text-sm font-semibold text-white/70 hover:text-white disabled:opacity-50"
                          onClick={() => openSessionDetails([String(s.id)], 0, 'assignments')}
                          disabled={isSubscriptionBlocked}
                        >
                          Assignments
                        </button>
                        {(() => {
                          const isOwner = viewerId && String(s?.createdBy || '') === String(viewerId)
                          const canManage = (sessionRole === 'admin' || sessionRole === 'teacher') && isOwner
                          if (!canManage) return null
                          return (
                            <TaskManageMenu
                              actions={[
                                {
                                  label: 'Manage assignments',
                                  onClick: () => openSessionDetails([String(s.id)], 0, 'assignments'),
                                },
                                {
                                  label: 'Manage quizzes',
                                  onClick: () => openSessionDetails([String(s.id)], 0, 'responses'),
                                },
                              ]}
                            />
                          )
                        })()}
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
          <OverlayPortal>
            <FullScreenGlassOverlay
              title={
                sessionDetailsView === 'pastList'
                  ? `Past sessions — ${activeGradeLabel}`
                  : (sessionDetailsSession?.title || 'Session details')
              }
              subtitle={
                sessionDetailsView === 'pastList'
                  ? 'Tap a session to view assignments.'
                  : (sessionDetailsSession?.startsAt
                    ? formatSessionRange(
                      sessionDetailsSession.startsAt,
                      (sessionDetailsSession as any).endsAt || sessionDetailsSession.startsAt
                    )
                    : undefined)
              }
              onClose={closeSessionDetails}
              onBackdropClick={closeSessionDetails}
              zIndexClassName="z-50"
              className={`transition-opacity duration-200 ${sessionDetailsHiddenByChildOverlay ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
              leftActions={
                sessionDetailsView !== 'pastList' && sessionDetailsIds.length > 1 ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setSessionDetailsView('pastList')}
                  >
                    Back
                  </button>
                ) : null
              }
            >
              {sessionDetailsView === 'pastList' ? (
                <ul className="border border-white/10 rounded divide-y divide-white/10 overflow-hidden">
                  {sessionDetailsIds.map((id, idx) => {
                    const s = sessionById.get(id)
                    return (
                      <li key={id}>
                        <div className="flex items-center justify-between gap-3 p-3">
                          <button
                            type="button"
                            className="text-left flex-1"
                            onClick={() => {
                              setSessionDetailsIndex(idx)
                              setSessionDetailsView('details')
                              setSessionDetailsTab('assignments')
                            }}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="font-medium break-words">{s?.title || 'Session'}</div>
                              {s?.startsAt && (
                                <div className="text-sm muted">
                                  {formatSessionRange(s.startsAt, (s as any).endsAt || s.startsAt)}
                                </div>
                              )}
                            </div>
                          </button>
                          {isAdmin && s?.id && (
                            <button
                              type="button"
                              className="btn btn-ghost text-xs"
                              onClick={() => openEditSession(String(s.id))}
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <>
                  {canManageSessionThumbnails && sessionDetailsSessionId && sessionDetailsSession ? (
                    <div className="mb-3 rounded-2xl border border-white/10 bg-white/5 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">Lesson thumbnail</div>
                        <div className="flex items-center gap-2">
                          <input
                            ref={updateSessionThumbnailInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.currentTarget.files?.[0]
                              if (!file) return
                              const currentId = updatingSessionThumbnailId || sessionDetailsSessionId
                              if (!currentId) return
                              const url = await uploadSessionThumbnail(file)
                              if (url) await updateSessionThumbnail(currentId, url)
                              setUpdatingSessionThumbnailId(null)
                              e.currentTarget.value = ''
                            }}
                          />
                          <button
                            type="button"
                            className="btn btn-ghost text-xs"
                            onClick={() => {
                              setUpdatingSessionThumbnailId(sessionDetailsSessionId)
                              updateSessionThumbnailInputRef.current?.click()
                            }}
                            disabled={updatingSessionThumbnailBusy}
                          >
                            {updatingSessionThumbnailBusy ? 'Updating…' : 'Upload / Update'}
                          </button>
                        </div>
                      </div>
                      {typeof (sessionDetailsSession as any)?.thumbnailUrl === 'string' && (sessionDetailsSession as any).thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={(sessionDetailsSession as any).thumbnailUrl}
                          alt="Lesson thumbnail"
                          className="w-full max-h-48 object-cover rounded-xl border border-white/10"
                        />
                      ) : (
                        <div className="text-xs muted">No thumbnail.</div>
                      )}
                    </div>
                  ) : null}

                  <div className="mb-3 flex items-center justify-center gap-2">
                    <button
                      type="button"
                      className={sessionDetailsTab === 'assignments' ? 'btn btn-secondary' : 'btn btn-ghost'}
                      onClick={() => {
                        setSessionDetailsTab('assignments')
                        if (expandedSessionId) {
                          fetchAssignments(expandedSessionId)
                          if (selectedAssignmentId) fetchAssignmentDetails(expandedSessionId, selectedAssignmentId)
                        }
                      }}
                      disabled={isSubscriptionBlocked}
                    >
                      Assignments
                    </button>
                    <button
                      type="button"
                      className={sessionDetailsTab === 'responses' ? 'btn btn-secondary' : 'btn btn-ghost'}
                      onClick={() => {
                        setSessionDetailsTab('responses')
                        if (expandedSessionId) fetchMyResponses(expandedSessionId)
                      }}
                      disabled={!canLaunchCanvasOverlay || isSubscriptionBlocked}
                    >
                      Quizzes
                    </button>
                  </div>

                  {sessionDetailsTab === 'assignments' ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-sm">Assignments</div>
                        {expandedSessionId && (
                          <button
                            type="button"
                            className="text-xs font-semibold text-white/70 hover:text-white disabled:opacity-50"
                            onClick={() => {
                              fetchAssignments(expandedSessionId)
                              if (selectedAssignmentId) fetchAssignmentDetails(expandedSessionId, selectedAssignmentId)
                            }}
                            disabled={assignmentsLoading}
                          >
                            {assignmentsLoading ? 'Refreshing…' : 'Refresh'}
                          </button>
                        )}
                      </div>

                      {(() => {
                        const sorted = [...(assignments || [])].sort((a: any, b: any) => {
                          const aT = a?.createdAt ? new Date(a.createdAt).getTime() : 0
                          const bT = b?.createdAt ? new Date(b.createdAt).getTime() : 0
                          return bT - aT
                        })

                        if (assignmentsError) return <div className="text-sm text-red-600">{assignmentsError}</div>
                        if (assignmentsLoading) return <div className="text-sm muted">Loading assignments…</div>
                        if (sorted.length === 0) return <div className="text-sm muted">No assignments yet.</div>

                        return (
                          <div className="space-y-2">
                            <ul className="border border-white/10 rounded divide-y divide-white/10 overflow-hidden">
                              {sorted.map((a: any) => (
                                <li key={a.id} className="p-3 flex items-start justify-between gap-3">
                                  <button
                                    type="button"
                                    className="min-w-0 text-left"
                                    onClick={() => {
                                      if (!expandedSessionId) return
                                      setSelectedAssignmentId(String(a.id))
                                      setSelectedAssignmentQuestionId(null)
                                      setAssignmentQuestionOverlayOpen(false)
                                      setAssignmentOverlayOpen(true)
                                      fetchAssignmentDetails(expandedSessionId, String(a.id))
                                    }}
                                  >
                                    <div className="font-medium break-words">{a.title || 'Assignment'}</div>
                                    <div className="text-xs muted">
                                      {a.createdAt ? new Date(a.createdAt).toLocaleString() : ''}
                                      {typeof a?._count?.questions === 'number' ? ` • ${a._count.questions} questions` : ''}
                                    </div>
                                  </button>
                                  <div className="shrink-0">
                                    {(() => {
                                      const isOwner = viewerId && (String(a?.createdBy || '') === String(viewerId) || String(sessionDetailsSession?.createdBy || '') === String(viewerId))
                                      const canManage = (sessionRole === 'admin' || sessionRole === 'teacher') && isOwner
                                      if (!canManage) {
                                        return (
                                          <button
                                            type="button"
                                            className="btn btn-ghost text-xs"
                                            onClick={() => {
                                              if (!expandedSessionId) return
                                              setSelectedAssignmentId(String(a.id))
                                              setSelectedAssignmentQuestionId(null)
                                              setAssignmentQuestionOverlayOpen(false)
                                              setAssignmentOverlayOpen(true)
                                              fetchAssignmentDetails(expandedSessionId, String(a.id))
                                            }}
                                          >
                                            Manage
                                          </button>
                                        )
                                      }

                                      return (
                                        <TaskManageMenu
                                          actions={[
                                            {
                                              label: 'Open',
                                              onClick: () => {
                                                if (!expandedSessionId) return
                                                setSelectedAssignmentId(String(a.id))
                                                setSelectedAssignmentQuestionId(null)
                                                setAssignmentQuestionOverlayOpen(false)
                                                setAssignmentOverlayOpen(true)
                                                fetchAssignmentDetails(expandedSessionId, String(a.id))
                                              },
                                            },
                                            {
                                              label: 'Edit title',
                                              onClick: () => {
                                                if (!expandedSessionId) return
                                                const nextTitle = window.prompt('New assignment title', a.title || 'Assignment')
                                                if (!nextTitle) return
                                                void updateAssignmentTitle(expandedSessionId, String(a.id), nextTitle)
                                              },
                                            },
                                            {
                                              label: 'Delete',
                                              variant: 'danger',
                                              onClick: () => {
                                                if (!expandedSessionId) return
                                                if (!window.confirm('Delete this assignment? This cannot be undone.')) return
                                                void deleteAssignment(expandedSessionId, String(a.id))
                                              },
                                            },
                                          ]}
                                        />
                                      )
                                    })()}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )
                      })()}

                      {!isLearner && expandedSessionId && (
                        <div className="p-3 border border-white/10 rounded-xl bg-white/5 space-y-2">
                          <div className="font-semibold text-sm">Import assignment (PDF/screenshot)</div>
                          <div className="grid gap-2">
                            <input
                              className="input"
                              placeholder="Optional title"
                              value={assignmentTitle}
                              onChange={e => setAssignmentTitle(e.target.value)}
                            />
                            <input
                              className="input"
                              type="file"
                              accept="application/pdf,image/*"
                              onChange={e => setAssignmentFile(e.target.files?.[0] ?? null)}
                            />
                            {assignmentImportError ? <div className="text-sm text-red-600">{assignmentImportError}</div> : null}
                            <div>
                              <button
                                type="button"
                                className="btn btn-primary"
                                disabled={assignmentImporting || !assignmentFile}
                                onClick={() => importAssignment(expandedSessionId)}
                              >
                                {assignmentImporting ? 'Importing…' : 'Import with Gemini'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : sessionDetailsTab === 'responses' ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-sm">Quizzes</div>
                        {expandedSessionId && (
                          <button
                            type="button"
                            className="text-xs font-semibold text-white/70 hover:text-white disabled:opacity-50"
                            onClick={() => fetchMyResponses(expandedSessionId)}
                            disabled={myResponsesLoading}
                          >
                            {myResponsesLoading ? 'Refreshing…' : 'Refresh'}
                          </button>
                        )}
                      </div>

                      {myResponsesError ? (
                        <div className="text-sm text-red-600">{myResponsesError}</div>
                      ) : myResponsesLoading ? (
                        <div className="text-sm muted">Loading responses…</div>
                      ) : myResponses.length === 0 ? (
                        <div className="text-sm muted">No responses submitted yet.</div>
                      ) : (
                        <div className="space-y-2">
                          {myResponses.map((r: any) => (
                            <div key={r.id} className="p-3 border rounded bg-white space-y-1">
                              {r?.updatedAt ? (
                                <div className="text-xs text-slate-600">{new Date(r.updatedAt).toLocaleString()}</div>
                              ) : null}
                              {r?.quizLabel ? (
                                <div className="text-sm font-semibold text-slate-900">{String(r.quizLabel)}</div>
                              ) : null}
                              {r?.prompt ? (
                                <div className="text-sm text-slate-900 font-medium whitespace-pre-wrap break-words">
                                  {renderTextWithKatex(r.prompt)}
                                </div>
                              ) : null}
                              {(() => {
                                const html = renderKatexDisplayHtml(r?.latex)
                                if (html) {
                                  return (
                                    <div
                                      className="text-slate-900 leading-relaxed"
                                      dangerouslySetInnerHTML={{ __html: html }}
                                    />
                                  )
                                }
                                return (
                                  <div className="text-slate-900 whitespace-pre-wrap break-words">{renderTextWithKatex(String(r?.latex || ''))}</div>
                                )
                              })()}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </>
              )}
            </FullScreenGlassOverlay>
          </OverlayPortal>
        )}

        {assignmentOverlayOpen && (
          <OverlayPortal>
            <FullScreenGlassOverlay
              title={selectedAssignment?.title || 'Assignment'}
              onClose={() => {
                setAssignmentQuestionOverlayOpen(false)
                setSelectedAssignmentQuestionId(null)
                setAssignmentOverlayOpen(false)
              }}
              onBackdropClick={() => {
                setAssignmentQuestionOverlayOpen(false)
                setSelectedAssignmentQuestionId(null)
                setAssignmentOverlayOpen(false)
              }}
              zIndexClassName="z-[60]"
              className={`transition-opacity duration-200 ${assignmentQuestionOverlayOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
              leftActions={
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setAssignmentQuestionOverlayOpen(false)
                    setSelectedAssignmentQuestionId(null)
                    setAssignmentOverlayOpen(false)
                  }}
                >
                  Back
                </button>
              }
            >
              <div className="space-y-3">
                {(() => {
                  const isOwner = viewerId && (String(selectedAssignment?.createdBy || '') === String(viewerId) || String(sessionDetailsSession?.createdBy || '') === String(viewerId))
                  const canManage = (sessionRole === 'admin' || sessionRole === 'teacher') && isOwner
                  if (!canManage || !expandedSessionId || !selectedAssignment?.id) return null
                  return (
                    <div className="flex items-center justify-end">
                      <TaskManageMenu
                        actions={[
                          {
                            label: 'Edit title',
                            onClick: () => {
                              const nextTitle = window.prompt('New assignment title', selectedAssignment?.title || 'Assignment')
                              if (!nextTitle) return
                              void updateAssignmentTitle(expandedSessionId, String(selectedAssignment.id), nextTitle)
                            },
                          },
                          {
                            label: 'Delete',
                            variant: 'danger',
                            onClick: () => {
                              if (!window.confirm('Delete this assignment? This cannot be undone.')) return
                              void deleteAssignment(expandedSessionId, String(selectedAssignment.id))
                            },
                          },
                        ]}
                      />
                    </div>
                  )
                })()}
                    {selectedAssignmentError ? (
                      <div className="text-sm text-red-600">{selectedAssignmentError}</div>
                    ) : selectedAssignmentLoading ? (
                      <div className="text-sm muted">Loading assignment…</div>
                    ) : !selectedAssignment ? (
                      <div className="text-sm muted">No assignment selected.</div>
                    ) : (
                      <>
                        {(() => {
                          const qs = Array.isArray(selectedAssignment?.questions) ? selectedAssignment.questions : []
                          if (!qs.length) return <div className="text-sm muted">No questions found.</div>
                          return (
                            <ul className="border border-white/10 rounded divide-y divide-white/10 overflow-hidden">
                              {qs.map((q: any, idx: number) => (
                                <li key={String(q?.id || idx)} className="p-3">
                                  <button
                                    type="button"
                                    className="w-full text-left"
                                    onClick={() => {
                                      const qid = String(q?.id || '')
                                      if (!qid) return
                                      setSelectedAssignmentQuestionId(qid)
                                      setAssignmentQuestionOverlayOpen(true)
                                    }}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="font-medium">Question {idx + 1}</div>
                                      {isLearner ? (
                                        <div className="text-xs muted shrink-0">
                                          {(() => {
                                            const qid = String(q?.id || '')
                                            const answered = Boolean(String(assignmentResponsesByQuestionId?.[qid]?.latex || '').trim())
                                            const correctness = assignmentGradeByQuestionId?.[qid]
                                            const earned = assignmentEarnedMarksByQuestionId?.[qid]
                                            const total = assignmentTotalMarksByQuestionId?.[qid]

                                            const parts: string[] = []
                                            parts.push(answered ? 'Answered' : 'Not answered')
                                            if (correctness) parts.push(correctness === 'correct' ? 'Correct' : 'Incorrect')
                                            if (typeof earned === 'number' && typeof total === 'number') parts.push(`${earned}/${total}`)
                                            return parts.join(' • ')
                                          })()}
                                        </div>
                                      ) : null}
                                    </div>
                                    <div className="text-sm whitespace-pre-wrap break-words mt-1">{renderTextWithKatex(String(q?.latex || ''))}</div>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )
                        })()}

                        {isLearner && expandedSessionId && selectedAssignment?.id ? (
                          <div className="border border-white/10 rounded bg-white/5 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-semibold text-sm">Your submission</div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  className="btn btn-ghost text-xs"
                                  disabled={assignmentResponsesLoading}
                                  onClick={() => fetchAssignmentResponses(expandedSessionId, String(selectedAssignment.id))}
                                >
                                  {assignmentResponsesLoading ? 'Refreshing…' : 'Refresh'}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost text-xs"
                                  disabled={!assignmentSubmittedAt}
                                  onClick={() => {
                                    if (!assignmentSubmittedAt) return
                                    setLearnerSubmissionOverlayOpen(true)
                                    void fetchAssignmentResponses(expandedSessionId, String(selectedAssignment.id))
                                    void fetchAssignmentGrade(expandedSessionId, String(selectedAssignment.id))
                                  }}
                                >
                                  View
                                </button>
                              </div>
                            </div>

                            {assignmentResponsesError ? <div className="text-sm text-red-600">{assignmentResponsesError}</div> : null}

                            <div className="text-sm">
                              {assignmentSubmittedAt
                                ? <>Submitted: <span className="font-medium">{new Date(assignmentSubmittedAt).toLocaleString()}</span></>
                                : <span className="muted">Not submitted yet.</span>}
                            </div>

                            {assignmentGradeError ? <div className="text-sm text-red-600">{assignmentGradeError}</div> : null}
                            {assignmentSubmittedAt ? (
                              assignmentGradeLoading ? (
                                <div className="text-sm muted">Loading grade…</div>
                              ) : assignmentGradeSummary ? (
                                <div className="text-sm">
                                  Grade: <span className="font-medium">{assignmentGradeSummary.earnedPoints}/{assignmentGradeSummary.totalPoints}</span>{' '}
                                  ({Math.round(assignmentGradeSummary.percentage)}%)
                                </div>
                              ) : (
                                <div className="text-sm muted">Grade not available yet.</div>
                              )
                            ) : null}
                          </div>
                        ) : null}

                        {isTeacherOrAdminUser && expandedSessionId && selectedAssignment?.id ? (
                          <div className="border border-white/10 rounded bg-white/5 p-3 space-y-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-semibold text-sm">Learner submissions</div>
                              <button
                                type="button"
                                className="btn btn-ghost text-xs"
                                disabled={adminAssignmentSubmissionsLoading}
                                onClick={() => fetchAdminAssignmentSubmissions(expandedSessionId, String(selectedAssignment.id))}
                              >
                                {adminAssignmentSubmissionsLoading ? 'Refreshing…' : 'Refresh'}
                              </button>
                            </div>

                            {adminAssignmentSubmissionsError ? <div className="text-sm text-red-600">{adminAssignmentSubmissionsError}</div> : null}

                            {adminAssignmentSubmissions.length === 0 ? (
                              <div className="text-sm muted">No submissions yet.</div>
                            ) : (
                              <ul className="border border-white/10 rounded divide-y divide-white/10 overflow-hidden">
                                {adminAssignmentSubmissions.map((row: any) => (
                                  <li key={String(row?.userId)} className="p-3 flex items-start justify-between gap-3">
                                    <button
                                      type="button"
                                      className="min-w-0 text-left"
                                      onClick={() => {
                                        const userId = String(row?.userId || '')
                                        if (!userId) return
                                        setAdminSelectedSubmissionUserId(userId)
                                        void fetchAdminSubmissionDetail(expandedSessionId, String(selectedAssignment.id), userId)
                                      }}
                                    >
                                      <div className="font-medium break-words">{row?.user?.name || row?.user?.email || 'Learner'}</div>
                                      <div className="text-xs muted">
                                        {row?.submittedAt ? new Date(row.submittedAt).toLocaleString() : ''}
                                        {row?.grade
                                          ? ` • ${row.grade.earnedPoints}/${row.grade.totalPoints} (${Math.round(row.grade.percentage)}%)`
                                          : ''}
                                      </div>
                                    </button>
                                    <div className="shrink-0">
                                      <button
                                        type="button"
                                        className="btn btn-ghost text-xs"
                                        onClick={() => {
                                          const userId = String(row?.userId || '')
                                          if (!userId) return
                                          setAdminSelectedSubmissionUserId(userId)
                                          setAdminSubmissionOverlayOpen(true)
                                          void fetchAdminSubmissionDetail(expandedSessionId, String(selectedAssignment.id), userId)
                                        }}
                                      >
                                        View
                                      </button>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ) : null}

                        {isLearner && expandedSessionId && selectedAssignment?.id ? (
                          <div className="pt-2 space-y-2">
                            {assignmentSubmitError ? <div className="text-sm text-red-600">{assignmentSubmitError}</div> : null}
                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={assignmentSubmitting}
                              onClick={() => submitAssignment(expandedSessionId, String(selectedAssignment.id))}
                            >
                              {assignmentSubmitting ? 'Submitting…' : (assignmentSubmittedAt ? 'Resubmit Assignment' : 'Submit Assignment')}
                            </button>
                          </div>
                        ) : null}
                      </>
                    )}
              </div>
            </FullScreenGlassOverlay>
          </OverlayPortal>
        )}

        {assignmentQuestionOverlayOpen && selectedAssignmentQuestionId && (
          <OverlayPortal>
            <FullScreenGlassOverlay
              title="Question"
              onClose={() => {
                setAssignmentQuestionOverlayOpen(false)
                setSelectedAssignmentQuestionId(null)
              }}
              onBackdropClick={() => {
                setAssignmentQuestionOverlayOpen(false)
                setSelectedAssignmentQuestionId(null)
              }}
              zIndexClassName="z-[70]"
              leftActions={
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setAssignmentQuestionOverlayOpen(false)
                    setSelectedAssignmentQuestionId(null)
                  }}
                >
                  Back
                </button>
              }
            >
              <div className="space-y-4">
                    {(() => {
                      const qid = String(selectedAssignmentQuestionId || '')
                      const qs = Array.isArray(selectedAssignment?.questions) ? selectedAssignment.questions : []
                      const q = qs.find((x: any) => String(x?.id || '') === qid)
                      if (!qid || !q) return <div className="text-sm muted">Question not found.</div>

                      return (
                        <>
                          <div className="border border-white/10 rounded bg-white/5 p-3">
                            <div className="text-sm whitespace-pre-wrap break-words">{renderTextWithKatex(String(q?.latex || ''))}</div>
                          </div>

                          {!isLearner && expandedSessionId && selectedAssignment?.id ? (
                            <>
                              <div className="border border-white/10 rounded bg-white/5 p-3 space-y-2">
                                <div className="font-semibold text-sm">Assignment grading prompt</div>
                                {assignmentMasterGradingPromptEditing ? (
                                  <textarea
                                    className="input w-full text-xs min-h-[110px]"
                                    placeholder="Tell the AI how to grade the whole assignment."
                                    value={assignmentMasterGradingPrompt}
                                    onChange={(e) => setAssignmentMasterGradingPrompt(e.target.value)}
                                    onBlur={() => setAssignmentMasterGradingPromptEditing(false)}
                                    autoFocus
                                  />
                                ) : (
                                  <div
                                    className="border border-white/10 rounded bg-white/5 p-3 text-sm whitespace-pre-wrap break-words cursor-text"
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setAssignmentMasterGradingPromptEditing(true)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') setAssignmentMasterGradingPromptEditing(true)
                                    }}
                                  >
                                    {assignmentMasterGradingPrompt?.trim()
                                      ? renderTextWithKatex(String(assignmentMasterGradingPrompt || ''))
                                      : <span className="text-xs muted">Click to edit…</span>}
                                  </div>
                                )}
                                <div>
                                  <button
                                    type="button"
                                    className="btn btn-secondary text-xs"
                                    disabled={assignmentGradingPromptSavingScope === 'assignment'}
                                    onClick={() => saveAssignmentGradingPrompt(expandedSessionId, String(selectedAssignment.id), String(assignmentMasterGradingPrompt || ''))}
                                  >
                                    {assignmentGradingPromptSavingScope === 'assignment' ? 'Saving…' : 'Save assignment prompt'}
                                  </button>
                                </div>
                              </div>

                              <div className="border border-white/10 rounded bg-white/5 p-3 space-y-2">
                                <div className="font-semibold text-sm">Solution</div>
                                {(() => {
                                  const sol = assignmentSolutionsByQuestionId?.[qid]
                                  const latex = String(sol?.latex || '')
                                  const fileUrl = String(sol?.fileUrl || '')
                                  if (!latex.trim() && !fileUrl.trim()) return <div className="text-sm muted">No solution saved yet.</div>
                                  const latexHtml = latex.trim() ? renderKatexDisplayHtml(latex) : ''
                                  return (
                                    <div className="space-y-2">
                                      {latex.trim() ? (
                                        latexHtml ? (
                                          <div className="leading-relaxed" dangerouslySetInnerHTML={{ __html: latexHtml }} />
                                        ) : (
                                          <div className="text-sm whitespace-pre-wrap break-words">{renderTextWithKatex(latex)}</div>
                                        )
                                      ) : null}
                                      {fileUrl.trim() ? (
                                        <a href={fileUrl} target="_blank" rel="noreferrer" className="btn btn-secondary text-xs">Open uploaded solution</a>
                                      ) : null}
                                    </div>
                                  )
                                })()}

                                <div className="flex flex-wrap items-center gap-2">
                                  <Link
                                    className="btn btn-primary text-xs"
                                    href={`/sessions/${encodeURIComponent(expandedSessionId)}/assignments/${encodeURIComponent(String(selectedAssignment.id))}/solution/${encodeURIComponent(String(qid))}`}
                                  >
                                    Solve on canvas
                                  </Link>
                                </div>
                              </div>

                              <div className="border border-white/10 rounded bg-white/5 p-3 space-y-2">
                                <div className="font-semibold text-sm">Gemini marking plan</div>
                                {assignmentSolutionMarkingPlanEditingByQuestionId?.[qid] ? (
                                  <textarea
                                    className="input w-full text-xs min-h-[120px]"
                                    placeholder="Generate a marking plan with Gemini, then edit it."
                                    value={String(assignmentSolutionMarkingPlanDraftByQuestionId?.[qid] ?? '')}
                                    onChange={(e) => {
                                      const value = e.target.value
                                      setAssignmentSolutionMarkingPlanDraftByQuestionId(prev => ({ ...prev, [qid]: value }))
                                    }}
                                    onBlur={() => setAssignmentSolutionMarkingPlanEditingByQuestionId(prev => ({ ...prev, [qid]: false }))}
                                    autoFocus
                                  />
                                ) : (
                                  <div
                                    className="border border-white/10 rounded bg-white/5 p-3 text-sm whitespace-pre-wrap break-words cursor-text"
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setAssignmentSolutionMarkingPlanEditingByQuestionId(prev => ({ ...prev, [qid]: true }))}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') setAssignmentSolutionMarkingPlanEditingByQuestionId(prev => ({ ...prev, [qid]: true }))
                                    }}
                                  >
                                    {String(assignmentSolutionMarkingPlanDraftByQuestionId?.[qid] ?? '').trim()
                                      ? renderTextWithKatex(String(assignmentSolutionMarkingPlanDraftByQuestionId?.[qid] ?? ''))
                                      : <span className="text-xs muted">Click to edit…</span>}
                                  </div>
                                )}
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    className="btn btn-secondary text-xs"
                                    disabled={assignmentSolutionMarkingPlanGeneratingQuestionId === qid}
                                    onClick={() => void generateAssignmentSolutionMarkingPlan(expandedSessionId, String(selectedAssignment.id), qid)}
                                  >
                                    {assignmentSolutionMarkingPlanGeneratingQuestionId === qid ? 'Generating…' : 'Generate with Gemini'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-primary text-xs"
                                    disabled={assignmentSolutionMarkingPlanSavingQuestionId === qid}
                                    onClick={() => {
                                      setAssignmentSolutionMarkingPlanEditingByQuestionId(prev => ({ ...prev, [qid]: false }))
                                      void saveAssignmentSolutionMarkingPlan(expandedSessionId, String(selectedAssignment.id), qid, String(assignmentSolutionMarkingPlanDraftByQuestionId?.[qid] || ''))
                                    }}
                                  >
                                    {assignmentSolutionMarkingPlanSavingQuestionId === qid ? 'Saving…' : 'Save marking plan'}
                                  </button>
                                </div>
                              </div>

                              <div className="border border-white/10 rounded bg-white/5 p-3 space-y-2">
                                <div className="font-semibold text-sm">Gemini worked solution</div>
                                {assignmentSolutionWorkedSolutionEditingByQuestionId?.[qid] ? (
                                  <textarea
                                    className="input w-full text-xs min-h-[140px]"
                                    placeholder="Generate a fully worked solution with Gemini, then edit it."
                                    value={String(assignmentSolutionWorkedSolutionDraftByQuestionId?.[qid] ?? '')}
                                    onChange={(e) => {
                                      const value = e.target.value
                                      setAssignmentSolutionWorkedSolutionDraftByQuestionId(prev => ({ ...prev, [qid]: value }))
                                    }}
                                    onBlur={() => setAssignmentSolutionWorkedSolutionEditingByQuestionId(prev => ({ ...prev, [qid]: false }))}
                                    autoFocus
                                  />
                                ) : (
                                  <div
                                    className="border border-white/10 rounded bg-white/5 p-3 text-sm whitespace-pre-wrap break-words cursor-text"
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setAssignmentSolutionWorkedSolutionEditingByQuestionId(prev => ({ ...prev, [qid]: true }))}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') setAssignmentSolutionWorkedSolutionEditingByQuestionId(prev => ({ ...prev, [qid]: true }))
                                    }}
                                  >
                                    {String(assignmentSolutionWorkedSolutionDraftByQuestionId?.[qid] ?? '').trim()
                                      ? renderTextWithKatex(String(assignmentSolutionWorkedSolutionDraftByQuestionId?.[qid] ?? ''))
                                      : <span className="text-xs muted">Click to edit…</span>}
                                  </div>
                                )}
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    className="btn btn-secondary text-xs"
                                    disabled={assignmentSolutionWorkedSolutionGeneratingQuestionId === qid}
                                    onClick={() => void generateAssignmentSolutionWorkedSolution(expandedSessionId, String(selectedAssignment.id), qid)}
                                  >
                                    {assignmentSolutionWorkedSolutionGeneratingQuestionId === qid ? 'Generating…' : 'Generate worked solution'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-primary text-xs"
                                    disabled={assignmentSolutionWorkedSolutionSavingQuestionId === qid}
                                    onClick={() => {
                                      setAssignmentSolutionWorkedSolutionEditingByQuestionId(prev => ({ ...prev, [qid]: false }))
                                      void saveAssignmentSolutionWorkedSolution(expandedSessionId, String(selectedAssignment.id), qid, String(assignmentSolutionWorkedSolutionDraftByQuestionId?.[qid] || ''))
                                    }}
                                  >
                                    {assignmentSolutionWorkedSolutionSavingQuestionId === qid ? 'Saving…' : 'Save worked solution'}
                                  </button>
                                </div>
                              </div>

                              <div className="border border-white/10 rounded bg-white/5 p-3 space-y-2">
                                <div className="font-semibold text-sm">Grading prompt (this question)</div>
                                {assignmentGradingPromptEditingByQuestionId?.[qid] ? (
                                  <textarea
                                    className="input w-full text-xs min-h-[110px]"
                                    placeholder="Tell the AI how to grade this question."
                                    value={String(assignmentGradingPromptByQuestionId?.[qid] || '')}
                                    onChange={(e) => {
                                      const value = e.target.value
                                      setAssignmentGradingPromptByQuestionId(prev => ({ ...prev, [qid]: value }))
                                    }}
                                    onBlur={() => setAssignmentGradingPromptEditingByQuestionId(prev => ({ ...prev, [qid]: false }))}
                                    autoFocus
                                  />
                                ) : (
                                  <div
                                    className="border border-white/10 rounded bg-white/5 p-3 text-sm whitespace-pre-wrap break-words cursor-text"
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setAssignmentGradingPromptEditingByQuestionId(prev => ({ ...prev, [qid]: true }))}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') setAssignmentGradingPromptEditingByQuestionId(prev => ({ ...prev, [qid]: true }))
                                    }}
                                  >
                                    {String(assignmentGradingPromptByQuestionId?.[qid] || '').trim()
                                      ? renderTextWithKatex(String(assignmentGradingPromptByQuestionId?.[qid] || ''))
                                      : <span className="text-xs muted">Click to edit…</span>}
                                  </div>
                                )}
                                <div>
                                  <button
                                    type="button"
                                    className="btn btn-secondary text-xs"
                                    disabled={assignmentGradingPromptSavingScope === `q:${qid}`}
                                    onClick={() => {
                                      setAssignmentGradingPromptEditingByQuestionId(prev => ({ ...prev, [qid]: false }))
                                      void saveQuestionGradingPrompt(expandedSessionId, String(selectedAssignment.id), qid, String(assignmentGradingPromptByQuestionId?.[qid] || ''))
                                    }}
                                  >
                                    {assignmentGradingPromptSavingScope === `q:${qid}` ? 'Saving…' : 'Save grading prompt'}
                                  </button>
                                </div>
                              </div>
                            </>
                          ) : null}

                          {isLearner ? (
                            <div className="space-y-3">
                              <div className="border border-white/10 rounded bg-white/5 p-3 space-y-2">
                                <div className="font-semibold text-sm">Work on canvas</div>
                                {expandedSessionId && selectedAssignment?.id ? (
                                  assignmentSubmittedAt && !isTestStudent ? (
                                    <div className="text-sm muted">Locked after submission.</div>
                                  ) : (
                                    <Link
                                      className="btn btn-primary text-xs"
                                      href={`/sessions/${encodeURIComponent(expandedSessionId)}/assignments/${encodeURIComponent(String(selectedAssignment.id))}/q/${encodeURIComponent(String(qid))}`}
                                    >
                                      Solve on canvas
                                    </Link>
                                  )
                                ) : (
                                  <div className="text-sm muted">Open this assignment from a session to work on canvas.</div>
                                )}
                              </div>

                              {assignmentSubmittedAt ? (
                                <div className="border border-white/10 rounded bg-white/5 p-3 space-y-2">
                                  <div className="font-semibold text-sm">Grade</div>
                                  {assignmentGradeLoading ? (
                                    <div className="text-sm muted">Loading grade…</div>
                                  ) : (
                                    <>
                                      {(() => {
                                        const correctness = assignmentGradeByQuestionId?.[qid]
                                        const earned = assignmentEarnedMarksByQuestionId?.[qid]
                                        const total = assignmentTotalMarksByQuestionId?.[qid]
                                        if (!correctness && typeof earned !== 'number' && typeof total !== 'number') {
                                          return <div className="text-sm muted">Grade not available yet.</div>
                                        }
                                        return (
                                          <div className="text-sm">
                                            {correctness ? `Result: ${correctness}` : null}
                                            {correctness && (typeof earned === 'number' || typeof total === 'number') ? ' • ' : null}
                                            {typeof earned === 'number' && typeof total === 'number' ? `Marks: ${earned}/${total}` : null}
                                          </div>
                                        )
                                      })()}
                                    </>
                                  )}
                                </div>
                              ) : null}

                              <div className="border border-white/10 rounded bg-white/5 p-3 space-y-2">
                                <div className="font-semibold text-sm">Your response</div>
                              {(() => {
                                const latex = String(assignmentResponsesByQuestionId?.[qid]?.latex || '')
                                if (!latex.trim()) return <div className="text-sm muted">Not submitted yet.</div>

                                const stepFeedback = Array.isArray(assignmentStepFeedbackByQuestionId?.[qid])
                                  ? assignmentStepFeedbackByQuestionId[qid]
                                  : []

                                const steps = splitLatexIntoSteps(latex)
                                if (Array.isArray(stepFeedback) && stepFeedback.length && Array.isArray(steps) && steps.length) {
                                  const byStep = new Map<number, any>()
                                  for (const s of stepFeedback) {
                                    const idx2 = Number(s?.step ?? s?.index ?? s?.stepIndex ?? 0)
                                    if (Number.isFinite(idx2) && idx2 > 0) byStep.set(Math.trunc(idx2), s)
                                  }

                                  return (
                                    <div className="space-y-2">
                                      {steps.map((stepLatex: string, i: number) => {
                                        const stepNum = i + 1
                                        const fb = byStep.get(stepNum)
                                        const awarded = Number(fb?.awardedMarks ?? fb?.awarded ?? fb?.marks ?? 0)
                                        const awardedInt = Number.isFinite(awarded) ? Math.max(0, Math.trunc(awarded)) : 0

                                        const explicitIsCorrect = (typeof fb?.isCorrect === 'boolean') ? Boolean(fb.isCorrect) : null
                                        const isCorrect = (explicitIsCorrect == null) ? (awardedInt > 0) : explicitIsCorrect
                                        const isSignificant = (typeof fb?.isSignificant === 'boolean') ? Boolean(fb.isSignificant) : (!isCorrect)
                                        const feedbackText = String(fb?.feedback ?? fb?.note ?? fb?.why ?? fb?.correctStep ?? '').trim()

                                        const html = renderKatexDisplayHtml(stepLatex)
                                        const line = html
                                          ? <div className={isCorrect ? 'leading-relaxed' : 'leading-relaxed underline decoration-red-500'} dangerouslySetInnerHTML={{ __html: html }} />
                                          : <div className={isCorrect ? 'text-xs font-mono whitespace-pre-wrap break-words' : 'text-xs font-mono whitespace-pre-wrap break-words underline decoration-red-500'}>{stepLatex}</div>

                                        return (
                                          <div key={`${qid}-learner-step-${stepNum}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
                                            <div className="min-w-0">{line}</div>
                                            <div className="shrink-0 justify-self-end self-start flex items-center gap-2">
                                              {awardedInt > 0 ? (
                                                <span
                                                  className="text-green-500 flex items-center"
                                                  aria-label={`${awardedInt} mark${awardedInt === 1 ? '' : 's'} earned`}
                                                  title={`${awardedInt} mark${awardedInt === 1 ? '' : 's'}`}
                                                >
                                                  {Array.from({ length: Math.min(awardedInt, 12) }).map((_, j) => (
                                                    <svg key={`tick-${qid}-${stepNum}-${j}`} viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
                                                      <path
                                                        d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.12 7.18a1 1 0 0 1-1.42.006L3.29 9.01a1 1 0 1 1 1.414-1.414l3.17 3.17 6.412-6.47a1 1 0 0 1 1.418-.006z"
                                                        fill="currentColor"
                                                      />
                                                    </svg>
                                                  ))}
                                                  {awardedInt > 12 ? (
                                                    <span className="text-xs text-white/70 ml-1">+{awardedInt - 12}</span>
                                                  ) : null}
                                                </span>
                                              ) : isCorrect ? (
                                                <span className="text-green-500" aria-label="Correct but 0 marks" title="Correct but 0 marks">
                                                  <svg viewBox="0 0 10 10" className="w-2 h-2" aria-hidden="true">
                                                    <circle cx="5" cy="5" r="4" fill="currentColor" />
                                                  </svg>
                                                </span>
                                              ) : (
                                                isSignificant ? (
                                                  <span className="text-red-500" aria-label="Incorrect significant step" title="Incorrect (significant)">
                                                    <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
                                                      <path
                                                        d="M6.293 6.293a1 1 0 0 1 1.414 0L10 8.586l2.293-2.293a1 1 0 1 1 1.414 1.414L11.414 10l2.293 2.293a1 1 0 0 1-1.414 1.414L10 11.414l-2.293 2.293a1 1 0 0 1-1.414-1.414L8.586 10 6.293 7.707a1 1 0 0 1 0-1.414z"
                                                        fill="currentColor"
                                                      />
                                                    </svg>
                                                  </span>
                                                ) : (
                                                  <span className="text-red-500" aria-label="Incorrect insignificant step" title="Incorrect (insignificant)">
                                                    <svg viewBox="0 0 10 10" className="w-2 h-2" aria-hidden="true">
                                                      <circle cx="5" cy="5" r="4" fill="currentColor" />
                                                    </svg>
                                                  </span>
                                                )
                                              )}
                                            </div>

                                            {!isCorrect && awardedInt === 0 ? (
                                              <div className="text-xs text-white/70 max-w-full whitespace-pre-wrap break-words">
                                                {(feedbackText || 'Check this step').slice(0, 160)}
                                              </div>
                                            ) : null}
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )
                                }

                                if (Array.isArray(steps) && steps.length > 1) {
                                  return (
                                    <div className="space-y-2">
                                      {steps.map((stepLatex: string, i: number) => {
                                        const html = renderKatexDisplayHtml(stepLatex)
                                        return html ? (
                                          <div key={`${qid}-learner-step-plain-${i}`} className="leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
                                        ) : (
                                          <div key={`${qid}-learner-step-plain-${i}`} className="text-xs font-mono whitespace-pre-wrap break-words">{stepLatex}</div>
                                        )
                                      })}
                                    </div>
                                  )
                                }

                                const html = renderKatexDisplayHtml(latex)
                                if (html) return <div className="leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
                                return <div className="text-sm whitespace-pre-wrap break-words">{renderTextWithKatex(latex)}</div>
                              })()}
                            </div>
                            </div>
                          ) : null}
                        </>
                      )
                    })()}
              </div>
            </FullScreenGlassOverlay>
          </OverlayPortal>
        )}

        {isTeacherOrAdminUser && adminSubmissionOverlayOpen && expandedSessionId && selectedAssignment?.id && adminSelectedSubmissionUserId && (
          <OverlayPortal>
            {(() => {
              const detail: any = adminSelectedSubmissionDetail

              const submission = detail?.submission
              const user = submission?.user
              const results: any[] = Array.isArray(detail?.gradingJson?.results)
                ? detail.gradingJson.results
                : (Array.isArray(detail?.grade?.results) ? detail.grade.results : [])
              const byQuestionId = detail?.responses?.byQuestionId || {}
              const questions = Array.isArray(detail?.assignment?.questions) ? detail.assignment.questions : []

              const gradeByQuestionId: Record<string, any> = {}
              for (const r of results) {
                const qid = String(r?.questionId || '')
                if (!qid) continue
                gradeByQuestionId[qid] = {
                  earnedMarks: r?.earnedMarks,
                  totalMarks: r?.totalMarks,
                  stepFeedback: Array.isArray(r?.steps) ? r.steps : (Array.isArray(r?.stepFeedback) ? r.stepFeedback : [])
                }
              }

              return (
                <AssignmentSubmissionOverlay
                  mode="admin"
                  title="Student response"
                  subtitle="Review submission"
                  onBackdropClick={() => setAdminSubmissionOverlayOpen(false)}
                  onClose={() => {
                    setAdminSubmissionOverlayOpen(false)
                    setAdminSelectedSubmissionUserId(null)
                    setAdminSelectedSubmissionDetail(null)
                    setAdminSelectedSubmissionError(null)
                    setAdminRegradeError(null)
                  }}
                  showRegradeButton={Boolean(isAdmin)}
                  regradeLoading={adminRegradeLoading}
                  onRegrade={() => adminRegradeSubmission(expandedSessionId, String(selectedAssignment.id), adminSelectedSubmissionUserId)}
                  errors={[adminRegradeError, adminSelectedSubmissionError]}
                  meta={adminSelectedSubmissionDetail ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/80">
                      <span className="font-medium text-white">{user?.name || user?.email || 'Learner'}</span>
                      {submission?.submittedAt ? <span>• {new Date(submission.submittedAt).toLocaleString()}</span> : null}
                      {typeof detail?.grade?.percentage === 'number' ? (
                        <span>
                          • <span className="font-medium text-white">{detail.grade.earnedPoints}/{detail.grade.totalPoints}</span> ({Math.round(detail.grade.percentage)}%)
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  loading={adminSelectedSubmissionLoading}
                  loadingText="Loading submission…"
                  emptyState={<div className="text-sm text-white/70">No submission selected.</div>}
                  questions={questions}
                  responsesByQuestionId={byQuestionId || {}}
                  gradingByQuestionId={gradeByQuestionId}
                  responseLabel="Student response"
                  emptyResponseText="(empty)"
                  openFirstQuestion
                  renderTextWithKatex={renderTextWithKatex}
                  renderKatexDisplayHtml={renderKatexDisplayHtml}
                  splitLatexIntoSteps={splitLatexIntoSteps}
                />
              )
            })()}
          </OverlayPortal>
        )}

        {isLearner && learnerSubmissionOverlayOpen && expandedSessionId && selectedAssignment?.id && (
          <OverlayPortal>
            {(() => {
              const qs = Array.isArray(selectedAssignment?.questions) ? selectedAssignment.questions : []
              const gradingByQuestionId: Record<string, any> = {}
              for (const q of qs) {
                const qid = String(q?.id || '')
                if (!qid) continue
                gradingByQuestionId[qid] = {
                  earnedMarks: assignmentEarnedMarksByQuestionId?.[qid],
                  totalMarks: assignmentTotalMarksByQuestionId?.[qid],
                  stepFeedback: assignmentStepFeedbackByQuestionId?.[qid]
                }
              }

              return (
                <AssignmentSubmissionOverlay
                  mode="learner"
                  title="Your submission"
                  subtitle="Review grading"
                  onBackdropClick={() => setLearnerSubmissionOverlayOpen(false)}
                  onClose={() => setLearnerSubmissionOverlayOpen(false)}
                  errors={[assignmentResponsesError, assignmentGradeError]}
                  meta={
                    <div className="flex flex-wrap items-center gap-2 text-xs text-white/70">
                      {assignmentSubmittedAt ? <span>Submitted: {new Date(assignmentSubmittedAt).toLocaleString()}</span> : <span>Not submitted yet.</span>}
                      {assignmentGradeSummary ? (
                        <span>
                          • Grade: {Math.trunc(assignmentGradeSummary.earnedPoints)}/{Math.trunc(assignmentGradeSummary.totalPoints)} ({Math.round(assignmentGradeSummary.percentage)}%)
                        </span>
                      ) : null}
                    </div>
                  }
                  loading={Boolean(assignmentResponsesLoading || assignmentGradeLoading)}
                  loadingText="Loading…"
                  emptyState={<div className="text-sm text-white/70">No questions found.</div>}
                  questions={qs}
                  responsesByQuestionId={assignmentResponsesByQuestionId || {}}
                  gradingByQuestionId={gradingByQuestionId}
                  responseLabel="Your response"
                  emptyResponseText="No response recorded."
                  renderTextWithKatex={renderTextWithKatex}
                  renderKatexDisplayHtml={renderKatexDisplayHtml}
                  splitLatexIntoSteps={splitLatexIntoSteps}
                />
              )
            })()}
          </OverlayPortal>
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

      <button
        type="button"
        className="btn btn-ghost text-sm justify-between"
        onClick={() => setUsersFiltersOpen(v => !v)}
      >
        Filters {usersFiltersOpen ? '▾' : '▸'}
      </button>

      {usersFiltersOpen ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs muted">Role:</span>
            {(['all', 'student', 'teacher', 'admin'] as const).map(role => (
              <button
                key={role}
                type="button"
                className={`btn btn-ghost text-xs ${usersRoleFilter === role ? 'bg-white/10 text-white' : ''}`}
                onClick={() => setUsersRoleFilter(role)}
              >
                {role}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs muted">Verification:</span>
            {(['all', 'verified', 'unverified'] as const).map(state => (
              <button
                key={state}
                type="button"
                className={`btn btn-ghost text-xs ${usersVerifiedFilter === state ? 'bg-white/10 text-white' : ''}`}
                onClick={() => setUsersVerifiedFilter(state)}
              >
                {state}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs muted">Sort:</span>
            {(['newest', 'oldest', 'name'] as const).map(sort => (
              <button
                key={sort}
                type="button"
                className={`btn btn-ghost text-xs ${usersSort === sort ? 'bg-white/10 text-white' : ''}`}
                onClick={() => setUsersSort(sort)}
              >
                {sort}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-[200px]">
            <input
              className="input"
              placeholder="Search name or email"
              value={usersSearch}
              onChange={(e) => setUsersSearch(e.target.value)}
            />
          </div>
        </div>
      ) : null}

      {(() => {
        const safeUsers = Array.isArray(users) ? users : []
        const totalCount = safeUsers.length
        const verifiedCount = safeUsers.filter(u => Boolean(u?.emailVerifiedAt)).length
        const unverifiedCount = totalCount - verifiedCount
        const roleCount = safeUsers.filter(u => {
          const role = String(u?.role || '') as 'student' | 'teacher' | 'admin' | ''
          if (usersRoleFilter === 'all') return true
          return role === usersRoleFilter
        }).length

        return (
          <div className="flex flex-wrap items-center gap-3 text-xs text-white/70">
            <span>Total users: <strong className="text-white">{totalCount}</strong></span>
            <span>Verified: <strong className="text-white">{verifiedCount}</strong></span>
            <span>Unverified: <strong className="text-white">{unverifiedCount}</strong></span>
            <span>In view: <strong className="text-white">{roleCount}</strong></span>
            <button
              type="button"
              className="btn btn-ghost text-xs"
              onClick={markAllUsersVerified}
              disabled={bulkVerifyLoading || unverifiedCount === 0}
              title="Skip verification for all unverified users"
            >
              {bulkVerifyLoading ? 'Verifying…' : 'Skip verification for all'}
            </button>
          </div>
        )
      })()}

      <button
        type="button"
        className="btn btn-ghost text-sm justify-between"
        onClick={() => setUsersCreateOpen(v => !v)}
      >
        Create user {usersCreateOpen ? '▾' : '▸'}
      </button>

      {usersCreateOpen ? (
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
      ) : null}

      <button
        type="button"
        className="btn btn-ghost text-sm justify-between"
        onClick={() => setUsersListOpen(v => !v)}
      >
        Users list {usersListOpen ? '▾' : '▸'}
      </button>

      {usersListOpen ? (
      <>
      {usersLoading ? (
        <div className="text-sm muted">Loading users...</div>
      ) : usersError ? (
        <div className="text-sm text-red-600">{usersError}</div>
      ) : users && users.length === 0 ? (
        <div className="text-sm muted">No users found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left table-fixed">
            <thead>
              <tr>
                <th className="px-2 py-1 w-10">#</th>
                <th className="px-2 py-1">Learner</th>
                <th className="px-2 py-1">Verification</th>
                <th className="px-2 py-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users && users
                .filter(u => {
                  const role = String(u?.role || '') as 'student' | 'teacher' | 'admin' | ''
                  if (usersRoleFilter !== 'all' && role !== usersRoleFilter) return false
                  const verified = Boolean(u?.emailVerifiedAt)
                  if (usersVerifiedFilter === 'verified' && !verified) return false
                  if (usersVerifiedFilter === 'unverified' && verified) return false
                  const q = usersSearch.trim().toLowerCase()
                  if (!q) return true
                  const name = `${u?.firstName || ''} ${u?.lastName || ''} ${u?.name || ''}`.toLowerCase()
                  const email = String(u?.email || '').toLowerCase()
                  return name.includes(q) || email.includes(q)
                })
                .sort((a, b) => {
                  if (usersSort === 'name') {
                    const an = `${a?.firstName || ''} ${a?.lastName || ''} ${a?.name || ''}`.trim().toLowerCase()
                    const bn = `${b?.firstName || ''} ${b?.lastName || ''} ${b?.name || ''}`.trim().toLowerCase()
                    return an.localeCompare(bn)
                  }
                  const ad = new Date(a?.createdAt || 0).getTime()
                  const bd = new Date(b?.createdAt || 0).getTime()
                  return usersSort === 'oldest' ? ad - bd : bd - ad
                })
                .map((u, idx) => (
                <tr
                  key={u.id}
                  className="border-t hover:bg-white/5 cursor-pointer"
                  onClick={() => {
                    setSelectedUserDetail(u)
                    setUserTempPassword(null)
                    setUserDetailOverlayOpen(true)
                  }}
                >
                  <td className="px-2 py-2 align-top text-xs text-white/60">{idx + 1}</td>
                  <td className="px-2 py-2 align-top">
                    <UserLink userId={u.id} className="font-medium hover:underline" title="View profile">
                      {u.firstName || u.name || '—'} {u.lastName || ''}
                    </UserLink>
                    <div className="text-xs muted">Grade: {u.grade ? gradeToLabel(u.grade) : 'Unassigned'}</div>
                    <div className="text-xs muted">School: {u.schoolName || '—'}</div>
                  </td>
                  <td className="px-2 py-2 align-top">
                    {u.emailVerifiedAt ? (
                      <span className="text-xs text-green-300">Verified</span>
                    ) : (
                      <label className="flex items-center gap-2 text-xs text-white/80">
                        <input
                          type="checkbox"
                          checked={false}
                          onChange={() => markUserVerified(String(u.id))}
                          disabled={userDetailLoading}
                        />
                        Skip verification
                      </label>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <button className="btn btn-ghost text-xs">Manage</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>
      ) : null}
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

  const renderSection = (id: SectionId) => {
    switch (id) {
      case 'live':
        return <LiveSection />
      case 'announcements':
        return <AnnouncementsSection />
      case 'sessions':
        return renderSessionsSection()
      case 'groups':
        return (
          <div className="space-y-4 p-3">
            <section className="card p-3 space-y-2">
              <div className="text-sm font-semibold text-white">Create a group</div>
              <div className="grid gap-2">
                <input
                  className="input"
                  value={createGroupName}
                  onChange={(e) => setCreateGroupName(e.target.value)}
                  placeholder="e.g. Grade 12 Maths — Study Group"
                  maxLength={80}
                />
                <div className="grid grid-cols-2 gap-2">
                  <select className="input" value={createGroupType} onChange={(e) => setCreateGroupType((e.target.value as any) || 'study_group')}>
                    <option value="study_group">Study group</option>
                    <option value="class">Class</option>
                    <option value="cohort">Cohort</option>
                  </select>
                  <select className="input" value={createGroupGrade} onChange={(e) => setCreateGroupGrade(e.target.value)}>
                    <option value="">Grade (optional)</option>
                    {GRADE_VALUES.map((g) => (
                      <option key={g} value={g}>
                        {gradeToLabel(g)}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={createGroupBusy || !createGroupName.trim()}
                  onClick={createGroup}
                >
                  {createGroupBusy ? 'Creating…' : 'Create group'}
                </button>
                <div className="text-xs muted">Students can create groups for their grade or below. Instructors/admin can create any.</div>
              </div>
            </section>

            <section className="card p-3 space-y-2">
              <div className="text-sm font-semibold text-white">Join with code</div>
              <div className="flex items-center gap-2">
                <input
                  className="input flex-1"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="Enter join code"
                  maxLength={16}
                />
                <button type="button" className="btn btn-secondary" disabled={joinBusy || !joinCode.trim()} onClick={joinGroupByCode}>
                  {joinBusy ? 'Joining…' : 'Join'}
                </button>
              </div>
            </section>

            <section className="card p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-white">Your groups</div>
                <button type="button" className="btn btn-ghost" onClick={() => void loadMyGroups()}>
                  Refresh
                </button>
              </div>

              {myGroupsLoading ? (
                <div className="text-sm muted">Loading…</div>
              ) : myGroupsError ? (
                <div className="text-sm text-red-200">{myGroupsError}</div>
              ) : myGroups.length === 0 ? (
                <div className="text-sm muted">No groups yet.</div>
              ) : (
                <div className="grid gap-2">
                  {myGroups.map((row) => (
                    <button
                      key={row.group.id}
                      type="button"
                      className={`card p-3 text-left ${selectedGroupId === row.group.id ? 'border-white/25 bg-white/10' : ''}`}
                      onClick={() => void loadGroupMembers(row.group.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-white break-words">{row.group.name}</div>
                          <div className="text-xs muted">
                            {row.group.type.replace('_', ' ')}
                            {row.group.grade ? ` • ${gradeToLabel(row.group.grade as GradeValue)}` : ''}
                            {` • ${row.group.membersCount} member${row.group.membersCount === 1 ? '' : 's'}`}
                          </div>
                        </div>
                        <div className="text-xs muted">{row.memberRole}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {selectedGroupId && (
              <section className="card p-3 space-y-2">
                {(() => {
                  const myId = (session as any)?.user?.id as string | undefined
                  const membership = myGroups.find((g) => g.group.id === selectedGroupId)
                  const myRole = membership?.memberRole || ''
                  const canManage =
                    normalizedRole === 'admin' ||
                    normalizedRole === 'teacher' ||
                    myRole === 'owner' ||
                    myRole === 'instructor' ||
                    (myId && selectedGroupCreatedById && myId === selectedGroupCreatedById)

                  if (!canManage) return null

                  const pendingForGroup = actionJoinRequests.filter((r) => String(r?.groupId || r?.group?.id || '') === selectedGroupId)

                  return (
                    <>
                      <div className="card p-3 space-y-3">
                        <div className="text-sm font-semibold text-white">Join code</div>
                        {selectedGroupJoinCode ? (
                          <div className="flex items-center gap-2">
                            <input className="input flex-1" value={selectedGroupJoinCode} readOnly />
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard?.writeText(selectedGroupJoinCode)
                                  alert('Copied')
                                } catch {
                                  alert('Unable to copy')
                                }
                              }}
                            >
                              Copy
                            </button>
                            <button type="button" className="btn btn-secondary" disabled={regenerateJoinCodeBusy} onClick={regenerateSelectedGroupJoinCode}>
                              {regenerateJoinCodeBusy ? 'Regenerating…' : 'Regenerate'}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="text-sm muted flex-1">Join code hidden for members.</div>
                            <button type="button" className="btn btn-secondary" disabled={regenerateJoinCodeBusy} onClick={regenerateSelectedGroupJoinCode}>
                              {regenerateJoinCodeBusy ? 'Regenerating…' : 'Regenerate'}
                            </button>
                          </div>
                        )}

                        <div className="text-sm font-semibold text-white">Invite by email</div>
                        <div className="flex items-center gap-2">
                          <input
                            className="input flex-1"
                            placeholder="learner@example.com"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                void sendSelectedGroupInvite()
                              }
                            }}
                          />
                          <button type="button" className="btn btn-secondary" disabled={inviteBusy || !inviteEmail.trim()} onClick={() => void sendSelectedGroupInvite()}>
                            {inviteBusy ? 'Sending…' : 'Invite'}
                          </button>
                        </div>

                        {selectedGroupAllowJoinRequests && (
                          <div className="text-xs muted">Learners can also request to join from Discover (if your profile is discoverable).</div>
                        )}
                      </div>

                      <div className="card p-3 space-y-2">
                        <div className="text-sm font-semibold text-white">Join requests</div>
                        {notificationsLoading ? (
                          <div className="text-sm muted">Loading…</div>
                        ) : pendingForGroup.length === 0 ? (
                          <div className="text-sm muted">No pending requests.</div>
                        ) : (
                          <div className="grid gap-2">
                            {pendingForGroup.map((r: any) => {
                              const requesterVerified = r?.requestedBy?.verified || r?.requestedBy?.role === 'admin' || r?.requestedBy?.role === 'teacher'
                              return (
                                <div key={r.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                                  <div className="text-sm text-white/90">
                                    <UserLink
                                      userId={r.requestedBy?.id}
                                      className="font-semibold text-white/90 hover:underline"
                                      title="View profile"
                                    >
                                      {r.requestedBy?.name || r.requestedBy?.email || 'Learner'}
                                    </UserLink>
                                    {requesterVerified ? (
                                      <span className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded-full bg-blue-500 text-white align-middle" aria-label="Verified" title="Verified">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                          <path d="M9.0 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" fill="currentColor" />
                                        </svg>
                                      </span>
                                    ) : null}{' '}
                                    wants to join
                                  </div>
                                  <div className="mt-2 flex gap-2">
                                    <button type="button" className="btn btn-secondary" onClick={() => void respondJoinRequest(r.id, 'accept')}>Accept</button>
                                    <button type="button" className="btn btn-ghost" onClick={() => void respondJoinRequest(r.id, 'decline')}>Decline</button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  )
                })()}

                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-white">Members</div>
                  {selectedGroupLoading && <div className="text-xs muted">Loading…</div>}
                </div>
                {selectedGroupMembers.length === 0 ? (
                  <div className="text-sm muted">No members found.</div>
                ) : (
                  <div className="grid gap-2">
                    {selectedGroupMembers.map((m) => {
                      const verified = m.user.role === 'admin' || m.user.role === 'teacher'
                      const label =
                        m.user.role === 'admin'
                          ? 'Admin'
                          : m.user.role === 'teacher'
                            ? 'Instructor'
                            : m.user.grade
                              ? `Student (${gradeToLabel(m.user.grade as GradeValue)})`
                              : 'Student'
                      const showRoleTick = verified && Boolean(label)
                      const showAvatarTick = verified && !showRoleTick && Boolean(m.user.avatar)
                      const showNameTick = verified && !showRoleTick && !m.user.avatar
                      return (
                        <div
                          key={m.membershipId}
                          className="card p-3 text-left"
                        >
                          <div className="flex items-center gap-3">
                            <UserLink userId={m.user.id} className="shrink-0" title="View profile">
                              <div className="relative overflow-visible">
                                <div className="h-10 w-10 aspect-square rounded-full border border-white/15 bg-white/5 overflow-hidden flex items-center justify-center text-white/90 profile-avatar-container">
                                  {m.user.avatar ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={m.user.avatar} alt={m.user.name} className="h-full w-full object-cover" />
                                  ) : (
                                    <span className="text-sm font-semibold">{(m.user.name || 'U').slice(0, 1).toUpperCase()}</span>
                                  )}
                                </div>
                                {showAvatarTick ? (
                                  <span className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-blue-500 text-white flex items-center justify-center border border-white/50 shadow-md pointer-events-none" aria-label="Verified" title="Verified">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                      <path d="M9.0 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" fill="currentColor" />
                                    </svg>
                                  </span>
                                ) : null}
                              </div>
                            </UserLink>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <UserLink userId={m.user.id} className="font-semibold text-white truncate hover:underline" title="View profile">
                                  {m.user.name}
                                </UserLink>
                                {showNameTick ? (
                                  <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-blue-500 text-white" aria-label="Verified" title="Verified">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                      <path d="M9.0 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" fill="currentColor" />
                                    </svg>
                                  </span>
                                ) : null}
                              </div>
                              <div className="text-xs muted truncate inline-flex items-center gap-1">
                                <span className="truncate">{label}{m.user.statusBio ? ` • ${m.user.statusBio}` : ''}</span>
                                {showRoleTick ? (
                                  <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-blue-500 text-white" aria-label="Verified" title="Verified">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                      <path d="M9.0 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" fill="currentColor" />
                                    </svg>
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )}

            {(profilePeekError || profilePeek) && (
              <section className="space-y-2">
                <div className="text-sm font-semibold text-white">Profile</div>
                {profilePeekError ? (
                  <div className="text-sm text-red-200">{profilePeekError}</div>
                ) : profilePeek ? (
                  <div className="card p-3">
                    <div className="flex items-start gap-3">
                      <UserLink userId={profilePeek.id} className="shrink-0" title="View profile">
                        <div className="relative overflow-visible">
                          <div className="h-12 w-12 aspect-square rounded-full border border-white/15 bg-white/5 overflow-hidden flex items-center justify-center text-white/90 profile-avatar-container">
                            {profilePeek.avatar ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={profilePeek.avatar} alt={profilePeek.name} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-base font-semibold">{(profilePeek.name || 'U').slice(0, 1).toUpperCase()}</span>
                            )}
                          </div>
                        </div>
                      </UserLink>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <UserLink userId={profilePeek.id} className="font-semibold text-white truncate hover:underline" title="View profile">
                            {profilePeek.name}
                          </UserLink>
                        </div>
                        <div className="text-xs muted">
                          {profilePeek.role === 'admin'
                            ? 'Admin'
                            : profilePeek.role === 'teacher'
                              ? 'Instructor'
                              : profilePeek.grade
                                ? `Student (${gradeToLabel(profilePeek.grade as GradeValue)})`
                                : 'Student'}
                          {profilePeek.schoolName ? ` • ${profilePeek.schoolName}` : ''}
                          {profilePeek.verified ? (
                            <span className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded-full bg-blue-500 text-white align-middle" aria-label="Verified" title="Verified">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                <path d="M9.0 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" fill="currentColor" />
                              </svg>
                            </span>
                          ) : null}
                        </div>
                        {profilePeek.statusBio && <div className="mt-1 text-sm text-white/85">{profilePeek.statusBio}</div>}
                      </div>
                    </div>
                  </div>
                ) : null}
              </section>
            )}
          </div>
        )
      case 'discover':
        return (
          <div className="space-y-3">
            <section className="card p-3 space-y-3">
              <div className="text-sm font-semibold text-white">Discover</div>
              <div className="flex items-center gap-2">
                <input
                  className="input flex-1"
                  placeholder="Search by name, email, or school"
                  value={discoverQuery}
                  onChange={(e) => setDiscoverQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void searchDiscover(discoverQuery)
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={discoverLoading}
                  onClick={() => void searchDiscover(discoverQuery)}
                >
                  {discoverLoading ? 'Searching…' : 'Search'}
                </button>
              </div>
              {discoverError && <div className="text-sm text-red-200">{discoverError}</div>}

              {discoverLoading && discoverResults.length === 0 ? (
                <div className="text-sm muted">Loading recommendations…</div>
              ) : discoverResults.length === 0 ? (
                <div className="text-sm muted">Start typing a name, or browse recommended classmates and groupmates.</div>
              ) : (
                <div className="grid gap-2">
                  {discoverResults.map((u: any) => {
                    const sharedGroupsCount = typeof u?.sharedGroupsCount === 'number' ? u.sharedGroupsCount : 0
                    const chips: string[] = []
                    if (sharedGroupsCount > 0) chips.push(sharedGroupsCount === 1 ? '1 shared group' : `${sharedGroupsCount} shared groups`)
                    const r = roleLabel(u?.role)
                    if (r) chips.push(r)
                    const verified = Boolean(u?.verified)
                    const hasRoleChip = Boolean(r)
                    const hasAvatar = Boolean(u?.avatar)
                    const showRoleTick = verified && hasRoleChip
                    const showAvatarTick = verified && !showRoleTick && hasAvatar
                    const showNameTick = verified && !showRoleTick && !hasAvatar
                    return (
                      <UserLink
                        key={u.id}
                        userId={u?.id}
                        className="card p-3 text-left block"
                        title="View profile"
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative overflow-visible">
                            <div className="h-10 w-10 aspect-square rounded-full border border-white/15 bg-white/5 overflow-hidden flex items-center justify-center text-white/90 profile-avatar-container">
                              {u.avatar ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={u.avatar} alt={u.name} className="h-full w-full object-cover" />
                              ) : (
                                <span className="text-sm font-semibold">{String(u.name || 'U').slice(0, 1).toUpperCase()}</span>
                              )}
                            </div>

                            {showAvatarTick ? (
                              <div
                                className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-blue-500 text-white flex items-center justify-center border border-white/50 shadow-md pointer-events-none"
                                title="Verified"
                                aria-label="Verified"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                  <path d="M9.00016 16.2L4.80016 12L3.40016 13.4L9.00016 19L21.0002 7.00001L19.6002 5.60001L9.00016 16.2Z" fill="currentColor" />
                                </svg>
                              </div>
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-semibold text-white truncate flex items-center gap-2">
                                <span className="truncate">{u.name}</span>
                                {showNameTick ? (
                                  <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-blue-500 text-white" aria-label="Verified" title="Verified">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                      <path d="M9.00016 16.2L4.80016 12L3.40016 13.4L9.00016 19L21.0002 7.00001L19.6002 5.60001L9.00016 16.2Z" fill="currentColor" />
                                    </svg>
                                  </span>
                                ) : null}
                              </div>
                              {chips.length > 0 ? (
                                <div className="shrink-0 flex flex-wrap gap-1">
                                  {chips.slice(0, 2).map((c) => (
                                    <span key={c} className="text-[10px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 inline-flex items-center gap-1">
                                      <span>{c}</span>
                                      {showRoleTick && c === r ? (
                                        <span className="inline-flex items-center justify-center h-3 w-3 rounded-full bg-blue-500 text-white" aria-label="Verified" title="Verified">
                                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                            <path d="M9.00016 16.2L4.80016 12L3.40016 13.4L9.00016 19L21.0002 7.00001L19.6002 5.60001L9.00016 16.2Z" fill="currentColor" />
                                          </svg>
                                        </span>
                                      ) : null}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                            <div className="text-xs muted truncate">{u.schoolName ? `${u.schoolName} • ` : ''}{u.statusBio || ''}</div>
                          </div>
                        </div>
                      </UserLink>
                    )
                  })}
                </div>
              )}
            </section>
          </div>
        )
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
            const isActive = section.id === 'overview' ? activeSection === 'overview' : dashboardSectionOverlay === section.id
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => {
                  if (section.id === 'overview') {
                    closeDashboardOverlay()
                    return
                  }
                  openDashboardOverlay(section.id as OverlaySectionId)
                }}
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
            const isActive = section.id === 'overview' ? activeSection === 'overview' : dashboardSectionOverlay === section.id
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => {
                  if (section.id === 'overview') {
                    closeDashboardOverlay()
                    return
                  }
                  openDashboardOverlay(section.id as OverlaySectionId)
                }}
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
      <main
        ref={dashboardMainRef}
        className={
          isMobile
            ? 'mobile-dashboard-theme relative text-white overflow-x-hidden min-h-[100dvh]'
            : 'deep-page min-h-screen pb-16'
        }
      >
      {isMobile && isCapacitorWrappedApp && (pullRefreshActive || pullRefreshLoading) && (
        <div className="fixed inset-x-0 top-2 z-[75] flex justify-center pointer-events-none">
          <div
            className="rounded-full border border-white/20 bg-[#031641]/85 backdrop-blur p-2 text-white/90"
            style={{
              transform: `translateY(${Math.max(0, pullRefreshOffset - 18)}px)`,
              opacity: pullRefreshLoading ? 1 : Math.min(1, pullRefreshOffset / 64),
            }}
            aria-label="Pull to refresh"
          >
            <svg
              viewBox="0 0 24 24"
              className={`h-5 w-5 ${pullRefreshLoading ? 'animate-spin' : ''}`}
              style={{
                transform: pullRefreshLoading
                  ? undefined
                  : `rotate(${Math.min(300, Math.max(0, (pullRefreshOffset / 84) * 300))}deg)`,
                transition: pullRefreshLoading ? undefined : 'transform 90ms linear',
              }}
              aria-hidden="true"
            >
              <path
                d="M20 12a8 8 0 1 1-2.34-5.66"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M20 4v6h-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      )}
      <input
        ref={diagramUploadInputRef}
        type="file"
        accept="image/*"
        onChange={onDiagramFilePicked}
        style={{ display: 'none' }}
      />
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void uploadAvatar(file)
          e.target.value = ''
          setAvatarEditArmed(false)
        }}
        style={{ display: 'none' }}
      />
      {isMobile && (
        <>
          <div
            className="fixed inset-0 opacity-30 scale-110"
            style={{ backgroundImage: `url(${mobileThemeBgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
            aria-hidden="true"
          />
          <div className="fixed inset-0 bg-gradient-to-b from-[#020b35]/40 via-[#041448]/30 to-[#031641]/45" aria-hidden="true" />
          <div className="fixed inset-x-0 top-0 z-20 h-[280px] bg-gradient-to-b from-[#020b35]/70 via-[#041448]/35 to-transparent pointer-events-none" aria-hidden="true" />
        </>
      )}
      <div
        className={
          isMobile
            ? 'relative z-10 w-full px-0 min-h-[100dvh] flex flex-col'
            : 'max-w-6xl mx-auto px-4 lg:px-8 py-8 space-y-6'
        }
      >
        {isMobile ? (
          isAdmin ? (
            <div className="flex-1 flex flex-col py-4">
              <div className="fixed inset-x-0 mobile-rail-fixed top-[0.9rem] z-30">
                <div className="relative">
                  <section
                  data-mobile-chrome-ignore
                  className={`relative overflow-hidden rounded-3xl border border-white/10 px-5 py-6 text-center shadow-2xl h-[236px] ${mobileHeroBgDragActive ? 'ring-2 ring-white/40' : ''}`}
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
                  <input
                    ref={themeBgInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) applyMobileThemeBackgroundFile(file)
                      e.target.value = ''
                    }}
                  />

                  <button
                    type="button"
                    aria-label="Edit theme background"
                    className={`absolute top-3 right-3 inline-flex items-center justify-center h-10 w-10 rounded-xl border border-white/20 bg-white/10 backdrop-blur transition-opacity ${mobileHeroBgEditVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      themeBgInputRef.current?.click()
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm18-11.5a1 1 0 0 0 0-1.41l-1.34-1.34a1 1 0 0 0-1.41 0l-1.13 1.13 3.75 3.75L21 5.75Z" fill="currentColor" />
                    </svg>
                  </button>

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
                    <div className="relative group w-20 h-20" data-avatar-edit-container="1">
                      <button
                        type="button"
                        className="w-20 h-20 rounded-full border border-white/25 bg-white/5 flex items-center justify-center text-2xl font-semibold text-white overflow-hidden"
                        onClick={() => setAvatarEditArmed(v => !v)}
                        disabled={avatarUploading}
                        aria-label="Edit avatar"
                      >
                        {effectiveAvatarUrl ? (
                          <img src={effectiveAvatarUrl} alt={learnerName} className="w-full h-full object-cover" />
                        ) : (
                          <span>{learnerInitials}</span>
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label="Update avatar"
                        className={`absolute -bottom-1 -right-1 inline-flex items-center justify-center h-9 w-9 rounded-xl border border-white/20 bg-white/10 backdrop-blur transition-opacity ${avatarUploading || avatarEditArmed ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto'}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setAvatarEditArmed(false)
                          avatarInputRef.current?.click()
                        }}
                        disabled={avatarUploading}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm18-11.5a1 1 0 0 0 0-1.41l-1.34-1.34a1 1 0 0 0-1.41 0l-1.13 1.13 3.75 3.75L21 5.75Z" fill="currentColor" />
                        </svg>
                      </button>
                    </div>
                    <div className="pb-1">
                      <p className="text-xl font-semibold leading-tight">{learnerName}</p>
                      <div className="mt-1 flex items-center gap-2 text-sm text-blue-100/80">
                        <span>{roleFlagText}</span>
                        {isVerifiedAccount && (
                          <span
                            className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-blue-500 text-white"
                            aria-label="Verified"
                            title="Verified"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                              <path d="M9.0 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" fill="currentColor" />
                            </svg>
                          </span>
                        )}
                      </div>

                      <div className="mt-1">
                        {statusBioEditing ? (
                          <div className="flex items-center gap-2">
                            <input
                              value={statusBioDraft}
                              maxLength={100}
                              disabled={statusBioSaving}
                              autoFocus
                              onChange={(e) => setStatusBioDraft(e.target.value)}
                              onKeyDown={async (e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  const ok = await saveStatusBio(statusBioDraft)
                                  if (ok) setStatusBioEditing(false)
                                }
                                if (e.key === 'Escape') {
                                  e.preventDefault()
                                  setStatusBioDraft(profileStatusBio || '')
                                  setStatusBioEditing(false)
                                }
                              }}
                              onBlur={async () => {
                                const ok = await saveStatusBio(statusBioDraft)
                                if (ok) setStatusBioEditing(false)
                              }}
                              className="w-full max-w-[240px] rounded-xl border border-white/15 bg-white/10 backdrop-blur px-3 py-2 text-sm text-white placeholder:text-white/60 focus:outline-none focus:ring-2 focus:ring-white/20"
                              placeholder="Set a short status…"
                              aria-label="Status or short bio"
                            />
                            <span className="text-xs text-white/60 tabular-nums">{Math.min(statusBioDraft.length, 100)}/100</span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="text-left text-sm text-white/85 hover:text-white"
                            onClick={() => {
                              setStatusBioDraft(profileStatusBio || '')
                              setStatusBioEditing(true)
                            }}
                            aria-label="Edit status"
                          >
                            {profileStatusBio ? profileStatusBio : <span className="text-white/60">Set a short status…</span>}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="absolute inset-x-0 top-3 z-10 flex flex-col items-center justify-center px-5">
                    <BrandLogo height={44} className="drop-shadow-[0_20px_45px_rgba(3,5,20,0.6)]" />
                    <div className="mt-1 flex items-center justify-center gap-6 whitespace-nowrap text-center text-[20px] font-medium leading-none text-white/95">
                      <span className="tracking-[0.10em]">P H I L A N I</span>
                      <span className="tracking-[0.10em]">A C A D E M Y</span>
                    </div>
                  </div>
                  </section>
                </div>
              </div>

              <div
                className="pt-[244px] space-y-5"
                style={{
                  WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 200px, rgba(0,0,0,1) 300px)',
                  maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 200px, rgba(0,0,0,1) 300px)',
                  WebkitMaskRepeat: 'no-repeat',
                  maskRepeat: 'no-repeat',
                  WebkitMaskSize: '100% 100%',
                  maskSize: '100% 100%',
                }}
              >
                {renderStudentQuickActionsRow()}

                <div
                  ref={studentMobilePanelsRef}
                  onScroll={onStudentPanelsScroll}
                  className="mobile-section-rail flex overflow-x-auto snap-x snap-mandatory"
                  style={{ WebkitOverflowScrolling: 'touch', overscrollBehaviorX: 'contain' }}
                >
                  <div
                    ref={el => {
                      studentMobilePanelRefs.current.timeline = el
                    }}
                    className="mobile-section-rail__panel snap-start"
                    style={{ scrollSnapStop: 'always' }}
                  >
                    {renderStudentTimelinePanel()}
                  </div>

                  <div
                    ref={el => {
                      studentMobilePanelRefs.current.sessions = el
                    }}
                    className="mobile-section-rail__panel snap-start"
                    style={{ scrollSnapStop: 'always' }}
                  >
                    {renderSection('sessions')}
                  </div>

                  <div
                    ref={el => {
                      studentMobilePanelRefs.current.groups = el
                    }}
                    className="mobile-section-rail__panel snap-start"
                    style={{ scrollSnapStop: 'always' }}
                  >
                    {renderSection('groups')}
                  </div>

                  <div
                    ref={el => {
                      studentMobilePanelRefs.current.discover = el
                    }}
                    className="mobile-section-rail__panel snap-start"
                    style={{ scrollSnapStop: 'always' }}
                  >
                    {renderSection('discover')}
                  </div>
                </div>

                {status === 'authenticated' && (
                  <div className="pt-2 flex justify-center">
                    <button
                      type="button"
                      className="bg-transparent border-0 p-2 text-sm font-semibold text-white/70 hover:text-white focus:outline-none focus-visible:underline"
                      onClick={() => signOut({ callbackUrl: '/' })}
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col py-4">
              {mobilePanels.announcements && (
                <FullScreenGlassOverlay
                  title="Announcements"
                  onClose={closeMobileAnnouncements}
                  onBackdropClick={closeMobileAnnouncements}
                  zIndexClassName="z-50"
                  className={`transition-opacity duration-200 ${topStackOverlayOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
                  panelClassName="rounded-3xl bg-[#06184a]"
                  contentClassName="p-0"
                >
                  <div className="p-4">
                    <AnnouncementsSection />
                  </div>
                </FullScreenGlassOverlay>
              )}

              <div className="fixed inset-x-0 mobile-rail-fixed top-[0.9rem] z-30">
              <div className="relative">
              <section
                data-mobile-chrome-ignore
                className={`relative overflow-hidden rounded-3xl border border-white/10 px-5 py-6 text-center shadow-2xl h-[236px] ${mobileHeroBgDragActive ? 'ring-2 ring-white/40' : ''}`}
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
                <input
                  ref={themeBgInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) applyMobileThemeBackgroundFile(file)
                    e.target.value = ''
                  }}
                />

                <button
                  type="button"
                  aria-label="Edit theme background"
                  className={`absolute top-3 right-3 inline-flex items-center justify-center h-10 w-10 rounded-xl border border-white/20 bg-white/10 backdrop-blur transition-opacity ${mobileHeroBgEditVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    themeBgInputRef.current?.click()
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm18-11.5a1 1 0 0 0 0-1.41l-1.34-1.34a1 1 0 0 0-1.41 0l-1.13 1.13 3.75 3.75L21 5.75Z" fill="currentColor" />
                  </svg>
                </button>

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
                  <div className="relative group w-20 h-20" data-avatar-edit-container="1">
                    <button
                      type="button"
                      className="w-20 h-20 rounded-full border border-white/25 bg-white/5 flex items-center justify-center text-2xl font-semibold text-white overflow-hidden"
                      onClick={() => setAvatarEditArmed(v => !v)}
                      disabled={avatarUploading}
                      aria-label="Edit avatar"
                    >
                      {effectiveAvatarUrl ? (
                        <img src={effectiveAvatarUrl} alt={learnerName} className="w-full h-full object-cover" />
                      ) : (
                        <span>{learnerInitials}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label="Update avatar"
                      className={`absolute -bottom-1 -right-1 inline-flex items-center justify-center h-9 w-9 rounded-xl border border-white/20 bg-white/10 backdrop-blur transition-opacity ${avatarUploading || avatarEditArmed ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto'}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setAvatarEditArmed(false)
                        avatarInputRef.current?.click()
                      }}
                      disabled={avatarUploading}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm18-11.5a1 1 0 0 0 0-1.41l-1.34-1.34a1 1 0 0 0-1.41 0l-1.13 1.13 3.75 3.75L21 5.75Z" fill="currentColor" />
                      </svg>
                    </button>
                  </div>
                  <div className="pb-1">
                    <p className="text-xl font-semibold leading-tight">{learnerName}</p>
                    <div className="mt-1 flex items-center gap-2 text-sm text-blue-100/80">
                      <span>{roleFlagText}</span>
                      {isVerifiedAccount && (
                        <span
                          className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-blue-500 text-white"
                          aria-label="Verified"
                          title="Verified"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M9.0 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" fill="currentColor" />
                          </svg>
                        </span>
                      )}
                    </div>

                    <div className="mt-1">
                      {statusBioEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            value={statusBioDraft}
                            maxLength={100}
                            disabled={statusBioSaving}
                            autoFocus
                            onChange={(e) => setStatusBioDraft(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                const ok = await saveStatusBio(statusBioDraft)
                                if (ok) setStatusBioEditing(false)
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault()
                                setStatusBioDraft(profileStatusBio || '')
                                setStatusBioEditing(false)
                              }
                            }}
                            onBlur={async () => {
                              const ok = await saveStatusBio(statusBioDraft)
                              if (ok) setStatusBioEditing(false)
                            }}
                            className="w-full max-w-[240px] rounded-xl border border-white/15 bg-white/10 backdrop-blur px-3 py-2 text-sm text-white placeholder:text-white/60 focus:outline-none focus:ring-2 focus:ring-white/20"
                            placeholder="Set a short status…"
                            aria-label="Status or short bio"
                          />
                          <span className="text-xs text-white/60 tabular-nums">{Math.min(statusBioDraft.length, 100)}/100</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="text-left text-sm text-white/85 hover:text-white"
                          onClick={() => {
                            setStatusBioDraft(profileStatusBio || '')
                            setStatusBioEditing(true)
                          }}
                          aria-label="Edit status"
                        >
                          {profileStatusBio ? profileStatusBio : <span className="text-white/60">Set a short status…</span>}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="absolute inset-x-0 top-3 z-10 flex flex-col items-center justify-center px-5">
                  <BrandLogo height={44} className="drop-shadow-[0_20px_45px_rgba(3,5,20,0.6)]" />
                  <div className="mt-1 flex items-center justify-center gap-6 whitespace-nowrap text-center text-[20px] font-medium leading-none text-white/95">
                    <span className="tracking-[0.10em]">P H I L A N I</span>
                    <span className="tracking-[0.10em]">A C A D E M Y</span>
                  </div>
                </div>
              </section>
              </div>
              </div>

              <div
                className="pt-[244px] space-y-5"
                style={{
                  WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 200px, rgba(0,0,0,1) 300px)',
                  maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 200px, rgba(0,0,0,1) 300px)',
                  WebkitMaskRepeat: 'no-repeat',
                  maskRepeat: 'no-repeat',
                  WebkitMaskSize: '100% 100%',
                  maskSize: '100% 100%',
                }}
              >
              {renderStudentQuickActionsRow()}

              <div
                ref={studentMobilePanelsRef}
                onScroll={onStudentPanelsScroll}
                className="mobile-section-rail flex overflow-x-auto snap-x snap-mandatory"
                style={{ WebkitOverflowScrolling: 'touch', overscrollBehaviorX: 'contain' }}
              >
                <div
                  ref={el => {
                    studentMobilePanelRefs.current.timeline = el
                  }}
                  className="mobile-section-rail__panel snap-start"
                  style={{ scrollSnapStop: 'always' }}
                >
                  {renderStudentTimelinePanel()}
                </div>

                <div
                  ref={el => {
                    studentMobilePanelRefs.current.sessions = el
                  }}
                  className="mobile-section-rail__panel snap-start"
                  style={{ scrollSnapStop: 'always' }}
                >
                  {renderSection('sessions')}
                </div>

                <div
                  ref={el => {
                    studentMobilePanelRefs.current.groups = el
                  }}
                  className="mobile-section-rail__panel snap-start"
                  style={{ scrollSnapStop: 'always' }}
                >
                  {renderSection('groups')}
                </div>

                <div
                  ref={el => {
                    studentMobilePanelRefs.current.discover = el
                  }}
                  className="mobile-section-rail__panel snap-start"
                  style={{ scrollSnapStop: 'always' }}
                >
                  {renderSection('discover')}
                </div>
              </div>

              {status === 'authenticated' && (
                <div className="pt-2 flex justify-center">
                  <button
                    type="button"
                    className="bg-transparent border-0 p-2 text-sm font-semibold text-white/70 hover:text-white focus:outline-none focus-visible:underline"
                    onClick={() => signOut({ callbackUrl: '/' })}
                  >
                    Sign out
                  </button>
                </div>
              )}
              </div>
            </div>
          )
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

            {renderTimelineCard()}

            <SectionNav />

            <section className="min-w-0 space-y-6">
              <OverviewSection />
            </section>
          </>
        )}
      </div>

      {booksOverlayOpen && (
        <FullScreenGlassOverlay
          title="Books & materials"
          subtitle={selectedGrade ? gradeToLabel(selectedGrade) : 'Select a grade'}
          onClose={() => setBooksOverlayOpen(false)}
          onBackdropClick={() => setBooksOverlayOpen(false)}
          zIndexClassName="z-50"
          rightActions={
            <button
              type="button"
              className="btn btn-ghost text-xs"
              onClick={() => void fetchBooksForGrade()}
              disabled={booksLoading}
            >
              {booksLoading ? 'Loading…' : 'Refresh'}
            </button>
          }
        >
          <div className="space-y-3">
            {booksError ? <div className="text-sm text-red-200">{booksError}</div> : null}
            {booksLoading ? <div className="text-sm muted">Loading…</div> : null}
            {!booksLoading && !booksError && booksItems.length === 0 ? (
              <div className="text-sm muted">No materials available yet.</div>
            ) : null}

            {booksItems.length > 0 ? (
              <ul className="space-y-2">
                {booksItems.map((item) => {
                  const savedOffline = item.url ? isDocSavedOffline(item.url) : false
                  const savingOffline = item.url ? offlineDocSavingUrls.includes(item.url) : false
                  const offlineError = item.url ? offlineDocErrorByUrl[item.url] : ''
                  return (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/5 p-3"
                    >
                      <div className="min-w-0">
                        {isPdfResource(item) ? (
                          <button
                            type="button"
                            className="font-medium text-white text-left hover:underline whitespace-normal break-words block"
                            onClick={() => openPdfViewer(item)}
                          >
                            {item.title}
                          </button>
                        ) : (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-white hover:underline whitespace-normal break-words block"
                          >
                            {item.title}
                          </a>
                        )}
                        <div className="text-xs muted truncate">
                          {item.tag ? `${item.tag} • ` : ''}
                          {gradeToLabel(item.grade)}
                        </div>
                        {offlineError ? <div className="text-xs text-amber-200 mt-1">{offlineError}</div> : null}
                      </div>
                      {item.url ? (
                        <div className="flex items-center gap-2">
                          {savedOffline ? (
                            <button
                              type="button"
                              className="btn btn-ghost text-xs"
                              onClick={() => void removeDocOffline(item)}
                            >
                              Remove offline
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-ghost text-xs"
                              onClick={() => void saveDocOffline(item)}
                              disabled={savingOffline}
                            >
                              {savingOffline ? 'Saving…' : 'Save offline'}
                            </button>
                          )}
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        </FullScreenGlassOverlay>
      )}

      {pdfViewerOpen ? (
        <PdfViewerOverlay
          open={pdfViewerOpen}
          url={pdfViewerUrl}
          title={pdfViewerTitle}
          subtitle={pdfViewerSubtitle || undefined}
          initialState={pdfViewerInitialState || undefined}
          onPostImage={handlePdfPostCapture}
          onClose={() => {
            setPdfViewerOpen(false)
            if (pdfViewerOfflineObjectUrl) {
              URL.revokeObjectURL(pdfViewerOfflineObjectUrl)
              setPdfViewerOfflineObjectUrl(null)
            }
          }}
        />
      ) : null}

      {dashboardSectionOverlay && (
        <FullScreenGlassOverlay
          title={(DASHBOARD_SECTIONS as readonly any[]).find(s => s.id === dashboardSectionOverlay)?.label || 'Section'}
          onClose={closeDashboardOverlay}
          onBackdropClick={closeDashboardOverlay}
          zIndexClassName="z-40"
          className={`transition-opacity duration-200 ${topStackOverlayOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        >
          {renderSection(dashboardSectionOverlay)}
        </FullScreenGlassOverlay>
      )}

      {createOverlayOpen && (
        <OverlayPortal>
          <FullScreenGlassOverlay
            title={editingChallengeId ? 'Challenge' : 'Challenge'}
            onClose={closeCreateOverlay}
            onBackdropClick={closeCreateOverlay}
            zIndexClassName="z-[70]"
            contentClassName="p-0 flex flex-col overflow-hidden"
          >
            <div className="p-0 overflow-hidden flex flex-col flex-1 min-h-0">
              <input
                ref={challengeUploadInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => void onChallengeFilePicked(e)}
              />

              <div className="px-4 py-4 sm:px-6 sm:py-5">
                <div className="flex items-start gap-3">
                  {learnerAvatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={learnerAvatarUrl}
                      alt=""
                      className="h-10 w-10 rounded-full object-cover border border-white/10 bg-white/10 shrink-0"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-sm font-semibold text-white/90 shrink-0">
                      {String(session?.user?.name || session?.user?.email || 'P')[0]?.toUpperCase?.() || 'P'}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-white/90 font-semibold">Post a challenge</div>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3">
                  <input
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-blue-400/30"
                    placeholder="Title (optional)"
                    value={challengeTitleDraft}
                    onChange={(e) => setChallengeTitleDraft(e.target.value)}
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-white/80">
                        <path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      <span className="text-xs text-white/70">Type</span>
                      <select
                        className="bg-transparent text-sm text-white focus:outline-none"
                        value={createKind}
                        onChange={(e) => setCreateKind(e.target.value as any)}
                      >
                        <option value="quiz">Quiz</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-white/80">
                        <path d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.364-6.364-2.121 2.121M7.757 16.243l-2.121 2.121m12.728 0-2.121-2.121M7.757 7.757 5.636 5.636" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      <span className="text-xs text-white/70">Max attempts</span>
                      <select
                        className="bg-transparent text-sm text-white focus:outline-none"
                        value={challengeMaxAttempts}
                        onChange={(e) => setChallengeMaxAttempts(e.target.value)}
                      >
                        <option value="unlimited">Unlimited</option>
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="5">5</option>
                        <option value="10">10</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-4 py-4 sm:px-6 sm:py-5 flex flex-col gap-3 flex-1 min-h-0">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 flex flex-col min-h-[240px] overflow-hidden">
                  <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto">
                    <textarea
                      className="w-full min-h-[160px] resize-none bg-transparent text-[15px] leading-relaxed text-white placeholder:text-white/50 focus:outline-none"
                      placeholder="Write the question (LaTeX supported)… or attach a screenshot below"
                      value={challengePromptDraft}
                      onChange={(e) => setChallengePromptDraft(e.target.value)}
                    />

                    {challengeImageUrl ? (
                      <div
                        className="w-full cursor-pointer"
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (!challengeImageSourceFile) return
                          setChallengeImageEditFile(challengeImageSourceFile)
                          setChallengeImageEditOpen(true)
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return
                          if (!challengeImageSourceFile) return
                          e.preventDefault()
                          setChallengeImageEditFile(challengeImageSourceFile)
                          setChallengeImageEditOpen(true)
                        }}
                        aria-label="Edit uploaded screenshot"
                        title={challengeImageSourceFile ? 'Edit screenshot' : 'Screenshot'}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={challengeImageUrl} alt="Uploaded" className="max-h-[260px] w-full rounded-lg object-contain" />
                      </div>
                    ) : null}
                  </div>
                </div>

                {challengeParsedOpen && challengeParsedJsonText ? (
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <pre className="whitespace-pre-wrap text-xs text-white/90">{challengeParsedJsonText}</pre>
                  </div>
                ) : null}
              </div>

              <div className="px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between gap-3 min-w-0">
                <div className="flex items-center gap-2 min-w-0 overflow-x-auto">
                  <button
                    type="button"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/90 hover:bg-white/10 disabled:opacity-50"
                    onClick={() => challengeUploadInputRef.current?.click()}
                    disabled={challengeUploading}
                    aria-label={challengeUploading ? 'Uploading screenshot' : 'Upload screenshot'}
                    title={challengeUploading ? 'Uploading…' : 'Upload screenshot'}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M4 7a2 2 0 0 1 2-2h2l1-1h6l1 1h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="2" />
                      <path d="M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="2" />
                    </svg>
                  </button>

                  <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 select-none">
                    <input
                      type="checkbox"
                      checked={challengeParseOnUpload}
                      onChange={(e) => setChallengeParseOnUpload(e.target.checked)}
                    />
                    Parse
                  </label>

                  <button
                    type="button"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/90 hover:bg-white/10 disabled:opacity-50"
                    onClick={() => setChallengeParsedOpen((v) => !v)}
                    disabled={!challengeParsedJsonText}
                    aria-label={challengeParsedOpen ? 'Hide parsed content' : 'View parsed content'}
                    title={challengeParsedOpen ? 'Hide parsed' : 'View parsed'}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M8 5H6a2 2 0 0 0-2 2v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M16 5h2a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M8 19H6a2 2 0 0 1-2-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M16 19h2a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M9 9h6M9 12h6M9 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>

                  <button
                    type="button"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/90 hover:bg-white/10 disabled:opacity-50"
                    onClick={() => {
                      setChallengeImageUrl(null)
                      setChallengeImageSourceFile(null)
                      setChallengeParsedJsonText(null)
                      setChallengeParsedOpen(false)
                    }}
                    disabled={!challengeImageUrl || challengeUploading}
                    aria-label="Clear screenshot"
                    title="Clear screenshot"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M3 6h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M8 6V4h8v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M7 6l1 16h8l1-16" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="relative">
                    <button
                      type="button"
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/90 hover:bg-white/10"
                      onClick={() => setChallengeAudiencePickerOpen((v) => !v)}
                      aria-label="Change audience"
                      title="Change audience"
                    >
                      {challengeAudienceDraft === 'public' ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" stroke="currentColor" strokeWidth="2" />
                          <path d="M2 12h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M12 2c3.5 3.2 3.5 16.8 0 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M12 2c-3.5 3.2-3.5 16.8 0 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      ) : challengeAudienceDraft === 'grade' ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M16 11c1.66 0 3-1.34 3-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3Z" stroke="currentColor" strokeWidth="2" />
                          <path d="M8 11c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Z" stroke="currentColor" strokeWidth="2" />
                          <path d="M8 13c-2.76 0-5 1.79-5 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M16 13c2.76 0 5 1.79 5 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4Z" stroke="currentColor" strokeWidth="2" />
                          <path d="M12 14c-3.31 0-6 2.01-6 4.5V21h12v-2.5c0-2.49-2.69-4.5-6-4.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M7 11V8a5 5 0 0 1 10 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M6 11h12v10H6V11Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                          <path d="M12 15v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      )}
                    </button>

                    {challengeAudiencePickerOpen ? (
                      <div className="absolute right-0 bottom-full mb-2 w-48 rounded-2xl border border-white/10 bg-[rgba(2,6,24,0.96)] shadow-[0_25px_70px_rgba(0,0,0,0.55)] overflow-hidden">
                        <button
                          type="button"
                          className={`w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-white/10 ${challengeAudienceDraft === 'public' ? 'bg-white/10' : ''}`}
                          onClick={() => {
                            setChallengeAudienceDraft('public')
                            setChallengeAudiencePickerOpen(false)
                          }}
                        >
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/90">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" stroke="currentColor" strokeWidth="2" />
                              <path d="M2 12h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              <path d="M12 2c3.5 3.2 3.5 16.8 0 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              <path d="M12 2c-3.5 3.2-3.5 16.8 0 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          </span>
                          <span className="text-white/90">Public</span>
                        </button>

                        <button
                          type="button"
                          className={`w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-white/10 ${challengeAudienceDraft === 'grade' ? 'bg-white/10' : ''}`}
                          onClick={() => {
                            setChallengeAudienceDraft('grade')
                            setChallengeAudiencePickerOpen(false)
                          }}
                        >
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/90">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path d="M16 11c1.66 0 3-1.34 3-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3Z" stroke="currentColor" strokeWidth="2" />
                              <path d="M8 11c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Z" stroke="currentColor" strokeWidth="2" />
                              <path d="M8 13c-2.76 0-5 1.79-5 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              <path d="M16 13c2.76 0 5 1.79 5 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4Z" stroke="currentColor" strokeWidth="2" />
                              <path d="M12 14c-3.31 0-6 2.01-6 4.5V21h12v-2.5c0-2.49-2.69-4.5-6-4.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                            </svg>
                          </span>
                          <span className="text-white/90">My grade</span>
                        </button>

                        <button
                          type="button"
                          className={`w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-white/10 ${challengeAudienceDraft === 'private' ? 'bg-white/10' : ''}`}
                          onClick={() => {
                            setChallengeAudienceDraft('private')
                            setChallengeAudiencePickerOpen(false)
                          }}
                        >
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/90">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path d="M7 11V8a5 5 0 0 1 10 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              <path d="M6 11h12v10H6V11Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                              <path d="M12 15v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          </span>
                          <span className="text-white/90">Private</span>
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={challengePosting || challengeUploading}
                    onClick={() => void postChallenge()}
                  >
                    {challengePosting ? (editingChallengeId ? 'Saving…' : 'Posting…') : (editingChallengeId ? 'Save' : 'Post')}
                  </button>
                </div>
              </div>
            </div>
          </FullScreenGlassOverlay>
        </OverlayPortal>
      )}

      <ImageCropperModal
        open={challengeImageEditOpen}
        file={challengeImageEditFile}
        title="Edit screenshot"
        onCancel={cancelChallengeImageEdit}
        onUseOriginal={(file: File) => void confirmChallengeImageEdit(file)}
        onConfirm={(file: File) => void confirmChallengeImageEdit(file)}
        confirmLabel="Upload"
      />

      {timelineOpen && (
        <OverlayPortal>
          <FullScreenGlassOverlay
            title="My posts"
            onClose={() => setTimelineOpen(false)}
            onBackdropClick={() => setTimelineOpen(false)}
            zIndexClassName="z-[55]"
          >
            <div className="space-y-3">
              {timelineChallengesError ? (
                <div className="text-sm text-red-400">{timelineChallengesError}</div>
              ) : timelineChallengesLoading ? (
                <div className="text-sm text-white/70">Loading…</div>
              ) : timelineChallenges.length === 0 ? (
                <div className="text-sm text-white/70">No quizzes yet.</div>
              ) : (
                renderTimelineItems(timelineChallenges)
              )}
            </div>
          </FullScreenGlassOverlay>
        </OverlayPortal>
      )}

      <GradePillSelector
        open={gradeWorkspaceSelectorOpen}
        anchorRect={gradeWorkspaceSelectorAnchor}
        values={GRADE_VALUES}
        selected={selectedGrade}
        labelForValue={(g) => {
          const numeric = String(g).replace('GRADE_', '')
          return numeric.length === 1 ? `0${numeric}` : numeric
        }}
        onSelect={(g) => {
          setGradeWorkspaceSelectorPreview(null)
          updateGradeSelection(g)
        }}
        onClose={() => {
          setGradeWorkspaceSelectorOpen(false)
          setGradeWorkspaceSelectorExternalDrag(null)
          setGradeWorkspaceSelectorPreview(null)
        }}
        externalDrag={gradeWorkspaceSelectorExternalDrag}
        onExternalDragEnd={() => setGradeWorkspaceSelectorExternalDrag(null)}
        onPreview={(g) => setGradeWorkspaceSelectorPreview(g)}
        autoCloseMs={2500}
        anchorX="left"
        anchorY="bottom"
        offsetXPx={0}
        offsetYPx={6}
        nudgeTowardCenterFraction={0.25}
      />

      {isMobile && studentQuickOverlay && (
        <FullScreenGlassOverlay
          title={
            studentQuickOverlay === 'timeline'
              ? 'Timeline'
              : studentQuickOverlay === 'admin'
                ? 'Admin tools'
              : (DASHBOARD_SECTIONS as readonly any[]).find(s => s.id === studentQuickOverlay)?.label || 'Section'
          }
          onClose={closeStudentQuickOverlay}
          onBackdropClick={closeStudentQuickOverlay}
          zIndexClassName="z-50"
          className={`transition-opacity duration-200 ${topStackOverlayOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        >
          <div className="space-y-3">
            {studentQuickOverlay === 'timeline'
              ? renderTimelineCard()
              : studentQuickOverlay === 'admin'
                ? renderAdminToolsQuickPanel()
                : renderSection(studentQuickOverlay)}
          </div>
        </FullScreenGlassOverlay>
      )}

      {accountSnapshotOverlayOpen && (
        <FullScreenGlassOverlay
          title="Account snapshot"
          onClose={() => setAccountSnapshotOverlayOpen(false)}
          onBackdropClick={() => setAccountSnapshotOverlayOpen(false)}
          zIndexClassName="z-40"
          className={`transition-opacity duration-200 ${topStackOverlayOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        >
          <div className="space-y-3">{renderAccountSnapshotBody()}</div>
        </FullScreenGlassOverlay>
      )}

      {!isAdmin && isMobile && mobilePanels.sessions && (
        <FullScreenGlassOverlay
          title="Sessions"
          onClose={() => setMobilePanels(prev => ({ ...prev, sessions: false }))}
          onBackdropClick={() => setMobilePanels(prev => ({ ...prev, sessions: false }))}
          zIndexClassName="z-50"
          className={`transition-opacity duration-200 ${topStackOverlayOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        >
          {renderSessionsSection()}
        </FullScreenGlassOverlay>
      )}
      </main>
      {liveOverlayOpen && (
        <div
          className={`live-call-overlay${liveWindows.some(win => win.kind === 'canvas' && !win.minimized) ? ' live-call-overlay--canvas-open' : ''}${liveOverlayChromeVisible ? ' live-call-overlay--chrome-visible' : ''}`}
          role="dialog"
          aria-modal="true"
        >
          <div className="live-call-overlay__backdrop" />
          <div className="live-call-overlay__panel" ref={stageRef}>
            <div className="live-call-overlay__video relative">
              {/** When the canvas window is open, mount overlays inside the canvas to avoid duplicate prompt boxes. */}
              {/** (Otherwise the same TextOverlayModule renders twice: here and in StackedCanvasWindow.) */}
              {(() => {
                const canvasOpen = liveWindows.some(win => win.kind === 'canvas' && !win.minimized)
                if (canvasOpen) return null
                return (
                  <>
              {activeSessionId && (
                <DiagramOverlayModule
                  boardId={String(activeSessionId)}
                  gradeLabel={selectedGrade ? activeGradeLabel : null}
                  userId={realtimeUserId}
                  userDisplayName={realtimeDisplayName}
                  isAdmin={isOwnerUser}
                />
              )}
              {activeSessionId && (
                <TextOverlayModule
                  boardId={String(activeSessionId)}
                  gradeLabel={selectedGrade ? activeGradeLabel : null}
                  userId={realtimeUserId}
                  userDisplayName={realtimeDisplayName}
                  isAdmin={isOwnerUser}
                />
              )}
                  </>
                )
              })()}
              {canJoinLiveClass && activeSessionId ? (
                (
                  <JitsiRoom
                    roomName={gradeRoomName}
                    displayName={session?.user?.name || session?.user?.email}
                    sessionId={activeSessionId}
                    tokenEndpoint={null}
                    passwordEndpoint={null}
                    isOwner={isOwnerUser}
                    showControls={false}
                    silentJoin
                    startWithAudioMuted
                    startWithVideoMuted
                    onControlsChange={setLiveControls}
                    onMuteStateChange={setLiveMuteState}
                    onParticipantEvent={bumpLiveParticipantsVersion}
                  />
                )
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
                    onRequestVideoOverlay={
                      win.kind === 'canvas' && !(win.isAdminOverride ?? isOwnerUser)
                        ? () => {
                          setLiveWindows(prev => prev.map(w => (w.id === win.id ? { ...w, minimized: true, z: getNextWindowZ() } : w)))
                        }
                        : undefined
                    }
                    onToggleTeacherAudio={
                      win.kind === 'canvas' && !(win.isAdminOverride ?? isOwnerUser)
                        ? handleToggleLiveTeacherAudio
                        : undefined
                    }
                    teacherAudioEnabled={
                      win.kind === 'canvas' && !(win.isAdminOverride ?? isOwnerUser)
                        ? liveTeacherAudioEnabled
                        : undefined
                    }
                    onToggleStudentMic={
                      win.kind === 'canvas'
                        ? handleToggleLiveStudentMic
                        : undefined
                    }
                    studentMicMuted={
                      win.kind === 'canvas'
                        ? liveMuteState.audioMuted
                        : undefined
                    }
                    onCloseOverlay={
                      win.kind === 'canvas' && !(win.isAdminOverride ?? isOwnerUser)
                        ? closeLiveOverlay
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
                        roomId={win.roomIdOverride ?? (activeSessionId ?? boardRoomId)}
                        boardId={win.boardIdOverride ?? (activeSessionId ?? undefined)}
                        userId={realtimeUserId}
                        userDisplayName={realtimeDisplayName}
                        isAdmin={win.isAdminOverride ?? isOwnerUser}
                        quizMode={Boolean(win.quizMode)}
                        isVisible={!win.minimized}
                        defaultOrientation="portrait"
                        autoOpenDiagramTray={Boolean(win.autoOpenDiagramTray)}
                        lessonAuthoring={win.lessonAuthoring}
                        onRequestVideoOverlay={() => {
                          setLiveWindows(prev => prev.map(w => (w.id === win.id ? { ...w, minimized: true, z: getNextWindowZ() } : w)))
                        }}
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

      {lessonAuthoringDiagramOverlay && (
        <div className="live-call-overlay live-call-overlay--canvas-open live-call-overlay--diagram-open" role="dialog" aria-modal="true">
          <button
            type="button"
            className="live-call-overlay__backdrop"
            onClick={() => setLessonAuthoringDiagramCloseSignal(v => v + 1)}
            aria-label="Close diagram editor"
          />
          <div className="live-call-overlay__panel">
            <div className="live-call-overlay__video relative">
              <DiagramOverlayModule
                boardId={lessonAuthoringDiagramOverlay.boardId}
                gradeLabel={null}
                userId={realtimeUserId}
                userDisplayName={realtimeDisplayName}
                isAdmin={isTeacherOrAdminUser}
                lessonAuthoring={{ phaseKey: lessonAuthoringDiagramOverlay.phaseKey, pointId: lessonAuthoringDiagramOverlay.pointId }}
                autoOpen
                onRequestClose={() => setLessonAuthoringDiagramOverlay(null)}
                closeSignal={lessonAuthoringDiagramCloseSignal}
              />

              <div className="live-call-overlay__floating-actions">
                <button
                  type="button"
                  className="live-call-overlay__close"
                  onClick={() => setLessonAuthoringDiagramCloseSignal(v => v + 1)}
                  aria-label="Close diagram editor"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {challengeGradingOverlayOpen && selectedChallengeId && (
        <OverlayPortal>
          <FullScreenGlassOverlay
            title={
              selectedSubmissionUserId
                ? (() => {
                    const userSubmission = challengeSubmissions.find((s: any) => String(s?.userId) === String(selectedSubmissionUserId))
                    const userName = userSubmission?.name || 'Student'
                    return `${userName}'s Response`
                  })()
                : 'Quiz Management'
            }
            subtitle={selectedSubmissionUserId ? 'View and grade response' : 'View student responses'}
            zIndexClassName="z-[60]"
            onClose={() => {
              suppressChallengeAutoOpenRef.current = true
              setChallengeGradingOverlayOpen(false)
              setSelectedChallengeId(null)
              setSelectedChallengeData(null)
              setSelectedSubmissionUserId(null)
              setSelectedSubmissionDetail(null)
              clearChallengeOverlayQuery()
            }}
          >
            <div className="space-y-3">
                  {!selectedSubmissionUserId && (
                    <div className="border border-white/10 rounded bg-white/5 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-sm">Actions</div>
                        <div className="text-xs text-white/60">
                          {challengeDeleting ? 'Working…' : selectedChallengeData ? 'Ready' : 'Loading…'}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn btn-primary btn-xs"
                          onClick={openEditSelectedChallenge}
                          disabled={!selectedChallengeData || challengeDeleting}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs text-red-300"
                          onClick={() => void deleteChallenge(selectedChallengeId)}
                          disabled={challengeDeleting}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}

                  {!selectedSubmissionUserId && (
                    <div className="border border-white/10 rounded bg-white/5 p-3 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-sm">Student Responses</div>
                        <button
                          type="button"
                          className="btn btn-ghost text-xs"
                          disabled={challengeSubmissionsLoading}
                          onClick={() => fetchChallengeSubmissions(selectedChallengeId)}
                        >
                          {challengeSubmissionsLoading ? 'Refreshing…' : 'Refresh'}
                        </button>
                      </div>

                      {challengeSubmissionsError ? (
                        <div className="text-sm text-red-600">{challengeSubmissionsError}</div>
                      ) : challengeSubmissions.length === 0 ? (
                        <div className="text-sm muted">No submissions yet.</div>
                      ) : (
                        <ul className="border border-white/10 rounded divide-y divide-white/10 overflow-hidden">
                          {challengeSubmissions.map((row: any) => (
                            <li key={String(row?.userId)} className="p-3 flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-medium break-words">{row?.name || 'User'}</div>
                                <div className="text-xs muted">
                                  {row?.lastSubmittedAt ? new Date(row.lastSubmittedAt).toLocaleString() : ''}
                                  {row?.submissions ? ` • ${row.submissions} submission${row.submissions > 1 ? 's' : ''}` : ''}
                                </div>
                              </div>
                              <button
                                type="button"
                                className="btn btn-ghost text-xs shrink-0"
                                onClick={() => {
                                  openChallengeSubmissionForGrading(selectedChallengeId, String(row?.userId || ''))
                                }}
                              >
                                View
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                    {selectedSubmissionUserId && selectedSubmissionDetail ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-semibold text-sm">Submissions</div>
                          <button
                            type="button"
                            className="btn btn-ghost text-xs"
                            onClick={() => {
                              setSelectedSubmissionUserId(null)
                              setSelectedSubmissionDetail(null)
                            }}
                          >
                            Back to List
                          </button>
                        </div>

                        {selectedSubmissionError ? (
                          <div className="text-sm text-red-600">{selectedSubmissionError}</div>
                        ) : selectedSubmissionLoading ? (
                          <div className="text-sm muted">Loading responses…</div>
                        ) : (
                          <div className="space-y-2">
                            {Array.isArray(selectedSubmissionDetail?.responses) &&
                            selectedSubmissionDetail.responses.length > 0 ? (
                              selectedSubmissionDetail.responses.map((resp: any, idx: number) => (
                                <div key={resp.id || idx} className="border border-white/10 rounded bg-white/5 p-3 space-y-2">
                                  <div className="text-xs text-white/60">
                                    {resp.createdAt ? new Date(resp.createdAt).toLocaleString() : 'Unknown'}
                                  </div>
                                  <div className="text-sm">
                                    <strong>Response:</strong>
                                    {(() => {
                                      const latex = String(resp.latex || '')
                                      const steps = splitLatexIntoSteps(latex)
                                      const grade = normalizeChallengeGrade(resp.gradingJson, steps.length)
                                      const stepGradeByIndex = new Map<number, any>()
                                      if (grade?.steps) {
                                        grade.steps.forEach((s: any) => {
                                          const stepNum = Number(s?.step)
                                          if (Number.isFinite(stepNum) && stepNum > 0) stepGradeByIndex.set(Math.trunc(stepNum) - 1, s)
                                        })
                                      }
                                      const html = latex.trim() ? renderKatexDisplayHtml(latex) : ''
                                      if (!latex.trim()) {
                                        return (
                                          <div className="mt-2 text-white/80 whitespace-pre-wrap break-words">
                                            (empty)
                                          </div>
                                        )
                                      }
                                      if (steps.length) {
                                        return (
                                          <div className="mt-2 space-y-2">
                                            {steps.map((stepLatex: string, stepIdx: number) => {
                                              const g = stepGradeByIndex.get(stepIdx)
                                              const awardedMarks = Number(g?.awardedMarks ?? 0)
                                              const awardedInt = Number.isFinite(awardedMarks) ? Math.max(0, Math.trunc(awardedMarks)) : 0
                                              const isCorrect = (typeof g?.isCorrect === 'boolean') ? Boolean(g.isCorrect) : (awardedInt > 0)
                                              const isSignificant = (typeof g?.isSignificant === 'boolean') ? Boolean(g.isSignificant) : (!isCorrect)
                                              const feedbackText = String(g?.feedback ?? '').trim()
                                              const stepHtml = renderKatexDisplayHtml(stepLatex)
                                              const line = stepHtml
                                                ? <div className={isCorrect ? 'leading-relaxed' : 'leading-relaxed underline decoration-red-500'} dangerouslySetInnerHTML={{ __html: stepHtml }} />
                                                : <div className={isCorrect ? 'text-xs font-mono whitespace-pre-wrap break-words' : 'text-xs font-mono whitespace-pre-wrap break-words underline decoration-red-500'}>{stepLatex}</div>

                                              return (
                                                <div key={`challenge-step-${resp.id || idx}-${stepIdx}`} className="flex items-start gap-3">
                                                  <div className="min-w-0 flex-1">{line}</div>
                                                  {g ? (
                                                    <div className="shrink-0 flex items-start gap-2">
                                                      {awardedInt > 0 ? (
                                                        <span className="text-green-500 flex items-center" aria-label={`${awardedInt} mark${awardedInt === 1 ? '' : 's'} earned`} title={`${awardedInt} mark${awardedInt === 1 ? '' : 's'}`}>
                                                          {Array.from({ length: Math.min(awardedInt, 12) }).map((_, j) => (
                                                            <svg key={`tick-${resp.id || idx}-${stepIdx}-${j}`} viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
                                                              <path
                                                                d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.12 7.18a1 1 0 0 1-1.42.006L3.29 9.01a1 1 0 1 1 1.414-1.414l3.17 3.17 6.412-6.47a1 1 0 0 1 1.418-.006z"
                                                                fill="currentColor"
                                                              />
                                                            </svg>
                                                          ))}
                                                          {awardedInt > 12 ? (
                                                            <span className="text-xs text-white/70 ml-1">+{awardedInt - 12}</span>
                                                          ) : null}
                                                        </span>
                                                      ) : isCorrect ? (
                                                        <span className="text-green-500" aria-label="Correct but 0 marks" title="Correct but 0 marks">
                                                          <svg viewBox="0 0 10 10" className="w-2 h-2" aria-hidden="true">
                                                            <circle cx="5" cy="5" r="4" fill="currentColor" />
                                                          </svg>
                                                        </span>
                                                      ) : (
                                                        isSignificant ? (
                                                          <span className="text-red-500" aria-label="Incorrect significant step" title="Incorrect (significant)">
                                                            <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
                                                              <path
                                                                d="M6.293 6.293a1 1 0 0 1 1.414 0L10 8.586l2.293-2.293a1 1 0 1 1 1.414 1.414L11.414 10l2.293 2.293a1 1 0 0 1-1.414 1.414L10 11.414l-2.293 2.293a1 1 0 0 1-1.414-1.414L8.586 10 6.293 7.707a1 1 0 0 1 0-1.414z"
                                                                fill="currentColor"
                                                              />
                                                            </svg>
                                                          </span>
                                                        ) : (
                                                          <span className="text-red-500" aria-label="Incorrect insignificant step" title="Incorrect (insignificant)">
                                                            <svg viewBox="0 0 10 10" className="w-2 h-2" aria-hidden="true">
                                                              <circle cx="5" cy="5" r="4" fill="currentColor" />
                                                            </svg>
                                                          </span>
                                                        )
                                                      )}

                                                      {feedbackText ? (
                                                        <div className="text-xs text-white/70 max-w-[18rem] whitespace-pre-wrap break-words">
                                                          {feedbackText.slice(0, 160)}
                                                        </div>
                                                      ) : null}
                                                    </div>
                                                  ) : null}
                                                </div>
                                              )
                                            })}
                                          </div>
                                        )
                                      }

                                      return html ? (
                                        <div className="mt-2 leading-relaxed text-white/90" dangerouslySetInnerHTML={{ __html: html }} />
                                      ) : (
                                        <div className="mt-2 text-white/90 whitespace-pre-wrap break-words">
                                          {renderTextWithKatex(latex)}
                                        </div>
                                      )
                                    })()}
                                  </div>
                                  {resp.studentText ? (
                                    <div className="text-sm">
                                      <strong>Typed text:</strong>
                                      <div className="mt-1 text-white/80">{resp.studentText}</div>
                                    </div>
                                  ) : null}
                                  <div className="mt-2 flex items-center gap-2">
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-xs"
                                      onClick={() => openChallengeGrading(resp)}
                                    >
                                      Grade
                                    </button>
                                  </div>
                                  {(() => {
                                    const steps = splitLatexIntoSteps(resp.latex)
                                    const grade = normalizeChallengeGrade(resp.gradingJson, steps.length)
                                    if (!grade) return null
                                    return (
                                      <div className="mt-2 text-green-300 text-xs">
                                        Mark: {grade.earnedMarks}/{grade.totalMarks}
                                      </div>
                                    )
                                  })()}
                                  {resp.feedback && (
                                    <div className="mt-1 text-blue-200 text-xs">Feedback: {resp.feedback}</div>
                                  )}
                                </div>
                              ))
                            ) : (
                              <div className="text-sm muted">No responses found.</div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : null}
                  

                  {challengeGradingResponseId && activeChallengeGradingResponse && (
                    <OverlayPortal>
                      <FullScreenGlassOverlay
                        title="Grade Response"
                        subtitle="Step-by-step marking and feedback"
                        zIndexClassName="z-[80]"
                        onClose={closeChallengeGrading}
                        contentClassName="!p-0"
                      >
                        <div className="min-h-full flex flex-col">
                          <div className="flex-1 overflow-y-auto p-3 sm:p-5">
                            {(() => {
                              const steps = splitLatexIntoSteps(activeChallengeGradingResponse?.latex || '')
                              const stepCount = Math.max(1, steps.length || 0)
                              return (
                                <div className="space-y-3">
                                  {Array.from({ length: stepCount }, (_, stepIdx) => {
                                    const stepLatex = steps[stepIdx] || ''
                                    const stepHtml = stepLatex ? renderKatexDisplayHtml(stepLatex) : ''
                                    const selected = challengeGradingByStep[stepIdx] || null
                                    const selectGrade = (grade: string) => {
                                      setChallengeGradingByStep((g) => ({ ...g, [stepIdx]: grade }))
                                      setChallengeGradingStepMarks((m) => {
                                        const currentRaw = Number(m[stepIdx])
                                        const hasCurrent = Number.isFinite(currentRaw)
                                        const current = hasCurrent ? Math.max(0, Math.trunc(currentRaw)) : null

                                        // Default mark behaviors:
                                        // - tick: ensure at least 1 (unless the grader already set a higher mark)
                                        // - dots/cross: force 0 (prevents a previous tick mark from keeping the tick)
                                        if (grade === 'tick') {
                                          if (current == null || current <= 0) return { ...m, [stepIdx]: 1 }
                                          return m
                                        }
                                        if (grade === 'dot-green' || grade === 'cross' || grade === 'dot-red') {
                                          if (current === 0) return m
                                          return { ...m, [stepIdx]: 0 }
                                        }
                                        return m
                                      })
                                    }

                                    const pill = (isActive: boolean) => `btn btn-xs ${isActive ? 'btn-primary' : 'btn-ghost'} !px-2 !py-1`

                                    return (
                                      <div key={stepIdx} className="rounded-xl border border-white/10 bg-white/5 p-3">
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="text-sm font-semibold">Step {stepIdx + 1}</div>
                                        </div>

                                        {stepLatex ? (
                                          stepHtml ? (
                                            <div
                                              className="mt-2 rounded border border-white/10 bg-black/20 p-2"
                                              dangerouslySetInnerHTML={{ __html: stepHtml }}
                                            />
                                          ) : (
                                            <div className="mt-2 rounded border border-white/10 bg-black/20 p-2 text-xs font-mono whitespace-pre-wrap break-words">
                                              {stepLatex}
                                            </div>
                                          )
                                        ) : (
                                          <div className="mt-2 text-xs text-white/60">(empty step)</div>
                                        )}

                                        <div className="mt-3 flex flex-wrap gap-2">
                                          <button
                                            type="button"
                                            className={pill(selected === 'tick')}
                                            onClick={() => selectGrade('tick')}
                                            aria-pressed={selected === 'tick'}
                                            aria-label="Green tick"
                                            title="Correct"
                                          >
                                            <span role="img" aria-hidden="true">✅</span>
                                          </button>
                                          <button
                                            type="button"
                                            className={pill(selected === 'dot-green')}
                                            onClick={() => selectGrade('dot-green')}
                                            aria-pressed={selected === 'dot-green'}
                                            aria-label="Green dot"
                                            title="Correct (0 marks)"
                                          >
                                            <span role="img" aria-hidden="true">🟢</span>
                                          </button>
                                          <button
                                            type="button"
                                            className={pill(selected === 'cross')}
                                            onClick={() => selectGrade('cross')}
                                            aria-pressed={selected === 'cross'}
                                            aria-label="Red cross"
                                            title="Incorrect (significant)"
                                          >
                                            <span role="img" aria-hidden="true">❌</span>
                                          </button>
                                          <button
                                            type="button"
                                            className={pill(selected === 'dot-red')}
                                            onClick={() => selectGrade('dot-red')}
                                            aria-pressed={selected === 'dot-red'}
                                            aria-label="Red dot"
                                            title="Incorrect (insignificant)"
                                          >
                                            <span role="img" aria-hidden="true">🔴</span>
                                          </button>
                                        </div>

                                        <div className="mt-3 flex flex-wrap items-center gap-2">
                                          <label className="text-xs font-medium text-white/80">Marks</label>
                                          <input
                                            type="number"
                                            min={0}
                                            max={20}
                                            step={1}
                                            className="w-20 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-white"
                                            value={Number.isFinite(Number(challengeGradingStepMarks[stepIdx])) ? challengeGradingStepMarks[stepIdx] : ''}
                                            onChange={(e) => {
                                              const next = Number(e.target.value)
                                              if (!Number.isFinite(next)) {
                                                setChallengeGradingStepMarks((m) => {
                                                  const { [stepIdx]: _, ...rest } = m
                                                  return rest
                                                })
                                                return
                                              }
                                              setChallengeGradingStepMarks((m) => ({ ...m, [stepIdx]: Math.max(0, Math.trunc(next)) }))
                                            }}
                                          />
                                        </div>

                                        <div className="mt-3">
                                          <label className="block text-xs font-medium text-white/80 mb-1">Step feedback (optional)</label>
                                          <textarea
                                            className="w-full rounded border border-white/10 bg-white/5 p-2 text-xs text-white"
                                            rows={3}
                                            value={challengeGradingStepFeedback[stepIdx] || ''}
                                            onChange={(e) => setChallengeGradingStepFeedback((f) => ({ ...f, [stepIdx]: e.target.value }))}
                                          />
                                        </div>
                                      </div>
                                    )
                                  })}

                                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                                    <label className="block text-xs font-medium text-white/80 mb-1">Overall feedback (optional)</label>
                                    <textarea
                                      className="w-full rounded border border-white/10 bg-white/5 p-2 text-xs text-white"
                                      rows={4}
                                      value={challengeGradingFeedback}
                                      onChange={(e) => setChallengeGradingFeedback(e.target.value)}
                                    />
                                  </div>
                                </div>
                              )
                            })()}
                          </div>

                          <div className="p-3 border-t border-white/10 flex items-center justify-end gap-2">
                            <button type="button" className="btn btn-ghost" onClick={closeChallengeGrading}>
                              Cancel
                            </button>
                            <button type="button" className="btn btn-primary" onClick={saveChallengeGrading} disabled={challengeGradingSaving}>
                              {challengeGradingSaving ? 'Saving…' : 'Save grading'}
                            </button>
                          </div>
                        </div>
                      </FullScreenGlassOverlay>
                    </OverlayPortal>
                  )}

                  <div className="text-xs muted">
                    Note: Manual grading is available here; automated grading may be added in a future update.
                  </div>
                </div>
          </FullScreenGlassOverlay>
        </OverlayPortal>
      )}

      {challengeResponseOverlayOpen && selectedChallengeResponseId && (
        <OverlayPortal>
          <FullScreenGlassOverlay
            title={(challengeResponseChallenge?.title || 'Quiz') as any}
            subtitle="Your submission and feedback"
            zIndexClassName="z-[55]"
            onClose={() => {
              suppressChallengeAutoOpenRef.current = true
              setChallengeResponseOverlayOpen(false)
              setSelectedChallengeResponseId(null)
              setChallengeResponseChallenge(null)
              setChallengeMyResponses([])
              setChallengeResponseError(null)
              clearChallengeOverlayQuery()
            }}
            leftActions={
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  suppressChallengeAutoOpenRef.current = true
                  setChallengeResponseOverlayOpen(false)
                  setSelectedChallengeResponseId(null)
                  setChallengeResponseChallenge(null)
                  setChallengeMyResponses([])
                  setChallengeResponseError(null)
                  clearChallengeOverlayQuery()
                }}
              >
                Back
              </button>
            }
          >
            <div className="space-y-3">
              {challengeResponseError ? <div className="text-sm text-red-600">{challengeResponseError}</div> : null}
              {challengeResponseLoading ? (
                <div className="text-sm muted">Loading your feedback…</div>
              ) : (
                <>
                  {(() => {
                    const maxAttempts = typeof (challengeResponseChallenge as any)?.maxAttempts === 'number' ? (challengeResponseChallenge as any).maxAttempts : null
                    const attemptsOpen = (challengeResponseChallenge as any)?.attemptsOpen !== false
                    const myAttemptCount = typeof (challengeResponseChallenge as any)?.myAttemptCount === 'number'
                      ? (challengeResponseChallenge as any).myAttemptCount
                      : challengeMyResponses.length
                    const canAttempt = attemptsOpen && (maxAttempts === null || myAttemptCount < maxAttempts)
                    const showReattempt = challengeMyResponses.length > 0 && canAttempt
                    if (!showReattempt) return null
                    return (
                      <div className="flex items-center justify-end">
                        <button
                          type="button"
                          className="btn btn-primary text-xs"
                          onClick={() => {
                            const targetId = String(selectedChallengeResponseId)
                            setChallengeResponseOverlayOpen(false)
                            setSelectedChallengeResponseId(null)
                            setChallengeResponseChallenge(null)
                            setChallengeMyResponses([])
                            setChallengeResponseError(null)
                            void router.push(`/challenges/${encodeURIComponent(targetId)}`)
                          }}
                        >
                          Re-attempt
                        </button>
                      </div>
                    )
                  })()}

                  {challengeResponseChallenge?.prompt ? (
                    <div className="border border-white/10 rounded bg-white/5 p-3">
                      <div className="text-sm whitespace-pre-wrap break-words">
                        {renderTextWithKatex(String(challengeResponseChallenge.prompt || ''))}
                      </div>
                    </div>
                  ) : null}

                  {displayChallengeResponses.length === 0 ? (
                    <div className="border border-white/10 rounded bg-white/5 p-3">
                      <div className="text-sm muted">No submission found yet.</div>
                    </div>
                  ) : (
                    <div className="border border-white/10 rounded bg-white/5 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-sm">Your submission</div>
                        <button
                          type="button"
                          className="btn btn-ghost text-xs"
                          disabled={challengeResponseLoading}
                          onClick={() => fetchMyChallengeResponse(String(selectedChallengeResponseId))}
                        >
                          Refresh
                        </button>
                      </div>

                      <div className="text-sm">
                        Submitted: <span className="font-medium">{new Date(String(displayChallengeResponses[0]?.createdAt)).toLocaleString()}</span>
                      </div>

                      <div className="space-y-2">
                        {displayChallengeResponses.map((resp: any, idx: number) => {
                          const createdAt = resp?.createdAt ? new Date(resp.createdAt).toLocaleString() : ''
                          const latex = String(resp?.latex || '')
                          const html = latex.trim() ? renderKatexDisplayHtml(latex) : ''
                          const steps = splitLatexIntoSteps(latex)
                          const grade = normalizeChallengeGrade(resp.gradingJson, steps.length)

                          return (
                            <div key={resp?.id || idx} className="border border-white/10 rounded bg-white/5 p-3 space-y-2">
                              {createdAt ? <div className="text-xs muted">{createdAt}</div> : null}

                              {!grade ? (
                                <div>
                                  <div className="text-xs muted mb-1">Your answer</div>
                                  {latex.trim() ? (
                                    html ? (
                                      <div className="leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
                                    ) : (
                                      <div className="text-sm whitespace-pre-wrap break-words">{renderTextWithKatex(latex)}</div>
                                    )
                                  ) : (
                                    <div className="text-sm muted">(empty)</div>
                                  )}
                                </div>
                              ) : null}

                              {String(resp?.studentText || '').trim() ? (
                                <div>
                                  <div className="text-xs muted mb-1">Typed text</div>
                                  <div className="text-sm whitespace-pre-wrap break-words">{String(resp.studentText)}</div>
                                </div>
                              ) : null}

                              {(() => {
                                if (!grade) {
                                  return <div className="text-xs text-white/60">Not graded yet.</div>
                                }

                                const stepGradeByIndex = new Map<number, any>()
                                if (grade?.steps) {
                                  grade.steps.forEach((s: any) => {
                                    const stepNum = Number(s?.step)
                                    if (Number.isFinite(stepNum) && stepNum > 0) stepGradeByIndex.set(Math.trunc(stepNum) - 1, s)
                                  })
                                }

                                return (
                                  <div className="space-y-2">
                                    {steps.length ? (
                                      <div className="space-y-2">
                                        {steps.map((stepLatex: string, stepIdx: number) => {
                                          const g = stepGradeByIndex.get(stepIdx)
                                          const awardedMarks = Number(g?.awardedMarks ?? 0)
                                          const awardedInt = Number.isFinite(awardedMarks) ? Math.max(0, Math.trunc(awardedMarks)) : 0
                                          const isCorrect = (typeof g?.isCorrect === 'boolean') ? Boolean(g.isCorrect) : (awardedInt > 0)
                                          const isSignificant = (typeof g?.isSignificant === 'boolean') ? Boolean(g.isSignificant) : (!isCorrect)
                                          const feedbackText = String(g?.feedback ?? '').trim()
                                          const stepHtml = renderKatexDisplayHtml(stepLatex)
                                          const line = stepHtml
                                            ? <div className={isCorrect ? 'leading-relaxed' : 'leading-relaxed underline decoration-red-500'} dangerouslySetInnerHTML={{ __html: stepHtml }} />
                                            : <div className={isCorrect ? 'text-xs font-mono whitespace-pre-wrap break-words' : 'text-xs font-mono whitespace-pre-wrap break-words underline decoration-red-500'}>{stepLatex}</div>

                                          return (
                                            <div key={`challenge-response-step-${resp?.id || idx}-${stepIdx}`} className="flex items-start gap-3">
                                              <div className="min-w-0 flex-1">{line}</div>
                                              {g ? (
                                                <div className="shrink-0 flex items-start gap-2">
                                                  {awardedInt > 0 ? (
                                                    <span className="text-green-500 flex items-center" aria-label={`${awardedInt} mark${awardedInt === 1 ? '' : 's'} earned`} title={`${awardedInt} mark${awardedInt === 1 ? '' : 's'}`}>
                                                      {Array.from({ length: Math.min(awardedInt, 12) }).map((_, j) => (
                                                        <svg key={`tick-${resp?.id || idx}-${stepIdx}-${j}`} viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
                                                          <path
                                                            d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.12 7.18a1 1 0 0 1-1.42.006L3.29 9.01a1 1 0 1 1 1.414-1.414l3.17 3.17 6.412-6.47a1 1 0 0 1 1.418-.006z"
                                                            fill="currentColor"
                                                          />
                                                        </svg>
                                                      ))}
                                                      {awardedInt > 12 ? (
                                                        <span className="text-xs text-white/70 ml-1">+{awardedInt - 12}</span>
                                                      ) : null}
                                                    </span>
                                                  ) : isCorrect ? (
                                                    <span className="text-green-500" aria-label="Correct but 0 marks" title="Correct but 0 marks">
                                                      <svg viewBox="0 0 10 10" className="w-2 h-2" aria-hidden="true">
                                                        <circle cx="5" cy="5" r="4" fill="currentColor" />
                                                      </svg>
                                                    </span>
                                                  ) : (
                                                    isSignificant ? (
                                                      <span className="text-red-500" aria-label="Incorrect significant step" title="Incorrect (significant)">
                                                        <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
                                                          <path
                                                            d="M6.293 6.293a1 1 0 0 1 1.414 0L10 8.586l2.293-2.293a1 1 0 1 1 1.414 1.414L11.414 10l2.293 2.293a1 1 0 0 1-1.414 1.414L10 11.414l-2.293 2.293a1 1 0 0 1-1.414-1.414L8.586 10 6.293 7.707a1 1 0 0 1 0-1.414z"
                                                            fill="currentColor"
                                                          />
                                                        </svg>
                                                      </span>
                                                    ) : (
                                                      <span className="text-red-500" aria-label="Incorrect insignificant step" title="Incorrect (insignificant)">
                                                        <svg viewBox="0 0 10 10" className="w-2 h-2" aria-hidden="true">
                                                          <circle cx="5" cy="5" r="4" fill="currentColor" />
                                                        </svg>
                                                      </span>
                                                    )
                                                  )}

                                                  {feedbackText ? (
                                                    <div className="text-xs text-white/70 max-w-[18rem] whitespace-pre-wrap break-words">
                                                      {feedbackText.slice(0, 160)}
                                                    </div>
                                                  ) : null}
                                                </div>
                                              ) : null}
                                            </div>
                                          )
                                        })}
                                      </div>
                                    ) : null}

                                    <div className="text-green-300 text-xs">Mark: {grade.earnedMarks} / {grade.totalMarks}</div>
                                    {resp?.feedback ? (
                                      <div className="text-blue-200 text-xs">Feedback: {String(resp.feedback)}</div>
                                    ) : null}
                                  </div>
                                )
                              })()}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </FullScreenGlassOverlay>
        </OverlayPortal>
      )}

      {userDetailOverlayOpen && selectedUserDetail && (
        <OverlayPortal>
          <FullScreenGlassOverlay
            title="Learner"
            subtitle="Admin management"
            zIndexClassName="z-[60]"
            onClose={() => {
              setUserDetailOverlayOpen(false)
              setSelectedUserDetail(null)
              setUserTempPassword(null)
            }}
            onBackdropClick={() => {
              setUserDetailOverlayOpen(false)
              setSelectedUserDetail(null)
              setUserTempPassword(null)
            }}
          >
            <div className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
                <div className="text-sm text-white/80">Name</div>
                <div className="font-semibold">
                  {selectedUserDetail.firstName || selectedUserDetail.name || '—'} {selectedUserDetail.lastName || ''}
                </div>
                <div className="text-sm text-white/80">Email</div>
                <div className="font-medium">{selectedUserDetail.email}</div>
                <div className="text-sm text-white/80">Grade</div>
                <div>{selectedUserDetail.grade ? gradeToLabel(selectedUserDetail.grade) : 'Unassigned'}</div>
                <div className="text-sm text-white/80">School</div>
                <div>{selectedUserDetail.schoolName || '—'}</div>
                <div className="text-sm text-white/80">Joined</div>
                <div>{selectedUserDetail.createdAt ? new Date(selectedUserDetail.createdAt).toLocaleString() : '—'}</div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">Verification</div>
                  {selectedUserDetail.emailVerifiedAt ? (
                    <span className="text-xs text-green-300">Verified</span>
                  ) : (
                    <span className="text-xs text-yellow-300">Unverified</span>
                  )}
                </div>
                {!selectedUserDetail.emailVerifiedAt ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => markUserVerified(String(selectedUserDetail.id))}
                    disabled={userDetailLoading}
                  >
                    {userDetailLoading ? 'Working…' : 'Skip verification'}
                  </button>
                ) : null}
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                <div className="text-sm font-medium">Temporary bypass password</div>
                <p className="text-xs text-white/70">Generates a new one-time password for the learner.</p>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => generateTempPassword(String(selectedUserDetail.id))}
                  disabled={userDetailLoading}
                >
                  {userDetailLoading ? 'Generating…' : 'Generate password'}
                </button>
                {userTempPassword ? (
                  <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm font-mono">
                    {userTempPassword}
                  </div>
                ) : null}
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={async () => {
                    if (!confirm(`Delete user ${selectedUserDetail.email}? This cannot be undone.`)) return
                    try {
                      const res = await fetch(`/api/users/${selectedUserDetail.id}`, { method: 'DELETE', credentials: 'same-origin' })
                      if (res.ok) {
                        setUsers(prev => prev ? prev.filter(x => x.id !== selectedUserDetail.id) : prev)
                        setUserDetailOverlayOpen(false)
                        setSelectedUserDetail(null)
                        setUserTempPassword(null)
                      } else {
                        const data = await res.json().catch(() => ({}))
                        alert(data?.message || `Failed to delete (${res.status})`)
                      }
                    } catch (err: any) {
                      alert(err?.message || 'Network error')
                    }
                  }}
                >Delete user</button>
              </div>
            </div>
          </FullScreenGlassOverlay>
        </OverlayPortal>
      )}
    </>
  )
}

export async function getServerSideProps(context: any) {
  // protect page server-side if desired
  const session = await getSession(context)
  return { props: { session } }
}
