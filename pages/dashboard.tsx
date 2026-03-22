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
import AppFooter from '../components/AppFooter'
import HandwritingNormalizationOverlay from '../components/HandwritingNormalizationOverlay'
import FullScreenGlassOverlay from '../components/FullScreenGlassOverlay'
import { PublicSolveCanvasViewer, PublicSolveComposer, normalizePublicSolveScene, type PublicSolveScene } from '../components/PublicSolveCanvas'
import TaskManageMenu from '../components/TaskManageMenu'
import PdfViewerOverlay from '../components/PdfViewerOverlay'
import ScriptPhotosEditor from '../components/ScriptPhotosEditor'
import BottomSheet from '../components/BottomSheet'
import { getSession, signOut, useSession } from 'next-auth/react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { gradeToLabel, GRADE_VALUES, GradeValue, normalizeGradeInput } from '../lib/grades'
import { toDisplayFileName } from '../lib/fileName'
import { isSpecialTestStudentEmail } from '../lib/testUsers'
import { renderKatexDisplayHtml as renderKatexDisplayHtmlRaw, splitLatexIntoSteps as splitLatexIntoStepsRaw } from '../lib/latexRender'
import { renderTextWithKatex as renderTextWithKatexRaw } from '../lib/renderTextWithKatex'
import { useTapToPeek } from '../lib/useTapToPeek'
import { useOverlayRestore } from '../lib/overlayRestore'
import { createLessonRoleProfile, getPlatformRoleDisplayLabel, hasLessonCapabilityForRole, isRecognizedLessonParticipantRole, normalizePlatformRole, type LessonRoleProfile } from '../lib/lessonAccessControl'

const StackedCanvasWindow = dynamic(() => import('../components/StackedCanvasWindow'), { ssr: false })
const ImageCropperModal = dynamic(() => import('../components/ImageCropperModal'), { ssr: false })
const ZoomableImageOverlay = dynamic(() => import('../components/ZoomableImageOverlay'), { ssr: false })

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

type LibraryGradeItem = {
  id: string
  sourceType: 'assignment' | 'post_solution' | 'challenge_solution' | 'manual'
  assessmentTitle: string
  scoreLabel: string
  earnedMarks?: number | null
  totalMarks?: number | null
  percentage: number | null
  feedback: string | null
  screenshotUrl: string | null
  screenshotUrls?: string[]
  graderSignature?: string | null
  gradedAt: string
  sourceKey: string | null
  responseId?: string | null
}

type GradeChatComment = {
  id: string
  authorId: string
  authorRole: 'teacher' | 'learner'
  text: string
  createdAt: string
  updatedAt: string
}

type LibraryGradeDetail = {
  id: string
  sourceType: string
  assessmentTitle: string
  scoreLabel: string
  earnedMarks?: number | null
  totalMarks?: number | null
  percentage: number | null
  feedback: string | null
  screenshotUrl: string | null
  screenshotUrls: string[]
  graderSignature?: string | null
  gradedAt: string
  comments: GradeChatComment[]
  canComment: boolean
}

type ManualAssessmentItem = {
  id: string
  title: string
  grade: GradeValue
  subject: string | null
  term: string | null
  assessmentDate: string | null
  maxMarks: number | null
  description: string | null
  createdAt: string
  updatedAt: string
}

type ManualMarksheetRow = {
  number: number
  userId: string
  surname: string
  givenName: string
  fullName: string
  scoreLabel: string
  percentage: number | null
  notes: string | null
  screenshotUrl: string | null
  screenshotUrls: string[]
  gradedAt: string | null
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
  roleProfileOverride?: LessonRoleProfile
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
      data,
    }
    window.localStorage.setItem(key, JSON.stringify(payload))
  } catch {
    // ignore storage errors
  }
}

type DashboardCreateKind = 'quiz' | 'post'

const getDashboardItemKind = (item: any): 'challenge' | 'post' => {
  return String(item?.kind || '').toLowerCase() === 'post' ? 'post' : 'challenge'
}

const getDashboardItemKey = (item: any) => {
  const kind = getDashboardItemKind(item)
  const id = String(item?.id || '').trim()
  return id ? `${kind}:${id}` : `${kind}:unknown`
}

const sortDashboardItemsByCreatedAt = (items: any[]) => {
  return [...(Array.isArray(items) ? items : [])].sort((left: any, right: any) => {
    const leftTs = left?.createdAt ? new Date(left.createdAt).getTime() : 0
    const rightTs = right?.createdAt ? new Date(right.createdAt).getTime() : 0
    return rightTs - leftTs
  })
}

export default function Dashboard({ initialIsMobile = false }: { initialIsMobile?: boolean }) {
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
    if (startLabel && endLabel) return `${startLabel} -> ${endLabel}`
    return startLabel || endLabel
  }, [formatSessionDate])

  const formatFeedPostDate = useCallback((value: unknown) => {
    if (!value) return ''
    const dt = value instanceof Date ? value : new Date(String(value))
    if (Number.isNaN(dt.getTime())) return ''
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    }).format(dt).replace(/,/g, '')
  }, [])

  const formatCompactLessonMoment = useCallback((value: unknown) => {
    if (!value) return ''
    const raw = value instanceof Date ? value.toISOString() : String(value)
    const dt = value instanceof Date ? value : new Date(raw)
    if (Number.isNaN(dt.getTime())) return ''

    const datePart = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    }).format(dt).replace(/,/g, '')

    const hasExplicitTime = value instanceof Date || /(?:T|\s)\d{1,2}:\d{2}/.test(raw)
    if (!hasExplicitTime) return datePart

    const timePart = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(dt)

    return `${datePart}, ${timePart}`
  }, [])

  const router = useRouter()
  const { data: session, status, update: updateSession } = useSession()
  const { queueRestore, discardRestore, popRestore, hasRestore } = useOverlayRestore()
  const gradeOptions = useMemo(() => GRADE_VALUES.map(value => ({ value, label: gradeToLabel(value) })), [])
  const [selectedGrade, setSelectedGrade] = useState<GradeValue | null>(null)
  const [gradeReady, setGradeReady] = useState(false)
  const [isMobile, setIsMobile] = useState(initialIsMobile)
  const dashboardMainRef = useRef<HTMLElement | null>(null)
  const [pullRefreshOffset, setPullRefreshOffset] = useState(0)
  const [pullRefreshActive, setPullRefreshActive] = useState(false)
  const [pullRefreshLoading, setPullRefreshLoading] = useState(false)
  const currentLessonCardRef = useRef<HTMLDivElement | null>(null)
  const currentLessonCardContentRef = useRef<HTMLDivElement | null>(null)
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
      const el = currentLessonCardContentRef.current
      if (!el) return
      const h = el.getBoundingClientRect().height
      if (!Number.isFinite(h) || h <= 0) return
      const next = Math.round(h)
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
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          window.requestAnimationFrame(measure)
        })
      : null
    if (resizeObserver && currentLessonCardContentRef.current) {
      resizeObserver.observe(currentLessonCardContentRef.current)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      resizeObserver?.disconnect()
    }
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

  type PostSolveOverlayState = {
    postId: string
    threadKey: string
    title: string
    prompt: string
    imageUrl?: string | null
    authorName?: string | null
    authorAvatarUrl?: string | null
    initialScene?: any | null
    postRecord?: any | null
  }

  type PostSolvePreviewState = {
    draft: PostSolveOverlayState
    draftScene: PublicSolveScene
    responses: any[]
    loading: boolean
    error: string | null
  }

  const LESSON_AUTHORING_STORAGE_KEY = 'philani:lesson-authoring:draft-v2'
  const buildLessonAuthoringBoardId = (kind: 'diagram' | 'latex' | 'canvas', phaseKey: LessonPhaseKey, pointId: string) => {
    return `lesson-author-${kind}-${phaseKey}-${pointId}`
  }

  const sanitizeIdentifier = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60)
  const boardIdToSessionKey = (boardId: string) => `myscript:${sanitizeIdentifier(boardId).toLowerCase()}`

  const sessionPlatformRole = normalizePlatformRole((session as any)?.user?.role)
  const currentLessonRoleProfile = useMemo(
    () => createLessonRoleProfile({ platformRole: sessionPlatformRole }),
    [sessionPlatformRole]
  )
  const isTeacherOrAdminUser = currentLessonRoleProfile.capabilities.canOrchestrateLesson

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
  const [createKind, setCreateKind] = useState<DashboardCreateKind>('quiz')
  const [editingChallengeId, setEditingChallengeId] = useState<string | null>(null)
  const [editingPostId, setEditingPostId] = useState<string | null>(null)
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
    setEditingPostId(null)
    setChallengeAudiencePickerOpen(false)
  }, [])

    const [viewerId, setViewerId] = useState<string | null>(null)

  const postChallenge = useCallback(async () => {
    if (status !== 'authenticated') return

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
      const isQuiz = createKind === 'quiz'
      const isEditing = isQuiz ? Boolean(editingChallengeId) : Boolean(editingPostId)
      const endpoint = isEditing
        ? isQuiz
          ? `/api/challenges/${encodeURIComponent(editingChallengeId as string)}`
          : `/api/posts/${encodeURIComponent(editingPostId as string)}`
        : isQuiz
          ? '/api/challenges'
          : '/api/posts'
      const res = await fetch(endpoint, {
        method: isEditing ? 'PATCH' : 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          prompt,
          imageUrl: challengeImageUrl,
          audience,
          ...(isQuiz ? { maxAttempts } : {}),
          ...(isEditing ? {} : { grade }),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        return alert(data?.message || `Failed to ${isEditing ? 'save' : 'post'} (${res.status})`)
      }

      if (isEditing && (editingChallengeId || editingPostId)) {
        const id = String(isQuiz ? editingChallengeId : editingPostId)
        const patch = {
          id,
          kind: isQuiz ? 'challenge' : 'post',
          title,
          prompt,
          imageUrl: challengeImageUrl,
          audience,
          ...(isQuiz ? { maxAttempts } : {}),
        }
        if (isQuiz) {
          setSelectedChallengeData((prev: any) => (prev && String(prev?.id) === id ? { ...prev, ...patch } : prev))
        }
        setTimelineChallenges((prev: any[]) => (Array.isArray(prev) ? prev.map(p => (getDashboardItemKey(p) === `${isQuiz ? 'challenge' : 'post'}:${id}` ? { ...(p as any), ...patch } : p)) : prev))
        setStudentFeedPosts((prev: any[]) => (Array.isArray(prev) ? prev.map(p => (getDashboardItemKey(p) === `${isQuiz ? 'challenge' : 'post'}:${id}` ? { ...(p as any), ...patch } : p)) : prev))
        if (!isQuiz) {
          setMyPosts((prev: any[]) => Array.isArray(prev) ? prev.map(p => (getDashboardItemKey(p) === `post:${id}` ? { ...(p as any), ...patch } : p)) : prev)
        }
      } else {
        const createdItem = {
          ...(data || {}),
          kind: isQuiz ? 'challenge' : 'post',
          createdBy: {
            id: String((session as any)?.user?.id || viewerId || ''),
            name: String(session?.user?.name || session?.user?.email || 'You'),
            avatar: String((session as any)?.user?.avatar || ''),
            role: String((session as any)?.user?.role || ''),
          },
          createdById: String((data as any)?.createdById || (session as any)?.user?.id || viewerId || ''),
          threadKey: isQuiz ? undefined : `post:${String((data as any)?.id || '')}`,
        }
        setTimelineChallenges((prev: any[]) => sortDashboardItemsByCreatedAt([createdItem, ...(Array.isArray(prev) ? prev : [])]))
        setStudentFeedPosts((prev: any[]) => sortDashboardItemsByCreatedAt([createdItem, ...(Array.isArray(prev) ? prev : [])]))
        if (!isQuiz) {
          const hydratedItem = {
            ...(createdItem || {}),
            kind: 'post' as const,
            createdById: String((createdItem as any)?.createdById || (session as any)?.user?.id || viewerId || ''),
            createdBy: {
              id: String((session as any)?.user?.id || viewerId || ''),
              name: String(session?.user?.name || session?.user?.email || 'You'),
              avatar: String((session as any)?.user?.avatar || ''),
              role: String((session as any)?.user?.role || ''),
              grade: selectedGrade || null,
            },
          }
          setMyPosts((prev: any[]) => sortDashboardItemsByCreatedAt([hydratedItem, ...(Array.isArray(prev) ? prev.filter((x: any) => getDashboardItemKey(x) !== getDashboardItemKey(createdItem)) : [])]))
        }
      }

      discardRestore()
      closeCreateOverlay()
      setCreateKind('quiz')
      setChallengeTitleDraft('')
      setChallengePromptDraft('')
      setChallengeAudienceDraft('public')
      setChallengeMaxAttempts('unlimited')
      setChallengeImageUrl(null)
      setChallengeImageSourceFile(null)
      setChallengeParsedJsonText(null)
      setChallengeParsedOpen(false)
      alert(isEditing ? 'Saved' : 'Posted')
    } catch (err: any) {
      alert(err?.message || `Failed to ${(editingChallengeId || editingPostId) ? 'save' : 'post'}`)
    } finally {
      setChallengePosting(false)
    }
  }, [status, createKind, challengeTitleDraft, challengePromptDraft, challengeAudienceDraft, challengeImageUrl, selectedGrade, session, challengeMaxAttempts, editingChallengeId, editingPostId, closeCreateOverlay, discardRestore, viewerId])

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
  const [lessonSolveOverlay, setLessonSolveOverlay] = useState<null | { sessionId: string; threadKey: string; title: string; prompt: string; imageUrl?: string | null; initialScene?: any | null }>(null)
  const [lessonSolveSubmitting, setLessonSolveSubmitting] = useState(false)
  const [lessonSolveError, setLessonSolveError] = useState<string | null>(null)
  const [postSolveOverlay, setPostSolveOverlay] = useState<PostSolveOverlayState | null>(null)
  const [postSolveSubmitting, setPostSolveSubmitting] = useState(false)
  const [postSolveError, setPostSolveError] = useState<string | null>(null)
  const [postSolvePreviewOverlay, setPostSolvePreviewOverlay] = useState<PostSolvePreviewState | null>(null)
  const [postThreadOverlay, setPostThreadOverlay] = useState<null | {
    postId: string
    threadKey: string
    title: string
    prompt: string
    imageUrl?: string | null
    authorName?: string | null
    authorAvatarUrl?: string | null
  }>(null)
  const [postThreadLoading, setPostThreadLoading] = useState(false)
  const [postThreadError, setPostThreadError] = useState<string | null>(null)
  const [postThreadResponses, setPostThreadResponses] = useState<any[]>([])
  const [pendingFeedThreadJumpKey, setPendingFeedThreadJumpKey] = useState<string | null>(null)
  const [expandedSolutionThreadKey, setExpandedSolutionThreadKey] = useState<string | null>(null)
  const [expandedSolutionThreadKind, setExpandedSolutionThreadKind] = useState<'post' | 'challenge' | null>(null)
  const [activeSection, setActiveSection] = useState<SectionId>('overview')
  const [dashboardSectionOverlay, setDashboardSectionOverlay] = useState<OverlaySectionId | null>(null)
  const [handwritingNormalizationOverlayOpen, setHandwritingNormalizationOverlayOpen] = useState(false)
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

  const buildLessonResponseThreadKey = useCallback((sessionId: string) => {
    return `lesson:${String(sessionId || '').trim()}`
  }, [])

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
  const [assignmentTitleEditMode, setAssignmentTitleEditMode] = useState(false)
  const [assignmentTitleEditDraft, setAssignmentTitleEditDraft] = useState('')
  const [assignmentTitleSaving, setAssignmentTitleSaving] = useState(false)
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
  const [postToolsSheetOpen, setPostToolsSheetOpen] = useState(false)
  const [timelineChallenges, setTimelineChallenges] = useState<any[]>([])
  const [timelineChallengesLoading, setTimelineChallengesLoading] = useState(false)
  const [timelineChallengesError, setTimelineChallengesError] = useState<string | null>(null)
  const [timelineUserId, setTimelineUserId] = useState<string | null>(null)
  const timelineFetchedOnceRef = useRef(false)
  const [readTimelinePostIds, setReadTimelinePostIds] = useState<string[]>([])

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
  const [challengeThreadResponses, setChallengeThreadResponses] = useState<any[]>([])

  const [studentFeedPosts, setStudentFeedPosts] = useState<any[]>([])
  const [studentFeedLoading, setStudentFeedLoading] = useState(false)
  const [studentFeedError, setStudentFeedError] = useState<string | null>(null)
  const [myPosts, setMyPosts] = useState<any[]>([])
  const [myPostsLoading, setMyPostsLoading] = useState(false)
  const [myPostsError, setMyPostsError] = useState<string | null>(null)
  const [myPostsExpanded, setMyPostsExpanded] = useState(false)
  const [myPostsContentMaxHeightPx, setMyPostsContentMaxHeightPx] = useState<number | null>(null)
  const [myPostsShouldLockPageScroll, setMyPostsShouldLockPageScroll] = useState(false)
  const myPostsHeaderRef = useRef<HTMLButtonElement | null>(null)
  const myPostsScrollRef = useRef<HTMLDivElement | null>(null)
  const myPostsTouchStartYRef = useRef<number | null>(null)
  const [socialLikedItems, setSocialLikedItems] = useState<Record<string, boolean>>({})
  const [lastSharedSocialItemKey, setLastSharedSocialItemKey] = useState<string | null>(null)
  const [interactiveViewportSavingByResponseId, setInteractiveViewportSavingByResponseId] = useState<Record<string, boolean>>({})
  const [interactiveViewportErrorByResponseId, setInteractiveViewportErrorByResponseId] = useState<Record<string, string>>({})
  const socialShareResetTimeoutRef = useRef<number | null>(null)
  const postFeedItemRefs = useRef<Record<string, HTMLLIElement | null>>({})
  const handledFeedThreadJumpKeyRef = useRef<string | null>(null)
  const interactiveViewportSaveTimeoutsRef = useRef<Record<string, number>>({})
  const interactiveViewportQueuedSceneRef = useRef<Record<string, { threadKey: string; scene: PublicSolveScene; serialized: string }>>({})
  const interactiveViewportSavedSceneRef = useRef<Record<string, string>>({})

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

  useEffect(() => {
    const cached = readLocalCache<Record<string, boolean>>('dashboard-social-liked-items-v1')
    if (cached?.data && typeof cached.data === 'object') {
      setSocialLikedItems(cached.data)
    }
  }, [])

  useEffect(() => {
    writeLocalCache('dashboard-social-liked-items-v1', socialLikedItems)
  }, [socialLikedItems])

  useEffect(() => {
    return () => {
      if (typeof window === 'undefined') return
      if (socialShareResetTimeoutRef.current !== null) {
        window.clearTimeout(socialShareResetTimeoutRef.current)
      }
      Object.values(interactiveViewportSaveTimeoutsRef.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId)
      })
    }
  }, [])

  const [studentMobileTab, setStudentMobileTab] = useState<'timeline' | 'sessions' | 'groups' | 'discover'>('timeline')
  const [studentQuickOverlay, setStudentQuickOverlay] = useState<'timeline' | 'sessions' | 'groups' | 'discover' | 'admin' | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [booksOverlayOpen, setBooksOverlayOpen] = useState(false)
  const [booksLoading, setBooksLoading] = useState(false)
  const [booksError, setBooksError] = useState<string | null>(null)
  const [booksItems, setBooksItems] = useState<ResourceBankItem[]>([])
  const [libraryGrades, setLibraryGrades] = useState<LibraryGradeItem[]>([])
  const [libraryGradesLoading, setLibraryGradesLoading] = useState(false)
  const [libraryGradesError, setLibraryGradesError] = useState<string | null>(null)
  const [manualAssessments, setManualAssessments] = useState<ManualAssessmentItem[]>([])
  const [manualAssessmentsLoading, setManualAssessmentsLoading] = useState(false)
  const [manualAssessmentsError, setManualAssessmentsError] = useState<string | null>(null)
  const [selectedManualAssessmentId, setSelectedManualAssessmentId] = useState<string | null>(null)
  const [manualMarksheetRows, setManualMarksheetRows] = useState<ManualMarksheetRow[]>([])
  const [manualMarksheetLoading, setManualMarksheetLoading] = useState(false)
  const [manualMarksheetError, setManualMarksheetError] = useState<string | null>(null)
  const [manualMarksheetSearch, setManualMarksheetSearch] = useState('')
  const [manualMarksheetDraftByUserId, setManualMarksheetDraftByUserId] = useState<Record<string, { scoreLabel: string; percentage: string; notes: string; screenshotUrls: string[] }>>({})
  const [manualMarksheetSavingUserId, setManualMarksheetSavingUserId] = useState<string | null>(null)
  const [manualAssessmentTitleDraft, setManualAssessmentTitleDraft] = useState('')
  const [manualAssessmentSubjectDraft, setManualAssessmentSubjectDraft] = useState('')
  const [manualAssessmentTermDraft, setManualAssessmentTermDraft] = useState('')
  const [manualAssessmentDateDraft, setManualAssessmentDateDraft] = useState('')
  const [manualAssessmentMaxMarksDraft, setManualAssessmentMaxMarksDraft] = useState('')
  const [manualAssessmentDescriptionDraft, setManualAssessmentDescriptionDraft] = useState('')
  const [manualAssessmentCreating, setManualAssessmentCreating] = useState(false)
  const [manualAssessmentEditingId, setManualAssessmentEditingId] = useState<string | null>(null)
  const [manualAssessmentCreateError, setManualAssessmentCreateError] = useState<string | null>(null)
  const [manualAssessmentCreateSuccess, setManualAssessmentCreateSuccess] = useState<string | null>(null)
  const [manualAssessmentUpdating, setManualAssessmentUpdating] = useState(false)
  const [manualAssessmentDeleting, setManualAssessmentDeleting] = useState(false)
  const [gradeDetailOpen, setGradeDetailOpen] = useState(false)
  const [gradeDetailItem, setGradeDetailItem] = useState<LibraryGradeItem | null>(null)
  const [gradeDetailData, setGradeDetailData] = useState<LibraryGradeDetail | null>(null)
  const [gradeDetailLoading, setGradeDetailLoading] = useState(false)
  const [gradeDetailError, setGradeDetailError] = useState<string | null>(null)
  const [gradeImageViewer, setGradeImageViewer] = useState<{ url: string; title: string } | null>(null)
  const [gradeCommentDraft, setGradeCommentDraft] = useState('')
  const [gradeCommentBusy, setGradeCommentBusy] = useState(false)
  const [gradeCommentEditId, setGradeCommentEditId] = useState<string | null>(null)
  const [gradeCommentEditDraft, setGradeCommentEditDraft] = useState('')
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
  const [pdfViewerCacheKey, setPdfViewerCacheKey] = useState('')
  const [pdfViewerTitle, setPdfViewerTitle] = useState('')
  const [pdfViewerSubtitle, setPdfViewerSubtitle] = useState('')
  const [pdfViewerInitialState, setPdfViewerInitialState] = useState<PdfViewerSnapshot | null>(null)
  const [pdfViewerOfflineObjectUrl, setPdfViewerOfflineObjectUrl] = useState<string | null>(null)

  const openIncomingPdfPayload = useCallback((payload: any) => {
    const base64Raw = String(payload?.base64 || '')
    if (!base64Raw) return

    const mimeType = String(payload?.mimeType || 'application/pdf')
    const fileName = String(payload?.fileName || 'Document.pdf')
    const base64 = base64Raw.includes(',') ? base64Raw.split(',').pop() || '' : base64Raw
    if (!base64) return

    try {
      const binary = typeof window !== 'undefined' ? window.atob(base64) : ''
      if (!binary) return
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }

      const blob = new Blob([bytes], { type: mimeType })
      const objectUrl = URL.createObjectURL(blob)

      if (pdfViewerOfflineObjectUrl) {
        URL.revokeObjectURL(pdfViewerOfflineObjectUrl)
      }

      setPdfViewerOfflineObjectUrl(objectUrl)
      setPdfViewerTitle(fileName || 'Document')
      setPdfViewerSubtitle('')
      setPdfViewerUrl(objectUrl)
      setPdfViewerCacheKey(String(payload?.cacheKey || payload?.sourceUrl || payload?.filePath || `${fileName}:${bytes.length}`))
      setPdfViewerInitialState(null)
      setPdfViewerOpen(true)
    } catch {
      // ignore malformed payloads
    }
  }, [pdfViewerOfflineObjectUrl])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!isCapacitorWrappedApp) return

    const cap = (window as any)?.Capacitor
    const plugin = cap?.Plugins?.IncomingPdf
    if (!plugin || typeof plugin.consumePendingPdf !== 'function') return

    let cancelled = false
    let listenerHandle: { remove?: () => Promise<void> } | null = null

    const consume = async () => {
      try {
        const result = await plugin.consumePendingPdf()
        if (cancelled) return
        if (!result?.available || !result?.base64) return
        openIncomingPdfPayload(result)
      } catch {
        // ignore plugin read errors
      }
    }

    void consume()

    void (async () => {
      if (typeof plugin.addListener !== 'function') return
      try {
        const handle = await plugin.addListener('pendingPdf', () => {
          void consume()
        })
        if (cancelled) {
          await handle?.remove?.()
          return
        }
        listenerHandle = handle
      } catch {
        // ignore listener setup errors
      }
    })()

    return () => {
      cancelled = true
      void listenerHandle?.remove?.()
    }
  }, [isCapacitorWrappedApp, openIncomingPdfPayload])
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
  const [studentMobileActivePanelHeight, setStudentMobileActivePanelHeight] = useState<number | null>(null)
  const [studentMobileCarouselWidth, setStudentMobileCarouselWidth] = useState(0)
  const [studentMobileDragOffsetPx, setStudentMobileDragOffsetPx] = useState(0)
  const [studentMobileIsDragging, setStudentMobileIsDragging] = useState(false)
  const studentMobileSwipeStateRef = useRef<{
    pointerId: number | null
    startX: number
    startY: number
    dragX: number
    axis: 'x' | 'y' | null
    startIndex: number
    width: number
  }>({
    pointerId: null,
    startX: 0,
    startY: 0,
    dragX: 0,
    axis: null,
    startIndex: 0,
    width: 0,
  })

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
  const [discoverRecommendations, setDiscoverRecommendations] = useState<any[]>([])
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
  const isAdmin = currentLessonRoleProfile.capabilities.canManagePlatform
  const isInstructor = currentLessonRoleProfile.platformRole === 'teacher'
  const isVerifiedAccount = currentLessonRoleProfile.capabilities.canOrchestrateLesson
  const roleFlagText = useMemo(() => {
    return getPlatformRoleDisplayLabel(normalizedRole, {
      learnerGradeLabel: status === 'authenticated' ? activeGradeLabel : '',
      variant: 'dashboard',
    })
  }, [activeGradeLabel, normalizedRole, status])
  const canManageAnnouncements = currentLessonRoleProfile.capabilities.canOrchestrateLesson
  const isLearner = normalizedRole === 'student'
  const isTestStudent = useMemo(() => isSpecialTestStudentEmail(session?.user?.email || ''), [session?.user?.email])
  const learnerNotesLabel = 'Notes'
  const learnerNotesLabelLower = 'notes'
  const effectiveSubscriptionGatingEnabled = subscriptionGatingEnabled ?? true
  const isSubscriptionBlocked = isLearner && effectiveSubscriptionGatingEnabled && subscriptionActive === false
  const currentViewerId = String(viewerId || (session as any)?.user?.id || '')
  const currentViewerPostAuthor = useMemo(() => ({
    id: currentViewerId,
    name: String(session?.user?.name || session?.user?.email || learnerName || 'You'),
    avatar: effectiveAvatarUrl,
    role: String((session as any)?.user?.role || ''),
    grade: selectedGrade || normalizeGradeInput((session as any)?.user?.grade as string | undefined) || null,
  }), [currentViewerId, effectiveAvatarUrl, learnerName, selectedGrade, session])
  const hydrateOwnPostFeedItem = useCallback((item: any) => ({
    ...(item || {}),
    kind: 'post',
    createdById: String(item?.createdById || currentViewerPostAuthor.id || ''),
    createdBy: {
      id: String(currentViewerPostAuthor.id || ''),
      name: currentViewerPostAuthor.name,
      avatar: currentViewerPostAuthor.avatar,
      role: currentViewerPostAuthor.role,
      grade: currentViewerPostAuthor.grade,
    },
  }), [currentViewerPostAuthor])

  const offlineCachePrefix = useMemo(() => {
    const userKey = session?.user?.email || (session as any)?.user?.id || session?.user?.name || 'anon'
    return `pa:offline:${userKey}`
  }, [session])

  const makeOfflineCacheKey = useCallback((suffix: string) => {
    return `${offlineCachePrefix}:${suffix}`
  }, [offlineCachePrefix])

  useEffect(() => {
    if (status !== 'authenticated' || !currentViewerId) {
      setMyPosts([])
      setMyPostsError(null)
      setMyPostsLoading(false)
      return
    }

    let cancelled = false
    setMyPostsLoading(true)
    setMyPostsError(null)

    void (async () => {
      try {
        const res = await fetch(`/api/profile/view/${encodeURIComponent(currentViewerId)}/posts`, { credentials: 'same-origin' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (!cancelled) {
            setMyPostsError(data?.message || `Unable to load your posts (${res.status})`)
            setMyPosts([])
          }
          return
        }

        const items = Array.isArray(data?.posts)
          ? sortDashboardItemsByCreatedAt(data.posts.map((item: any) => hydrateOwnPostFeedItem(item)))
          : []
        if (!cancelled) setMyPosts(items)
      } catch (err: any) {
        if (!cancelled) {
          setMyPostsError(err?.message || 'Unable to load your posts')
          setMyPosts([])
        }
      } finally {
        if (!cancelled) setMyPostsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [currentViewerId, hydrateOwnPostFeedItem, status])

  useEffect(() => {
    if (!myPostsExpanded) {
      setMyPostsContentMaxHeightPx(null)
      setMyPostsShouldLockPageScroll(false)
      return
    }

    if (typeof window === 'undefined') return

    const updateScrollableHeight = () => {
      const headerBottom = myPostsHeaderRef.current?.getBoundingClientRect()?.bottom
      if (typeof headerBottom !== 'number') return
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0
      const available = Math.max(180, Math.floor(viewportHeight - headerBottom - 12))
      setMyPostsContentMaxHeightPx(available)
      window.requestAnimationFrame(() => {
        const el = myPostsScrollRef.current
        if (!el) {
          setMyPostsShouldLockPageScroll(false)
          return
        }
        const needsInternalScroll = el.scrollHeight > available + 1
        setMyPostsShouldLockPageScroll(needsInternalScroll)
      })
    }

    updateScrollableHeight()
    window.addEventListener('resize', updateScrollableHeight)

    return () => {
      window.removeEventListener('resize', updateScrollableHeight)
    }
  }, [myPostsExpanded, myPosts.length, myPostsLoading, myPostsError])

  useEffect(() => {
    if (!myPostsExpanded || !myPostsShouldLockPageScroll) return
    if (typeof document === 'undefined') return

    const prevHtmlOverflow = document.documentElement.style.overflow
    const prevBodyOverflow = document.body.style.overflow
    const prevHtmlOverscrollBehaviorY = document.documentElement.style.overscrollBehaviorY
    const prevBodyOverscrollBehaviorY = document.body.style.overscrollBehaviorY
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overscrollBehaviorY = 'none'
    document.body.style.overscrollBehaviorY = 'none'

    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow
      document.body.style.overflow = prevBodyOverflow
      document.documentElement.style.overscrollBehaviorY = prevHtmlOverscrollBehaviorY
      document.body.style.overscrollBehaviorY = prevBodyOverscrollBehaviorY
    }
  }, [myPostsExpanded, myPostsShouldLockPageScroll])

  useEffect(() => {
    if (!myPostsExpanded || !myPostsShouldLockPageScroll) {
      myPostsTouchStartYRef.current = null
      return
    }

    const el = myPostsScrollRef.current
    if (!el) return

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      myPostsTouchStartYRef.current = event.touches[0].clientY
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      const startY = myPostsTouchStartYRef.current
      if (typeof startY !== 'number') return

      const currentY = event.touches[0].clientY
      const deltaY = currentY - startY
      const atTop = el.scrollTop <= 0
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1

      // Prevent pull-to-refresh at top (downward drag) and overscroll at bottom (any vertical motion)
      if ((deltaY > 0 && atTop) || atBottom) {
        event.preventDefault()
      }
    }

    const handleTouchEnd = () => {
      myPostsTouchStartYRef.current = null
    }

    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchmove', handleTouchMove, { passive: false })
    el.addEventListener('touchend', handleTouchEnd, { passive: true })
    el.addEventListener('touchcancel', handleTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', handleTouchEnd)
      el.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [myPostsExpanded, myPostsShouldLockPageScroll])

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
      const parsed = Array.isArray(data) ? data : []

      if (q.length >= 1) {
        setDiscoverResults(parsed)
      } else {
        setDiscoverRecommendations(parsed)
        setDiscoverResults([])
      }

      try {
        if (typeof window !== 'undefined') {
          if (q.length >= 1) window.localStorage.setItem(discoverLastQueryKey, q)
          if (q.length === 0) window.localStorage.setItem(discoverCacheKey, JSON.stringify(parsed))
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
          if (Array.isArray(parsed)) setDiscoverRecommendations(parsed)
        } else {
          setDiscoverRecommendations([])
        }
      }
    } catch {
      setDiscoverRecommendations([])
    }
    setDiscoverResults([])
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
        alert(data?.message || (Array.isArray(data?.errors) ? data.errors.join(' - ') : `Failed to save status (${res.status})`))
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
      if (c?.id && !readTimelinePostSet.has(getDashboardItemKey(c))) count += 1
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

  const gradingNotificationTypes = useMemo(
    () => new Set(['assignment_graded', 'challenge_graded', 'manual_assessment_graded']),
    []
  )

  const gradingAttentionStorageKey = useMemo(() => {
    const userKey = session?.user?.email || (session as any)?.user?.id || session?.user?.name || 'anon'
    return `pa:grading-attended-notifications:v1:${userKey}`
  }, [session])

  const [attendedGradingNotificationIds, setAttendedGradingNotificationIds] = useState<string[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(gradingAttentionStorageKey)
      const parsed = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed)) {
        setAttendedGradingNotificationIds(parsed.map(String))
      } else {
        setAttendedGradingNotificationIds([])
      }
    } catch {
      setAttendedGradingNotificationIds([])
    }
  }, [gradingAttentionStorageKey])

  const attendedGradingNotificationIdSet = useMemo(
    () => new Set(attendedGradingNotificationIds),
    [attendedGradingNotificationIds]
  )

  const unreadGradingUpdatesCount = useMemo(() => {
    if (!Array.isArray(activityFeed)) return 0
    return activityFeed.filter((n) => {
      const type = String(n?.type || '')
      if (!gradingNotificationTypes.has(type)) return false
      return !n?.readAt
    }).length
  }, [activityFeed, gradingNotificationTypes])

  const unattendedGradingUpdatesCount = useMemo(() => {
    if (!Array.isArray(activityFeed)) return 0
    return activityFeed.filter((n) => {
      const type = String(n?.type || '')
      if (!gradingNotificationTypes.has(type)) return false
      if (n?.readAt) return false
      const id = String(n?.id || '')
      if (!id) return false
      return !attendedGradingNotificationIdSet.has(id)
    }).length
  }, [activityFeed, attendedGradingNotificationIdSet, gradingNotificationTypes])

  const markGradingUpdatesAttended = useCallback(() => {
    const unreadIds = Array.isArray(activityFeed)
      ? activityFeed
          .filter((n) => {
            const type = String(n?.type || '')
            if (!gradingNotificationTypes.has(type)) return false
            if (n?.readAt) return false
            const id = String(n?.id || '')
            return Boolean(id)
          })
          .map((n) => String(n.id))
      : []

    if (!unreadIds.length) return

    setAttendedGradingNotificationIds((prev) => {
      const next = Array.from(new Set([...prev, ...unreadIds]))
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(gradingAttentionStorageKey, JSON.stringify(next))
        } catch {
          // ignore
        }
      }
      return next
    })
  }, [activityFeed, gradingAttentionStorageKey, gradingNotificationTypes])

  const openNotificationsOverlay = useCallback(() => {
    if (!isMobile) {
      openDashboardOverlay('groups')
    }

    // Primary path: open the rich notifications panel listener.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pa:open-notifications'))
    }
  }, [isMobile, openDashboardOverlay])

  const mobileHeroBgStorageKey = useMemo(() => {
    const userKey = session?.user?.email || (session as any)?.user?.id || session?.user?.name || 'anon'
    return `pa:mobileHeroCover:${userKey}`
  }, [session])

  const mobileThemeBgStorageKey = useMemo(() => {
    const userKey = session?.user?.email || (session as any)?.user?.id || session?.user?.name || 'anon'
    return `pa:mobileThemeBg:${userKey}`
  }, [session])

  const roleLabel = useCallback((raw: unknown) => {
    const normalized = String(raw || '').trim()
    if (!normalized) return ''
    return getPlatformRoleDisplayLabel(normalized, {
      variant: 'directory',
      emptyWhenUnknown: true,
    })
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
  const canUploadMaterials = currentLessonRoleProfile.capabilities.canAuthorLessons
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
            roleProfileOverride: currentLessonRoleProfile,
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
        roleProfileOverride: currentLessonRoleProfile,
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
  }, [activeGradeLabel, boardIdToSessionKey, buildLessonAuthoringBoardId, currentLessonRoleProfile, getNextWindowZ, gradeReady, isTeacherOrAdminUser, overlayBounds.height, overlayBounds.width])

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
    if (!value) return '-'
    if (value.startsWith('+27') && value.length === 12) return `0${value.slice(3)}`
    if (value.startsWith('27') && value.length === 11) return `0${value.slice(2)}`
    return value
  }
  const availableSections = useMemo(
    () => DASHBOARD_SECTIONS.filter(section => (section.roles as ReadonlyArray<SectionRole>).includes(normalizedRole)),
    [normalizedRole]
  )

  const sessionRole = (((session as any)?.user?.role as string | undefined) || 'student')
  const sessionCanOrchestrateLessons = hasLessonCapabilityForRole(sessionRole, 'canOrchestrateLesson')
  const canManageSessionThumbnails = sessionCanOrchestrateLessons

  const studentMobileTabIndex = (tab: 'timeline' | 'sessions' | 'groups' | 'discover') => {
    if (tab === 'timeline') return 0
    if (tab === 'sessions') return 1
    if (tab === 'groups') return 2
    return 3
  }

  const studentMobileTabForIndex = (idx: number) =>
    (idx <= 0 ? 'timeline' : idx === 1 ? 'sessions' : idx === 2 ? 'groups' : 'discover') as
      | 'timeline'
      | 'sessions'
      | 'groups'
      | 'discover'

  const studentMobileActiveIndex = studentMobileTabIndex(studentMobileTab)
  const studentMobileVisualIndex = studentMobileCarouselWidth > 0
    ? Math.max(0, Math.min(3, studentMobileActiveIndex - (studentMobileDragOffsetPx / studentMobileCarouselWidth)))
    : studentMobileActiveIndex

  const measureStudentMobilePanelHeight = useCallback((tab: 'timeline' | 'sessions' | 'groups' | 'discover') => {
    const panel = studentMobilePanelRefs.current[tab]
    if (!panel) return
    const content = panel.firstElementChild instanceof HTMLElement ? panel.firstElementChild : panel
    const nextHeight = Math.ceil(content.getBoundingClientRect().height)
    if (!Number.isFinite(nextHeight) || nextHeight <= 0) return
    setStudentMobileActivePanelHeight(prev => (prev === nextHeight ? prev : nextHeight))
  }, [])

  const finishStudentMobileSwipe = useCallback((pointerId?: number) => {
    const state = studentMobileSwipeStateRef.current
    if (state.pointerId == null) return
    if (typeof pointerId === 'number' && state.pointerId !== pointerId) return

    const wasHorizontalSwipe = state.axis === 'x'
    const width = state.width || studentMobileCarouselWidth || 1
    const projectedIndex = state.startIndex - (state.dragX / width)
    let nextIndex = state.startIndex

    if (wasHorizontalSwipe) {
      nextIndex = Math.round(projectedIndex)
      nextIndex = Math.max(state.startIndex - 1, Math.min(state.startIndex + 1, nextIndex))
      nextIndex = Math.max(0, Math.min(3, nextIndex))
    }

    state.pointerId = null
    state.axis = null
    state.dragX = 0
    state.width = 0
    setStudentMobileIsDragging(false)
    setStudentMobileDragOffsetPx(0)

    if (wasHorizontalSwipe) {
      setStudentMobileTab(studentMobileTabForIndex(nextIndex))
    }
  }, [studentMobileCarouselWidth, studentMobileTabForIndex])

  const onStudentMobilePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const el = studentMobilePanelsRef.current
    studentMobileSwipeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragX: 0,
      axis: null,
      startIndex: studentMobileActiveIndex,
      width: el?.clientWidth || studentMobileCarouselWidth || 0,
    }
    setStudentMobileIsDragging(false)
    setStudentMobileDragOffsetPx(0)
  }, [studentMobileActiveIndex, studentMobileCarouselWidth])

  const onStudentMobilePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = studentMobileSwipeStateRef.current
    if (state.pointerId !== event.pointerId) return

    const deltaX = event.clientX - state.startX
    const deltaY = event.clientY - state.startY

    if (!state.axis) {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return
      state.axis = Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y'
      if (state.axis !== 'x') return
      event.currentTarget.setPointerCapture?.(event.pointerId)
      setStudentMobileIsDragging(true)
    }

    if (state.axis !== 'x') return

    event.preventDefault()
    let nextOffset = deltaX
    if ((state.startIndex === 0 && nextOffset > 0) || (state.startIndex === 3 && nextOffset < 0)) {
      nextOffset *= 0.35
    }
    state.dragX = nextOffset
    setStudentMobileDragOffsetPx(nextOffset)
  }, [])

  const onStudentMobilePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    finishStudentMobileSwipe(event.pointerId)
  }, [finishStudentMobileSwipe])

  const onStudentMobilePointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    finishStudentMobileSwipe(event.pointerId)
  }, [finishStudentMobileSwipe])

  const openStudentQuickOverlay = useCallback((tab: 'timeline' | 'sessions' | 'groups' | 'discover' | 'admin') => {
    setStudentQuickOverlay(tab)
    if (tab === 'timeline') setTimelineOpen(true)
  }, [])

  const closeStudentQuickOverlay = useCallback(() => {
    setStudentQuickOverlay(null)
  }, [])

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false)
  }, [])

  const isPdfResource = useCallback((item: ResourceBankItem) => {
    const filename = (item.filename || '').toLowerCase()
    const url = (item.url || '').toLowerCase()
    const contentType = (item.contentType || '').toLowerCase()
    return contentType.includes('application/pdf') || filename.endsWith('.pdf') || url.includes('.pdf')
  }, [])

  const getLibraryGradeSourceLabel = useCallback((sourceType: LibraryGradeItem['sourceType']) => {
    if (sourceType === 'assignment') return 'Assignment'
    if (sourceType === 'post_solution') return 'Post solution'
    if (sourceType === 'challenge_solution') return 'Challenge solution'
    return 'Manual test'
  }, [])

  const formatPercentageLabel = useCallback((value: number | null | undefined) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return null
    return `${Math.round(Math.max(0, Math.min(100, value)))}%`
  }, [])

  const parseScoreFraction = useCallback((item: Pick<LibraryGradeItem, 'scoreLabel' | 'earnedMarks' | 'totalMarks'>) => {
    if (typeof item.earnedMarks === 'number' && typeof item.totalMarks === 'number' && item.totalMarks > 0) {
      return {
        top: Math.round(Math.max(0, item.earnedMarks)),
        bottom: Math.round(Math.max(1, item.totalMarks)),
      }
    }

    const label = String(item.scoreLabel || '').trim()
    const ratioMatch = label.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/)
    if (!ratioMatch) return null

    const top = Number(ratioMatch[1])
    const bottom = Number(ratioMatch[2])
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) return null

    return {
      top: Math.round(Math.max(0, top)),
      bottom: Math.round(Math.max(1, bottom)),
    }
  }, [])

  const getGradeSignature = useCallback((signature?: string | null) => {
    const safe = String(signature || '').trim()
    return safe || 'Mr P. Khumalo'
  }, [])

  const fetchLibraryGrades = useCallback(async () => {
    if (status !== 'authenticated') {
      setLibraryGrades([])
      setLibraryGradesError('Sign in to view grades.')
      return
    }

    const cacheKey = makeOfflineCacheKey('library:grades')
    const cached = readLocalCache<LibraryGradeItem[]>(cacheKey)
    if (cached?.data?.length) {
      setLibraryGrades(cached.data)
    }

    setLibraryGradesLoading(true)
    setLibraryGradesError(null)

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (cached?.data?.length) {
        setLibraryGradesError('Offline. Showing last saved grades.')
      } else {
        setLibraryGrades([])
        setLibraryGradesError('Offline. No saved grades yet.')
      }
      setLibraryGradesLoading(false)
      return
    }

    try {
      const res = await fetch('/api/library/grades', { credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to load grades (${res.status})`)
      const items = Array.isArray(data?.items) ? data.items : []
      setLibraryGrades(items)
      writeLocalCache(cacheKey, items)
    } catch (err: any) {
      setLibraryGradesError(err?.message || 'Failed to load grades')
      if (!cached?.data?.length) setLibraryGrades([])
    } finally {
      setLibraryGradesLoading(false)
    }
  }, [makeOfflineCacheKey, status])

  const selectedManualAssessment = useMemo(() => {
    if (!selectedManualAssessmentId) return null
    return manualAssessments.find((item) => String(item.id) === String(selectedManualAssessmentId)) || null
  }, [manualAssessments, selectedManualAssessmentId])

  const derivePercentageFromScore = useCallback((scoreLabel: string, totalMarksHint?: number | null): string => {
    const label = String(scoreLabel || '').trim()
    if (!label) return ''

    const ratioMatch = label.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/)
    if (ratioMatch) {
      const earned = Number(ratioMatch[1])
      const total = Number(ratioMatch[2])
      if (Number.isFinite(earned) && Number.isFinite(total) && total > 0) {
        return String(Math.max(0, Math.min(100, Math.round((earned / total) * 100))))
      }
    }

    const numMatch = label.match(/-?\d+(?:\.\d+)?/)
    const earned = numMatch ? Number(numMatch[0]) : NaN
    const total = Number(totalMarksHint)
    if (Number.isFinite(earned) && Number.isFinite(total) && total > 0) {
      return String(Math.max(0, Math.min(100, Math.round((Math.max(0, earned) / total) * 100))))
    }
    return ''
  }, [])

  const fetchManualAssessments = useCallback(async () => {
    if (!canManageAnnouncements || !selectedGrade) {
      setManualAssessments([])
      setSelectedManualAssessmentId(null)
      return
    }

    setManualAssessmentsLoading(true)
    setManualAssessmentsError(null)
    try {
      const res = await fetch(`/api/library/manual-assessments?grade=${encodeURIComponent(selectedGrade)}`, {
        credentials: 'same-origin',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to load assessments (${res.status})`)

      const items = Array.isArray(data?.items) ? data.items : []
      setManualAssessments(items)
      if (!selectedManualAssessmentId && items.length > 0) {
        setSelectedManualAssessmentId(String(items[0].id || ''))
      }
      if (selectedManualAssessmentId && !items.some((item: any) => String(item.id) === selectedManualAssessmentId)) {
        setSelectedManualAssessmentId(items[0] ? String(items[0].id || '') : null)
      }
    } catch (err: any) {
      setManualAssessmentsError(err?.message || 'Failed to load assessments')
      setManualAssessments([])
      setSelectedManualAssessmentId(null)
    } finally {
      setManualAssessmentsLoading(false)
    }
  }, [canManageAnnouncements, selectedGrade, selectedManualAssessmentId])

  const fetchManualMarksheet = useCallback(async (assessmentId: string) => {
    if (!assessmentId) {
      setManualMarksheetRows([])
      setManualMarksheetDraftByUserId({})
      return
    }

    setManualMarksheetLoading(true)
    setManualMarksheetError(null)
    try {
      const res = await fetch(`/api/library/manual-assessments?assessmentId=${encodeURIComponent(assessmentId)}`, {
        credentials: 'same-origin',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to load marksheet (${res.status})`)

      const assessmentMeta = data?.assessment && typeof data.assessment === 'object' ? data.assessment : null
      if (assessmentMeta?.id) {
        setManualAssessments((prev) => prev.map((item) => {
          if (String(item.id) !== String(assessmentMeta.id)) return item
          return {
            ...item,
            title: String(assessmentMeta.title || item.title || ''),
            subject: assessmentMeta.subject ?? item.subject,
            term: assessmentMeta.term ?? item.term,
            assessmentDate: assessmentMeta.assessmentDate ?? item.assessmentDate,
            maxMarks: typeof assessmentMeta.maxMarks === 'number' ? assessmentMeta.maxMarks : item.maxMarks,
            description: assessmentMeta.description ?? item.description,
            updatedAt: String(assessmentMeta.updatedAt || item.updatedAt || ''),
          }
        }))
      }

      const rows = Array.isArray(data?.rows) ? data.rows : []
      setManualMarksheetRows(rows)

      const nextDrafts: Record<string, { scoreLabel: string; percentage: string; notes: string; screenshotUrls: string[] }> = {}
      for (const row of rows) {
        const userId = String((row as any)?.userId || '')
        if (!userId) continue
        const existingUrls: string[] = Array.isArray((row as any)?.screenshotUrls)
          ? (row as any).screenshotUrls.filter((u: any) => typeof u === 'string' && u)
          : ((row as any)?.screenshotUrl ? [String((row as any).screenshotUrl)] : [])
        nextDrafts[userId] = {
          scoreLabel: String((row as any)?.scoreLabel || ''),
          percentage: typeof (row as any)?.percentage === 'number'
            ? String(Math.round((row as any).percentage))
            : derivePercentageFromScore(
                String((row as any)?.scoreLabel || ''),
                typeof assessmentMeta?.maxMarks === 'number' ? assessmentMeta.maxMarks : selectedManualAssessment?.maxMarks
              ),
          notes: String((row as any)?.notes || ''),
          screenshotUrls: existingUrls,
        }
      }
      setManualMarksheetDraftByUserId(nextDrafts)
    } catch (err: any) {
      setManualMarksheetError(err?.message || 'Failed to load marksheet')
      setManualMarksheetRows([])
      setManualMarksheetDraftByUserId({})
    } finally {
      setManualMarksheetLoading(false)
    }
  }, [derivePercentageFromScore, selectedManualAssessment?.maxMarks])

  const beginEditSelectedManualAssessment = useCallback(() => {
    if (!selectedManualAssessment) return
    setManualAssessmentEditingId(String(selectedManualAssessment.id))
    setManualAssessmentTitleDraft(String(selectedManualAssessment.title || ''))
    setManualAssessmentSubjectDraft(String(selectedManualAssessment.subject || ''))
    setManualAssessmentTermDraft(String(selectedManualAssessment.term || ''))
    setManualAssessmentDateDraft(String(selectedManualAssessment.assessmentDate || ''))
    setManualAssessmentMaxMarksDraft(
      selectedManualAssessment.maxMarks != null ? String(selectedManualAssessment.maxMarks) : ''
    )
    setManualAssessmentDescriptionDraft(String(selectedManualAssessment.description || ''))
    setManualAssessmentCreateError(null)
    setManualAssessmentCreateSuccess(null)
  }, [selectedManualAssessment])

  const cancelManualAssessmentEditing = useCallback(() => {
    setManualAssessmentEditingId(null)
    setManualAssessmentTitleDraft('')
    setManualAssessmentSubjectDraft('')
    setManualAssessmentTermDraft('')
    setManualAssessmentDateDraft('')
    setManualAssessmentMaxMarksDraft('')
    setManualAssessmentDescriptionDraft('')
    setManualAssessmentCreateError(null)
  }, [])

  const createManualAssessment = useCallback(async () => {
    if (!selectedGrade) {
      setManualAssessmentCreateError('Select a grade first.')
      return
    }

    const title = manualAssessmentTitleDraft.trim()
    if (!title) {
      setManualAssessmentCreateError('Assessment title is required.')
      return
    }

    const maxMarksValue = manualAssessmentMaxMarksDraft.trim()
    const maxMarksNumber = maxMarksValue ? Number(manualAssessmentMaxMarksDraft) : null
    if (maxMarksValue && (!Number.isFinite(maxMarksNumber) || Number(maxMarksNumber) <= 0)) {
      setManualAssessmentCreateError('Test total must be a positive number.')
      return
    }

    const isEditing = Boolean(manualAssessmentEditingId)

    setManualAssessmentCreating(true)
    setManualAssessmentUpdating(isEditing)
    setManualAssessmentCreateError(null)
    setManualAssessmentCreateSuccess(null)
    try {
      const res = await fetch('/api/library/manual-assessments', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: isEditing ? 'updateAssessment' : 'create',
          assessmentId: manualAssessmentEditingId,
          title,
          grade: selectedGrade,
          subject: manualAssessmentSubjectDraft.trim(),
          term: manualAssessmentTermDraft.trim(),
          assessmentDate: manualAssessmentDateDraft.trim(),
          maxMarks: maxMarksNumber,
          description: manualAssessmentDescriptionDraft.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to ${isEditing ? 'update' : 'create'} assessment (${res.status})`)

      const item = data?.item
      if (item?.id) {
        setManualAssessments((prev) => {
          if (isEditing) {
            return prev.map((entry) => (String(entry.id) === String(item.id) ? { ...entry, ...item } : entry))
          }
          return [item, ...prev.filter((entry) => String(entry.id) !== String(item.id))]
        })
        setSelectedManualAssessmentId(String(item.id))
      }

      setManualAssessmentEditingId(null)
      setManualAssessmentTitleDraft('')
      setManualAssessmentSubjectDraft('')
      setManualAssessmentTermDraft('')
      setManualAssessmentDateDraft('')
      setManualAssessmentMaxMarksDraft('')
      setManualAssessmentDescriptionDraft('')
      setManualAssessmentCreateSuccess(isEditing ? 'Assessment updated.' : 'Assessment created.')
      void fetchManualAssessments()
      if (selectedManualAssessmentId || item?.id) {
        void fetchManualMarksheet(String(item?.id || selectedManualAssessmentId || ''))
      }
    } catch (err: any) {
      setManualAssessmentCreateError(err?.message || `Failed to ${isEditing ? 'update' : 'create'} assessment`)
    } finally {
      setManualAssessmentCreating(false)
      setManualAssessmentUpdating(false)
    }
  }, [fetchManualAssessments, fetchManualMarksheet, manualAssessmentDateDraft, manualAssessmentDescriptionDraft, manualAssessmentEditingId, manualAssessmentMaxMarksDraft, manualAssessmentSubjectDraft, manualAssessmentTermDraft, manualAssessmentTitleDraft, selectedGrade, selectedManualAssessmentId])

  const deleteSelectedManualAssessment = useCallback(async () => {
    if (!selectedManualAssessmentId || !selectedManualAssessment) return
    if (!window.confirm(
      `Delete test "${selectedManualAssessment.title}"?\n\nThis will permanently remove:\n- the test\n- all learner marks\n- all screenshots\n- all comments\n\nThis cannot be undone.`
    )) return
    setManualAssessmentDeleting(true)
    setManualMarksheetError(null)
    try {
      const res = await fetch('/api/library/manual-assessments', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteAssessment', assessmentId: selectedManualAssessmentId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to delete assessment (${res.status})`)
      setManualAssessments((prev) => prev.filter((entry) => String(entry.id) !== String(selectedManualAssessmentId)))
      setSelectedManualAssessmentId((prev) => {
        if (!prev) return null
        const remaining = manualAssessments.filter((entry) => String(entry.id) !== String(selectedManualAssessmentId))
        return remaining[0] ? String(remaining[0].id) : null
      })
      setManualMarksheetRows([])
      setManualMarksheetDraftByUserId({})
    } catch (err: any) {
      setManualMarksheetError(err?.message || 'Failed to delete assessment')
    } finally {
      setManualAssessmentDeleting(false)
    }
  }, [manualAssessments, selectedManualAssessment, selectedManualAssessmentId])

  const openGradeDetail = useCallback(async (item: LibraryGradeItem) => {
    setGradeDetailOpen(true)
    setGradeDetailItem(item)
    setGradeDetailData(null)
    setGradeDetailError(null)
    setGradeCommentDraft('')
    setGradeCommentEditId(null)
    setGradeCommentEditDraft('')
    setGradeDetailLoading(true)
    try {
      const responseId = String(item.responseId || item.id || '')
      const sourceType = String(item.sourceType || '')
      if (!responseId || !sourceType) {
        throw new Error('This grade has no detailed record yet.')
      }
      const res = await fetch(`/api/library/grades?detailResponseId=${encodeURIComponent(responseId)}&detailSourceType=${encodeURIComponent(sourceType)}`, {
        credentials: 'same-origin',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to load grade details (${res.status})`)
      if (!data?.detail) throw new Error('Grade details unavailable')
      setGradeDetailData(data.detail)
    } catch (err: any) {
      setGradeDetailError(err?.message || 'Failed to load grade details')
    } finally {
      setGradeDetailLoading(false)
    }
  }, [])

  const openGradeScreenshotViewer = useCallback((url: string, title: string) => {
    if (!url) return
    setGradeImageViewer({ url, title })
  }, [])

  const closeGradeScreenshotViewer = useCallback(() => {
    setGradeImageViewer(null)
  }, [])

  const submitGradeComment = useCallback(async () => {
    if (!gradeDetailItem) return
    const text = gradeCommentDraft.trim()
    if (!text) return
    if (text.length > 100) {
      setGradeDetailError('Comment must be 100 characters or fewer.')
      return
    }
    setGradeCommentBusy(true)
    setGradeDetailError(null)
    try {
      const responseId = String(gradeDetailItem.responseId || gradeDetailItem.id || '')
      const res = await fetch('/api/library/grades', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'commentCreate', responseId, text }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to post comment (${res.status})`)
      setGradeDetailData((prev) => prev ? { ...prev, comments: Array.isArray(data?.comments) ? data.comments : prev.comments } : prev)
      setGradeCommentDraft('')
    } catch (err: any) {
      setGradeDetailError(err?.message || 'Failed to post comment')
    } finally {
      setGradeCommentBusy(false)
    }
  }, [gradeCommentDraft, gradeDetailItem])

  const updateGradeComment = useCallback(async (commentId: string) => {
    if (!gradeDetailItem) return
    const text = gradeCommentEditDraft.trim()
    if (!text) return
    if (text.length > 100) {
      setGradeDetailError('Comment must be 100 characters or fewer.')
      return
    }
    setGradeCommentBusy(true)
    setGradeDetailError(null)
    try {
      const responseId = String(gradeDetailItem.responseId || gradeDetailItem.id || '')
      const res = await fetch('/api/library/grades', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'commentUpdate', responseId, commentId, text }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to update comment (${res.status})`)
      setGradeDetailData((prev) => prev ? { ...prev, comments: Array.isArray(data?.comments) ? data.comments : prev.comments } : prev)
      setGradeCommentEditId(null)
      setGradeCommentEditDraft('')
    } catch (err: any) {
      setGradeDetailError(err?.message || 'Failed to update comment')
    } finally {
      setGradeCommentBusy(false)
    }
  }, [gradeCommentEditDraft, gradeDetailItem])

  const deleteGradeComment = useCallback(async (commentId: string) => {
    if (!gradeDetailItem) return
    if (!window.confirm('Delete this comment permanently? This cannot be undone.')) return
    setGradeCommentBusy(true)
    setGradeDetailError(null)
    try {
      const responseId = String(gradeDetailItem.responseId || gradeDetailItem.id || '')
      const res = await fetch('/api/library/grades', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'commentDelete', responseId, commentId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to delete comment (${res.status})`)
      setGradeDetailData((prev) => prev ? { ...prev, comments: Array.isArray(data?.comments) ? data.comments : prev.comments } : prev)
      if (gradeCommentEditId === commentId) {
        setGradeCommentEditId(null)
        setGradeCommentEditDraft('')
      }
    } catch (err: any) {
      setGradeDetailError(err?.message || 'Failed to delete comment')
    } finally {
      setGradeCommentBusy(false)
    }
  }, [gradeCommentEditId, gradeDetailItem])

  const saveManualMarksheetRow = useCallback(async (learnerUserId: string) => {
    if (!selectedManualAssessmentId) return
    const draft = manualMarksheetDraftByUserId[learnerUserId]
    if (!draft) return
    const autoPercentage = derivePercentageFromScore(draft.scoreLabel, selectedManualAssessment?.maxMarks)
    const finalPercentage = autoPercentage || draft.percentage.trim()

    setManualMarksheetSavingUserId(learnerUserId)
    setManualMarksheetError(null)
    try {
      const res = await fetch('/api/library/manual-assessments', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveMark',
          assessmentId: selectedManualAssessmentId,
          learnerUserId,
          scoreLabel: draft.scoreLabel,
          percentage: finalPercentage ? Number(finalPercentage) : null,
          notes: draft.notes,
          screenshotUrls: draft.screenshotUrls,
          screenshotUrl: draft.screenshotUrls[0] || '',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to save mark (${res.status})`)

      const savedItem = data?.item || null
      setManualMarksheetRows((prev) => prev.map((row) => {
        if (String(row.userId) !== learnerUserId) return row
        return {
          ...row,
          scoreLabel: String(savedItem?.scoreLabel || draft.scoreLabel || row.scoreLabel),
          percentage: typeof savedItem?.percentage === 'number'
            ? savedItem.percentage
            : (finalPercentage ? Number(finalPercentage) : null),
          notes: draft.notes || null,
          screenshotUrl: draft.screenshotUrls[0] || null,
          screenshotUrls: draft.screenshotUrls,
          gradedAt: savedItem?.gradedAt || new Date().toISOString(),
        }
      }))

      if (autoPercentage) {
        setManualMarksheetDraftByUserId((prev) => ({
          ...prev,
          [learnerUserId]: {
            ...prev[learnerUserId],
            percentage: autoPercentage,
          },
        }))
      }

      void fetchLibraryGrades()
    } catch (err: any) {
      setManualMarksheetError(err?.message || 'Failed to save mark')
    } finally {
      setManualMarksheetSavingUserId(null)
    }
  }, [derivePercentageFromScore, fetchLibraryGrades, manualMarksheetDraftByUserId, selectedManualAssessment?.maxMarks, selectedManualAssessmentId])

  // ScriptPhotosEditor onChange handler factory — one per row
  const makeManualMarksheetPhotosChange = useCallback((learnerUserId: string) => (newUrls: string[]) => {
    setManualMarksheetDraftByUserId((prev) => ({
      ...prev,
      [learnerUserId]: { ...prev[learnerUserId], screenshotUrls: newUrls },
    }))
  }, [])

  const visibleManualMarksheetRows = useMemo(() => {
    const query = manualMarksheetSearch.trim().toLowerCase()
    if (!query) return manualMarksheetRows
    return manualMarksheetRows.filter((row) => {
      const haystack = `${row.surname} ${row.givenName} ${row.fullName}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [manualMarksheetRows, manualMarksheetSearch])

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
    markGradingUpdatesAttended()
    setBooksOverlayOpen(true)
    void fetchBooksForGrade()
    void fetchLibraryGrades()
    if (canManageAnnouncements) {
      void fetchManualAssessments()
    }
  }, [canManageAnnouncements, fetchBooksForGrade, fetchLibraryGrades, fetchManualAssessments, markGradingUpdatesAttended])

  useEffect(() => {
    if (!booksOverlayOpen) return
    const cached = readLocalCache<string[]>(offlineDocsKey)
    setOfflineDocUrls(Array.isArray(cached?.data) ? cached.data : [])
  }, [booksOverlayOpen, offlineDocsKey])

  useEffect(() => {
    if (!booksOverlayOpen) return
    if (!canManageAnnouncements) return
    void fetchManualAssessments()
  }, [booksOverlayOpen, canManageAnnouncements, fetchManualAssessments, selectedGrade])

  useEffect(() => {
    if (!booksOverlayOpen) return
    if (!canManageAnnouncements) return
    if (!selectedManualAssessmentId) {
      setManualMarksheetRows([])
      setManualMarksheetDraftByUserId({})
      return
    }
    void fetchManualMarksheet(selectedManualAssessmentId)
  }, [booksOverlayOpen, canManageAnnouncements, fetchManualMarksheet, selectedManualAssessmentId])

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
      const response = await fetch(url)
      if (!response) throw new Error('Unable to download file.')
      if (!response.ok) {
        throw new Error(`Unable to download file (${response.status}).`)
      }
      if (response.type === 'opaque') {
        throw new Error('Unable to save this file offline.')
      }
      await cache.put(url, response.clone())
      if (!offlineDocUrls.includes(url)) {
        setOfflineDocs([...offlineDocUrls, url])
      }
    } catch (err: any) {
      const rawMessage = String(err?.message || '')
      let displayMessage = rawMessage || 'Failed to save offline.'
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        displayMessage = 'Connect to the internet to save offline.'
      } else if (/failed to fetch|network\s*error|networkerror|load failed|fetch failed/i.test(rawMessage)) {
        displayMessage = 'Unable to save offline: source server blocks download access.'
      } else {
        const statusMatch = rawMessage.match(/\((\d{3})\)/)
        if (statusMatch?.[1]) {
          displayMessage = `Unable to save offline (${statusMatch[1]}).`
        }
      }
      setOfflineDocErrorByUrl(prev => ({ ...prev, [url]: displayMessage }))
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
    const stableCacheKey = String(item.id || item.url || item.title || 'pdf')
    const openWithUrl = (url: string) => {
      setPdfViewerUrl(url)
      setPdfViewerCacheKey(stableCacheKey)
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
      setPdfViewerCacheKey(pdfViewerCacheKey)
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
    setEditingPostId(null)
    setChallengeAudiencePickerOpen(false)
    setChallengeImageUrl(null)
    setChallengeImageSourceFile(null)
    setChallengeParsedJsonText(null)
    setChallengeParsedOpen(false)
    setCreateOverlayOpen(true)
    setChallengeImageEditFile(file)
    setChallengeImageEditOpen(true)
  }, [pdfViewerCacheKey, pdfViewerSubtitle, pdfViewerTitle, pdfViewerUrl, queueRestore])

  useEffect(() => {
    return () => {
      if (pdfViewerOfflineObjectUrl) {
        URL.revokeObjectURL(pdfViewerOfflineObjectUrl)
      }
    }
  }, [pdfViewerOfflineObjectUrl])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const el = studentMobilePanelsRef.current
    if (!el) return

    let rafId: number | null = null
    const scheduleMeasure = () => {
      if (rafId) window.cancelAnimationFrame(rafId)
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        const nextWidth = Math.round(el.getBoundingClientRect().width)
        if (!Number.isFinite(nextWidth) || nextWidth <= 0) return
        setStudentMobileCarouselWidth(prev => (prev === nextWidth ? prev : nextWidth))
      })
    }

    scheduleMeasure()

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          scheduleMeasure()
        })
      : null

    resizeObserver?.observe(el)
    window.addEventListener('resize', scheduleMeasure)

    return () => {
      window.removeEventListener('resize', scheduleMeasure)
      if (rafId) window.cancelAnimationFrame(rafId)
      resizeObserver?.disconnect()
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    let rafId: number | null = null
    const scheduleMeasure = () => {
      if (rafId) window.cancelAnimationFrame(rafId)
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        measureStudentMobilePanelHeight(studentMobileTab)
      })
    }

    scheduleMeasure()

    const panel = studentMobilePanelRefs.current[studentMobileTab]
    const target = panel?.firstElementChild instanceof HTMLElement ? panel.firstElementChild : panel
    const resizeObserver = typeof ResizeObserver !== 'undefined' && target
      ? new ResizeObserver(() => {
          scheduleMeasure()
        })
      : null

    if (resizeObserver && target) {
      resizeObserver.observe(target)
    }

    window.addEventListener('resize', scheduleMeasure)

    return () => {
      window.removeEventListener('resize', scheduleMeasure)
      if (rafId) window.cancelAnimationFrame(rafId)
      resizeObserver?.disconnect()
    }
  }, [measureStudentMobilePanelHeight, studentMobileTab])

  useEffect(() => {
    if (status !== 'authenticated') return
    if (!isRecognizedLessonParticipantRole(sessionRole)) return

    let cancelled = false
    setStudentFeedLoading(true)
    setStudentFeedError(null)
    void (async () => {
      try {
        const [challengeRes, postRes] = await Promise.all([
          fetch('/api/challenges/feed', { credentials: 'same-origin' }),
          fetch('/api/posts/feed', { credentials: 'same-origin' }),
        ])
        const challengeData = await challengeRes.json().catch(() => ({}))
        const postData = await postRes.json().catch(() => ({}))
        if (!challengeRes.ok && !postRes.ok) {
          if (!cancelled) {
            setStudentFeedError(challengeData?.message || postData?.message || `Unable to load posts (${challengeRes.status}/${postRes.status})`)
            setStudentFeedPosts([])
          }
          return
        }
        const posts = sortDashboardItemsByCreatedAt([
          ...(Array.isArray(challengeData?.posts) ? challengeData.posts.map((item: any) => ({ ...item, kind: 'challenge' })) : []),
          ...(Array.isArray(postData?.posts) ? postData.posts.map((item: any) => ({ ...item, kind: 'post' })) : []),
        ])
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

  const closeChallengeResponseOverlay = useCallback(() => {
    suppressChallengeAutoOpenRef.current = true
    setChallengeResponseOverlayOpen(false)
    setSelectedChallengeResponseId(null)
    setChallengeResponseChallenge(null)
    setChallengeThreadResponses([])
    setChallengeResponseError(null)
    clearChallengeOverlayQuery()
  }, [clearChallengeOverlayQuery])

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
    setEditingPostId(null)
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

  const openEditPostComposer = useCallback((post: any) => {
    const id = post?.id ? String(post.id) : ''
    if (!id) return

    const audienceRaw = typeof post?.audience === 'string' ? post.audience : 'public'
    const audience = (audienceRaw === 'public' || audienceRaw === 'grade' || audienceRaw === 'private') ? audienceRaw : 'public'

    setCreateKind('post')
    setEditingChallengeId(null)
    setEditingPostId(id)
    setChallengeTitleDraft(String(post?.title || ''))
    setChallengePromptDraft(String(post?.prompt || ''))
    setChallengeAudienceDraft(audience)
    setChallengeMaxAttempts('unlimited')
    setChallengeImageUrl(typeof post?.imageUrl === 'string' ? post.imageUrl : null)
    setChallengeParsedJsonText(null)
    setChallengeParsedOpen(false)
    setCreateOverlayOpen(true)
  }, [])

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

  const deletePost = useCallback(async (postId: string) => {
    const id = postId ? String(postId) : ''
    if (!id) return

    const ok = typeof window !== 'undefined'
      ? window.confirm('Delete this post? This will remove it from your timeline and delete its public solutions thread.')
      : false
    if (!ok) return

    setChallengeDeleting(true)
    try {
      const res = await fetch(`/api/posts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data?.message || `Failed to delete (${res.status})`)
        return
      }

      setTimelineChallenges(prev => (Array.isArray(prev) ? prev.filter((item: any) => getDashboardItemKey(item) !== `post:${id}`) : prev))
      setStudentFeedPosts(prev => (Array.isArray(prev) ? prev.filter((item: any) => getDashboardItemKey(item) !== `post:${id}`) : prev))
      setMyPosts(prev => Array.isArray(prev) ? prev.filter((item: any) => getDashboardItemKey(item) !== `post:${id}`) : prev)
      setPostThreadOverlay((prev) => (prev?.postId === id ? null : prev))
      setPostSolveOverlay((prev) => (prev?.postId === id ? null : prev))
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

  const fetchChallengeResponseThread = useCallback(async (challengeId: string) => {
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
        setChallengeThreadResponses([])
        return
      }

      const responsesData = await responsesRes.json().catch(() => ({}))
      if (!responsesRes.ok) {
        setChallengeResponseError(responsesData?.message || `Failed to load responses (${responsesRes.status})`)
        setChallengeResponseChallenge(challengeData)
        setChallengeThreadResponses([])
        return
      }

      const responses = Array.isArray(responsesData?.responses) ? responsesData.responses : []
      responses.sort((a: any, b: any) => {
        const aT = a?.createdAt ? new Date(a.createdAt).getTime() : 0
        const bT = b?.createdAt ? new Date(b.createdAt).getTime() : 0
        return bT - aT
      })

      rememberInteractiveViewportScenes(responses)
      setChallengeResponseChallenge(challengeData)
      setChallengeThreadResponses(responses)
    } catch (err: any) {
      setChallengeResponseError(err?.message || 'Failed to load solutions')
      setChallengeResponseChallenge(null)
      setChallengeThreadResponses([])
    } finally {
      setChallengeResponseLoading(false)
    }
  }, [rememberInteractiveViewportScenes])

  const challengeOwnResponses = useMemo(() => {
    const effectiveCurrentUserId = String(currentUserId || viewerId || '')
    if (!effectiveCurrentUserId) return []
    return (Array.isArray(challengeThreadResponses) ? challengeThreadResponses : []).filter((response: any) => {
      const responseUserId = String(response?.userId || response?.user?.id || '')
      return responseUserId === effectiveCurrentUserId
    })
  }, [challengeThreadResponses, currentUserId, viewerId])

  const canViewChallengeThread = useMemo(() => {
    const data = challengeResponseChallenge as any
    if (!data) return false
    if (data?.isOwner || data?.isPrivileged || data?.solutionsVisible) return true
    const myAttemptCount = typeof data?.myAttemptCount === 'number' ? data.myAttemptCount : challengeOwnResponses.length
    return myAttemptCount > 0
  }, [challengeResponseChallenge, challengeOwnResponses.length])

  const getThreadResponseTimestamp = useCallback((response: any) => {
    const updated = response?.updatedAt ? new Date(response.updatedAt).getTime() : 0
    const created = response?.createdAt ? new Date(response.createdAt).getTime() : 0
    return Math.max(updated, created)
  }, [])

  const orderThreadResponsesForFeed = useCallback((responses: any[]) => {
    const latestByUser = new Map<string, any>()
    for (const response of Array.isArray(responses) ? responses : []) {
      const responseUserId = String(response?.userId || response?.user?.id || response?.userEmail || response?.id || '')
      if (!responseUserId) continue
      const existing = latestByUser.get(responseUserId)
      if (!existing || getThreadResponseTimestamp(response) > getThreadResponseTimestamp(existing)) {
        latestByUser.set(responseUserId, response)
      }
    }

    const deduped = Array.from(latestByUser.values()).sort((a, b) => getThreadResponseTimestamp(b) - getThreadResponseTimestamp(a))
    const effectiveCurrentUserId = String(currentUserId || viewerId || '')
    if (!effectiveCurrentUserId) return deduped

    const mine = deduped.find((response: any) => String(response?.userId || response?.user?.id || '') === effectiveCurrentUserId)
    const others = deduped.filter((response: any) => String(response?.userId || response?.user?.id || '') !== effectiveCurrentUserId)
    return mine ? [mine, ...others] : deduped
  }, [currentUserId, getThreadResponseTimestamp, viewerId])

  const displayPostThreadResponses = useMemo(() => {
    return orderThreadResponsesForFeed(postThreadResponses)
  }, [orderThreadResponsesForFeed, postThreadResponses])

  const displayChallengeThreadResponses = useMemo(() => {
    return orderThreadResponsesForFeed(challengeThreadResponses)
  }, [challengeThreadResponses, orderThreadResponsesForFeed])

  function rememberInteractiveViewportScenes(responses: any[]) {
    for (const response of Array.isArray(responses) ? responses : []) {
      const responseId = String(response?.id || '')
      if (!responseId) continue
      const normalizedScene = normalizePublicSolveScene(response?.excalidrawScene)
      if (!normalizedScene) continue
      try {
        interactiveViewportSavedSceneRef.current[responseId] = JSON.stringify(normalizedScene)
      } catch {
        // ignore serialization issues and fall back to live saves only
      }
    }
  }

  const applyInteractiveViewportSceneLocally = useCallback((responseId: string, scene: PublicSolveScene) => {
    const safeResponseId = String(responseId || '')
    if (!safeResponseId) return

    const updateResponseList = (responses: any[]) => (
      Array.isArray(responses)
        ? responses.map((response: any) => String(response?.id || '') === safeResponseId
          ? { ...(response || {}), excalidrawScene: scene }
          : response)
        : responses
    )

    setPostThreadResponses((prev) => updateResponseList(prev))
    setChallengeThreadResponses((prev) => updateResponseList(prev))
    setStudentFeedPosts((prev: any[]) => (
      Array.isArray(prev)
        ? prev.map((item: any) => {
            if (String(item?.ownResponse?.id || '') !== safeResponseId) return item
            return {
              ...(item || {}),
              ownResponse: {
                ...(item?.ownResponse || {}),
                excalidrawScene: scene,
              },
            }
          })
        : prev
    ))
    setTimelineChallenges((prev: any[]) => (
      Array.isArray(prev)
        ? prev.map((item: any) => {
            if (String(item?.ownResponse?.id || '') !== safeResponseId) return item
            return {
              ...(item || {}),
              ownResponse: {
                ...(item?.ownResponse || {}),
                excalidrawScene: scene,
              },
            }
          })
        : prev
    ))
  }, [])

  const flushInteractiveViewportSave = useCallback(async (responseId: string) => {
    const safeResponseId = String(responseId || '')
    if (!safeResponseId) return
    const pending = interactiveViewportQueuedSceneRef.current[safeResponseId]
    if (!pending?.threadKey) return

    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(pending.threadKey)}/responses`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responseId: safeResponseId,
          excalidrawScene: pending.scene,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || `Failed to save view (${res.status})`)
      }

      interactiveViewportSavedSceneRef.current[safeResponseId] = pending.serialized
      setInteractiveViewportSavingByResponseId((prev) => {
        if (!prev[safeResponseId]) return prev
        const next = { ...prev }
        delete next[safeResponseId]
        return next
      })
      setInteractiveViewportErrorByResponseId((prev) => {
        if (!prev[safeResponseId]) return prev
        const next = { ...prev }
        delete next[safeResponseId]
        return next
      })
    } catch (err: any) {
      setInteractiveViewportSavingByResponseId((prev) => {
        if (!prev[safeResponseId]) return prev
        const next = { ...prev }
        delete next[safeResponseId]
        return next
      })
      setInteractiveViewportErrorByResponseId((prev) => ({
        ...prev,
        [safeResponseId]: err?.message || 'Failed to save view',
      }))
    } finally {
      delete interactiveViewportQueuedSceneRef.current[safeResponseId]
      const timeoutId = interactiveViewportSaveTimeoutsRef.current[safeResponseId]
      if (typeof timeoutId === 'number' && typeof window !== 'undefined') {
        window.clearTimeout(timeoutId)
      }
      delete interactiveViewportSaveTimeoutsRef.current[safeResponseId]
    }
  }, [])

  const queueInteractiveViewportSave = useCallback((threadKey: string, responseId: string, scene: PublicSolveScene) => {
    const safeThreadKey = String(threadKey || '').trim()
    const safeResponseId = String(responseId || '').trim()
    const normalizedScene = normalizePublicSolveScene(scene)
    if (!safeThreadKey || !safeResponseId || !normalizedScene) return

    let serialized = ''
    try {
      serialized = JSON.stringify(normalizedScene)
    } catch {
      return
    }

    const savedSerialized = interactiveViewportSavedSceneRef.current[safeResponseId]
    const queuedSerialized = interactiveViewportQueuedSceneRef.current[safeResponseId]?.serialized
    if (savedSerialized === serialized || queuedSerialized === serialized) {
      setInteractiveViewportSavingByResponseId((prev) => {
        if (!prev[safeResponseId]) return prev
        const next = { ...prev }
        delete next[safeResponseId]
        return next
      })
      return
    }

    applyInteractiveViewportSceneLocally(safeResponseId, normalizedScene)
    setInteractiveViewportErrorByResponseId((prev) => {
      if (!prev[safeResponseId]) return prev
      const next = { ...prev }
      delete next[safeResponseId]
      return next
    })

    interactiveViewportQueuedSceneRef.current[safeResponseId] = {
      threadKey: safeThreadKey,
      scene: normalizedScene,
      serialized,
    }
    setInteractiveViewportSavingByResponseId((prev) => ({ ...prev, [safeResponseId]: true }))

    if (typeof window === 'undefined') return
    const existingTimeoutId = interactiveViewportSaveTimeoutsRef.current[safeResponseId]
    if (typeof existingTimeoutId === 'number') {
      window.clearTimeout(existingTimeoutId)
    }
    interactiveViewportSaveTimeoutsRef.current[safeResponseId] = window.setTimeout(() => {
      void flushInteractiveViewportSave(safeResponseId)
    }, 320)
  }, [applyInteractiveViewportSceneLocally, flushInteractiveViewportSave])

  const postSolvePreviewResponseId = 'draft-post-solve-preview-response'

  const postSolvePreviewResponses = useMemo(() => {
    if (!postSolvePreviewOverlay) return []

    const effectiveCurrentUserId = String(currentUserId || viewerId || '')
    const responseUserName = String(session?.user?.name || session?.user?.email || 'You')
    const responseUserAvatar = String((session as any)?.user?.avatar || (session as any)?.user?.image || '').trim()
    const draftResponse = {
      id: postSolvePreviewResponseId,
      userId: effectiveCurrentUserId,
      user: {
        id: effectiveCurrentUserId,
        name: responseUserName,
        email: String(session?.user?.email || ''),
        avatar: responseUserAvatar || null,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      latex: '',
      studentText: null,
      feedback: null,
      gradingJson: null,
      excalidrawScene: postSolvePreviewOverlay.draftScene,
      __draftPreview: true,
    }

    return orderThreadResponsesForFeed([draftResponse, ...(Array.isArray(postSolvePreviewOverlay.responses) ? postSolvePreviewOverlay.responses : [])])
  }, [currentUserId, orderThreadResponsesForFeed, postSolvePreviewOverlay, session, viewerId])

  useEffect(() => {
    const previewPostId = String(postSolvePreviewOverlay?.draft?.postId || '')
    if (!previewPostId) return

    if (activeSection !== 'overview') setActiveSection('overview')
    if (dashboardSectionOverlay) setDashboardSectionOverlay(null)
    if (studentQuickOverlay) setStudentQuickOverlay(null)
    if (studentMobileTab !== 'timeline') setStudentMobileTab('timeline')

    setExpandedSolutionThreadKey(`post:${previewPostId}`)
    setExpandedSolutionThreadKind('post')

    if (typeof window === 'undefined') return

    let timeoutId: number | null = null
    let attempts = 0
    const previewKey = `post:${previewPostId}`

    const scrollToTarget = () => {
      const target = postFeedItemRefs.current[previewKey]
      if (!target) return false
      target.scrollIntoView({ block: 'start', behavior: 'smooth' })
      return true
    }

    if (!scrollToTarget()) {
      const retry = () => {
        attempts += 1
        if (scrollToTarget() || attempts >= 20) return
        timeoutId = window.setTimeout(retry, 60)
      }
      timeoutId = window.setTimeout(retry, 0)
    }

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
  }, [activeSection, dashboardSectionOverlay, postSolvePreviewOverlay, studentMobileTab, studentQuickOverlay])

  const formatSolutionsLabel = useCallback((count: unknown) => {
    const safeCount = typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
    if (safeCount <= 0) return 'Solutions'
    if (safeCount === 1) return '1 solution'
    return `${safeCount} Solutions`
  }, [])

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
    void fetchChallengeResponseThread(selectedChallengeResponseId)
  }, [challengeResponseOverlayOpen, selectedChallengeResponseId, fetchChallengeResponseThread])

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

        const [challengeRes, postRes] = await Promise.all([
          fetch(`/api/profile/view/${encodeURIComponent(userId)}/challenges`, { credentials: 'same-origin' }),
          fetch(`/api/profile/view/${encodeURIComponent(userId)}/posts`, { credentials: 'same-origin' }),
        ])
        const challengeData = await challengeRes.json().catch(() => ({}))
        const postData = await postRes.json().catch(() => ({}))
        if (!challengeRes.ok && !postRes.ok) {
          setTimelineChallengesError(challengeData?.message || postData?.message || `Unable to load timeline (${challengeRes.status}/${postRes.status})`)
          setTimelineChallenges([])
          return
        }
        const items = sortDashboardItemsByCreatedAt([
          ...(Array.isArray(challengeData?.challenges) ? challengeData.challenges.map((item: any) => ({ ...item, kind: 'challenge' })) : []),
          ...(Array.isArray(postData?.posts) ? postData.posts.map((item: any) => ({ ...item, kind: 'post' })) : []),
        ])
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
    const ids = timelineChallenges.map((c: any) => getDashboardItemKey(c)).filter(Boolean)
    markTimelinePostsRead(ids)
  }, [timelineOpen, timelineChallengesLoading, timelineChallengesError, timelineChallenges, markTimelinePostsRead])

  const renderTimelineItems = (items: any[]) => (
    <ul className="space-y-2">
      {items.map((c: any) => {
        const kind = getDashboardItemKind(c)
        const isPost = kind === 'post'
        const title = (c?.title || '').trim() || (isPost ? 'Post' : 'Quiz')
        const createdAt = c?.createdAt ? new Date(c.createdAt).toLocaleString() : ''
        const myAttemptCount = typeof c?.myAttemptCount === 'number' ? c.myAttemptCount : 0
        const maxAttempts = typeof c?.maxAttempts === 'number' ? c.maxAttempts : null
        const attemptsOpen = c?.attemptsOpen !== false
        const prompt = typeof c?.prompt === 'string' ? c.prompt.trim() : ''

        const isOwner = viewerId && c?.createdById && String(c.createdById) === String(viewerId)
        const hasAttempted = myAttemptCount > 0
        const canAttempt = attemptsOpen && (maxAttempts === null || myAttemptCount < maxAttempts)
        const href = c?.id ? `/challenges/${encodeURIComponent(String(c.id))}` : '#'

        return (
          <li key={getDashboardItemKey(c)} className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-white break-words">{title}</div>
                {createdAt ? <div className="text-xs text-white/60">{createdAt}</div> : null}
                {prompt ? <div className="mt-1 text-sm text-white/75 break-words">{prompt.slice(0, 140)}{prompt.length > 140 ? '...' : ''}</div> : null}
              </div>
              {c?.id ? (
                isPost ? (
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {isOwner ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-primary shrink-0"
                          onClick={() => openEditPostComposer(c)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost text-xs shrink-0"
                          onClick={() => void deletePost(String(c.id))}
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary shrink-0"
                        onClick={() => {
                          if (c?.hasOwnResponse) {
                            void openPostThread(c)
                            return
                          }
                          void openPostSolveComposer(c)
                        }}
                      >
                        {c?.hasOwnResponse ? formatSolutionsLabel((c as any)?.solutionCount) : 'Solve'}
                      </button>
                    )}
                  </div>
                ) : isOwner ? (
                  <div className="flex flex-col items-end gap-2 shrink-0">
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
                    <button
                      type="button"
                      className="btn btn-ghost text-xs shrink-0"
                      onClick={() => openChallengeCommentThread(String(c.id))}
                    >
                      {formatSolutionsLabel((c as any)?.solutionCount)}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {canAttempt && !hasAttempted ? (
                      <Link href={href} className="btn btn-primary shrink-0">
                        Solve
                      </Link>
                    ) : hasAttempted ? (
                      <button
                        type="button"
                        className="btn btn-primary shrink-0"
                        onClick={() => openChallengeCommentThread(String(c.id))}
                      >
                        Solutions
                      </button>
                    ) : (
                      <button type="button" className="btn btn-ghost shrink-0" disabled>
                        Closed
                      </button>
                    )}
                  </div>
                )
              ) : null}
            </div>
            {renderInlineSolutionsThread(c, { kind: isPost ? 'post' : 'challenge', canAttempt, href })}
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
          className={`${baseBtn} relative flex-none snap-start`}
          style={{ width: buttonWidth }}
          onClick={openBooksOverlay}
          aria-label="Books & materials"
          title="Books & materials"
        >
          <span className="relative inline-flex">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H18a2 2 0 0 1 2 2v13.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M4 5.5V18a3 3 0 0 0 3 3h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M7.5 7h8.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {unreadGradingUpdatesCount > 0 && (
              <span
                className={`absolute -top-1 -right-1 z-20 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-[10px] leading-4 text-white text-center ${unattendedGradingUpdatesCount > 0 ? 'animate-pulse' : ''}`}
                style={unattendedGradingUpdatesCount > 0 ? { animationDuration: '2.2s' } : undefined}
                aria-label={`${unreadGradingUpdatesCount} new grading updates`}
              >
                {unreadGradingUpdatesCount > 99 ? '99+' : unreadGradingUpdatesCount}
              </span>
            )}
          </span>
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
    if (!isRecognizedLessonParticipantRole(sessionRole)) return null

    const renderSocialActionButton = (opts: {
      label: string
      statusLabel?: string
      active?: boolean
      onClick: () => void
      icon: React.ReactNode
      disabled?: boolean
    }) => (
      <button
        type="button"
        className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold tracking-[-0.01em] transition ${opts.active ? 'bg-[#e7f3ff] text-[#1877f2]' : 'text-[#65676b] hover:bg-[#f0f2f5]'} ${opts.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        onClick={opts.onClick}
        disabled={opts.disabled}
      >
        <span className="shrink-0">{opts.icon}</span>
        <span className="truncate whitespace-nowrap">{opts.statusLabel || opts.label}</span>
      </button>
    )

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
    const currentLessonPostKey = resolvedCurrentLesson ? `lesson:${String(resolvedCurrentLesson.id)}` : ''
    const currentLessonIsOwner = viewerId && String((resolvedCurrentLesson as any)?.createdBy || '') === String(viewerId)
    const currentLessonAuthorName = currentLessonIsOwner ? 'You' : 'Admin'
    const currentLessonDate = resolvedCurrentLesson
      ? formatFeedPostDate((resolvedCurrentLesson as any)?.startsAt || (resolvedCurrentLesson as any)?.createdAt)
      : ''
    const currentLessonDescription = String((resolvedCurrentLesson as any)?.description || '').trim()

    return (
      <section className="space-y-0 bg-[#f0f2f5] text-[#1c1e21]">
        <section className="border-b border-black/10 bg-white px-4 py-2.5">
          <div className="flex items-center gap-3 bg-transparent">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-black/10 bg-[#f0f2f5] text-sm font-semibold text-[#1c1e21]">
              {effectiveAvatarUrl ? (
                <img src={effectiveAvatarUrl} alt={learnerName} className="h-full w-full object-cover" />
              ) : (
                <span>{learnerInitials}</span>
              )}
            </span>
            <div className="flex min-w-0 flex-1 items-center rounded-full border border-black/10 bg-[#f8fafc] px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
              <button
                type="button"
                className="min-w-0 flex-1 py-2 text-left text-[14px] text-[#65676b]"
                onClick={() => {
                  setCreateKind('post')
                  setCreateOverlayOpen(true)
                }}
              >
                What's on your mind, {String(learnerName || 'learner').split(' ')[0]}?
              </button>
            </div>
            <button
              type="button"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 bg-[#f8fafc] text-[#1c1e21]"
              onClick={() => setPostToolsSheetOpen(true)}
              aria-label="Open posts menu"
              title="Posts menu"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 8H18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M9 12H18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M12 16H18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </section>

        <section className="border-b border-black/10 bg-white">
          <button
            ref={myPostsHeaderRef}
            type="button"
            className={`flex w-full items-center justify-between px-4 py-3 text-left bg-white ${myPostsExpanded ? 'border-b border-black/10 shadow-[0_6px_12px_rgba(15,23,42,0.06)]' : ''}`}
            onClick={() => setMyPostsExpanded(prev => !prev)}
            aria-expanded={myPostsExpanded}
            aria-controls="dashboard-my-posts-section"
          >
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#65676b]">Your posts</div>
              <div className="mt-0.5 text-[15px] font-semibold text-[#1c1e21]">My posts</div>
            </div>
            <div className="flex items-center gap-3">
              {myPosts.length > 0 && (
                <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#1877f2] px-1.5 text-[11px] font-semibold text-white">
                  {myPosts.length}
                </span>
              )}
              <svg
                width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"
                className={`transition-transform ${myPostsExpanded ? 'rotate-180' : ''}`}
              >
                <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </button>
          {myPostsExpanded && (
            <div
              ref={myPostsScrollRef}
              id="dashboard-my-posts-section"
              className="overflow-y-auto overscroll-contain"
              style={myPostsContentMaxHeightPx ? { maxHeight: `${myPostsContentMaxHeightPx}px` } : undefined}
            >
              {myPostsLoading ? (
                <div className="px-4 py-6 text-sm text-[#65676b]">Loading...</div>
              ) : myPostsError ? (
                <div className="px-4 py-6 text-sm text-red-500">{myPostsError}</div>
              ) : myPosts.length === 0 ? (
                <div className="px-4 py-6 text-sm text-[#65676b]">You haven&apos;t posted anything yet.</div>
              ) : (
                <ul className="space-y-0">
                  {myPosts.map((p: any) => {
                    const mpTitle = (p?.title || '').trim() || 'Post'
                    const mpCreatedAt = p?.createdAt ? formatFeedPostDate(p.createdAt) : ''
                    const mpAuthorName = (p?.createdBy?.name || '').trim() || 'You'
                    const mpAuthorId = p?.createdBy?.id ? String(p.createdBy.id) : null
                    const mpAuthorAvatar = typeof p?.createdBy?.avatar === 'string' ? p.createdBy.avatar.trim() : ''
                    const mpPrompt = (p?.prompt || '').trim()
                    const mpImageUrl = typeof p?.imageUrl === 'string' ? p.imageUrl.trim() : ''
                    const mpItemId = p?.id ? String(p.id) : ''
                    const mpSocialKey = mpItemId ? `post:${mpItemId}` : `post:${mpTitle}`
                    return (
                      <li
                        key={getDashboardItemKey(p)}
                        data-post-id={mpItemId || undefined}
                        className="border-b border-black/10 bg-white px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-3">
                              <UserLink userId={mpAuthorId} className="shrink-0" title="View profile">
                                <div className="h-9 w-9 aspect-square rounded-full border border-black/10 bg-[#f0f2f5] overflow-hidden flex items-center justify-center">
                                  {mpAuthorAvatar ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={mpAuthorAvatar} alt={mpAuthorName} className="h-full w-full object-cover" />
                                  ) : (
                                    <span className="text-xs font-semibold text-[#1c1e21]">{mpAuthorName.slice(0, 1).toUpperCase()}</span>
                                  )}
                                </div>
                              </UserLink>
                              <div className="min-w-0">
                                <UserLink userId={mpAuthorId} className="truncate text-[15px] font-semibold tracking-[-0.015em] text-[#1c1e21] hover:underline" title="View profile">
                                  {mpAuthorName}
                                </UserLink>
                                {mpCreatedAt ? <div className="mt-0.5 text-[12px] font-medium tracking-[0.01em] text-[#65676b]">{mpCreatedAt}</div> : null}
                              </div>
                            </div>
                            <div className="mt-3 text-[15px] font-semibold leading-6 tracking-[-0.02em] text-[#1c1e21] break-words">{mpTitle}</div>
                            {mpPrompt ? <div className="mt-1.5 text-[14px] leading-6 text-[#334155] break-words">{mpPrompt.slice(0, 220)}{mpPrompt.length > 220 ? '...' : ''}</div> : null}
                            {mpImageUrl ? (
                              <div className="mt-3 overflow-hidden rounded-2xl border border-black/10 bg-[#f8fafc]">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={mpImageUrl} alt="Post screenshot" className="max-h-[420px] w-full object-cover" />
                              </div>
                            ) : null}
                          </div>
                          {mpItemId ? (
                            <div className="flex flex-col items-end gap-2 shrink-0">
                              <button
                                type="button"
                                className="inline-flex shrink-0 h-10 items-center justify-center rounded-xl bg-[#1877f2] px-4 text-sm font-semibold text-white"
                                onClick={() => openEditPostComposer(p)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="text-xs font-semibold text-[#65676b] shrink-0"
                                onClick={() => void deletePost(mpItemId)}
                              >
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <div className="mt-3 border-t border-black/10 pt-2 text-[#65676b]">
                          <div className="flex items-center gap-1">
                            {renderSocialActionButton({
                              label: 'Like',
                              active: Boolean(socialLikedItems[mpSocialKey]),
                              onClick: () => toggleSocialLike(mpSocialKey),
                              icon: (
                                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
                                  <path d="M14 9V5.5C14 4.11929 12.8807 3 11.5 3C10.714 3 9.97327 3.36856 9.5 4L6 9V21H17.18C18.1402 21 18.9724 20.3161 19.1604 19.3744L20.7604 11.3744C21.0098 10.1275 20.0557 9 18.7841 9H14Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                  <path d="M6 21H4C3.44772 21 3 20.5523 3 20V10C3 9.44772 3.44772 9 4 9H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              ),
                            })}
                            {renderSocialActionButton({
                              label: p?.solutionCount ? formatSolutionsLabel((p as any)?.solutionCount) : 'Solutions',
                              onClick: () => void openPostThread(p),
                              disabled: !mpItemId,
                              icon: (
                                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
                                  <path d="M7 18L3.8 20.4C3.47086 20.6469 3 20.412 3 20V6C3 4.89543 3.89543 4 5 4H19C20.1046 4 21 4.89543 21 6V16C21 17.1046 20.1046 18 19 18H7Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              ),
                            })}
                            {renderSocialActionButton({
                              label: 'Share',
                              statusLabel: lastSharedSocialItemKey === mpSocialKey ? 'Copied' : undefined,
                              onClick: () => shareDashboardItem({
                                itemKey: mpSocialKey,
                                title: mpTitle,
                                text: mpPrompt || mpTitle,
                                path: `/dashboard?postId=${encodeURIComponent(mpItemId)}`,
                              }),
                              disabled: !mpItemId,
                              icon: (
                                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
                                  <path d="M14 5L20 11L14 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                  <path d="M4 19V17C4 13.6863 6.68629 11 10 11H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              ),
                            })}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </section>

        <section
          ref={currentLessonCardRef}
          className="overflow-hidden border-b border-black/10 bg-white"
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
            <div ref={currentLessonCardContentRef} className="space-y-0">
              <div className="flex items-center justify-between gap-3 px-4 pt-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#65676b]">Live now</div>
                  <div className="mt-1 font-semibold text-[#1c1e21]">Current lesson</div>
                </div>
                {sessionCanOrchestrateLessons ? (
                  <div className="flex items-center gap-1 text-xs font-semibold text-[#65676b]">
                    <span>Grade</span>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center min-w-[32px] h-8 px-3 rounded-xl border border-black/10 bg-[#f0f2f5] text-[#1c1e21] touch-none"
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
                        return g ? String(g).replace('GRADE_', '') : '-'
                      })()}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="justify-self-end text-xs font-semibold text-[#65676b] hover:text-[#1c1e21] disabled:opacity-50"
                    onClick={() => selectedGrade && fetchSessionsForGrade(selectedGrade)}
                    disabled={sessionsLoading || !selectedGrade}
                  >
                    {sessionsLoading ? 'Refreshing...' : 'Refresh'}
                  </button>
                )}
              </div>

              {!resolvedCurrentLesson ? (
                <div className="px-4 pb-3 pt-2 text-sm text-[#65676b]">No current lesson right now.</div>
              ) : (
                <div className="space-y-0 overflow-hidden">
                  {lessonThumb ? (
                    <button
                      type="button"
                      className="block w-full text-left disabled:cursor-not-allowed"
                      onClick={() => showCanvasWindow(String(resolvedCurrentLesson.id), { quizMode: false })}
                      disabled={!canLaunchCanvasOverlay || isSubscriptionBlocked}
                      aria-label={`Enter class for ${resolvedCurrentLesson.title || 'current lesson'}`}
                      title={canLaunchCanvasOverlay && !isSubscriptionBlocked ? 'Enter class' : undefined}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={lessonThumb} alt="Lesson thumbnail" className="h-52 w-full object-cover" />
                    </button>
                  ) : null}

                  <div className="space-y-3 px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1877f2] text-sm font-semibold text-white shadow-[0_10px_24px_rgba(24,119,242,0.2)]">
                        {currentLessonAuthorName.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#65676b]">Live now</div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <div className="truncate text-[15px] font-semibold tracking-[-0.015em] text-[#1c1e21]">{currentLessonAuthorName}</div>
                          {currentLessonDate ? <div className="text-[12px] font-medium tracking-[0.01em] text-[#65676b]">{currentLessonDate}</div> : null}
                        </div>
                        <div className="text-[13px] text-[#65676b]">Current lesson</div>
                      </div>
                    </div>

                    <div>
                      <div className="text-[16px] font-semibold leading-6 tracking-[-0.02em] text-[#1c1e21] break-words">{resolvedCurrentLesson.title || 'Lesson'}</div>
                      {currentLessonDescription ? (
                        <div className="mt-1.5 text-[14px] leading-6 text-[#334155] break-words">{currentLessonDescription.slice(0, 220)}{currentLessonDescription.length > 220 ? '...' : ''}</div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="inline-flex h-11 items-center justify-center rounded-xl bg-[#1877f2] px-5 text-sm font-semibold text-white"
                          onClick={() => showCanvasWindow(String(resolvedCurrentLesson.id), { quizMode: false })}
                          disabled={!canLaunchCanvasOverlay || isSubscriptionBlocked}
                        >
                          Enter class
                        </button>

                        <button
                          type="button"
                          className="inline-flex h-11 items-center justify-center rounded-xl border border-black/10 bg-[#f0f2f5] px-4 text-sm font-semibold text-[#1c1e21] disabled:opacity-50"
                          onClick={() => openSessionDetails([String(resolvedCurrentLesson.id)], 0, 'responses')}
                          disabled={!canLaunchCanvasOverlay || isSubscriptionBlocked}
                        >
                          Quizzes
                        </button>

                        <div className="relative ml-auto flex items-center gap-2 pr-2">
                          {resolvedCurrentLesson.startsAt ? (
                            <div className="absolute bottom-full right-2 mb-1 grid grid-cols-[44px_minmax(0,1fr)] gap-x-2 whitespace-nowrap text-[11px] leading-4 text-[#65676b]">
                              <span className="font-semibold text-[#4b5563]">Start:</span>
                              <span>{formatCompactLessonMoment(resolvedCurrentLesson.startsAt)}</span>
                              <span className="font-semibold text-[#4b5563]">End:</span>
                              <span>{formatCompactLessonMoment((resolvedCurrentLesson as any).endsAt || resolvedCurrentLesson.startsAt)}</span>
                            </div>
                          ) : null}
                          <button
                            type="button"
                            className="inline-flex h-11 items-center justify-center rounded-xl border border-black/10 bg-[#f0f2f5] px-4 text-sm font-semibold text-[#1c1e21] disabled:opacity-50"
                            onClick={() => openSessionDetails([String(resolvedCurrentLesson.id)], 0, 'assignments')}
                            disabled={isSubscriptionBlocked}
                          >
                            Assignments
                          </button>
                          {(() => {
                            const isOwner = viewerId && String((resolvedCurrentLesson as any)?.createdBy || '') === String(viewerId)
                            const canManage = sessionCanOrchestrateLessons && isOwner
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

                    <div className="border-t border-black/10 pt-2 text-[#65676b]">
                      <div className="flex items-center gap-1">
                        {renderSocialActionButton({
                          label: 'Like',
                          active: Boolean(socialLikedItems[currentLessonPostKey]),
                          onClick: () => toggleSocialLike(currentLessonPostKey),
                          icon: (
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
                              <path d="M14 9V5.5C14 4.11929 12.8807 3 11.5 3C10.714 3 9.97327 3.36856 9.5 4L6 9V21H17.18C18.1402 21 18.9724 20.3161 19.1604 19.3744L20.7604 11.3744C21.0098 10.1275 20.0557 9 18.7841 9H14Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M6 21H4C3.44772 21 3 20.5523 3 20V10C3 9.44772 3.44772 9 4 9H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ),
                        })}
                        {renderSocialActionButton({
                          label: 'Solve',
                          onClick: () => openLessonCommentThread(String(resolvedCurrentLesson.id)),
                          icon: (
                            <span className="flex items-center gap-1" aria-hidden="true">
                              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
                                <path d="M7 18L3.8 20.4C3.47086 20.6469 3 20.412 3 20V6C3 4.89543 3.89543 4 5 4H19C20.1046 4 21 4.89543 21 6V16C21 17.1046 20.1046 18 19 18H7Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none">
                                <path d="M4 20H8L18.5 9.5C19.3284 8.67157 19.3284 7.32843 18.5 6.5C17.6716 5.67157 16.3284 5.67157 15.5 6.5L5 17V20Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M14.5 7.5L17.5 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </span>
                          ),
                        })}
                        {renderSocialActionButton({
                          label: 'Share',
                          statusLabel: lastSharedSocialItemKey === currentLessonPostKey ? 'Copied' : undefined,
                          onClick: () => shareDashboardItem({
                            itemKey: currentLessonPostKey,
                            title: resolvedCurrentLesson.title || 'Current lesson',
                            text: 'Open this lesson in Philani Academy.',
                            path: `/dashboard?section=live&lessonSessionId=${encodeURIComponent(String(resolvedCurrentLesson.id))}&lessonTab=responses`,
                          }),
                          icon: (
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
                              <path d="M14 5L20 11L14 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M4 19V17C4 13.6863 6.68629 11 10 11H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ),
                        })}
                      </div>
                    </div>

                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-black/10 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#65676b]">History</div>
                  <div className="mt-1 font-semibold text-[#1c1e21]">Past lessons</div>
                </div>
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-black/10 bg-[#f0f2f5] px-4 text-xs font-semibold text-[#1c1e21]"
                  onClick={() => openPastSessionsList(pastSessionIds)}
                  disabled={pastSessionIds.length === 0}
                >
                  Open
                </button>
              </div>
              {pastSessionIds.length === 0 ? (
                <div className="mt-2 text-sm text-[#65676b]">No past lessons yet.</div>
              ) : (
                <div className="mt-2 text-sm text-[#65676b]">
                  {pastSessionIds.length} past lesson{pastSessionIds.length === 1 ? '' : 's'}
                </div>
              )}
            </div>
        </section>

        {studentFeedLoading ? (
          <div className="border-b border-black/10 bg-white px-4 py-6 text-sm text-[#65676b]">Loading...</div>
        ) : studentFeedError ? (
          <div className="border-b border-black/10 bg-white px-4 py-6 text-sm text-red-500">{studentFeedError}</div>
        ) : studentFeedPosts.length === 0 ? (
          <div className="border-b border-black/10 bg-white px-4 py-6 text-sm text-[#65676b]">No posts yet.</div>
        ) : (
          <ul className="space-y-0">
            {(postSolvePreviewOverlay || pendingFeedThreadJumpKey ? studentFeedPosts : studentFeedPosts.slice(0, 15)).map((rawPost: any) => {
                const previewPostId = String(postSolvePreviewOverlay?.draft?.postId || '')
                const isPreviewTarget = previewPostId !== '' && String(rawPost?.id || '') === previewPostId
                const p = isPreviewTarget
                  ? {
                      ...(rawPost as any),
                      hasOwnResponse: true,
                      solutionCount: Math.max(
                        1,
                        Number((rawPost as any)?.solutionCount || 0) + ((rawPost as any)?.hasOwnResponse ? 0 : 1),
                      ),
                    }
                  : rawPost
                const kind = getDashboardItemKind(p)
                const isPost = kind === 'post'
                const title = (p?.title || '').trim() || (isPost ? 'Post' : 'Quiz')
                const createdAt = p?.createdAt ? formatFeedPostDate(p.createdAt) : ''
                const authorName = (p?.createdBy?.name || '').trim() || 'Learner'
                const authorId = p?.createdBy?.id ? String(p.createdBy.id) : null
                const authorAvatar = typeof p?.createdBy?.avatar === 'string' ? p.createdBy.avatar.trim() : ''
                const authorRole = String(p?.createdBy?.role || '').toLowerCase()
                const authorVerified = hasLessonCapabilityForRole(authorRole, 'canOrchestrateLesson')
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
                const itemId = p?.id ? String(p.id) : ''
                const itemKey = itemId ? `${kind}:${itemId}` : `${kind}:${title}`
                const socialItemKey = itemId ? `${kind}:${itemId}` : `${kind}:${title}`
                const href = !isPost && itemId ? `/challenges/${encodeURIComponent(itemId)}` : '#'

                return (
                  <li
                    key={getDashboardItemKey(p)}
                    ref={(el) => {
                      if (!itemId) return
                      postFeedItemRefs.current[itemKey] = el
                    }}
                    data-post-id={itemId || undefined}
                    className="border-b border-black/10 bg-white px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <UserLink userId={authorId} className="shrink-0" title="View profile">
                            <div className="relative overflow-visible">
                              <div className="h-9 w-9 aspect-square rounded-full border border-black/10 bg-[#f0f2f5] overflow-hidden flex items-center justify-center profile-avatar-container">
                                {authorAvatar ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={authorAvatar} alt={authorName} className="h-full w-full object-cover" />
                                ) : (
                                  <span className="text-xs font-semibold text-[#1c1e21]">{authorName.slice(0, 1).toUpperCase()}</span>
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
                              <UserLink userId={authorId} className="truncate text-[15px] font-semibold tracking-[-0.015em] text-[#1c1e21] hover:underline" title="View profile">
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
                            {createdAt ? <div className="mt-0.5 text-[12px] font-medium tracking-[0.01em] text-[#65676b]">{createdAt}</div> : null}
                          </div>
                        </div>

                        <div className="mt-3 text-[15px] font-semibold leading-6 tracking-[-0.02em] text-[#1c1e21] break-words">{title}</div>
                        {prompt ? <div className="mt-1.5 text-[14px] leading-6 text-[#334155] break-words">{prompt.slice(0, 220)}{prompt.length > 220 ? '...' : ''}</div> : null}
                        {imageUrl ? (
                          <div className="mt-3 overflow-hidden rounded-2xl border border-black/10 bg-[#f8fafc]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={imageUrl}
                              alt="Post screenshot"
                              className="max-h-[420px] w-full object-cover"
                            />
                          </div>
                        ) : null}

                      </div>
                      {p?.id ? (
                        isPost ? (
                          <div className="flex flex-col items-end gap-2 shrink-0">
                            {isOwner ? (
                              <>
                                <button
                                  type="button"
                                  className="inline-flex shrink-0 h-10 items-center justify-center rounded-xl bg-[#1877f2] px-4 text-sm font-semibold text-white"
                                  onClick={() => openEditPostComposer(p)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="text-xs font-semibold text-[#65676b] shrink-0"
                                  onClick={() => void deletePost(String(p.id))}
                                >
                                  Delete
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="inline-flex shrink-0 h-10 items-center justify-center rounded-xl bg-[#1877f2] px-4 text-sm font-semibold text-white"
                                onClick={() => {
                                  if (p?.hasOwnResponse) {
                                    void openPostThread(p)
                                    return
                                  }
                                  void openPostSolveComposer(p)
                                }}
                              >
                                {p?.hasOwnResponse ? formatSolutionsLabel((p as any)?.solutionCount) : 'Solve'}
                              </button>
                            )}
                          </div>
                        ) : isOwner ? (
                          <div className="flex flex-col items-end gap-2 shrink-0">
                            <button
                              type="button"
                              className="inline-flex shrink-0 h-10 items-center justify-center rounded-xl bg-[#1877f2] px-4 text-sm font-semibold text-white"
                              onClick={() => {
                                setSelectedChallengeId(String(p.id))
                                setChallengeGradingOverlayOpen(true)
                              }}
                            >
                              Manage
                            </button>
                            <button
                              type="button"
                              className="text-xs font-semibold text-[#65676b] shrink-0"
                              onClick={() => openChallengeCommentThread(String(p.id))}
                            >
                              {formatSolutionsLabel((p as any)?.solutionCount)}
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-end gap-2 shrink-0">
                            {canAttempt && !hasAttempted ? (
                              <Link href={href} className="inline-flex shrink-0 h-10 items-center justify-center rounded-xl bg-[#1877f2] px-4 text-sm font-semibold text-white">
                                Solve
                              </Link>
                            ) : hasAttempted ? (
                              <button
                                type="button"
                                className="inline-flex shrink-0 h-10 items-center justify-center rounded-xl bg-[#1877f2] px-4 text-sm font-semibold text-white"
                                onClick={() => openChallengeCommentThread(String(p.id))}
                              >
                                Solutions
                              </button>
                            ) : (
                              <button type="button" className="btn btn-ghost shrink-0" disabled>
                                Closed
                              </button>
                            )}
                          </div>
                        )
                      ) : null}
                    </div>

                    <div className="mt-3 border-t border-black/10 pt-2 text-[#65676b]">
                      <div className="flex items-center gap-1">
                        {renderSocialActionButton({
                          label: 'Like',
                          active: Boolean(socialLikedItems[socialItemKey]),
                          onClick: () => toggleSocialLike(socialItemKey),
                          icon: (
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
                              <path d="M14 9V5.5C14 4.11929 12.8807 3 11.5 3C10.714 3 9.97327 3.36856 9.5 4L6 9V21H17.18C18.1402 21 18.9724 20.3161 19.1604 19.3744L20.7604 11.3744C21.0098 10.1275 20.0557 9 18.7841 9H14Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M6 21H4C3.44772 21 3 20.5523 3 20V10C3 9.44772 3.44772 9 4 9H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ),
                        })}
                        {renderSocialActionButton({
                          label: isPost
                            ? (p?.hasOwnResponse ? formatSolutionsLabel((p as any)?.solutionCount) : 'Solve')
                            : (hasAttempted ? formatSolutionsLabel((p as any)?.solutionCount) : 'Solve'),
                          onClick: () => {
                            if (isPost) {
                              if (p?.hasOwnResponse) {
                                void openPostThread(p)
                                return
                              }
                              void openPostSolveComposer(p)
                              return
                            }
                            if (hasAttempted) {
                              openChallengeCommentThread(itemId)
                              return
                            }
                            if (href !== '#') {
                              void router.push(href)
                            }
                          },
                          disabled: !itemId,
                          icon: (
                            <span className="flex items-center gap-1" aria-hidden="true">
                              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
                                <path d="M7 18L3.8 20.4C3.47086 20.6469 3 20.412 3 20V6C3 4.89543 3.89543 4 5 4H19C20.1046 4 21 4.89543 21 6V16C21 17.1046 20.1046 18 19 18H7Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none">
                                <path d="M4 20H8L18.5 9.5C19.3284 8.67157 19.3284 7.32843 18.5 6.5C17.6716 5.67157 16.3284 5.67157 15.5 6.5L5 17V20Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M14.5 7.5L17.5 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </span>
                          ),
                        })}
                        {renderSocialActionButton({
                          label: 'Share',
                          statusLabel: lastSharedSocialItemKey === socialItemKey ? 'Copied' : undefined,
                          onClick: () => shareDashboardItem({
                            itemKey: socialItemKey,
                            title,
                            text: prompt || title,
                            path: isPost ? `/dashboard?postId=${encodeURIComponent(itemId)}` : href,
                          }),
                          disabled: !itemId,
                          icon: (
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
                              <path d="M14 5L20 11L14 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M4 19V17C4 13.6863 6.68629 11 10 11H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ),
                        })}
                      </div>
                      {isPreviewTarget
                        ? renderInlineSolutionsThread(p, {
                            kind: 'post',
                            forceOpen: true,
                            overrideResponses: postSolvePreviewResponses,
                            overrideLoading: postSolvePreviewOverlay?.loading,
                            overrideError: postSolvePreviewOverlay?.error,
                            overrideThreadUnlocked: true,
                            interactiveViewportResponseId: postSolvePreviewResponseId,
                            onInteractiveViewportChange: updatePostSolvePreviewScene,
                            onOwnPostEditSolution: () => {
                              closePostSolvePreview()
                            },
                          })
                        : renderInlineSolutionsThread(p, {
                            kind: isPost ? 'post' : 'challenge',
                            canAttempt,
                            href,
                            onLiveResponseViewportChange: (responseId, scene) => {
                              const threadKey = isPost ? `post:${String(p?.id || '')}` : `challenge:${String(p?.id || '')}`
                              queueInteractiveViewportSave(threadKey, responseId, scene)
                            },
                          })}
                    </div>
                  </li>
                )
            })}
          </ul>
        )}
      </section>
    )
  }

  const renderStudentTimelinePanel = () => (
    <div className="space-y-0">
      {renderStudentHomeFeed()}
    </div>
  )

  const renderInlineSolutionsThread = (item: any, options: {
    kind: 'post' | 'challenge'
    canAttempt?: boolean
    href?: string
    forceOpen?: boolean
    overrideResponses?: any[]
    overrideLoading?: boolean
    overrideError?: string | null
    overrideThreadUnlocked?: boolean
    onOwnPostEditSolution?: (response: any) => void
    interactiveViewportResponseId?: string | null
    onInteractiveViewportChange?: (scene: PublicSolveScene) => void
    onLiveResponseViewportChange?: (responseId: string, scene: PublicSolveScene) => void
  }) => {
    const itemId = String(item?.id || '')
    if (!itemId) return null
    const itemKey = `${options.kind}:${itemId}`
    if (!options.forceOpen && (expandedSolutionThreadKey !== itemKey || expandedSolutionThreadKind !== options.kind)) return null

    const responses = Array.isArray(options.overrideResponses)
      ? options.overrideResponses
      : (options.kind === 'post' ? displayPostThreadResponses : displayChallengeThreadResponses)
    const loading = typeof options.overrideLoading === 'boolean'
      ? options.overrideLoading
      : (options.kind === 'post' ? postThreadLoading : challengeResponseLoading)
    const error = typeof options.overrideError !== 'undefined'
      ? options.overrideError
      : (options.kind === 'post' ? postThreadError : challengeResponseError)
    const threadUnlocked = typeof options.overrideThreadUnlocked === 'boolean'
      ? options.overrideThreadUnlocked
      : (options.kind === 'post' ? true : canViewChallengeThread)

    return (
      <div className="mt-3 border-t border-black/10 pt-3">
        {loading ? <div className="text-sm text-[#65676b]">Loading solutions...</div> : null}
        {!loading && error ? <div className="text-sm text-red-500">{error}</div> : null}
        {!loading && !error && !threadUnlocked ? (
          <div className="rounded-2xl bg-[#f0f2f5] px-4 py-3 text-sm text-[#65676b]">
            Submit your own solution first, then this thread will expand with your solution pinned on top and everyone else below.
          </div>
        ) : null}
        {!loading && !error && threadUnlocked && responses.length === 0 ? (
          <div className="rounded-2xl bg-[#f0f2f5] px-4 py-3 text-sm text-[#65676b]">No solutions yet.</div>
        ) : null}
        {!loading && !error && threadUnlocked && responses.length > 0 ? (
          <div className="space-y-3">
            {responses.map((response: any, idx: number) => {
              const responseUserId = String(response?.userId || response?.user?.id || '')
              const responseUserName = String(response?.user?.name || response?.userName || response?.user?.email || 'Learner')
              const responseAvatar = String(response?.user?.avatar || response?.userAvatar || '').trim()
              const responseCreatedAt = response?.updatedAt || response?.createdAt
              const isMine = responseUserId === String(currentUserId || viewerId || '')
              const latex = String(response?.latex || '')
              const latexHtml = latex.trim() ? renderKatexDisplayHtml(latex) : ''
              const steps = splitLatexIntoSteps(latex)
              const grade = normalizeChallengeGrade(response?.gradingJson, steps.length)
              const responseId = String(response?.id || '')
              const viewportSaving = Boolean(interactiveViewportSavingByResponseId[responseId])
              const viewportError = String(interactiveViewportErrorByResponseId[responseId] || '').trim()

              return (
                <div
                  key={String(response?.id || idx)}
                  className="py-1"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <UserLink userId={responseUserId || null} className="shrink-0" title="View profile">
                        <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-black/10 bg-[#f0f2f5]">
                          {responseAvatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={responseAvatar} alt={responseUserName} className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-[11px] font-semibold text-[#1c1e21]">{responseUserName.slice(0, 1).toUpperCase()}</span>
                          )}
                        </div>
                      </UserLink>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <UserLink userId={responseUserId || null} className="text-[13px] font-semibold text-[#1c1e21] hover:underline" title="View profile">
                            {responseUserName}
                          </UserLink>
                          {isMine ? (
                            <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#1877f2]">
                              {idx === 0 ? 'Pinned' : 'You'}
                            </span>
                          ) : null}
                        </div>
                        {responseCreatedAt ? <div className="text-[11px] font-medium text-[#65676b]">{formatFeedPostDate(responseCreatedAt)}</div> : null}
                        {isMine && response?.excalidrawScene ? (
                          <div className="mt-1 text-[11px] font-medium text-[#65676b]">
                            {viewportError ? viewportError : (viewportSaving ? 'Saving view...' : 'Pan or zoom to adjust the shared view.')}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {isMine ? (
                      options.kind === 'post' ? (
                        <button
                          type="button"
                          className="shrink-0 text-xs font-semibold text-[#65676b] hover:text-[#1c1e21]"
                          onClick={() => {
                            if (options.onOwnPostEditSolution) {
                              options.onOwnPostEditSolution(response)
                              return
                            }
                            void openPostSolveComposer(item, { initialScene: response?.excalidrawScene || null })
                          }}
                        >
                          Edit solution
                        </button>
                      ) : options.canAttempt && options.href ? (
                        <button
                          type="button"
                          className="shrink-0 text-xs font-semibold text-[#65676b] hover:text-[#1c1e21]"
                          onClick={() => void router.push(options.href || '#')}
                        >
                          Edit solution
                        </button>
                      ) : null
                    ) : null}
                  </div>

                  {String(response?.studentText || '').trim() ? (
                    <div className="mt-3 text-[14px] leading-6 whitespace-pre-wrap break-words text-[#1c1e21]">{String(response.studentText)}</div>
                  ) : null}

                  {latex.trim() ? (
                    latexHtml ? (
                      <div className="mt-3 leading-relaxed text-[#1c1e21]" dangerouslySetInnerHTML={{ __html: latexHtml }} />
                    ) : (
                      <div className="mt-3 text-[14px] leading-6 whitespace-pre-wrap break-words text-[#1c1e21]">{renderTextWithKatex(latex)}</div>
                    )
                  ) : null}

                  {response?.excalidrawScene ? (
                    <div className="mt-3">
                      <PublicSolveCanvasViewer
                        scene={response.excalidrawScene}
                        onViewportChange={options.onInteractiveViewportChange && options.interactiveViewportResponseId === responseId
                          ? options.onInteractiveViewportChange
                          : (options.onLiveResponseViewportChange && isMine && responseId
                            ? (scene) => options.onLiveResponseViewportChange?.(responseId, scene)
                            : undefined)}
                      />
                    </div>
                  ) : null}

                  {grade || String(response?.feedback || '').trim() ? (
                    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                      {grade ? <div className="font-semibold">Grade: {grade.earnedMarks}/{grade.totalMarks}</div> : null}
                      {String(response?.feedback || '').trim() ? <div className="mt-1 whitespace-pre-wrap break-words">{String(response.feedback)}</div> : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    )
  }

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
      const threadKey = buildLessonResponseThreadKey(sessionId)
      const res = await fetch(`/api/threads/${encodeURIComponent(threadKey)}/responses`, { credentials: 'same-origin' })
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

  async function fetchAssignmentDetails(sessionId: string, assignmentId: string, openTitleEditor = false) {
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
        setAssignmentTitleEditMode(openTitleEditor)
        setAssignmentTitleEditDraft(String((data as any)?.title || ''))
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
    if (!nextTitle.trim()) return false
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
      return true
    } catch (err: any) {
      setAssignmentsError(err?.message || 'Unable to update assignment')
      return false
    }
  }

  const saveAssignmentTitleFromView = useCallback(async () => {
    if (!expandedSessionId || !selectedAssignment?.id) return
    const nextTitle = assignmentTitleEditDraft.trim()
    if (!nextTitle) return
    setAssignmentTitleSaving(true)
    const ok = await updateAssignmentTitle(expandedSessionId, String(selectedAssignment.id), nextTitle)
    setAssignmentTitleSaving(false)
    if (ok) {
      setAssignmentTitleEditMode(false)
    }
  }, [assignmentTitleEditDraft, expandedSessionId, selectedAssignment])

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

  const toggleSocialLike = useCallback((itemKey: string) => {
    if (!itemKey) return
    setSocialLikedItems(prev => ({
      ...prev,
      [itemKey]: !prev[itemKey],
    }))
  }, [])

  const markSocialShareHandled = useCallback((itemKey: string) => {
    if (!itemKey) return
    setLastSharedSocialItemKey(itemKey)
    if (typeof window === 'undefined') return
    if (socialShareResetTimeoutRef.current !== null) {
      window.clearTimeout(socialShareResetTimeoutRef.current)
    }
    socialShareResetTimeoutRef.current = window.setTimeout(() => {
      setLastSharedSocialItemKey(current => (current === itemKey ? null : current))
      socialShareResetTimeoutRef.current = null
    }, 1800)
  }, [])

  const shareDashboardItem = useCallback(async (opts: { itemKey: string; title: string; path: string; text?: string }) => {
    const { itemKey, title, path, text } = opts
    if (!itemKey || !path) return

    const absoluteUrl = typeof window === 'undefined'
      ? path
      : new URL(path, window.location.origin).toString()

    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title, text, url: absoluteUrl })
        markSocialShareHandled(itemKey)
        return
      }

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(absoluteUrl)
        markSocialShareHandled(itemKey)
        alert('Link copied')
        return
      }

      if (typeof window !== 'undefined') {
        window.prompt('Copy this link', absoluteUrl)
        markSocialShareHandled(itemKey)
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      alert(err?.message || 'Failed to share')
    }
  }, [markSocialShareHandled])

  const openChallengeCommentThread = useCallback((challengeId: string, options?: { forceOpen?: boolean }) => {
    const safeChallengeId = String(challengeId || '')
    if (!safeChallengeId) return
    const nextKey = `challenge:${safeChallengeId}`
    if (!options?.forceOpen && expandedSolutionThreadKey === nextKey && expandedSolutionThreadKind === 'challenge') {
      setExpandedSolutionThreadKey(null)
      setExpandedSolutionThreadKind(null)
      setChallengeResponseError(null)
      return
    }
    setExpandedSolutionThreadKey(nextKey)
    setExpandedSolutionThreadKind('challenge')
    void fetchChallengeResponseThread(safeChallengeId)
  }, [expandedSolutionThreadKey, expandedSolutionThreadKind, fetchChallengeResponseThread])

  const fetchPublicThreadResponses = useCallback(async (threadKey: string) => {
    if (!threadKey) return []
    const res = await fetch(`/api/threads/${encodeURIComponent(threadKey)}/responses`, { credentials: 'same-origin' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data?.message || `Failed to load solutions (${res.status})`)
    }
    const responses = Array.isArray(data?.responses) ? data.responses : []
    return responses.slice().sort((a: any, b: any) => {
      const aTs = Math.max(a?.updatedAt ? new Date(a.updatedAt).getTime() : 0, a?.createdAt ? new Date(a.createdAt).getTime() : 0)
      const bTs = Math.max(b?.updatedAt ? new Date(b.updatedAt).getTime() : 0, b?.createdAt ? new Date(b.createdAt).getTime() : 0)
      return bTs - aTs
    })
  }, [])

  const openPostThread = useCallback(async (post: any, options?: { forceOpen?: boolean }) => {
    const postId = String(post?.id || '')
    const threadKey = typeof post?.threadKey === 'string' ? post.threadKey : `post:${postId}`
    if (!postId || !threadKey) return

    const nextKey = `post:${postId}`
    if (!options?.forceOpen && expandedSolutionThreadKey === nextKey && expandedSolutionThreadKind === 'post') {
      setExpandedSolutionThreadKey(null)
      setExpandedSolutionThreadKind(null)
      setPostThreadError(null)
      return
    }

    setExpandedSolutionThreadKey(nextKey)
    setExpandedSolutionThreadKind('post')
    setPostThreadLoading(true)
    setPostThreadError(null)
    try {
      const responses = await fetchPublicThreadResponses(threadKey)
      rememberInteractiveViewportScenes(responses)
      setPostThreadResponses(responses)
    } catch (err: any) {
      setPostThreadResponses([])
      setPostThreadError(err?.message || 'Failed to load solutions')
    } finally {
      setPostThreadLoading(false)
    }
  }, [expandedSolutionThreadKey, expandedSolutionThreadKind, fetchPublicThreadResponses, rememberInteractiveViewportScenes])

  useEffect(() => {
    if (!router.isReady) return
    const openFeedThreadId = typeof router.query.openFeedThreadId === 'string' ? router.query.openFeedThreadId.trim() : ''
    const openFeedThreadKindRaw = typeof router.query.openFeedThreadKind === 'string' ? router.query.openFeedThreadKind.trim().toLowerCase() : ''
    const openFeedThreadKind = openFeedThreadKindRaw === 'post' ? 'post' : (openFeedThreadKindRaw === 'challenge' ? 'challenge' : '')
    if (!openFeedThreadId || !openFeedThreadKind) {
      handledFeedThreadJumpKeyRef.current = null
      return
    }
    if (studentFeedLoading) return

    const targetKey = `${openFeedThreadKind}:${openFeedThreadId}`
    if (handledFeedThreadJumpKeyRef.current === targetKey) return
    const targetItem = (Array.isArray(studentFeedPosts) ? studentFeedPosts : []).find((item: any) => getDashboardItemKey(item) === targetKey)
    if (!targetItem) return
    handledFeedThreadJumpKeyRef.current = targetKey

    if (activeSection !== 'overview') setActiveSection('overview')
    if (dashboardSectionOverlay) setDashboardSectionOverlay(null)
    if (studentQuickOverlay) setStudentQuickOverlay(null)
    if (studentMobileTab !== 'timeline') setStudentMobileTab('timeline')

    setPendingFeedThreadJumpKey(targetKey)
    if (openFeedThreadKind === 'post') {
      void openPostThread(targetItem, { forceOpen: true })
    } else {
      openChallengeCommentThread(openFeedThreadId, { forceOpen: true })
    }

    const nextQuery: Record<string, any> = { ...router.query }
    delete nextQuery.openFeedThreadId
    delete nextQuery.openFeedThreadKind
    void router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true })
  }, [
    activeSection,
    dashboardSectionOverlay,
    openChallengeCommentThread,
    openPostThread,
    router,
    router.isReady,
    router.pathname,
    router.query,
    studentFeedLoading,
    studentFeedPosts,
    studentMobileTab,
    studentQuickOverlay,
    expandedSolutionThreadKey,
    expandedSolutionThreadKind,
  ])

  useEffect(() => {
    if (!pendingFeedThreadJumpKey) return
    if (typeof window === 'undefined') return

    let timeoutId: number | null = null
    let attempts = 0

    const scrollToTarget = () => {
      const target = postFeedItemRefs.current[pendingFeedThreadJumpKey]
      if (!target) return false
      target.scrollIntoView({ block: 'start', behavior: 'smooth' })
      setPendingFeedThreadJumpKey(null)
      return true
    }

    if (!scrollToTarget()) {
      const retry = () => {
        attempts += 1
        if (scrollToTarget() || attempts >= 20) {
          if (attempts >= 20) setPendingFeedThreadJumpKey(null)
          return
        }
        timeoutId = window.setTimeout(retry, 60)
      }
      timeoutId = window.setTimeout(retry, 0)
    }

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
  }, [pendingFeedThreadJumpKey])

  const openPostSolveComposer = useCallback(async (post: any, options?: { initialScene?: any | null }) => {
    const postId = String(post?.id || '')
    const threadKey = typeof post?.threadKey === 'string' ? post.threadKey : `post:${postId}`
    if (!postId || !threadKey) return

    const authorName = String(
      post?.authorName ||
      post?.createdBy?.name ||
      post?.user?.name ||
      post?.userName ||
      post?.createdBy?.email ||
      post?.user?.email ||
      ''
    ).trim() || 'Poster'
    const authorAvatarUrl = String(
      post?.authorAvatarUrl ||
      post?.createdBy?.avatar ||
      post?.user?.avatar ||
      post?.userAvatar ||
      ''
    ).trim()

    setPostSolveError(null)
    let initialScene = options?.initialScene ?? null
    if (!initialScene) {
      try {
        const responses = await fetchPublicThreadResponses(threadKey)
        const effectiveCurrentUserId = String(currentUserId || viewerId || '')
        const mine = responses.find((response: any) => String(response?.userId || '') === effectiveCurrentUserId)
        initialScene = mine?.excalidrawScene || null
      } catch {
        // ignore prefill failures and still open the composer
      }
    }

    setPostSolveOverlay({
      postId,
      threadKey,
      title: String(post?.title || 'Post'),
      prompt: String(post?.prompt || 'Share your solution for this post.'),
      imageUrl: typeof post?.imageUrl === 'string' ? post.imageUrl : null,
      authorName,
      authorAvatarUrl,
      initialScene,
      postRecord: post,
    })
  }, [currentUserId, fetchPublicThreadResponses, viewerId])

  const openPostSolvePreview = useCallback(async (scene: PublicSolveScene) => {
    if (!postSolveOverlay?.postId || !postSolveOverlay?.threadKey) return

    setPostSolveError(null)
    setPostSolvePreviewOverlay({
      draft: {
        ...postSolveOverlay,
        initialScene: scene,
      },
      draftScene: scene,
      responses: [],
      loading: true,
      error: null,
    })
    setPostSolveOverlay(null)

    try {
      const responses = await fetchPublicThreadResponses(postSolveOverlay.threadKey)
      const effectiveCurrentUserId = String(currentUserId || viewerId || '')
      const otherResponses = responses.filter((response: any) => String(response?.userId || response?.user?.id || '') !== effectiveCurrentUserId)
      setPostSolvePreviewOverlay((prev) => {
        if (!prev || prev.draft.threadKey !== postSolveOverlay.threadKey) return prev
        return {
          ...prev,
          responses: otherResponses,
          loading: false,
          error: null,
        }
      })
    } catch (err: any) {
      setPostSolvePreviewOverlay((prev) => {
        if (!prev || prev.draft.threadKey !== postSolveOverlay.threadKey) return prev
        return {
          ...prev,
          responses: [],
          loading: false,
          error: err?.message || 'Failed to load solutions',
        }
      })
    }
  }, [currentUserId, fetchPublicThreadResponses, postSolveOverlay, viewerId])

  const closePostSolvePreview = useCallback(() => {
    if (postSolvePreviewOverlay?.draft) {
      setPostSolveOverlay({
        ...postSolvePreviewOverlay.draft,
        initialScene: postSolvePreviewOverlay.draftScene,
      })
    }
    setPostSolvePreviewOverlay(null)
  }, [postSolvePreviewOverlay])

  const updatePostSolvePreviewScene = useCallback((scene: PublicSolveScene) => {
    setPostSolvePreviewOverlay((prev) => (prev ? { ...prev, draftScene: scene } : prev))
  }, [])

  const submitPostSolve = useCallback(async (scene: any) => {
    const activeDraft = postSolveOverlay || postSolvePreviewOverlay?.draft || null
    if (!activeDraft?.postId || !activeDraft?.threadKey) return
    setPostSolveSubmitting(true)
    setPostSolveError(null)
    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(activeDraft.threadKey)}/responses`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latex: '',
          quizId: activeDraft.threadKey,
          quizLabel: activeDraft.title,
          prompt: activeDraft.prompt,
          excalidrawScene: scene,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || `Failed to submit solve (${res.status})`)
      }

      if (data?.id && scene) {
        rememberInteractiveViewportScenes([{ id: data.id, excalidrawScene: scene }])
      }

      setStudentFeedPosts((prev: any[]) => (Array.isArray(prev)
        ? prev.map((item) => getDashboardItemKey(item) === `post:${activeDraft.postId}`
          ? {
            ...(item as any),
            hasOwnResponse: true,
            ownResponse: data || (item as any)?.ownResponse || null,
            solutionCount: Math.max(1, Number((item as any)?.solutionCount || 0) + ((item as any)?.hasOwnResponse ? 0 : 1)),
          }
          : item)
        : prev))
      setTimelineChallenges((prev: any[]) => (Array.isArray(prev)
        ? prev.map((item) => getDashboardItemKey(item) === `post:${activeDraft.postId}`
          ? {
            ...(item as any),
            hasOwnResponse: true,
            ownResponse: data || (item as any)?.ownResponse || null,
            solutionCount: Math.max(1, Number((item as any)?.solutionCount || 0) + ((item as any)?.hasOwnResponse ? 0 : 1)),
          }
          : item)
        : prev))

      const overlayPost = {
        id: activeDraft.postId,
        threadKey: activeDraft.threadKey,
        title: activeDraft.title,
        prompt: activeDraft.prompt,
        imageUrl: activeDraft.imageUrl || null,
        authorName: activeDraft.authorName || null,
        authorAvatarUrl: activeDraft.authorAvatarUrl || null,
      }
      setPostSolvePreviewOverlay(null)
      setPostSolveOverlay(null)
      await openPostThread(overlayPost, { forceOpen: true })
    } catch (err: any) {
      setPostSolveError(err?.message || 'Failed to submit solve')
    } finally {
      setPostSolveSubmitting(false)
    }
  }, [openPostThread, postSolveOverlay, postSolvePreviewOverlay, rememberInteractiveViewportScenes])

  const openLessonSolveComposer = useCallback((sessionId: string, options?: { initialScene?: any | null }) => {
    if (!sessionId) return
    const sessionRecord = sessionById.get(String(sessionId))
    setLessonSolveError(null)
    setLessonSolveOverlay({
      sessionId: String(sessionId),
      threadKey: buildLessonResponseThreadKey(sessionId),
      title: String(sessionRecord?.title || 'Lesson'),
      prompt: String((sessionRecord as any)?.description || sessionRecord?.title || 'Share your solve for this lesson.'),
      imageUrl: null,
      initialScene: options?.initialScene ?? null,
    })
  }, [buildLessonResponseThreadKey, sessionById])

  const openLessonCommentThread = useCallback((sessionId: string) => {
    openLessonSolveComposer(sessionId)
  }, [openLessonSolveComposer])

  const submitLessonSolve = useCallback(async (scene: any) => {
    if (!lessonSolveOverlay?.sessionId) return
    setLessonSolveSubmitting(true)
    setLessonSolveError(null)
    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(lessonSolveOverlay.threadKey)}/responses`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latex: '',
          studentText: null,
          excalidrawScene: scene,
          quizId: lessonSolveOverlay.threadKey,
          quizLabel: lessonSolveOverlay.title,
          prompt: lessonSolveOverlay.prompt,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || `Failed to submit solve (${res.status})`)
      }
      await fetchMyResponses(lessonSolveOverlay.sessionId)
      setLessonSolveOverlay(null)
      openSessionDetails([lessonSolveOverlay.sessionId], 0, 'responses')
    } catch (err: any) {
      setLessonSolveError(err?.message || 'Failed to submit solve')
    } finally {
      setLessonSolveSubmitting(false)
    }
  }, [fetchMyResponses, lessonSolveOverlay, openSessionDetails])

  const sessionDetailsSessionId = sessionDetailsIds[sessionDetailsIndex] || null
  const sessionDetailsSession = sessionDetailsSessionId ? sessionById.get(sessionDetailsSessionId) : null

  useEffect(() => {
    const targetLessonSessionId = typeof router.query.lessonSessionId === 'string' ? router.query.lessonSessionId : ''
    const targetLessonTab = typeof router.query.lessonTab === 'string' && router.query.lessonTab === 'assignments'
      ? 'assignments'
      : 'responses'
    if (!targetLessonSessionId) return

    const alreadyOpen =
      sessionDetailsOpen &&
      sessionDetailsSessionId === targetLessonSessionId &&
      sessionDetailsTab === targetLessonTab

    if (!alreadyOpen) {
      openSessionDetails([targetLessonSessionId], 0, targetLessonTab)
    }

    const nextQuery: Record<string, any> = { ...router.query }
    delete nextQuery.lessonSessionId
    delete nextQuery.lessonTab
    void router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true })
  }, [router, router.query, router.pathname, sessionDetailsOpen, sessionDetailsSessionId, sessionDetailsTab, openSessionDetails])

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
    if (isAdmin) {
      fetchUsers()
    }
  }, [isAdmin])

  useEffect(() => {
    // fetch plans for admins
    if (isAdmin) {
      fetchPlans()
    }
    // Mark window global for JitsiRoom so it can disable prejoin for owner quickly
    try {
      const isOwner = ((session as any)?.user?.email === process.env.NEXT_PUBLIC_OWNER_EMAIL) || isAdmin
      ;(window as any).__JITSI_IS_OWNER__ = Boolean(isOwner)
    } catch (e) {}
  }, [isAdmin, session])
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
            <h2 className="text-lg font-semibold">Live class - {activeGradeLabel}</h2>
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
        <h2 className="text-lg font-semibold">Grade updates - {activeGradeLabel}</h2>
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
                          {a.createdBy ? ` - ${a.createdBy}` : ''}
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
    const canCreateSession = currentLessonRoleProfile.capabilities.canAuthorLessons
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

    const renderSessionFocusCard = (session: any, accentLabel = 'Live now') => {
      const isJoinDisabled = !canLaunchCanvasOverlay || isSubscriptionBlocked

      return (
        <div className="session-focus-card rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="session-focus-chip inline-flex items-center justify-center rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/80">
                  {accentLabel}
                </span>
                {session.startsAt ? (
                  <span className="session-focus-meta inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-white/62">
                    {formatSessionRange(session.startsAt, (session as any).endsAt || session.startsAt)}
                  </span>
                ) : null}
              </div>
              <div className="session-focus-title text-base font-semibold leading-snug break-words text-white">
                {session.title}
              </div>
            </div>
            {isAdmin && (
              <button
                type="button"
                className="btn btn-secondary shrink-0"
                onClick={() => openEditSession(String(session.id))}
              >
                Edit
              </button>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <button
              type="button"
              className="btn btn-primary w-full"
              onClick={() => showCanvasWindow(String(session.id), { quizMode: false })}
              disabled={isJoinDisabled}
            >
              Enter class
            </button>
            <div className="session-focus-secondary grid grid-cols-2 gap-2">
              <button
                type="button"
                className="btn btn-ghost session-focus-secondary-button"
                onClick={() => openSessionDetails([String(session.id)], 0, 'responses')}
                disabled={isJoinDisabled}
              >
                Quizzes
              </button>
              <button
                type="button"
                className="btn btn-ghost session-focus-secondary-button"
                onClick={() => openSessionDetails([String(session.id)], 0, 'assignments')}
                disabled={isSubscriptionBlocked}
              >
                Assignments
              </button>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="space-y-6">
        <div className="card space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="session-focus-heading text-base font-semibold text-white">Current lesson</h2>
              <div className="session-focus-subtitle text-xs muted">{activeGradeLabel}</div>
            </div>
            {resolvedCurrentLesson ? <span className="session-focus-chip inline-flex items-center justify-center rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/80">Now</span> : null}
          </div>
          {sessionsError ? (
            <div className="text-sm text-red-600">{sessionsError}</div>
          ) : sortedSessions.length === 0 ? (
            <div className="text-sm muted">No lessons scheduled yet.</div>
          ) : resolvedCurrentLesson ? (
            renderSessionFocusCard(resolvedCurrentLesson)
          ) : currentSessions.length === 0 ? (
            <div className="text-sm muted">Nothing is live right now.</div>
          ) : (
            <ul className="space-y-3">
              {currentSessions.map(s => (
                <li key={s.id}>{renderSessionFocusCard(s, 'In progress')}</li>
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
                            <p className="text-sm font-semibold">Lesson thumbnail - optional</p>
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
                                {sessionThumbnailUploading ? 'Uploading...' : 'Upload'}
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
                              <p className="text-sm font-semibold">Lesson script (5E) - optional</p>
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
                                              {diagramUploading && diagramUploadTarget?.pointId === point.id ? 'Uploading...' : 'Open diagram module'}
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
                                          {point.latex ? `Saved: ${(point.latex || '').slice(0, 80)}${point.latex.length > 80 ? '-' : ''}` : 'No LaTeX saved to this point yet.'}
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
          <h2 className="text-lg font-semibold text-center">Scheduled lesson - {activeGradeLabel}</h2>
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
                <div className="text-xs muted">Loading current setting...</div>
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
                          const canManage = sessionCanOrchestrateLessons && isOwner
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
                  ? `Past sessions - ${activeGradeLabel}`
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
                            {updatingSessionThumbnailBusy ? 'Updating...' : 'Upload / Update'}
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
                            {assignmentsLoading ? 'Refreshing...' : 'Refresh'}
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
                        if (assignmentsLoading) return <div className="text-sm muted">Loading assignments...</div>
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
                                      {typeof a?._count?.questions === 'number' ? ` - ${a._count.questions} questions` : ''}
                                    </div>
                                  </button>
                                  <div className="shrink-0">
                                    {(() => {
                                      const isOwner = viewerId && (String(a?.createdBy || '') === String(viewerId) || String(sessionDetailsSession?.createdBy || '') === String(viewerId))
                                      const canManage = sessionCanOrchestrateLessons && isOwner
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
                                              label: 'Open to edit',
                                              onClick: () => {
                                                if (!expandedSessionId) return
                                                setSelectedAssignmentId(String(a.id))
                                                setSelectedAssignmentQuestionId(null)
                                                setAssignmentQuestionOverlayOpen(false)
                                                setAssignmentOverlayOpen(true)
                                                void fetchAssignmentDetails(expandedSessionId, String(a.id), true)
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
                                {assignmentImporting ? 'Importing...' : 'Import with Gemini'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : sessionDetailsTab === 'responses' ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-sm">Solutions</div>
                        <div className="flex items-center gap-2">
                          {expandedSessionId ? (() => {
                            const effectiveCurrentUserId = String(currentUserId || viewerId || '')
                            const ownResponse = myResponses.find((response: any) => effectiveCurrentUserId && String(response?.userId || '') === effectiveCurrentUserId)
                            return (
                              <button
                                type="button"
                                className="text-xs font-semibold text-[#1877f2] hover:text-[#176ad8] disabled:opacity-50"
                                onClick={() => openLessonSolveComposer(expandedSessionId, { initialScene: ownResponse?.excalidrawScene || null })}
                                disabled={myResponsesLoading}
                              >
                                {ownResponse ? 'Edit your solution' : 'Share a solution'}
                              </button>
                            )
                          })() : null}
                          {expandedSessionId && (
                            <button
                              type="button"
                              className="text-xs font-semibold text-white/70 hover:text-white disabled:opacity-50"
                              onClick={() => fetchMyResponses(expandedSessionId)}
                              disabled={myResponsesLoading}
                            >
                              {myResponsesLoading ? 'Refreshing...' : 'Refresh'}
                            </button>
                          )}
                        </div>
                      </div>

                      {myResponsesError ? (
                        <div className="text-sm text-red-600">{myResponsesError}</div>
                      ) : myResponsesLoading ? (
                        <div className="text-sm muted">Loading solutions...</div>
                      ) : myResponses.length === 0 ? (
                        <div className="text-sm muted">No solutions shared yet.</div>
                      ) : (
                        <div className="space-y-2">
                          {myResponses.map((r: any) => (
                            <div key={r.id} className="p-3 border rounded bg-white space-y-1">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 space-y-1">
                                  {r?.updatedAt ? (
                                    <div className="text-xs text-slate-600">{new Date(r.updatedAt).toLocaleString()}</div>
                                  ) : null}
                                  {r?.userName ? (
                                    <div className="text-sm font-semibold text-slate-900">{String(r.userName)}</div>
                                  ) : null}
                                </div>
                                {String(r?.userId || '') === String(currentUserId || viewerId || '') ? (
                                  <button
                                    type="button"
                                    className="shrink-0 text-xs font-semibold text-[#1877f2] hover:text-[#176ad8]"
                                    onClick={() => openLessonSolveComposer(String(expandedSessionId || ''), { initialScene: r?.excalidrawScene || null })}
                                  >
                                    Edit
                                  </button>
                                ) : null}
                              </div>
                              {r?.quizLabel ? (
                                <div className="text-sm font-semibold text-slate-900">{String(r.quizLabel)}</div>
                              ) : null}
                              {r?.prompt ? (
                                <div className="text-sm text-slate-900 font-medium whitespace-pre-wrap break-words">
                                  {renderTextWithKatex(r.prompt)}
                                </div>
                              ) : null}
                              {r?.excalidrawScene ? (
                                <PublicSolveCanvasViewer scene={r.excalidrawScene} className="mt-2" emptyLabel="No canvas submitted yet." />
                              ) : null}
                              {(() => {
                                const html = renderKatexDisplayHtml(r?.latex)
                                if (!String(r?.latex || '').trim() && r?.excalidrawScene) {
                                  return null
                                }
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

        {gradeDetailOpen && (
          <OverlayPortal>
            <FullScreenGlassOverlay
              title={gradeDetailData?.assessmentTitle || gradeDetailItem?.assessmentTitle || 'Grade details'}
              subtitle="Expanded grading details"
              onClose={() => {
                setGradeDetailOpen(false)
                setGradeDetailItem(null)
                setGradeDetailData(null)
                setGradeDetailError(null)
                setGradeCommentDraft('')
                setGradeCommentEditId(null)
                setGradeCommentEditDraft('')
              }}
              onBackdropClick={() => {
                setGradeDetailOpen(false)
                setGradeDetailItem(null)
                setGradeDetailData(null)
                setGradeDetailError(null)
                setGradeCommentDraft('')
                setGradeCommentEditId(null)
                setGradeCommentEditDraft('')
              }}
              zIndexClassName="z-[65]"
            >
              <div className="space-y-3">
                {gradeDetailError ? <div className="text-sm text-red-600">{gradeDetailError}</div> : null}
                {gradeDetailLoading ? <div className="text-sm muted">Loading details...</div> : null}
                {!gradeDetailLoading && gradeDetailData ? (
                  <>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold break-words">{gradeDetailData.assessmentTitle}</div>
                          <div className="text-xs muted">{new Date(gradeDetailData.gradedAt).toLocaleString()}</div>
                        </div>
                        <div className="text-right shrink-0">
                          {(() => {
                            const fraction = parseScoreFraction({
                              scoreLabel: gradeDetailData.scoreLabel,
                              earnedMarks: gradeDetailData.earnedMarks,
                              totalMarks: gradeDetailData.totalMarks,
                            })
                            if (!fraction) {
                              return (
                                <>
                                  <div className="text-sm font-semibold">{gradeDetailData.scoreLabel}</div>
                                  {formatPercentageLabel(gradeDetailData.percentage) ? <div className="text-xs muted">{formatPercentageLabel(gradeDetailData.percentage)}</div> : null}
                                </>
                              )
                            }
                            return (
                              <div className="flex flex-col items-center">
                                <div className="h-20 w-20 rounded-full border-2 border-[#9cc1ff]/55 bg-black/20 shadow-sm flex flex-col items-center justify-center">
                                  <div className="text-[18px] font-bold leading-none text-white">{fraction.top}</div>
                                  <div className="my-1 h-px w-8 bg-white/70" />
                                  <div className="text-[14px] font-semibold leading-none text-white/90">{fraction.bottom}</div>
                                </div>
                                <div className="mt-1 text-[10px] font-medium text-white/70">{getGradeSignature(gradeDetailData.graderSignature)}</div>
                                {formatPercentageLabel(gradeDetailData.percentage) ? <div className="text-[11px] text-white/60">{formatPercentageLabel(gradeDetailData.percentage)}</div> : null}
                              </div>
                            )
                          })()}
                        </div>
                      </div>
                      {gradeDetailData.feedback ? (
                        <div className="mt-2 rounded-xl border border-white/10 bg-black/20 p-2 text-sm whitespace-pre-wrap break-words">
                          {gradeDetailData.feedback}
                        </div>
                      ) : null}
                      {gradeDetailData.screenshotUrls.length > 0 ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {gradeDetailData.screenshotUrls.map((url, idx) => (
                            <div key={`${url}-${idx}`} className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
                              <button
                                type="button"
                                className="block w-full cursor-zoom-in"
                                onClick={() => openGradeScreenshotViewer(url, `${gradeDetailData.assessmentTitle} screenshot ${idx + 1}`)}
                              >
                                <img src={url} alt={`Grading screenshot ${idx + 1}`} className="max-h-72 w-full object-contain" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                      <div className="text-xs uppercase tracking-wide text-white/70">Comments</div>
                      <div className="mt-3 space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                        {gradeDetailData.comments.length === 0 ? <div className="text-sm muted">No comments yet.</div> : null}
                        {gradeDetailData.comments.map((comment) => {
                          const mine = String(comment.authorId) === String(currentUserId || viewerId || '')
                          const isEditing = gradeCommentEditId === comment.id
                          return (
                            <div
                              key={comment.id}
                              className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${mine ? 'ml-auto bg-[#1877f2] text-white' : 'bg-black/30 text-white/90 border border-white/10'}`}
                            >
                              <div className="text-[11px] opacity-80 mb-1">
                                {mine ? 'You' : (comment.authorRole === 'teacher' ? 'Teacher' : 'Learner')} • {new Date(comment.updatedAt || comment.createdAt).toLocaleString()}
                              </div>
                              {isEditing ? (
                                <div className="space-y-2">
                                  <input
                                    className="h-9 w-full rounded-lg border border-white/30 bg-black/20 px-2 text-sm text-white"
                                    value={gradeCommentEditDraft}
                                    maxLength={100}
                                    onChange={(e) => setGradeCommentEditDraft(e.target.value.slice(0, 100))}
                                  />
                                  <div className="flex items-center justify-end gap-2">
                                    <button type="button" className="btn btn-ghost text-xs" onClick={() => { setGradeCommentEditId(null); setGradeCommentEditDraft('') }}>
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-primary text-xs"
                                      disabled={gradeCommentBusy || !gradeCommentEditDraft.trim()}
                                      onClick={() => void updateGradeComment(comment.id)}
                                    >
                                      Save
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="whitespace-pre-wrap break-words">{comment.text}</div>
                                  {(mine || isTeacherOrAdminUser) ? (
                                    <div className="mt-2 flex items-center justify-end gap-2">
                                      {mine ? (
                                        <button
                                          type="button"
                                          className="text-[11px] font-semibold underline underline-offset-2"
                                          onClick={() => { setGradeCommentEditId(comment.id); setGradeCommentEditDraft(comment.text) }}
                                        >
                                          Edit
                                        </button>
                                      ) : null}
                                      <button
                                        type="button"
                                        className="text-[11px] font-semibold underline underline-offset-2"
                                        onClick={() => void deleteGradeComment(comment.id)}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  ) : null}
                                </>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      <div className="mt-3 border-t border-white/10 pt-3">
                        <div className="flex items-end gap-2">
                          <textarea
                            className="min-h-[44px] max-h-[120px] flex-1 rounded-xl border border-white/20 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-white/50"
                            placeholder="Reply to teacher comment (max 100 chars)"
                            value={gradeCommentDraft}
                            maxLength={100}
                            onChange={(e) => setGradeCommentDraft(e.target.value.slice(0, 100))}
                          />
                          <button
                            type="button"
                            className="inline-flex h-10 items-center justify-center rounded-xl bg-[#1877f2] px-4 text-sm font-semibold text-white disabled:opacity-50"
                            disabled={gradeCommentBusy || !gradeCommentDraft.trim()}
                            onClick={() => void submitGradeComment()}
                          >
                            Send
                          </button>
                        </div>
                        <div className="mt-1 text-[11px] text-white/60">{gradeCommentDraft.length}/100</div>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </FullScreenGlassOverlay>
          </OverlayPortal>
        )}

        {gradeImageViewer ? (
          <OverlayPortal>
            <ZoomableImageOverlay
              open={Boolean(gradeImageViewer)}
              imageUrl={gradeImageViewer.url}
              title={gradeImageViewer.title}
              onClose={closeGradeScreenshotViewer}
            />
          </OverlayPortal>
        ) : null}

        {assignmentOverlayOpen && (
          <OverlayPortal>
            <FullScreenGlassOverlay
              title={selectedAssignment?.title || 'Assignment'}
              onClose={() => {
                setAssignmentQuestionOverlayOpen(false)
                setSelectedAssignmentQuestionId(null)
                setAssignmentTitleEditMode(false)
                setAssignmentOverlayOpen(false)
              }}
              onBackdropClick={() => {
                setAssignmentQuestionOverlayOpen(false)
                setSelectedAssignmentQuestionId(null)
                setAssignmentTitleEditMode(false)
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
                    setAssignmentTitleEditMode(false)
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
                  const canManage = sessionCanOrchestrateLessons && isOwner
                  if (!canManage || !expandedSessionId || !selectedAssignment?.id) return null
                  return (
                    <div className="flex items-center justify-end">
                      <TaskManageMenu
                        actions={[
                          {
                            label: 'Edit in this view',
                            onClick: () => {
                              setAssignmentTitleEditMode(true)
                              setAssignmentTitleEditDraft(String(selectedAssignment?.title || ''))
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
                      <div className="text-sm muted">Loading assignment...</div>
                    ) : !selectedAssignment ? (
                      <div className="text-sm muted">No assignment selected.</div>
                    ) : (
                      <>
                        {(() => {
                          const isOwner = viewerId && (String(selectedAssignment?.createdBy || '') === String(viewerId) || String(sessionDetailsSession?.createdBy || '') === String(viewerId))
                          const canManage = sessionCanOrchestrateLessons && isOwner
                          if (!canManage) return null
                          if (!assignmentTitleEditMode) return null
                          return (
                            <div className="border border-white/10 rounded bg-white/5 p-3 space-y-2">
                              <div className="text-xs uppercase tracking-wide text-white/70">Edit Assignment</div>
                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  className="input max-w-md"
                                  value={assignmentTitleEditDraft}
                                  onChange={(e) => setAssignmentTitleEditDraft(e.target.value)}
                                  placeholder="Assignment title"
                                />
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  disabled={assignmentTitleSaving || !assignmentTitleEditDraft.trim()}
                                  onClick={() => void saveAssignmentTitleFromView()}
                                >
                                  {assignmentTitleSaving ? 'Saving...' : 'Save changes'}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  disabled={assignmentTitleSaving}
                                  onClick={() => {
                                    setAssignmentTitleEditMode(false)
                                    setAssignmentTitleEditDraft(String(selectedAssignment?.title || ''))
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )
                        })()}

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
                                            return parts.join(' - ')
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
                                  {assignmentResponsesLoading ? 'Refreshing...' : 'Refresh'}
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
                                <div className="text-sm muted">Loading grade...</div>
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
                                {adminAssignmentSubmissionsLoading ? 'Refreshing...' : 'Refresh'}
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
                                          ? ` - ${row.grade.earnedPoints}/${row.grade.totalPoints} (${Math.round(row.grade.percentage)}%)`
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
                              {assignmentSubmitting ? 'Submitting...' : (assignmentSubmittedAt ? 'Resubmit Assignment' : 'Submit Assignment')}
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
                                      : <span className="text-xs muted">Click to edit...</span>}
                                  </div>
                                )}
                                <div>
                                  <button
                                    type="button"
                                    className="btn btn-secondary text-xs"
                                    disabled={assignmentGradingPromptSavingScope === 'assignment'}
                                    onClick={() => saveAssignmentGradingPrompt(expandedSessionId, String(selectedAssignment.id), String(assignmentMasterGradingPrompt || ''))}
                                  >
                                    {assignmentGradingPromptSavingScope === 'assignment' ? 'Saving...' : 'Save assignment prompt'}
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
                                      : <span className="text-xs muted">Click to edit...</span>}
                                  </div>
                                )}
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    className="btn btn-secondary text-xs"
                                    disabled={assignmentSolutionMarkingPlanGeneratingQuestionId === qid}
                                    onClick={() => void generateAssignmentSolutionMarkingPlan(expandedSessionId, String(selectedAssignment.id), qid)}
                                  >
                                    {assignmentSolutionMarkingPlanGeneratingQuestionId === qid ? 'Generating...' : 'Generate with Gemini'}
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
                                    {assignmentSolutionMarkingPlanSavingQuestionId === qid ? 'Saving...' : 'Save marking plan'}
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
                                      : <span className="text-xs muted">Click to edit...</span>}
                                  </div>
                                )}
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    className="btn btn-secondary text-xs"
                                    disabled={assignmentSolutionWorkedSolutionGeneratingQuestionId === qid}
                                    onClick={() => void generateAssignmentSolutionWorkedSolution(expandedSessionId, String(selectedAssignment.id), qid)}
                                  >
                                    {assignmentSolutionWorkedSolutionGeneratingQuestionId === qid ? 'Generating...' : 'Generate worked solution'}
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
                                    {assignmentSolutionWorkedSolutionSavingQuestionId === qid ? 'Saving...' : 'Save worked solution'}
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
                                      : <span className="text-xs muted">Click to edit...</span>}
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
                                    {assignmentGradingPromptSavingScope === `q:${qid}` ? 'Saving...' : 'Save grading prompt'}
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
                                    <div className="text-sm muted">Loading grade...</div>
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
                                            {correctness && (typeof earned === 'number' || typeof total === 'number') ? ' - ' : null}
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
                      {submission?.submittedAt ? <span>- {new Date(submission.submittedAt).toLocaleString()}</span> : null}
                      {typeof detail?.grade?.percentage === 'number' ? (
                        <span>
                          - <span className="font-medium text-white">{detail.grade.earnedPoints}/{detail.grade.totalPoints}</span> ({Math.round(detail.grade.percentage)}%)
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  loading={adminSelectedSubmissionLoading}
                  loadingText="Loading submission..."
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
                          - Grade: {Math.trunc(assignmentGradeSummary.earnedPoints)}/{Math.trunc(assignmentGradeSummary.totalPoints)} ({Math.round(assignmentGradeSummary.percentage)}%)
                        </span>
                      ) : null}
                    </div>
                  }
                  loading={Boolean(assignmentResponsesLoading || assignmentGradeLoading)}
                  loadingText="Loading..."
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
        Filters {usersFiltersOpen ? 'v' : '>'}
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
              {bulkVerifyLoading ? 'Verifying...' : 'Skip verification for all'}
            </button>
          </div>
        )
      })()}

      <button
        type="button"
        className="btn btn-ghost text-sm justify-between"
        onClick={() => setUsersCreateOpen(v => !v)}
      >
        Create user {usersCreateOpen ? 'v' : '>'}
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
        Users list {usersListOpen ? 'v' : '>'}
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
                      {u.firstName || u.name || '-'} {u.lastName || ''}
                    </UserLink>
                    <div className="text-xs muted">Grade: {u.grade ? gradeToLabel(u.grade) : 'Unassigned'}</div>
                    <div className="text-xs muted">School: {u.schoolName || '-'}</div>
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
          <div className="space-y-3 p-1">
            <section className="group-surface-card card p-4 space-y-3">
              <div className="group-surface-heading text-sm font-semibold text-white">New group</div>
              <div className="grid gap-2">
                <input
                  className="input"
                  value={createGroupName}
                  onChange={(e) => setCreateGroupName(e.target.value)}
                  placeholder="e.g. Grade 12 Maths - Study Group"
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
                  className="btn btn-secondary w-full sm:w-auto"
                  disabled={createGroupBusy || !createGroupName.trim()}
                  onClick={createGroup}
                >
                  {createGroupBusy ? 'Creating...' : 'Create group'}
                </button>
                <div className="group-surface-note text-xs muted">Learners can create groups for their grade or below.</div>
              </div>
            </section>

            <section className="group-surface-card card p-4 space-y-3">
              <div className="group-surface-heading text-sm font-semibold text-white">Join group</div>
              <div className="flex items-center gap-2">
                <input
                  className="input flex-1"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="Enter join code"
                  maxLength={16}
                />
                <button type="button" className="btn btn-secondary" disabled={joinBusy || !joinCode.trim()} onClick={joinGroupByCode}>
                  {joinBusy ? 'Joining...' : 'Join'}
                </button>
              </div>
            </section>

            <section className="group-surface-card card p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="group-surface-heading text-sm font-semibold text-white">Groups</div>
                <button type="button" className="btn btn-ghost" onClick={() => void loadMyGroups()}>
                  Refresh
                </button>
              </div>

              {myGroupsLoading ? (
                <div className="text-sm muted">Loading...</div>
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
                      className={`group-surface-item card p-3 text-left ${selectedGroupId === row.group.id ? 'group-surface-item-active' : ''}`}
                      onClick={() => void loadGroupMembers(row.group.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-white break-words">{row.group.name}</div>
                          <div className="text-xs muted">
                            {row.group.type.replace('_', ' ')}
                            {row.group.grade ? ` - ${gradeToLabel(row.group.grade as GradeValue)}` : ''}
                            {` - ${row.group.membersCount} member${row.group.membersCount === 1 ? '' : 's'}`}
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
              <section className="group-surface-card card p-4 space-y-3">
                {(() => {
                  const myId = (session as any)?.user?.id as string | undefined
                  const membership = myGroups.find((g) => g.group.id === selectedGroupId)
                  const myRole = membership?.memberRole || ''
                  const canManage =
                    currentLessonRoleProfile.capabilities.canOrchestrateLesson ||
                    myRole === 'owner' ||
                    myRole === 'instructor' ||
                    (myId && selectedGroupCreatedById && myId === selectedGroupCreatedById)

                  if (!canManage) return null

                  const pendingForGroup = actionJoinRequests.filter((r) => String(r?.groupId || r?.group?.id || '') === selectedGroupId)

                  return (
                    <>
                      <div className="card p-3 space-y-3">
                        <div className="group-surface-heading text-sm font-semibold text-white">Code</div>
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
                              {regenerateJoinCodeBusy ? 'Regenerating...' : 'Regenerate'}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="text-sm muted flex-1">Members do not see the code.</div>
                            <button type="button" className="btn btn-secondary" disabled={regenerateJoinCodeBusy} onClick={regenerateSelectedGroupJoinCode}>
                              {regenerateJoinCodeBusy ? 'Regenerating...' : 'Regenerate'}
                            </button>
                          </div>
                        )}

                        <div className="group-surface-heading text-sm font-semibold text-white">Invite</div>
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
                            {inviteBusy ? 'Sending...' : 'Invite'}
                          </button>
                        </div>

                        {selectedGroupAllowJoinRequests && (
                          <div className="group-surface-note text-xs muted">Requests can also come from Discover.</div>
                        )}
                      </div>

                      <div className="card p-3 space-y-2">
                        <div className="group-surface-heading text-sm font-semibold text-white">Requests</div>
                        {notificationsLoading ? (
                          <div className="text-sm muted">Loading...</div>
                        ) : pendingForGroup.length === 0 ? (
                          <div className="text-sm muted">No pending requests.</div>
                        ) : (
                          <div className="grid gap-2">
                            {pendingForGroup.map((r: any) => {
                              const requesterVerified = r?.requestedBy?.verified || hasLessonCapabilityForRole(r?.requestedBy?.role, 'canOrchestrateLesson')
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
                  <div className="group-surface-heading text-sm font-semibold text-white">Members</div>
                  {selectedGroupLoading && <div className="text-xs muted">Loading...</div>}
                </div>
                {selectedGroupMembers.length === 0 ? (
                  <div className="text-sm muted">No members found.</div>
                ) : (
                  <div className="grid gap-2">
                    {selectedGroupMembers.map((m) => {
                      const verified = hasLessonCapabilityForRole(m.user.role, 'canOrchestrateLesson')
                      const label = getPlatformRoleDisplayLabel(m.user.role, {
                        learnerGradeLabel: m.user.grade ? gradeToLabel(m.user.grade as GradeValue) : '',
                        variant: 'dashboard',
                      })
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
                                <span className="truncate">{label}{m.user.statusBio ? ` - ${m.user.statusBio}` : ''}</span>
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
                          {getPlatformRoleDisplayLabel(profilePeek.role, {
                            learnerGradeLabel: profilePeek.grade ? gradeToLabel(profilePeek.grade as GradeValue) : '',
                            variant: 'dashboard',
                          })}
                          {profilePeek.schoolName ? ` - ${profilePeek.schoolName}` : ''}
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
        const trimmedDiscoverQuery = discoverQuery.trim()
        const showingSearchResults = trimmedDiscoverQuery.length > 0 && discoverResults.length > 0
        const showingFallbackSuggestions = trimmedDiscoverQuery.length > 0 && !discoverLoading && discoverResults.length === 0
        const activeDiscoverCards = showingSearchResults ? discoverResults : discoverRecommendations

        return (
          <div className="space-y-3">
            <section className="card p-3 space-y-3">
              <div className="text-sm font-semibold text-white">Search people</div>
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
                  {discoverLoading ? 'Searching...' : 'Search'}
                </button>
              </div>
              {discoverError && <div className="text-sm text-red-200">{discoverError}</div>}

              {showingFallbackSuggestions ? (
                <div className="text-xs muted">No exact matches. Showing likely people instead.</div>
              ) : null}

              {discoverLoading && activeDiscoverCards.length === 0 ? (
                <div className="text-sm muted">Loading recommendations...</div>
              ) : activeDiscoverCards.length === 0 ? (
                <div className="text-sm muted">People will appear here.</div>
              ) : (
                <div className="discover-results-scroll grid gap-2 overflow-y-auto pr-1">
                  {activeDiscoverCards.map((u: any) => {
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
                            <div className="text-xs muted truncate">{u.schoolName ? `${u.schoolName} - ` : ''}{u.statusBio || ''}</div>
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

  const renderStudentSurfaceIcon = (id: 'sessions' | 'groups' | 'discover' | 'books') => {
    switch (id) {
      case 'sessions':
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="4" y="5" width="16" height="15" rx="3" stroke="currentColor" strokeWidth="1.9" />
            <path d="M8 3V7M16 3V7M4 10H20" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
        )
      case 'groups':
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 11C10.6569 11 12 9.65685 12 8C12 6.34315 10.6569 5 9 5C7.34315 5 6 6.34315 6 8C6 9.65685 7.34315 11 9 11Z" stroke="currentColor" strokeWidth="1.9" />
            <path d="M15.5 10C16.8807 10 18 8.88071 18 7.5C18 6.11929 16.8807 5 15.5 5C14.1193 5 13 6.11929 13 7.5C13 8.88071 14.1193 10 15.5 10Z" stroke="currentColor" strokeWidth="1.9" />
            <path d="M4.5 18C4.5 15.7909 6.29086 14 8.5 14H9.5C11.7091 14 13.5 15.7909 13.5 18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            <path d="M13 18C13 16.3431 14.3431 15 16 15H16.5C18.1569 15 19.5 16.3431 19.5 18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
        )
      case 'discover':
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.9" />
            <path d="M14.8 9.2L13.3 13.3L9.2 14.8L10.7 10.7L14.8 9.2Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
          </svg>
        )
      case 'books':
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 5.5C6 4.67157 6.67157 4 7.5 4H18V19H7.5C6.67157 19 6 19.6716 6 20.5V5.5Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
            <path d="M6 20H17.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            <path d="M9 8H14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
        )
    }
  }

  const renderStudentSurfaceFrame = (
    id: 'sessions' | 'groups' | 'discover' | 'books',
    children: React.ReactNode,
    action?: React.ReactNode
  ) => {
    const meta = {
      sessions: {
        eyebrow: 'Learning Flow',
        title: 'Sessions',
        subtitle: 'Lessons and schedule'
      },
      groups: {
        eyebrow: 'Your Circle',
        title: 'Groups',
        subtitle: 'Study circles'
      },
      discover: {
        eyebrow: 'Search & Connect',
        title: 'Discover',
        subtitle: 'Find people'
      },
      books: {
        eyebrow: 'Study Shelf',
        title: 'Books & Materials',
        subtitle: 'Learning resources'
      }
    }[id]

    return (
      <div className="student-surface-frame bg-[#f0f2f5] text-[#1c1e21]">
        <section className="student-surface-header border-b border-black/10 bg-white px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e8f1ff] text-[#1877f2]">
                {renderStudentSurfaceIcon(id)}
                {id === 'books' && unreadGradingUpdatesCount > 0 ? (
                  <span
                    className={`absolute -top-1 -right-1 z-20 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-[10px] leading-4 text-white text-center ${unattendedGradingUpdatesCount > 0 ? 'animate-pulse' : ''}`}
                    style={unattendedGradingUpdatesCount > 0 ? { animationDuration: '2.2s' } : undefined}
                    aria-label={`${unreadGradingUpdatesCount} new grading updates`}
                  >
                    {unreadGradingUpdatesCount > 99 ? '99+' : unreadGradingUpdatesCount}
                  </span>
                ) : null}
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#65676b]">{meta.eyebrow}</div>
                <div className="mt-1 font-semibold text-[#1c1e21]">{meta.title}</div>
                <div className="text-[12px] text-[#65676b]">{meta.subtitle}</div>
              </div>
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
          </div>
        </section>
        <div className="student-surface-stack pb-6">{children}</div>
      </div>
    )
  }

  const renderStudentSurfaceSection = (id: 'sessions' | 'groups' | 'discover') => {
    const action =
      id === 'sessions' ? (
        <button
          type="button"
          className="inline-flex h-10 items-center justify-center rounded-full border border-[#d5def0] bg-[#f7f8fa] px-4 text-sm font-medium text-[#1c1e21] transition hover:bg-[#eef2f7]"
          onClick={openBooksOverlay}
        >
          Library
        </button>
      ) : id === 'groups' ? (
        <button
          type="button"
          className="inline-flex h-10 items-center justify-center rounded-full border border-[#d5def0] bg-[#f7f8fa] px-4 text-sm font-medium text-[#1c1e21] transition hover:bg-[#eef2f7]"
          onClick={() => void loadMyGroups()}
        >
          Refresh
        </button>
      ) : null

    return renderStudentSurfaceFrame(id, renderSection(id), action)
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

  const renderDashboardFooter = (tone: 'desktop' | 'mobile') => {
    return (
      <AppFooter
        tone={tone === 'desktop' ? 'dark' : 'light'}
        className={tone === 'mobile' ? 'mx-4 mt-4' : ''}
        respectSafeBottom={tone === 'mobile'}
        showAdminAction={isAdmin}
        adminActionLabel="Normalization Lab"
        onAdminAction={() => setHandwritingNormalizationOverlayOpen(true)}
      />
    )
  }

  const renderDesktopFeedShell = () => {
    const shortcutSections = availableSections.filter(section => section.id !== 'overview')
    const discoverAvailable = shortcutSections.some(section => section.id === 'discover')
    const announcementsAvailable = shortcutSections.some(section => section.id === 'announcements')

    return (
      <div className="space-y-6">
        <div className="sticky top-4 z-20">
          <div className="overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(7,18,56,0.94),rgba(6,15,46,0.9))] shadow-[0_24px_60px_rgba(2,6,23,0.42)] backdrop-blur-xl">
            <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
              <div className="flex items-center gap-4 min-w-0">
                <BrandLogo height={42} className="shrink-0 drop-shadow-[0_14px_34px_rgba(3,5,20,0.5)]" />
                <button
                  type="button"
                  onClick={() => {
                    if (discoverAvailable) {
                      openDashboardOverlay('discover')
                    }
                  }}
                  className="group flex min-w-[280px] max-w-[520px] flex-1 items-center gap-3 rounded-full border border-white/10 bg-white/6 px-4 py-3 text-left text-sm text-white/72 transition hover:border-white/20 hover:bg-white/10"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-white/55 group-hover:text-white/80">
                    <path d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" stroke="currentColor" strokeWidth="2" />
                    <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span className="truncate">Search learners, groups, sessions, and shared resources</span>
                </button>
              </div>

              <div className="flex items-center gap-2 lg:gap-3">
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/6 px-4 text-sm font-medium text-white/88 transition hover:border-white/20 hover:bg-white/10"
                  onClick={openBooksOverlay}
                >
                  <span>Library</span>
                </button>
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/6 px-4 text-sm font-medium text-white/88 transition hover:border-white/20 hover:bg-white/10"
                  onClick={() => setCreateOverlayOpen(true)}
                >
                  <span>Create</span>
                </button>
                <button
                  type="button"
                  className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/6 text-white/88 transition hover:border-white/20 hover:bg-white/10"
                  onClick={openNotificationsOverlay}
                  aria-label="Open notifications"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2Zm6-6V11c0-3.07-1.63-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2Z" fill="currentColor" />
                  </svg>
                  {unreadNotificationsCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-[#1877f2] px-1.5 text-center text-[10px] font-semibold leading-5 text-white shadow-[0_8px_18px_rgba(24,119,242,0.45)]">
                      {unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount}
                    </span>
                  )}
                </button>
                <Link
                  href="/profile"
                  className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/6 px-2 py-2 text-white/90 transition hover:border-white/20 hover:bg-white/10"
                >
                  <span className="inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/10 text-sm font-semibold text-white">
                    {effectiveAvatarUrl ? (
                      <img src={effectiveAvatarUrl} alt={learnerName} className="h-full w-full object-cover" />
                    ) : (
                      <span>{String(learnerName || 'U').slice(0, 1).toUpperCase()}</span>
                    )}
                  </span>
                  <span className="hidden pr-2 text-sm font-medium lg:inline">{learnerName}</span>
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[250px_minmax(0,1fr)_320px]">
          <aside className="space-y-4 xl:sticky xl:top-28 self-start">
            <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-4 shadow-[0_16px_45px_rgba(2,6,23,0.24)] backdrop-blur-xl">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">Navigation</div>
              <div className="mt-3 space-y-2">
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-2xl border border-[#1877f2]/30 bg-[#1877f2]/18 px-4 py-3 text-left text-white shadow-[0_12px_28px_rgba(24,119,242,0.18)]"
                  onClick={() => {
                    closeDashboardOverlay()
                    setActiveSection('overview')
                  }}
                >
                  <span>
                    <span className="block text-sm font-semibold">Home Feed</span>
                    <span className="block text-xs text-white/65">Your class stream and live activity</span>
                  </span>
                  <span className="text-xs text-white/70">Live</span>
                </button>
                {shortcutSections.map(section => (
                  <button
                    key={section.id}
                    type="button"
                    className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-white/86 transition hover:border-white/20 hover:bg-white/8"
                    onClick={() => openDashboardOverlay(section.id as OverlaySectionId)}
                  >
                    <span>
                      <span className="block text-sm font-semibold">{section.label}</span>
                      <span className="block text-xs text-white/55">{section.description}</span>
                    </span>
                    <span className="text-white/35">{'>'}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-4 shadow-[0_16px_45px_rgba(2,6,23,0.24)] backdrop-blur-xl">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">Workspace</div>
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-sm font-semibold text-white">{status === 'authenticated' ? activeGradeLabel : 'Guest workspace'}</div>
                <div className="mt-1 text-xs leading-relaxed text-white/55">Switch sections, open materials, and jump into the live board from here.</div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="inline-flex h-10 items-center justify-center rounded-full border border-white/10 bg-white/6 px-4 text-sm font-medium text-white/88 transition hover:border-white/20 hover:bg-white/10"
                    onClick={openBooksOverlay}
                  >
                    Books
                  </button>
                  {announcementsAvailable && (
                    <button
                      type="button"
                      className="inline-flex h-10 items-center justify-center rounded-full border border-white/10 bg-white/6 px-4 text-sm font-medium text-white/88 transition hover:border-white/20 hover:bg-white/10"
                      onClick={() => openDashboardOverlay('announcements')}
                    >
                      Updates
                    </button>
                  )}
                </div>
              </div>
            </div>
          </aside>

          <section className="min-w-0 space-y-4">
            <div className="overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(8,24,74,0.92),rgba(11,35,94,0.78))] px-6 py-5 shadow-[0_18px_50px_rgba(2,6,23,0.35)]">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-200/65">For You</div>
                  <h1 className="mt-2 text-[2rem] font-semibold tracking-[-0.03em] text-white">Welcome back, {String(learnerName || 'Learner').split(' ')[0]}</h1>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-blue-50/72">A feed-first home for class activity, live lessons, quizzes, announcements, and the work your circle is sharing right now.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-[#0f172a] shadow-[0_14px_32px_rgba(255,255,255,0.18)] transition hover:bg-blue-50"
                    onClick={() => setCreateOverlayOpen(true)}
                  >
                    Create Post
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-11 items-center justify-center rounded-full border border-white/14 bg-white/8 px-5 text-sm font-medium text-white transition hover:bg-white/12"
                    onClick={() => openDashboardOverlay('sessions')}
                  >
                    Browse Sessions
                  </button>
                </div>
              </div>
            </div>

            {renderStudentTimelinePanel()}
          </section>

          <aside className="space-y-4 xl:sticky xl:top-28 self-start">
            <div className="overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] shadow-[0_18px_50px_rgba(2,6,23,0.32)] backdrop-blur-xl">
              <div className="bg-[radial-gradient(circle_at_top,rgba(24,119,242,0.35),rgba(24,119,242,0)_62%)] px-5 pb-5 pt-6">
                <div className="flex items-center gap-4">
                  <div className="relative shrink-0">
                    <div className="h-16 w-16 overflow-hidden rounded-full border border-white/15 bg-white/10">
                      {effectiveAvatarUrl ? (
                        <img src={effectiveAvatarUrl} alt={learnerName} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xl font-semibold text-white">{String(learnerName || 'U').slice(0, 1).toUpperCase()}</div>
                      )}
                    </div>
                    {isVerifiedAccount && (
                      <span className="absolute -bottom-1 -right-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/35 bg-[#1877f2] text-white shadow-[0_10px_22px_rgba(24,119,242,0.38)]" aria-label="Verified" title="Verified">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M9.0 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" fill="currentColor" />
                        </svg>
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-lg font-semibold text-white">{learnerName}</div>
                    <div className="mt-1 text-sm text-white/62">{roleFlagText}</div>
                  </div>
                </div>
                <div className="mt-4 rounded-2xl border border-white/10 bg-black/15 p-4">
                  <div className="text-sm leading-relaxed text-white/82">{profileStatusBio || 'Keep your classmates and teachers updated with a short status.'}</div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">Workspace</div>
                    <div className="mt-2 text-sm font-semibold text-white">{status === 'authenticated' ? activeGradeLabel : 'Guest'}</div>
                  </div>
                  <button
                    type="button"
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:border-white/20 hover:bg-white/8"
                    onClick={openNotificationsOverlay}
                  >
                    <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">Alerts</div>
                    <div className="mt-2 text-sm font-semibold text-white">{unreadNotificationsCount > 0 ? `${unreadNotificationsCount} unread` : 'All caught up'}</div>
                  </button>
                </div>
                <div className="mt-4 flex gap-2">
                  <Link href="/profile" className="inline-flex h-11 flex-1 items-center justify-center rounded-full border border-white/10 bg-white/8 px-4 text-sm font-medium text-white transition hover:bg-white/12">
                    View Profile
                  </Link>
                  <button
                    type="button"
                    className="inline-flex h-11 flex-1 items-center justify-center rounded-full border border-white/10 bg-white/8 px-4 text-sm font-medium text-white transition hover:bg-white/12"
                    onClick={() => setAccountSnapshotOverlayOpen(true)}
                  >
                    Snapshot
                  </button>
                </div>
              </div>
            </div>

            {renderTimelineCard()}
            {renderAccountSnapshotCard()}
            {isAdmin ? renderAdminToolsQuickPanel() : null}
          </aside>
        </div>

        {renderDashboardFooter('desktop')}
      </div>
    )
  }

  const renderMobileActivePanel = () => (
    <div
      ref={studentMobilePanelsRef}
      onPointerDown={onStudentMobilePointerDown}
      onPointerMove={onStudentMobilePointerMove}
      onPointerUp={onStudentMobilePointerUp}
      onPointerCancel={onStudentMobilePointerCancel}
      className="relative w-full overflow-hidden transition-[height] duration-200"
      style={{
        height: studentMobileActivePanelHeight ?? undefined,
        touchAction: 'pan-y',
      }}
    >
      <div
        className={`flex w-full items-start ${studentMobileIsDragging ? '' : 'transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'}`}
        style={{ transform: `translate3d(calc(${-100 * studentMobileActiveIndex}% + ${studentMobileDragOffsetPx}px), 0, 0)` }}
      >
        <div
          ref={el => {
            studentMobilePanelRefs.current.timeline = el
          }}
          className="w-full flex-none self-start"
        >
          <div className="pb-8">{renderStudentTimelinePanel()}</div>
        </div>

        <div
          ref={el => {
            studentMobilePanelRefs.current.sessions = el
          }}
          className="w-full flex-none self-start"
        >
          <div className="pb-8">{renderStudentSurfaceSection('sessions')}</div>
        </div>

        <div
          ref={el => {
            studentMobilePanelRefs.current.groups = el
          }}
          className="w-full flex-none self-start"
        >
          <div className="pb-8">{renderStudentSurfaceSection('groups')}</div>
        </div>

        <div
          ref={el => {
            studentMobilePanelRefs.current.discover = el
          }}
          className="w-full flex-none self-start"
        >
          <div className="pb-8">{renderStudentSurfaceSection('discover')}</div>
        </div>
      </div>
    </div>
  )

  const renderMobileFeedShell = () => {
    const mobilePrimarySections = availableSections.filter(section =>
      section.id === 'announcements' || section.id === 'sessions' || section.id === 'groups' || section.id === 'discover'
    )
    const mobileAdminSections = availableSections.filter(section =>
      section.id === 'live' || section.id === 'users' || section.id === 'billing'
    )

    const jumpHome = () => {
      closeDashboardOverlay()
      setActiveSection('overview')
      setStudentMobileTab('timeline')
      closeMobileMenu()
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }

    const switchMobileTab = (tab: 'timeline' | 'sessions' | 'groups' | 'discover') => {
      setStudentMobileIsDragging(false)
      setStudentMobileDragOffsetPx(0)
      setStudentMobileTab(tab)
      closeMobileMenu()
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }

    return (
      <div className="pb-8 pt-0">
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

        <div className="sticky top-0 z-30 bg-[rgba(255,255,255,0.98)] backdrop-blur-xl">
          <div className="mobile-safe-header-row flex items-center justify-between gap-3 border-b border-black/10 px-4 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/10 bg-[#f8fafc] text-[#1c1e21]"
                  onClick={() => setMobileMenuOpen(true)}
                  aria-label="Open menu"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M5 7H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M5 17H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
                <BrandLogo height={34} className="drop-shadow-none shrink-0" />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-[#f8fafc] text-[#1c1e21]"
                  onClick={() => openStudentQuickOverlay('discover')}
                  aria-label="Search and discover"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" stroke="currentColor" strokeWidth="2" />
                    <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-[#f8fafc] text-[#1c1e21]"
                  onClick={openNotificationsOverlay}
                  aria-label="Notifications"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2Zm6-6V11c0-3.07-1.63-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2Z" fill="currentColor" />
                  </svg>
                  {unreadNotificationsCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-[#1877f2] px-1.5 text-center text-[10px] font-semibold leading-5 text-white shadow-[0_8px_18px_rgba(24,119,242,0.45)]">
                      {unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount}
                    </span>
                  )}
                </button>
                <Link href="/profile" className="inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-black/10 bg-[#f8fafc]">
                  {effectiveAvatarUrl ? (
                    <img src={effectiveAvatarUrl} alt={learnerName} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-sm font-semibold text-[#1c1e21]">{String(learnerName || 'U').slice(0, 1).toUpperCase()}</span>
                  )}
                </Link>
              </div>
            </div>

            <div>
              <div className="relative grid grid-cols-5 border-b border-black/10 bg-white">
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute bottom-0 left-0 z-0 h-[3px] w-1/5 rounded-full bg-[#1877f2] ${studentMobileIsDragging ? '' : 'transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'}`}
                  style={{ transform: `translateX(${studentMobileVisualIndex * 100}%)` }}
                />
                <button
                  type="button"
                  className={`relative z-10 flex min-w-0 items-center justify-center px-1 py-3 transition ${studentMobileTab === 'timeline' ? 'text-[#1c1e21]' : 'text-[#65676b]'}`}
                  onClick={() => switchMobileTab('timeline')}
                  aria-label="Home"
                  title="Home"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 10.5L12 4L20 10.5V20H14.5V14.5H9.5V20H4V10.5Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`relative z-10 flex min-w-0 items-center justify-center px-1 py-3 transition ${studentMobileTab === 'sessions' ? 'text-[#1c1e21]' : 'text-[#65676b]'}`}
                  onClick={() => switchMobileTab('sessions')}
                  aria-label="Sessions"
                  title="Sessions"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="4" y="5" width="16" height="15" rx="3" stroke="currentColor" strokeWidth="1.9" />
                    <path d="M8 3V7M16 3V7M4 10H20" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`relative z-10 flex min-w-0 items-center justify-center px-1 py-3 transition ${studentMobileTab === 'groups' ? 'text-[#1c1e21]' : 'text-[#65676b]'}`}
                  onClick={() => switchMobileTab('groups')}
                  aria-label="Groups"
                  title="Groups"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M9 11C10.6569 11 12 9.65685 12 8C12 6.34315 10.6569 5 9 5C7.34315 5 6 6.34315 6 8C6 9.65685 7.34315 11 9 11Z" stroke="currentColor" strokeWidth="1.9" />
                    <path d="M15.5 10C16.8807 10 18 8.88071 18 7.5C18 6.11929 16.8807 5 15.5 5C14.1193 5 13 6.11929 13 7.5C13 8.88071 14.1193 10 15.5 10Z" stroke="currentColor" strokeWidth="1.9" />
                    <path d="M4.5 18C4.5 15.7909 6.29086 14 8.5 14H9.5C11.7091 14 13.5 15.7909 13.5 18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                    <path d="M13 18C13 16.3431 14.3431 15 16 15H16.5C18.1569 15 19.5 16.3431 19.5 18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`relative z-10 flex min-w-0 items-center justify-center px-1 py-3 transition ${studentMobileTab === 'discover' ? 'text-[#1c1e21]' : 'text-[#65676b]'}`}
                  onClick={() => switchMobileTab('discover')}
                  aria-label="Discover"
                  title="Discover"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.9" />
                    <path d="M14.8 9.2L13.3 13.3L9.2 14.8L10.7 10.7L14.8 9.2Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="relative z-10 flex min-w-0 items-center justify-center px-1 py-3 text-[#65676b] transition"
                  onClick={openBooksOverlay}
                  aria-label="Library"
                  title="Library"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M6 5.5C6 4.67157 6.67157 4 7.5 4H18V19H7.5C6.67157 19 6 19.6716 6 20.5V5.5Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
                    <path d="M6 20H17.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                    <path d="M9 8H14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                  </svg>
                  {unreadGradingUpdatesCount > 0 ? (
                    <span
                      className={`absolute -top-1 -right-1 z-20 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-[10px] leading-4 text-white text-center ${unattendedGradingUpdatesCount > 0 ? 'animate-pulse' : ''}`}
                      style={unattendedGradingUpdatesCount > 0 ? { animationDuration: '2.2s' } : undefined}
                      aria-label={`${unreadGradingUpdatesCount} new grading updates`}
                    >
                      {unreadGradingUpdatesCount > 99 ? '99+' : unreadGradingUpdatesCount}
                    </span>
                  ) : null}
                </button>
              </div>

            </div>
        </div>

        <div>
          {renderMobileActivePanel()}
        </div>

        {renderDashboardFooter('mobile')}

        {mobileMenuOpen && (
          <FullScreenGlassOverlay
            title="Menu"
            onClose={closeMobileMenu}
            onBackdropClick={closeMobileMenu}
            zIndexClassName="z-50"
            className={`transition-opacity duration-200 ${topStackOverlayOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
            variant="light"
            panelClassName="bg-[#f8fafc]"
          >
            <div className="mobile-menu-sheet mobile-safe-menu space-y-4">
              <section className="mobile-menu-section">
                <button type="button" className="mobile-menu-item mobile-menu-item-active" onClick={jumpHome}>
                  <span>
                    <span className="mobile-menu-label">Home</span>
                    <span className="mobile-menu-copy">Feed, live class, and class activity.</span>
                  </span>
                  <span className="mobile-menu-trail">Now</span>
                </button>
                {mobilePrimarySections.map(section => (
                  <button
                    key={section.id}
                    type="button"
                    className="mobile-menu-item"
                    onClick={() => {
                      if (section.id === 'sessions' || section.id === 'groups' || section.id === 'discover') {
                        switchMobileTab(section.id as 'sessions' | 'groups' | 'discover')
                        return
                      }
                      closeMobileMenu()
                      openDashboardOverlay(section.id as OverlaySectionId)
                    }}
                  >
                    <span>
                      <span className="mobile-menu-label">{section.label}</span>
                      <span className="mobile-menu-copy">{section.description}</span>
                    </span>
                    <span className="mobile-menu-trail">Open</span>
                  </button>
                ))}
              </section>

              <section className="mobile-menu-section">
                <button
                  type="button"
                  className="mobile-menu-item"
                  onClick={() => {
                    closeMobileMenu()
                    openBooksOverlay()
                  }}
                >
                  <span>
                    <span className="mobile-menu-label">Library</span>
                    <span className="mobile-menu-copy">Books and shared materials.</span>
                  </span>
                  <span className="mobile-menu-trail">Open</span>
                </button>
                <button
                  type="button"
                  className="mobile-menu-item"
                  onClick={() => {
                    closeMobileMenu()
                    setCreateOverlayOpen(true)
                  }}
                >
                  <span>
                    <span className="mobile-menu-label">Create</span>
                    <span className="mobile-menu-copy">Start a post, task, or lesson action.</span>
                  </span>
                  <span className="mobile-menu-trail">New</span>
                </button>
                <button
                  type="button"
                  className="mobile-menu-item"
                  onClick={() => {
                    closeMobileMenu()
                    openNotificationsOverlay()
                  }}
                >
                  <span>
                    <span className="mobile-menu-label">Alerts</span>
                    <span className="mobile-menu-copy">Notifications and updates.</span>
                  </span>
                  <span className="mobile-menu-trail">{unreadNotificationsCount > 0 ? (unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount) : 'Open'}</span>
                </button>
                <button
                  type="button"
                  className="mobile-menu-item"
                  onClick={() => {
                    closeMobileMenu()
                    void router.push('/profile')
                  }}
                >
                  <span>
                    <span className="mobile-menu-label">Profile</span>
                    <span className="mobile-menu-copy">Your account and public profile.</span>
                  </span>
                  <span className="mobile-menu-trail">Open</span>
                </button>
                {isAdmin && mobileAdminSections.map(section => (
                  <button
                    key={section.id}
                    type="button"
                    className="mobile-menu-item"
                    onClick={() => {
                      closeMobileMenu()
                      openDashboardOverlay(section.id as OverlaySectionId)
                    }}
                  >
                    <span>
                      <span className="mobile-menu-label">{section.label}</span>
                      <span className="mobile-menu-copy">{section.description}</span>
                    </span>
                    <span className="mobile-menu-trail">Open</span>
                  </button>
                ))}
                {isAdmin && (
                  <button
                    type="button"
                    className="mobile-menu-item"
                    onClick={() => {
                      closeMobileMenu()
                      void router.push('/resource-bank')
                    }}
                  >
                    <span>
                      <span className="mobile-menu-label">Resource Bank</span>
                      <span className="mobile-menu-copy">Shared uploads and materials.</span>
                    </span>
                    <span className="mobile-menu-trail">Open</span>
                  </button>
                )}
              </section>

              {status === 'authenticated' && (
                <section className="mobile-menu-section">
                  <button
                    type="button"
                    className="mobile-menu-item mobile-menu-item-danger"
                    onClick={() => {
                      closeMobileMenu()
                      void signOut({ callbackUrl: '/' })
                    }}
                  >
                    <span>
                      <span className="mobile-menu-label">Sign out</span>
                      <span className="mobile-menu-copy">Leave this workspace.</span>
                    </span>
                    <span className="mobile-menu-trail">Exit</span>
                  </button>
                </section>
              )}
            </div>
          </FullScreenGlassOverlay>
        )}
      </div>
    )
  }

  return (
    <>
      <main
        ref={dashboardMainRef}
        className={
          isMobile
            ? 'mobile-dashboard-theme mobile-dashboard-edge relative overflow-x-hidden min-h-[100dvh]'
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
      <div
        className={
          isMobile
            ? 'relative z-10 w-full px-0 flex flex-col'
            : 'max-w-6xl mx-auto px-4 lg:px-8 py-8 space-y-6'
        }
      >
        {isMobile ? (
          renderMobileFeedShell()
        ) : (
          <>
            {renderDesktopFeedShell()}
          </>
        )}
      </div>

      {postSolvePreviewOverlay ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[74] flex justify-center px-3 pb-3 sm:px-5 sm:pb-5">
          <div className="pointer-events-auto flex w-full max-w-3xl items-center justify-between gap-3 rounded-[24px] border border-black/10 bg-white/96 px-4 py-3 shadow-[0_18px_40px_rgba(15,23,42,0.16)] backdrop-blur-xl">
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              onClick={closePostSolvePreview}
              disabled={postSolveSubmitting}
            >
              Back to response
            </button>
            <button
              type="button"
              className="inline-flex h-11 items-center justify-center rounded-full bg-[#1877f2] px-5 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(24,119,242,0.28)] transition hover:bg-[#176ad8] disabled:cursor-not-allowed disabled:opacity-55"
              onClick={() => void submitPostSolve(postSolvePreviewOverlay.draftScene)}
              disabled={postSolveSubmitting}
            >
              {postSolveSubmitting ? 'Posting...' : 'Post solution'}
            </button>
          </div>
        </div>
      ) : null}

      {booksOverlayOpen && (
        <FullScreenGlassOverlay
          title="Books & materials"
          subtitle={selectedGrade ? gradeToLabel(selectedGrade) : 'Select a grade'}
          onClose={() => setBooksOverlayOpen(false)}
          onBackdropClick={() => setBooksOverlayOpen(false)}
          zIndexClassName="z-50"
          variant={isMobile ? 'light' : undefined}
          panelClassName={isMobile ? 'bg-[#f0f2f5]' : undefined}
          contentClassName={isMobile ? 'p-0' : undefined}
          hideHeader={isMobile}
          rightActions={
            <button
              type="button"
              className="btn btn-ghost text-xs"
              onClick={() => {
                void fetchBooksForGrade()
                void fetchLibraryGrades()
                if (canManageAnnouncements) {
                  void fetchManualAssessments()
                  if (selectedManualAssessmentId) {
                    void fetchManualMarksheet(selectedManualAssessmentId)
                  }
                }
              }}
              disabled={booksLoading || libraryGradesLoading || manualAssessmentsLoading || manualMarksheetLoading}
            >
              {booksLoading || libraryGradesLoading || manualAssessmentsLoading || manualMarksheetLoading ? 'Loading...' : 'Refresh'}
            </button>
          }
        >
          {isMobile ? (
            renderStudentSurfaceFrame(
              'books',
              <div>
                <section className="border-b border-black/10 bg-white px-4 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#65676b]">Grades</div>
                  {libraryGradesError ? <div className="mt-2 text-sm text-red-600">{libraryGradesError}</div> : null}
                  {libraryGradesLoading ? <div className="mt-2 text-sm text-[#65676b]">Loading grades...</div> : null}
                  {!libraryGradesLoading && !libraryGradesError && libraryGrades.length === 0 ? (
                    <div className="mt-2 text-sm text-[#65676b]">No grades posted yet.</div>
                  ) : null}
                  {libraryGrades.length > 0 ? (
                    <ul className="mt-3 space-y-3">
                      {libraryGrades.map((item) => (
                        <li key={item.id} className="rounded-2xl border border-black/10 bg-[#f8fafc] p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-[#111827] break-words">{item.assessmentTitle}</div>
                              <div className="mt-1 text-xs text-[#65676b]">{getLibraryGradeSourceLabel(item.sourceType)}</div>
                            </div>
                            <div className="text-right shrink-0">
                              {(() => {
                                const fraction = parseScoreFraction(item)
                                if (!fraction) {
                                  return (
                                    <>
                                      <div className="text-sm font-semibold text-[#0f172a]">{item.scoreLabel}</div>
                                      {formatPercentageLabel(item.percentage) ? <div className="text-xs text-[#65676b]">{formatPercentageLabel(item.percentage)}</div> : null}
                                    </>
                                  )
                                }
                                return (
                                  <div className="flex flex-col items-center">
                                    <div className="h-20 w-20 rounded-full border-2 border-[#1d4ed8]/55 bg-white shadow-sm flex flex-col items-center justify-center">
                                      <div className="text-[18px] font-bold leading-none text-[#0f172a]">{fraction.top}</div>
                                      <div className="my-1 h-px w-8 bg-[#334155]/70" />
                                      <div className="text-[14px] font-semibold leading-none text-[#334155]">{fraction.bottom}</div>
                                    </div>
                                    <div className="mt-1 text-[10px] font-medium text-[#475569]">{getGradeSignature(item.graderSignature)}</div>
                                    {formatPercentageLabel(item.percentage) ? <div className="text-[11px] text-[#64748b]">{formatPercentageLabel(item.percentage)}</div> : null}
                                  </div>
                                )
                              })()}
                            </div>
                          </div>
                          {item.feedback ? <div className="mt-2 text-xs text-[#475569] whitespace-pre-wrap break-words">{item.feedback}</div> : null}
                          {item.screenshotUrl ? (
                            <div className="mt-3 overflow-hidden rounded-xl border border-black/10 bg-white">
                              <button
                                type="button"
                                className="block w-full cursor-zoom-in"
                                onClick={() => openGradeScreenshotViewer(item.screenshotUrl || '', `${item.assessmentTitle} screenshot`)}
                              >
                                <img src={item.screenshotUrl} alt={`${item.assessmentTitle} screenshot`} className="max-h-64 w-full object-contain" />
                              </button>
                            </div>
                          ) : null}
                          {item.responseId ? (
                            <div className="mt-2">
                              <button
                                type="button"
                                className="inline-flex h-8 items-center justify-center rounded-full border border-black/15 bg-white px-3 text-[11px] font-semibold text-[#1d4ed8]"
                                onClick={() => void openGradeDetail(item)}
                              >
                                View details
                              </button>
                            </div>
                          ) : null}
                          <div className="mt-2 text-[11px] text-[#64748b]">{new Date(item.gradedAt).toLocaleString()}</div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>

                {canManageAnnouncements ? (
                  <section className="border-b border-black/10 bg-white px-4 py-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#65676b]">Assessment Marksheet</div>
                    <div className="mt-3 grid gap-2">
                      <div className="grid gap-2 rounded-2xl border border-black/10 bg-[#f8fafc] p-3">
                        <div className="text-xs font-semibold text-[#334155]">
                          {manualAssessmentEditingId ? 'Edit Assessment' : 'Create Assessment'} ({selectedGrade ? gradeToLabel(selectedGrade) : 'No grade selected'})
                        </div>
                        <input
                          className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm"
                          placeholder="Assessment name"
                          value={manualAssessmentTitleDraft}
                          onChange={(e) => setManualAssessmentTitleDraft(e.target.value)}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm"
                            placeholder="Subject"
                            value={manualAssessmentSubjectDraft}
                            onChange={(e) => setManualAssessmentSubjectDraft(e.target.value)}
                          />
                          <input
                            className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm"
                            placeholder="Term"
                            value={manualAssessmentTermDraft}
                            onChange={(e) => setManualAssessmentTermDraft(e.target.value)}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm"
                            placeholder="Date"
                            value={manualAssessmentDateDraft}
                            onChange={(e) => setManualAssessmentDateDraft(e.target.value)}
                          />
                          <input
                            className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm"
                            placeholder="Max marks"
                            value={manualAssessmentMaxMarksDraft}
                            onChange={(e) => setManualAssessmentMaxMarksDraft(e.target.value)}
                          />
                        </div>
                        <textarea
                          className="min-h-[64px] rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                          placeholder="Optional description"
                          value={manualAssessmentDescriptionDraft}
                          onChange={(e) => setManualAssessmentDescriptionDraft(e.target.value)}
                        />
                        {manualAssessmentCreateError ? <div className="text-xs text-red-600">{manualAssessmentCreateError}</div> : null}
                        {manualAssessmentCreateSuccess ? <div className="text-xs text-emerald-700">{manualAssessmentCreateSuccess}</div> : null}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="inline-flex h-10 items-center justify-center rounded-xl bg-[#1877f2] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-55"
                            onClick={() => void createManualAssessment()}
                            disabled={manualAssessmentCreating || !selectedGrade}
                          >
                            {manualAssessmentCreating
                              ? (manualAssessmentEditingId ? 'Saving...' : 'Creating...')
                              : (manualAssessmentEditingId ? 'Save changes' : 'Create assessment')}
                          </button>
                          {manualAssessmentEditingId ? (
                            <button
                              type="button"
                              className="inline-flex h-10 items-center justify-center rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-[#334155]"
                              onClick={cancelManualAssessmentEditing}
                              disabled={manualAssessmentCreating}
                            >
                              Cancel
                            </button>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid gap-2 rounded-2xl border border-black/10 bg-[#f8fafc] p-3">
                        <div className="text-xs font-semibold text-[#334155]">Open Marksheet</div>
                        {manualAssessmentsError ? <div className="text-xs text-red-600">{manualAssessmentsError}</div> : null}
                        <select
                          className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm"
                          value={selectedManualAssessmentId || ''}
                          onChange={(e) => setSelectedManualAssessmentId(e.target.value || null)}
                        >
                          <option value="">Select assessment</option>
                          {manualAssessments.map((item) => (
                            <option key={item.id} value={item.id}>{item.title}</option>
                          ))}
                        </select>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="inline-flex h-9 items-center justify-center rounded-xl border border-black/10 bg-white px-3 text-xs font-semibold text-[#111827] disabled:opacity-50"
                            onClick={beginEditSelectedManualAssessment}
                            disabled={!selectedManualAssessmentId || manualAssessmentUpdating || manualAssessmentDeleting}
                          >
                            {manualAssessmentUpdating ? 'Updating...' : 'Edit test'}
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-9 items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 disabled:opacity-50"
                            onClick={() => void deleteSelectedManualAssessment()}
                            disabled={!selectedManualAssessmentId || manualAssessmentUpdating || manualAssessmentDeleting}
                          >
                            {manualAssessmentDeleting ? 'Deleting...' : 'Delete test'}
                          </button>
                        </div>
                        {selectedManualAssessment?.maxMarks != null ? (
                          <div className="text-[11px] text-[#475569]">Total marks: {selectedManualAssessment.maxMarks}</div>
                        ) : null}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <input
                          className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm"
                          placeholder="Search learner by name"
                          value={manualMarksheetSearch}
                          onChange={(e) => setManualMarksheetSearch(e.target.value)}
                        />
                      </div>
                      {manualMarksheetError ? <div className="text-xs text-red-600">{manualMarksheetError}</div> : null}
                      {manualMarksheetLoading ? <div className="text-sm text-[#64748b]">Loading marksheet...</div> : null}
                      {selectedManualAssessmentId && !manualMarksheetLoading ? (
                        <div className="max-h-[380px] space-y-2 overflow-y-auto rounded-2xl border border-black/10 bg-[#f8fafc] p-2">
                          {visibleManualMarksheetRows.map((row) => {
                            const draft = manualMarksheetDraftByUserId[row.userId] || {
                              scoreLabel: row.scoreLabel || '',
                              percentage: typeof row.percentage === 'number' ? String(row.percentage) : '',
                              notes: row.notes || '',
                              screenshotUrls: row.screenshotUrls?.length ? row.screenshotUrls : (row.screenshotUrl ? [row.screenshotUrl] : []),
                            }
                            const isSaving = manualMarksheetSavingUserId === row.userId
                            return (
                              <div key={row.userId} className="rounded-xl border border-black/10 bg-white p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-xs font-semibold text-[#334155]">{row.number}. {row.surname}, {row.givenName || row.fullName}</div>
                                  <div className="text-[11px] text-[#64748b]">{row.gradedAt ? new Date(row.gradedAt).toLocaleDateString() : 'Not marked'}</div>
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                  <input
                                    className="h-9 rounded-lg border border-black/10 bg-white px-2 text-sm"
                                    placeholder="Score"
                                    value={draft.scoreLabel}
                                    onChange={(e) => setManualMarksheetDraftByUserId((prev) => ({
                                      ...prev,
                                      [row.userId]: {
                                        ...draft,
                                        scoreLabel: e.target.value,
                                        percentage: derivePercentageFromScore(e.target.value, selectedManualAssessment?.maxMarks),
                                      },
                                    }))}
                                  />
                                  <input
                                    className="h-9 rounded-lg border border-black/10 bg-[#f1f5f9] px-2 text-sm"
                                    placeholder="Auto %"
                                    value={(() => {
                                      const pct = derivePercentageFromScore(draft.scoreLabel, selectedManualAssessment?.maxMarks) || draft.percentage
                                      return pct ? `${pct}%` : ''
                                    })()}
                                    readOnly
                                  />
                                </div>
                                <textarea
                                  className="mt-2 min-h-[56px] w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-sm"
                                  placeholder="Notes"
                                  value={draft.notes}
                                  onChange={(e) => setManualMarksheetDraftByUserId((prev) => ({
                                    ...prev,
                                    [row.userId]: { ...draft, notes: e.target.value },
                                  }))}
                                />
                                <div className="mt-2 flex items-center gap-2">
                                  <ScriptPhotosEditor
                                    urls={draft.screenshotUrls}
                                    onChange={makeManualMarksheetPhotosChange(row.userId)}
                                    disabled={isSaving}
                                  />
                                  <button
                                    type="button"
                                    className="ml-auto inline-flex h-8 items-center justify-center rounded-full bg-[#1877f2] px-3 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-55"
                                    onClick={() => void saveManualMarksheetRow(row.userId)}
                                    disabled={isSaving}
                                  >
                                    {isSaving ? 'Saving...' : 'Save'}
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                {booksError ? <section className="border-b border-black/10 bg-white px-4 py-4 text-sm text-red-600">{booksError}</section> : null}
                {booksLoading ? <section className="border-b border-black/10 bg-white px-4 py-4 text-sm text-[#65676b]">Loading...</section> : null}
                {!booksLoading && !booksError && booksItems.length === 0 ? (
                  <section className="border-b border-black/10 bg-white px-4 py-4 text-sm text-[#65676b]">No materials available yet.</section>
                ) : null}

                {booksItems.length > 0 ? (
                  <ul>
                    {booksItems.map((item) => {
                      const savedOffline = item.url ? isDocSavedOffline(item.url) : false
                      const savingOffline = item.url ? offlineDocSavingUrls.includes(item.url) : false
                      const offlineError = item.url ? offlineDocErrorByUrl[item.url] : ''
                      return (
                        <li
                          key={item.id}
                          className="border-b border-black/10 bg-white px-4 py-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              {isPdfResource(item) ? (
                                <button
                                  type="button"
                                  className="block text-left text-[15px] font-semibold text-[#111827] hover:underline whitespace-normal break-words"
                                  onClick={() => openPdfViewer(item)}
                                >
                                  {item.title}
                                </button>
                              ) : (
                                <a
                                  href={item.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block text-[15px] font-semibold text-[#111827] hover:underline whitespace-normal break-words"
                                >
                                  {item.title}
                                </a>
                              )}
                              <div className="mt-1 text-xs text-[#65676b]">
                                {item.tag ? `${item.tag} - ` : ''}
                                {gradeToLabel(item.grade)}
                              </div>
                              {offlineError ? <div className="mt-2 text-xs text-amber-700">{offlineError}</div> : null}
                            </div>
                            {item.url ? (
                              <div className="flex items-center gap-2">
                                {savedOffline ? (
                                  <button
                                    type="button"
                                    className="inline-flex h-9 items-center justify-center rounded-full border border-[#d5def0] bg-[#f7f8fa] px-3 text-xs font-medium text-[#1c1e21]"
                                    onClick={() => void removeDocOffline(item)}
                                  >
                                    Remove offline
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="inline-flex h-9 items-center justify-center rounded-full border border-[#d5def0] bg-[#f7f8fa] px-3 text-xs font-medium text-[#1c1e21]"
                                    onClick={() => void saveDocOffline(item)}
                                    disabled={savingOffline}
                                  >
                                    {savingOffline ? 'Saving...' : 'Save offline'}
                                  </button>
                                )}
                              </div>
                            ) : null}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </div>
            )
          ) : (
            <div className="space-y-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-xs uppercase tracking-wide text-white/70">Grades</div>
                {libraryGradesError ? <div className="mt-2 text-sm text-red-200">{libraryGradesError}</div> : null}
                {libraryGradesLoading ? <div className="mt-2 text-sm muted">Loading grades...</div> : null}
                {!libraryGradesLoading && !libraryGradesError && libraryGrades.length === 0 ? (
                  <div className="mt-2 text-sm muted">No grades posted yet.</div>
                ) : null}
                {libraryGrades.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {libraryGrades.map((item) => (
                      <li key={item.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium text-white break-words">{item.assessmentTitle}</div>
                            <div className="text-xs muted">{getLibraryGradeSourceLabel(item.sourceType)}</div>
                          </div>
                          <div className="text-right shrink-0">
                            {(() => {
                              const fraction = parseScoreFraction(item)
                              if (!fraction) {
                                return (
                                  <>
                                    <div className="font-semibold text-white">{item.scoreLabel}</div>
                                    {formatPercentageLabel(item.percentage) ? <div className="text-xs muted">{formatPercentageLabel(item.percentage)}</div> : null}
                                  </>
                                )
                              }
                              return (
                                <div className="flex flex-col items-center">
                                  <div className="h-20 w-20 rounded-full border-2 border-[#9cc1ff]/55 bg-black/25 shadow-sm flex flex-col items-center justify-center">
                                    <div className="text-[18px] font-bold leading-none text-white">{fraction.top}</div>
                                    <div className="my-1 h-px w-8 bg-white/70" />
                                    <div className="text-[14px] font-semibold leading-none text-white/90">{fraction.bottom}</div>
                                  </div>
                                  <div className="mt-1 text-[10px] font-medium text-white/75">{getGradeSignature(item.graderSignature)}</div>
                                  {formatPercentageLabel(item.percentage) ? <div className="text-[11px] text-white/70">{formatPercentageLabel(item.percentage)}</div> : null}
                                </div>
                              )
                            })()}
                          </div>
                        </div>
                        {item.feedback ? <div className="mt-2 text-xs text-white/80 whitespace-pre-wrap break-words">{item.feedback}</div> : null}
                        {item.screenshotUrl ? (
                          <div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-black/20">
                            <button
                              type="button"
                              className="block w-full cursor-zoom-in"
                              onClick={() => openGradeScreenshotViewer(item.screenshotUrl || '', `${item.assessmentTitle} screenshot`)}
                            >
                              <img src={item.screenshotUrl} alt={`${item.assessmentTitle} screenshot`} className="max-h-72 w-full object-contain" />
                            </button>
                          </div>
                        ) : null}
                        {item.responseId ? (
                          <div className="mt-2">
                            <button
                              type="button"
                              className="inline-flex h-8 items-center justify-center rounded-full border border-white/20 bg-white/10 px-3 text-[11px] font-semibold text-[#9cc1ff] hover:bg-white/15"
                              onClick={() => void openGradeDetail(item)}
                            >
                              View details
                            </button>
                          </div>
                        ) : null}
                        <div className="mt-2 text-[11px] text-white/50">{new Date(item.gradedAt).toLocaleString()}</div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              {canManageAnnouncements ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="text-xs uppercase tracking-wide text-white/70">Assessment Marksheet</div>
                  <div className="mt-3 grid gap-2">
                    <div className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-3">
                      <div className="text-xs font-semibold text-white/80">
                        {manualAssessmentEditingId ? 'Edit Assessment' : 'Create Assessment'} ({selectedGrade ? gradeToLabel(selectedGrade) : 'No grade selected'})
                      </div>
                      <input
                        className="h-10 rounded-xl border border-white/20 bg-black/20 px-3 text-sm text-white placeholder:text-white/45"
                        placeholder="Assessment name"
                        value={manualAssessmentTitleDraft}
                        onChange={(e) => setManualAssessmentTitleDraft(e.target.value)}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          className="h-10 rounded-xl border border-white/20 bg-black/20 px-3 text-sm text-white placeholder:text-white/45"
                          placeholder="Subject"
                          value={manualAssessmentSubjectDraft}
                          onChange={(e) => setManualAssessmentSubjectDraft(e.target.value)}
                        />
                        <input
                          className="h-10 rounded-xl border border-white/20 bg-black/20 px-3 text-sm text-white placeholder:text-white/45"
                          placeholder="Term"
                          value={manualAssessmentTermDraft}
                          onChange={(e) => setManualAssessmentTermDraft(e.target.value)}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          className="h-10 rounded-xl border border-white/20 bg-black/20 px-3 text-sm text-white placeholder:text-white/45"
                          placeholder="Date"
                          value={manualAssessmentDateDraft}
                          onChange={(e) => setManualAssessmentDateDraft(e.target.value)}
                        />
                        <input
                          className="h-10 rounded-xl border border-white/20 bg-black/20 px-3 text-sm text-white placeholder:text-white/45"
                          placeholder="Max marks"
                          value={manualAssessmentMaxMarksDraft}
                          onChange={(e) => setManualAssessmentMaxMarksDraft(e.target.value)}
                        />
                      </div>
                      <textarea
                        className="min-h-[64px] rounded-xl border border-white/20 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-white/45"
                        placeholder="Optional description"
                        value={manualAssessmentDescriptionDraft}
                        onChange={(e) => setManualAssessmentDescriptionDraft(e.target.value)}
                      />
                      {manualAssessmentCreateError ? <div className="text-xs text-red-200">{manualAssessmentCreateError}</div> : null}
                      {manualAssessmentCreateSuccess ? <div className="text-xs text-emerald-200">{manualAssessmentCreateSuccess}</div> : null}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="btn btn-primary text-xs"
                          onClick={() => void createManualAssessment()}
                          disabled={manualAssessmentCreating || !selectedGrade}
                        >
                          {manualAssessmentCreating
                            ? (manualAssessmentEditingId ? 'Saving...' : 'Creating...')
                            : (manualAssessmentEditingId ? 'Save changes' : 'Create assessment')}
                        </button>
                        {manualAssessmentEditingId ? (
                          <button
                            type="button"
                            className="btn btn-ghost text-xs"
                            onClick={cancelManualAssessmentEditing}
                            disabled={manualAssessmentCreating}
                          >
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-3">
                      <div className="text-xs font-semibold text-white/80">Open Marksheet</div>
                      {manualAssessmentsError ? <div className="text-xs text-red-200">{manualAssessmentsError}</div> : null}
                      <select
                        className="h-10 rounded-xl border border-white/20 bg-black/20 px-3 text-sm text-white"
                        value={selectedManualAssessmentId || ''}
                        onChange={(e) => setSelectedManualAssessmentId(e.target.value || null)}
                      >
                        <option value="">Select assessment</option>
                        {manualAssessments.map((item) => (
                          <option key={item.id} value={item.id}>{item.title}</option>
                        ))}
                      </select>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="btn btn-ghost text-xs disabled:opacity-50"
                          onClick={beginEditSelectedManualAssessment}
                          disabled={!selectedManualAssessmentId || manualAssessmentUpdating || manualAssessmentDeleting}
                        >
                          {manualAssessmentUpdating ? 'Updating...' : 'Edit test'}
                        </button>
                        <button
                          type="button"
                          className="text-xs font-semibold rounded-xl border border-red-300/50 bg-red-500/10 text-red-200 px-3 h-9 disabled:opacity-50"
                          onClick={() => void deleteSelectedManualAssessment()}
                          disabled={!selectedManualAssessmentId || manualAssessmentUpdating || manualAssessmentDeleting}
                        >
                          {manualAssessmentDeleting ? 'Deleting...' : 'Delete test'}
                        </button>
                      </div>
                      {selectedManualAssessment?.maxMarks != null ? (
                        <div className="text-[11px] text-white/60">Total marks: {selectedManualAssessment.maxMarks}</div>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className="h-10 rounded-xl border border-white/20 bg-black/20 px-3 text-sm text-white placeholder:text-white/45"
                        placeholder="Search learner by name"
                        value={manualMarksheetSearch}
                        onChange={(e) => setManualMarksheetSearch(e.target.value)}
                      />
                    </div>
                    {manualMarksheetError ? <div className="text-xs text-red-200">{manualMarksheetError}</div> : null}
                    {manualMarksheetLoading ? <div className="text-sm muted">Loading marksheet...</div> : null}
                    {selectedManualAssessmentId && !manualMarksheetLoading ? (
                      <div className="max-h-[420px] space-y-2 overflow-y-auto rounded-2xl border border-white/10 bg-black/20 p-2">
                        {visibleManualMarksheetRows.map((row) => {
                          const draft = manualMarksheetDraftByUserId[row.userId] || {
                            scoreLabel: row.scoreLabel || '',
                            percentage: typeof row.percentage === 'number' ? String(row.percentage) : '',
                            notes: row.notes || '',
                            screenshotUrls: row.screenshotUrls?.length ? row.screenshotUrls : (row.screenshotUrl ? [row.screenshotUrl] : []),
                          }
                          const isSaving = manualMarksheetSavingUserId === row.userId
                          return (
                            <div key={row.userId} className="rounded-xl border border-white/10 bg-white/5 p-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs font-semibold text-white/85">{row.number}. {row.surname}, {row.givenName || row.fullName}</div>
                                <div className="text-[11px] text-white/50">{row.gradedAt ? new Date(row.gradedAt).toLocaleDateString() : 'Not marked'}</div>
                              </div>
                              <div className="mt-2 grid grid-cols-2 gap-2">
                                <input
                                  className="h-9 rounded-lg border border-white/20 bg-black/20 px-2 text-sm text-white placeholder:text-white/45"
                                  placeholder="Score"
                                  value={draft.scoreLabel}
                                  onChange={(e) => setManualMarksheetDraftByUserId((prev) => ({
                                    ...prev,
                                    [row.userId]: {
                                      ...draft,
                                      scoreLabel: e.target.value,
                                      percentage: derivePercentageFromScore(e.target.value, selectedManualAssessment?.maxMarks),
                                    },
                                  }))}
                                />
                                <input
                                  className="h-9 rounded-lg border border-white/20 bg-black/35 px-2 text-sm text-white placeholder:text-white/45"
                                  placeholder="Auto %"
                                  value={(() => {
                                    const pct = derivePercentageFromScore(draft.scoreLabel, selectedManualAssessment?.maxMarks) || draft.percentage
                                    return pct ? `${pct}%` : ''
                                  })()}
                                  readOnly
                                />
                              </div>
                              <textarea
                                className="mt-2 min-h-[56px] w-full rounded-lg border border-white/20 bg-black/20 px-2 py-1 text-sm text-white placeholder:text-white/45"
                                placeholder="Notes"
                                value={draft.notes}
                                onChange={(e) => setManualMarksheetDraftByUserId((prev) => ({
                                  ...prev,
                                  [row.userId]: { ...draft, notes: e.target.value },
                                }))}
                              />
                              <div className="mt-2 flex items-center gap-2">
                                <ScriptPhotosEditor
                                  urls={draft.screenshotUrls}
                                  onChange={makeManualMarksheetPhotosChange(row.userId)}
                                  disabled={isSaving}
                                  darkMode
                                />
                                <button
                                  type="button"
                                  className="ml-auto inline-flex h-8 items-center justify-center rounded-full bg-[#1877f2] px-3 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-55"
                                  onClick={() => void saveManualMarksheetRow(row.userId)}
                                  disabled={isSaving}
                                >
                                  {isSaving ? 'Saving...' : 'Save'}
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {booksError ? <div className="text-sm text-red-200">{booksError}</div> : null}
              {booksLoading ? <div className="text-sm muted">Loading...</div> : null}
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
                            {item.tag ? `${item.tag} - ` : ''}
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
                                {savingOffline ? 'Saving...' : 'Save offline'}
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
          )}
        </FullScreenGlassOverlay>
      )}

      {pdfViewerOpen ? (
        <PdfViewerOverlay
          open={pdfViewerOpen}
          url={pdfViewerUrl}
          cacheKey={pdfViewerCacheKey || undefined}
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

      <HandwritingNormalizationOverlay
        open={handwritingNormalizationOverlayOpen && isAdmin}
        onClose={() => setHandwritingNormalizationOverlayOpen(false)}
      />

      {createOverlayOpen && (
        <OverlayPortal>
          <FullScreenGlassOverlay
            title={createKind === 'post' ? 'Post' : 'Challenge'}
            onClose={closeCreateOverlay}
            onBackdropClick={closeCreateOverlay}
            zIndexClassName="z-[70]"
            variant="light"
            panelSize="full"
            position="absolute"
            forceHeaderSafeTop
            frameClassName="absolute inset-0 flex items-stretch justify-center p-0"
            panelClassName="!h-full !max-h-none !max-w-none !rounded-none border-none bg-white"
            className="[&>.philani-overlay-backdrop]:!bg-white [&>.philani-overlay-backdrop]:!backdrop-blur-none"
            contentClassName="p-0 flex flex-col overflow-hidden"
          >
            <div className="p-0 overflow-hidden flex flex-col flex-1 min-h-0 bg-white text-[#1c1e21]">
              <input
                ref={challengeUploadInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => void onChallengeFilePicked(e)}
              />

              <div className="px-0 py-4 sm:px-1 sm:py-5">
                <div className="flex items-start gap-3">
                  {learnerAvatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={learnerAvatarUrl}
                      alt=""
                      className="h-10 w-10 rounded-full object-cover border border-black/10 bg-white shrink-0"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-white border border-black/10 flex items-center justify-center text-sm font-semibold text-[#1c1e21] shrink-0">
                      {String(session?.user?.name || session?.user?.email || 'P')[0]?.toUpperCase?.() || 'P'}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-700 font-semibold">{createKind === 'post' ? 'Share a post' : 'Post a challenge'}</div>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3">
                  <input
                    className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-[#1c1e21] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/25"
                    placeholder="Title (optional)"
                    value={challengeTitleDraft}
                    onChange={(e) => setChallengeTitleDraft(e.target.value)}
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-slate-600">
                        <path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      <span className="text-xs text-slate-500">Type</span>
                      <select
                        className="bg-transparent text-sm text-[#1c1e21] focus:outline-none"
                        value={createKind}
                        onChange={(e) => setCreateKind(e.target.value as any)}
                      >
                        <option value="post">Post</option>
                        <option value="quiz">Quiz</option>
                      </select>
                    </div>

                    {createKind === 'quiz' ? (
                    <div className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-slate-600">
                        <path d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.364-6.364-2.121 2.121M7.757 16.243l-2.121 2.121m12.728 0-2.121-2.121M7.757 7.757 5.636 5.636" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      <span className="text-xs text-slate-500">Max attempts</span>
                      <select
                        className="bg-transparent text-sm text-[#1c1e21] focus:outline-none"
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
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-0 flex-1 min-h-0">
                <div className="rounded-none border-t border-black/10 bg-white px-0 py-4 sm:px-1 sm:py-5 flex flex-col flex-1 min-h-0 overflow-hidden">
                  <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto">
                    <textarea
                      className="w-full min-h-[160px] resize-none bg-transparent text-[15px] leading-relaxed text-[#1c1e21] placeholder:text-slate-500 focus:outline-none"
                      placeholder={createKind === 'post' ? 'Share what you are working on, stuck on, or proud of... or attach a screenshot below' : 'Write the question (LaTeX supported)... or attach a screenshot below'}
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
                  <div className="rounded-none border-t border-black/10 bg-[#eef2f7] px-0 py-3 sm:px-1 sm:py-4">
                    <pre className="whitespace-pre-wrap text-xs text-slate-700">{challengeParsedJsonText}</pre>
                  </div>
                ) : null}
              </div>

              <div className="border-t border-black/10 px-0 py-3 sm:px-1 sm:py-4 flex items-center justify-between gap-3 min-w-0 bg-white">
                <div className="flex items-center gap-2 min-w-0 overflow-x-auto">
                  <button
                    type="button"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    onClick={() => challengeUploadInputRef.current?.click()}
                    disabled={challengeUploading}
                    aria-label={challengeUploading ? 'Uploading screenshot' : 'Upload screenshot'}
                    title={challengeUploading ? 'Uploading...' : 'Upload screenshot'}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M4 7a2 2 0 0 1 2-2h2l1-1h6l1 1h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="2" />
                      <path d="M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="2" />
                    </svg>
                  </button>

                  <label className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-sm text-slate-700 select-none">
                    <input
                      type="checkbox"
                      checked={challengeParseOnUpload}
                      onChange={(e) => setChallengeParseOnUpload(e.target.checked)}
                    />
                    Parse
                  </label>

                  <button
                    type="button"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
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
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
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
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-slate-700 hover:bg-slate-50"
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
                      <div className="absolute right-0 bottom-full mb-2 w-48 rounded-2xl border border-black/10 bg-white shadow-[0_20px_40px_rgba(15,23,42,0.15)] overflow-hidden">
                        <button
                          type="button"
                          className={`w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50 ${challengeAudienceDraft === 'public' ? 'bg-slate-50' : ''}`}
                          onClick={() => {
                            setChallengeAudienceDraft('public')
                            setChallengeAudiencePickerOpen(false)
                          }}
                        >
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-slate-50 text-slate-700">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" stroke="currentColor" strokeWidth="2" />
                              <path d="M2 12h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              <path d="M12 2c3.5 3.2 3.5 16.8 0 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              <path d="M12 2c-3.5 3.2-3.5 16.8 0 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          </span>
                          <span className="text-slate-700">Public</span>
                        </button>

                        <button
                          type="button"
                          className={`w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50 ${challengeAudienceDraft === 'grade' ? 'bg-slate-50' : ''}`}
                          onClick={() => {
                            setChallengeAudienceDraft('grade')
                            setChallengeAudiencePickerOpen(false)
                          }}
                        >
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-slate-50 text-slate-700">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path d="M16 11c1.66 0 3-1.34 3-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3Z" stroke="currentColor" strokeWidth="2" />
                              <path d="M8 11c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Z" stroke="currentColor" strokeWidth="2" />
                              <path d="M8 13c-2.76 0-5 1.79-5 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              <path d="M16 13c2.76 0 5 1.79 5 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4Z" stroke="currentColor" strokeWidth="2" />
                              <path d="M12 14c-3.31 0-6 2.01-6 4.5V21h12v-2.5c0-2.49-2.69-4.5-6-4.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                            </svg>
                          </span>
                          <span className="text-slate-700">My grade</span>
                        </button>

                        <button
                          type="button"
                          className={`w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50 ${challengeAudienceDraft === 'private' ? 'bg-slate-50' : ''}`}
                          onClick={() => {
                            setChallengeAudienceDraft('private')
                            setChallengeAudiencePickerOpen(false)
                          }}
                        >
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-slate-50 text-slate-700">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path d="M7 11V8a5 5 0 0 1 10 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              <path d="M6 11h12v10H6V11Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                              <path d="M12 15v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          </span>
                          <span className="text-slate-700">Private</span>
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
                    {challengePosting ? ((editingChallengeId || editingPostId) ? 'Saving...' : 'Posting...') : ((editingChallengeId || editingPostId) ? 'Save' : 'Post')}
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

      {postToolsSheetOpen && (
        <BottomSheet
          open
          backdrop
          title="Your posts"
          subtitle="Create and manage your challenge posts"
          onClose={() => setPostToolsSheetOpen(false)}
          className="rounded-2xl"
          style={{ bottom: 80 }}
        >
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50"
              onClick={() => {
                setPostToolsSheetOpen(false)
                setTimelineOpen(true)
              }}
            >
              <span>
                <span className="block text-sm font-semibold text-slate-900">My posts</span>
                <span className="block text-xs text-slate-500">Open your full post manager, including edit and delete tools.</span>
              </span>
              <span className="text-slate-400">{'>'}</span>
            </button>

            <button
              type="button"
              className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50"
              onClick={() => {
                setPostToolsSheetOpen(false)
                setCreateKind('post')
                openCreateChallengeComposer()
              }}
            >
              <span>
                <span className="block text-sm font-semibold text-slate-900">Create post</span>
                <span className="block text-xs text-slate-500">Start a new text or image post for the public feed.</span>
              </span>
              <span className="text-slate-400">{'>'}</span>
            </button>

            <button
              type="button"
              className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50"
              onClick={() => {
                setPostToolsSheetOpen(false)
                setCreateKind('post')
                openCreateChallengeScreenshotPicker()
              }}
            >
              <span>
                <span className="block text-sm font-semibold text-slate-900">Post from screenshot</span>
                <span className="block text-xs text-slate-500">Upload a screenshot and turn it into a post or a quiz.</span>
              </span>
              <span className="text-slate-400">{'>'}</span>
            </button>

            {(challengeTitleDraft.trim() || challengePromptDraft.trim() || challengeImageUrl) ? (
              <button
                type="button"
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50"
                onClick={() => {
                  setPostToolsSheetOpen(false)
                  setCreateOverlayOpen(true)
                }}
              >
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{(editingChallengeId || editingPostId) ? 'Continue editing' : 'Continue draft'}</span>
                  <span className="block text-xs text-slate-500">Resume the composer with your current content.</span>
                </span>
                <span className="text-slate-400">{'>'}</span>
              </button>
            ) : null}
          </div>
        </BottomSheet>
      )}

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
                <div className="text-sm text-white/70">Loading...</div>
              ) : timelineChallenges.length === 0 ? (
                <div className="text-sm text-white/70">No posts yet.</div>
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
          variant={studentQuickOverlay === 'timeline' || studentQuickOverlay === 'admin' ? undefined : 'light'}
          panelClassName={studentQuickOverlay === 'timeline' || studentQuickOverlay === 'admin' ? undefined : 'bg-[#f0f2f5]'}
          contentClassName={studentQuickOverlay === 'timeline' || studentQuickOverlay === 'admin' ? undefined : 'p-0'}
          hideHeader={studentQuickOverlay !== 'timeline' && studentQuickOverlay !== 'admin'}
        >
          <div className="space-y-3">
            {studentQuickOverlay === 'timeline'
              ? renderTimelineCard()
              : studentQuickOverlay === 'admin'
                ? renderAdminToolsQuickPanel()
                : renderStudentSurfaceSection(studentQuickOverlay)}
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
          variant="light"
          panelClassName="bg-[#f0f2f5]"
          contentClassName="p-0"
          hideHeader
        >
          {renderStudentSurfaceSection('sessions')}
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
                  canOrchestrateLesson={isOwnerUser}
                />
              )}
              {activeSessionId && (
                <TextOverlayModule
                  boardId={String(activeSessionId)}
                  gradeLabel={selectedGrade ? activeGradeLabel : null}
                  userId={realtimeUserId}
                  userDisplayName={realtimeDisplayName}
                  canOrchestrateLesson={isOwnerUser}
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
                {liveWindows.map(win => {
                  const windowRoleProfile = win.roleProfileOverride ?? currentLessonRoleProfile
                  const windowHasTeacherPrivileges = windowRoleProfile.capabilities.canOrchestrateLesson

                  return (
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
                      onToggleTeacherAudio={
                        win.kind === 'canvas' && !windowHasTeacherPrivileges
                          ? handleToggleLiveTeacherAudio
                          : undefined
                      }
                      teacherAudioEnabled={
                        win.kind === 'canvas' && !windowHasTeacherPrivileges
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
                        win.kind === 'canvas' && !windowHasTeacherPrivileges
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
                          canOrchestrateLesson={windowHasTeacherPrivileges}
                          roleProfile={windowRoleProfile}
                          quizMode={Boolean(win.quizMode)}
                          isVisible={!win.minimized}
                          defaultOrientation="portrait"
                          autoOpenDiagramTray={Boolean(win.autoOpenDiagramTray)}
                          lessonAuthoring={win.lessonAuthoring}
                          onOverlayChromeVisibilityChange={setLiveOverlayChromeVisible}
                        />
                      )}
                    </LiveOverlayWindow>
                  )
                })}
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
                canOrchestrateLesson={isTeacherOrAdminUser}
                roleProfile={currentLessonRoleProfile}
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
                  x
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
                          {challengeDeleting ? 'Working...' : selectedChallengeData ? 'Ready' : 'Loading...'}
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
                          {challengeSubmissionsLoading ? 'Refreshing...' : 'Refresh'}
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
                                  {row?.submissions ? ` - ${row.submissions} submission${row.submissions > 1 ? 's' : ''}` : ''}
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
                          <div className="text-sm muted">Loading responses...</div>
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
                                    {resp?.excalidrawScene ? (
                                      <PublicSolveCanvasViewer scene={resp.excalidrawScene} className="mt-2" emptyLabel="No canvas submitted yet." />
                                    ) : null}
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
                                        if (resp?.excalidrawScene) return null
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
                                            <span role="img" aria-hidden="true">X</span>
                                          </button>
                                          <button
                                            type="button"
                                            className={pill(selected === 'dot-green')}
                                            onClick={() => selectGrade('dot-green')}
                                            aria-pressed={selected === 'dot-green'}
                                            aria-label="Green dot"
                                            title="Correct (0 marks)"
                                          >
                                            <span role="img" aria-hidden="true">o</span>
                                          </button>
                                          <button
                                            type="button"
                                            className={pill(selected === 'cross')}
                                            onClick={() => selectGrade('cross')}
                                            aria-pressed={selected === 'cross'}
                                            aria-label="Red cross"
                                            title="Incorrect (significant)"
                                          >
                                            <span role="img" aria-hidden="true">X</span>
                                          </button>
                                          <button
                                            type="button"
                                            className={pill(selected === 'dot-red')}
                                            onClick={() => selectGrade('dot-red')}
                                            aria-pressed={selected === 'dot-red'}
                                            aria-label="Red dot"
                                            title="Incorrect (insignificant)"
                                          >
                                            <span role="img" aria-hidden="true">o</span>
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
                              {challengeGradingSaving ? 'Saving...' : 'Save grading'}
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
            subtitle="Solutions thread"
            zIndexClassName="z-[55]"
            onClose={closeChallengeResponseOverlay}
            leftActions={
              <button
                type="button"
                className="btn btn-ghost"
                onClick={closeChallengeResponseOverlay}
              >
                Back
              </button>
            }
            rightActions={(() => {
              const maxAttempts = typeof (challengeResponseChallenge as any)?.maxAttempts === 'number' ? (challengeResponseChallenge as any).maxAttempts : null
              const attemptsOpen = (challengeResponseChallenge as any)?.attemptsOpen !== false
              const myAttemptCount = typeof (challengeResponseChallenge as any)?.myAttemptCount === 'number'
                ? (challengeResponseChallenge as any).myAttemptCount
                : challengeOwnResponses.length
              const canAttempt = attemptsOpen && (maxAttempts === null || myAttemptCount < maxAttempts)
              if (!canAttempt || !selectedChallengeResponseId) return null
              return (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    const targetId = String(selectedChallengeResponseId)
                    closeChallengeResponseOverlay()
                    void router.push(`/challenges/${encodeURIComponent(targetId)}`)
                  }}
                >
                  {challengeOwnResponses.length > 0 ? 'Attempt again' : 'Attempt'}
                </button>
              )
            })()}
          >
            <div className="space-y-3">
              {challengeResponseError ? <div className="text-sm text-red-600">{challengeResponseError}</div> : null}
              {challengeResponseLoading ? (
                <div className="text-sm muted">Loading solutions...</div>
              ) : (
                <>
                  {challengeResponseChallenge?.prompt ? (
                    <div className="border border-white/10 rounded bg-white/5 p-3">
                      <div className="text-sm whitespace-pre-wrap break-words">
                        {renderTextWithKatex(String(challengeResponseChallenge.prompt || ''))}
                      </div>
                    </div>
                  ) : null}

                  {(challengeResponseChallenge as any)?.imageUrl ? (
                    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                      <img src={String((challengeResponseChallenge as any).imageUrl)} alt="Challenge attachment" className="max-h-[320px] w-full object-contain" />
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/75">
                    <div>
                      {canViewChallengeThread
                        ? `${challengeThreadResponses.length} ${challengeThreadResponses.length === 1 ? 'solution' : 'solutions'} in this thread`
                        : 'Submit your own solution to unlock the shared thread.'}
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost text-xs"
                      disabled={challengeResponseLoading}
                      onClick={() => fetchChallengeResponseThread(String(selectedChallengeResponseId))}
                    >
                      Refresh
                    </button>
                  </div>

                  {!canViewChallengeThread ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-white/70">
                      Submit your own solution first, or wait for the challenge owner to reveal solutions, and this thread will fill with other learners' work.
                    </div>
                  ) : challengeThreadResponses.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-white/70">
                      No solutions yet.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {challengeThreadResponses.map((resp: any, idx: number) => {
                        const responseUserName = String(resp?.user?.name || resp?.userName || resp?.user?.email || 'Learner')
                        const responseUserId = resp?.user?.id ? String(resp.user.id) : (resp?.userId ? String(resp.userId) : null)
                        const responseCreatedAt = resp?.updatedAt || resp?.createdAt
                        const isMine = String(resp?.userId || resp?.user?.id || '') === String(currentUserId || viewerId || '')
                        const latex = String(resp?.latex || '')
                        const html = latex.trim() ? renderKatexDisplayHtml(latex) : ''
                        const steps = splitLatexIntoSteps(latex)
                        const grade = normalizeChallengeGrade(resp?.gradingJson, steps.length)
                        return (
                          <div key={String(resp?.id || idx)} className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <UserLink userId={responseUserId} className="text-sm font-semibold text-white hover:underline" title="View profile">
                                    {responseUserName}
                                  </UserLink>
                                  {isMine ? <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/75">You</span> : null}
                                </div>
                                {responseCreatedAt ? <div className="text-xs text-white/55">{formatFeedPostDate(responseCreatedAt)}</div> : null}
                                {isMine && resp?.excalidrawScene ? (
                                  <div className="mt-1 text-[11px] font-medium text-white/55">
                                    {interactiveViewportErrorByResponseId[String(resp?.id || '')]
                                      || (interactiveViewportSavingByResponseId[String(resp?.id || '')] ? 'Saving view...' : 'Pan or zoom to adjust the shared view.')}
                                  </div>
                                ) : null}
                              </div>
                              {isMine && selectedChallengeResponseId && ((challengeResponseChallenge as any)?.attemptsOpen !== false) ? (
                                <button
                                  type="button"
                                  className="btn btn-ghost text-xs"
                                  onClick={() => {
                                    const targetId = String(selectedChallengeResponseId)
                                    closeChallengeResponseOverlay()
                                    void router.push(`/challenges/${encodeURIComponent(targetId)}`)
                                  }}
                                >
                                  Edit
                                </button>
                              ) : null}
                            </div>

                            {String(resp?.studentText || '').trim() ? (
                              <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-sm whitespace-pre-wrap break-words text-white/85">
                                {String(resp.studentText)}
                              </div>
                            ) : null}

                            {latex.trim() ? (
                              html ? (
                                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
                              ) : (
                                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm whitespace-pre-wrap break-words text-white/85">
                                  {renderTextWithKatex(latex)}
                                </div>
                              )
                            ) : null}

                            {resp?.excalidrawScene ? (
                              <PublicSolveCanvasViewer
                                scene={resp.excalidrawScene}
                                onViewportChange={isMine && resp?.id
                                  ? (scene) => queueInteractiveViewportSave(`challenge:${String(selectedChallengeResponseId || '')}`, String(resp.id), scene)
                                  : undefined}
                              />
                            ) : null}

                            {grade || String(resp?.feedback || '').trim() ? (
                              <div className="rounded-xl border border-emerald-300/20 bg-emerald-500/10 px-3 py-3 space-y-1">
                                {grade ? (
                                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">
                                    Grade: {grade.earnedMarks}/{grade.totalMarks}
                                  </div>
                                ) : null}
                                {String(resp?.feedback || '').trim() ? (
                                  <div className="text-sm whitespace-pre-wrap break-words text-emerald-50/90">
                                    {String(resp.feedback)}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </FullScreenGlassOverlay>
        </OverlayPortal>
      )}

      {lessonSolveOverlay && (
        <OverlayPortal>
          <div
            className="fixed inset-0 z-[68] bg-[rgba(2,6,23,0.58)] backdrop-blur-sm p-2 sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Lesson solve canvas"
          >
            <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-[32px] border border-white/15 bg-white shadow-[0_30px_80px_rgba(2,6,23,0.32)]">
              <PublicSolveComposer
                title={lessonSolveOverlay.title}
                prompt={lessonSolveOverlay.prompt}
                imageUrl={lessonSolveOverlay.imageUrl || null}
                initialScene={lessonSolveOverlay.initialScene || null}
                submitting={lessonSolveSubmitting}
                onCancel={() => {
                  if (lessonSolveSubmitting) return
                  setLessonSolveOverlay(null)
                  setLessonSolveError(null)
                }}
                onSubmit={submitLessonSolve}
              />
            </div>
            {lessonSolveError ? (
              <div className="pointer-events-none absolute left-4 right-4 top-4 z-[69] mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50/95 px-4 py-3 text-sm font-medium text-red-700 shadow-[0_18px_40px_rgba(220,38,38,0.12)] backdrop-blur-xl">
                {lessonSolveError}
              </div>
            ) : null}
          </div>
        </OverlayPortal>
      )}

      {postSolveOverlay && (
        <OverlayPortal>
          <div
            className="fixed inset-0 z-[68] bg-[rgba(2,6,23,0.58)] backdrop-blur-sm p-2 sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Post solve canvas"
          >
            <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-[32px] border border-white/15 bg-white shadow-[0_30px_80px_rgba(2,6,23,0.32)]">
              <PublicSolveComposer
                title={postSolveOverlay.title}
                prompt={postSolveOverlay.prompt}
                imageUrl={postSolveOverlay.imageUrl || null}
                authorName={postSolveOverlay.authorName || null}
                authorAvatarUrl={postSolveOverlay.authorAvatarUrl || null}
                initialScene={postSolveOverlay.initialScene || null}
                submitting={postSolveSubmitting}
                onCancel={() => {
                  if (postSolveSubmitting) return
                  setPostSolvePreviewOverlay(null)
                  setPostSolveOverlay(null)
                  setPostSolveError(null)
                }}
                onSubmit={submitPostSolve}
              />
            </div>
            {postSolveError ? (
              <div className="pointer-events-none absolute left-4 right-4 top-4 z-[69] mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50/95 px-4 py-3 text-sm font-medium text-red-700 shadow-[0_18px_40px_rgba(220,38,38,0.12)] backdrop-blur-xl">
                {postSolveError}
              </div>
            ) : null}
          </div>
        </OverlayPortal>
      )}

      {postThreadOverlay && (
        <OverlayPortal>
          <FullScreenGlassOverlay
            title={postThreadOverlay.title || 'Solutions'}
            subtitle="Public solutions thread"
            zIndexClassName="z-[67]"
            onClose={() => {
              setPostThreadOverlay(null)
              setPostThreadError(null)
              setPostThreadResponses([])
            }}
            onBackdropClick={() => {
              setPostThreadOverlay(null)
              setPostThreadError(null)
              setPostThreadResponses([])
            }}
            rightActions={
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const ownResponse = postThreadResponses.find((response: any) => String(response?.userId || '') === String(currentUserId || viewerId || ''))
                  void openPostSolveComposer(postThreadOverlay, { initialScene: ownResponse?.excalidrawScene || null })
                }}
              >
                {postThreadResponses.some((response: any) => String(response?.userId || '') === String(currentUserId || viewerId || '')) ? 'Edit solution' : 'Share solution'}
              </button>
            }
          >
            <div className="space-y-4">
              {postThreadOverlay.prompt ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
                  {postThreadOverlay.prompt}
                </div>
              ) : null}
              {postThreadOverlay.imageUrl ? (
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                  <img src={postThreadOverlay.imageUrl} alt="Post attachment" className="max-h-[320px] w-full object-contain" />
                </div>
              ) : null}
              {postThreadError ? (
                <div className="rounded-2xl border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{postThreadError}</div>
              ) : postThreadLoading ? (
                <div className="text-sm text-white/70">Loading solutions...</div>
              ) : postThreadResponses.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-white/70">No solutions yet.</div>
              ) : (
                <div className="space-y-3">
                  {postThreadResponses.map((response: any) => {
                    const responseUserName = String(response?.user?.name || response?.user?.email || 'Learner')
                    const responseUserId = response?.user?.id ? String(response.user.id) : null
                    const responseCreatedAt = response?.updatedAt || response?.createdAt
                    const isMine = String(response?.userId || '') === String(currentUserId || viewerId || '')
                    return (
                      <div key={String(response?.id || Math.random())} className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <UserLink userId={responseUserId} className="text-sm font-semibold text-white hover:underline" title="View profile">
                              {responseUserName}
                            </UserLink>
                            {responseCreatedAt ? <div className="text-xs text-white/55">{formatFeedPostDate(responseCreatedAt)}</div> : null}
                            {isMine && response?.excalidrawScene ? (
                              <div className="mt-1 text-[11px] font-medium text-white/55">
                                {interactiveViewportErrorByResponseId[String(response?.id || '')]
                                  || (interactiveViewportSavingByResponseId[String(response?.id || '')] ? 'Saving view...' : 'Pan or zoom to adjust the shared view.')}
                              </div>
                            ) : null}
                          </div>
                          {isMine ? (
                            <button
                              type="button"
                              className="btn btn-ghost text-xs"
                              onClick={() => void openPostSolveComposer(postThreadOverlay, { initialScene: response?.excalidrawScene || null })}
                            >
                              Edit
                            </button>
                          ) : null}
                        </div>
                        {response?.excalidrawScene ? (
                          <PublicSolveCanvasViewer
                            scene={response.excalidrawScene}
                            onViewportChange={isMine && response?.id
                              ? (scene) => queueInteractiveViewportSave(String(postThreadOverlay?.threadKey || ''), String(response.id), scene)
                              : undefined}
                          />
                        ) : (
                          <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-sm text-white/70">No canvas attached.</div>
                        )}
                      </div>
                    )
                  })}
                </div>
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
                  {selectedUserDetail.firstName || selectedUserDetail.name || '-'} {selectedUserDetail.lastName || ''}
                </div>
                <div className="text-sm text-white/80">Email</div>
                <div className="font-medium">{selectedUserDetail.email}</div>
                <div className="text-sm text-white/80">Grade</div>
                <div>{selectedUserDetail.grade ? gradeToLabel(selectedUserDetail.grade) : 'Unassigned'}</div>
                <div className="text-sm text-white/80">School</div>
                <div>{selectedUserDetail.schoolName || '-'}</div>
                <div className="text-sm text-white/80">Joined</div>
                <div>{selectedUserDetail.createdAt ? new Date(selectedUserDetail.createdAt).toLocaleString() : '-'}</div>
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
                    {userDetailLoading ? 'Working...' : 'Skip verification'}
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
                  {userDetailLoading ? 'Generating...' : 'Generate password'}
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
  const chMobile = String(context?.req?.headers?.['sec-ch-ua-mobile'] ?? '')
  const ua = String(context?.req?.headers?.['user-agent'] ?? '')
  const initialIsMobile = chMobile === '?1'
    ? true
    : chMobile === '?0'
      ? false
      : /Android|iPhone|iPad|iPod|Mobile|Windows Phone|Opera Mini|IEMobile/i.test(ua)
  return { props: { session, initialIsMobile } }
}

