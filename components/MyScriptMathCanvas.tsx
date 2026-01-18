import { CSSProperties, Ref, useCallback, useEffect, useMemo, useRef, useState, useImperativeHandle } from 'react'
import { renderToString } from 'katex'

const PHILANI_ERASER_POINTER_TYPE = 'eraser'

function installIinkEraserPointerTypeShim(editor: any, isEraserActive: () => boolean): boolean {
  if (!editor || typeof editor !== 'object') return false

  const tryInstallOn = (candidate: any): boolean => {
    if (!candidate || typeof candidate !== 'object') return false
    if ((candidate as any).__philaniEraserShimInstalled) return true
    if (typeof candidate.onPointerDown !== 'function') return false
    if (typeof candidate.onPointerMove !== 'function') return false
    if (typeof candidate.onPointerUp !== 'function') return false
    // Heuristic: the capture layer object also has an attach() method.
    if (typeof candidate.attach !== 'function') return false

    const originalDown = candidate.onPointerDown.bind(candidate)
    const originalMove = candidate.onPointerMove.bind(candidate)
    const originalUp = candidate.onPointerUp.bind(candidate)

    candidate.onPointerDown = (info: any) => {
      const next = (isEraserActive() && info && typeof info === 'object')
        ? { ...info, pointerType: PHILANI_ERASER_POINTER_TYPE }
        : info
      return originalDown(next)
    }
    candidate.onPointerMove = (info: any) => {
      const next = (isEraserActive() && info && typeof info === 'object')
        ? { ...info, pointerType: PHILANI_ERASER_POINTER_TYPE }
        : info
      return originalMove(next)
    }
    candidate.onPointerUp = (info: any) => {
      const next = (isEraserActive() && info && typeof info === 'object')
        ? { ...info, pointerType: PHILANI_ERASER_POINTER_TYPE }
        : info
      return originalUp(next)
    }

    try {
      ;(candidate as any).__philaniEraserShimInstalled = true
    } catch {}
    return true
  }

  // Fast path: most builds expose a pointer event capture object directly.
  const directCandidates: any[] = [
    (editor as any).pointerEvents,
    (editor as any).pointerEvent,
    (editor as any)._pointerEvents,
    (editor as any).pointerEventCapture,
    (editor as any).pointerCapture,
    (editor as any).recognizer?.pointerEvents,
    (editor as any).recognizer?.pointerEvent,
  ].filter(Boolean)
  for (const c of directCandidates) {
    if (tryInstallOn(c)) return true
  }

  // Best-effort shallow scan of the editor object graph.
  try {
    const visited = new Set<any>()
    const queue: Array<{ value: any; depth: number }> = [{ value: editor, depth: 0 }]

    while (queue.length) {
      const { value, depth } = queue.shift()!
      if (!value || typeof value !== 'object') continue
      if (visited.has(value)) continue
      visited.add(value)

      if (tryInstallOn(value)) return true
      if (depth >= 2) continue

      const keys = Object.getOwnPropertyNames(value)
      for (const k of keys) {
        if (k === '__proto__') continue
        let child: any = null
        try {
          child = (value as any)[k]
        } catch {
          child = null
        }
        if (child && typeof child === 'object' && !visited.has(child)) {
          queue.push({ value: child, depth: depth + 1 })
        }
      }
    }
  } catch {}

  return false
}

const SCRIPT_ID = 'myscript-iink-ts-loader'
const SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/iink-ts@3.0.2/dist/iink.min.js'
const SCRIPT_FALLBACK_URL = 'https://unpkg.com/iink-ts@3.0.2/dist/iink.min.js'
let scriptPromise: Promise<void> | null = null

declare global {
  interface Window {
    iink?: {
      Editor: {
        load: (element: HTMLElement, editorType: string, options?: unknown) => Promise<any>
      }
    }
  }
}

function loadIinkRuntime(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('MyScript iink runtime can only load in a browser context.'))
  }

  const hasValidRuntime = () => Boolean(window.iink?.Editor?.load)

  if (hasValidRuntime()) {
    return Promise.resolve()
  }

  if (window.iink && !hasValidRuntime()) {
    try {
      ;(window as any).iink = undefined
    } catch {}
  }

  if (scriptPromise) {
    return scriptPromise
  }

  const loadScript = (id: string, src: string) =>
    new Promise<void>((resolve, reject) => {
      const existing = document.getElementById(id) as HTMLScriptElement | null

      const handleLoad = () => {
        resolve()
      }

      const handleError = () => {
        console.error('Failed to load MyScript iink script from', src)
        reject(new Error('Failed to load the MyScript iink runtime.'))
      }

      if (existing) {
        if (existing.getAttribute('data-loaded') === 'true' && hasValidRuntime()) {
          resolve()
          return
        }
        existing.remove()
      }

      const script = document.createElement('script')
      script.id = id
      script.src = src
      script.async = true
      script.defer = true
      script.crossOrigin = 'anonymous'
      script.addEventListener(
        'load',
        () => {
          script.setAttribute('data-loaded', 'true')
          resolve()
        },
        { once: true }
      )
      script.addEventListener('error', handleError, { once: true })
      document.head.appendChild(script)
    })

  scriptPromise = (async () => {
    let lastError: unknown = null

    const tryLoad = async (id: string, src: string) => {
      try {
        await loadScript(id, src)
        return true
      } catch (err) {
        lastError = err
        document.getElementById(id)?.remove()
        return false
      }
    }

    const primaryOk = await tryLoad(SCRIPT_ID, SCRIPT_URL)

    if (!window.iink?.Editor?.load) {
      console.warn('Primary MyScript CDN did not expose the expected API, retrying pinned fallback.')
      await tryLoad(`${SCRIPT_ID}-fallback`, SCRIPT_FALLBACK_URL)
    }

    if (!window.iink?.Editor?.load) {
      if (lastError instanceof Error) {
        throw lastError
      }
      throw new Error('MyScript iink runtime did not expose the expected API.')
    }
  })()
    .catch(err => {
      scriptPromise = null
      throw err
    })
    .then(() => {
      scriptPromise = null
    })

  return scriptPromise ?? Promise.resolve()
}

type CanvasStatus = 'idle' | 'loading' | 'ready' | 'error'

type SnapshotPayload = {
  symbols: any[] | null
  latex?: string
  jiix?: string | null
  version: number
  snapshotId: string
  baseSymbolCount?: number
}

type SnapshotRecord = {
  snapshot: SnapshotPayload
  ts: number
  reason: 'update' | 'clear'
}

type SnapshotMessage = {
  clientId?: string
  author?: string
  snapshot?: SnapshotPayload | null
  ts?: number
  reason?: 'update' | 'clear'
  originClientId?: string
  targetClientId?: string
}

type PresenterSetMessage = {
  clientId?: string
  author?: string
  action: 'presenter-set'
  presenterUserKey?: string | null
  targetClientIds?: string[]
  targetClientId?: string
  ts?: number
}

type SharedPageMessage = {
  clientId?: string
  author?: string
  action: 'shared-page'
  presenterUserKey?: string | null
  sharedPageIndex?: number
  ts?: number
}

type ControlState = {
  controllerId: string
  controllerName?: string
  ts: number
} | null

type QuizControlMessage = {
  clientId?: string
  author?: string
  action: 'quiz'
  phase: 'active' | 'inactive' | 'submit'
  enabled?: boolean
  preQuizControl?: ControlState
  quizId?: string
  quizLabel?: string
  quizPhaseKey?: string
  quizPointId?: string
  quizPointIndex?: number
  prompt?: string
  durationSec?: number
  endsAt?: number
  combinedLatex?: string
  fromUserId?: string
  fromName?: string
  ts?: number
}

type LatexDisplayOptions = {
  fontScale: number
  textAlign: 'left' | 'center' | 'right'
  alignAtEquals: boolean
}

type TopPanelPayload = {
  latex: string
  options: LatexDisplayOptions
}

type TopPanelStepItem = {
  index: number
  latex: string
}

type TopPanelStepsPayload = {
  steps: TopPanelStepItem[]
  selectedIndex: number | null
  options: LatexDisplayOptions
}

type TopPanelRenderPayload = {
  markup: string
  style: CSSProperties
}

type LatexDisplayState = {
  enabled: boolean
  latex: string
  options: LatexDisplayOptions
}

type StackedNotesState = {
  latex: string
  options: LatexDisplayOptions
  ts: number
}

type CanvasOrientation = 'portrait' | 'landscape'

type PresenceClient = {
  clientId: string
  name?: string
  userId?: string
  isAdmin?: boolean
}

type OverlayControlsHandle = {
  open: () => void
  close: () => void
  toggle: () => void
}

type BroadcastOptions = {
  force?: boolean
  reason?: 'update' | 'clear'
}

type MyScriptMathCanvasProps = {
  gradeLabel?: string
  roomId: string
  userId: string
  userDisplayName?: string
  isAdmin?: boolean
  forceEditable?: boolean
  boardId?: string
  realtimeScopeId?: string
  autoOpenDiagramTray?: boolean
  quizMode?: boolean
  initialQuiz?: {
    quizId: string
    quizLabel?: string
    quizPhaseKey?: string
    quizPointId?: string
    quizPointIndex?: number
    prompt: string
    durationSec?: number | null
    endsAt?: number | null
  }
  assignmentSubmission?: {
    sessionId: string
    assignmentId: string
    questionId: string
    kind?: 'response' | 'solution'
    initialLatex?: string
  }
  uiMode?: 'default' | 'overlay'
  defaultOrientation?: CanvasOrientation
  overlayControlsHandleRef?: Ref<OverlayControlsHandle>
  onOverlayChromeVisibilityChange?: (visible: boolean) => void
  onLatexOutputChange?: (latex: string) => void
  onRequestVideoOverlay?: () => void
  lessonAuthoring?: { phaseKey: string; pointId: string }
}

type LessonScriptPhaseKey = 'engage' | 'explore' | 'explain' | 'elaborate' | 'evaluate'

type LessonScriptV2Module =
  | { type: 'text'; text: string }
  | { type: 'diagram'; title?: string; diagram?: { title: string; imageUrl: string; annotations?: any } }
  | { type: 'latex'; latex: string }

type LessonScriptV2Point = {
  id: string
  title?: string
  modules: LessonScriptV2Module[]
}

type LessonScriptV2Phase = {
  key: LessonScriptPhaseKey
  label?: string
  points: LessonScriptV2Point[]
}

type LessonScriptV2 = {
  schemaVersion: 2
  phases: LessonScriptV2Phase[]
}

type MobileModulePickerType = 'text' | 'diagram' | 'latex'

const LESSON_SCRIPT_PHASES: Array<{ key: LessonScriptPhaseKey; label: string }> = [
  { key: 'engage', label: 'Engage' },
  { key: 'explore', label: 'Explore' },
  { key: 'explain', label: 'Explain' },
  { key: 'elaborate', label: 'Elaborate' },
  { key: 'evaluate', label: 'Evaluate' },
]

const DEFAULT_BROADCAST_DEBOUNCE_MS = 32
const ALL_STUDENTS_ID = 'all-students'
const missingKeyMessage = 'Missing MyScript credentials. Set NEXT_PUBLIC_MYSCRIPT_APPLICATION_KEY and NEXT_PUBLIC_MYSCRIPT_HMAC_KEY.'

// Reserve a small strip above the bottom of the viewport in stacked mobile mode so
// fixed overlays (like the custom scrollbar and quick trays) never cover ink.
const STACKED_BOTTOM_OVERLAY_RESERVE_PX = 28

// Diagrams have been extracted into `DiagramOverlayModule`. Keep the embedded implementation disabled
// to avoid two competing sources of diagram state on the same Ably channel.
const ENABLE_EMBEDDED_DIAGRAMS = false

const sanitizeIdentifier = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60)

const getBroadcastDebounce = () => {
  const parsed = Number(process.env.NEXT_PUBLIC_MYSCRIPT_BROADCAST_DEBOUNCE_MS)
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 500) {
    return parsed
  }
  return DEFAULT_BROADCAST_DEBOUNCE_MS
}

const countSymbols = (source: any): number => {
  if (!source) return 0
  if (Array.isArray(source)) return source.length
  if (Array.isArray(source?.events)) return source.events.length
  return 0
}

const nextAnimationFrame = () =>
  typeof window === 'undefined'
    ? new Promise<void>(resolve => setTimeout(resolve, 16))
    : new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))

const isSnapshotEmpty = (snapshot: SnapshotPayload | null) => {
  if (!snapshot) return true
  const symCount = countSymbols(snapshot.symbols)
  const hasSymbols = symCount > 0
  const hasLatex = Boolean(snapshot.latex)
  const hasJiix = Boolean(snapshot.jiix)
  return !hasSymbols && !hasLatex && !hasJiix
}

const DEFAULT_LATEX_OPTIONS: LatexDisplayOptions = {
  fontScale: 1,
  textAlign: 'center',
  alignAtEquals: false,
}

const sanitizeLatexOptions = (options?: Partial<LatexDisplayOptions>): LatexDisplayOptions => {
  if (!options) return { ...DEFAULT_LATEX_OPTIONS }
  const fontScaleRaw = Number(options.fontScale)
  const fontScale = Number.isFinite(fontScaleRaw) ? Math.min(2, Math.max(0.5, fontScaleRaw)) : DEFAULT_LATEX_OPTIONS.fontScale
  const textAlign = options.textAlign === 'left' || options.textAlign === 'right' ? options.textAlign : 'center'
  const alignAtEquals = Boolean(options.alignAtEquals)
  return {
    fontScale,
    textAlign,
    alignAtEquals,
  }
}

const MyScriptMathCanvas = ({ gradeLabel, roomId, userId, userDisplayName, isAdmin, forceEditable, boardId, realtimeScopeId, autoOpenDiagramTray, quizMode, initialQuiz, assignmentSubmission, uiMode = 'default', defaultOrientation, overlayControlsHandleRef, onOverlayChromeVisibilityChange, onLatexOutputChange, onRequestVideoOverlay, lessonAuthoring }: MyScriptMathCanvasProps) => {
  const isAssignmentSolutionAuthoring = assignmentSubmission?.kind === 'solution'
  const isAssignmentView = Boolean(assignmentSubmission?.assignmentId && assignmentSubmission?.questionId)
  // Assignments & timeline challenges are single-user canvases. They must remain editable for the current
  // learner without requiring presenter/controller allowlisting (which is only for live sessions).
  const forceEditableForAssignment = Boolean(forceEditable) || Boolean((!isAdmin || isAssignmentSolutionAuthoring) && isAssignmentView)
  const editorHostRef = useRef<HTMLDivElement | null>(null)
  const editorInstanceRef = useRef<any>(null)
  const realtimeRef = useRef<any>(null)
  const channelRef = useRef<any>(null)
  const clientIdRef = useRef('')
  const latestSnapshotRef = useRef<SnapshotRecord | null>(null)
  const localVersionRef = useRef(0)
  const appliedVersionRef = useRef(0)
  const lastSymbolCountRef = useRef(0)
  const lastBroadcastBaseCountRef = useRef(0)
  const pendingBroadcastRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingExportRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const studentQuizPreviewExportRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const studentQuizPreviewExportInFlightRef = useRef(false)
  const isApplyingRemoteRef = useRef(false)
  const lastAppliedRemoteVersionRef = useRef(0)
  const suppressBroadcastUntilTsRef = useRef(0)
  const appliedSnapshotIdsRef = useRef<Set<string>>(new Set())
  const lastGlobalUpdateTsRef = useRef(0)
  const [status, setStatus] = useState<CanvasStatus>('idle')
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [transientError, setTransientError] = useState<string | null>(null)
  const [editorReinitNonce, setEditorReinitNonce] = useState(0)
  const [editorReconnecting, setEditorReconnecting] = useState(false)
  const suppressNextLoadingOverlayRef = useRef(false)
  const editorReconnectingRef = useRef(false)
  const [latexOutput, setLatexOutput] = useState('')
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [canClear, setCanClear] = useState(false)
  const [isConverting, setIsConverting] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [hasMounted, setHasMounted] = useState(false)
  const [viewportBottomOffsetPx, setViewportBottomOffsetPx] = useState(0)

  const [isEraserMode, setIsEraserMode] = useState(false)
  const isEraserModeRef = useRef(false)
  useEffect(() => {
    isEraserModeRef.current = isEraserMode
  }, [isEraserMode])
  const [eraserShimReady, setEraserShimReady] = useState(false)
  const eraserLongPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const eraserLongPressTriggeredRef = useRef(false)

  const initialOrientation: CanvasOrientation = defaultOrientation || (isAdmin ? 'landscape' : 'portrait')
  const [canvasOrientation, setCanvasOrientation] = useState<CanvasOrientation>(initialOrientation)
  const isOverlayMode = uiMode === 'overlay'
  const [isCompactViewport, setIsCompactViewport] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return Boolean(window.matchMedia('(max-width: 768px)').matches)
  })

  useEffect(() => {
    if (typeof onLatexOutputChange !== 'function') return
    onLatexOutputChange(latexOutput)
  }, [latexOutput, onLatexOutputChange])

  const isStudentView = !isAdmin
  const isQuizMode = Boolean(quizMode)
  const isChallengeBoard = useMemo(
    () => typeof boardId === 'string' && boardId.startsWith('challenge:'),
    [boardId]
  )
  const isSessionQuizMode = !isAssignmentView && !forceEditableForAssignment && !isChallengeBoard
  const useStackedStudentLayout = isStudentView || (isAdmin && isCompactViewport)
  // Note: `useAdminStepComposer` is defined later once controller/presenter rights are available.

  const [quizSubmitting, setQuizSubmitting] = useState(false)
  const [quizActive, setQuizActive] = useState(false)
  const quizActiveRef = useRef(false)
  const quizBaselineSnapshotRef = useRef<SnapshotPayload | null>(null)
  const quizHasCommittedRef = useRef(false)
  const quizCombinedLatexRef = useRef('')
  const [studentCommittedLatex, setStudentCommittedLatex] = useState('')
  const quizIdRef = useRef<string>('')
  const quizPromptRef = useRef<string>('')
  const quizLabelRef = useRef<string>('')
  const quizPhaseKeyRef = useRef<string>('')
  const quizPointIdRef = useRef<string>('')
  const quizPointIndexRef = useRef<number>(-1)
  const studentQuizTextResponseRef = useRef<string>('')
  const quizEndsAtRef = useRef<number | null>(null)
  const quizDurationSecRef = useRef<number | null>(null)
  const quizAutoSubmitTriggeredRef = useRef(false)
  const quizCountdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [quizTimeLeftSec, setQuizTimeLeftSec] = useState<number | null>(null)
  const initialQuizAppliedRef = useRef<string | null>(null)

  // Student: snapshot the pre-quiz lock/control state so we can restore it after the quiz.
  // This must represent the state BEFORE the teacher unlocks for the quiz.
  const preQuizControlStateRef = useRef<ControlState>(null)
  const preQuizControlCapturedRef = useRef(false)

  // Admin: snapshot pre-quiz state so clicking the quiz icon again (abort) restores everything.
  const adminPreQuizControlStateRef = useRef<ControlState>(null)
  const adminPreQuizControlCapturedRef = useRef(false)

  // Student typed response (from quiz popup in TextOverlayModule)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (event: Event) => {
      const detail = (event as any)?.detail
      const text = typeof detail?.text === 'string' ? detail.text : ''
      studentQuizTextResponseRef.current = text
    }
    window.addEventListener('philani-quiz:text-response', handler as any)
    return () => window.removeEventListener('philani-quiz:text-response', handler as any)
  }, [])

  const clearQuizCountdown = useCallback(() => {
    if (quizCountdownIntervalRef.current) {
      clearInterval(quizCountdownIntervalRef.current)
      quizCountdownIntervalRef.current = null
    }
    quizEndsAtRef.current = null
    quizDurationSecRef.current = null
    quizAutoSubmitTriggeredRef.current = false
    setQuizTimeLeftSec(null)
  }, [])

  const formatCountdown = useCallback((seconds: number | null) => {
    if (seconds == null || !Number.isFinite(seconds)) return ''
    const s = Math.max(0, Math.trunc(seconds))
    const mm = Math.floor(s / 60)
    const ss = s % 60
    return `${mm}:${String(ss).padStart(2, '0')}`
  }, [])

  const playSnapSound = useCallback(() => {
    if (typeof window === 'undefined') return
    try {
      const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext)
      if (!AudioCtx) return
      const ctx = new AudioCtx()
      const now = ctx.currentTime

      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(1400, now)
      osc.frequency.exponentialRampToValueAtTime(260, now + 0.045)

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.28, now + 0.006)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(now)
      osc.stop(now + 0.09)

      const cleanupDelayMs = 180
      window.setTimeout(() => {
        try {
          osc.disconnect()
          gain.disconnect()
        } catch {}
        try {
          ctx.close()
        } catch {}
      }, cleanupDelayMs)
    } catch {
      // ignore
    }
  }, [])

  const requestWindowContext = useCallback(<T,>(opts: {
    requestEvent: string
    responseEvent: string
    timeoutMs?: number
  }): Promise<T | null> => {
    if (typeof window === 'undefined') return Promise.resolve(null)
    const timeoutMs = typeof opts.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs) ? Math.max(60, Math.min(1200, Math.trunc(opts.timeoutMs))) : 260

    let requestId = ''
    try {
      requestId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? (crypto as any).randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    } catch {
      requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    }

    return new Promise<T | null>(resolve => {
      let done = false

      const finish = (value: T | null) => {
        if (done) return
        done = true
        try {
          window.removeEventListener(opts.responseEvent, onResponse as any)
        } catch {}
        resolve(value)
      }

      const onResponse = (event: Event) => {
        const detail = (event as CustomEvent)?.detail as any
        if (!detail || typeof detail !== 'object') return
        if (detail.requestId !== requestId) return
        finish(detail as T)
      }

      window.addEventListener(opts.responseEvent, onResponse as any)
      window.setTimeout(() => finish(null), timeoutMs)
      try {
        window.dispatchEvent(new CustomEvent(opts.requestEvent, { detail: { requestId } }))
      } catch {
        finish(null)
      }
    })
  }, [])

  const buildLessonContextText = useCallback((opts: {
    gradeLabel: string | null
    phaseKey: string
    pointTitle: string
    pointIndex: number | null
    teacherLatexContext: string
    adminStepsLatex: string[]
    adminDraftLatex: string
    textBoxes: Array<{ id: string; text: string }>
    textTimeline?: Array<{ ts: number; kind: string; action: string; boxId?: string; visible?: boolean; textSnippet?: string }>
    diagramSummary: string
    diagramTimeline?: Array<{ ts: number; kind: string; action: string; diagramId?: string; title?: string; imageUrl?: string; strokes?: number; arrows?: number }>
  }) => {
    const lines: string[] = []
    lines.push('Lesson context snapshot (what students have seen):')
    lines.push(`Grade: ${opts.gradeLabel || 'unknown'}`)
    if (opts.phaseKey) lines.push(`Phase: ${opts.phaseKey}`)
    if (typeof opts.pointIndex === 'number') lines.push(`Point: ${opts.pointIndex + 1}${opts.pointTitle ? ` — ${opts.pointTitle}` : ''}`)
    lines.push('')

    const steps = opts.adminStepsLatex.map(s => (s || '').trim()).filter(Boolean)
    const draft = (opts.adminDraftLatex || '').trim()
    const contextLatex = (opts.teacherLatexContext || '').trim()

    if (steps.length || draft || contextLatex) {
      lines.push('Teacher math/notes context (LaTeX):')
      if (steps.length) {
        const tail = steps.slice(Math.max(0, steps.length - 14))
        for (let i = 0; i < tail.length; i += 1) {
          lines.push(`${Math.max(steps.length - tail.length, 0) + i + 1}) ${tail[i]}`)
        }
      }
      if (draft) {
        lines.push(`Draft: ${draft}`)
      }
      if (contextLatex && (!steps.length || contextLatex !== steps[steps.length - 1])) {
        lines.push(`Current: ${contextLatex}`)
      }
      lines.push('')
    }

    if (opts.textBoxes.length) {
      lines.push('Text modules shown (overlay):')
      for (const b of opts.textBoxes.slice(0, 12)) {
        const text = (b.text || '').trim().replace(/\s+/g, ' ')
        if (!text) continue
        lines.push(`- [${b.id}] ${text.slice(0, 240)}`)
      }
      lines.push('')
    }

    if (opts.diagramSummary) {
      lines.push('Diagrams shown:')
      lines.push(opts.diagramSummary)
      lines.push('')
    }

    const textTimeline = Array.isArray(opts.textTimeline) ? opts.textTimeline : []
    const diagramTimeline = Array.isArray(opts.diagramTimeline) ? opts.diagramTimeline : []
    if (textTimeline.length || diagramTimeline.length) {
      type HistoryLine = { ts: number; msg: string }
      const history: HistoryLine[] = []

      const cleanSnippet = (s: unknown, maxLen: number) => {
        const raw = typeof s === 'string' ? s : ''
        const t = raw.trim().replace(/\s+/g, ' ')
        if (!t) return ''
        return t.length > maxLen ? t.slice(0, maxLen) + '…' : t
      }

      for (const e of textTimeline) {
        const ts = typeof (e as any)?.ts === 'number' ? (e as any).ts : NaN
        if (!Number.isFinite(ts)) continue
        const kind = typeof (e as any)?.kind === 'string' ? (e as any).kind : ''
        const action = typeof (e as any)?.action === 'string' ? (e as any).action : ''
        if (!kind || !action) continue

        if (kind === 'overlay-state') {
          history.push({ ts, msg: `Text overlay: ${action}` })
          continue
        }

        if (kind === 'box') {
          const boxId = typeof (e as any)?.boxId === 'string' ? (e as any).boxId : ''
          const snippet = cleanSnippet((e as any)?.textSnippet, 160)
          const vis = typeof (e as any)?.visible === 'boolean' ? (e as any).visible : undefined
          const visLabel = typeof vis === 'boolean' ? (vis ? 'visible' : 'hidden') : ''
          const idLabel = boxId ? ` [${boxId.slice(0, 28)}]` : ''
          const bits = [`Text box ${action}${idLabel}`]
          if (visLabel) bits.push(`(${visLabel})`)
          if (snippet) bits.push(`“${snippet}”`)
          history.push({ ts, msg: bits.join(' ') })
          continue
        }
      }

      for (const e of diagramTimeline) {
        const ts = typeof (e as any)?.ts === 'number' ? (e as any).ts : NaN
        if (!Number.isFinite(ts)) continue
        const kind = typeof (e as any)?.kind === 'string' ? (e as any).kind : ''
        const action = typeof (e as any)?.action === 'string' ? (e as any).action : ''
        if (!kind || !action) continue

        if (kind === 'overlay-state') {
          history.push({ ts, msg: `Diagram overlay: ${action}` })
          continue
        }

        const title = cleanSnippet((e as any)?.title, 80)
        const diagramId = typeof (e as any)?.diagramId === 'string' ? (e as any).diagramId : ''
        const idLabel = diagramId ? ` [${diagramId.slice(0, 24)}]` : ''

        if (kind === 'diagram') {
          const bits = [`Diagram ${action}${idLabel}`]
          if (title) bits.push(`— ${title}`)
          history.push({ ts, msg: bits.join(' ') })
          continue
        }

        if (kind === 'annotations') {
          const strokes = typeof (e as any)?.strokes === 'number' ? (e as any).strokes : undefined
          const arrows = typeof (e as any)?.arrows === 'number' ? (e as any).arrows : undefined
          const bits = [`Diagram annotations ${action}${idLabel}`]
          if (title) bits.push(`— ${title}`)
          const counts = [
            typeof strokes === 'number' ? `strokes=${strokes}` : '',
            typeof arrows === 'number' ? `arrows=${arrows}` : '',
          ].filter(Boolean).join(', ')
          if (counts) bits.push(`(${counts})`)
          history.push({ ts, msg: bits.join(' ') })
          continue
        }
      }

      history.sort((a, b) => a.ts - b.ts)
      const tail = history.slice(Math.max(0, history.length - 60))
      if (tail.length) {
        const baseTs = tail[0].ts
        lines.push('Recent lesson timeline (history, chronological):')
        for (const h of tail) {
          const deltaSec = Math.max(0, Math.round((h.ts - baseTs) / 1000))
          lines.push(`- +${deltaSec}s ${h.msg}`)
        }
        lines.push('')
      }
    }

    const joined = lines.join('\n').trim()
    // Keep within a safe size for the API prompt.
    return joined.length > 12000 ? joined.slice(0, 12000) : joined
  }, [])

  const setQuizActiveState = useCallback((enabled: boolean) => {
    setQuizActive(enabled)
    quizActiveRef.current = enabled
  }, [])

  // Stacked layout controls live in the separator row (no tap-to-reveal).

  const overlayChromeHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const overlayChromeInitialPeekDoneRef = useRef(false)
  const [overlayChromePeekVisible, setOverlayChromePeekVisible] = useState(false)
  const OVERLAY_CHROME_PEEK_MS = 2500
  const clearOverlayChromeAutoHide = useCallback(() => {
    if (overlayChromeHideTimeoutRef.current) {
      clearTimeout(overlayChromeHideTimeoutRef.current)
      overlayChromeHideTimeoutRef.current = null
    }
  }, [])

  const revealOverlayChrome = useCallback(() => {
    if (!onOverlayChromeVisibilityChange) return
    if (!isOverlayMode || !isCompactViewport) return
    setOverlayChromePeekVisible(true)
    onOverlayChromeVisibilityChange(true)
    clearOverlayChromeAutoHide()
    overlayChromeHideTimeoutRef.current = setTimeout(() => {
      setOverlayChromePeekVisible(false)
      onOverlayChromeVisibilityChange(false)
    }, OVERLAY_CHROME_PEEK_MS)
  }, [OVERLAY_CHROME_PEEK_MS, clearOverlayChromeAutoHide, isCompactViewport, isOverlayMode, onOverlayChromeVisibilityChange])

  useEffect(() => {
    if (!onOverlayChromeVisibilityChange) return
    if (!isOverlayMode || !isCompactViewport) return
    if (overlayChromeInitialPeekDoneRef.current) return

    // On first open/refresh in mobile overlay mode, peek the chrome briefly.
    overlayChromeInitialPeekDoneRef.current = true
    setOverlayChromePeekVisible(true)
    onOverlayChromeVisibilityChange(true)
    clearOverlayChromeAutoHide()
    overlayChromeHideTimeoutRef.current = setTimeout(() => {
      setOverlayChromePeekVisible(false)
      onOverlayChromeVisibilityChange(false)
    }, OVERLAY_CHROME_PEEK_MS)
  }, [OVERLAY_CHROME_PEEK_MS, clearOverlayChromeAutoHide, isCompactViewport, isOverlayMode, onOverlayChromeVisibilityChange])

  useEffect(() => {
    if (!isOverlayMode || !isCompactViewport) {
      setOverlayChromePeekVisible(false)
      clearOverlayChromeAutoHide()
    }
  }, [clearOverlayChromeAutoHide, isCompactViewport, isOverlayMode])

  useEffect(() => {
    return () => {
      setOverlayChromePeekVisible(false)
      clearOverlayChromeAutoHide()
    }
  }, [clearOverlayChromeAutoHide])
  // Broadcaster role removed: all clients can publish.
  const [connectedClients, setConnectedClients] = useState<Array<PresenceClient>>([])
  const connectedClientsRef = useRef<Array<PresenceClient>>([])
  useEffect(() => {
    connectedClientsRef.current = connectedClients
  }, [connectedClients])

  // Controller rights allowlist: any clientId in this set is treated as a controller (edit + publish)
  // without requiring them to be assigned as the exclusive controller.
  // Admin UI wiring for toggling this comes later.
  const controllerRightsAllowlistRef = useRef<Set<string>>(new Set())
  // User-key allowlist (preferred): robust across reconnects / multiple clientIds per person.
  // Keys are `uid:<userId>` when available, else `name:<normalized-lowercase-name>`.
  const controllerRightsUserAllowlistRef = useRef<Set<string>>(new Set())
  const [controllerRightsVersion, setControllerRightsVersion] = useState(0)

  const bumpControllerRightsVersion = useCallback(() => {
    setControllerRightsVersion(v => v + 1)
  }, [])

  const normalizeName = useCallback((value: string) => String(value || '').trim().replace(/\s+/g, ' '), [])
  const getUserKey = useCallback((maybeUserId?: string, maybeName?: string) => {
    const uid = typeof maybeUserId === 'string' ? maybeUserId.trim() : ''
    if (uid) return `uid:${uid}`
    const nk = normalizeName(maybeName || '').toLowerCase()
    return nk ? `name:${nk}` : ''
  }, [normalizeName])

  const selfUserKey = useMemo(() => getUserKey(userId, userDisplayName), [getUserKey, userDisplayName, userId])

  // Explicit presenter (exclusive publisher) state.
  // When set, ONLY the presenter is allowed to publish SnapshotPayload (stroke/sync-state).
  // Admin remains connected but is no longer a snapshot publisher.
  const [activePresenterUserKey, setActivePresenterUserKey] = useState<string | null>(null)
  const activePresenterUserKeyRef = useRef<string>('')
  const activePresenterClientIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    activePresenterUserKeyRef.current = activePresenterUserKey ? String(activePresenterUserKey) : ''
  }, [activePresenterUserKey])

  const isSelfActivePresenter = useCallback(() => {
    const activeKey = activePresenterUserKeyRef.current
    if (!activeKey) return false
    if (selfUserKey && activeKey === selfUserKey) return true
    const myId = clientIdRef.current
    if (!myId) return false
    return activePresenterClientIdsRef.current.has(myId)
  }, [selfUserKey])

  const hasControllerRights = useCallback(() => {
    if (isAdmin) return true
    if (selfUserKey && controllerRightsUserAllowlistRef.current.has(selfUserKey)) return true
    const myId = clientIdRef.current
    if (!myId) return false
    // Legacy fallback: clientId-based allowlist.
    return controllerRightsAllowlistRef.current.has(myId)
  }, [isAdmin, selfUserKey])

  // Exclusive snapshot publishing rule:
  // - If a presenter is active, ONLY that presenter may publish SnapshotPayload.
  // - Otherwise fall back to controller-rights (admin + allowlisted presenter(s)).
  const canPublishSnapshots = useCallback(() => {
    const activeKey = activePresenterUserKeyRef.current
    if (activeKey) {
      return isSelfActivePresenter()
    }
    return hasControllerRights()
  }, [hasControllerRights, isSelfActivePresenter])

  // Board write rights (edit UI + mutate local editor state) should follow the same exclusivity
  // as snapshot publishing when a presenter is active.
  const hasBoardWriteRights = useCallback(() => {
    if (forceEditableForAssignment) return true
    if (!isAdmin && isSessionQuizMode && quizActiveRef.current) return true
    const activeKey = activePresenterUserKeyRef.current
    if (activeKey) {
      return isSelfActivePresenter()
    }
    return hasControllerRights()
  }, [forceEditableForAssignment, hasControllerRights, isAdmin, isSelfActivePresenter, isSessionQuizMode])

  const [viewOnlyMode, setViewOnlyMode] = useState(() => !hasBoardWriteRights())

  // Used by consumers when the presenter changes pages.
  const requestSyncFromPublisher = useCallback(async () => {
    const channel = channelRef.current
    if (!channel) return
    try {
      await channel.publish('sync-request', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        ts: Date.now(),
      })
    } catch {}
  }, [userDisplayName])

  const publishSharedPage = useCallback(async (index: number, ts?: number) => {
    if (!canPublishSnapshots()) return
    const channel = channelRef.current
    if (!channel) return
    const safeIndex = Number.isFinite(index) ? Math.max(0, Math.trunc(index)) : 0
    try {
      await channel.publish('control', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        action: 'shared-page',
        presenterUserKey: activePresenterUserKeyRef.current || null,
        sharedPageIndex: safeIndex,
        ts: ts ?? Date.now(),
      } satisfies SharedPageMessage)
    } catch (err) {
      console.warn('Failed to publish shared page index', err)
    }
  }, [canPublishSnapshots, userDisplayName])

  // Step-composer mode is available to the teacher and to any presenter (controller-rights allowlisted user).
  // This powers the multi-step editing UX (commit steps, recall/edit steps, step-boundary undo/redo).
  const useAdminStepComposer = Boolean(
    useStackedStudentLayout
    && hasBoardWriteRights()
    // Do not enable the admin step-composer on single-user canvases (assignments/challenges).
    // Those flows use `studentCommittedLatex` + `latexOutput` and should append steps as new lines.
    && (isAdmin || (!forceEditableForAssignment && !forceEditable))
  )

  const allowStudentTextTray = !isAdmin && (isAssignmentView || isChallengeBoard)
  const useStudentStepComposer = !isAdmin && useStackedStudentLayout && (isAssignmentView || isChallengeBoard)
  const showTextIcon = useAdminStepComposer || useStudentStepComposer || allowStudentTextTray

  const [selectedClientId, setSelectedClientId] = useState<string>('all')
  const [isBroadcastPaused, setIsBroadcastPaused] = useState(false)
  const isBroadcastPausedRef = useRef(false)
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(true)
  const [controlState, setControlState] = useState<ControlState>(null)

  const [overlayRosterVisible, setOverlayRosterVisible] = useState(false)
  const [highlightedController, setHighlightedController] = useState<{ clientId: string; userId?: string; name?: string; ts: number } | null>(null)
  const highlightedControllerRef = useRef<{ clientId: string; userId?: string; name?: string; ts: number } | null>(null)
  useEffect(() => {
    highlightedControllerRef.current = highlightedController
  }, [highlightedController])
  useEffect(() => {
    if (!overlayChromePeekVisible || !isOverlayMode || !isCompactViewport) {
      setOverlayRosterVisible(false)
    }
  }, [isCompactViewport, isOverlayMode, overlayChromePeekVisible])

  const selfBadge = useMemo(() => {
    const resolvedName = (userDisplayName || '').trim() || (isAdmin ? 'Teacher' : 'You')
    const parts = resolvedName.split(/\s+/).filter(Boolean)
    const a = parts[0]?.[0] || (isAdmin ? 'T' : 'U')
    const b = parts.length > 1 ? (parts[1]?.[0] || '') : (parts[0]?.[1] || '')
    const initials = (a + b).toUpperCase()
    return { controllerId: clientIdRef.current || (isAdmin ? 'teacher' : 'self'), name: resolvedName, initials }
  }, [isAdmin, userDisplayName])

  const teacherBadge = useMemo(() => {
    if (isAdmin) return selfBadge
    const teacher = connectedClients.find(c => Boolean((c as any)?.isAdmin))
    const resolvedName = normalizeName((teacher as any)?.name || '') || 'Teacher'
    const parts = resolvedName.split(/\s+/).filter(Boolean)
    const a = parts[0]?.[0] || 'T'
    const b = parts.length > 1 ? (parts[1]?.[0] || '') : (parts[0]?.[1] || '')
    const initials = (a + b).toUpperCase()
    return { controllerId: teacher?.clientId || 'teacher', name: resolvedName, initials }
  }, [connectedClients, isAdmin, normalizeName, selfBadge])

  const editorBadges = useMemo(() => {
    // Build a unique list of non-admin users who currently have controller rights.
    const nameKey = (value: string) => normalizeName(value).toLowerCase()
    const teacherUserId = isAdmin ? String(userId || '') : ''

    const candidates = connectedClients
      .filter(c => c.clientId && c.clientId !== ALL_STUDENTS_ID)
      .map(c => {
        const cUserId = typeof (c as any).userId === 'string' ? String((c as any).userId) : undefined
        const displayName = normalizeName((c as any).name || '') || String(c.clientId)
        const isAdminPresence = Boolean((c as any).isAdmin)
        const key = getUserKey(cUserId, displayName) || `name:${nameKey(displayName)}`
        return { clientId: c.clientId, userId: cUserId, name: displayName, isAdmin: isAdminPresence, userKey: key }
      })
      // Exclude admin/teacher presences.
      .filter(c => !c.isAdmin)
      // Prefer excluding our own admin userId if we are the teacher.
      .filter(c => !(teacherUserId && c.userId && String(c.userId) === teacherUserId))

    // Group by userKey and keep the first representative.
    const byUser = new Map<string, { userKey: string; name: string; clientId: string }>()
    for (const c of candidates) {
      if (!c.userKey) continue
      if (!byUser.has(c.userKey)) {
        byUser.set(c.userKey, { userKey: c.userKey, name: c.name, clientId: c.clientId })
      }
    }

    const result: Array<{ userKey: string; name: string; initials: string; clientId: string }> = []
    for (const entry of byUser.values()) {
      const allowedByUser = controllerRightsUserAllowlistRef.current.has(entry.userKey)
      const allowedByClient = controllerRightsAllowlistRef.current.has(entry.clientId)
      if (!allowedByUser && !allowedByClient) continue
      const parts = entry.name.split(/\s+/).filter(Boolean)
      const a = parts[0]?.[0] || 'E'
      const b = parts.length > 1 ? (parts[1]?.[0] || '') : (parts[0]?.[1] || '')
      result.push({ userKey: entry.userKey, name: entry.name, initials: (a + b).toUpperCase(), clientId: entry.clientId })
    }
    return result
  }, [connectedClients, controllerRightsVersion, getUserKey, isAdmin, normalizeName, userId])

  const currentEditorBadge = useMemo(() => {
    const controllerId = controlState?.controllerId
    if (!controllerId) return isAdmin ? selfBadge : null

    const name = (controlState?.controllerName && typeof controlState.controllerName === 'string')
      ? controlState.controllerName.trim()
      : ''

    const resolvedName = name || (connectedClients.find(c => c.clientId === controllerId)?.name || '').trim() || (controllerId === ALL_STUDENTS_ID ? 'All Students' : 'Editor')

    const initials = (() => {
      if (controllerId === ALL_STUDENTS_ID) return 'AS'
      const parts = resolvedName.split(/\s+/).filter(Boolean)
      const a = parts[0]?.[0] || 'E'
      const b = parts.length > 1 ? (parts[1]?.[0] || '') : (parts[0]?.[1] || '')
      return (a + b).toUpperCase()
    })()

    return { controllerId, name: resolvedName, initials }
  }, [connectedClients, controlState?.controllerId, controlState?.controllerName, isAdmin, selfBadge])
  const [latexDisplayState, setLatexDisplayState] = useState<LatexDisplayState>({ enabled: false, latex: '', options: DEFAULT_LATEX_OPTIONS })
  const [latexProjectionOptions, setLatexProjectionOptions] = useState<LatexDisplayOptions>(DEFAULT_LATEX_OPTIONS)
  const [stackedNotesState, setStackedNotesState] = useState<StackedNotesState>({ latex: '', options: DEFAULT_LATEX_OPTIONS, ts: 0 })

  type AdminStep = { latex: string; symbols: any[] | null }
  const [adminSteps, setAdminSteps] = useState<AdminStep[]>([])
  const [adminDraftLatex, setAdminDraftLatex] = useState('')
  const [adminSendingStep, setAdminSendingStep] = useState(false)
  const [adminEditIndex, setAdminEditIndex] = useState<number | null>(null)
  const adminTopPanelRef = useRef<HTMLDivElement | null>(null)
  const adminLastTapRef = useRef<{ ts: number; y: number } | null>(null)
  const previewExportInFlightRef = useRef(false)

  type StudentStep = { latex: string; symbols: any[] | null }
  const [studentSteps, setStudentSteps] = useState<StudentStep[]>([])
  const [studentEditIndex, setStudentEditIndex] = useState<number | null>(null)

  const [topPanelEditingMode, setTopPanelEditingMode] = useState(false)
  const topPanelEditingModeRef = useRef(false)
  useEffect(() => {
    topPanelEditingModeRef.current = topPanelEditingMode
  }, [topPanelEditingMode])

  const [topPanelSelectedStep, setTopPanelSelectedStep] = useState<number | null>(null)

  // Step navigation redo stack (used when undo/redo crosses between step lines).
  // We represent the draft line as index === adminSteps.length.
  const stepNavRedoStackRef = useRef<number[]>([])

  // Long-press repeat (undo/redo) + long-press hard reset (bin)
  const pressRepeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressRepeatActiveRef = useRef(false)
  const pressRepeatTriggeredRef = useRef(false)
  const pressRepeatPointerIdRef = useRef<number | null>(null)

  const binLongPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const binLongPressTriggeredRef = useRef(false)

  const textIconLastTapRef = useRef<number | null>(null)
  const textIconTapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTopPanelSelection = useCallback(() => {
    setTopPanelSelectedStep(null)
  }, [])

  useEffect(() => {
    if (!initialQuiz) return
    if (isAdmin) return
    if (!isQuizMode) return
    if (!initialQuiz.quizId || !initialQuiz.prompt) return
    if (initialQuizAppliedRef.current === initialQuiz.quizId) return
    initialQuizAppliedRef.current = initialQuiz.quizId

    quizIdRef.current = String(initialQuiz.quizId)
    quizPromptRef.current = String(initialQuiz.prompt)
    quizLabelRef.current = typeof initialQuiz.quizLabel === 'string' ? initialQuiz.quizLabel : ''
    quizPhaseKeyRef.current = typeof initialQuiz.quizPhaseKey === 'string' ? initialQuiz.quizPhaseKey : ''
    quizPointIdRef.current = typeof initialQuiz.quizPointId === 'string' ? initialQuiz.quizPointId : ''
    quizPointIndexRef.current = typeof initialQuiz.quizPointIndex === 'number' && Number.isFinite(initialQuiz.quizPointIndex)
      ? Math.trunc(initialQuiz.quizPointIndex)
      : -1

    const endsAt = typeof initialQuiz.endsAt === 'number' && Number.isFinite(initialQuiz.endsAt) && initialQuiz.endsAt > 0
      ? Math.trunc(initialQuiz.endsAt)
      : null
    const durationSec = typeof initialQuiz.durationSec === 'number' && Number.isFinite(initialQuiz.durationSec) && initialQuiz.durationSec > 0
      ? Math.trunc(initialQuiz.durationSec)
      : null
    quizEndsAtRef.current = endsAt
    quizDurationSecRef.current = durationSec
    quizAutoSubmitTriggeredRef.current = false

    if (quizCountdownIntervalRef.current) {
      clearInterval(quizCountdownIntervalRef.current)
      quizCountdownIntervalRef.current = null
    }

    if (endsAt) {
      const tick = () => {
        const remainingSec = Math.ceil((endsAt - Date.now()) / 1000)
        setQuizTimeLeftSec(Math.max(0, remainingSec))
      }
      tick()
      quizCountdownIntervalRef.current = setInterval(tick, 250)
    } else {
      setQuizTimeLeftSec(null)
    }

    playSnapSound()

    const editor = editorInstanceRef.current
    const baseline = latestSnapshotRef.current?.snapshot ?? captureFullSnapshot()
    quizBaselineSnapshotRef.current = baseline ? { ...baseline, baseSymbolCount: -1 } : null
    quizCombinedLatexRef.current = ''
    quizHasCommittedRef.current = false
    setStudentCommittedLatex('')

    // Assignment editing: if we already have a saved response for this question,
    // preload it into the committed preview so the learner can edit/resubmit.
    const initialAssignmentLatex = (assignmentSubmission?.initialLatex && typeof assignmentSubmission.initialLatex === 'string')
      ? assignmentSubmission.initialLatex.trim()
      : ''
    if (initialAssignmentLatex) {
      quizCombinedLatexRef.current = initialAssignmentLatex
      quizHasCommittedRef.current = true
      setStudentCommittedLatex(initialAssignmentLatex)
      const parsed = String(initialAssignmentLatex || '')
        .split(/\\/g)
        .map(s => s.trim())
        .filter(Boolean)
      setStudentSteps(parsed.map(latex => ({ latex, symbols: null })))
      setStudentEditIndex(null)
      setTopPanelSelectedStep(null)
    } else {
      setStudentSteps([])
      setStudentEditIndex(null)
      setTopPanelSelectedStep(null)
    }
    setQuizActiveState(true)
    suppressBroadcastUntilTsRef.current = Date.now() + 600
    try {
      editor?.clear?.()
    } catch {}
    lastSymbolCountRef.current = 0
    lastBroadcastBaseCountRef.current = 0
    setLatexOutput('')
    // NOTE: `captureFullSnapshot` is defined later in this component; do not reference it in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentSubmission?.initialLatex, initialQuiz, isAdmin, isQuizMode, playSnapSound, setQuizActiveState])

  const loadAdminStepForEditing = useCallback(async (index: number) => {
    if (!useAdminStepComposer) return
    if (index < 0 || index >= adminSteps.length) return

    const editor = editorInstanceRef.current
    if (!editor) return
    if (lockedOutRef.current) return

    setTopPanelSelectedStep(index)

    // Load selected step ink.
    suppressBroadcastUntilTsRef.current = Date.now() + 1200
    try {
      editor.clear?.()
    } catch {}

    const stepSymbols = adminSteps[index]?.symbols
    if (stepSymbols && Array.isArray(stepSymbols) && stepSymbols.length) {
      try {
        await nextAnimationFrame()
        await editor.importPointEvents(stepSymbols)
      } catch (err) {
        console.warn('Failed to load step ink for editing', err)
      }
    }

    // Mark this step as the active edit target (so the next send overwrites it).
    setAdminEditIndex(index)
    setAdminDraftLatex(adminSteps[index]?.latex || '')
  }, [adminSteps, useAdminStepComposer])

  const loadStudentStepForEditing = useCallback(async (index: number) => {
    if (index < 0 || index >= studentSteps.length) return

    const editor = editorInstanceRef.current
    if (!editor) return
    if (lockedOutRef.current) return

    setTopPanelSelectedStep(index)

    suppressBroadcastUntilTsRef.current = Date.now() + 1200
    try {
      editor.clear?.()
    } catch {}

    const stepSymbols = studentSteps[index]?.symbols
    if (stepSymbols && Array.isArray(stepSymbols) && stepSymbols.length) {
      try {
        await nextAnimationFrame()
        await editor.importPointEvents(stepSymbols)
      } catch (err) {
        console.warn('Failed to load step ink for editing', err)
      }
    }

    setStudentEditIndex(index)
    setLatexOutput(studentSteps[index]?.latex || '')
  }, [studentSteps])

  const loadTopPanelStepForEditing = useCallback(async (index: number) => {
    if (useAdminStepComposer) {
      await loadAdminStepForEditing(index)
      return
    }
    if (useStudentStepComposer) {
      await loadStudentStepForEditing(index)
    }
  }, [loadAdminStepForEditing, loadStudentStepForEditing, useAdminStepComposer, useStudentStepComposer])

  const [lessonScriptResolved, setLessonScriptResolved] = useState<any | null>(null)
  const [lessonScriptLoading, setLessonScriptLoading] = useState(false)
  const [lessonScriptError, setLessonScriptError] = useState<string | null>(null)
  const [lessonScriptPhaseKey, setLessonScriptPhaseKey] = useState<LessonScriptPhaseKey>('engage')
  const [lessonScriptStepIndex, setLessonScriptStepIndex] = useState(-1)

  const [lessonScriptPointIndex, setLessonScriptPointIndex] = useState(0)
  const [lessonScriptModuleIndex, setLessonScriptModuleIndex] = useState(-1)
  const VIEW_ONLY_SPLIT_RATIO = 0.8
  const EDITABLE_SPLIT_RATIO = 0.55
  const [studentSplitRatio, setStudentSplitRatio] = useState(EDITABLE_SPLIT_RATIO) // portion for LaTeX panel when stacked
  const studentSplitRatioRef = useRef(EDITABLE_SPLIT_RATIO)
  const [studentViewScale, setStudentViewScale] = useState(0.9)

  type NotesSaveRecord = {
    id: string
    title: string
    latex: string
    shared: boolean
    noteId?: string | null
    payload?: any | null
    createdAt?: string
    updatedAt?: string
  }

  const [latestSharedSave, setLatestSharedSave] = useState<NotesSaveRecord | null>(null)
  const [latestPersonalSave, setLatestPersonalSave] = useState<NotesSaveRecord | null>(null)
  const [isSavingLatex, setIsSavingLatex] = useState(false)
  const [latexSaveError, setLatexSaveError] = useState<string | null>(null)

  const [finishQuestionModalOpen, setFinishQuestionModalOpen] = useState(false)
  const [finishQuestionTitle, setFinishQuestionTitle] = useState('')
  const [finishQuestionNoteId, setFinishQuestionNoteId] = useState<string | null>(null)

  const [notesLibraryOpen, setNotesLibraryOpen] = useState(false)
  const [notesLibraryLoading, setNotesLibraryLoading] = useState(false)
  const [notesLibraryError, setNotesLibraryError] = useState<string | null>(null)
  const [notesLibraryItems, setNotesLibraryItems] = useState<NotesSaveRecord[]>([])

  type DiagramStrokePoint = { x: number; y: number }
  type DiagramStroke = { id: string; color: string; width: number; points: DiagramStrokePoint[]; z?: number; locked?: boolean }
  type DiagramArrow = { id: string; color: string; width: number; start: DiagramStrokePoint; end: DiagramStrokePoint; headSize?: number; z?: number; locked?: boolean }
  type DiagramAnnotations = { strokes: DiagramStroke[]; arrows?: DiagramArrow[] }
  type DiagramRecord = {
    id: string
    title: string
    imageUrl: string
    order: number
    annotations: DiagramAnnotations | null
  }
  type DiagramState = {
    activeDiagramId: string | null
    isOpen: boolean
  }
  type DiagramRealtimeMessage =
    | { kind: 'state'; activeDiagramId: string | null; isOpen: boolean; ts?: number; sender?: string }
    | { kind: 'add'; diagram: DiagramRecord; ts?: number; sender?: string }
    | { kind: 'remove'; diagramId: string; ts?: number; sender?: string }
    | { kind: 'stroke-commit'; diagramId: string; stroke: DiagramStroke; ts?: number; sender?: string }
    | { kind: 'annotations-set'; diagramId: string; annotations: DiagramAnnotations | null; ts?: number; sender?: string }
    | { kind: 'clear'; diagramId: string; ts?: number; sender?: string }

  const [diagrams, setDiagrams] = useState<DiagramRecord[]>([])
  const diagramsRef = useRef<DiagramRecord[]>([])
  useEffect(() => {
    diagramsRef.current = diagrams
  }, [diagrams])
  const [diagramState, setDiagramState] = useState<DiagramState>({ activeDiagramId: null, isOpen: false })
  const diagramStateRef = useRef<DiagramState>({ activeDiagramId: null, isOpen: false })
  useEffect(() => {
    diagramStateRef.current = diagramState
  }, [diagramState])
  const [diagramManagerOpen, setDiagramManagerOpen] = useState(false)
  const [diagramUrlInput, setDiagramUrlInput] = useState('')
  const [diagramTitleInput, setDiagramTitleInput] = useState('')
  const [diagramBusy, setDiagramBusy] = useState(false)
  const diagramStageRef = useRef<HTMLDivElement | null>(null)
  const diagramCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const diagramImageRef = useRef<HTMLImageElement | null>(null)
  const diagramDrawingRef = useRef(false)
  const diagramCurrentStrokeRef = useRef<DiagramStroke | null>(null)
  const diagramCurrentArrowRef = useRef<DiagramArrow | null>(null)
  const diagramLastPublishTsRef = useRef(0)
  const diagramLastPersistTsRef = useRef(0)
  const diagramResizeObserverRef = useRef<ResizeObserver | null>(null)
  const diagramPointerIdRef = useRef<number | null>(null)
  const diagramToolRef = useRef<'select' | 'pen' | 'arrow' | 'eraser'>('pen')
  const [diagramTool, setDiagramTool] = useState<'select' | 'pen' | 'arrow' | 'eraser'>('pen')
  useEffect(() => {
    diagramToolRef.current = diagramTool
  }, [diagramTool])

  type DiagramSelection = { kind: 'stroke' | 'arrow'; id: string } | null
  const [diagramSelection, setDiagramSelection] = useState<DiagramSelection>(null)
  const diagramSelectionRef = useRef<DiagramSelection>(null)
  useEffect(() => {
    diagramSelectionRef.current = diagramSelection
  }, [diagramSelection])

  type DiagramContextMenuState = {
    diagramId: string
    selection: NonNullable<DiagramSelection>
    xPx: number
    yPx: number
    point: DiagramStrokePoint
  } | null
  const [diagramContextMenu, setDiagramContextMenu] = useState<DiagramContextMenuState>(null)
  const diagramContextMenuRef = useRef<HTMLDivElement | null>(null)
  const diagramClipboardRef = useRef<null | { kind: 'stroke' | 'arrow'; data: DiagramStroke | DiagramArrow }>(null)

  const getCssVarColor = (name: '--accent' | '--text' | '--muted' | '--primary') => {
    if (typeof window === 'undefined') return ''
    try {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    } catch {
      return ''
    }
  }

  const diagramColorPresets = useMemo(() => {
    const accent = getCssVarColor('--accent')
    const text = getCssVarColor('--text')
    const muted = getCssVarColor('--muted')
    const primary = getCssVarColor('--primary')
    const red = '#ef4444'
    return [
      { key: 'accent', label: 'Accent', value: accent || red },
      { key: 'text', label: 'Text', value: text || red },
      { key: 'muted', label: 'Muted', value: muted || red },
      { key: 'primary', label: 'Primary', value: primary || red },
      { key: 'red', label: 'Red', value: red },
    ] as const
  }, [diagramState.isOpen])

  const diagramWidthPresets = useMemo(() => {
    return [
      { key: 'thin', label: 'Thin', value: 2 },
      { key: 'medium', label: 'Medium', value: 4 },
      { key: 'thick', label: 'Thick', value: 7 },
    ] as const
  }, [])

  useEffect(() => {
    if (!diagramContextMenu) return
    if (!diagramSelection || diagramTool !== 'select') {
      setDiagramContextMenu(null)
    }
  }, [diagramContextMenu, diagramSelection, diagramTool])

  useEffect(() => {
    if (!diagramContextMenu) return
    if (typeof window === 'undefined') return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDiagramContextMenu(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [diagramContextMenu])

  useEffect(() => {
    if (diagramTool !== 'select' && diagramSelectionRef.current) {
      setDiagramSelection(null)
    }
  }, [diagramTool])

  const diagramPreviewRef = useRef<{ diagramId: string; annotations: DiagramAnnotations | null } | null>(null)
  const diagramEditRef = useRef<null | {
    diagramId: string
    selection: NonNullable<DiagramSelection>
    mode: 'move' | 'scale'
    handle?: 'nw' | 'ne' | 'sw' | 'se'
    startPoint: DiagramStrokePoint
    base: DiagramAnnotations
    baseBbox: { minX: number; minY: number; maxX: number; maxY: number }
    anchorPoint?: DiagramStrokePoint
  }>(null)

  const diagramUndoRef = useRef<DiagramAnnotations[]>([])
  const diagramRedoRef = useRef<DiagramAnnotations[]>([])
  const [diagramCanUndo, setDiagramCanUndo] = useState(false)
  const [diagramCanRedo, setDiagramCanRedo] = useState(false)
  const diagramHistoryDiagramIdRef = useRef<string | null>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const pageIndexRef = useRef(0)
  const [sharedPageIndex, setSharedPageIndex] = useState(0)
  const pendingPublishQueueRef = useRef<Array<SnapshotRecord>>([])
  const reconnectAttemptsRef = useRef(0)
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconcileIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null) // (Unused now; kept for potential future periodic sync)
  const realtimeRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRemoteSnapshotsRef = useRef<Array<{ message: SnapshotMessage; receivedTs?: number }>>([])
  const remoteFrameHandleRef = useRef<number | ReturnType<typeof setTimeout> | null>(null)
  const remoteProcessingRef = useRef(false)
  const controlStateRef = useRef<ControlState>(null)
  const isAssignmentViewRef = useRef(isAssignmentView)
  useEffect(() => {
    isAssignmentViewRef.current = isAssignmentView
  }, [isAssignmentView])
  const lockedOutRef = useRef(!isAdmin && !forceEditableForAssignment)
  const hasExclusiveControlRef = useRef(false)
  const lastControlBroadcastTsRef = useRef(0)
  const lastLatexBroadcastTsRef = useRef(0)
  const latexDisplayStateRef = useRef<LatexDisplayState>({ enabled: false, latex: '', options: DEFAULT_LATEX_OPTIONS })
  const suppressStackedNotesPreviewUntilTsRef = useRef(0)
  const latexProjectionOptionsRef = useRef<LatexDisplayOptions>(DEFAULT_LATEX_OPTIONS)
  const studentStackRef = useRef<HTMLDivElement | null>(null)
  const studentViewportRef = useRef<HTMLDivElement | null>(null)
  const splitHandleRef = useRef<HTMLDivElement | null>(null)
  const splitDragActiveRef = useRef(false)
  const splitDragStartYRef = useRef(0)
  const splitStartRatioRef = useRef(0.55)
  const splitDragPointerIdRef = useRef<number | null>(null)
  const splitWindowCleanupRef = useRef<null | (() => void)>(null)

  const editorResizeRafRef = useRef<number | null>(null)
  const requestEditorResize = useCallback(() => {
    if (typeof window === 'undefined') return
    if (editorResizeRafRef.current) return
    editorResizeRafRef.current = window.requestAnimationFrame(() => {
      editorResizeRafRef.current = null
      try {
        editorInstanceRef.current?.resize?.()
      } catch {}
    })
  }, [])
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedHashRef = useRef<string | null>(null)
  const pageRecordsRef = useRef<Array<{ snapshot: SnapshotPayload | null }>>([{ snapshot: null }])
  const sharedPageIndexRef = useRef(0)
  const forcedConvertDepthRef = useRef(0)
  const adminOrientationPreferenceRef = useRef<CanvasOrientation>(initialOrientation)
  const [overlayControlsVisible, setOverlayControlsVisible] = useState(false)
  const overlayHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clientId = useMemo(() => {
    const base = sanitizeIdentifier(userId || 'anonymous')
    const randomSuffix = Math.random().toString(36).slice(2, 8)
    return `${base}-${randomSuffix}`
  }, [userId])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(max-width: 768px)')
    const apply = () => setIsCompactViewport(Boolean(mql.matches))
    apply()
    try {
      mql.addEventListener('change', apply)
      return () => mql.removeEventListener('change', apply)
    } catch {
      // Safari / older browsers
      // eslint-disable-next-line deprecation/deprecation
      mql.addListener(apply)
      // eslint-disable-next-line deprecation/deprecation
      return () => mql.removeListener(apply)
    }
  }, [])

  useEffect(() => {
    setHasMounted(true)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const compute = () => {
      const vv = (window as any).visualViewport as VisualViewport | undefined
      if (!vv) {
        setViewportBottomOffsetPx(0)
        return
      }
      const bottomGap = window.innerHeight - (vv.height + vv.offsetTop)
      setViewportBottomOffsetPx(Math.max(0, Math.round(bottomGap)))
    }

    compute()
    window.addEventListener('resize', compute)
    const vv = (window as any).visualViewport as VisualViewport | undefined
    vv?.addEventListener('resize', compute)
    vv?.addEventListener('scroll', compute)
    return () => {
      window.removeEventListener('resize', compute)
      vv?.removeEventListener('resize', compute)
      vv?.removeEventListener('scroll', compute)
    }
  }, [])

  useEffect(() => {
    clientIdRef.current = clientId
  }, [clientId])

  useEffect(() => {
    latexDisplayStateRef.current = latexDisplayState
  }, [latexDisplayState])

  useEffect(() => {
    latexProjectionOptionsRef.current = latexProjectionOptions
  }, [latexProjectionOptions])

  // (Tap-to-reveal controls removed.)

  useEffect(() => {
    studentSplitRatioRef.current = studentSplitRatio
  }, [studentSplitRatio])

  useEffect(() => {
    if (!useStackedStudentLayout) return
    requestEditorResize()
  }, [requestEditorResize, studentSplitRatio, useStackedStudentLayout])

  useEffect(() => {
    pageIndexRef.current = pageIndex
  }, [pageIndex])

  useEffect(() => {
    sharedPageIndexRef.current = sharedPageIndex
  }, [sharedPageIndex])

  useEffect(() => {
    try {
      editorInstanceRef.current?.resize?.()
    } catch {}
  }, [canvasOrientation, isFullscreen])

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const host = editorHostRef.current
    if (!host) return
    const obs = new ResizeObserver(() => {
      requestEditorResize()
    })
    try {
      obs.observe(host)
    } catch {}
    return () => {
      try {
        obs.disconnect()
      } catch {}
      if (editorResizeRafRef.current && typeof window !== 'undefined') {
        try {
          window.cancelAnimationFrame(editorResizeRafRef.current)
        } catch {}
        editorResizeRafRef.current = null
      }
    }
  }, [editorReinitNonce, requestEditorResize])

  const updateSplitRatioFromClientY = useCallback((clientY: number) => {
    if (!splitDragActiveRef.current) return
    const stackEl = studentStackRef.current
    if (!stackEl) return
    const rect = stackEl.getBoundingClientRect()
    const delta = clientY - splitDragStartYRef.current
    const nextRatio = splitStartRatioRef.current + delta / Math.max(rect.height, 1)
    const clamped = Math.min(Math.max(nextRatio, 0.2), 0.8)
    setStudentSplitRatio(clamped)
    studentSplitRatioRef.current = clamped
    requestEditorResize()
  }, [requestEditorResize])

  const handleSplitPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!splitDragActiveRef.current) return
    event.preventDefault()
    updateSplitRatioFromClientY(event.clientY)
  }, [updateSplitRatioFromClientY])

  const stopSplitDrag = useCallback(() => {
    if (!splitDragActiveRef.current) return
    splitDragActiveRef.current = false

    if (splitWindowCleanupRef.current) {
      try {
        splitWindowCleanupRef.current()
      } catch {}
      splitWindowCleanupRef.current = null
    }

    const handle = splitHandleRef.current
    const pointerId = splitDragPointerIdRef.current
    if (handle && pointerId !== null) {
      try {
        handle.releasePointerCapture(pointerId)
      } catch {}
    }
    splitDragPointerIdRef.current = null
    splitStartRatioRef.current = studentSplitRatioRef.current
    document.body.style.userSelect = ''
    ;(document.body.style as any).touchAction = ''
    ;(document.body.style as any).overscrollBehavior = ''
    requestEditorResize()
  }, [requestEditorResize])

  const startSplitDrag = useCallback((pointerId: number, clientY: number) => {
    splitDragActiveRef.current = true
    splitDragStartYRef.current = clientY
    splitStartRatioRef.current = studentSplitRatioRef.current
    splitDragPointerIdRef.current = pointerId
    document.body.style.userSelect = 'none'
    ;(document.body.style as any).touchAction = 'none'
    ;(document.body.style as any).overscrollBehavior = 'none'

    // Some browsers/devices can be flaky with pointer capture on thin separators.
    // Add window-level listeners so dragging keeps working even if the pointer leaves the handle.
    if (typeof window !== 'undefined') {
      if (splitWindowCleanupRef.current) {
        try {
          splitWindowCleanupRef.current()
        } catch {}
        splitWindowCleanupRef.current = null
      }

      const onMove = (e: PointerEvent) => {
        if (!splitDragActiveRef.current) return
        const activeId = splitDragPointerIdRef.current
        if (activeId !== null && e.pointerId !== activeId) return
        try {
          e.preventDefault()
        } catch {}
        updateSplitRatioFromClientY(e.clientY)
      }
      const onUp = (e: PointerEvent) => {
        const activeId = splitDragPointerIdRef.current
        if (activeId !== null && e.pointerId !== activeId) return
        stopSplitDrag()
      }
      const onCancel = (e: PointerEvent) => {
        const activeId = splitDragPointerIdRef.current
        if (activeId !== null && e.pointerId !== activeId) return
        stopSplitDrag()
      }

      window.addEventListener('pointermove', onMove, { passive: false })
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)

      splitWindowCleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
      }
    }
  }, [stopSplitDrag, updateSplitRatioFromClientY])

  useEffect(() => {
    return () => {
      if (splitWindowCleanupRef.current) {
        try {
          splitWindowCleanupRef.current()
        } catch {}
        splitWindowCleanupRef.current = null
      }
    }
  }, [])

  const broadcastDebounceMs = useMemo(() => getBroadcastDebounce(), [])

  const updateControlState = useCallback(
    (next: ControlState) => {
      controlStateRef.current = next
      // Permissions are unified: a client can edit + publish iff they have controller rights.
      hasExclusiveControlRef.current = false
      const lockedOut = !hasBoardWriteRights()
      lockedOutRef.current = lockedOut
      setViewOnlyMode(lockedOut)
      if (lockedOut) {
        pendingPublishQueueRef.current = []
      }
      setControlState(next)
    },
    [hasBoardWriteRights]
  )

  const setControllerRightsForClients = useCallback(async (targetClientIds: string[], allowed: boolean, opts?: { userKey?: string; name?: string }) => {
    if (!isAdmin) return
    const targets = Array.from(new Set(targetClientIds.filter(id => id && id !== 'all' && id !== ALL_STUDENTS_ID)))
    const userKey = typeof opts?.userKey === 'string' ? opts?.userKey : ''
    const displayName = typeof opts?.name === 'string' ? opts?.name : ''
    if (!targets.length && !userKey) return

    if (userKey) {
      if (allowed) {
        controllerRightsUserAllowlistRef.current.add(userKey)
      } else {
        controllerRightsUserAllowlistRef.current.delete(userKey)
      }
    }

    for (const target of targets) {
      if (allowed) {
        controllerRightsAllowlistRef.current.add(target)
      } else {
        controllerRightsAllowlistRef.current.delete(target)
      }
    }
    bumpControllerRightsVersion()
    // Recompute local permission refs immediately.
    updateControlState(controlStateRef.current)

    const channel = channelRef.current
    if (!channel) return
    const ts = Date.now()
    try {
      await channel.publish('control', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        action: 'controller-rights',
        targetUserKey: userKey || null,
        name: displayName || null,
        targetClientIds: targets,
        targetClientId: targets[0],
        allowed,
        ts,
      })

      // Explicit presenter handoff:
      // When the admin grants presenter/controller-rights to a student, we immediately declare
      // that student as the exclusive snapshot publisher.
      // (Admin remains connected but must stop publishing SnapshotPayload.)
      if (allowed) {
        const presenterKey = userKey || null
        setActivePresenterUserKey(presenterKey)
        activePresenterUserKeyRef.current = presenterKey ? String(presenterKey) : ''
        activePresenterClientIdsRef.current = new Set(targets)

        // Recompute permissions now that presenter changed.
        updateControlState(controlStateRef.current)

        // Admin relinquishes snapshot publishing immediately.
        pendingPublishQueueRef.current = []
        await channel.publish('control', {
          clientId: clientIdRef.current,
          author: userDisplayName,
          action: 'presenter-set',
          presenterUserKey: presenterKey,
          targetClientIds: targets,
          targetClientId: targets[0],
          ts: ts + 1,
        } satisfies PresenterSetMessage)
      } else {
        // If we're revoking the active presenter, clear it.
        const activeKey = activePresenterUserKeyRef.current
        if (userKey && activeKey && userKey === activeKey) {
          setActivePresenterUserKey(null)
          activePresenterUserKeyRef.current = ''
          activePresenterClientIdsRef.current = new Set()
          updateControlState(controlStateRef.current)
          await channel.publish('control', {
            clientId: clientIdRef.current,
            author: userDisplayName,
            action: 'presenter-set',
            presenterUserKey: null,
            targetClientIds: [],
            ts: ts + 1,
          } satisfies PresenterSetMessage)
        }
      }
    } catch (err) {
      console.warn('Failed to update controller rights', err)
    }
  }, [bumpControllerRightsVersion, isAdmin, updateControlState, userDisplayName])

  const reclaimAdminControl = useCallback(async () => {
    if (!isAdmin) return

    const teacherPresenterKey = (selfUserKey || '').trim() || null
    const teacherClientId = clientIdRef.current

    const currentUserKeys = Array.from(controllerRightsUserAllowlistRef.current)
      .filter(k => k && k !== selfUserKey)
    const currentClientIds = Array.from(controllerRightsAllowlistRef.current)
      .filter(id => id && id !== 'all' && id !== ALL_STUDENTS_ID && id !== clientIdRef.current)

    // Clear local state immediately.
    controllerRightsUserAllowlistRef.current.clear()
    controllerRightsAllowlistRef.current.clear()
    bumpControllerRightsVersion()

    // Reclaim means the teacher becomes the exclusive snapshot publisher.
    // This guarantees we never end up with two concurrent publishers even if a client misses revoke messages.
    setActivePresenterUserKey(teacherPresenterKey)
    activePresenterUserKeyRef.current = teacherPresenterKey ? String(teacherPresenterKey) : ''
    activePresenterClientIdsRef.current = teacherClientId ? new Set([teacherClientId]) : new Set()

    // Recompute local permission refs immediately.
    updateControlState(controlStateRef.current)

    const channel = channelRef.current
    if (!channel) return
    const ts = Date.now()

    try {
      // Make the teacher the exclusive presenter globally.
      await channel.publish('control', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        action: 'presenter-set',
        presenterUserKey: teacherPresenterKey,
        targetClientIds: teacherClientId ? [teacherClientId] : [],
        ts,
      } satisfies PresenterSetMessage)

      // Hard reset: ensure all clients (including the former presenter) drop controller rights.
      // This prevents any stale allowlist state from leaving multiple publishers active.
      await channel.publish('control', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        action: 'controller-rights-reset',
        ts: ts + 1,
      })

      // Revoke presenter/controller rights by clientId (legacy allowlist) in one message.
      if (currentClientIds.length) {
        await channel.publish('control', {
          clientId: clientIdRef.current,
          author: userDisplayName,
          action: 'controller-rights',
          targetUserKey: null,
          name: null,
          targetClientIds: currentClientIds,
          targetClientId: currentClientIds[0],
          allowed: false,
          ts: ts + 2,
        })
      }

      // Revoke presenter/controller rights by userKey (preferred allowlist) one-by-one.
      if (currentUserKeys.length) {
        let i = 0
        for (const userKey of currentUserKeys) {
          i += 1
          await channel.publish('control', {
            clientId: clientIdRef.current,
            author: userDisplayName,
            action: 'controller-rights',
            targetUserKey: userKey,
            name: null,
            targetClientIds: [],
            allowed: false,
            ts: ts + 2 + i,
          })
        }
      }
    } catch (err) {
      console.warn('Failed to reclaim admin control', err)
    }
  }, [bumpControllerRightsVersion, isAdmin, selfUserKey, updateControlState, userDisplayName])

  // Semantic alias: presenter == controller-rights.
  const setPresenterRightsForClients = setControllerRightsForClients

  const setControllerRightsForClient = useCallback(async (targetClientId: string, allowed: boolean) => {
    const resolved = connectedClientsRef.current.find(c => c.clientId === targetClientId)
    const resolvedUserId = typeof (resolved as any)?.userId === 'string' ? String((resolved as any)?.userId) : undefined
    const resolvedName = normalizeName((resolved as any)?.name || '') || String(targetClientId)
    const userKey = getUserKey(resolvedUserId, resolvedName) || (resolvedName ? `name:${normalizeName(resolvedName).toLowerCase()}` : '')

    // Apply to all currently-connected presences for the same user (userId preferred, else normalized name).
    const matchingClientIds = connectedClientsRef.current
      .filter(x => x.clientId && x.clientId !== ALL_STUDENTS_ID)
      .filter(x => {
        const xUserId = typeof (x as any).userId === 'string' ? String((x as any).userId) : undefined
        if (resolvedUserId && xUserId) return String(xUserId) === String(resolvedUserId)
        const xName = normalizeName((x as any).name || '') || String(x.clientId)
        return normalizeName(xName).toLowerCase() === normalizeName(resolvedName).toLowerCase()
      })
      .map(x => x.clientId)

    await setControllerRightsForClients(matchingClientIds.length ? matchingClientIds : [targetClientId], allowed, { userKey, name: resolvedName })
  }, [setControllerRightsForClients])

  // Semantic alias: presenter == controller-rights.
  const setPresenterRightsForClient = setControllerRightsForClient

  const handOverPresentation = useCallback(
    (target: null | { clientId: string; userId?: string; userKey: string; displayName: string }) => {
      if (!isAdmin) return

      // Bidirectional: null target means the admin reclaims control.
      if (!target) {
        void reclaimAdminControl()
        return
      }

      const clickedClientId = String(target.clientId || '').trim()
      const clickedUserId = String(target.userId || '').trim()
      const clickedUserKey = String(target.userKey || '').trim()
      const displayName = String(target.displayName || '').trim()
      if (!clickedClientId && !clickedUserKey) return

      const prevPresenterUserKey = activePresenterUserKeyRef.current || ''
      const prevPresenterClientIds = Array.from(activePresenterClientIdsRef.current)

      const nameKey = normalizeName(displayName).toLowerCase()
      const matchingClientIds = connectedClients
        .filter(x => x.clientId && x.clientId !== ALL_STUDENTS_ID)
        .filter(x => {
          const xUserId = typeof (x as any).userId === 'string' ? String((x as any).userId) : ''
          if (clickedUserId && xUserId) return xUserId === clickedUserId
          const xName = normalizeName((x as any).name || '') || String(x.clientId)
          return normalizeName(xName).toLowerCase() === nameKey
        })
        .map(x => x.clientId)

      const nextClientIds = matchingClientIds.length ? matchingClientIds : (clickedClientId ? [clickedClientId] : [])
      if (!nextClientIds.length) return

      void (async () => {
        // Promote the tapped attendee to presenter.
        await setPresenterRightsForClients(nextClientIds, true, {
          userKey: clickedUserKey,
          name: displayName,
        })

        // Demote the previous presenter (if any), so there's only one presenter at a time.
        const samePresenter = (prevPresenterUserKey && clickedUserKey && prevPresenterUserKey === clickedUserKey)
          || prevPresenterClientIds.some(id => nextClientIds.includes(id))

        if (!samePresenter && (prevPresenterUserKey || prevPresenterClientIds.length)) {
          await setPresenterRightsForClients(
            prevPresenterClientIds,
            false,
            prevPresenterUserKey ? { userKey: prevPresenterUserKey } : undefined
          )
        }
      })()
    },
    [connectedClients, isAdmin, normalizeName, reclaimAdminControl, setPresenterRightsForClients]
  )

  const handleRosterAttendeeAvatarClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault()
      e.stopPropagation()
      if (!isAdmin) return

      const el = e.currentTarget
      const clickedClientId = String(el?.dataset?.clientId || '').trim()
      const clickedUserId = String(el?.dataset?.userId || '').trim()
      const clickedUserKey = String(el?.dataset?.userKey || '').trim()
      const displayName = String(el?.dataset?.displayName || '').trim()

      handOverPresentation({
        clientId: clickedClientId,
        userId: clickedUserId || undefined,
        userKey: clickedUserKey,
        displayName,
      })
    },
    [handOverPresentation, isAdmin]
  )

  const broadcastHighlightedController = useCallback(async (payload: { clientId: string; userId?: string; name?: string } | null) => {
    if (!isAdmin) return
    const channel = channelRef.current
    if (!channel) return
    try {
      await channel.publish('control', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        action: 'controller-highlight',
        targetClientId: payload?.clientId ?? null,
        targetUserId: payload?.userId ?? null,
        name: payload?.name ?? null,
        ts: Date.now(),
      })
    } catch (err) {
      console.warn('Failed to broadcast highlighted controller', err)
    }
  }, [isAdmin, userDisplayName])

  const clearOverlayAutoHide = useCallback(() => {
    if (overlayHideTimeoutRef.current) {
      clearTimeout(overlayHideTimeoutRef.current)
      overlayHideTimeoutRef.current = null
    }
  }, [])

  const closeOverlayControls = useCallback(() => {
    if (!isOverlayMode) return
    clearOverlayAutoHide()
    setOverlayControlsVisible(false)
  }, [clearOverlayAutoHide, isOverlayMode])

  const kickOverlayAutoHide = useCallback(() => {
    if (!isOverlayMode) return
    clearOverlayAutoHide()
    overlayHideTimeoutRef.current = setTimeout(() => {
      setOverlayControlsVisible(false)
    }, 6000)
  }, [clearOverlayAutoHide, isOverlayMode])

  const openOverlayControls = useCallback(() => {
    if (!isOverlayMode) return
    setOverlayControlsVisible(true)
  }, [isOverlayMode])

  const toggleOverlayControls = useCallback(() => {
    if (!isOverlayMode) return
    setOverlayControlsVisible(prev => {
      const next = !prev
      if (!next) {
        clearOverlayAutoHide()
      }
      return next
    })
  }, [clearOverlayAutoHide, isOverlayMode])

  useEffect(() => {
    return () => {
      clearOverlayAutoHide()
    }
  }, [clearOverlayAutoHide])

  useEffect(() => {
    if (!isOverlayMode || !overlayControlsVisible) return
    kickOverlayAutoHide()
  }, [isOverlayMode, overlayControlsVisible, kickOverlayAutoHide])

  useImperativeHandle(
    overlayControlsHandleRef,
    () => ({
      open: () => {
        openOverlayControls()
      },
      close: () => {
        closeOverlayControls()
      },
      toggle: () => {
        toggleOverlayControls()
      }
    }),
    [closeOverlayControls, openOverlayControls, toggleOverlayControls]
  )

  const runCanvasAction = useCallback((action: () => void | Promise<void>) => {
    if (typeof action === 'function') {
      action()
    }
    if (isOverlayMode) {
      clearOverlayAutoHide()
      setOverlayControlsVisible(false)
    }
  }, [clearOverlayAutoHide, isOverlayMode])

  const getLessonScriptPhaseSteps = useCallback(
    (resolved: any, phaseKey: LessonScriptPhaseKey): string[] => {
      if (!resolved || typeof resolved !== 'object') return []
      const phases = (resolved as any).phases
      if (!phases || typeof phases !== 'object') return []
      const phase = (phases as any)[phaseKey]
      const stepsRaw = phase?.steps
      if (!Array.isArray(stepsRaw)) return []
      return stepsRaw
        .map((step: any) => (typeof step === 'string' ? step.trim() : String(step ?? '').trim()))
        .filter(Boolean)
    },
    []
  )

  const getLessonScriptV2 = useCallback((resolved: any): LessonScriptV2 | null => {
    if (!resolved || typeof resolved !== 'object') return null
    if ((resolved as any).schemaVersion !== 2) return null
    const phasesRaw = (resolved as any).phases
    if (!Array.isArray(phasesRaw)) return null

    const phases: LessonScriptV2Phase[] = phasesRaw
      .map((p: any) => {
        const key = p?.key as LessonScriptPhaseKey
        if (key !== 'engage' && key !== 'explore' && key !== 'explain' && key !== 'elaborate' && key !== 'evaluate') return null
        const pointsRaw = Array.isArray(p?.points) ? p.points : []
        const points: LessonScriptV2Point[] = pointsRaw
          .map((pt: any, idx: number) => {
            const modulesRaw = Array.isArray(pt?.modules) ? pt.modules : []
            const modules: LessonScriptV2Module[] = modulesRaw
              .map((m: any) => {
                const t = m?.type
                if (t === 'text') return { type: 'text', text: typeof m.text === 'string' ? m.text : '' }
                if (t === 'diagram') {
                  const title = typeof m.title === 'string' ? m.title : ''
                  const diagram = m.diagram && typeof m.diagram === 'object' && !Array.isArray(m.diagram)
                    ? {
                        title: typeof m.diagram.title === 'string' ? m.diagram.title : '',
                        imageUrl: typeof m.diagram.imageUrl === 'string' ? m.diagram.imageUrl : '',
                        annotations: m.diagram.annotations,
                      }
                    : undefined
                  return { type: 'diagram', title, diagram }
                }
                if (t === 'latex') return { type: 'latex', latex: typeof m.latex === 'string' ? m.latex : '' }
                return null
              })
              .filter(Boolean) as LessonScriptV2Module[]
              
            const cleaned = modules
              .map(mod => {
                if (mod.type === 'text') return { ...mod, text: (mod.text || '').trim() }
                if (mod.type === 'diagram') {
                  const title = (mod.title || '').trim()
                  const diagram = mod.diagram
                    ? {
                        title: (mod.diagram.title || '').trim(),
                        imageUrl: (mod.diagram.imageUrl || '').trim(),
                        annotations: mod.diagram.annotations,
                      }
                    : undefined
                  return { ...mod, title, diagram }
                }
                return { ...mod, latex: (mod.latex || '').trim() }
              })
              .filter(mod => {
                if (mod.type === 'text') return Boolean(mod.text)
                if (mod.type === 'diagram') return Boolean(mod.diagram?.title && mod.diagram?.imageUrl) || Boolean(mod.title)
                return Boolean(mod.latex)
              })

            if (cleaned.length === 0) return null
            const id = typeof pt?.id === 'string' && pt.id.trim() ? pt.id.trim() : `${key}-${idx}`
            const title = typeof pt?.title === 'string' ? pt.title : ''
            return { id, title, modules: cleaned }
          })
          .filter(Boolean) as LessonScriptV2Point[]

        return { key, label: typeof p?.label === 'string' ? p.label : undefined, points }
      })
      .filter(Boolean) as LessonScriptV2Phase[]

    return { schemaVersion: 2, phases }
  }, [])

  const lessonScriptPhaseSteps = useMemo(
    () => getLessonScriptPhaseSteps(lessonScriptResolved, lessonScriptPhaseKey),
    [getLessonScriptPhaseSteps, lessonScriptPhaseKey, lessonScriptResolved]
  )

  const lessonScriptV2 = useMemo(() => getLessonScriptV2(lessonScriptResolved), [getLessonScriptV2, lessonScriptResolved])

  const lessonScriptV2Phase = useMemo(() => {
    if (!lessonScriptV2) return null
    return lessonScriptV2.phases.find(p => p.key === lessonScriptPhaseKey) || null
  }, [lessonScriptPhaseKey, lessonScriptV2])

  const lessonScriptV2Points = useMemo(() => lessonScriptV2Phase?.points ?? [], [lessonScriptV2Phase])

  const lessonScriptV2ActivePoint = useMemo(() => {
    if (!lessonScriptV2Points.length) return null
    const idx = Math.max(0, Math.min(lessonScriptPointIndex, lessonScriptV2Points.length - 1))
    return lessonScriptV2Points[idx] ?? null
  }, [lessonScriptPointIndex, lessonScriptV2Points])

  const lessonScriptV2ActiveModules = useMemo(() => lessonScriptV2ActivePoint?.modules ?? [], [lessonScriptV2ActivePoint])

  const hasLessonScriptSteps = useMemo(() => {
    if (!lessonScriptResolved || typeof lessonScriptResolved !== 'object') return false
    if ((lessonScriptResolved as any).schemaVersion === 2 && Array.isArray((lessonScriptResolved as any).phases)) {
      const v2 = getLessonScriptV2(lessonScriptResolved)
      if (!v2) return false
      return v2.phases.some(p => Array.isArray(p.points) && p.points.some(pt => Array.isArray(pt.modules) && pt.modules.length > 0))
    }
    return LESSON_SCRIPT_PHASES.some(phase => getLessonScriptPhaseSteps(lessonScriptResolved, phase.key).length > 0)
  }, [getLessonScriptPhaseSteps, getLessonScriptV2, lessonScriptResolved])

  const loadLessonScript = useCallback(async () => {
    if (!isAdmin) return
    if (!boardId) return

    setLessonScriptLoading(true)
    setLessonScriptError(null)

    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(boardId)}/lesson-script`, { credentials: 'same-origin' })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        setLessonScriptResolved(null)
        setLessonScriptError(payload?.message || `Failed to load lesson script (${res.status})`)
        return null
      }
      const payload = await res.json().catch(() => null)
      const resolved = payload?.resolved ?? null
      setLessonScriptResolved(resolved)
      setLessonScriptError(null)
      return resolved
    } catch (err: any) {
      setLessonScriptResolved(null)
      setLessonScriptError(err?.message || 'Failed to load lesson script')
      return null
    } finally {
      setLessonScriptLoading(false)
    }
  }, [boardId, isAdmin])

  useEffect(() => {
    if (!isAdmin) return
    if (!boardId) return
    void loadLessonScript()
  }, [boardId, isAdmin, loadLessonScript])

  const channelName = useMemo(() => {
    // Ably realtime scope (and diagram sessionKey) is intentionally separable from boardId.
    // - boardId is used for session-scoped APIs (e.g. lesson scripts, quiz responses)
    // - realtimeScopeId can isolate realtime traffic (e.g. per-learner assignment boards)
    const base = realtimeScopeId
      ? sanitizeIdentifier(realtimeScopeId).toLowerCase()
      : boardId
      ? sanitizeIdentifier(boardId).toLowerCase()
      : gradeLabel
      ? `grade-${sanitizeIdentifier(gradeLabel).toLowerCase()}`
      : 'shared'
    return `myscript:${base}`
  }, [boardId, gradeLabel, realtimeScopeId])

  const buildLessonScriptLatex = useCallback((steps: string[], stepIndex: number) => {
    if (!Array.isArray(steps) || steps.length === 0) return ''
    const index = Math.min(Math.max(stepIndex, -1), steps.length - 1)
    if (index < 0) return ''
    return steps
      .slice(0, index + 1)
      .map(step => (step || '').trim())
      .filter(Boolean)
      .join(' \\\\ ')
      .trim()
  }, [])

  const activeDiagram = useMemo(() => {
    if (!diagramState.activeDiagramId) return null
    return diagrams.find(d => d.id === diagramState.activeDiagramId) || null
  }, [diagramState.activeDiagramId, diagrams])

  const cloneDiagramAnnotations = useCallback((value: DiagramAnnotations | null | undefined): DiagramAnnotations => {
    const strokes = Array.isArray(value?.strokes) ? value!.strokes : []
    const arrows = Array.isArray((value as any)?.arrows) ? (value as any).arrows : []
    return {
      strokes: strokes.map(s => ({
        id: String(s.id),
        color: typeof s.color === 'string' ? s.color : '#ef4444',
        width: typeof s.width === 'number' ? s.width : 3,
        z: typeof (s as any)?.z === 'number' && Number.isFinite((s as any).z) ? (s as any).z : undefined,
        locked: Boolean((s as any)?.locked),
        points: Array.isArray(s.points) ? s.points.map(p => ({ x: Number(p.x), y: Number(p.y) })) : [],
      })),
      arrows: arrows
        .map((a: any) => ({
          id: typeof a?.id === 'string' ? a.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          color: typeof a?.color === 'string' ? a.color : '#ef4444',
          width: typeof a?.width === 'number' ? a.width : 3,
          headSize: typeof a?.headSize === 'number' ? a.headSize : 12,
          z: typeof a?.z === 'number' && Number.isFinite(a.z) ? a.z : undefined,
          locked: Boolean(a?.locked),
          start: { x: typeof a?.start?.x === 'number' ? a.start.x : 0, y: typeof a?.start?.y === 'number' ? a.start.y : 0 },
          end: { x: typeof a?.end?.x === 'number' ? a.end.x : 0, y: typeof a?.end?.y === 'number' ? a.end.y : 0 },
        }))
        .filter((a: any) => Number.isFinite(a.start.x) && Number.isFinite(a.start.y) && Number.isFinite(a.end.x) && Number.isFinite(a.end.y)),
    }
  }, [])

  const normalizeAnnotations = useCallback((value: any): DiagramAnnotations => {
    const strokes = Array.isArray(value?.strokes) ? value.strokes : []
    const arrows = Array.isArray(value?.arrows) ? value.arrows : []
    return {
      strokes: strokes
        .map((s: any) => ({
          id: typeof s?.id === 'string' ? s.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          color: typeof s?.color === 'string' ? s.color : '#ef4444',
          width: typeof s?.width === 'number' ? s.width : 3,
          z: typeof s?.z === 'number' && Number.isFinite(s.z) ? s.z : undefined,
          locked: Boolean(s?.locked),
          points: Array.isArray(s?.points)
            ? s.points
                .map((p: any) => ({ x: typeof p?.x === 'number' ? p.x : 0, y: typeof p?.y === 'number' ? p.y : 0 }))
                .filter((p: any) => Number.isFinite(p.x) && Number.isFinite(p.y))
            : [],
        }))
        .filter((s: any) => s.points.length >= 1),
      arrows: arrows
        .map((a: any) => ({
          id: typeof a?.id === 'string' ? a.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          color: typeof a?.color === 'string' ? a.color : '#ef4444',
          width: typeof a?.width === 'number' ? a.width : 3,
          headSize: typeof a?.headSize === 'number' ? a.headSize : 12,
          z: typeof a?.z === 'number' && Number.isFinite(a.z) ? a.z : undefined,
          locked: Boolean(a?.locked),
          start: { x: typeof a?.start?.x === 'number' ? a.start.x : 0, y: typeof a?.start?.y === 'number' ? a.start.y : 0 },
          end: { x: typeof a?.end?.x === 'number' ? a.end.x : 0, y: typeof a?.end?.y === 'number' ? a.end.y : 0 },
        }))
        .filter((a: any) => Number.isFinite(a.start.x) && Number.isFinite(a.start.y) && Number.isFinite(a.end.x) && Number.isFinite(a.end.y)),
    }
  }, [])

  const syncDiagramHistoryFlags = useCallback(() => {
    setDiagramCanUndo(diagramUndoRef.current.length > 0)
    setDiagramCanRedo(diagramRedoRef.current.length > 0)
  }, [])

  const resetDiagramHistoryFor = useCallback((diagramId: string | null) => {
    diagramHistoryDiagramIdRef.current = diagramId
    diagramUndoRef.current = []
    diagramRedoRef.current = []
    syncDiagramHistoryFlags()
  }, [syncDiagramHistoryFlags])

  useEffect(() => {
    const nextId = activeDiagram?.id ?? null
    if (diagramHistoryDiagramIdRef.current !== nextId) resetDiagramHistoryFor(nextId)
  }, [activeDiagram?.id, resetDiagramHistoryFor])

  const applyDiagramAnnotations = useCallback((diagramId: string, annotations: DiagramAnnotations | null) => {
    setDiagrams(prev => prev.map(d => (d.id === diagramId ? { ...d, annotations: annotations ? normalizeAnnotations(annotations) : null } : d)))
  }, [normalizeAnnotations])

  const diagramPointDistanceSq = (a: DiagramStrokePoint, b: DiagramStrokePoint) => {
    const dx = a.x - b.x
    const dy = a.y - b.y
    return dx * dx + dy * dy
  }

  const diagramDistancePointToSegmentSq = (p: DiagramStrokePoint, a: DiagramStrokePoint, b: DiagramStrokePoint) => {
    const abx = b.x - a.x
    const aby = b.y - a.y
    const apx = p.x - a.x
    const apy = p.y - a.y
    const abLenSq = abx * abx + aby * aby
    if (abLenSq <= 1e-12) return diagramPointDistanceSq(p, a)
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq))
    const proj = { x: a.x + t * abx, y: a.y + t * aby }
    return diagramPointDistanceSq(p, proj)
  }

  const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

  const diagramAnnotationsForRender = useCallback(
    (diagramId: string) => {
      const preview = diagramPreviewRef.current
      if (preview && preview.diagramId === diagramId) {
        return preview.annotations ? normalizeAnnotations(preview.annotations) : { strokes: [], arrows: [] }
      }
      const d = diagramsRef.current.find(x => x.id === diagramId)
      return d?.annotations ? normalizeAnnotations(d.annotations) : { strokes: [], arrows: [] }
    },
    [normalizeAnnotations]
  )

  const bboxFromStroke = (stroke: DiagramStroke) => {
    const pts = stroke.points || []
    let minX = 1, minY = 1, maxX = 0, maxY = 0
    for (const p of pts) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
    return { minX, minY, maxX, maxY }
  }

  const bboxFromArrow = (arrow: DiagramArrow) => {
    const minX = Math.min(arrow.start.x, arrow.end.x)
    const minY = Math.min(arrow.start.y, arrow.end.y)
    const maxX = Math.max(arrow.start.x, arrow.end.x)
    const maxY = Math.max(arrow.start.y, arrow.end.y)
    return { minX, minY, maxX, maxY }
  }

  const selectionBbox = useCallback((diagramId: string, selection: NonNullable<DiagramSelection>) => {
    const ann = diagramAnnotationsForRender(diagramId)
    if (selection.kind === 'stroke') {
      const stroke = (ann.strokes || []).find(s => s.id === selection.id)
      if (!stroke) return null
      return bboxFromStroke(stroke)
    }
    const arrows = (ann as any).arrows || []
    const arrow = arrows.find((a: any) => a.id === selection.id)
    if (!arrow) return null
    return bboxFromArrow(arrow)
  }, [diagramAnnotationsForRender])

  const bboxCornerPoints = (bbox: { minX: number; minY: number; maxX: number; maxY: number }) => {
    return {
      nw: { x: bbox.minX, y: bbox.minY },
      ne: { x: bbox.maxX, y: bbox.minY },
      sw: { x: bbox.minX, y: bbox.maxY },
      se: { x: bbox.maxX, y: bbox.maxY },
    } as const
  }

  const oppositeHandle = (h: 'nw' | 'ne' | 'sw' | 'se') => {
    if (h === 'nw') return 'se'
    if (h === 'ne') return 'sw'
    if (h === 'sw') return 'ne'
    return 'nw'
  }

  const hitTestHandle = (point: DiagramStrokePoint, bbox: { minX: number; minY: number; maxX: number; maxY: number }, stageWidth: number, stageHeight: number) => {
    const corners = bboxCornerPoints(bbox)
    const rPx = 10
    const rx = rPx / Math.max(stageWidth, 1)
    const ry = rPx / Math.max(stageHeight, 1)
    const rSq = Math.max(rx * rx, ry * ry)
    for (const key of Object.keys(corners) as Array<keyof typeof corners>) {
      const c = corners[key]
      const dSq = diagramPointDistanceSq(point, c)
      if (dSq <= rSq) return key as 'nw' | 'ne' | 'sw' | 'se'
    }
    return null
  }

  const hitTestAnnotation = useCallback((diagramId: string, point: DiagramStrokePoint) => {
    const ann = diagramAnnotationsForRender(diagramId)
    const strokes = ann.strokes || []
    const arrows = (ann as any).arrows || []

    const threshold = 0.02
    const thresholdSq = threshold * threshold

    let best: { kind: 'stroke' | 'arrow'; id: string; distSq: number; z: number } | null = null

    const zOf = (sel: { kind: 'stroke' | 'arrow'; id: string }) => {
      if (sel.kind === 'stroke') {
        const s = strokes.find(x => x.id === sel.id)
        return typeof (s as any)?.z === 'number' && Number.isFinite((s as any).z) ? (s as any).z : 0
      }
      const a = arrows.find((x: any) => x.id === sel.id)
      return typeof a?.z === 'number' && Number.isFinite(a.z) ? a.z : 0
    }

    for (const s of strokes) {
      const pts = s.points || []
      if (pts.length === 1) {
        const dSq = diagramPointDistanceSq(point, pts[0])
        if (dSq <= thresholdSq) {
          const cand = { kind: 'stroke' as const, id: s.id }
          const z = zOf(cand)
          if (!best || z > best.z || (z === best.z && dSq < best.distSq)) best = { kind: 'stroke', id: s.id, distSq: dSq, z }
        }
        continue
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const dSq = diagramDistancePointToSegmentSq(point, pts[i], pts[i + 1])
        if (dSq <= thresholdSq) {
          const cand = { kind: 'stroke' as const, id: s.id }
          const z = zOf(cand)
          if (!best || z > best.z || (z === best.z && dSq < best.distSq)) best = { kind: 'stroke', id: s.id, distSq: dSq, z }
        }
      }
    }

    for (const a of arrows) {
      const dSq = diagramDistancePointToSegmentSq(point, a.start, a.end)
      if (dSq <= thresholdSq) {
        const cand = { kind: 'arrow' as const, id: a.id }
        const z = zOf(cand)
        if (!best || z > best.z || (z === best.z && dSq < best.distSq)) best = { kind: 'arrow', id: a.id, distSq: dSq, z }
      }
    }

    return best ? ({ kind: best.kind, id: best.id } as NonNullable<DiagramSelection>) : null
  }, [diagramAnnotationsForRender])

  const applyMoveToAnnotations = (base: DiagramAnnotations, selection: NonNullable<DiagramSelection>, dx: number, dy: number) => {
    const next = cloneDiagramAnnotations(base)
    if (selection.kind === 'stroke') {
      next.strokes = (next.strokes || []).map(s => {
        if (s.id !== selection.id) return s
        return {
          ...s,
          points: (s.points || []).map(p => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) })),
        }
      })
      return next
    }
    const arrows = (next as any).arrows || []
    ;(next as any).arrows = arrows.map((a: any) => {
      if (a.id !== selection.id) return a
      return {
        ...a,
        start: { x: clamp01(a.start.x + dx), y: clamp01(a.start.y + dy) },
        end: { x: clamp01(a.end.x + dx), y: clamp01(a.end.y + dy) },
      }
    })
    return next
  }

  const applyScaleToAnnotations = (
    base: DiagramAnnotations,
    selection: NonNullable<DiagramSelection>,
    anchor: DiagramStrokePoint,
    baseCorner: DiagramStrokePoint,
    currCorner: DiagramStrokePoint
  ) => {
    const baseDx = baseCorner.x - anchor.x
    const baseDy = baseCorner.y - anchor.y
    const currDx = currCorner.x - anchor.x
    const currDy = currCorner.y - anchor.y

    const minNormalizedDelta = 0.01
    const signedClampDelta = (baseDelta: number, currentDelta: number) => {
      if (Math.abs(baseDelta) < 1e-6) return currentDelta
      const dir = baseDelta >= 0 ? 1 : -1
      const projected = currentDelta * dir
      const clamped = Math.max(minNormalizedDelta, projected)
      return clamped * dir
    }

    const safeCurrDx = signedClampDelta(baseDx, currDx)
    const safeCurrDy = signedClampDelta(baseDy, currDy)

    const sx = Math.abs(baseDx) < 1e-6 ? 1 : safeCurrDx / baseDx
    const sy = Math.abs(baseDy) < 1e-6 ? 1 : safeCurrDy / baseDy

    const next = cloneDiagramAnnotations(base)
    const scalePoint = (p: DiagramStrokePoint) => ({
      x: clamp01(anchor.x + (p.x - anchor.x) * sx),
      y: clamp01(anchor.y + (p.y - anchor.y) * sy),
    })

    if (selection.kind === 'stroke') {
      next.strokes = (next.strokes || []).map(s => {
        if (s.id !== selection.id) return s
        return { ...s, points: (s.points || []).map(scalePoint) }
      })
      return next
    }

    const arrows = (next as any).arrows || []
    ;(next as any).arrows = arrows.map((a: any) => {
      if (a.id !== selection.id) return a
      return { ...a, start: scalePoint(a.start), end: scalePoint(a.end) }
    })
    return next
  }

  const loadDiagramsFromServer = useCallback(async () => {
    if (!ENABLE_EMBEDDED_DIAGRAMS) return
    try {
      const res = await fetch(`/api/diagrams?sessionKey=${encodeURIComponent(channelName)}`, { credentials: 'same-origin' })
      if (!res.ok) return
      const payload = await res.json().catch(() => null)
      if (!payload) return

      const rawDiagrams = Array.isArray(payload.diagrams) ? payload.diagrams : []
      const nextDiagrams: DiagramRecord[] = rawDiagrams.map((d: any) => ({
        id: String(d.id),
        title: typeof d.title === 'string' ? d.title : '',
        imageUrl: typeof d.imageUrl === 'string' ? d.imageUrl : '',
        order: typeof d.order === 'number' ? d.order : 0,
        annotations: d.annotations ? normalizeAnnotations(d.annotations) : null,
      }))
      setDiagrams(nextDiagrams)

      const serverState = payload.state
      const nextState: DiagramState = {
        activeDiagramId: typeof serverState?.activeDiagramId === 'string' ? serverState.activeDiagramId : null,
        isOpen: typeof serverState?.isOpen === 'boolean' ? serverState.isOpen : false,
      }

      if (!nextState.activeDiagramId && nextDiagrams.length) {
        nextState.activeDiagramId = nextDiagrams[0].id
      }
      setDiagramState(nextState)
    } catch {
      // ignore; diagrams are optional
    }
  }, [channelName, normalizeAnnotations])

  useEffect(() => {
    if (!userId) return
    if (!ENABLE_EMBEDDED_DIAGRAMS) return
    void loadDiagramsFromServer()
  }, [loadDiagramsFromServer, userId])

  const publishDiagramMessage = useCallback(async (message: DiagramRealtimeMessage) => {
    if (!ENABLE_EMBEDDED_DIAGRAMS) return
    const channel = channelRef.current
    if (!channel) return
    try {
      await channel.publish('diagram', {
        ...message,
        ts: message.ts ?? Date.now(),
        sender: message.sender ?? clientIdRef.current,
      })
    } catch (err) {
      // Non-critical.
      console.warn('Failed to publish diagram message', err)
    }
  }, [])

  const persistDiagramState = useCallback(async (next: DiagramState) => {
    if (!isAdmin) return
    try {
      await fetch('/api/diagrams/state', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionKey: channelName,
          activeDiagramId: next.activeDiagramId,
          isOpen: next.isOpen,
        }),
      })
    } catch {
      // ignore
    }
  }, [channelName, isAdmin])

  const setDiagramOverlayState = useCallback(
    async (next: DiagramState) => {
      setDiagramState(next)
      if (isAdmin) {
        await persistDiagramState(next)
        await publishDiagramMessage({ kind: 'state', activeDiagramId: next.activeDiagramId, isOpen: next.isOpen })
      }
    },
    [isAdmin, persistDiagramState, publishDiagramMessage]
  )

  const persistDiagramAnnotations = useCallback(async (diagramId: string, annotations: DiagramAnnotations | null) => {
    if (!isAdmin) return
    const now = Date.now()
    if (now - diagramLastPersistTsRef.current < 250) return
    diagramLastPersistTsRef.current = now
    try {
      await fetch(`/api/diagrams/${encodeURIComponent(diagramId)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations }),
      })
    } catch {
      // ignore
    }
  }, [isAdmin])

  const commitDiagramAnnotations = useCallback(async (diagramId: string, next: DiagramAnnotations | null, pushUndoFrom?: DiagramAnnotations | null) => {
    if (!isAdmin) return

    if (pushUndoFrom) {
      diagramUndoRef.current.push(cloneDiagramAnnotations(pushUndoFrom))
      diagramRedoRef.current = []
      syncDiagramHistoryFlags()
    }

    applyDiagramAnnotations(diagramId, next)
    await persistDiagramAnnotations(diagramId, next)
    await publishDiagramMessage({ kind: 'annotations-set', diagramId, annotations: next })
  }, [applyDiagramAnnotations, cloneDiagramAnnotations, isAdmin, persistDiagramAnnotations, publishDiagramMessage, syncDiagramHistoryFlags])

  const eraseDiagramAt = useCallback(async (diagramId: string, point: DiagramStrokePoint) => {
    const diagram = diagramsRef.current.find(d => d.id === diagramId)
    if (!diagram) return
    const current = diagram.annotations ? normalizeAnnotations(diagram.annotations) : { strokes: [], arrows: [] }
    const strokes = current.strokes || []
    const arrows = current.arrows || []

    const threshold = 0.018 // normalized radius
    const thresholdSq = threshold * threshold

    let best: { kind: 'stroke' | 'arrow'; id: string; distSq: number } | null = null

    for (const s of strokes) {
      const pts = s.points || []
      if (pts.length === 1) {
        const dSq = diagramPointDistanceSq(point, pts[0])
        if (dSq <= thresholdSq && (!best || dSq < best.distSq)) best = { kind: 'stroke', id: s.id, distSq: dSq }
        continue
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const dSq = diagramDistancePointToSegmentSq(point, pts[i], pts[i + 1])
        if (dSq <= thresholdSq && (!best || dSq < best.distSq)) best = { kind: 'stroke', id: s.id, distSq: dSq }
      }
    }

    for (const a of arrows) {
      const dSq = diagramDistancePointToSegmentSq(point, a.start, a.end)
      if (dSq <= thresholdSq && (!best || dSq < best.distSq)) best = { kind: 'arrow', id: a.id, distSq: dSq }
    }

    if (!best) return

    if (best.kind === 'stroke') {
      const s = strokes.find(s => s.id === best!.id)
      if ((s as any)?.locked) return
    } else {
      const a = arrows.find(a => a.id === best!.id)
      if ((a as any)?.locked) return
    }

    const next: DiagramAnnotations = {
      strokes: best.kind === 'stroke' ? strokes.filter(s => s.id !== best!.id) : strokes,
      arrows: best.kind === 'arrow' ? arrows.filter(a => a.id !== best!.id) : arrows,
    }

    await commitDiagramAnnotations(diagramId, next, current)
  }, [commitDiagramAnnotations, diagramDistancePointToSegmentSq, normalizeAnnotations])

  const deleteSelectionFromAnnotations = (base: DiagramAnnotations, selection: NonNullable<DiagramSelection>) => {
    const next = cloneDiagramAnnotations(base)
    if (selection.kind === 'stroke') {
      next.strokes = (next.strokes || []).filter(s => s.id !== selection.id)
      return next
    }
    const arrows = (next as any).arrows || []
    ;(next as any).arrows = arrows.filter((a: any) => a.id !== selection.id)
    return next
  }

  const transformSelectionInAnnotations = (
    base: DiagramAnnotations,
    selection: NonNullable<DiagramSelection>,
    mapPoint: (p: DiagramStrokePoint) => DiagramStrokePoint
  ) => {
    const next = cloneDiagramAnnotations(base)
    if (selection.kind === 'stroke') {
      next.strokes = (next.strokes || []).map(s => {
        if (s.id !== selection.id) return s
        return { ...s, points: (s.points || []).map(mapPoint) }
      })
      return next
    }
    const arrows = (next as any).arrows || []
    ;(next as any).arrows = arrows.map((a: any) => {
      if (a.id !== selection.id) return a
      return { ...a, start: mapPoint(a.start), end: mapPoint(a.end) }
    })
    return next
  }

  const selectionBboxFromAnnotations = (ann: DiagramAnnotations, selection: NonNullable<DiagramSelection>) => {
    if (selection.kind === 'stroke') {
      const stroke = (ann.strokes || []).find(s => s.id === selection.id)
      if (!stroke) return null
      return bboxFromStroke(stroke)
    }
    const arrows = (ann as any).arrows || []
    const arrow = arrows.find((a: any) => a.id === selection.id)
    if (!arrow) return null
    return bboxFromArrow(arrow)
  }

  const isSelectionLockedInAnnotations = (ann: DiagramAnnotations, selection: NonNullable<DiagramSelection>) => {
    if (selection.kind === 'stroke') {
      const stroke = (ann.strokes || []).find(s => s.id === selection.id)
      return Boolean((stroke as any)?.locked)
    }
    const arrows = (ann as any).arrows || []
    const arrow = arrows.find((a: any) => a.id === selection.id)
    return Boolean(arrow?.locked)
  }

  const getMaxZ = (ann: DiagramAnnotations) => {
    let max = 0
    for (const s of ann.strokes || []) {
      if (typeof (s as any)?.z === 'number' && Number.isFinite((s as any).z)) max = Math.max(max, (s as any).z)
    }
    for (const a of (ann as any).arrows || []) {
      if (typeof a?.z === 'number' && Number.isFinite(a.z)) max = Math.max(max, a.z)
    }
    return max
  }

  const getMinZ = (ann: DiagramAnnotations) => {
    let min = 0
    let hasAny = false
    for (const s of ann.strokes || []) {
      if (typeof (s as any)?.z === 'number' && Number.isFinite((s as any).z)) {
        min = hasAny ? Math.min(min, (s as any).z) : (s as any).z
        hasAny = true
      }
    }
    for (const a of (ann as any).arrows || []) {
      if (typeof a?.z === 'number' && Number.isFinite(a.z)) {
        min = hasAny ? Math.min(min, a.z) : a.z
        hasAny = true
      }
    }
    return hasAny ? min : 0
  }

  const setSelectionZInAnnotations = (base: DiagramAnnotations, selection: NonNullable<DiagramSelection>, z: number) => {
    const next = cloneDiagramAnnotations(base)
    if (selection.kind === 'stroke') {
      next.strokes = (next.strokes || []).map(s => (s.id === selection.id ? ({ ...s, z } as any) : s))
      return next
    }
    const arrows = (next as any).arrows || []
    ;(next as any).arrows = arrows.map((a: any) => (a.id === selection.id ? ({ ...a, z } as any) : a))
    return next
  }

  const setSelectionStyleInAnnotations = (base: DiagramAnnotations, selection: NonNullable<DiagramSelection>, patch: Partial<{ color: string; width: number; locked: boolean }>) => {
    const next = cloneDiagramAnnotations(base)
    if (selection.kind === 'stroke') {
      next.strokes = (next.strokes || []).map(s => {
        if (s.id !== selection.id) return s
        return {
          ...s,
          ...(typeof patch.color === 'string' ? { color: patch.color } : null),
          ...(typeof patch.width === 'number' ? { width: patch.width } : null),
          ...(typeof patch.locked === 'boolean' ? { locked: patch.locked } : null),
        }
      })
      return next
    }
    const arrows = (next as any).arrows || []
    ;(next as any).arrows = arrows.map((a: any) => {
      if (a.id !== selection.id) return a
      return {
        ...a,
        ...(typeof patch.color === 'string' ? { color: patch.color } : null),
        ...(typeof patch.width === 'number' ? { width: patch.width } : null),
        ...(typeof patch.locked === 'boolean' ? { locked: patch.locked } : null),
      }
    })
    return next
  }

  const duplicateSelectionInAnnotations = (base: DiagramAnnotations, selection: NonNullable<DiagramSelection>, dx = 0.02, dy = 0.02) => {
    const next = cloneDiagramAnnotations(base)
    const newId = `${clientIdRef.current}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const maxZ = getMaxZ(base)

    if (selection.kind === 'stroke') {
      const stroke = (base.strokes || []).find(s => s.id === selection.id)
      if (!stroke) return next
      const copy: any = {
        ...cloneDiagramAnnotations({ strokes: [stroke], arrows: [] }).strokes[0],
        id: newId,
        locked: false,
        z: maxZ + 1,
        points: (stroke.points || []).map(p => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) })),
      }
      next.strokes = [...(next.strokes || []), copy]
      return next
    }

    const arrows = (base as any).arrows || []
    const arrow = arrows.find((a: any) => a.id === selection.id)
    if (!arrow) return next
    const copy: any = {
      ...cloneDiagramAnnotations({ strokes: [], arrows: [arrow] } as any).arrows[0],
      id: newId,
      locked: false,
      z: maxZ + 1,
      start: { x: clamp01(arrow.start.x + dx), y: clamp01(arrow.start.y + dy) },
      end: { x: clamp01(arrow.end.x + dx), y: clamp01(arrow.end.y + dy) },
    }
    ;(next as any).arrows = [...((next as any).arrows || []), copy]
    return next
  }

  const applySnapOrSmooth = (base: DiagramAnnotations, selection: NonNullable<DiagramSelection>) => {
    if (selection.kind === 'arrow') {
      const next = cloneDiagramAnnotations(base)
      const arrows = (next as any).arrows || []
      ;(next as any).arrows = arrows.map((a: any) => {
        if (a.id !== selection.id) return a
        const dx = a.end.x - a.start.x
        const dy = a.end.y - a.start.y
        const angle = Math.atan2(dy, dx)
        const snap = Math.PI / 4
        const snapped = Math.round(angle / snap) * snap
        const len = Math.sqrt(dx * dx + dy * dy)
        const ux = Math.cos(snapped)
        const uy = Math.sin(snapped)
        const midX = (a.start.x + a.end.x) / 2
        const midY = (a.start.y + a.end.y) / 2
        const half = len / 2
        return {
          ...a,
          start: { x: clamp01(midX - ux * half), y: clamp01(midY - uy * half) },
          end: { x: clamp01(midX + ux * half), y: clamp01(midY + uy * half) },
        }
      })
      return next
    }

    const next = cloneDiagramAnnotations(base)
    next.strokes = (next.strokes || []).map(s => {
      if (s.id !== selection.id) return s
      const pts = s.points || []
      if (pts.length <= 2) return s
      const out: DiagramStrokePoint[] = [pts[0]]
      const minDistSq = 0.0002
      for (let i = 1; i < pts.length - 1; i++) {
        const last = out[out.length - 1]
        const p = pts[i]
        const dSq = (p.x - last.x) * (p.x - last.x) + (p.y - last.y) * (p.y - last.y)
        if (dSq >= minDistSq) out.push(p)
      }
      out.push(pts[pts.length - 1])
      return { ...s, points: out }
    })
    return next
  }

  const applyDiagramContextAction = useCallback(async (action: string, diagramId: string, selection: NonNullable<DiagramSelection>, point?: DiagramStrokePoint) => {
    const diagram = diagramsRef.current.find(d => d.id === diagramId)
    const before = diagram?.annotations ? normalizeAnnotations(diagram.annotations) : { strokes: [], arrows: [] }

    if (action === 'copy') {
      if (selection.kind === 'stroke') {
        const stroke = (before.strokes || []).find(s => s.id === selection.id)
        if (stroke) diagramClipboardRef.current = { kind: 'stroke', data: cloneDiagramAnnotations({ strokes: [stroke], arrows: [] }).strokes[0] }
      } else {
        const arrows = (before as any).arrows || []
        const arrow = arrows.find((a: any) => a.id === selection.id)
        if (arrow) diagramClipboardRef.current = { kind: 'arrow', data: cloneDiagramAnnotations({ strokes: [], arrows: [arrow] } as any).arrows[0] }
      }
      setDiagramContextMenu(null)
      return
    }

    if (action === 'paste') {
      const clip = diagramClipboardRef.current
      if (!clip || !point) {
        setDiagramContextMenu(null)
        return
      }
      const baseAnn = cloneDiagramAnnotations(before)
      const maxZ = getMaxZ(baseAnn)
      const newId = `${clientIdRef.current}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      if (clip.kind === 'stroke') {
        const stroke = clip.data as DiagramStroke
        const bbox = bboxFromStroke(stroke)
        const cx = (bbox.minX + bbox.maxX) / 2
        const cy = (bbox.minY + bbox.maxY) / 2
        const dx = point.x - cx
        const dy = point.y - cy
        const copy: any = {
          ...cloneDiagramAnnotations({ strokes: [stroke], arrows: [] }).strokes[0],
          id: newId,
          locked: false,
          z: maxZ + 1,
          points: (stroke.points || []).map(pt => ({ x: clamp01(pt.x + dx), y: clamp01(pt.y + dy) })),
        }
        baseAnn.strokes = [...(baseAnn.strokes || []), copy]
        setDiagramContextMenu(null)
        setDiagramSelection({ kind: 'stroke', id: newId })
        await commitDiagramAnnotations(diagramId, baseAnn, before)
        return
      }

      const arrow = clip.data as any
      const bbox = bboxFromArrow(arrow)
      const cx = (bbox.minX + bbox.maxX) / 2
      const cy = (bbox.minY + bbox.maxY) / 2
      const dx = point.x - cx
      const dy = point.y - cy
      const copy: any = {
        ...cloneDiagramAnnotations({ strokes: [], arrows: [arrow] } as any).arrows[0],
        id: newId,
        locked: false,
        z: maxZ + 1,
        start: { x: clamp01(arrow.start.x + dx), y: clamp01(arrow.start.y + dy) },
        end: { x: clamp01(arrow.end.x + dx), y: clamp01(arrow.end.y + dy) },
      }
      ;(baseAnn as any).arrows = [...((baseAnn as any).arrows || []), copy]
      setDiagramContextMenu(null)
      setDiagramSelection({ kind: 'arrow', id: newId })
      await commitDiagramAnnotations(diagramId, baseAnn, before)
      return
    }

    if (action === 'delete') {
      const next = deleteSelectionFromAnnotations(before, selection)
      setDiagramContextMenu(null)
      setDiagramSelection(null)
      await commitDiagramAnnotations(diagramId, next, before)
      return
    }

    if (action === 'duplicate') {
      const next = duplicateSelectionInAnnotations(before, selection)
      setDiagramContextMenu(null)
      await commitDiagramAnnotations(diagramId, next, before)
      return
    }

    if (action === 'bring-front') {
      const next = setSelectionZInAnnotations(before, selection, getMaxZ(before) + 1)
      setDiagramContextMenu(null)
      await commitDiagramAnnotations(diagramId, next, before)
      return
    }
    if (action === 'send-back') {
      const next = setSelectionZInAnnotations(before, selection, getMinZ(before) - 1)
      setDiagramContextMenu(null)
      await commitDiagramAnnotations(diagramId, next, before)
      return
    }

    if (action === 'lock' || action === 'unlock') {
      const next = setSelectionStyleInAnnotations(before, selection, { locked: action === 'lock' })
      setDiagramContextMenu(null)
      await commitDiagramAnnotations(diagramId, next, before)
      return
    }

    if (action.startsWith('set-color:')) {
      const color = action.slice('set-color:'.length)
      const next = setSelectionStyleInAnnotations(before, selection, { color })
      setDiagramContextMenu(null)
      await commitDiagramAnnotations(diagramId, next, before)
      return
    }

    if (action.startsWith('set-width:')) {
      const width = Number(action.slice('set-width:'.length))
      if (!Number.isFinite(width)) {
        setDiagramContextMenu(null)
        return
      }
      const next = setSelectionStyleInAnnotations(before, selection, { width })
      setDiagramContextMenu(null)
      await commitDiagramAnnotations(diagramId, next, before)
      return
    }

    if (action === 'snap-smooth') {
      if (isSelectionLockedInAnnotations(before, selection)) {
        setDiagramContextMenu(null)
        return
      }
      const next = applySnapOrSmooth(before, selection)
      setDiagramContextMenu(null)
      await commitDiagramAnnotations(diagramId, next, before)
      return
    }

    if (isSelectionLockedInAnnotations(before, selection)) {
      setDiagramContextMenu(null)
      return
    }

    const bbox = selectionBboxFromAnnotations(before, selection)
    if (!bbox) {
      setDiagramContextMenu(null)
      return
    }

    const cx = (bbox.minX + bbox.maxX) / 2
    const cy = (bbox.minY + bbox.maxY) / 2

    const mapPoint = (p: DiagramStrokePoint) => {
      if (action === 'flip-h') return { x: clamp01(cx - (p.x - cx)), y: clamp01(p.y) }
      if (action === 'flip-v') return { x: clamp01(p.x), y: clamp01(cy - (p.y - cy)) }
      // rotate 90° clockwise around center
      const dx = p.x - cx
      const dy = p.y - cy
      return { x: clamp01(cx + dy), y: clamp01(cy - dx) }
    }

    const next = transformSelectionInAnnotations(before, selection, mapPoint)
    setDiagramContextMenu(null)
    await commitDiagramAnnotations(diagramId, next, before)
  }, [applySnapOrSmooth, cloneDiagramAnnotations, commitDiagramAnnotations, deleteSelectionFromAnnotations, duplicateSelectionInAnnotations, getMaxZ, getMinZ, normalizeAnnotations, setSelectionStyleInAnnotations, setSelectionZInAnnotations])

  const redrawDiagramCanvas = useCallback(() => {
    const canvas = diagramCanvasRef.current
    const stage = diagramStageRef.current
    const image = diagramImageRef.current
    if (!canvas || !stage || !image) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = stage.getBoundingClientRect()
    const width = Math.max(1, Math.floor(rect.width))
    const height = Math.max(1, Math.floor(rect.height))
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height

    ctx.clearRect(0, 0, width, height)

    const diagramId = activeDiagram?.id
    const annotationsToRender = diagramId ? diagramAnnotationsForRender(diagramId) : { strokes: [], arrows: [] }
    const strokes = annotationsToRender.strokes || []
    const arrows = (annotationsToRender as any)?.arrows || []

    const drawArrow = (arrow: DiagramArrow) => {
      const start = arrow.start
      const end = arrow.end
      const sx = start.x * width
      const sy = start.y * height
      const ex = end.x * width
      const ey = end.y * height
      const dx = ex - sx
      const dy = ey - sy
      const len = Math.sqrt(dx * dx + dy * dy)
      if (!Number.isFinite(len) || len < 2) return
      const ux = dx / len
      const uy = dy / len
      const head = Math.max(8, Math.min(18, arrow.headSize ?? 12))
      const backX = ex - ux * head
      const backY = ey - uy * head
      const perpX = -uy
      const perpY = ux
      const wing = head * 0.55
      const leftX = backX + perpX * wing
      const leftY = backY + perpY * wing
      const rightX = backX - perpX * wing
      const rightY = backY - perpY * wing

      ctx.strokeStyle = arrow.color || '#ef4444'
      ctx.lineWidth = arrow.width || 3
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      ctx.lineTo(backX, backY)
      ctx.stroke()

      ctx.fillStyle = arrow.color || '#ef4444'
      ctx.beginPath()
      ctx.moveTo(ex, ey)
      ctx.lineTo(leftX, leftY)
      ctx.lineTo(rightX, rightY)
      ctx.closePath()
      ctx.fill()
    }

    const items: Array<
      | { kind: 'arrow'; z: number; arrow: DiagramArrow }
      | { kind: 'stroke'; z: number; stroke: DiagramStroke }
    > = []
    ;(arrows as any[]).forEach((a, i) => {
      if (!a?.start || !a?.end) return
      const z = typeof a?.z === 'number' && Number.isFinite(a.z) ? a.z : i
      items.push({ kind: 'arrow', z, arrow: a as any })
    })
    strokes.forEach((s, i) => {
      if (!s.points.length) return
      const z = typeof (s as any)?.z === 'number' && Number.isFinite((s as any).z) ? (s as any).z : 1000 + i
      items.push({ kind: 'stroke', z, stroke: s })
    })
    items.sort((a, b) => a.z - b.z)
    for (const item of items) {
      if (item.kind === 'arrow') {
        drawArrow(item.arrow)
        continue
      }
      const stroke = item.stroke
      ctx.strokeStyle = stroke.color || '#ef4444'
      ctx.lineWidth = stroke.width || 3
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      for (let i = 0; i < stroke.points.length; i++) {
        const p = stroke.points[i]
        const x = p.x * width
        const y = p.y * height
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    const current = diagramCurrentStrokeRef.current
    if (current && current.points.length) {
      ctx.strokeStyle = current.color || '#ef4444'
      ctx.lineWidth = current.width || 3
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      for (let i = 0; i < current.points.length; i++) {
        const p = current.points[i]
        const x = p.x * width
        const y = p.y * height
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    const currentArrow = diagramCurrentArrowRef.current
    if (currentArrow) {
      drawArrow(currentArrow)
    }

    if (diagramId) {
      const sel = diagramSelectionRef.current
      if (sel) {
        const bbox = selectionBbox(diagramId, sel)
        if (bbox) {
          const pad = 0.008
          const minX = Math.max(0, bbox.minX - pad)
          const minY = Math.max(0, bbox.minY - pad)
          const maxX = Math.min(1, bbox.maxX + pad)
          const maxY = Math.min(1, bbox.maxY + pad)
          const x = minX * width
          const y = minY * height
          const w = Math.max(1, (maxX - minX) * width)
          const h = Math.max(1, (maxY - minY) * height)

          ctx.save()
          ctx.strokeStyle = 'rgba(15,23,42,0.85)'
          ctx.lineWidth = 1
          ctx.setLineDash([6, 4])
          ctx.strokeRect(x, y, w, h)
          ctx.setLineDash([])

          const corners = bboxCornerPoints({ minX, minY, maxX, maxY })
          const r = 6
          for (const key of Object.keys(corners) as Array<keyof typeof corners>) {
            const c = corners[key]
            const cx = c.x * width
            const cy = c.y * height
            ctx.fillStyle = '#ffffff'
            ctx.strokeStyle = 'rgba(15,23,42,0.85)'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.arc(cx, cy, r, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
          }
          ctx.restore()
        }
      }
    }
  }, [activeDiagram, diagramAnnotationsForRender, selectionBbox])

  useEffect(() => {
    redrawDiagramCanvas()
  }, [redrawDiagramCanvas, activeDiagram?.id, activeDiagram?.annotations])

  useEffect(() => {
    const stage = diagramStageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') return
    const obs = new ResizeObserver(() => {
      redrawDiagramCanvas()
    })
    diagramResizeObserverRef.current = obs
    obs.observe(stage)
    return () => {
      try {
        obs.disconnect()
      } catch {}
      diagramResizeObserverRef.current = null
    }
  }, [redrawDiagramCanvas])

  const collectEditorSnapshot = useCallback((incrementVersion: boolean): SnapshotPayload | null => {
    const editor = editorInstanceRef.current
    if (!editor) return null

    const model = editor.model ?? {}
    let symbols: any[] | null = null
    try {
      const raw = (model as any).symbols
      const src = Array.isArray(raw) ? raw : (Array.isArray(raw?.events) ? raw.events : null)
      if (src) {
        symbols = JSON.parse(JSON.stringify(src))
      }
    } catch (err) {
      console.warn('Unable to serialize MyScript symbols', err)
      symbols = null
    }

    const exports = model.exports ?? {}
    const latexExport = exports['application/x-latex']
    const jiixRaw = exports['application/vnd.myscript.jiix']

    const snapshot: SnapshotPayload = {
      symbols,
      latex: typeof latexExport === 'string' ? latexExport : '',
      jiix: typeof jiixRaw === 'string' ? jiixRaw : jiixRaw ? JSON.stringify(jiixRaw) : null,
      version: incrementVersion ? ++localVersionRef.current : localVersionRef.current,
      snapshotId: `${clientIdRef.current}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    }

    return snapshot
  }, [])

  const captureFullSnapshot = useCallback((): SnapshotPayload | null => {
    const snapshot = collectEditorSnapshot(false)
    if (!snapshot) return null
    return { ...snapshot, baseSymbolCount: -1 }
  }, [collectEditorSnapshot])

  const applyPageSnapshot = useCallback(
    async (snapshot: SnapshotPayload | null) => {
      const editor = editorInstanceRef.current
      if (!editor) return
      suppressBroadcastUntilTsRef.current = Date.now() + 800
      await nextAnimationFrame()
      editor.clear()
      if (typeof editor.waitForIdle === 'function') await editor.waitForIdle()
      const symbolsArray = snapshot?.symbols
      if (symbolsArray && countSymbols(symbolsArray) > 0) {
        await nextAnimationFrame()
        const points = Array.isArray(symbolsArray)
          ? symbolsArray
          : Array.isArray((symbolsArray as any)?.events)
          ? (symbolsArray as any).events
          : []
        if (points.length) {
          await editor.importPointEvents(points)
          if (typeof editor.waitForIdle === 'function') await editor.waitForIdle()
        }
        if (snapshot?.latex) {
          setLatexOutput(snapshot.latex)
        }
      } else {
        setLatexOutput('')
      }
      const count = countSymbols(symbolsArray)
      lastSymbolCountRef.current = count
      lastBroadcastBaseCountRef.current = count
    },
    []
  )

  const persistCurrentPageSnapshot = useCallback(() => {
    const currentSnapshot = captureFullSnapshot()
    pageRecordsRef.current[pageIndex] = {
      snapshot: currentSnapshot && !isSnapshotEmpty(currentSnapshot) ? currentSnapshot : null,
    }
  }, [captureFullSnapshot, pageIndex])

  const broadcastSnapshot = useCallback(
    (immediate = false, options?: BroadcastOptions) => {
      if (!canPublishSnapshots()) {
        return
      }
      // During quizzes, students work privately (no live ink publishing).
      if (quizActiveRef.current && !hasControllerRights()) {
        return
      }
      if (pageIndex !== sharedPageIndexRef.current && !options?.force) {
        return
      }
      if (isApplyingRemoteRef.current) return
      // Pause overrides everything except forced clears
  if (lockedOutRef.current) return
  if (isBroadcastPausedRef.current && !options?.force) return
      const channel = channelRef.current
      if (!channel) return
      const reason: 'update' | 'clear' = options?.reason ?? 'update'
      // If disconnected, queue snapshot for later instead of attempting publish now
      if (!isRealtimeConnected) {
        const queuedSnapshot = collectEditorSnapshot(true)
        if (queuedSnapshot) {
          const previousCount = lastSymbolCountRef.current
          const currentCount = countSymbols(queuedSnapshot.symbols)
          lastSymbolCountRef.current = currentCount
          const baseCount = reason === 'clear' ? previousCount : lastBroadcastBaseCountRef.current
          const snapshotForQueue: SnapshotPayload = { ...queuedSnapshot, baseSymbolCount: baseCount }
          const isErase = previousCount > 0 && currentCount === 0
          if (reason === 'clear' || isErase || !isSnapshotEmpty(snapshotForQueue)) {
            pendingPublishQueueRef.current.push({ snapshot: snapshotForQueue, ts: Date.now(), reason })
          }
          const canonicalSnapshot: SnapshotPayload = { ...queuedSnapshot, baseSymbolCount: -1 }
          latestSnapshotRef.current = { snapshot: canonicalSnapshot, ts: Date.now(), reason }
          lastBroadcastBaseCountRef.current = currentCount
        }
        return
      }
      const snapshot = collectEditorSnapshot(true)
      if (!snapshot) return
      // Allow broadcasting empty snapshot if it represents an actual erase (previous symbol count > 0)
      const previousCount = lastSymbolCountRef.current
      const currentCount = countSymbols(snapshot.symbols)
      lastSymbolCountRef.current = currentCount
      const isErase = previousCount > 0 && currentCount === 0
      const baseCount = reason === 'clear' ? previousCount : lastBroadcastBaseCountRef.current
      const snapshotForPublish: SnapshotPayload = { ...snapshot, baseSymbolCount: baseCount }
      if (isSnapshotEmpty(snapshotForPublish) && !options?.force && !isErase) {
        return
      }

      const canonicalSnapshot: SnapshotPayload = { ...snapshot, baseSymbolCount: -1 }
      const record: SnapshotRecord = { snapshot: snapshotForPublish, ts: Date.now(), reason }

      latestSnapshotRef.current = { snapshot: canonicalSnapshot, ts: record.ts, reason }
      lastBroadcastBaseCountRef.current = currentCount

      const publish = async () => {
        if (!isRealtimeConnected) {
          pendingPublishQueueRef.current.push(record)
          return
        }
        try {
          await channel.publish('stroke', {
            clientId: clientIdRef.current,
            author: userDisplayName,
            snapshot: record.snapshot,
            ts: record.ts,
            reason: record.reason,
            originClientId: clientIdRef.current,
          })
        } catch (err) {
          console.warn('Failed to publish stroke update', err)
          pendingPublishQueueRef.current.push(record)
        }
      }

      if (immediate) {
        if (pendingBroadcastRef.current) {
          clearTimeout(pendingBroadcastRef.current)
          pendingBroadcastRef.current = null
        }
        publish()
        return
      }

      if (pendingBroadcastRef.current) {
        clearTimeout(pendingBroadcastRef.current)
      }
      pendingBroadcastRef.current = setTimeout(() => {
        pendingBroadcastRef.current = null
        publish()
      }, broadcastDebounceMs)
    },
    [broadcastDebounceMs, canPublishSnapshots, collectEditorSnapshot, hasControllerRights, pageIndex, userDisplayName]
  )

  const publishLatexDisplayState = useCallback(
    async (enabled: boolean, latex: string, options?: LatexDisplayOptions) => {
      if (!canPublishSnapshots()) return
      const channel = channelRef.current
      if (!channel) return
      try {
        await channel.publish('control', {
          clientId: clientIdRef.current,
          author: userDisplayName,
          action: 'latex-display',
          enabled,
          latex,
          options: options ?? latexProjectionOptionsRef.current,
          ts: Date.now(),
        })
      } catch (err) {
        console.warn('Failed to broadcast LaTeX display state', err)
      }
    },
    [canPublishSnapshots, userDisplayName]
  )

  const clearLessonModules = useCallback(async () => {
    if (!hasBoardWriteRights()) return
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('philani-text:script-apply', { detail: { text: null, visible: false } }))
      } catch {}
      try {
        window.dispatchEvent(new CustomEvent('philani-diagrams:script-apply', { detail: { open: false } }))
      } catch {}
    }
    const options = latexProjectionOptionsRef.current
    setLatexDisplayState({ enabled: false, latex: '', options })
    await publishLatexDisplayState(false, '', options)
  }, [hasBoardWriteRights, publishLatexDisplayState])

  const applyLessonScriptPlayback = useCallback(
    async (phaseKey: LessonScriptPhaseKey, nextStepIndex: number) => {
      if (!hasBoardWriteRights()) return
      // If we have schema v2, this legacy function is only used for old scripts.
      const options = latexProjectionOptionsRef.current
      const steps = getLessonScriptPhaseSteps(lessonScriptResolved, phaseKey)
      const clampedIndex = Math.min(Math.max(nextStepIndex, -1), Math.max(steps.length - 1, -1))

      setLessonScriptStepIndex(clampedIndex)

      if (clampedIndex < 0) {
        setLatexDisplayState({ enabled: false, latex: '', options })
        await publishLatexDisplayState(false, '', options)
        return
      }

      const latex = buildLessonScriptLatex(steps, clampedIndex)
      setLatexDisplayState({ enabled: true, latex, options })
      await publishLatexDisplayState(true, latex, options)
    },
    [buildLessonScriptLatex, getLessonScriptPhaseSteps, hasBoardWriteRights, lessonScriptResolved, publishLatexDisplayState]
  )

  const applyLessonScriptPlaybackV2 = useCallback(
    async (phaseKey: LessonScriptPhaseKey, nextPointIndex: number, nextModuleIndex: number) => {
      if (!hasBoardWriteRights()) return
      const v2 = getLessonScriptV2(lessonScriptResolved)
      if (!v2) return

      const phase = v2.phases.find(p => p.key === phaseKey) || null
      const points = phase?.points ?? []
      const pointIndex = points.length ? Math.max(0, Math.min(nextPointIndex, points.length - 1)) : 0
      const point = points[pointIndex] ?? null
      const modules = point?.modules ?? []

      const moduleIndex = Math.min(Math.max(nextModuleIndex, -1), Math.max(modules.length - 1, -1))

      setLessonScriptPointIndex(pointIndex)
      setLessonScriptModuleIndex(moduleIndex)

      if (moduleIndex < 0) {
        await clearLessonModules()
        return
      }

      const mod = modules[moduleIndex] ?? null
      if (!mod) {
        await clearLessonModules()
        return
      }

      // Show only the active module to keep delivery unambiguous.
      if (mod.type === 'text') {
        await clearLessonModules()
        try {
          window.dispatchEvent(new CustomEvent('philani-text:script-apply', { detail: { text: mod.text, visible: true } }))
        } catch {}
        return
      }

      if (mod.type === 'diagram') {
        await clearLessonModules()

        const openByTitle = async (title: string) => {
          const safe = (title || '').trim()
          if (!safe) return
          try {
            window.dispatchEvent(new CustomEvent('philani-diagrams:script-apply', { detail: { title: safe, open: true } }))
          } catch {}
        }

        // If we have a full diagram snapshot from authoring, ensure it exists in this session's diagram store.
        const authored = mod.diagram
        if (authored && authored.title && authored.imageUrl) {
          try {
            const listRes = await fetch(`/api/diagrams?sessionKey=${encodeURIComponent(channelName)}`, { credentials: 'same-origin' })
            const listPayload = await listRes.json().catch(() => null)
            const existing = Array.isArray(listPayload?.diagrams) ? listPayload.diagrams : []
            const match = existing.find((d: any) => String(d?.title || '').trim().toLowerCase() === authored.title.trim().toLowerCase())

            let diagramId: string | null = match?.id ? String(match.id) : null
            if (!diagramId) {
              const createRes = await fetch('/api/diagrams', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionKey: channelName, title: authored.title, imageUrl: authored.imageUrl }),
              })
              const createPayload = await createRes.json().catch(() => null)
              if (createRes.ok && createPayload?.diagram?.id) {
                diagramId = String(createPayload.diagram.id)
              }
            }

            if (diagramId && authored.annotations !== undefined) {
              await fetch(`/api/diagrams/${encodeURIComponent(diagramId)}`, {
                method: 'PATCH',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ annotations: authored.annotations ?? null }),
              })
            }
          } catch {
            // ignore
          }

          await openByTitle(authored.title)
          return
        }

        await openByTitle(mod.title || '')
        return
      }

      if (mod.type === 'latex') {
        // Only clear other modules, keep latex via control channel.
        if (typeof window !== 'undefined') {
          try {
            window.dispatchEvent(new CustomEvent('philani-text:script-apply', { detail: { text: null, visible: false } }))
          } catch {}
          try {
            window.dispatchEvent(new CustomEvent('philani-diagrams:script-apply', { detail: { open: false } }))
          } catch {}
        }
        const options = latexProjectionOptionsRef.current
        setLatexDisplayState({ enabled: true, latex: mod.latex, options })
        await publishLatexDisplayState(true, mod.latex, options)
      }
    },
    [clearLessonModules, getLessonScriptV2, hasControllerRights, lessonScriptResolved, publishLatexDisplayState]
  )

  const startLessonFromScript = useCallback(async () => {
    if (!hasControllerRights()) return
    if (!boardId) return

    const resolved = (await loadLessonScript()) ?? lessonScriptResolved
    if (!resolved || typeof resolved !== 'object') return

    // v2: start at the first phase/point/module that exists, preferring Engage.
    if ((resolved as any).schemaVersion === 2) {
      const v2 = getLessonScriptV2(resolved)
      if (!v2) return
      const ordered = [...LESSON_SCRIPT_PHASES.map(p => p.key)]
      const phases = v2.phases || []

      const findInPhase = (key: LessonScriptPhaseKey) => {
        const phase = phases.find(p => p.key === key)
        if (!phase) return null
        const points = Array.isArray(phase.points) ? phase.points : []
        for (let pi = 0; pi < points.length; pi++) {
          const mods = Array.isArray(points[pi]?.modules) ? points[pi].modules : []
          if (mods.length > 0) return { phaseKey: key, pointIndex: pi, moduleIndex: 0 }
        }
        return null
      }

      let start = findInPhase('engage')
      if (!start) {
        for (const key of ordered) {
          start = findInPhase(key)
          if (start) break
        }
      }

      if (!start) return
      setLessonScriptPhaseKey(start.phaseKey)
      setLessonScriptStepIndex(-1)
      setLessonScriptPointIndex(start.pointIndex)
      setLessonScriptModuleIndex(start.moduleIndex)
      await applyLessonScriptPlaybackV2(start.phaseKey, start.pointIndex, start.moduleIndex)
      return
    }

    // v1: start at first phase with steps.
    for (const phase of LESSON_SCRIPT_PHASES) {
      const steps = getLessonScriptPhaseSteps(resolved, phase.key)
      if (steps.length > 0) {
        setLessonScriptPhaseKey(phase.key)
        setLessonScriptStepIndex(0)
        await applyLessonScriptPlayback(phase.key, 0)
        return
      }
    }
  }, [applyLessonScriptPlayback, applyLessonScriptPlaybackV2, boardId, getLessonScriptPhaseSteps, getLessonScriptV2, hasControllerRights, lessonScriptResolved, loadLessonScript])

  const stackedNotesBroadcastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastStackedNotesBroadcastRef = useRef<{ latex: string; ts: number }>({ latex: '', ts: 0 })
  const publishStackedNotesPreview = useCallback(
    (latex: string, options: LatexDisplayOptions) => {
      if (!canPublishSnapshots()) return
      const channel = channelRef.current
      if (!channel) return

      const trimmed = (latex || '').trim()
      const now = Date.now()
      if (trimmed === lastStackedNotesBroadcastRef.current.latex && now - lastStackedNotesBroadcastRef.current.ts < 250) {
        return
      }

      if (stackedNotesBroadcastTimeoutRef.current) {
        clearTimeout(stackedNotesBroadcastTimeoutRef.current)
        stackedNotesBroadcastTimeoutRef.current = null
      }

      stackedNotesBroadcastTimeoutRef.current = setTimeout(() => {
        stackedNotesBroadcastTimeoutRef.current = null

        // Avoid broadcasting a temporary empty string while the teacher is still writing
        // (recognition can lag and would cause students to see the preview blink).
        const symbolCount = lastSymbolCountRef.current
        if (!trimmed && symbolCount > 0) return

        const ts = Date.now()
        lastStackedNotesBroadcastRef.current = { latex: trimmed, ts }
        channel
          .publish('control', {
            clientId: clientIdRef.current,
            author: userDisplayName,
            action: 'stacked-notes',
            latex: trimmed,
            options,
            ts,
          })
          .catch(err => console.warn('Failed to broadcast stacked notes preview', err))
      }, 220)
    },
    [canPublishSnapshots, userDisplayName]
  )

  useEffect(() => {
    if (!canPublishSnapshots()) return
    if (!latexDisplayStateRef.current.enabled) return
    const trimmed = (latexOutput || '').trim()
    if (trimmed === latexDisplayStateRef.current.latex) return
    setLatexDisplayState(curr => (curr.enabled ? { ...curr, latex: trimmed } : curr))
    publishLatexDisplayState(true, trimmed, latexProjectionOptionsRef.current)
  }, [canPublishSnapshots, latexOutput, publishLatexDisplayState])

  const applySnapshotCore = useCallback(async (message: SnapshotMessage, receivedTs?: number) => {
    const snapshot = message?.snapshot ?? null
    const reason = message?.reason ?? 'update'
    if (!snapshot) return
    const targetClientId = message?.targetClientId
    if (targetClientId && targetClientId !== clientIdRef.current) {
      return
    }
    const msgTs = typeof receivedTs === 'number' ? receivedTs : typeof message?.ts === 'number' ? (message.ts as number) : Date.now()
    const symbolsArray: any[] = Array.isArray(snapshot.symbols)
      ? snapshot.symbols
      : Array.isArray((snapshot.symbols as any)?.events)
      ? (snapshot.symbols as any).events
      : []
    const incomingSymbolCount = symbolsArray.length
    const previousCount = lastSymbolCountRef.current
    const baseCountRaw = typeof snapshot.baseSymbolCount === 'number' ? snapshot.baseSymbolCount : null
    const hasBaseMetadata = baseCountRaw !== null
    const isFullSnapshot = typeof baseCountRaw === 'number' && baseCountRaw < 0
    const baseCount = isFullSnapshot ? 0 : (baseCountRaw ?? undefined)
    const isNewer = msgTs >= lastGlobalUpdateTsRef.current

    if (!isNewer && reason !== 'clear') {
      return
    }

    // Idempotency & origin checks
    if (snapshot.snapshotId && appliedSnapshotIdsRef.current.has(snapshot.snapshotId)) return
  if (message.originClientId && message.originClientId === clientIdRef.current && !targetClientId) return
    const editor = editorInstanceRef.current
    if (!editor) return

    // During quizzes, freeze teacher steps: ignore incoming remote snapshots.
    if (!hasControllerRights() && quizActiveRef.current) {
      return
    }

    const rebuildFromSnapshot = async (count: number) => {
      try {
        await nextAnimationFrame()
        editor.clear()
        if (count > 0) {
          if (typeof editor.waitForIdle === 'function') await editor.waitForIdle()
          await nextAnimationFrame()
          await editor.importPointEvents(symbolsArray)
          if (typeof editor.waitForIdle === 'function') await editor.waitForIdle()
        } else {
          setLatexOutput('')
        }
        lastSymbolCountRef.current = count
        lastBroadcastBaseCountRef.current = count
        return true
      } catch (err) {
        console.error('Failed to rebuild from snapshot', err)
        return false
      }
    }

    const applyDelta = async (startIndex: number) => {
      const delta = symbolsArray.slice(startIndex)
      if (!delta.length) return false
      try {
        await nextAnimationFrame()
        await editor.importPointEvents(delta)
        if (typeof editor.waitForIdle === 'function') await editor.waitForIdle()
        lastSymbolCountRef.current = previousCount + delta.length
        lastBroadcastBaseCountRef.current = lastSymbolCountRef.current
        return true
      } catch (err) {
        console.warn('Delta import failed; attempting full rebuild', err)
        return rebuildFromSnapshot(incomingSymbolCount)
      }
    }

    isApplyingRemoteRef.current = true
    try {
      let applied = false
      if (reason === 'clear') {
        editor.clear()
        if (typeof editor.waitForIdle === 'function') await editor.waitForIdle()
        setLatexOutput('')
        lastSymbolCountRef.current = 0
        lastBroadcastBaseCountRef.current = 0
        applied = true
      } else if (isFullSnapshot) {
        applied = await rebuildFromSnapshot(incomingSymbolCount)
      } else if (hasBaseMetadata && typeof baseCount === 'number') {
        if (incomingSymbolCount < baseCount || baseCount > previousCount) {
          applied = await rebuildFromSnapshot(incomingSymbolCount)
        } else {
          applied = await applyDelta(baseCount)
        }
      } else {
        // Fallback for legacy payloads without base metadata
        if (incomingSymbolCount === 0 && previousCount === 0) {
          return
        }
        if (incomingSymbolCount < previousCount) {
          applied = await rebuildFromSnapshot(incomingSymbolCount)
        } else if (incomingSymbolCount > previousCount) {
          applied = await applyDelta(previousCount)
        }
      }

      if (!applied) {
        return
      }

      appliedVersionRef.current = snapshot.version
      lastAppliedRemoteVersionRef.current = snapshot.version
      suppressBroadcastUntilTsRef.current = Date.now() + 500
      if (snapshot.snapshotId) {
        appliedSnapshotIdsRef.current.add(snapshot.snapshotId)
        if (appliedSnapshotIdsRef.current.size > 200) {
          const iter = appliedSnapshotIdsRef.current.values()
          appliedSnapshotIdsRef.current.delete(iter.next().value as string)
        }
      }
      const canonical = captureFullSnapshot()
      if (canonical) {
        latestSnapshotRef.current = { snapshot: canonical, ts: msgTs, reason }
      }
      if (isNewer || reason === 'clear') {
        lastGlobalUpdateTsRef.current = Math.max(lastGlobalUpdateTsRef.current, msgTs)
      }
    } catch (err) {
      console.error('Failed to apply remote snapshot', err)
    } finally {
      isApplyingRemoteRef.current = false
      setIsConverting(false)
    }
  }, [captureFullSnapshot])

  const scheduleRemoteProcessing = useCallback(() => {
    if (remoteProcessingRef.current) {
      return
    }
    const processNext = () => {
      const task = pendingRemoteSnapshotsRef.current.shift()
      if (!task) {
        remoteProcessingRef.current = false
        remoteFrameHandleRef.current = null
        return
      }
      applySnapshotCore(task.message, task.receivedTs)
        .catch(err => {
          console.error('Remote snapshot application failed', err)
        })
        .finally(() => {
          if (pendingRemoteSnapshotsRef.current.length) {
            if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
              remoteFrameHandleRef.current = setTimeout(processNext, 16)
            } else {
              remoteFrameHandleRef.current = window.requestAnimationFrame(() => processNext())
            }
          } else {
            remoteProcessingRef.current = false
            remoteFrameHandleRef.current = null
          }
        })
    }

    remoteProcessingRef.current = true
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      remoteFrameHandleRef.current = setTimeout(processNext, 0)
    } else {
      remoteFrameHandleRef.current = window.requestAnimationFrame(() => processNext())
    }
  }, [applySnapshotCore])

  const enqueueSnapshot = useCallback(
    (message: SnapshotMessage, receivedTs?: number) => {
      pendingRemoteSnapshotsRef.current.push({ message, receivedTs })
      scheduleRemoteProcessing()
    },
    [scheduleRemoteProcessing]
  )

  const enforceAuthoritativeSnapshot = useCallback(() => {
    if (hasControllerRights()) {
      return
    }
    const record = latestSnapshotRef.current
    if (!record || !record.snapshot) {
      const editor = editorInstanceRef.current
      editor?.clear?.()
      return
    }
    applySnapshotCore(
      {
        snapshot: record.snapshot,
        reason: record.reason ?? 'update',
        ts: record.ts,
        originClientId: '__authority__',
      },
      Date.now()
    ).catch(err => {
      console.warn('Failed to enforce authoritative snapshot', err)
    })
  }, [applySnapshotCore, hasControllerRights])

  const normalizeStepLatex = useCallback((value: string) => {
    const raw = String(value || '').trim()
    if (!raw) return ''
    // Strip a surrounding aligned environment so we can safely re-wrap.
    const stripped = raw
      .replace(/^\s*\\begin\{aligned\}/, '')
      .replace(/\\end\{aligned\}\s*$/, '')
      .trim()
    return stripped
  }, [])

  const prettyPrintTitleFromLatex = useCallback((value: string) => {
    const raw = normalizeStepLatex(value)
    if (!raw) return 'Notes'

    const simplified = raw
      .replace(/\$\$?/g, '')
      .replace(/\\\(|\\\)/g, '')
      .replace(/\\begin\{[^}]+\}|\\end\{[^}]+\}/g, '')
      .replace(/\\(left|right)/g, '')
      .replace(/&/g, ' ')
      .replace(/\\{2,}/g, ' ')
      .replace(/\\(quad|qquad|,|;|:|!)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    return simplified.length > 72 ? `${simplified.slice(0, 72).trim()}…` : simplified
  }, [normalizeStepLatex])

  const createSessionNoteId = useCallback(() => {
    try {
      const cryptoAny = (globalThis as any)?.crypto
      if (cryptoAny?.randomUUID) return `q_${cryptoAny.randomUUID()}`
    } catch {}
    const rand = Math.random().toString(16).slice(2)
    return `q_${Date.now().toString(16)}_${rand}`
  }, [])

  const exportLatexFromEditor = useCallback(async () => {
    const editor = editorInstanceRef.current
    if (!editor) return ''

    const extract = (payload: any) => {
      if (!payload) return ''
      if (typeof payload === 'string') return payload
      if (typeof payload === 'object') {
        const direct = payload['application/x-latex']
        if (typeof direct === 'string') return direct
        // Some SDKs return arrays or nested objects; best-effort extract.
        const first = (payload as any)[0]
        if (typeof first === 'string') return first
        if (first && typeof first === 'object' && typeof first['application/x-latex'] === 'string') return first['application/x-latex']
      }
      return ''
    }

    try {
      if (typeof editor.export_ === 'function') {
        let res = await editor.export_()
        let latex = extract(res)
        if (!latex) {
          res = await editor.export_(['application/x-latex'])
          latex = extract(res)
        }
        if (!latex) {
          res = await editor.export_('application/x-latex')
          latex = extract(res)
        }
        return typeof latex === 'string' ? latex : ''
      }
      if (typeof editor.export === 'function') {
        const res = await editor.export()
        const latex = extract(res)
        return typeof latex === 'string' ? latex : ''
      }
    } catch (err) {
      console.warn('Failed to export LaTeX', err)
    }
    return ''
  }, [])

  const getLatexFromEditorModel = useCallback(() => {
    const editor = editorInstanceRef.current
    const exports = editor?.model?.exports ?? {}
    const latex = exports?.['application/x-latex']
    return typeof latex === 'string' ? latex : ''
  }, [])

  // Used to safely re-initialize the iink editor when admin layout switches on mobile.
  // Learners always use the stacked layout, so we avoid coupling re-init to isCompactViewport for them.
  const editorInitLayoutKey = hasControllerRights() ? (isCompactViewport ? 'admin-compact' : 'admin-wide') : 'learner'
  const editorInitKey = `${editorInitLayoutKey}:${editorReinitNonce}`

  const triggerEditorReinit = useCallback((reason?: string) => {
    if (editorReconnectingRef.current) return
    editorReconnectingRef.current = true
    suppressNextLoadingOverlayRef.current = true
    setEditorReconnecting(true)
    setFatalError(null)
    // Intentionally do not show the raw engine error text here.
    // This path is used for the iink "session expired" / max-duration cases and should be seamless.
    setEditorReinitNonce(n => n + 1)
  }, [])

  useEffect(() => {
    if (!editorReconnecting) return
    if (status === 'ready') {
      setEditorReconnecting(false)
      editorReconnectingRef.current = false
      suppressNextLoadingOverlayRef.current = false
      return
    }
    if (status === 'error') {
      setEditorReconnecting(false)
      editorReconnectingRef.current = false
      suppressNextLoadingOverlayRef.current = false
    }
  }, [editorReconnecting, status])

  useEffect(() => {
    let cancelled = false
    const host = editorHostRef.current

    if (!host) {
      return
    }

    const appKey = process.env.NEXT_PUBLIC_MYSCRIPT_APPLICATION_KEY
    const hmacKey = process.env.NEXT_PUBLIC_MYSCRIPT_HMAC_KEY
    const scheme = process.env.NEXT_PUBLIC_MYSCRIPT_SERVER_SCHEME || 'https'
    const websocketHost = process.env.NEXT_PUBLIC_MYSCRIPT_SERVER_HOST || 'webdemoapi.myscript.com'

    if (!appKey || !hmacKey) {
  setStatus('error')
  setFatalError(missingKeyMessage)
      return
    }

    if (!suppressNextLoadingOverlayRef.current) {
      setStatus('loading')
    }
  setFatalError(null)

    let resizeHandler: (() => void) | null = null
    const listeners: Array<{ type: string; handler: (event: any) => void }> = []

    loadIinkRuntime()
      .then(async () => {
        if (cancelled) return
        if (!window.iink?.Editor?.load) {
          throw new Error('MyScript iink runtime did not expose the expected API.')
        }

        const waitForHostSize = async () => {
          if (typeof window === 'undefined') return

          const isSized = () => host.clientWidth > 0 && host.clientHeight > 0
          if (isSized()) return

          await new Promise<void>(resolve => {
            let done = false
            let resizeObserver: ResizeObserver | null = null
            let intervalHandle: ReturnType<typeof setInterval> | null = null

            const cleanup = () => {
              if (done) return
              done = true
              try {
                window.removeEventListener('resize', tick)
              } catch {}
              if (resizeObserver) {
                try {
                  resizeObserver.disconnect()
                } catch {}
                resizeObserver = null
              }
              if (intervalHandle) {
                clearInterval(intervalHandle)
                intervalHandle = null
              }
              resolve()
            }

            const tick = () => {
              if (done) return
              if (cancelled) {
                cleanup()
                return
              }
              if (isSized()) {
                cleanup()
              }
            }

            window.addEventListener('resize', tick)

            if (typeof ResizeObserver !== 'undefined') {
              resizeObserver = new ResizeObserver(() => tick())
              resizeObserver.observe(host)
            }

            intervalHandle = setInterval(tick, 100)

            // Kick layout once; helpful when the canvas just became visible.
            setTimeout(() => {
              if (done || cancelled) return
              try {
                window.dispatchEvent(new Event('resize'))
              } catch {}
            }, 50)

            tick()
          })
        }

        await waitForHostSize()
        if (cancelled) return

        const options = {
          configuration: {
            server: {
              scheme,
              host: websocketHost,
              applicationKey: appKey,
              hmacKey,
            },
            recognition: {
              type: 'MATH',
              math: {
                mimeTypes: ['application/x-latex', 'application/vnd.myscript.jiix'],
                solver: {
                  enable: true,
                },
              },
            },
          },
        }

        const editor = await window.iink.Editor.load(host, 'MATH', options)
        if (cancelled) {
          editor.destroy?.()
          return
        }

        editorInstanceRef.current = editor
        setEraserShimReady(installIinkEraserPointerTypeShim(editor, () => isEraserModeRef.current))
        setStatus('ready')

        // Ensure the editor has a valid view size after any initial layout shifts.
        try {
          editor.resize?.()
        } catch {}

        const handleChanged = (evt: any) => {
          setCanUndo(Boolean(evt.detail?.canUndo))
          setCanRedo(Boolean(evt.detail?.canRedo))
          setCanClear(Boolean(evt.detail?.canClear))
          const now = Date.now()
          if (now < suppressBroadcastUntilTsRef.current) {
            return
          }
          // Respect assignment override + general lock state.
          // `lockedOutRef` is the single source of truth for whether the current user
          // is allowed to edit/publish (it already includes `forceEditableForAssignment`).
          if (!isAdmin && lockedOutRef.current) {
            enforceAuthoritativeSnapshot()
            return
          }
          const isSharedPage = pageIndex === sharedPageIndexRef.current
          const canSend = canPublishSnapshots() && isSharedPage && !isBroadcastPausedRef.current && !lockedOutRef.current
          const snapshot = collectEditorSnapshot(canSend)
          if (!snapshot) return
          if (snapshot.version === lastAppliedRemoteVersionRef.current) return
          // Update local symbol count tracking for accurate delta math for remote peers.
          lastSymbolCountRef.current = countSymbols(snapshot.symbols)
          if (canSend) {
            broadcastSnapshot(false)
          }

          // Admin compact/stacked mode: keep a live typeset preview updated without mutating the ink.
          if (useAdminStepComposer) {
            if (pendingExportRef.current) {
              clearTimeout(pendingExportRef.current)
            }
            pendingExportRef.current = setTimeout(() => {
              pendingExportRef.current = null
              if (previewExportInFlightRef.current) return
              previewExportInFlightRef.current = true
              ;(async () => {
                let latexValue = getLatexFromEditorModel()
                if (!latexValue || latexValue.trim().length === 0) {
                  const exported = await exportLatexFromEditor()
                  latexValue = typeof exported === 'string' ? exported : ''
                }
                if (cancelled) return
                setLatexOutput(latexValue)
                const normalized = normalizeStepLatex(latexValue)
                // In edit mode, we want the draft to track the current ink, including scratch-to-erase.
                // So we allow the draft to become empty.
                setAdminDraftLatex(normalized)
              })()
                .finally(() => {
                  previewExportInFlightRef.current = false
                })
            }, 450)
          }

          // Student quiz/assignment mode: show a live LaTeX preview while the learner writes.
          // (The normal student view doesn't continuously export LaTeX, so we enable it for
          // active quizzes and for assignment pages that use the same commit-then-submit flow.)
          if (!isAdmin && (quizActiveRef.current || isAssignmentViewRef.current)) {
            if (studentQuizPreviewExportRef.current) {
              clearTimeout(studentQuizPreviewExportRef.current)
            }
            studentQuizPreviewExportRef.current = setTimeout(() => {
              studentQuizPreviewExportRef.current = null
              if (studentQuizPreviewExportInFlightRef.current) return
              studentQuizPreviewExportInFlightRef.current = true
              ;(async () => {
                let latexValue = getLatexFromEditorModel()
                if (!latexValue || latexValue.trim().length === 0) {
                  const exported = await exportLatexFromEditor()
                  latexValue = typeof exported === 'string' ? exported : ''
                }
                if (cancelled) return
                setLatexOutput(latexValue)
              })()
                .finally(() => {
                  studentQuizPreviewExportInFlightRef.current = false
                })
            }, 350)
          }
        }
        const handleExported = (evt: any) => {
          const exports = evt.detail || {}
          const latex = exports['application/x-latex'] || ''
          const latexValue = typeof latex === 'string' ? latex : ''
          setLatexOutput(latexValue)
          setIsConverting(false)

          const isSharedPage = pageIndex === sharedPageIndexRef.current
          const canSend = canPublishSnapshots() && isSharedPage && !isBroadcastPausedRef.current && !lockedOutRef.current
          if (forcedConvertDepthRef.current > 0) {
            forcedConvertDepthRef.current = Math.max(0, forcedConvertDepthRef.current - 1)
            return
          }
          if (canSend) {
            broadcastSnapshot(true)
          }
        }
        const handleError = (evt: any) => {
          const raw = evt?.detail?.message || evt?.message || 'Unknown error from MyScript editor.'
          const lower = String(raw).toLowerCase()
          const isSessionTooLong = /(session too long|max session duration|session is too old)/.test(lower)
          const isAuthMissing = /missing.*key|unauthorized|forbidden/.test(lower)
          const isSymbolsUndefined = /cannot read properties of undefined.*symbols/i.test(raw)
          const shouldAutoReconnect = isSessionTooLong
          const fatal = isAuthMissing

          if (shouldAutoReconnect) {
            triggerEditorReinit(raw)
            return
          }

          if (fatal) {
            setFatalError(raw)
            setStatus('error')
            return
          }
          // Transient: keep canvas usable
          setTransientError(raw)
          // Auto-clear transient after 6s
          setTimeout(() => {
            setTransientError(curr => (curr === raw ? null : curr))
          }, 6000)
        }

        listeners.push({ type: 'changed', handler: handleChanged })
        listeners.push({ type: 'exported', handler: handleExported })
        listeners.push({ type: 'error', handler: handleError })

        listeners.forEach(({ type, handler }) => {
          editor.event.addEventListener(type, handler)
        })

        resizeHandler = () => {
          editor.resize()
        }
        window.addEventListener('resize', resizeHandler)
      })
      .catch(err => {
        if (cancelled) return
        console.error('MyScript initialization failed', err)
        setFatalError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      })

    return () => {
      cancelled = true
      if (pendingBroadcastRef.current) {
        clearTimeout(pendingBroadcastRef.current)
        pendingBroadcastRef.current = null
      }
      if (pendingExportRef.current) {
        clearTimeout(pendingExportRef.current)
        pendingExportRef.current = null
      }
      listeners.forEach(({ type, handler }) => {
        try {
          editorInstanceRef.current?.event?.removeEventListener(type, handler)
        } catch (err) {
          // ignore during teardown
        }
      })
      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler)
      }
      if (editorInstanceRef.current) {
        try {
          editorInstanceRef.current.destroy?.()
        } catch (err) {
          // ignore during teardown
        }
        editorInstanceRef.current = null
      }

      if (eraserLongPressTimeoutRef.current) {
        clearTimeout(eraserLongPressTimeoutRef.current)
        eraserLongPressTimeoutRef.current = null
      }
    }
  }, [broadcastSnapshot, canPublishSnapshots, editorInitKey, exportLatexFromEditor, normalizeStepLatex, triggerEditorReinit, useAdminStepComposer])

  useEffect(() => {
    if (!useAdminStepComposer) return
    setAdminSteps([])
    setAdminDraftLatex('')
    setAdminSendingStep(false)
    setAdminEditIndex(null)
  }, [boardId, useAdminStepComposer])

  useEffect(() => {
    if (status !== 'ready') {
      return
    }

    const editor = editorInstanceRef.current
    if (!editor) {
      return
    }

    let disposed = false
    let channel: any = null
    let realtime: any = null
    const scheduleRealtimeRetry = () => {
      if (disposed) return
      if (realtimeRetryTimeoutRef.current) return
      const attempt = reconnectAttemptsRef.current || 1
      const delay = Math.min(30000, 2000 * attempt)
      realtimeRetryTimeoutRef.current = setTimeout(() => {
        realtimeRetryTimeoutRef.current = null
        if (!disposed) {
          setupRealtime()
        }
      }, delay)
    }

    const setupRealtime = async () => {
      try {
        const Ably = await import('ably')
        realtime = new Ably.Realtime.Promise({
          authUrl: `/api/realtime/ably-token?clientId=${encodeURIComponent(clientIdRef.current)}`,
          autoConnect: true,
          closeOnUnload: false,
          transports: ['web_socket', 'xhr_streaming', 'xhr_polling'],
        })

  realtimeRef.current = realtime

        await new Promise<void>((resolve, reject) => {
          realtime.connection.once('connected', () => {
            setIsRealtimeConnected(true)
            resolve()
          })
          realtime.connection.once('failed', err => {
            setIsRealtimeConnected(false)
            reject(err)
          })
        })
        // Connection state tracking & reauth with attempt counter
        realtime.connection.on('state', async (stateChange: any) => {
          const state = stateChange?.current
          const connected = state === 'connected'
          setIsRealtimeConnected(connected)
          if (connected && pendingPublishQueueRef.current.length && channelRef.current && canPublishSnapshots()) {
            const toSend = [...pendingPublishQueueRef.current]
            pendingPublishQueueRef.current = []
            for (const rec of toSend) {
              try {
                await channelRef.current.publish('stroke', {
                  clientId: clientIdRef.current,
                  author: userDisplayName,
                  snapshot: rec.snapshot,
                  ts: rec.ts,
                  reason: rec.reason,
                  originClientId: clientIdRef.current,
                })
                lastBroadcastBaseCountRef.current = countSymbols(rec.snapshot.symbols)
              } catch (e) {
                console.warn('Retry publish failed', e)
                pendingPublishQueueRef.current.push(rec)
              }
            }
            reconnectAttemptsRef.current = 0
          }
          if (!connected && (state === 'closed' || state === 'failed')) {
            try {
              reconnectAttemptsRef.current += 1
              await realtime.auth.authorize({ force: true })
              realtime.connect()
            } catch (reauthErr) {
              console.warn('Reauth attempt failed', reauthErr)
            }
          }
        })

        if (disposed) return

        channel = realtime.channels.get(channelName)
        channelRef.current = channel
        await channel.attach()

        const handleStroke = (message: any) => {
          if (!isAdmin && latexDisplayStateRef.current.enabled) {
            return
          }
          const data = message?.data as SnapshotMessage
          if (!data || data.clientId === clientIdRef.current) return
          enqueueSnapshot(data, typeof message?.timestamp === 'number' ? message.timestamp : undefined)
        }

        const handleSyncState = (message: any) => {
          if (!isAdmin && latexDisplayStateRef.current.enabled) {
            return
          }
          const data = message?.data as SnapshotMessage
          if (!data || data.clientId === clientIdRef.current) return
          enqueueSnapshot(data, typeof message?.timestamp === 'number' ? message.timestamp : undefined)
        }

        const handleSyncRequest = async (message: any) => {
          const data = message?.data
          if (!data || data.clientId === clientIdRef.current) return
          if (!canPublishSnapshots()) return
          const existingRecord = (() => {
            if (latestSnapshotRef.current) {
              return latestSnapshotRef.current
            }
            const freshSnapshot = captureFullSnapshot()
            if (!freshSnapshot) {
              return null
            }
            if (isSnapshotEmpty(freshSnapshot)) {
              return null
            }
            const record: SnapshotRecord = {
              snapshot: freshSnapshot,
              ts: Date.now(),
              reason: 'update',
            }
            latestSnapshotRef.current = record
            // Mark our local publish as the latest global update
            lastGlobalUpdateTsRef.current = record.ts
            return record
          })()

          if (!existingRecord) return
          try {
            await channel.publish('sync-state', {
              clientId: clientIdRef.current,
              author: userDisplayName,
              snapshot: existingRecord.snapshot,
              ts: existingRecord.ts,
              reason: existingRecord.reason ?? 'update',
              originClientId: clientIdRef.current,
            })
          } catch (err) {
            console.warn('Failed to publish sync-state', err)
          }
        }

        const handleControlMessage = (message: any) => {
          const data = message?.data as {
            clientId?: string
            locked?: boolean
            controllerId?: string
            controllerName?: string
            ts?: number
            action?: 'wipe' | 'convert' | 'force-resync' | 'latex-display' | 'stacked-notes' | 'quiz' | 'controller-eligibility' | 'controller-rights' | 'controller-rights-reset' | 'controller-highlight' | 'presenter-set' | 'shared-page'
            targetClientId?: string
            targetClientIds?: string[]
            snapshot?: SnapshotPayload | null
            enabled?: boolean
            allowed?: boolean
            presenterUserKey?: string | null
            sharedPageIndex?: number
            quizId?: string
            quizLabel?: string
            quizPhaseKey?: string
            quizPointId?: string
            quizPointIndex?: number
            prompt?: string
            durationSec?: number
            endsAt?: number
            latex?: string
            options?: Partial<LatexDisplayOptions>
            phase?: 'active' | 'inactive' | 'submit'
            combinedLatex?: string
            fromUserId?: string
            fromName?: string
          }

          if (data?.action === 'presenter-set') {
            const incomingKey = typeof (data as any).presenterUserKey === 'string' ? String((data as any).presenterUserKey) : ''
            const nextKey = incomingKey ? incomingKey : null
            setActivePresenterUserKey(nextKey)
            activePresenterUserKeyRef.current = nextKey ? incomingKey : ''

            const targets: string[] = Array.isArray((data as any).targetClientIds)
              ? (data as any).targetClientIds.filter((id: unknown): id is string => typeof id === 'string')
              : []
            const fallbackTarget = typeof data.targetClientId === 'string' ? data.targetClientId : ''
            const dedupedTargets: string[] = targets.length ? Array.from(new Set(targets)) : (fallbackTarget ? [fallbackTarget] : [])
            activePresenterClientIdsRef.current = new Set(dedupedTargets)

            // If the presenter was cleared (admin reclaim), ensure nobody flushes queued publishes.
            if (!nextKey) {
              pendingPublishQueueRef.current = []
            }

            // Presenter changes affect write/publish permissions. Recompute immediately for everyone,
            // including demoted presenters, before any early returns.
            updateControlState(controlStateRef.current)

            // If we're not the active presenter, immediately stop any queued publishes.
            if (nextKey && !(selfUserKey && nextKey === selfUserKey) && !activePresenterClientIdsRef.current.has(clientIdRef.current || '')) {
              pendingPublishQueueRef.current = []
              return
            }

            // If we ARE the active presenter, immediately assert our current page + state.
            if (nextKey) {
              const currentPage = pageIndexRef.current
              setSharedPageIndex(currentPage)
              void publishSharedPage(currentPage, Date.now())
              void forcePublishCanvas(undefined, { shareIndex: currentPage })
            }
            return
          }

          if (data?.action === 'shared-page') {
            const idxRaw = (data as any).sharedPageIndex
            const idx = (typeof idxRaw === 'number' && Number.isFinite(idxRaw)) ? Math.max(0, Math.trunc(idxRaw)) : 0
            setSharedPageIndex(idx)

            // Everyone except the active presenter follows the presenter's shared page.
            const isPresenter = isSelfActivePresenter()
            if (!isPresenter) {
              // Ensure local page list can represent this page index.
              while (pageRecordsRef.current.length <= idx) {
                pageRecordsRef.current.push({ snapshot: null })
              }
              if (pageIndexRef.current !== idx) {
                setPageIndex(idx)
              }
              try {
                editor?.clear?.()
              } catch {}
              setLatexOutput('')
              lastSymbolCountRef.current = 0
              lastBroadcastBaseCountRef.current = 0
              void requestSyncFromPublisher()
            }
            return
          }
          if (data?.action === 'quiz') {
            const phase = data.phase
            // Teacher sees incoming submissions in realtime; minimal UX for now.
            if (isAdmin && phase === 'submit') {
              const who = (data.fromName || 'Student').trim()
              const combined = (data.combinedLatex || '').trim()
              if (combined) {
                console.log(`[quiz submit] ${who}:`, combined)
              } else {
                console.log(`[quiz submit] ${who}: (empty)`)
              }
              return
            }

            // Students: enter/exit quiz mode via teacher broadcast.
            if (!isAdmin) {
              if (phase === 'active') {
                // Capture the pre-quiz control state once per quiz so we can restore it
                // after the student receives AI feedback (or when the teacher ends the quiz).
                if (!preQuizControlCapturedRef.current) {
                  const pre = (data as any)?.preQuizControl
                  if (pre === null) {
                    preQuizControlStateRef.current = null
                    preQuizControlCapturedRef.current = true
                  } else if (pre && typeof pre === 'object' && typeof (pre as any).controllerId === 'string') {
                    preQuizControlStateRef.current = {
                      controllerId: String((pre as any).controllerId),
                      controllerName: typeof (pre as any).controllerName === 'string' ? String((pre as any).controllerName) : undefined,
                      ts: (typeof (pre as any).ts === 'number' && Number.isFinite((pre as any).ts)) ? Math.trunc((pre as any).ts) : Date.now(),
                    }
                    preQuizControlCapturedRef.current = true
                  } else {
                    // Fallback (less accurate): snapshot whatever control state we currently have.
                    preQuizControlStateRef.current = controlStateRef.current ?? null
                    preQuizControlCapturedRef.current = true
                  }
                }

                quizIdRef.current = typeof data.quizId === 'string' ? data.quizId : ''
                quizPromptRef.current = typeof data.prompt === 'string' ? data.prompt : ''
                quizLabelRef.current = typeof data.quizLabel === 'string' ? data.quizLabel : ''
                quizPhaseKeyRef.current = typeof data.quizPhaseKey === 'string' ? data.quizPhaseKey : ''
                quizPointIdRef.current = typeof data.quizPointId === 'string' ? data.quizPointId : ''
                quizPointIndexRef.current = (typeof data.quizPointIndex === 'number' && Number.isFinite(data.quizPointIndex)) ? Math.trunc(data.quizPointIndex) : -1

                // During quizzes, students must be able to write on their canvas.
                // We still expect the teacher to broadcast the corresponding unlock control message,
                // but apply a local unlock here as a safety net in case messages arrive out-of-order.
                if (!forceEditableForAssignment) {
                  updateControlState({ controllerId: ALL_STUDENTS_ID, controllerName: 'All Students', ts: Date.now() })
                }

                const endsAt = (typeof data.endsAt === 'number' && Number.isFinite(data.endsAt) && data.endsAt > 0) ? Math.trunc(data.endsAt) : null
                const durationSec = (typeof data.durationSec === 'number' && Number.isFinite(data.durationSec) && data.durationSec > 0) ? Math.trunc(data.durationSec) : null
                quizEndsAtRef.current = endsAt
                quizDurationSecRef.current = durationSec
                quizAutoSubmitTriggeredRef.current = false

                if (quizCountdownIntervalRef.current) {
                  clearInterval(quizCountdownIntervalRef.current)
                  quizCountdownIntervalRef.current = null
                }
                if (endsAt) {
                  const tick = () => {
                    const remainingSec = Math.ceil((endsAt - Date.now()) / 1000)
                    setQuizTimeLeftSec(Math.max(0, remainingSec))
                  }
                  tick()
                  quizCountdownIntervalRef.current = setInterval(tick, 250)
                } else {
                  setQuizTimeLeftSec(null)
                }

                // Best-effort sound cue; browser may block autoplay.
                playSnapSound()

                // Capture baseline (the teacher's last visible state) and clear the work area.
                const baseline = latestSnapshotRef.current?.snapshot ?? captureFullSnapshot()
                quizBaselineSnapshotRef.current = baseline ? { ...baseline, baseSymbolCount: -1 } : null
                quizCombinedLatexRef.current = ''
                quizHasCommittedRef.current = false
                setStudentCommittedLatex('')
                setQuizActiveState(true)
                suppressBroadcastUntilTsRef.current = Date.now() + 800
                try {
                  editor?.clear?.()
                } catch {}
                lastSymbolCountRef.current = 0
                lastBroadcastBaseCountRef.current = 0
                setLatexOutput('')
                return
              }
              if (phase === 'inactive') {
                setQuizActiveState(false)
                clearQuizCountdown()
                quizCombinedLatexRef.current = ''
                quizHasCommittedRef.current = false
                setStudentCommittedLatex('')
                quizIdRef.current = ''
                quizPromptRef.current = ''
                quizLabelRef.current = ''
                quizPhaseKeyRef.current = ''
                quizPointIdRef.current = ''
                quizPointIndexRef.current = -1

                // Ensure all quiz-specific UI clears (including any local feedback popup).
                try {
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('philani-text:local-apply', {
                      detail: { id: 'quiz-feedback', visible: false },
                    }))
                  }
                } catch {}

                // Restore pre-quiz lock/control state.
                if (!forceEditableForAssignment && preQuizControlCapturedRef.current) {
                  const prior = preQuizControlStateRef.current
                  preQuizControlStateRef.current = null
                  preQuizControlCapturedRef.current = false
                  updateControlState(prior)
                }

                // Restore baseline snapshot (so student returns to pre-quiz view).
                const baseline = quizBaselineSnapshotRef.current
                quizBaselineSnapshotRef.current = null
                if (baseline) {
                  void applyPageSnapshot(baseline)
                } else {
                  // Best effort: request sync.
                  channel
                    ?.publish('sync-request', { clientId: clientIdRef.current, author: userDisplayName, ts: Date.now() })
                    .catch(() => {})
                }
                return
              }
            }
            return
          }
          if (data?.action === 'convert') {
            if (isAdmin) return
            if (isBroadcastPausedRef.current) return
            if (!editor) return
            forcedConvertDepthRef.current += 1
            setIsConverting(true)
            editor.convert()
            return
          }
          if (data?.action === 'latex-display') {
            const enabled = Boolean(data.enabled)
            const latex = typeof data.latex === 'string' ? data.latex : ''
            const options = sanitizeLatexOptions(data.options)
            setLatexDisplayState({ enabled, latex, options })
            if (!isAdmin) {
              setLatexProjectionOptions(options)
            }
            if (!isAdmin) {
              if (enabled) {
                try {
                  editor.clear()
                  lastSymbolCountRef.current = 0
                  lastBroadcastBaseCountRef.current = 0
                } catch {}
              } else if (channel) {
                channel
                  .publish('sync-request', {
                    clientId: clientIdRef.current,
                    author: userDisplayName,
                    ts: Date.now(),
                  })
                  .catch(err => console.warn('Failed to request sync after exiting LaTeX display mode', err))
              }
            }
            return
          }
          if (data?.action === 'stacked-notes') {
            const latex = typeof data.latex === 'string' ? data.latex : ''
            const options = sanitizeLatexOptions(data.options)
            const ts = data?.ts ?? Date.now()
            setStackedNotesState(prev => {
              if (ts < prev.ts) return prev
              return { latex, options, ts }
            })
            return
          }
          const controlAction = typeof (data as any)?.action === 'string' ? (data as any).action : ''
          if (controlAction === 'controller-rights-reset') {
            controllerRightsUserAllowlistRef.current.clear()
            controllerRightsAllowlistRef.current.clear()
            bumpControllerRightsVersion()
            pendingPublishQueueRef.current = []
            // Re-apply normalization and permission refs.
            updateControlState(controlStateRef.current)
            return
          }
          if (controlAction === 'controller-eligibility' || controlAction === 'controller-rights') {
            const targets: string[] = Array.isArray((data as any).targetClientIds)
              ? (data as any).targetClientIds.filter((id: unknown): id is string => typeof id === 'string')
              : []
            const fallbackTarget = typeof data.targetClientId === 'string' ? data.targetClientId : ''
            const dedupedTargets: string[] = targets.length ? Array.from(new Set(targets)) : (fallbackTarget ? [fallbackTarget] : [])
            const allowed = Boolean((data as any).allowed)

            const targetUserKey = typeof (data as any).targetUserKey === 'string' ? String((data as any).targetUserKey) : ''
            const name = typeof (data as any).name === 'string' ? String((data as any).name).trim() : ''

            if (targetUserKey) {
              if (allowed) {
                controllerRightsUserAllowlistRef.current.add(targetUserKey)
              } else {
                controllerRightsUserAllowlistRef.current.delete(targetUserKey)
              }
            }

            if (dedupedTargets.length) {
              for (const target of dedupedTargets) {
                if (!target) continue
                if (allowed) {
                  controllerRightsAllowlistRef.current.add(target)
                } else {
                  controllerRightsAllowlistRef.current.delete(target)
                }
              }
            }

            if (!targetUserKey && !dedupedTargets.length) return
            bumpControllerRightsVersion()
            // Re-apply normalization and permission refs.
            updateControlState(controlStateRef.current)
            return
          }
          if (controlAction === 'controller-highlight') {
            const ts = typeof (data as any)?.ts === 'number' ? (data as any).ts : Date.now()
            const currentTs = highlightedControllerRef.current?.ts ?? 0
            if (ts < currentTs) return

            const targetClientId = typeof (data as any)?.targetClientId === 'string' ? (data as any).targetClientId : ''
            const targetUserId = typeof (data as any)?.targetUserId === 'string' ? (data as any).targetUserId : undefined
            const name = typeof (data as any)?.name === 'string' ? (data as any).name : undefined

            if (!targetClientId) {
              setHighlightedController(null)
              return
            }

            setHighlightedController({ clientId: targetClientId, userId: targetUserId, name, ts })
            return
          }
          if (data?.action === 'force-resync') {
            if (data.targetClientId && data.targetClientId !== clientIdRef.current) return
            const snapshot = data.snapshot
            if (snapshot) {
              enqueueSnapshot(
                {
                  clientId: data.clientId || '__controller__',
                  snapshot,
                  ts: data.ts ?? Date.now(),
                  reason: 'update',
                  originClientId: data.clientId || '__controller__',
                  targetClientId: data.targetClientId,
                },
                typeof message?.timestamp === 'number' ? message.timestamp : undefined
              )
            } else {
              enforceAuthoritativeSnapshot()
            }
            return
          }
          if (data?.action === 'wipe') {
            if (data.targetClientId && data.targetClientId !== clientIdRef.current) return
            editor.clear()
            lastSymbolCountRef.current = 0
            lastBroadcastBaseCountRef.current = 0
            setLatexOutput('')
            return
          }
          if (typeof data?.locked !== 'boolean') return
          const controlTs = data?.ts ?? Date.now()
          if (data.locked) {
            if (!data.controllerId) return
            updateControlState({ controllerId: data.controllerId, controllerName: data.controllerName, ts: controlTs })
            return
          }
          if (!data.controllerId || data.controllerId === ALL_STUDENTS_ID) {
            updateControlState({ controllerId: ALL_STUDENTS_ID, controllerName: data.controllerName || 'All Students', ts: controlTs })
          } else {
            updateControlState(null)
          }
        }

        const handleLatexMessage = (message: any) => {
          const data = message?.data as { latex?: string; ts?: number; clientId?: string }
          const latex = typeof data?.latex === 'string' ? data.latex : ''
          if (!latex) return
          const msgTs = typeof message?.timestamp === 'number' ? message.timestamp : data?.ts ?? Date.now()
          if (msgTs < lastLatexBroadcastTsRef.current) return
          lastLatexBroadcastTsRef.current = msgTs
          setLatexOutput(latex)
        }

        const handleDiagramMessage = (message: any) => {
          if (!ENABLE_EMBEDDED_DIAGRAMS) return
          const data = message?.data as DiagramRealtimeMessage
          if (!data || typeof data !== 'object') return
          if ((data as any).sender && (data as any).sender === clientIdRef.current) return
          if (data.kind === 'state') {
            const next: DiagramState = {
              activeDiagramId: typeof data.activeDiagramId === 'string' ? data.activeDiagramId : null,
              isOpen: Boolean(data.isOpen),
            }
            setDiagramState(prev => {
              // Preserve active selection if the incoming state doesn't have one.
              if (!next.activeDiagramId && prev.activeDiagramId) {
                return { ...prev, isOpen: next.isOpen }
              }
              return next
            })

            // If the state references a diagram we don't have yet (e.g., late join), refetch.
            if (next.isOpen && next.activeDiagramId) {
              const known = diagramsRef.current.some(d => d.id === next.activeDiagramId)
              if (!known) {
                void loadDiagramsFromServer()
              }
            }
            return
          }
          if (data.kind === 'add') {
            const diag = data.diagram
            if (!diag || typeof (diag as any).id !== 'string') return
            setDiagrams(prev => {
              if (prev.some(d => d.id === diag.id)) return prev
              const next = [...prev, { ...diag, annotations: diag.annotations ? normalizeAnnotations(diag.annotations) : null }]
              next.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id))
              return next
            })
            setDiagramState(prev => ({
              activeDiagramId: prev.activeDiagramId || diag.id,
              isOpen: prev.isOpen,
            }))
            return
          }
          if (data.kind === 'remove') {
            setDiagrams(prev => prev.filter(d => d.id !== data.diagramId))
            setDiagramState(prev => {
              if (prev.activeDiagramId !== data.diagramId) return prev
              const remaining = diagramsRef.current.filter(d => d.id !== data.diagramId)
              return { ...prev, activeDiagramId: remaining[0]?.id ?? null }
            })
            return
          }
          if (data.kind === 'clear') {
            setDiagrams(prev => prev.map(d => (d.id === data.diagramId ? { ...d, annotations: { strokes: [], arrows: [] } } : d)))
            return
          }
          if (data.kind === 'annotations-set') {
            setDiagrams(prev => prev.map(d => (d.id === data.diagramId ? { ...d, annotations: data.annotations ? normalizeAnnotations(data.annotations) : null } : d)))
            return
          }
          if (data.kind === 'stroke-commit') {
            setDiagrams(prev => {
              return prev.map(d => {
                if (d.id !== data.diagramId) return d
                const annotations = d.annotations ? normalizeAnnotations(d.annotations) : { strokes: [], arrows: [] }
                return { ...d, annotations: { strokes: [...annotations.strokes, data.stroke], arrows: annotations.arrows || [] } }
              })
            })
            return
          }
        }

        channel.subscribe('stroke', handleStroke)
        channel.subscribe('sync-state', handleSyncState)
  channel.subscribe('sync-request', handleSyncRequest)
        channel.subscribe('control', handleControlMessage)
  channel.subscribe('latex', handleLatexMessage)
          if (ENABLE_EMBEDDED_DIAGRAMS) {
            channel.subscribe('diagram', handleDiagramMessage)
          }
        // Removed control channel subscription.

        const snapshot = captureFullSnapshot()
        // Publish initial state if there are existing symbols.
        if (snapshot && !isSnapshotEmpty(snapshot)) {
          const record: SnapshotRecord = {
            snapshot,
            ts: Date.now(),
            reason: 'update',
          }
          latestSnapshotRef.current = record
          lastBroadcastBaseCountRef.current = countSymbols(snapshot.symbols)
          if (canPublishSnapshots()) {
            await channel.publish('stroke', {
              clientId: clientIdRef.current,
              author: userDisplayName,
              snapshot: record.snapshot,
              ts: record.ts,
              reason: record.reason,
            })
          }
        }

        await channel.publish('sync-request', {
          clientId: clientIdRef.current,
          author: userDisplayName,
          ts: Date.now(),
        })

        // Presence tracking (simplified; no broadcaster election)
        try {
          await channel.presence.enter({ name: userDisplayName, userId, isAdmin: Boolean(isAdmin) })
          const members = await channel.presence.get()
          const normalizePresenceName = (value: any) => String(value || '').trim().replace(/\s+/g, ' ')
          const toPresenceClient = (m: any) => ({
            clientId: String(m?.clientId || ''),
            name: normalizePresenceName(m?.data?.name),
            isAdmin: Boolean(m?.data?.isAdmin),
            userId: typeof m?.data?.userId === 'string' && m.data.userId.trim() ? String(m.data.userId) : undefined,
          })
          const dedupePresence = (list: any[]) => {
            const byKey = new Map<string, any>()
            const nameToKey = new Map<string, string>()

            for (const raw of Array.isArray(list) ? list : []) {
              const c = toPresenceClient(raw)
              if (!c.clientId) continue
              const nk = normalizePresenceName(c.name || c.clientId).toLowerCase()
              const hasUserId = Boolean(c.userId)

              let key = ''
              if (hasUserId) {
                key = `uid:${String(c.userId)}`
                const existingKeyForName = nk ? nameToKey.get(nk) : undefined
                if (existingKeyForName && existingKeyForName !== key) {
                  // If the name maps to a DIFFERENT userId, keep both entries (same display name can be shared).
                  if (existingKeyForName.startsWith('uid:') && key.startsWith('uid:')) {
                    const prev = byKey.get(key)
                    byKey.set(key, prev ? { ...prev, ...c } : c)
                    continue
                  }
                  const existing = byKey.get(existingKeyForName)
                  if (existing) {
                    // Migrate the previous (name-keyed) entry into the userId-keyed entry.
                    byKey.delete(existingKeyForName)
                    byKey.set(key, { ...existing, ...c })
                  } else {
                    byKey.set(key, c)
                  }
                } else {
                  const prev = byKey.get(key)
                  byKey.set(key, prev ? { ...prev, ...c } : c)
                }
                if (nk) nameToKey.set(nk, key)
              } else {
                const existingKeyForName = nk ? nameToKey.get(nk) : undefined
                key = existingKeyForName || (nk ? `name:${nk}` : `cid:${c.clientId}`)
                if (nk && !nameToKey.has(nk)) nameToKey.set(nk, key)
                const prev = byKey.get(key)
                // Prefer existing entries that already have a userId.
                if (prev && prev.userId) continue
                byKey.set(key, prev ? { ...c, ...prev } : c)
              }
            }
            return Array.from(byKey.values())
          }

          setConnectedClients(dedupePresence(members))
          channel.presence.subscribe(async (presenceMsg: any) => {
            try {
              const list = await channel.presence.get()
              setConnectedClients(dedupePresence(list))
              // When someone new enters, proactively push current snapshot and states from any client with data.
              if (presenceMsg?.action === 'enter' && !isBroadcastPausedRef.current) {
                const rec = latestSnapshotRef.current ?? (() => {
                  const snap = collectEditorSnapshot(false)
                  return snap ? { snapshot: snap, ts: Date.now(), reason: 'update' as const } : null
                })()
                if (rec && rec.snapshot && !isSnapshotEmpty(rec.snapshot)) {
                  if (canPublishSnapshots()) {
                    await channel.publish('stroke', {
                      clientId: clientIdRef.current,
                      author: userDisplayName,
                      snapshot: rec.snapshot,
                      ts: rec.ts,
                      reason: rec.reason,
                      originClientId: clientIdRef.current,
                    })
                  }
                }

                // Ensure late-joining clients immediately receive the current diagram overlay state
                // (and its annotations) so "Show Diagram" is reflected on student screens.
                // IMPORTANT: only admins should broadcast this; otherwise a student's default
                // state (isOpen=false) can override the teacher for late joiners.
                if (ENABLE_EMBEDDED_DIAGRAMS && isAdmin) {
                  try {
                    const currentDiagramState = diagramStateRef.current
                    await channel.publish('diagram', {
                      kind: 'state',
                      activeDiagramId: currentDiagramState.activeDiagramId,
                      isOpen: Boolean(currentDiagramState.isOpen),
                      ts: Date.now(),
                      sender: clientIdRef.current,
                    })
                    const activeId = currentDiagramState.activeDiagramId
                    if (currentDiagramState.isOpen && activeId) {
                      const diag = diagramsRef.current.find(d => d.id === activeId)
                      if (diag) {
                        await channel.publish('diagram', {
                          kind: 'add',
                          diagram: {
                            id: diag.id,
                            title: diag.title,
                            imageUrl: diag.imageUrl,
                            order: diag.order,
                            annotations: diag.annotations ?? null,
                          },
                          ts: Date.now(),
                          sender: clientIdRef.current,
                        })
                      }
                      await channel.publish('diagram', {
                        kind: 'annotations-set',
                        diagramId: activeId,
                        annotations: diag?.annotations ?? { strokes: [], arrows: [] },
                        ts: Date.now(),
                        sender: clientIdRef.current,
                      })
                    }
                  } catch (err) {
                    console.warn('Failed to rebroadcast diagram state', err)
                  }
                }

                if (latexDisplayStateRef.current.enabled && canPublishSnapshots()) {
                  const latex = latexDisplayStateRef.current.latex || (latexOutput || '').trim()
                  try {
                    await channel.publish('control', {
                      clientId: clientIdRef.current,
                      author: userDisplayName,
                      action: 'latex-display',
                      enabled: true,
                      latex,
                      ts: Date.now(),
                    })
                  } catch (err) {
                    console.warn('Failed to rebroadcast latex display state', err)
                  }
                }
                if (isAdmin && hasExclusiveControlRef.current) {
                  const now = Date.now()
                  if (now - lastControlBroadcastTsRef.current > 1500) {
                    await channel.publish('control', {
                      clientId: clientIdRef.current,
                      author: userDisplayName,
                      locked: true,
                      controllerId: clientIdRef.current,
                      controllerName: userDisplayName,
                      ts: now,
                    })
                    lastControlBroadcastTsRef.current = now
                  }
                }
              }
              const action = presenceMsg?.action
              if ((action === 'leave' || action === 'absent' || action === 'timeout') && controlStateRef.current?.controllerId === presenceMsg?.clientId) {
                updateControlState(null)
              }
            } catch {}
          })
          // No election required.
        } catch (e) {
          console.warn('Presence tracking failed', e)
        }

        // No default broadcaster assignment.

        // Heartbeat reconnection loop
        heartbeatIntervalRef.current = setInterval(async () => {
          if (realtime.connection.state === 'connected') return
          // Backoff logic: attempt more aggressively for first 5 tries, then every second heartbeat
          const attempts = reconnectAttemptsRef.current
          const shouldAttempt = attempts < 5 || attempts % 2 === 0
          if (!shouldAttempt) return
          try {
            reconnectAttemptsRef.current += 1
            await realtime.auth.authorize({ force: true })
            realtime.connect()
          } catch (hbErr) {
            // Silent; debug shows attempts
          }
        }, 10000)

        // Removed periodic reconcile tied to broadcaster role.
      } catch (err) {
        console.error('Failed to initialise Ably realtime collaboration', err)
        if (!disposed) {
          const message = 'Realtime collaboration is temporarily unavailable. Retrying…'
          setTransientError(message)
          setTimeout(() => {
            setTransientError(curr => (curr === message ? null : curr))
          }, 6000)
          scheduleRealtimeRetry()
        }
      }
    }

    setupRealtime()

    return () => {
      disposed = true
      try {
        channelRef.current = null
        if (channel) {
          if (isAdmin && hasExclusiveControlRef.current) {
            const ts = Date.now()
            channel
              .publish('control', {
                clientId: clientIdRef.current,
                author: userDisplayName,
                locked: false,
                controllerId: clientIdRef.current,
                controllerName: userDisplayName,
                ts,
              })
              .catch(() => {})
          }
          channel.unsubscribe()
          channel.detach?.()
        }
        if (realtime) {
          realtime.close()
        }
      } catch (err) {
        console.warn('Error while tearing down Ably connection', err)
      } finally {
        realtimeRef.current = null
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current)
          heartbeatIntervalRef.current = null
        }
        if (reconcileIntervalRef.current) {
          clearInterval(reconcileIntervalRef.current)
          reconcileIntervalRef.current = null
        }
        if (realtimeRetryTimeoutRef.current) {
          clearTimeout(realtimeRetryTimeoutRef.current)
          realtimeRetryTimeoutRef.current = null
        }
        if (remoteFrameHandleRef.current !== null) {
          if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function' && typeof remoteFrameHandleRef.current === 'number') {
            window.cancelAnimationFrame(remoteFrameHandleRef.current)
          } else {
            clearTimeout(remoteFrameHandleRef.current as ReturnType<typeof setTimeout>)
          }
          remoteFrameHandleRef.current = null
        }
        pendingRemoteSnapshotsRef.current = []
        remoteProcessingRef.current = false
      }
    }
  }, [applySnapshotCore, captureFullSnapshot, collectEditorSnapshot, channelName, enqueueSnapshot, isAdmin, status, updateControlState, userDisplayName])

  const isEditorEmptyNow = () => lastSymbolCountRef.current <= 0

  const isCurrentLineEmptyNow = () => {
    if (useAdminStepComposer && hasBoardWriteRights()) {
      return !(adminDraftLatex || '').trim()
    }
    return !((latexOutput || '').trim())
  }

  const clearEverything = () => {
    if (!editorInstanceRef.current) return
    if (lockedOutRef.current) return

    try {
      editorInstanceRef.current.clear()
    } catch {}
    setLatexOutput('')
    lastSymbolCountRef.current = 0
    lastBroadcastBaseCountRef.current = 0

    if (useAdminStepComposer) {
      setAdminSteps([])
      setAdminDraftLatex('')
      setAdminSendingStep(false)
      setAdminEditIndex(null)
      clearTopPanelSelection()
      stepNavRedoStackRef.current = []
    }

    if (pageIndex === sharedPageIndexRef.current) {
      broadcastSnapshot(true, { force: true, reason: 'clear' })
    }
  }

  const clearCurrentOnly = () => {
    if (!editorInstanceRef.current) return
    if (lockedOutRef.current) return
    editorInstanceRef.current.clear()
    setLatexOutput('')
    lastSymbolCountRef.current = 0
    lastBroadcastBaseCountRef.current = 0
    if (useAdminStepComposer && hasControllerRights()) {
      setAdminDraftLatex('')
      clearTopPanelSelection()
    }
    if (pageIndex === sharedPageIndexRef.current) {
      broadcastSnapshot(true, { force: true, reason: 'clear' })
    }
  }

  const handleTrashClick = () => {
    const emptyCanvas = isEditorEmptyNow()
    const emptyLine = isCurrentLineEmptyNow()

    if (emptyCanvas && emptyLine) {
      const ok = typeof window !== 'undefined'
        ? window.confirm('Clear everything? This will remove all lines and the canvas.')
        : false
      if (!ok) return
      clearEverything()
      return
    }

    clearCurrentOnly()
  }

  const handleClear = () => {
    handleTrashClick()
  }

  const handleUndo = async () => {
    if (!editorInstanceRef.current) return
    if (lockedOutRef.current) return

    try {
      editorInstanceRef.current.undo()
    } catch {}
    broadcastSnapshot(false)

    // Step-boundary undo: once empty, go to the line above.
    if (!useAdminStepComposer || !hasControllerRights()) return
    const emptyCanvas = isEditorEmptyNow()
    if (!emptyCanvas) return
    setAdminDraftLatex('')
    if (!isCurrentLineEmptyNow()) return

    const currentIndex = adminEditIndex !== null ? adminEditIndex : adminSteps.length
    const prevIndex = currentIndex - 1
    if (prevIndex < 0) return

    // Push current index for step-boundary redo.
    stepNavRedoStackRef.current.push(currentIndex)
    await loadAdminStepForEditing(prevIndex)
  }

  const handleRedo = async () => {
    if (!editorInstanceRef.current) return
    if (lockedOutRef.current) return

    try {
      editorInstanceRef.current.redo()
    } catch {}
    broadcastSnapshot(false)

    // Step-boundary redo: when empty, redo to the next line we previously stepped from.
    if (!useAdminStepComposer || !hasControllerRights()) return
    const emptyCanvas = isEditorEmptyNow()
    if (!emptyCanvas) return
    setAdminDraftLatex('')
    if (!isCurrentLineEmptyNow()) return

    const nextIndex = stepNavRedoStackRef.current.pop()
    if (nextIndex === undefined) return

    if (nextIndex >= adminSteps.length) {
      // Return to draft line.
      setAdminEditIndex(null)
      setAdminDraftLatex('')
      clearTopPanelSelection()
      return
    }

    await loadAdminStepForEditing(nextIndex)
  }

  const handleConvert = () => {
    if (!editorInstanceRef.current) return
    if (lockedOutRef.current) return
    setIsConverting(true)
    editorInstanceRef.current.convert()
    if (canPublishSnapshots() && pageIndex === sharedPageIndexRef.current && !isBroadcastPausedRef.current) {
      const channel = channelRef.current
      if (channel) {
        channel
          .publish('control', {
            clientId: clientIdRef.current,
            author: userDisplayName,
            action: 'convert',
            ts: Date.now(),
          })
          .catch(err => console.warn('Failed to broadcast convert command', err))
      }
    }
  }

  // Removed broadcaster handlers and state.

  const toggleBroadcastPause = () => {
    if (!hasBoardWriteRights()) return
    setIsBroadcastPaused(prev => {
      const next = !prev
      isBroadcastPausedRef.current = next
      return next
    })
  }

  const forcePublishLatex = async () => {
    if (!canPublishSnapshots()) return
    const channel = channelRef.current
    if (!channel) return
    const latex = (latexOutput || '').trim()
    if (!latex) return
    const ts = Date.now()
    try {
      await channel.publish('latex', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        latex,
        ts,
      })
      lastLatexBroadcastTsRef.current = ts
    } catch (err) {
      console.warn('Failed to broadcast LaTeX', err)
    }
  }

  const toggleLatexProjection = async () => {
    if (!hasBoardWriteRights()) return
    const nextEnabled = !latexDisplayStateRef.current.enabled
    const latex = nextEnabled ? (latexOutput || '').trim() : ''
    const options = latexProjectionOptionsRef.current
    setLatexDisplayState({ enabled: nextEnabled, latex, options })
    await publishLatexDisplayState(nextEnabled, latex, options)
  }

  const updateLatexProjectionOptions = useCallback(
    (partial: Partial<LatexDisplayOptions>) => {
      setLatexProjectionOptions(prev => {
        const next = sanitizeLatexOptions({ ...prev, ...partial })
        if (latexDisplayStateRef.current.enabled) {
          setLatexDisplayState(curr => (curr.enabled ? { ...curr, options: next } : curr))
          publishLatexDisplayState(true, latexDisplayStateRef.current.latex, next)
        }
        return next
      })
    },
    [publishLatexDisplayState]
  )

  const forcePublishCanvas = async (targetClientId?: string, opts?: { shareIndex?: number }) => {
    if (!canPublishSnapshots()) return
    const channel = channelRef.current
    if (!channel) return
    const shareIndex = (typeof opts?.shareIndex === 'number' && Number.isFinite(opts.shareIndex)) ? Math.max(0, Math.trunc(opts.shareIndex)) : pageIndex
    const snapshot = captureFullSnapshot()
    if (!snapshot || isSnapshotEmpty(snapshot)) {
      // Still broadcast shared-page updates even if the page is empty.
      if (!targetClientId) {
        setSharedPageIndex(shareIndex)
        void publishSharedPage(shareIndex)
      }
      return
    }
    const ts = Date.now()
    try {
      await channel.publish('stroke', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        snapshot: { ...snapshot, baseSymbolCount: -1 },
        ts,
        reason: 'update',
        originClientId: clientIdRef.current,
        targetClientId,
      })
      latestSnapshotRef.current = { snapshot, ts, reason: 'update' }
      lastGlobalUpdateTsRef.current = ts
      if (!targetClientId) {
        setSharedPageIndex(shareIndex)
        void publishSharedPage(shareIndex, ts + 1)
      }
      await channel.publish('control', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        action: 'force-resync',
        snapshot: { ...snapshot, baseSymbolCount: -1 },
        targetClientId,
        ts,
      })
    } catch (err) {
      console.warn('Failed to publish canvas snapshot', err)
    }
  }

  const publishAdminCanvasToAll = useCallback(async () => {
    if (!canPublishSnapshots()) return
    await forcePublishCanvas()
  }, [canPublishSnapshots, forcePublishCanvas])

  const publishAdminLatexAndCanvasToAll = useCallback(async () => {
    if (!canPublishSnapshots()) return
    await forcePublishLatex()
    await forcePublishCanvas()
  }, [canPublishSnapshots, forcePublishCanvas, forcePublishLatex])

  const forceClearStudentCanvas = async (targetClientId: string) => {
    if (!hasBoardWriteRights() || !targetClientId) return
    const channel = channelRef.current
    if (!channel) return
    const ts = Date.now()
    try {
      await channel.publish('control', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        action: 'wipe',
        targetClientId,
        ts,
      })
    } catch (err) {
      console.warn('Failed to send wipe command', err)
    }
  }

  const clearAllStudentCanvases = useCallback(async () => {
    if (!hasBoardWriteRights()) return
    const channel = channelRef.current
    if (!channel) return

    const ts = Date.now()
    const targets = connectedClients.filter(c => c.clientId !== clientIdRef.current)
    for (const target of targets) {
      try {
        await channel.publish('control', {
          clientId: clientIdRef.current,
          author: userDisplayName,
          action: 'wipe',
          targetClientId: target.clientId,
          ts,
        })
      } catch (err) {
        console.warn('Failed to wipe student canvas', err)
      }
    }

    // Clear any projected LaTeX on student screens
    try {
      await channel.publish('control', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        action: 'latex-display',
        enabled: false,
        latex: '',
        ts: ts + 1,
      })
    } catch (err) {
      console.warn('Failed to clear latex display for students', err)
    }

    // Republish admin canvas as authoritative snapshot so students settle on the latest state
    try {
      await forcePublishCanvas()
    } catch (err) {
      console.warn('Failed to republish admin canvas after wipe', err)
    }
  }, [connectedClients, forcePublishCanvas, hasBoardWriteRights, userDisplayName])

  const navigateToPage = useCallback(
    async (targetIndex: number) => {
      if (!hasBoardWriteRights()) return
      if (targetIndex === pageIndex) return
      if (targetIndex < 0 || targetIndex >= pageRecordsRef.current.length) return
      persistCurrentPageSnapshot()
      const snapshot = pageRecordsRef.current[targetIndex]?.snapshot ?? null
      await applyPageSnapshot(snapshot)

      const presenterActive = Boolean(activePresenterUserKeyRef.current)
      const isPresenter = presenterActive && isSelfActivePresenter()
      if (isPresenter) {
        setSharedPageIndex(targetIndex)
        void publishSharedPage(targetIndex)
        // Push the presenter's new page state so consumers settle immediately.
        await forcePublishCanvas(undefined, { shareIndex: targetIndex })
      }
      setPageIndex(targetIndex)
    },
    [applyPageSnapshot, forcePublishCanvas, hasBoardWriteRights, isSelfActivePresenter, pageIndex, persistCurrentPageSnapshot, publishSharedPage]
  )

  const addNewPage = useCallback(async () => {
    if (!hasBoardWriteRights()) return
    persistCurrentPageSnapshot()
    pageRecordsRef.current.push({ snapshot: null })
    const targetIndex = pageRecordsRef.current.length - 1
    await applyPageSnapshot(null)

    const presenterActive = Boolean(activePresenterUserKeyRef.current)
    const isPresenter = presenterActive && isSelfActivePresenter()
    if (isPresenter) {
      setSharedPageIndex(targetIndex)
      void publishSharedPage(targetIndex)
      await forcePublishCanvas(undefined, { shareIndex: targetIndex })
    }
    setPageIndex(targetIndex)
  }, [applyPageSnapshot, forcePublishCanvas, hasBoardWriteRights, isSelfActivePresenter, persistCurrentPageSnapshot, publishSharedPage])

  const shareCurrentPageWithStudents = useCallback(async () => {
    if (!hasControllerRights()) return
    if (activePresenterUserKeyRef.current && !isSelfActivePresenter()) return
    persistCurrentPageSnapshot()
    await forcePublishCanvas()
    setSharedPageIndex(pageIndex)
  }, [forcePublishCanvas, hasControllerRights, isSelfActivePresenter, pageIndex, persistCurrentPageSnapshot])

  const handleOrientationChange = useCallback(
    (next: CanvasOrientation) => {
      if (isAdmin && isFullscreen && next !== 'landscape') {
        return
      }
      setCanvasOrientation(curr => (curr === next ? curr : next))
      if (isAdmin && !isFullscreen) {
        adminOrientationPreferenceRef.current = next
      }
    },
    [isAdmin, isFullscreen]
  )

  const toggleFullscreen = () => {
    const next = !isFullscreen
    setIsFullscreen(next)
    if (isAdmin) {
      if (next) {
        adminOrientationPreferenceRef.current = canvasOrientation
        if (canvasOrientation !== 'landscape') {
          setCanvasOrientation('landscape')
        }
      } else if (adminOrientationPreferenceRef.current && adminOrientationPreferenceRef.current !== canvasOrientation) {
        setCanvasOrientation(adminOrientationPreferenceRef.current)
      }
    }
    // Resize editor after layout change
    try {
      editorInstanceRef.current?.resize?.()
    } catch {}
  }

  const hasWriteAccess = hasBoardWriteRights()
  const isViewOnly = !hasWriteAccess

  const isStudentSendContext = (!isAdmin || isAssignmentSolutionAuthoring) && (quizActive || isAssignmentView)
  const canUseAdminSend = isAdmin || hasWriteAccess

  useEffect(() => {
    if (isViewOnly) {
      setIsEraserMode(false)
    }
  }, [isViewOnly])

  useEffect(() => {
    if (!useStackedStudentLayout) return
    const next = viewOnlyMode ? VIEW_ONLY_SPLIT_RATIO : EDITABLE_SPLIT_RATIO
    setStudentSplitRatio(next)
    studentSplitRatioRef.current = next
  }, [EDITABLE_SPLIT_RATIO, VIEW_ONLY_SPLIT_RATIO, useStackedStudentLayout, viewOnlyMode])

  useEffect(() => {
    if (isAdmin) return
    if (!isSessionQuizMode) return
    updateControlState(controlStateRef.current ?? null)
  }, [isAdmin, isSessionQuizMode, quizActive, updateControlState])

  const controlOwnerLabel = (() => {
    if (controlState) {
      if (controlState.controllerId === ALL_STUDENTS_ID) {
        return 'Everyone'
      }
      if (controlState.controllerId === clientId) {
        return 'You'
      }
      return controlState.controllerName || 'Teacher'
    }
    return 'Teacher'
  })()

  const latexRenderOptions = useAdminStepComposer
    ? { ...latexProjectionOptions, alignAtEquals: true }
    : (!isAdmin && quizActive && !isAssignmentView && useStackedStudentLayout)
      ? { ...stackedNotesState.options, alignAtEquals: true }
    : (!isAdmin && isAssignmentView && useStackedStudentLayout)
      ? { ...stackedNotesState.options, alignAtEquals: true }
      : hasWriteAccess
        ? latexProjectionOptions
        : useStackedStudentLayout
          ? stackedNotesState.options
          : latexDisplayState.options
  const latexRenderSource = useMemo(() => {
    if (useAdminStepComposer) {
      const lines = adminSteps.map(s => s.latex)
      if (adminEditIndex !== null) {
        if (adminDraftLatex) {
          lines[adminEditIndex] = adminDraftLatex
        }
      } else if (adminDraftLatex) {
        lines.push(adminDraftLatex)
      }
      const composed = lines.filter(Boolean).join(' \\\\ ').trim()
      // In stacked (composer) mode, the teacher can still explicitly load a scripted LaTeX line.
      // If there are no composed steps, fall back to the display-state LaTeX so the top panel updates.
      return composed || (latexDisplayState.latex || '').trim()
    }
    if (useStudentStepComposer) {
      const lines = studentSteps.map(s => s.latex)
      const draft = (latexOutput || '').trim()
      if (studentEditIndex !== null) {
        if (draft) {
          lines[studentEditIndex] = draft
        }
      } else if (draft) {
        lines.push(draft)
      }
      return lines.filter(Boolean).join(' \\\\ ').trim()
    }
    if (!isAdmin && quizActive && !isAssignmentView && useStackedStudentLayout) {
      const committed = (studentCommittedLatex || '').trim()
      const live = (latexOutput || '').trim()
      return [committed, live].filter(Boolean).join(' \\\\ ').trim()
    }
    if (!isAdmin && isAssignmentView && useStackedStudentLayout) {
      const committed = (studentCommittedLatex || '').trim()
      const live = (latexOutput || '').trim()
      return [committed, live].filter(Boolean).join(' \\\\ ').trim()
    }
    if (hasWriteAccess) {
      return (latexDisplayState.latex || latexOutput || '').trim()
    }
    if (useStackedStudentLayout) {
      return (stackedNotesState.latex || '').trim()
    }
    return (latexDisplayState.latex || '').trim()
  }, [adminDraftLatex, adminEditIndex, adminSteps, hasWriteAccess, isAdmin, isAssignmentView, latexDisplayState.latex, latexOutput, quizActive, stackedNotesState.latex, studentCommittedLatex, studentEditIndex, studentSteps, useAdminStepComposer, useStackedStudentLayout, useStudentStepComposer])

  // In stacked (split) mode, recognition can briefly report an empty LaTeX string after each stroke.
  // If we render that directly, the top panel flashes the placeholder message. Keep the last non-empty
  // preview until we either receive a non-empty update or the board truly becomes empty.
  const [stableAdminStackedLatexRenderSource, setStableAdminStackedLatexRenderSource] = useState('')
  const stableAdminStackedLatexRenderSourceRef = useRef('')
  useEffect(() => {
    if (!useAdminStepComposer) return
    if (!useStackedStudentLayout) return

    const next = (latexRenderSource || '').trim()
    if (next) {
      if (stableAdminStackedLatexRenderSourceRef.current !== next) {
        stableAdminStackedLatexRenderSourceRef.current = next
        setStableAdminStackedLatexRenderSource(next)
      }
      return
    }

    const hasInk = lastSymbolCountRef.current > 0
    const hasSteps = useAdminStepComposer && adminSteps.length > 0
    if (hasInk || hasSteps) {
      // Keep current stable preview.
      return
    }

    if (stableAdminStackedLatexRenderSourceRef.current) {
      stableAdminStackedLatexRenderSourceRef.current = ''
      setStableAdminStackedLatexRenderSource('')
    }
  }, [adminSteps.length, latexRenderSource, useAdminStepComposer, useStackedStudentLayout])

  const topPanelLatexSource = (useAdminStepComposer && useStackedStudentLayout)
    ? stableAdminStackedLatexRenderSource
    : latexRenderSource

  useEffect(() => {
    if (!hasBoardWriteRights()) return
    if (!useAdminStepComposer) return
    if (Date.now() < suppressStackedNotesPreviewUntilTsRef.current) return
    publishStackedNotesPreview(latexRenderSource, latexRenderOptions)
  }, [hasBoardWriteRights, latexRenderOptions, latexRenderSource, publishStackedNotesPreview, useAdminStepComposer])

  // Canonical payloads consumed by the top panel UI.
  const topPanelPayload: TopPanelPayload = useMemo(
    () => ({
      latex: topPanelLatexSource || '',
      options: latexRenderOptions,
    }),
    [topPanelLatexSource, latexRenderOptions]
  )

  const topPanelRenderPayload: TopPanelRenderPayload = useMemo(() => {
    const raw = (topPanelPayload.latex || '').trim()
    const style: CSSProperties = {
      fontSize: `${topPanelPayload.options.fontScale}rem`,
      textAlign: topPanelPayload.options.textAlign,
    }

    if (!raw) return { markup: '', style }

    let latexString = raw
    if (topPanelPayload.options.alignAtEquals && !/\\begin\{aligned}/.test(latexString)) {
      const lines = latexString.split(/\\\\/g).map(line => line.trim()).filter(Boolean)
      if (lines.length) {
        const processed = lines.map(line => {
          const equalsIndex = line.indexOf('=')
          if (equalsIndex === -1) {
            return /(^|\s)&/.test(line) ? line : `& ${line}`
          }
          const left = line.slice(0, equalsIndex).trim()
          const right = line.slice(equalsIndex + 1).trim()
          return `${left} &= ${right}`
        })
        latexString = `\\begin{aligned}${processed.join(' \\\\ ')}\\end{aligned}`
      }
    }

    try {
      return {
        markup: renderToString(latexString, {
          throwOnError: false,
          displayMode: true,
        }),
        style,
      }
    } catch (err) {
      console.warn('Failed to render top panel LaTeX', err)
      return { markup: '', style }
    }
  }, [
    topPanelPayload.latex,
    topPanelPayload.options.alignAtEquals,
    topPanelPayload.options.fontScale,
    topPanelPayload.options.textAlign,
  ])

  const adminTopPanelStepItems = useMemo(() => {
    if (!useAdminStepComposer) return [] as Array<{ index: number; latex: string }>
    if (!topPanelEditingMode) return [] as Array<{ index: number; latex: string }>
    return adminSteps.map((s, index) => {
      const latex = (adminEditIndex === index ? adminDraftLatex : (s?.latex || '')).trimEnd()
      return { index, latex }
    })
  }, [adminDraftLatex, adminEditIndex, adminSteps, topPanelEditingMode, useAdminStepComposer])

  const studentTopPanelStepItems = useMemo(() => {
    if (!useStudentStepComposer) return [] as Array<{ index: number; latex: string }>
    if (!topPanelEditingMode) return [] as Array<{ index: number; latex: string }>
    return studentSteps.map((s, index) => {
      const latex = (studentEditIndex === index ? (latexOutput || '') : (s?.latex || '')).trimEnd()
      return { index, latex }
    })
  }, [latexOutput, studentEditIndex, studentSteps, topPanelEditingMode, useStudentStepComposer])

  const topPanelStepsPayload: TopPanelStepsPayload | null = useMemo(() => {
    if (!topPanelEditingMode) return null
    if (useAdminStepComposer) {
      return {
        steps: adminTopPanelStepItems,
        selectedIndex: topPanelSelectedStep,
        options: topPanelPayload.options,
      }
    }
    if (useStudentStepComposer) {
      return {
        steps: studentTopPanelStepItems,
        selectedIndex: topPanelSelectedStep,
        options: topPanelPayload.options,
      }
    }
    return null
  }, [adminTopPanelStepItems, studentTopPanelStepItems, topPanelEditingMode, topPanelPayload.options, topPanelSelectedStep, useAdminStepComposer, useStudentStepComposer])

  const renderLatexStepInline = useCallback((latex: string) => {
    if (!latex) return ''
    try {
      return renderToString(latex, { throwOnError: false, displayMode: false })
    } catch {
      return ''
    }
  }, [])

  const studentQuizLatexPreviewMarkup = useMemo(() => {
    if (isAdmin) return ''
    if (!quizActive) return ''
    const latexString = (latexOutput || '').trim()
    if (!latexString) return ''
    try {
      return renderToString(latexString, {
        throwOnError: false,
        displayMode: true,
      })
    } catch (err) {
      console.warn('Failed to render student quiz preview', err)
      return ''
    }
  }, [isAdmin, latexOutput, quizActive])

  const latexOverlayStyle = useMemo<CSSProperties>(
    () => ({
      fontSize: `${latexRenderOptions.fontScale}rem`,
      textAlign: latexRenderOptions.textAlign,
    }),
    [latexRenderOptions.fontScale, latexRenderOptions.textAlign]
  )

  const disableCanvasInput = isViewOnly || (isOverlayMode && overlayControlsVisible)
  const editorHostClass = isFullscreen ? 'w-full h-full' : 'w-full'
  const editorHostStyle = useMemo<CSSProperties>(() => {
    if (isFullscreen) {
      return {
        width: '100%',
        height: '100%',
        pointerEvents: disableCanvasInput ? 'none' : undefined,
        cursor: disableCanvasInput ? 'default' : undefined,
      }
    }
    if (useStackedStudentLayout) {
      return {
        width: '100%',
        height: '100%',
        minHeight: '220px',
        pointerEvents: disableCanvasInput ? 'none' : undefined,
        cursor: disableCanvasInput ? 'default' : undefined,
      }
    }
    const landscape = canvasOrientation === 'landscape'
    const sizing: CSSProperties = landscape
      ? { minHeight: '384px', maxHeight: '520px', aspectRatio: '16 / 9' }
      : { minHeight: '480px', maxHeight: '640px', aspectRatio: '3 / 4' }
    return {
      width: '100%',
      ...sizing,
      pointerEvents: disableCanvasInput ? 'none' : undefined,
      cursor: disableCanvasInput ? 'default' : undefined,
    }
  }, [canvasOrientation, disableCanvasInput, isFullscreen, useStackedStudentLayout])

  // Mobile stacked mode: provide extra horizontal writing room by making the ink surface wider than
  // the viewport so users can scroll sideways for long expressions.
  const inkSurfaceWidthFactor = useMemo(() => {
    if (!useStackedStudentLayout) return 1
    if (!isCompactViewport) return 1
    // Intentionally large for narrow portrait phones: gives lots of horizontal room for long expressions.
    // Kept as a factor (not infinite) to avoid extreme memory/perf costs from a gigantic editor surface.
    return 12
  }, [isCompactViewport, useStackedStudentLayout])

  const [horizontalPanMax, setHorizontalPanMax] = useState(0)
  const [horizontalPanValue, setHorizontalPanValue] = useState(0)
  const [horizontalPanThumbRatio, setHorizontalPanThumbRatio] = useState(1)
  const horizontalPanRafRef = useRef<number | null>(null)
  const horizontalPanTrackRef = useRef<HTMLDivElement | null>(null)
  const horizontalPanDragRef = useRef<{ active: boolean; pointerId: number | null; startX: number; startScrollLeft: number; usableTrackWidth: number; maxScroll: number }>(
    { active: false, pointerId: null, startX: 0, startScrollLeft: 0, usableTrackWidth: 1, maxScroll: 0 }
  )
  const horizontalPanWindowCleanupRef = useRef<null | (() => void)>(null)
  const [horizontalScrollbarActive, setHorizontalScrollbarActive] = useState(false)

  const [verticalPanMax, setVerticalPanMax] = useState(0)
  const [verticalPanValue, setVerticalPanValue] = useState(0)
  const [verticalPanThumbRatio, setVerticalPanThumbRatio] = useState(1)
  const verticalPanRafRef = useRef<number | null>(null)
  const verticalPanTrackRef = useRef<HTMLDivElement | null>(null)
  const verticalPanDragRef = useRef<{ active: boolean; pointerId: number | null; startY: number; startScrollTop: number; usableTrackHeight: number; maxScroll: number }>(
    { active: false, pointerId: null, startY: 0, startScrollTop: 0, usableTrackHeight: 1, maxScroll: 0 }
  )
  const [verticalScrollbarActive, setVerticalScrollbarActive] = useState(false)

  // Master scroll speed/rate that affects both custom scrollbars.
  const [manualScrollGain, setManualScrollGain] = useState(3.5)
  const masterGainTrackRef = useRef<HTMLDivElement | null>(null)
  const masterGainDragRef = useRef<{ active: boolean; pointerId: number | null; startY: number; startValue: number; trackHeight: number }>(
    { active: false, pointerId: null, startY: 0, startValue: 3.5, trackHeight: 1 }
  )

  // Mobile: prevent the canvas engine from treating slider interactions as ink taps (which can
  // focus hidden inputs and open the on-screen keyboard). We do this with DOM-level capture
  // listeners and implement the drag interactions there.
  useEffect(() => {
    if (typeof window === 'undefined') return

    const stop = (event: Event) => {
      try {
        event.preventDefault()
      } catch {}
      try {
        ;(event as any).stopImmediatePropagation?.()
      } catch {}
      try {
        event.stopPropagation()
      } catch {}
    }

    const viewport = studentViewportRef.current
    const horizontalTrack = horizontalPanTrackRef.current
    const verticalTrack = verticalPanTrackRef.current
    const gainTrack = masterGainTrackRef.current

    const windowListeners: Array<{ type: string; handler: any }> = []
    const addWindow = (type: string, handler: any) => {
      window.addEventListener(type, handler)
      windowListeners.push({ type, handler })
    }
    const clearWindow = () => {
      for (const { type, handler } of windowListeners) {
        window.removeEventListener(type, handler)
      }
      windowListeners.length = 0
    }

    const beginHorizontal = (event: PointerEvent) => {
      if (!viewport || !horizontalTrack) return
      stop(event)
      const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
      const rect = horizontalTrack.getBoundingClientRect()
      const trackWidth = Math.max(1, rect.width)
      const thumbPx = trackWidth * Math.max(0, Math.min(1, horizontalPanThumbRatio))
      const usableTrackWidth = Math.max(1, trackWidth - thumbPx)
      const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width))
      const ratio = rect.width > 0 ? x / rect.width : 0
      viewport.scrollLeft = ratio * maxScroll

      horizontalPanDragRef.current.active = true
      horizontalPanDragRef.current.pointerId = event.pointerId
      horizontalPanDragRef.current.startX = event.clientX
      horizontalPanDragRef.current.startScrollLeft = viewport.scrollLeft
      horizontalPanDragRef.current.usableTrackWidth = usableTrackWidth
      horizontalPanDragRef.current.maxScroll = maxScroll
      setHorizontalScrollbarActive(true)

      try {
        horizontalTrack.setPointerCapture(event.pointerId)
      } catch {}

      const onMove = (e: PointerEvent) => {
        if (!horizontalPanDragRef.current.active) return
        if (horizontalPanDragRef.current.pointerId != null && e.pointerId !== horizontalPanDragRef.current.pointerId) return
        stop(e)
        const usable = Math.max(1, horizontalPanDragRef.current.usableTrackWidth)
        const max = Math.max(0, horizontalPanDragRef.current.maxScroll)
        const dx = e.clientX - horizontalPanDragRef.current.startX
        const ratioDx = dx / usable
        const target = horizontalPanDragRef.current.startScrollLeft + ratioDx * max * manualScrollGain
        viewport.scrollLeft = Math.max(0, Math.min(target, max))
      }
      const onUpLike = (e: PointerEvent) => {
        if (!horizontalPanDragRef.current.active) return
        if (horizontalPanDragRef.current.pointerId != null && e.pointerId !== horizontalPanDragRef.current.pointerId) return
        stop(e)
        horizontalPanDragRef.current.active = false
        horizontalPanDragRef.current.pointerId = null
        setHorizontalScrollbarActive(false)
        clearWindow()
        try {
          horizontalTrack.releasePointerCapture(e.pointerId)
        } catch {}
      }

      clearWindow()
      addWindow('pointermove', onMove)
      addWindow('pointerup', onUpLike)
      addWindow('pointercancel', onUpLike)
    }

    const beginVertical = (event: PointerEvent) => {
      if (!viewport || !verticalTrack) return
      stop(event)
      const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      const rect = verticalTrack.getBoundingClientRect()
      const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height))
      const ratio = rect.height > 0 ? y / rect.height : 0
      viewport.scrollTop = ratio * maxScroll

      verticalPanDragRef.current.active = true
      verticalPanDragRef.current.pointerId = event.pointerId
      verticalPanDragRef.current.startY = event.clientY
      verticalPanDragRef.current.startScrollTop = viewport.scrollTop
      const trackHeight = Math.max(1, rect.height)
      const thumbPx = trackHeight * Math.max(0, Math.min(1, verticalPanThumbRatio))
      verticalPanDragRef.current.usableTrackHeight = Math.max(1, trackHeight - thumbPx)
      verticalPanDragRef.current.maxScroll = maxScroll
      setVerticalScrollbarActive(true)

      try {
        verticalTrack.setPointerCapture(event.pointerId)
      } catch {}

      const onMove = (e: PointerEvent) => {
        if (!verticalPanDragRef.current.active) return
        if (verticalPanDragRef.current.pointerId != null && e.pointerId !== verticalPanDragRef.current.pointerId) return
        stop(e)
        const usable = Math.max(1, verticalPanDragRef.current.usableTrackHeight)
        const max = Math.max(0, verticalPanDragRef.current.maxScroll)
        const dy = e.clientY - verticalPanDragRef.current.startY
        const ratioDy = dy / usable
        const target = verticalPanDragRef.current.startScrollTop + ratioDy * max * manualScrollGain
        viewport.scrollTop = Math.max(0, Math.min(target, max))
      }
      const onUpLike = (e: PointerEvent) => {
        if (!verticalPanDragRef.current.active) return
        if (verticalPanDragRef.current.pointerId != null && e.pointerId !== verticalPanDragRef.current.pointerId) return
        stop(e)
        verticalPanDragRef.current.active = false
        verticalPanDragRef.current.pointerId = null
        setVerticalScrollbarActive(false)
        clearWindow()
        try {
          verticalTrack.releasePointerCapture(e.pointerId)
        } catch {}
      }

      clearWindow()
      addWindow('pointermove', onMove)
      addWindow('pointerup', onUpLike)
      addWindow('pointercancel', onUpLike)
    }

    const beginGain = (event: PointerEvent) => {
      if (!gainTrack) return
      stop(event)
      const rect = gainTrack.getBoundingClientRect()
      const trackHeight = Math.max(1, rect.height)
      const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height))
      const ratio = rect.height > 0 ? 1 - y / rect.height : 0
      const min = 1
      const max = 6
      setManualScrollGain(min + ratio * (max - min))

      masterGainDragRef.current.active = true
      masterGainDragRef.current.pointerId = event.pointerId
      masterGainDragRef.current.startY = event.clientY
      masterGainDragRef.current.startValue = manualScrollGain
      masterGainDragRef.current.trackHeight = trackHeight
      try {
        gainTrack.setPointerCapture(event.pointerId)
      } catch {}

      const onMove = (e: PointerEvent) => {
        if (!masterGainDragRef.current.active) return
        if (masterGainDragRef.current.pointerId != null && e.pointerId !== masterGainDragRef.current.pointerId) return
        stop(e)
        const dy = e.clientY - masterGainDragRef.current.startY
        const ratioMove = -dy / Math.max(1, masterGainDragRef.current.trackHeight)
        const minV = 1
        const maxV = 6
        const next = masterGainDragRef.current.startValue + ratioMove * (maxV - minV)
        setManualScrollGain(Math.max(minV, Math.min(maxV, next)))
      }
      const onUpLike = (e: PointerEvent) => {
        if (!masterGainDragRef.current.active) return
        if (masterGainDragRef.current.pointerId != null && e.pointerId !== masterGainDragRef.current.pointerId) return
        stop(e)
        masterGainDragRef.current.active = false
        masterGainDragRef.current.pointerId = null
        clearWindow()
        try {
          gainTrack.releasePointerCapture(e.pointerId)
        } catch {}
      }

      clearWindow()
      addWindow('pointermove', onMove)
      addWindow('pointerup', onUpLike)
      addWindow('pointercancel', onUpLike)
    }

    const optsCapture: AddEventListenerOptions = { capture: true }
    const optsCaptureActive: AddEventListenerOptions = { capture: true, passive: false }

    if (horizontalTrack) {
      horizontalTrack.addEventListener('pointerdown', beginHorizontal, optsCapture)
      horizontalTrack.addEventListener('touchstart', stop as any, optsCaptureActive)
    }
    if (verticalTrack) {
      verticalTrack.addEventListener('pointerdown', beginVertical, optsCapture)
      verticalTrack.addEventListener('touchstart', stop as any, optsCaptureActive)
    }
    if (gainTrack) {
      gainTrack.addEventListener('pointerdown', beginGain, optsCapture)
      gainTrack.addEventListener('touchstart', stop as any, optsCaptureActive)
    }

    return () => {
      clearWindow()
      if (horizontalTrack) {
        horizontalTrack.removeEventListener('pointerdown', beginHorizontal, optsCapture)
        horizontalTrack.removeEventListener('touchstart', stop as any, optsCaptureActive)
      }
      if (verticalTrack) {
        verticalTrack.removeEventListener('pointerdown', beginVertical, optsCapture)
        verticalTrack.removeEventListener('touchstart', stop as any, optsCaptureActive)
      }
      if (gainTrack) {
        gainTrack.removeEventListener('pointerdown', beginGain, optsCapture)
        gainTrack.removeEventListener('touchstart', stop as any, optsCaptureActive)
      }
    }
  }, [horizontalPanThumbRatio, manualScrollGain, verticalPanThumbRatio])

  const publishQuizState = useCallback(async (enabled: boolean) => {
    if (!hasControllerRights()) return
    const channel = channelRef.current
    if (!channel) return
    try {
      let quizId = quizIdRef.current
      let promptText = quizPromptRef.current
      let quizLabel = quizLabelRef.current
      let durationSec: number | undefined
      let endsAt: number | undefined

      // Snapshot current state BEFORE we unlock students for the quiz.
      // - Students use this to restore their board state after feedback.
      // - Teacher uses this to restore class state if the quiz is aborted (toggle off).
      const preQuizControl: ControlState = enabled ? (controlStateRef.current ?? null) : null
      if (enabled) {
        adminPreQuizControlStateRef.current = preQuizControl
        adminPreQuizControlCapturedRef.current = true
      }

      const phaseKey = lessonScriptPhaseKey
      const pointIndex = lessonScriptPointIndex
      const pointId = lessonScriptV2ActivePoint?.id || ''
      const pointTitle = lessonScriptV2ActivePoint?.title || ''
      const isChallengeBoard = typeof boardId === 'string' && boardId.startsWith('challenge:')

      if (enabled) {
        // Attempt to suggest a prompt from the teacher's current context.
        // This keeps UX unchanged: we still show a simple prompt dialog, but prefill it.
        if (!isChallengeBoard) {
          try {
            const teacherLatexContext = (useAdminStepComposer
              ? [adminSteps.map(s => s?.latex || '').join(' \\ '), adminDraftLatex].filter(Boolean).join(' \\ ')
              : latexDisplayStateRef.current?.enabled
                ? (latexDisplayStateRef.current?.latex || '')
                : (latexOutput || '')
            ).trim()

              // Capture broader lesson context (text + diagrams) as best-effort.
              const [textCtx, diagramCtx] = await Promise.all([
                requestWindowContext<any>({ requestEvent: 'philani-text:request-context', responseEvent: 'philani-text:context', timeoutMs: 220 }),
                requestWindowContext<any>({ requestEvent: 'philani-diagrams:request-context', responseEvent: 'philani-diagrams:context', timeoutMs: 220 }),
              ])

              const textBoxes: Array<{ id: string; text: string }> = Array.isArray(textCtx?.boxes)
                ? textCtx.boxes
                    .map((b: any) => ({ id: typeof b?.id === 'string' ? b.id : '', text: typeof b?.text === 'string' ? b.text : '' }))
                    .filter((b: any) => b.id && b.text)
                : []

              const textTimeline = Array.isArray(textCtx?.timeline)
                ? textCtx.timeline
                    .map((e: any) => ({
                      ts: typeof e?.ts === 'number' ? e.ts : NaN,
                      kind: typeof e?.kind === 'string' ? e.kind : '',
                      action: typeof e?.action === 'string' ? e.action : '',
                      boxId: typeof e?.boxId === 'string' ? e.boxId : undefined,
                      visible: typeof e?.visible === 'boolean' ? e.visible : undefined,
                      textSnippet: typeof e?.textSnippet === 'string' ? e.textSnippet : undefined,
                    }))
                    .filter((e: any) => Number.isFinite(e.ts) && e.kind && e.action)
                : []

              const activeDiagram = diagramCtx?.activeDiagram
              const diagramSummary = (() => {
                if (!activeDiagram || typeof activeDiagram !== 'object') return ''
                const title = typeof activeDiagram.title === 'string' ? activeDiagram.title.trim() : ''
                const url = typeof activeDiagram.imageUrl === 'string' ? activeDiagram.imageUrl.trim() : ''
                const ann = activeDiagram.annotations
                const strokes = Array.isArray(ann?.strokes) ? ann.strokes.length : 0
                const arrows = Array.isArray(ann?.arrows) ? ann.arrows.length : 0
                const bits = []
                bits.push(`- Active diagram: ${title || '(untitled)'}`)
                if (url) bits.push(`  imageUrl: ${url}`)
                if (strokes || arrows) bits.push(`  annotations: strokes=${strokes}, arrows=${arrows}`)
                return bits.join('\n')
              })()

              const diagramTimeline = Array.isArray(diagramCtx?.timeline)
                ? diagramCtx.timeline
                    .map((e: any) => ({
                      ts: typeof e?.ts === 'number' ? e.ts : NaN,
                      kind: typeof e?.kind === 'string' ? e.kind : '',
                      action: typeof e?.action === 'string' ? e.action : '',
                      diagramId: typeof e?.diagramId === 'string' ? e.diagramId : undefined,
                      title: typeof e?.title === 'string' ? e.title : undefined,
                      imageUrl: typeof e?.imageUrl === 'string' ? e.imageUrl : undefined,
                      strokes: typeof e?.strokes === 'number' ? e.strokes : undefined,
                      arrows: typeof e?.arrows === 'number' ? e.arrows : undefined,
                    }))
                    .filter((e: any) => Number.isFinite(e.ts) && e.kind && e.action)
                : []

              const lessonContextText = buildLessonContextText({
                gradeLabel: gradeLabel || null,
                phaseKey: phaseKey || '',
                pointTitle: pointTitle || '',
                pointIndex: Number.isFinite(pointIndex) ? (pointIndex as any) : null,
                teacherLatexContext,
                adminStepsLatex: adminSteps.map(s => (s?.latex || '')).filter(Boolean),
                adminDraftLatex,
                textBoxes,
                textTimeline,
                diagramSummary,
                diagramTimeline,
              })

            const aiRes = await fetch('/api/ai/quiz-prompt', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json', 'x-debug-echo': '1' },
              body: JSON.stringify({
                gradeLabel: gradeLabel || undefined,
                teacherLatex: teacherLatexContext || undefined,
                  lessonContextText: lessonContextText || undefined,
                previousPrompt: promptText || undefined,
                sessionId: boardId || undefined,
                phaseKey: phaseKey || undefined,
                pointId: pointId || undefined,
                pointIndex: Number.isFinite(pointIndex) ? pointIndex : undefined,
                pointTitle: pointTitle || undefined,
              }),
            })
            if (aiRes.ok) {
              const data = await aiRes.json().catch(() => null)
              const echoed = typeof data?.debug?.lessonContextText === 'string' ? data.debug.lessonContextText : ''
              if (echoed) {
                console.log('[quiz-prompt debug echo] lessonContextText (what Gemini received):\n' + echoed)
              }
              const suggested = typeof data?.prompt === 'string' ? data.prompt.trim() : ''
              if (suggested) {
                promptText = suggested
              }
              const suggestedLabel = typeof data?.label === 'string' ? data.label.trim() : ''
              if (suggestedLabel) {
                quizLabel = suggestedLabel
              }
            } else {
              const rawBody = await aiRes.text().catch(() => '')
              console.warn('quiz-prompt API failed', aiRes.status, rawBody)
              let detail = ''
              try {
                const parsed = JSON.parse(rawBody || '{}')
                const msg = typeof parsed?.message === 'string' ? parsed.message.trim() : ''
                const err = typeof parsed?.error === 'string' ? parsed.error.trim() : ''
                detail = (msg || err) ? [msg, err].filter(Boolean).join(' — ') : ''
              } catch {
                detail = rawBody.trim()
              }

              if (!promptText) {
                const hint = detail ? ` (${detail})` : ''
                promptText = `Gemini prompt suggestion failed${hint}. Enter quiz instructions manually.`
              }
            }
          } catch (err) {
            console.warn('quiz-prompt API error', err)
            if (!promptText) {
              promptText = 'Gemini prompt suggestion failed. Enter quiz instructions manually.'
            }
          }
        } else {
          if (!promptText) {
            promptText = 'Enter quiz instructions manually.'
          }
        }

        // Teacher enters the quiz prompt at the moment quiz mode starts.
        if (typeof window !== 'undefined') {
          const entered = window.prompt('Quiz question / instructions (shown to students):', promptText || '')
          if (entered === null) {
            return
          }
          const trimmed = entered.trim()
          if (!trimmed) {
            return
          }
          promptText = trimmed
        }

        // Ask Gemini for a sensible quiz timer based on the final prompt (admin-only).
        // Never call AI tools for learner-created challenges.
        if (!isChallengeBoard) {
          try {
            const timerRes = await fetch('/api/ai/quiz-timer', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                gradeLabel: gradeLabel || undefined,
                prompt: promptText,
              }),
            })
            if (timerRes.ok) {
              const data = await timerRes.json().catch(() => null)
              const maybe = typeof data?.durationSec === 'number' ? Math.trunc(data.durationSec) : 0
              if (Number.isFinite(maybe) && maybe > 0) {
                durationSec = maybe
                endsAt = Date.now() + maybe * 1000
              }
            } else {
              const rawBody = await timerRes.text().catch(() => '')
              console.warn('quiz-timer API failed', timerRes.status, rawBody)
            }
          } catch (err) {
            console.warn('quiz-timer API error', err)
          }
        }

        // Safety fallback: keep UX functional even if AI timer fails.
        if (!durationSec || !endsAt) {
          durationSec = 300
          endsAt = Date.now() + durationSec * 1000
        }

        // Admin moderation: allow teacher to override the suggested timer before broadcasting.
        // Keep UX simple (native prompts) but provide separate minute + second fields.
        if (typeof window !== 'undefined') {
          try {
            const suggestedMin = Math.max(0, Math.floor(durationSec / 60))
            const suggestedSec = Math.max(0, Math.min(59, Math.round(durationSec - suggestedMin * 60)))

            const enteredMin = window.prompt(
              `Time limit minutes (suggested ${suggestedMin}):`,
              String(suggestedMin)
            )
            if (enteredMin === null) return

            const enteredSec = window.prompt(
              `Time limit seconds (0–59) (suggested ${suggestedSec}):`,
              String(suggestedSec)
            )
            if (enteredSec === null) return

            const rawMin = (enteredMin || '').trim()
            const rawSec = (enteredSec || '').trim()

            // If teacher keeps both fields empty, keep Gemini (or fallback) suggestion.
            if (!rawMin && !rawSec) {
              // keep durationSec/endsAt as-is
            } else {
              // Minutes: allow comma decimals like 0,5 (common locale input).
              const minFloat = rawMin
                ? Number.parseFloat(rawMin.replace(',', '.'))
                : 0

              const minSec = (Number.isFinite(minFloat) && minFloat > 0)
                ? Math.round(minFloat * 60)
                : 0

              const secInt = rawSec
                ? Number.parseInt(rawSec.replace(',', '.'), 10)
                : 0

              const safeSec = Number.isFinite(secInt) && secInt > 0
                ? Math.max(0, Math.min(59, secInt))
                : 0

              const nextSec = minSec + safeSec
              const clampedSec = Math.max(30, Math.min(1800, nextSec))
              durationSec = clampedSec
              endsAt = Date.now() + clampedSec * 1000
            }
          } catch {}
        }

        // Create a new quiz instance id each time quiz mode starts.
        try {
          quizId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
            ? (crypto as any).randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        } catch {
          quizId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        }
        quizIdRef.current = quizId
        quizPromptRef.current = promptText
        quizLabelRef.current = quizLabel
        quizPhaseKeyRef.current = phaseKey
        quizPointIdRef.current = pointId
        quizPointIndexRef.current = Number.isFinite(pointIndex) ? Math.trunc(pointIndex) : -1

        // Show the quiz prompt via the floating text module.
        try {
          const overlayText = `${quizLabel ? `${quizLabel}\n` : ''}${promptText}`
          window.dispatchEvent(new CustomEvent('philani-text:script-apply', {
            detail: { id: 'quiz-prompt', text: overlayText, visible: true },
          }))
        } catch {}
      } else {
        // Hide the quiz prompt box when the quiz ends.
        try {
          window.dispatchEvent(new CustomEvent('philani-text:script-apply', {
            detail: { id: 'quiz-prompt', visible: false },
          }))
        } catch {}
        quizIdRef.current = ''
        quizPromptRef.current = ''
        quizLabelRef.current = ''
        quizPhaseKeyRef.current = ''
        quizPointIdRef.current = ''
        quizPointIndexRef.current = -1
      }

      await channel.publish('control', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        action: 'quiz',
        phase: enabled ? 'active' : 'inactive',
        enabled,
        preQuizControl: enabled ? preQuizControl : undefined,
        quizId: enabled ? quizId : undefined,
        quizLabel: enabled ? quizLabel : undefined,
        quizPhaseKey: enabled ? phaseKey : undefined,
        quizPointId: enabled ? pointId : undefined,
        quizPointIndex: enabled ? pointIndex : undefined,
        prompt: enabled ? promptText : undefined,
        durationSec: enabled ? durationSec : undefined,
        endsAt: enabled ? endsAt : undefined,
        ts: Date.now(),
      } satisfies QuizControlMessage)

      // Stopping/aborting quiz: restore class state to what it was before the quiz started.
      if (!enabled) {
        // Clear captured pre-quiz state snapshots.
        adminPreQuizControlStateRef.current = null
        adminPreQuizControlCapturedRef.current = false
      }
    } catch (err) {
      console.warn('Failed to publish quiz state', err)
    }
  }, [adminDraftLatex, adminSteps, boardId, gradeLabel, hasControllerRights, isAdmin, latexOutput, lessonScriptPhaseKey, lessonScriptPointIndex, lessonScriptV2ActivePoint?.id, lessonScriptV2ActivePoint?.title, useAdminStepComposer, userDisplayName])

  const studentQuizCommitOrSubmit = useCallback(async (opts?: { forceSubmit?: boolean; skipConfirm?: boolean }) => {
    const isSolution = assignmentSubmission?.kind === 'solution'
    // This flow is for learners (and for teachers when authoring solutions).
    // Don't block it just because we grant write access on single-user canvases.
    if (isAdmin && !isSolution) return

    const isAssignment = Boolean(assignmentSubmission?.assignmentId && assignmentSubmission?.questionId && assignmentSubmission?.sessionId)
    const isChallengeBoard = typeof boardId === 'string' && boardId.startsWith('challenge:')
    if (!quizActiveRef.current && !isAssignment) return
    if (quizSubmitting) return
    if (!boardId) {
      alert('This quiz session is missing a session id (boardId).')
      return
    }
    const editor = editorInstanceRef.current
    if (!editor) return

    const forceSubmit = Boolean(opts?.forceSubmit)
    const skipConfirm = Boolean(opts?.skipConfirm)

    setQuizSubmitting(true)
    try {
      try {
        if (typeof editor.waitForIdle === 'function') {
          await editor.waitForIdle()
        }
      } catch {}

      // Determine if canvas currently has ink.
      const snap = captureFullSnapshot()
      const symbolCount = countSymbols(snap?.symbols)
      const hasInk = symbolCount > 0
      const studentTextSnapshot = (studentQuizTextResponseRef.current || '').trim()

      const getStepLatex = async () => {
        let step = ''
        try {
          const modelLatex = getLatexFromEditorModel()
          const normalizedModel = normalizeStepLatex(modelLatex)
          if (normalizedModel) step = normalizedModel
        } catch {}
        if (!step) {
          for (let i = 0; i < 3 && !step; i += 1) {
            const exported = await exportLatexFromEditor()
            const normalized = normalizeStepLatex(exported)
            if (normalized) {
              step = normalized
              break
            }
            await new Promise<void>(resolve => setTimeout(resolve, 200))
          }
        }
        return step
      }

      const applyStudentStepCommit = (step: string, symbols: any[] | null) => {
        let nextCombined = ''
        setStudentSteps(prev => {
          const next = [...prev]
          if (studentEditIndex !== null && studentEditIndex >= 0 && studentEditIndex < next.length) {
            next[studentEditIndex] = { latex: step, symbols }
          } else {
            next.push({ latex: step, symbols })
          }
          nextCombined = next.map(s => s.latex).filter(Boolean).join(' \\\\ ')
          return next
        })
        quizCombinedLatexRef.current = nextCombined
        quizHasCommittedRef.current = true
        setStudentCommittedLatex(nextCombined)
        setStudentEditIndex(null)
        clearTopPanelSelection()
      }

      if (hasInk && !forceSubmit) {
        // First-stage send: commit this line into combined latex and clear bottom canvas.
        const step = await getStepLatex()
        if (!step) return
        applyStudentStepCommit(step, snap?.symbols ?? null)

        suppressBroadcastUntilTsRef.current = Date.now() + 1200
        try {
          editor.clear?.()
        } catch {}
        lastSymbolCountRef.current = 0
        lastBroadcastBaseCountRef.current = 0
        setLatexOutput('')
        if (!isChallengeBoard && !isAssignment) return
        if (isAssignment) return
      }

      // Force-submit mode (timer): include current ink as the last step if present.
      if (hasInk && forceSubmit) {
        const step = await getStepLatex()
        if (step) {
          applyStudentStepCommit(step, snap?.symbols ?? null)
        }
      }

      // Second-stage send: if blank, prompt to submit (only after at least one commit).
      let combined = quizCombinedLatexRef.current.trim()
      if (isAssignment && !combined) {
        // Fallback: derive from the top panel sources (student steps + live draft).
        const stepLines = studentSteps.map(s => s.latex)
        const draft = (latexOutput || '').trim()
        if (studentEditIndex !== null && studentEditIndex >= 0 && studentEditIndex < stepLines.length) {
          if (draft) {
            stepLines[studentEditIndex] = draft
          }
        } else if (draft) {
          stepLines.push(draft)
        }
        const merged = stepLines.filter(Boolean).join(' \\\\ ').trim()
        if (merged) {
          combined = merged
          quizCombinedLatexRef.current = merged
          quizHasCommittedRef.current = true
        }
      }
      if (isChallengeBoard && !combined) {
        // Fallback: derive from the top panel sources (student steps + live draft).
        const stepLines = studentSteps.map(s => s.latex)
        const draft = (latexOutput || '').trim()
        if (studentEditIndex !== null && studentEditIndex >= 0 && studentEditIndex < stepLines.length) {
          if (draft) {
            stepLines[studentEditIndex] = draft
          }
        } else if (draft) {
          stepLines.push(draft)
        }
        const merged = stepLines.filter(Boolean).join(' \\ ').trim()
        if (merged) {
          combined = merged
          quizCombinedLatexRef.current = merged
          quizHasCommittedRef.current = true
        }
      }

      // Assignment pages use a strict 2-stage flow: if there's nothing on the canvas to commit
      // AND no prior committed work, treat this as a no-op.
      const hasStepData = quizHasCommittedRef.current || studentSteps.length > 0 || Boolean(studentTextSnapshot)
      if (isAssignment && !hasInk && !hasStepData) {
        return
      }
      if (isChallengeBoard && !combined && !hasInk && !quizHasCommittedRef.current && !studentTextSnapshot) {
        alert('Add work or a typed response before submitting.')
        return
      }
      if (!combined) {
        // Server requires non-empty LaTeX.
        combined = studentTextSnapshot ? '\\text{(typed\\ response)}' : '\\text{(no\\ response)}'
        quizCombinedLatexRef.current = combined
      }

      if (!skipConfirm) {
        const ok = typeof window !== 'undefined'
          ? window.confirm(
            isSolution
              ? 'Save this solution?'
              : isAssignment
                ? 'Submit your assignment response?'
                : 'Submit your quiz response?'
          )
          : true
        if (!ok) return
      }

      if (isAssignment) {
        // Persist under assignments (NOT quizzes).
        const endpoint = isSolution ? 'solutions' : 'responses'
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(assignmentSubmission!.sessionId)}/assignments/${encodeURIComponent(assignmentSubmission!.assignmentId)}/${endpoint}`,
          {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              latex: combined,
              questionId: assignmentSubmission!.questionId,
            }),
          }
        )
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          alert(data?.message || (isSolution ? `Failed to save solution (${res.status})` : `Failed to submit assignment response (${res.status})`))
          return
        }

        // Notify the page to display/update the saved response/solution under this question.
        try {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent(isSolution ? 'philani:assignment-solution-saved' : 'philani:assignment-response-saved', {
                detail: {
                  assignmentId: assignmentSubmission!.assignmentId,
                  questionId: assignmentSubmission!.questionId,
                  latex: combined,
                  ts: Date.now(),
                },
              })
            )
          }
        } catch {}

        // Keep the question active (assignment-style): reset the step composer for future edits.
        quizCombinedLatexRef.current = ''
        quizHasCommittedRef.current = false
        setStudentCommittedLatex('')
        suppressBroadcastUntilTsRef.current = Date.now() + 600
        try {
          editor.clear?.()
        } catch {}
        lastSymbolCountRef.current = 0
        lastBroadcastBaseCountRef.current = 0
        setLatexOutput('')
        playSnapSound()
        return
      }

      // Default quiz behavior: persist under the session responses (dashboard Quizzes folder).
      const res = await fetch(`/api/sessions/${encodeURIComponent(boardId)}/responses`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latex: combined,
          studentText: studentTextSnapshot || undefined,
          quizId: quizIdRef.current || undefined,
          prompt: quizPromptRef.current || undefined,
          quizLabel: quizLabelRef.current || undefined,
          quizPhaseKey: quizPhaseKeyRef.current || undefined,
          quizPointId: quizPointIdRef.current || undefined,
          quizPointIndex: quizPointIndexRef.current >= 0 ? quizPointIndexRef.current : undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data?.message || `Failed to submit response (${res.status})`)
        return
      }

      // Student-only: once the response is successfully submitted, hide quiz popups locally.
      // This should not affect lesson-context text boxes added by the teacher.
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('philani-quiz:submitted'))
        }
      } catch {}

      // Student-only: show instant AI feedback in a local popup textbox.
      try {
        const isChallengeBoard = typeof boardId === 'string' && boardId.startsWith('challenge:')
        // Skip AI feedback for learner-created challenges only.
        if (!isChallengeBoard) {
          const fbRes = await fetch('/api/ai/quiz-feedback', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              gradeLabel: gradeLabel || undefined,
              prompt: quizPromptRef.current || undefined,
              studentLatex: combined,
              studentText: studentTextSnapshot || undefined,
            }),
          })
          if (fbRes.ok) {
            const data = await fbRes.json().catch(() => null)
            const feedback = typeof data?.feedback === 'string' ? data.feedback.trim() : ''
            if (feedback && typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('philani-text:local-apply', {
                detail: { id: 'quiz-feedback', text: feedback, visible: true },
              }))
              playSnapSound()
            }
          } else {
            const bodyText = await fbRes.text().catch(() => '')
            console.warn('quiz-feedback API failed', fbRes.status, bodyText)
          }
        }
      } catch (err) {
        console.warn('quiz-feedback API error', err)
      }

      // Notify teacher immediately with the combined latex string.
      try {
        await channelRef.current?.publish('control', {
          clientId: clientIdRef.current,
          author: userDisplayName,
          action: 'quiz',
          phase: 'submit',
          combinedLatex: combined,
          fromUserId: userId,
          fromName: userDisplayName,
          ts: Date.now(),
        } satisfies QuizControlMessage)
      } catch {}

      // Restore pre-quiz canvas view.
      const baseline = quizBaselineSnapshotRef.current
      quizBaselineSnapshotRef.current = null
      quizCombinedLatexRef.current = ''
      quizHasCommittedRef.current = false
      setStudentCommittedLatex('')
      setStudentSteps([])
      setStudentEditIndex(null)
      clearTopPanelSelection()
      setQuizActiveState(false)
      clearQuizCountdown()

      // Restore the pre-quiz lock/control state (what the board was before the quiz started).
      if (!forceEditableForAssignment && preQuizControlCapturedRef.current) {
        const prior = preQuizControlStateRef.current
        preQuizControlStateRef.current = null
        preQuizControlCapturedRef.current = false
        updateControlState(prior)
      }

      if (baseline) {
        await applyPageSnapshot(baseline)
      } else {
        await channelRef.current?.publish('sync-request', { clientId: clientIdRef.current, author: userDisplayName, ts: Date.now() })
      }
    } finally {
      setQuizSubmitting(false)
    }
  }, [applyPageSnapshot, assignmentSubmission, boardId, captureFullSnapshot, clearQuizCountdown, clearTopPanelSelection, exportLatexFromEditor, forceEditableForAssignment, getLatexFromEditorModel, hasWriteAccess, latexOutput, normalizeStepLatex, playSnapSound, quizSubmitting, setQuizActiveState, studentEditIndex, studentSteps, updateControlState, userDisplayName, userId])

  const handleSendStepClick = useCallback(async () => {
    if ((!isAdmin || isAssignmentSolutionAuthoring) && (quizActiveRef.current || isAssignmentViewRef.current)) {
      if (lockedOutRef.current) return
      await studentQuizCommitOrSubmit()
      return
    }

    const editor = editorInstanceRef.current
    if (!editor) return
    if (lockedOutRef.current) return
    if (adminSendingStep) return

    if (isAdmin && !isAssignmentSolutionAuthoring) {
      const emptyCanvas = isEditorEmptyNow()
      const emptyLine = isCurrentLineEmptyNow()
      if (emptyCanvas && emptyLine && adminSteps.length > 0) {
        const noteId = createSessionNoteId()
        setFinishQuestionNoteId(noteId)
        setFinishQuestionTitle(prettyPrintTitleFromLatex(adminSteps[0]?.latex || ''))
        setLatexSaveError(null)
        setFinishQuestionModalOpen(true)
        return
      }
    }

    // Reset the manual horizontal scrollbar to the start whenever a step is sent.
    // (Keeps the next step starting from the left.)
    try {
      const viewport = studentViewportRef.current
      if (viewport) {
        viewport.scrollLeft = 0
      }
      setHorizontalPanValue(0)
    } catch {}

    setAdminSendingStep(true)

    try {
      // Ensure we have the latest preview before committing.
      // Let recognition catch up before committing.
      try {
        if (typeof editor.waitForIdle === 'function') {
          await editor.waitForIdle()
        }
      } catch {}

      let step = adminDraftLatex
      if (!step) {
        const modelLatex = getLatexFromEditorModel()
        const normalizedModel = normalizeStepLatex(modelLatex)
        if (normalizedModel) {
          step = normalizedModel
          setLatexOutput(modelLatex)
          setAdminDraftLatex(normalizedModel)
        }
      }
      if (!step) {
        // Retry export a few times in case recognition is still catching up.
        for (let i = 0; i < 3 && !step; i += 1) {
          const exported = await exportLatexFromEditor()
          const normalized = normalizeStepLatex(exported)
          if (normalized) {
            step = normalized
            setLatexOutput(exported)
            setAdminDraftLatex(normalized)
            break
          }
          await new Promise<void>(resolve => setTimeout(resolve, 250))
        }
      }
      // If still empty (e.g., everything scratched away), do not commit.
      if (!step) return

      const snapshot = captureFullSnapshot()
      const symbols = snapshot?.symbols ?? null
      setAdminSteps(prev => {
        const next = [...prev]
        if (adminEditIndex !== null && adminEditIndex >= 0 && adminEditIndex < next.length) {
          next[adminEditIndex] = { latex: step, symbols }
        } else {
          next.push({ latex: step, symbols })
        }
        return next
      })
      setAdminDraftLatex('')
      setAdminEditIndex(null)
      setLatexOutput('')

      // Clear handwriting for next step without broadcasting a global clear.
      suppressBroadcastUntilTsRef.current = Date.now() + 1200
      try {
        editor.clear?.()
      } catch {}
      lastSymbolCountRef.current = 0
      lastBroadcastBaseCountRef.current = 0
    } finally {
      setAdminSendingStep(false)
    }
  }, [
    adminDraftLatex,
    adminEditIndex,
    adminSendingStep,
    adminSteps,
    captureFullSnapshot,
    exportLatexFromEditor,
    getLatexFromEditorModel,
    isAdmin,
    isAssignmentSolutionAuthoring,
    isCurrentLineEmptyNow,
    isEditorEmptyNow,
    normalizeStepLatex,
    studentQuizCommitOrSubmit,
  ])

  useEffect(() => {
    if (hasWriteAccess) return
    if (!quizActive) return
    if (quizSubmitting) return
    if (quizTimeLeftSec == null) return
    if (quizTimeLeftSec > 0) return
    if (quizAutoSubmitTriggeredRef.current) return
    quizAutoSubmitTriggeredRef.current = true
    void (async () => {
      await studentQuizCommitOrSubmit({ forceSubmit: true, skipConfirm: true })
    })()
  }, [hasWriteAccess, quizActive, quizSubmitting, quizTimeLeftSec, studentQuizCommitOrSubmit])

  const toggleMobileDiagramTray = useCallback(() => {
    if (typeof window === 'undefined') return
    try {
      window.dispatchEvent(
        new CustomEvent('philani-diagrams:toggle-tray', {
          detail: {
            bottomOffsetPx: viewportBottomOffsetPx,
            reservePx: STACKED_BOTTOM_OVERLAY_RESERVE_PX,
          },
        })
      )
    } catch {}
  }, [viewportBottomOffsetPx])

  const didAutoOpenDiagramTrayRef = useRef(false)
  useEffect(() => {
    if (!autoOpenDiagramTray) return
    if (!hasControllerRights()) return
    if (typeof window === 'undefined') return
    if (didAutoOpenDiagramTrayRef.current) return

    // This matches the middle-strip diagram icon behaviour: only the compact (mobile) UI uses the tray.
    if (!isCompactViewport) return

    didAutoOpenDiagramTrayRef.current = true
    const t = window.setTimeout(() => {
      toggleMobileDiagramTray()
    }, 0)
    return () => window.clearTimeout(t)
  }, [autoOpenDiagramTray, hasControllerRights, isCompactViewport, toggleMobileDiagramTray])

  const toggleMobileTextTray = useCallback(() => {
    if (typeof window === 'undefined') return
    try {
      window.dispatchEvent(new CustomEvent('philani-text:toggle-tray'))
    } catch {}
  }, [])

  const [mobileLatexTrayOpen, setMobileLatexTrayOpen] = useState(false)
  const [sessionLatexSelection, setSessionLatexSelection] = useState<{ moduleIndex: number; latex: string } | null>(null)

  const [mobileModulePicker, setMobileModulePicker] = useState<null | { type: MobileModulePickerType }>(null)

  const isLessonAuthoringMode = Boolean(lessonAuthoring?.phaseKey && lessonAuthoring?.pointId)

  const toggleMobileLatexTray = useCallback(() => {
    if (typeof window === 'undefined') return
    try {
      window.dispatchEvent(new CustomEvent('philani-latex:toggle-tray'))
    } catch {}
  }, [])

  const v2ModuleChoices = useMemo(() => {
    return (lessonScriptV2ActiveModules || []).map((mod, index) => ({ index, mod }))
  }, [lessonScriptV2ActiveModules])

  const openPickerOrApplySingle = useCallback(
    (type: MobileModulePickerType) => {
      if (!hasControllerRights()) return
      if (typeof window === 'undefined') return
      // The icon row that calls this only renders on compact viewports.
      if (!isCompactViewport) return
      // In authoring mode there may be no loaded session script; keep behaviour minimal.
      if (isLessonAuthoringMode) return

      const matches = v2ModuleChoices.filter(({ mod }) => mod.type === type)
      if (matches.length === 0) return

      if (matches.length === 1) {
        void applyLessonScriptPlaybackV2(lessonScriptPhaseKey, lessonScriptPointIndex, matches[0].index)
        setMobileModulePicker(null)
        return
      }

      setMobileModulePicker({ type })
    },
    [applyLessonScriptPlaybackV2, hasControllerRights, isCompactViewport, isLessonAuthoringMode, lessonScriptPhaseKey, lessonScriptPointIndex, v2ModuleChoices]
  )

  const closeMobileModulePicker = useCallback(() => {
    setMobileModulePicker(null)
  }, [])

  useEffect(() => {
    if (!isCompactViewport) {
      setMobileModulePicker(null)
    }
  }, [isCompactViewport])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => {
      if (!hasControllerRights()) return
      setMobileLatexTrayOpen(prev => !prev)
    }
    window.addEventListener('philani-latex:toggle-tray', handler as any)
    return () => window.removeEventListener('philani-latex:toggle-tray', handler as any)
  }, [hasControllerRights])

  useEffect(() => {
    if (!hasControllerRights()) {
      setMobileLatexTrayOpen(false)
      return
    }
    if (!isCompactViewport) {
      setMobileLatexTrayOpen(false)
    }
  }, [hasControllerRights, isCompactViewport])
  const strokeTrackRef = useRef<{ active: boolean; startX: number; lastX: number; minX: number; maxX: number; leftPanArmed: boolean }>(
    { active: false, startX: 0, lastX: 0, minX: 0, maxX: 0, leftPanArmed: false }
  )
  const autoPanAnimRef = useRef<number | null>(null)
  const leftPanPendingDxRef = useRef(0)
  const leftPanRafRef = useRef<number | null>(null)
  useEffect(() => {
    if (!useStackedStudentLayout) return
    const viewport = studentViewportRef.current
    if (!viewport) return

    const update = () => {
      const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
      setHorizontalPanMax(max)
      const ratio = viewport.scrollWidth > 0 ? Math.min(1, Math.max(0, viewport.clientWidth / viewport.scrollWidth)) : 1
      setHorizontalPanThumbRatio(ratio)
      const clamped = Math.max(0, Math.min(viewport.scrollLeft, max))
      setHorizontalPanValue(clamped)
      if (viewport.scrollLeft !== clamped) {
        viewport.scrollLeft = clamped
      }
    }

    update()

    const onScroll = () => {
      if (typeof window === 'undefined') return
      if (horizontalPanRafRef.current) return
      horizontalPanRafRef.current = window.requestAnimationFrame(() => {
        horizontalPanRafRef.current = null
        update()
      })
    }

    viewport.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', update)

    let ro: ResizeObserver | null = null
    try {
      ro = new ResizeObserver(() => update())
      ro.observe(viewport)
    } catch {}

    return () => {
      viewport.removeEventListener('scroll', onScroll as any)
      window.removeEventListener('resize', update)
      try {
        ro?.disconnect()
      } catch {}
      if (horizontalPanRafRef.current && typeof window !== 'undefined') {
        try {
          window.cancelAnimationFrame(horizontalPanRafRef.current)
        } catch {}
        horizontalPanRafRef.current = null
      }
    }
  }, [inkSurfaceWidthFactor, studentViewScale, useStackedStudentLayout])

  useEffect(() => {
    if (!useStackedStudentLayout) return
    const viewport = studentViewportRef.current
    if (!viewport) return

    const update = () => {
      const max = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      setVerticalPanMax(max)
      const ratio = viewport.scrollHeight > 0 ? Math.min(1, Math.max(0, viewport.clientHeight / viewport.scrollHeight)) : 1
      setVerticalPanThumbRatio(ratio)
      const clamped = Math.max(0, Math.min(viewport.scrollTop, max))
      setVerticalPanValue(clamped)
      if (viewport.scrollTop !== clamped) {
        viewport.scrollTop = clamped
      }
    }

    update()

    const onScroll = () => {
      if (typeof window === 'undefined') return
      if (verticalPanRafRef.current) return
      verticalPanRafRef.current = window.requestAnimationFrame(() => {
        verticalPanRafRef.current = null
        update()
      })
    }

    viewport.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', update)

    let ro: ResizeObserver | null = null
    try {
      ro = new ResizeObserver(() => update())
      ro.observe(viewport)
    } catch {}

    return () => {
      viewport.removeEventListener('scroll', onScroll as any)
      window.removeEventListener('resize', update)
      try {
        ro?.disconnect()
      } catch {}
      if (verticalPanRafRef.current && typeof window !== 'undefined') {
        try {
          window.cancelAnimationFrame(verticalPanRafRef.current)
        } catch {}
        verticalPanRafRef.current = null
      }
    }
  }, [inkSurfaceWidthFactor, studentViewScale, useStackedStudentLayout])

  const smoothScrollViewportBy = useCallback((delta: number) => {
    const viewport = studentViewportRef.current
    if (!viewport) return
    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    if (max <= 0) return

    const startLeft = viewport.scrollLeft
    const targetLeft = Math.max(0, Math.min(startLeft + delta, max))
    const total = targetLeft - startLeft
    if (Math.abs(total) < 1) return

    if (typeof window === 'undefined') {
      viewport.scrollLeft = targetLeft
      return
    }

    if (autoPanAnimRef.current) {
      try {
        window.cancelAnimationFrame(autoPanAnimRef.current)
      } catch {}
      autoPanAnimRef.current = null
    }

    const durationMs = 220
    const startTs = window.performance?.now?.() ?? Date.now()
    const ease = (t: number) => 1 - Math.pow(1 - t, 3)

    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - startTs) / durationMs))
      viewport.scrollLeft = startLeft + total * ease(t)
      if (t < 1) {
        autoPanAnimRef.current = window.requestAnimationFrame(step)
      } else {
        autoPanAnimRef.current = null
      }
    }

    autoPanAnimRef.current = window.requestAnimationFrame(step)
  }, [])

  useEffect(() => {
    if (!useStackedStudentLayout) return
    if (!isCompactViewport) return
    if (!hasWriteAccess) return
    const host = editorHostRef.current
    if (!host) return

    const onDown = (event: PointerEvent) => {
      strokeTrackRef.current.active = true
      strokeTrackRef.current.startX = event.clientX
      strokeTrackRef.current.lastX = event.clientX
      strokeTrackRef.current.minX = event.clientX
      strokeTrackRef.current.maxX = event.clientX
      strokeTrackRef.current.leftPanArmed = false
    }
    const onMove = (event: PointerEvent) => {
      if (!strokeTrackRef.current.active) return
      const viewport = studentViewportRef.current
      const nextX = event.clientX
      const prevX = strokeTrackRef.current.lastX
      const dx = nextX - prevX
      strokeTrackRef.current.lastX = nextX
      strokeTrackRef.current.minX = Math.min(strokeTrackRef.current.minX, nextX)
      strokeTrackRef.current.maxX = Math.max(strokeTrackRef.current.maxX, nextX)

      // Exclusive special-case: only when a single pen-down stroke is moving right->left AND
      // the pointer has reached near the left edge (<10% from the left of the viewport).
      // This supports drawing long fraction bars from right to left without losing canvas.
      if (!viewport) return

      const rect = viewport.getBoundingClientRect()
      const leftEdgeTrigger = rect.left + rect.width * 0.1
      if (nextX <= leftEdgeTrigger) {
        strokeTrackRef.current.leftPanArmed = true
      }

      if (!strokeTrackRef.current.leftPanArmed) return
      if (dx >= 0) return

      const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
      if (maxScroll <= 0) return

      // Keep in-stroke left pan gentle (1:1). Extra clearance is applied on pen-up.
      leftPanPendingDxRef.current += dx
      if (typeof window === 'undefined') {
        viewport.scrollLeft = Math.max(0, Math.min(viewport.scrollLeft + leftPanPendingDxRef.current, maxScroll))
        leftPanPendingDxRef.current = 0
        return
      }

      if (leftPanRafRef.current) return
      leftPanRafRef.current = window.requestAnimationFrame(() => {
        leftPanRafRef.current = null
        const pending = leftPanPendingDxRef.current
        leftPanPendingDxRef.current = 0
        if (!pending) return
        viewport.scrollLeft = Math.max(0, Math.min(viewport.scrollLeft + pending, maxScroll))
      })
    }
    const onUpLike = () => {
      if (!strokeTrackRef.current.active) return
      strokeTrackRef.current.active = false

      leftPanPendingDxRef.current = 0

      // Only auto-pan between strokes (after pen lifts), to avoid disturbing handwriting.
      if (horizontalPanDragRef.current.active) return
      const viewport = studentViewportRef.current
      if (!viewport) return
      const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
      if (maxScroll <= 0) return

      const rect = viewport.getBoundingClientRect()
      // Threshold is the screen midpoint (50%). We keep the latest stroke footprint on the left side
      // of this imaginary center line, so there is always at least ~50% free space to the right.
      // Use the stroke's maxX so shapes that "finish" left but extend right (like a 3) still pan.
      const midX = rect.left + rect.width * 0.5
      const gain = 0.9

      // If the exclusive left-edge right-to-left mode was engaged, apply an extra pen-up scroll
      // so the stroke end point sits ~50% away from the left edge (clearance), then stop.
      if (strokeTrackRef.current.leftPanArmed) {
        const targetX = rect.left + rect.width * 0.5
        const delta = strokeTrackRef.current.lastX - targetX
        if (delta < -1) {
          smoothScrollViewportBy(delta)
        }
        return
      }

      const excessRight = strokeTrackRef.current.maxX - midX
      if (excessRight > 0) {
        smoothScrollViewportBy(excessRight * gain)
      }
    }

    host.addEventListener('pointerdown', onDown, { passive: true })
    host.addEventListener('pointermove', onMove, { passive: true })
    host.addEventListener('pointerup', onUpLike, { passive: true })
    host.addEventListener('pointercancel', onUpLike, { passive: true })

    return () => {
      host.removeEventListener('pointerdown', onDown as any)
      host.removeEventListener('pointermove', onMove as any)
      host.removeEventListener('pointerup', onUpLike as any)
      host.removeEventListener('pointercancel', onUpLike as any)
      if (autoPanAnimRef.current && typeof window !== 'undefined') {
        try {
          window.cancelAnimationFrame(autoPanAnimRef.current)
        } catch {}
        autoPanAnimRef.current = null
      }
      if (leftPanRafRef.current && typeof window !== 'undefined') {
        try {
          window.cancelAnimationFrame(leftPanRafRef.current)
        } catch {}
        leftPanRafRef.current = null
      }
    }
  }, [hasWriteAccess, isCompactViewport, smoothScrollViewportBy, useStackedStudentLayout])

  const horizontalScrollbarThumbPct = useMemo(() => Math.max(8, Math.round(horizontalPanThumbRatio * 100)), [horizontalPanThumbRatio])
  const horizontalScrollbarLeftPct = useMemo(() => {
    const usable = Math.max(0, 100 - horizontalScrollbarThumbPct)
    return horizontalPanMax > 0 ? (horizontalPanValue / horizontalPanMax) * usable : 0
  }, [horizontalPanMax, horizontalPanValue, horizontalScrollbarThumbPct])

  const endHorizontalScrollbarDrag = useCallback((event?: { pointerId?: number } | null) => {
    if (!horizontalPanDragRef.current.active) return
    const pointerId = typeof event?.pointerId === 'number' ? event.pointerId : null
    if (pointerId != null && horizontalPanDragRef.current.pointerId != null && pointerId !== horizontalPanDragRef.current.pointerId) {
      return
    }

    horizontalPanDragRef.current.active = false
    horizontalPanDragRef.current.pointerId = null
    setHorizontalScrollbarActive(false)

    if (horizontalPanWindowCleanupRef.current) {
      try {
        horizontalPanWindowCleanupRef.current()
      } catch {}
      horizontalPanWindowCleanupRef.current = null
    }
  }, [])

  const beginHorizontalScrollbarDrag = useCallback((event: React.PointerEvent) => {
    const track = horizontalPanTrackRef.current
    const viewport = studentViewportRef.current
    if (!track) return
    if (!viewport) return

    if (horizontalPanWindowCleanupRef.current) {
      try {
        horizontalPanWindowCleanupRef.current()
      } catch {}
      horizontalPanWindowCleanupRef.current = null
    }

    const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    const rect = track.getBoundingClientRect()
    const trackWidth = Math.max(1, rect.width)
    // Drag feels more natural when scaled by the usable width (track minus thumb).
    const thumbPx = trackWidth * Math.max(0, Math.min(1, horizontalPanThumbRatio))
    const usableTrackWidth = Math.max(1, trackWidth - thumbPx)
    horizontalPanDragRef.current.active = true
    horizontalPanDragRef.current.pointerId = event.pointerId
    horizontalPanDragRef.current.startX = event.clientX
    horizontalPanDragRef.current.startScrollLeft = viewport.scrollLeft
    horizontalPanDragRef.current.usableTrackWidth = usableTrackWidth
    horizontalPanDragRef.current.maxScroll = maxScroll
    setHorizontalScrollbarActive(true)
    try {
      ;(event.currentTarget as any)?.setPointerCapture?.(event.pointerId)
    } catch {}

    if (typeof window !== 'undefined') {
      const onMove = (e: PointerEvent) => {
        if (!horizontalPanDragRef.current.active) return
        if (horizontalPanDragRef.current.pointerId != null && e.pointerId !== horizontalPanDragRef.current.pointerId) return
        const viewportNow = studentViewportRef.current
        if (!viewportNow) return
        const usable = Math.max(1, horizontalPanDragRef.current.usableTrackWidth)
        const max = Math.max(0, horizontalPanDragRef.current.maxScroll)
        const dx = e.clientX - horizontalPanDragRef.current.startX
        const ratioDx = dx / usable
        const target = horizontalPanDragRef.current.startScrollLeft + ratioDx * max * manualScrollGain
        viewportNow.scrollLeft = Math.max(0, Math.min(target, max))
      }

      const onUpLike = (e: PointerEvent) => {
        if (!horizontalPanDragRef.current.active) return
        if (horizontalPanDragRef.current.pointerId != null && e.pointerId !== horizontalPanDragRef.current.pointerId) return
        endHorizontalScrollbarDrag({ pointerId: e.pointerId })
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUpLike)
      window.addEventListener('pointercancel', onUpLike)

      horizontalPanWindowCleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUpLike)
        window.removeEventListener('pointercancel', onUpLike)
      }
    }
  }, [endHorizontalScrollbarDrag, horizontalPanThumbRatio, manualScrollGain])

  const updateHorizontalScrollbarDrag = useCallback((event: React.PointerEvent) => {
    if (!horizontalPanDragRef.current.active) return
    const track = horizontalPanTrackRef.current
    const viewport = studentViewportRef.current
    if (!track || !viewport) return
    const usableTrackWidth = Math.max(1, horizontalPanDragRef.current.usableTrackWidth)
    const maxScroll = Math.max(0, horizontalPanDragRef.current.maxScroll)
    const dx = event.clientX - horizontalPanDragRef.current.startX
    const ratioDx = dx / usableTrackWidth
    const target = horizontalPanDragRef.current.startScrollLeft + ratioDx * maxScroll * manualScrollGain
    viewport.scrollLeft = Math.max(0, Math.min(target, maxScroll))
  }, [manualScrollGain])

  useEffect(() => {
    return () => {
      if (horizontalPanWindowCleanupRef.current) {
        try {
          horizontalPanWindowCleanupRef.current()
        } catch {}
        horizontalPanWindowCleanupRef.current = null
      }
      horizontalPanDragRef.current.active = false
      horizontalPanDragRef.current.pointerId = null
    }
  }, [])

  const verticalScrollbarThumbPct = useMemo(() => Math.max(8, Math.round(verticalPanThumbRatio * 100)), [verticalPanThumbRatio])
  const verticalScrollbarTopPct = useMemo(() => {
    const usable = Math.max(0, 100 - verticalScrollbarThumbPct)
    return verticalPanMax > 0 ? (verticalPanValue / verticalPanMax) * usable : 0
  }, [verticalPanMax, verticalPanValue, verticalScrollbarThumbPct])

  const beginVerticalScrollbarDrag = useCallback((event: React.PointerEvent) => {
    const track = verticalPanTrackRef.current
    const viewport = studentViewportRef.current
    if (!track) return
    if (!viewport) return
    const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    const rect = track.getBoundingClientRect()
    const trackHeight = Math.max(1, rect.height)
    const thumbPx = trackHeight * Math.max(0, Math.min(1, verticalPanThumbRatio))
    const usableTrackHeight = Math.max(1, trackHeight - thumbPx)
    verticalPanDragRef.current.active = true
    verticalPanDragRef.current.pointerId = event.pointerId
    verticalPanDragRef.current.startY = event.clientY
    verticalPanDragRef.current.startScrollTop = viewport.scrollTop
    verticalPanDragRef.current.usableTrackHeight = usableTrackHeight
    verticalPanDragRef.current.maxScroll = maxScroll
    setVerticalScrollbarActive(true)
    try {
      track.setPointerCapture(event.pointerId)
    } catch {}
  }, [verticalPanThumbRatio])

  const endVerticalScrollbarDrag = useCallback((event: React.PointerEvent) => {
    if (!verticalPanDragRef.current.active) return
    verticalPanDragRef.current.active = false
    const track = verticalPanTrackRef.current
    try {
      track?.releasePointerCapture(event.pointerId)
    } catch {}
    verticalPanDragRef.current.pointerId = null
    setVerticalScrollbarActive(false)
  }, [])

  const updateVerticalScrollbarDrag = useCallback((event: React.PointerEvent) => {
    if (!verticalPanDragRef.current.active) return
    const track = verticalPanTrackRef.current
    const viewport = studentViewportRef.current
    if (!track || !viewport) return
    const usableTrackHeight = Math.max(1, verticalPanDragRef.current.usableTrackHeight)
    const maxScroll = Math.max(0, verticalPanDragRef.current.maxScroll)
    const dy = event.clientY - verticalPanDragRef.current.startY
    const ratioDy = dy / usableTrackHeight
    const target = verticalPanDragRef.current.startScrollTop + ratioDy * maxScroll * manualScrollGain
    viewport.scrollTop = Math.max(0, Math.min(target, maxScroll))
  }, [manualScrollGain])

  const showSideSliders = Boolean(useStackedStudentLayout && isCompactViewport)

  // Keep side sliders short and docked above the bottom horizontal scrollbar.
  // Also reserve the same amount of space in the stacked scroll viewport so the fixed bar
  // never visually covers ink as the learner writes near the bottom.
  const sideSliderBottomCss = useMemo(
    () => `calc(env(safe-area-inset-bottom) + ${viewportBottomOffsetPx}px + ${STACKED_BOTTOM_OVERLAY_RESERVE_PX}px)`,
    [viewportBottomOffsetPx]
  )

  const leftVerticalScrollbar = showSideSliders ? (
    <div
      className="fixed left-0 z-[520] pointer-events-none"
      style={{ bottom: sideSliderBottomCss, height: '40vh', maxHeight: '45vh' } as any}
    >
      <div
        ref={verticalPanTrackRef}
        className="h-full w-3 flex items-end justify-center pointer-events-auto"
        style={{ touchAction: 'none', userSelect: 'none' }}
      >
        <div className={`h-full w-1.5 bg-slate-200 rounded-full relative transition-all duration-150 ${verticalScrollbarActive ? 'opacity-100' : 'opacity-80'}`}>
          <div
            className="absolute left-0 right-0 bg-slate-400 rounded-full"
            style={{
              height: `${verticalScrollbarThumbPct}%`,
              top: `${verticalScrollbarTopPct}%`,
              cursor: 'grab',
              touchAction: 'none',
              userSelect: 'none',
            }}
          />
        </div>
      </div>
    </div>
  ) : null

  const masterGainPct = useMemo(() => {
    const min = 1
    const max = 6
    const clamped = Math.max(min, Math.min(max, manualScrollGain))
    return ((clamped - min) / (max - min)) * 100
  }, [manualScrollGain])

  const beginMasterGainDrag = useCallback((event: React.PointerEvent) => {
    const track = masterGainTrackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    masterGainDragRef.current.active = true
    masterGainDragRef.current.pointerId = event.pointerId
    masterGainDragRef.current.startY = event.clientY
    masterGainDragRef.current.startValue = manualScrollGain
    masterGainDragRef.current.trackHeight = Math.max(1, rect.height)
    try {
      track.setPointerCapture(event.pointerId)
    } catch {}
  }, [manualScrollGain])

  const updateMasterGainDrag = useCallback((event: React.PointerEvent) => {
    if (!masterGainDragRef.current.active) return
    const trackHeight = Math.max(1, masterGainDragRef.current.trackHeight)
    const dy = event.clientY - masterGainDragRef.current.startY
    // Invert so dragging up increases gain.
    const ratio = -dy / trackHeight
    const min = 1
    const max = 6
    const next = masterGainDragRef.current.startValue + ratio * (max - min)
    setManualScrollGain(Math.max(min, Math.min(max, next)))
  }, [])

  const endMasterGainDrag = useCallback((event: React.PointerEvent) => {
    if (!masterGainDragRef.current.active) return
    masterGainDragRef.current.active = false
    const track = masterGainTrackRef.current
    try {
      track?.releasePointerCapture(event.pointerId)
    } catch {}
    masterGainDragRef.current.pointerId = null
  }, [])

  const rightMasterGainSlider = showSideSliders ? (
    <div
      className="fixed right-0 z-[520] pointer-events-none"
      style={{ bottom: sideSliderBottomCss, height: '40vh', maxHeight: '45vh' } as any}
    >
      <div
        ref={masterGainTrackRef}
        className="h-full w-3 flex items-end justify-center pointer-events-auto"
        style={{ touchAction: 'none', userSelect: 'none' }}
      >
        <div className="h-full w-1.5 bg-slate-200 rounded-full relative opacity-80">
          <div
            className="absolute left-0 right-0 bg-slate-400 rounded-full"
            style={{
              height: '14%',
              top: `${Math.max(0, Math.min(86, 100 - masterGainPct - 7))}%`,
              touchAction: 'none',
              userSelect: 'none',
            }}
          />
        </div>
      </div>
    </div>
  ) : null

  const showBottomHorizontalScrollbar = Boolean(useStackedStudentLayout && isCompactViewport)

  const horizontalScrollbar = showBottomHorizontalScrollbar ? (
    <div
      className="fixed left-0 right-0 z-[500] pointer-events-none"
      style={{ bottom: `calc(env(safe-area-inset-bottom) + ${viewportBottomOffsetPx}px)` } as any}
    >
      <div className="px-3 pb-1 flex items-end justify-center">
        <div
          ref={horizontalPanTrackRef}
          className={`w-[92vw] max-w-[760px] bg-slate-200 rounded-full relative pointer-events-auto transition-all duration-150 ${horizontalScrollbarActive ? 'h-4' : 'h-3'}`}
          style={{ touchAction: 'none', userSelect: 'none' }}
        >
          <div
            className="absolute top-0 bottom-0 bg-slate-400 rounded-full"
            style={{
              width: `${horizontalScrollbarThumbPct}%`,
              left: `${horizontalScrollbarLeftPct}%`,
              cursor: 'grab',
              touchAction: 'none',
              userSelect: 'none',
            }}
          />
        </div>
      </div>
    </div>
  ) : null

  const orientationLockedToLandscape = Boolean(isAdmin && isFullscreen)

  const LESSON_AUTHORING_STORAGE_KEY = 'philani:lesson-authoring:draft-v2'
  const parsedLessonAuthoring = useMemo(() => {
    if (lessonAuthoring?.phaseKey && lessonAuthoring?.pointId) {
      return { phaseKey: String(lessonAuthoring.phaseKey), pointId: String(lessonAuthoring.pointId) }
    }
    const rawBoardId = typeof boardId === 'string' ? boardId : ''
    const rawRoomId = typeof roomId === 'string' ? roomId : ''
    const raw = rawBoardId || (rawRoomId.startsWith('myscript:') ? rawRoomId.slice('myscript:'.length) : rawRoomId)

    const match = raw.match(/^lesson-author-(?:canvas|latex|diagram)-([a-zA-Z]+)-(.+)$/)
    if (!match) return null
    const phaseKey = String(match[1] || '').trim()
    const pointId = String(match[2] || '').trim()
    if (!phaseKey || !pointId) return null
    return { phaseKey, pointId }
  }, [boardId, lessonAuthoring, roomId])
  const isLessonAuthoring = Boolean(parsedLessonAuthoring?.phaseKey && parsedLessonAuthoring?.pointId)
  const [authoringLatexEntries, setAuthoringLatexEntries] = useState<string[]>([])
  const [authoringLatexExpanded, setAuthoringLatexExpanded] = useState(true)

  const saveLatexIntoLessonDraft = useCallback((latexValue: string) => {
    if (!isLessonAuthoring) return false
    if (typeof window === 'undefined') return false
    try {
      const raw = window.localStorage.getItem(LESSON_AUTHORING_STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      const draft = parsed?.draft
      if (!draft || typeof draft !== 'object') return false

      const phaseKey = String(parsedLessonAuthoring!.phaseKey)
      const pointId = String(parsedLessonAuthoring!.pointId)
      const phasePoints = Array.isArray((draft as any)[phaseKey]) ? (draft as any)[phaseKey] : null
      if (!phasePoints) return false

      const nextPhasePoints = phasePoints.map((p: any) => {
        if (String(p?.id) !== pointId) return p
        const priorLatex = typeof p?.latex === 'string' ? p.latex : ''
        const priorHistory = Array.isArray(p?.latexHistory)
          ? p.latexHistory.filter((v: any) => typeof v === 'string' && v.trim())
          : (priorLatex ? [priorLatex] : [])

        const trimmed = String(latexValue || '').trim()
        const last = priorHistory.length ? String(priorHistory[priorHistory.length - 1]).trim() : ''
        const nextHistory = trimmed && trimmed !== last ? [...priorHistory, trimmed] : priorHistory
        return { ...p, latex: trimmed, latexHistory: nextHistory }
      })
      const next = { ...(draft as any), [phaseKey]: nextPhasePoints }
      window.localStorage.setItem(LESSON_AUTHORING_STORAGE_KEY, JSON.stringify({ updatedAt: Date.now(), draft: next }))
      return true
    } catch {
      return false
    }
  }, [isLessonAuthoring, parsedLessonAuthoring])

  const loadAuthoringLatexEntries = useCallback(() => {
    if (!isLessonAuthoring) return
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(LESSON_AUTHORING_STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      const draft = parsed?.draft
      if (!draft || typeof draft !== 'object') {
        setAuthoringLatexEntries([])
        return
      }
      const phaseKey = String(parsedLessonAuthoring!.phaseKey)
      const pointId = String(parsedLessonAuthoring!.pointId)
      const phasePoints = Array.isArray((draft as any)[phaseKey]) ? (draft as any)[phaseKey] : []
      const point = phasePoints.find((p: any) => String(p?.id) === pointId) || null
      const history = Array.isArray(point?.latexHistory)
        ? point.latexHistory.filter((v: any) => typeof v === 'string' && v.trim())
        : (typeof point?.latex === 'string' && point.latex.trim() ? [point.latex.trim()] : [])

      // Show newest first.
      setAuthoringLatexEntries([...history].reverse())
    } catch {
      setAuthoringLatexEntries([])
    }
  }, [isLessonAuthoring, parsedLessonAuthoring])

  useEffect(() => {
    if (!isLessonAuthoring) return
    if (!mobileLatexTrayOpen) return
    setAuthoringLatexExpanded(true)
    loadAuthoringLatexEntries()
  }, [isLessonAuthoring, loadAuthoringLatexEntries, mobileLatexTrayOpen])

  useEffect(() => {
    if (!mobileLatexTrayOpen) return
    if (isLessonAuthoring) return
    // Reset selection when opening the tray in session mode so the user can
    // intentionally choose what to preview/share.
    setSessionLatexSelection(null)
  }, [isLessonAuthoring, mobileLatexTrayOpen])

  // Persist LaTeX strictly against the scheduled session id.
  // We only persist when a real session id is provided (boardId).
  const sessionKey = boardId
  const canPersistLatex = Boolean(sessionKey)

  const applyLoadedLatex = useCallback((latexValue: string | null) => {
    if (!latexValue) return
    setLatexDisplayState(curr => ({ ...curr, enabled: true, latex: latexValue }))
    // In stacked mode (students and compact teacher view), the top panel may render from stackedNotesState.
    // Keep it in sync so loading a note overwrites the display immediately.
    setStackedNotesState(curr => ({ ...curr, latex: latexValue, ts: Date.now() }))
  }, [])

  const fetchLatexSaves = useCallback(async () => {
    if (isLessonAuthoring) return
    if (!canPersistLatex || !sessionKey) return
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionKey)}/latex-saves`)
      if (!res.ok) return
      const data = await res.json()
      const latestShared = Array.isArray(data?.shared) && data.shared.length > 0 ? data.shared[0] : null
      const latestMine = Array.isArray(data?.mine) && data.mine.length > 0 ? data.mine[0] : null
      setLatestSharedSave(latestShared || null)
      setLatestPersonalSave(latestMine || null)
    } catch (err) {
      console.warn('Failed to fetch saved notes', err)
    }
  }, [canPersistLatex, isLessonAuthoring, sessionKey])

  const fetchAllSessionQuestionNotes = useCallback(async () => {
    if (isLessonAuthoring) return [] as NotesSaveRecord[]
    if (!canPersistLatex || !sessionKey) return [] as NotesSaveRecord[]
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionKey)}/latex-saves?take=200`)
    if (!res.ok) return [] as NotesSaveRecord[]
    const data = await res.json().catch(() => null)
    const shared = Array.isArray(data?.shared) ? data.shared : []
    const questions = shared.filter((r: any) => r && r.payload && r.payload.kind === 'question-v1')
    return questions as NotesSaveRecord[]
  }, [canPersistLatex, isLessonAuthoring, sessionKey])

  const openNotesLibrary = useCallback(async () => {
    if (!canPersistLatex || !sessionKey) {
      setNotesLibraryError('Notes are only available inside a scheduled session.')
      setNotesLibraryItems([])
      setNotesLibraryOpen(true)
      return
    }

    setNotesLibraryOpen(true)
    setNotesLibraryLoading(true)
    setNotesLibraryError(null)
    try {
      const items = await fetchAllSessionQuestionNotes()
      setNotesLibraryItems(items)
    } catch (err: any) {
      console.warn('Failed to load session notes library', err)
      setNotesLibraryError(err?.message || 'Failed to load notes')
      setNotesLibraryItems([])
    } finally {
      setNotesLibraryLoading(false)
    }
  }, [canPersistLatex, fetchAllSessionQuestionNotes, sessionKey])

  const saveLatexSnapshot = useCallback(
    async (options?: { shared?: boolean; auto?: boolean }) => {
      const isAuto = Boolean(options?.auto)
      if (isLessonAuthoring) {
        if (isAuto) return
        const latexValue = (latexDisplayStateRef.current.latex || latexOutput || '').trim()
        if (!latexValue) return
        const ok = saveLatexIntoLessonDraft(latexValue)
        if (!ok) {
          setLatexSaveError('Failed to save into lesson script draft.')
          return
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('philani:lesson-authoring:draft-updated', { detail: { kind: 'latex', phaseKey: parsedLessonAuthoring?.phaseKey, pointId: parsedLessonAuthoring?.pointId } }))
        }
        setLatexSaveError(null)
        return
      }
      if (!canPersistLatex || !sessionKey) {
        if (!isAuto) {
          setLatexSaveError('Saving is only available inside a scheduled session.')
        }
        return
      }
      const latexValue = (latexDisplayStateRef.current.latex || latexOutput || '').trim()
      if (!latexValue) return
      const sharedFlag = options?.shared ?? isAdmin
      const hash = `${sharedFlag ? 'shared' : 'mine'}::${latexValue}`
      if (isAuto && lastSavedHashRef.current === hash) return

      if (!isAuto) {
        setIsSavingLatex(true)
        setLatexSaveError(null)
      }

      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionKey)}/latex-saves`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latex: latexValue, shared: sharedFlag }),
        })
        if (!res.ok) {
          const errorData = await res.json().catch(() => null)
          const message = errorData?.message || 'Failed to save notes'
          throw new Error(typeof message === 'string' ? message : 'Failed to save notes')
        }
        const payload = await res.json()
        if (payload?.shared) setLatestSharedSave(payload)
        else setLatestPersonalSave(payload)
        lastSavedHashRef.current = hash
      } catch (err: any) {
        const message = err?.message || 'Failed to save notes'
        if (!isAuto) setLatexSaveError(message)
        console.warn('Save notes error', err)
      } finally {
        if (!isAuto) setIsSavingLatex(false)
      }
    },
    [canPersistLatex, isAdmin, isLessonAuthoring, latexOutput, saveLatexIntoLessonDraft, sessionKey]
  )

  const saveQuestionAsNotes = useCallback(
    async (options: { title: string; noteId: string }) => {
      if (isLessonAuthoring) {
        setLatexSaveError('Finish Question is only available inside a live session.')
        return null
      }
      if (!isAdmin) {
        setLatexSaveError('Finish Question is only available for teachers.')
        return null
      }
      if (!canPersistLatex || !sessionKey) {
        setLatexSaveError('Saving is only available inside a scheduled session.')
        return null
      }

      const steps = adminSteps
        .filter(s => s && typeof s === 'object')
        .map(s => ({ latex: normalizeStepLatex((s as any).latex || ''), symbols: Array.isArray((s as any).symbols) ? (s as any).symbols : [] }))
        .filter(s => String(s.latex || '').trim() || (Array.isArray(s.symbols) && s.symbols.length))

      if (!steps.length) {
        setLatexSaveError('Nothing to save yet.')
        return null
      }

      const latexValue = steps.map(s => s.latex).filter(Boolean).join(' \\\\ ').trim()
      const payload = {
        kind: 'question-v1',
        noteId: options.noteId,
        questionId: options.noteId,
        createdAt: Date.now(),
        steps,
      }

      setIsSavingLatex(true)
      setLatexSaveError(null)
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionKey)}/latex-saves`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: options.title,
            latex: latexValue,
            shared: true,
            noteId: options.noteId,
            payload,
          }),
        })
        if (!res.ok) {
          const errorData = await res.json().catch(() => null)
          const message = errorData?.message || 'Failed to save notes'
          throw new Error(typeof message === 'string' ? message : 'Failed to save notes')
        }
        const saved = await res.json()
        setLatestSharedSave(saved)
        return saved
      } catch (err: any) {
        const message = err?.message || 'Failed to save notes'
        setLatexSaveError(message)
        console.warn('Save question notes error', err)
        return null
      } finally {
        setIsSavingLatex(false)
      }
    },
    [adminSteps, canPersistLatex, isAdmin, isLessonAuthoring, normalizeStepLatex, sessionKey]
  )

  useEffect(() => {
    if (!finishQuestionModalOpen) return
    if (typeof window === 'undefined') return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFinishQuestionModalOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [finishQuestionModalOpen])

  const confirmFinishQuestionSave = useCallback(async () => {
    if (!finishQuestionNoteId) return
    const title = String(finishQuestionTitle || '').trim()
    if (!title) {
      setLatexSaveError('Title is required.')
      return
    }
    const saved = await saveQuestionAsNotes({ title, noteId: finishQuestionNoteId })
    if (!saved) return

    setFinishQuestionModalOpen(false)
    setFinishQuestionNoteId(null)

    // Start the next question on a clean slate.
    try {
      setLatexDisplayState(curr => ({ ...curr, latex: '' }))
    } catch {}
    try {
      setStackedNotesState(curr => ({ ...curr, latex: '' }))
    } catch {}
    clearEverything()
  }, [clearEverything, finishQuestionNoteId, finishQuestionTitle, saveQuestionAsNotes])

  useEffect(() => {
    fetchLatexSaves()
    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current)
      }
    }
  }, [fetchLatexSaves])

  useEffect(() => {
    if (canPersistLatex) return
    setLatestSharedSave(null)
    setLatestPersonalSave(null)
    setLatexSaveError(null)
    lastSavedHashRef.current = null
  }, [canPersistLatex])

  useEffect(() => {
    if (isLessonAuthoring) return
    if (!canPersistLatex) return
    const latexValue = (latexDisplayState.latex || latexOutput || '').trim()
    if (!latexValue) return
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current)
    }
    autosaveTimeoutRef.current = setTimeout(() => {
      saveLatexSnapshot({ shared: isAdmin, auto: true })
    }, 2500)
    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current)
      }
    }
  }, [canPersistLatex, isAdmin, isLessonAuthoring, latexDisplayState.latex, latexOutput, saveLatexSnapshot])

  const applySavedNotesRecord = useCallback((save: NotesSaveRecord) => {
    if (!save) return

    // Overwrite the current local state.
    try {
      editorInstanceRef.current?.clear?.()
    } catch {}
    lastSymbolCountRef.current = 0
    lastBroadcastBaseCountRef.current = 0

    const payload: any = (save as any)?.payload
    if (useAdminStepComposer && hasControllerRights() && payload?.kind === 'question-v1' && Array.isArray(payload?.steps)) {
      const steps = payload.steps
        .filter((s: any) => s && typeof s === 'object')
        .map((s: any) => ({ latex: typeof s.latex === 'string' ? s.latex : '', symbols: Array.isArray(s.symbols) ? s.symbols : [] }))
        .filter((s: any) => String(s.latex || '').trim() || (Array.isArray(s.symbols) && s.symbols.length))

      setAdminSteps(steps)
      setAdminEditIndex(null)
      setAdminDraftLatex('')
      setTopPanelSelectedStep(null)
    } else if (useAdminStepComposer && hasControllerRights()) {
      // If a non-question note is loaded in composer mode, clear the step list so the LaTeX panel can take over.
      setAdminSteps([])
      setAdminEditIndex(null)
      setAdminDraftLatex('')
      setTopPanelSelectedStep(null)
    }

    applyLoadedLatex((save as any)?.latex || null)
  }, [applyLoadedLatex, hasControllerRights, useAdminStepComposer])

  const handleLoadSavedLatex = useCallback(
    (scope: 'shared' | 'mine') => {
      const save = scope === 'shared' ? latestSharedSave : latestPersonalSave
      if (!save) return
      applySavedNotesRecord(save)
    },
    [applySavedNotesRecord, latestPersonalSave, latestSharedSave]
  )

  // On mount or layout change, pick a conservative default scale for student stacked view so full content is visible on small screens.
  useEffect(() => {
    if (!useStackedStudentLayout) return
    const viewport = studentViewportRef.current
    if (!viewport) return
    const width = viewport.clientWidth || 1
    const baseHeight = width * (4 / 5)
    const availableHeight = Math.max(viewport.clientHeight || baseHeight, 1)
    const fitScale = Math.max(0.65, Math.min(1, availableHeight / baseHeight))
    setStudentViewScale(fitScale)
  }, [useStackedStudentLayout, studentSplitRatio])

  const studentScaleControl = useMemo(() => {
    if (!useStackedStudentLayout) return null
    const clampScale = (value: number) => Math.min(1.6, Math.max(0.6, value))
    const step = 0.1
    const handleAdjust = (delta: number) => setStudentViewScale(curr => clampScale(curr + delta))
    const handleFit = () => {
      const viewport = studentViewportRef.current
      if (!viewport) return
      const width = viewport.clientWidth || 1
      const baseHeight = width * (4 / 5)
      const availableHeight = Math.max(viewport.clientHeight || baseHeight, 1)
      const fitScale = clampScale(availableHeight / baseHeight)
      setStudentViewScale(fitScale)
    }
    return { handleAdjust, handleFit, clampScale }
  }, [useStackedStudentLayout])

  const renderToolbarBlock = () => (
    <div className="canvas-toolbar">
      <div className="canvas-toolbar__buttons">
        <button
          className="btn"
          type="button"
          onClick={() => runCanvasAction(handleUndo)}
          disabled={(status !== 'ready') || Boolean(fatalError) || isViewOnly || (!canUndo && !(useAdminStepComposer && hasWriteAccess))}
        >
          Undo
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => runCanvasAction(handleRedo)}
          disabled={(status !== 'ready') || Boolean(fatalError) || isViewOnly || (!canRedo && !(useAdminStepComposer && hasWriteAccess))}
        >
          Redo
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => runCanvasAction(handleClear)}
          disabled={!canClear || status !== 'ready' || Boolean(fatalError) || isViewOnly}
        >
          Clear
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => runCanvasAction(handleConvert)}
          disabled={status !== 'ready' || Boolean(fatalError) || isViewOnly}
        >
          {isConverting ? 'Converting…' : 'Convert to Notes'}
        </button>
      </div>
      {hasWriteAccess && (
        <div className="canvas-toolbar__buttons">
          <button
            className={`btn ${quizActive ? 'btn-secondary' : ''}`}
            type="button"
            onClick={() => runCanvasAction(async () => {
              await publishQuizState(!quizActiveRef.current)
              // Keep local admin indicator in sync.
              setQuizActiveState(!quizActiveRef.current)
            })}
            disabled={status !== 'ready' || Boolean(fatalError)}
          >
            {quizActive ? 'Stop Quiz Mode' : 'Start Quiz Mode'}
          </button>
          {ENABLE_EMBEDDED_DIAGRAMS && (
            <>
              <button
                className={`btn ${diagramState.isOpen ? 'btn-secondary' : ''}`}
                type="button"
                onClick={() => runCanvasAction(() => setDiagramOverlayState({
                  activeDiagramId: diagramState.activeDiagramId || (diagrams[0]?.id ?? null),
                  isOpen: !diagramState.isOpen,
                }))}
                disabled={status !== 'ready' || Boolean(fatalError) || diagrams.length === 0}
              >
                {diagramState.isOpen ? 'Hide Diagram' : 'Show Diagram'}
              </button>
              <button
                className={`btn ${diagramManagerOpen ? 'btn-secondary' : ''}`}
                type="button"
                onClick={() => runCanvasAction(() => setDiagramManagerOpen(prev => !prev))}
                disabled={status !== 'ready' || Boolean(fatalError)}
              >
                Diagrams
              </button>
            </>
          )}
          <button
            className="btn"
            type="button"
            onClick={() => runCanvasAction(publishAdminLatexAndCanvasToAll)}
            disabled={status !== 'ready' || Boolean(fatalError) || !latexOutput || latexOutput.trim().length === 0}
          >
            Share Notes to Students
          </button>
          <button
            className={`btn ${latexDisplayState.enabled ? 'btn-secondary' : ''}`}
            type="button"
            onClick={() => runCanvasAction(toggleLatexProjection)}
            disabled={status !== 'ready' || Boolean(fatalError)}
          >
            {latexDisplayState.enabled ? 'Stop Notes Display Mode' : 'Project Notes onto Student Canvas'}
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => runCanvasAction(() => {
              if (selectedClientId === 'all') {
                publishAdminCanvasToAll()
              } else {
                forcePublishCanvas(selectedClientId)
              }
            })}
            disabled={status !== 'ready' || Boolean(fatalError)}
          >
            Publish Canvas to {selectedClientId === 'all' ? 'All Students' : 'Student'}
          </button>
          {selectedClientId !== 'all' && (
            <button
              className="btn"
              type="button"
              onClick={() => runCanvasAction(() => forceClearStudentCanvas(selectedClientId))}
              disabled={status !== 'ready' || Boolean(fatalError)}
            >
              Wipe Selected Student Canvas
            </button>
          )}
          <button
            className="btn"
            type="button"
            onClick={() => runCanvasAction(clearAllStudentCanvases)}
            disabled={status !== 'ready' || Boolean(fatalError)}
          >
            Wipe All Student Canvases
          </button>
          {boardId && hasLessonScriptSteps && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold">Lesson script</span>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => runCanvasAction(startLessonFromScript)}
                disabled={lessonScriptLoading || Boolean(fatalError)}
              >
                Start lesson
              </button>
              <select
                className="input"
                value={lessonScriptPhaseKey}
                onChange={e => {
                  const next = e.target.value as LessonScriptPhaseKey
                  setLessonScriptPhaseKey(next)
                  setLessonScriptStepIndex(-1)
                  setLessonScriptPointIndex(0)
                  setLessonScriptModuleIndex(-1)
                  if ((lessonScriptResolved as any)?.schemaVersion === 2) {
                    void applyLessonScriptPlaybackV2(next, 0, -1)
                  } else {
                    void applyLessonScriptPlayback(next, -1)
                  }
                }}
                disabled={lessonScriptLoading || Boolean(fatalError)}
                aria-label="Choose lesson phase"
              >
                {LESSON_SCRIPT_PHASES.map(p => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
              {lessonScriptV2 ? (
                <>
                  <select
                    className="input"
                    value={lessonScriptPointIndex}
                    onChange={e => {
                      const nextPoint = Number(e.target.value)
                      setLessonScriptPointIndex(Number.isFinite(nextPoint) ? nextPoint : 0)
                      setLessonScriptModuleIndex(-1)
                      void applyLessonScriptPlaybackV2(lessonScriptPhaseKey, Number.isFinite(nextPoint) ? nextPoint : 0, -1)
                    }}
                    disabled={lessonScriptLoading || Boolean(fatalError) || lessonScriptV2Points.length === 0}
                    aria-label="Choose lesson point"
                  >
                    {lessonScriptV2Points.length === 0 ? (
                      <option value={0}>No points</option>
                    ) : (
                      lessonScriptV2Points.map((pt, idx) => (
                        <option key={pt.id} value={idx}>
                          {pt.title ? `${idx + 1}. ${pt.title}` : `Point ${idx + 1}`}
                        </option>
                      ))
                    )}
                  </select>

                  <button
                    className="btn"
                    type="button"
                    onClick={() => runCanvasAction(async () => {
                      if (!lessonScriptV2ActivePoint) {
                        await applyLessonScriptPlaybackV2(lessonScriptPhaseKey, 0, -1)
                        return
                      }
                      const modules = lessonScriptV2ActiveModules
                      const idx = lessonScriptModuleIndex
                      if (idx > -1) {
                        await applyLessonScriptPlaybackV2(lessonScriptPhaseKey, lessonScriptPointIndex, idx - 1)
                        return
                      }
                      // at -1, jump to previous point's last module if possible
                      if (lessonScriptPointIndex > 0) {
                        const prevPointIdx = lessonScriptPointIndex - 1
                        const prevPoint = lessonScriptV2Points[prevPointIdx]
                        const lastIdx = (prevPoint?.modules?.length ?? 0) - 1
                        await applyLessonScriptPlaybackV2(lessonScriptPhaseKey, prevPointIdx, Math.max(lastIdx, -1))
                      }
                    })}
                    disabled={lessonScriptLoading || Boolean(fatalError) || (lessonScriptPointIndex === 0 && lessonScriptModuleIndex < 0)}
                  >
                    Prev
                  </button>

                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => runCanvasAction(async () => {
                      if (!lessonScriptV2ActivePoint) {
                        await applyLessonScriptPlaybackV2(lessonScriptPhaseKey, 0, -1)
                        return
                      }
                      const modules = lessonScriptV2ActiveModules
                      const idx = lessonScriptModuleIndex
                      if (modules.length === 0) {
                        await applyLessonScriptPlaybackV2(lessonScriptPhaseKey, lessonScriptPointIndex, -1)
                        return
                      }
                      if (idx < modules.length - 1) {
                        await applyLessonScriptPlaybackV2(lessonScriptPhaseKey, lessonScriptPointIndex, idx + 1)
                        return
                      }
                      // Move to next point
                      if (lessonScriptPointIndex < lessonScriptV2Points.length - 1) {
                        await applyLessonScriptPlaybackV2(lessonScriptPhaseKey, lessonScriptPointIndex + 1, -1)
                      }
                    })}
                    disabled={lessonScriptLoading || Boolean(fatalError) || lessonScriptV2Points.length === 0 || (lessonScriptPointIndex >= lessonScriptV2Points.length - 1 && lessonScriptModuleIndex >= lessonScriptV2ActiveModules.length - 1)}
                  >
                    Next
                  </button>

                  <span className="text-xs muted">
                    {lessonScriptV2Points.length === 0
                      ? 'No points'
                      : `Point ${Math.min(lessonScriptPointIndex + 1, lessonScriptV2Points.length)} / ${lessonScriptV2Points.length} • Module ${Math.max(lessonScriptModuleIndex + 1, 0)} / ${lessonScriptV2ActiveModules.length}`}
                  </span>

                  {lessonScriptV2ActiveModules.length > 0 && (
                    <span className="text-xs text-slate-600">
                      {lessonScriptV2ActiveModules.map((m, idx) => {
                        const label = m.type === 'latex' ? 'LaTeX' : (m.type === 'diagram' ? 'Diagram' : 'Text')
                        const isActive = idx === lessonScriptModuleIndex
                        return (
                          <span key={`${lessonScriptV2ActivePoint?.id || 'point'}-${idx}`} className={isActive ? 'font-semibold text-slate-800' : undefined}>
                            {idx === 0 ? '' : ' → '}{label}
                          </span>
                        )
                      })}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => runCanvasAction(() => applyLessonScriptPlayback(lessonScriptPhaseKey, lessonScriptStepIndex - 1))}
                    disabled={lessonScriptLoading || Boolean(fatalError) || lessonScriptStepIndex < 0}
                  >
                    Prev step
                  </button>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => runCanvasAction(() => applyLessonScriptPlayback(lessonScriptPhaseKey, lessonScriptStepIndex + 1))}
                    disabled={lessonScriptLoading || Boolean(fatalError) || lessonScriptPhaseSteps.length === 0 || lessonScriptStepIndex >= lessonScriptPhaseSteps.length - 1}
                  >
                    Next step
                  </button>
                  <span className="text-xs muted">
                    {lessonScriptPhaseSteps.length === 0
                      ? 'No steps'
                      : `Step ${Math.max(lessonScriptStepIndex + 1, 0)} / ${lessonScriptPhaseSteps.length}`}
                  </span>
                </>
              )}
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => runCanvasAction(loadLessonScript)}
                disabled={lessonScriptLoading || Boolean(fatalError)}
              >
                {lessonScriptLoading ? 'Loading…' : 'Reload'}
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => runCanvasAction(async () => {
                  if ((lessonScriptResolved as any)?.schemaVersion === 2) {
                    await applyLessonScriptPlaybackV2(lessonScriptPhaseKey, lessonScriptPointIndex, -1)
                  } else {
                    await applyLessonScriptPlayback(lessonScriptPhaseKey, -1)
                  }
                })}
                disabled={lessonScriptLoading || Boolean(fatalError)}
              >
                Clear
              </button>
              {lessonScriptError && <span className="text-xs text-red-600">{lessonScriptError}</span>}
            </div>
          )}
          {ENABLE_EMBEDDED_DIAGRAMS && (
            <button
              className="btn"
              type="button"
              onClick={() => runCanvasAction(async () => {
                if (!activeDiagram?.id) return
                const empty = { strokes: [], arrows: [] }
                setDiagrams(prev => prev.map(d => (d.id === activeDiagram.id ? { ...d, annotations: empty } : d)))
                await persistDiagramAnnotations(activeDiagram.id, empty)
                await publishDiagramMessage({ kind: 'annotations-set', diagramId: activeDiagram.id, annotations: empty })
              })}
              disabled={status !== 'ready' || Boolean(fatalError) || !activeDiagram}
            >
              Clear Diagram Ink
            </button>
          )}
        </div>
      )}
    </div>
  )

  const renderOverlayAdminControls = () => (
    <div className="canvas-toolbar">
      <div className="canvas-toolbar__buttons">
        <button
          className="btn"
          type="button"
          onClick={() => runCanvasAction(clearAllStudentCanvases)}
          disabled={status !== 'ready' || Boolean(fatalError)}
        >
          Wipe All Student Canvases
        </button>
        <button
          className="btn"
          type="button"
          disabled={status !== 'ready' || Boolean(fatalError)}
        >
          Toggle Display
        </button>
      </div>
    </div>
  )

  return (
    <div className={isOverlayMode ? 'h-full' : undefined}>
      <div className={`flex flex-col gap-3${isOverlayMode ? ' h-full min-h-0' : ''}`}>
        {useStackedStudentLayout && (
          <div
            ref={studentStackRef}
            className="border rounded bg-white p-0 shadow-sm flex flex-col relative"
            style={{
              flex: isOverlayMode ? 1 : undefined,
              minHeight: isOverlayMode ? '100%' : '520px',
              height: isOverlayMode ? '100%' : '80vh',
              maxHeight: isOverlayMode ? '100%' : 'calc(100vh - 140px)',
              overflow: 'hidden',
            }}
          >
            <div
              className="flex flex-col"
              style={{ flex: Math.max(studentSplitRatio, 0.2), minHeight: '200px' }}
            >
              {!isOverlayMode && !isCompactViewport && canPersistLatex && (
                <div className="px-4 pt-3 pb-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                  <button
                    type="button"
                    className="px-2 py-1 text-slate-700 disabled:opacity-50"
                    onClick={() => { void openNotesLibrary() }}
                    disabled={notesLibraryLoading}
                  >
                    {notesLibraryLoading ? 'Loading…' : 'Notes'}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-slate-700 disabled:opacity-50"
                    onClick={() => handleLoadSavedLatex('shared')}
                    disabled={!latestSharedSave}
                  >
                    Load class
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-slate-700 disabled:opacity-50"
                    onClick={() => handleLoadSavedLatex('mine')}
                    disabled={!latestPersonalSave}
                  >
                    Load my save
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-slate-700"
                    onClick={fetchLatexSaves}
                  >
                    Refresh
                  </button>
                  {latexSaveError && <span className="text-red-600 text-[11px]">{latexSaveError}</span>}
                </div>
              )}
              <div className={`${isOverlayMode || isCompactViewport ? 'px-3 py-3' : 'mt-2 px-4 pb-2'} flex-1 min-h-[140px]`}>
                <div
                  className="h-full bg-white rounded-lg p-3 overflow-auto relative"
                  ref={useAdminStepComposer ? adminTopPanelRef : undefined}
                  onPointerDown={(e) => {
                    if ((useAdminStepComposer || useStudentStepComposer) && topPanelEditingMode) {
                      // Step-recall mode: tap a step line to restore its ink for editing.
                      const target = e.target as HTMLElement | null
                      const stepEl = target?.closest?.('[data-top-panel-step]') as HTMLElement | null
                      const idxRaw = stepEl?.getAttribute?.('data-step-idx') || ''
                      const idx = idxRaw ? Number(idxRaw) : NaN

                      if (Number.isFinite(idx)) {
                        e.stopPropagation()
                        e.preventDefault()
                        void loadTopPanelStepForEditing(idx)
                        return
                      }

                      // Tap on empty space clears selection.
                      clearTopPanelSelection()
                      e.stopPropagation()
                      e.preventDefault()
                      return
                    }

                    // On mobile overlay, tapping the top panel should only reveal the close chrome.
                    revealOverlayChrome()
                    if (isAssignmentView && typeof window !== 'undefined') {
                      try {
                        window.dispatchEvent(new CustomEvent('philani:assignment-meta-peek'))
                      } catch {}
                    }
                    if (!isAssignmentView && isChallengeBoard && typeof window !== 'undefined') {
                      try {
                        window.dispatchEvent(new CustomEvent('philani:challenge-meta-peek'))
                      } catch {}
                    }
                  }}
                  onClick={(useAdminStepComposer || useStudentStepComposer) && !topPanelEditingMode ? async (e) => {
                    if (!useAdminStepComposer && !useStudentStepComposer) return
                    if (!topPanelStepsPayload?.steps?.length) return
                    const now = Date.now()
                    const box = adminTopPanelRef.current?.getBoundingClientRect()
                    if (!box) return

                    const last = adminLastTapRef.current
                    const y = (e as any).clientY ?? 0
                    const within = last && (now - last.ts) < 350 && Math.abs(y - last.y) < 22
                    adminLastTapRef.current = { ts: now, y }
                    if (!within) return

                    // Double-tap: pick the row and load it for editing.
                    const localY = y - box.top
                    const approxRowHeight = 34
                    const index = Math.max(0, Math.min(topPanelStepsPayload.steps.length - 1, Math.floor(localY / approxRowHeight)))

                    await loadTopPanelStepForEditing(index)
                  } : undefined}
                >
                  {hasWriteAccess && !isAssignmentSolutionAuthoring && (
                    <button
                      type="button"
                      aria-label={quizActive ? 'Stop quiz mode' : 'Start quiz mode'}
                      title={quizActive ? 'Stop quiz mode' : 'Start quiz mode'}
                      className="absolute right-3 bottom-3 p-0 m-0 bg-transparent border-0 text-slate-700 hover:text-slate-900 focus:outline-none focus:ring-0"
                      onClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        void runCanvasAction(async () => {
                          await publishQuizState(!quizActiveRef.current)
                          // Keep local admin indicator in sync.
                          setQuizActiveState(!quizActiveRef.current)
                        })
                      }}
                      onPointerDown={e => {
                        // Prevent the split/selection handlers from seeing this press.
                        e.stopPropagation()
                      }}
                    >
                      <img
                        src="/finger-snap-icon.png"
                        alt=""
                        width={26}
                        height={26}
                        draggable={false}
                        className="block"
                        style={{ pointerEvents: 'none' }}
                      />
                    </button>
                  )}

                  {overlayChromePeekVisible && isOverlayMode && isCompactViewport && teacherBadge && (
                    <div
                      className="absolute left-3 bottom-3 flex flex-col items-start"
                    >
                      {editorBadges.length > 0 && (
                        <div className="flex flex-col items-start" style={{ marginBottom: 6 }}>
                          {editorBadges.map(b => (
                            <div
                              key={b.userKey}
                              className="w-6 h-6 rounded-full bg-slate-700 text-white text-[10px] font-semibold flex items-center justify-center border border-[#6b4f00] ring-2 ring-[#a87f12] shadow-sm"
                              style={{ marginBottom: 6 }}
                              title={`${b.name} (presenter)`}
                              aria-label={`${b.name} is a presenter`}
                            >
                              {b.initials}
                            </div>
                          ))}
                        </div>
                      )}

                      {isAdmin && overlayRosterVisible && (
                        <div className="flex flex-col items-start" style={{ marginBottom: 6 }}>
                          {(() => {
                            const nameKey = (value: string) => normalizeName(value).toLowerCase()

                            const clients = connectedClients
                              // Don't show the admin twice; the admin is already the tappable badge.
                              .filter(c => c.clientId && c.clientId !== clientId && c.clientId !== ALL_STUDENTS_ID)
                              .map(c => ({
                                clientId: c.clientId,
                                name: normalizeName(c.name || '') || c.clientId,
                                userId: typeof (c as any).userId === 'string' ? (c as any).userId : undefined,
                                isAdmin: Boolean((c as any).isAdmin),
                                userKey: (() => {
                                  const displayName = normalizeName((c as any)?.name || '') || String(c.clientId)
                                  const cUserId = typeof (c as any)?.userId === 'string' ? String((c as any).userId) : undefined
                                  return getUserKey(cUserId, displayName) || `name:${nameKey(displayName)}`
                                })(),
                              }))
                              // Prefer excluding the admin by stable userId when available.
                              .filter(c => !(userId && c.userId && String(c.userId) === String(userId)))
                              // Also exclude any admin presences (teacher/admin should only appear once).
                              .filter(c => !c.isAdmin)
                              // Exclude presenters from the expanded roster: they already render above as a gold badge.
                              .filter(c => {
                                const hasRights = (c.userKey && controllerRightsUserAllowlistRef.current.has(c.userKey))
                                  || controllerRightsAllowlistRef.current.has(c.clientId)
                                return !hasRights
                              })

                            // Dedupe by stable userId when available; fall back to name.
                            const uniqueUsers = new Map<string, { clientId: string; name: string; userId?: string }>()
                            for (const c of clients) {
                              const key = (c.userId && String(c.userId))
                                ? `uid:${String(c.userId)}`
                                : `name:${nameKey(c.name)}`
                              if (!key.trim()) continue
                              if (!uniqueUsers.has(key)) uniqueUsers.set(key, c)
                            }

                            return Array.from(uniqueUsers.values())
                          })().map(c => {
                              const displayName = (c.name || c.clientId || '').trim()
                              const parts = displayName.split(/\s+/).filter(Boolean)
                              const a = parts[0]?.[0] || 'U'
                              const b = parts.length > 1 ? (parts[1]?.[0] || '') : (parts[0]?.[1] || '')
                              const initials = (a + b).toUpperCase()
                              const userKey = getUserKey(c.userId, displayName) || `name:${normalizeName(displayName).toLowerCase()}`
                              const hasControllerRights = (userKey && controllerRightsUserAllowlistRef.current.has(userKey)) || controllerRightsAllowlistRef.current.has(c.clientId)
                              return (
                                <button
                                  type="button"
                                  key={c.clientId}
                                  data-client-id={c.clientId}
                                  data-user-id={c.userId || ''}
                                  data-user-key={userKey}
                                  data-display-name={displayName}
                                  className={
                                    "w-6 h-6 rounded-full bg-slate-700 text-white text-[10px] font-semibold flex items-center justify-center border shadow-sm focus:outline-none "
                                    + (hasControllerRights
                                      ? "border-[#6b4f00] ring-2 ring-[#a87f12]"
                                      : "border-white/60")
                                  }
                                  style={{ marginBottom: 6 }}
                                  title={displayName}
                                  aria-label={`Make ${displayName} the presenter`}
                                  onClick={handleRosterAttendeeAvatarClick}
                                  onPointerDown={e => {
                                    e.stopPropagation()
                                  }}
                                >
                                  {initials}
                                </button>
                              )
                            })}
                        </div>
                      )}

                      {(() => {
                        const badge = teacherBadge

                        if (!badge) return null
                        return (
                          <button
                            type="button"
                            className={
                              "flex items-center gap-2 px-2 py-1 rounded-full bg-white/85 backdrop-blur border shadow-sm border-slate-200"
                            }
                            onClick={e => {
                              if (!isAdmin) return
                              e.preventDefault()
                              e.stopPropagation()
                              // If the roster is open, tapping the admin badge reclaims control by clearing/revoking any presenters.
                              // Otherwise, it toggles the roster open.
                              if (overlayRosterVisible) {
                                if (activePresenterUserKeyRef.current || controllerRightsAllowlistRef.current.size || controllerRightsUserAllowlistRef.current.size) {
                                  handOverPresentation(null)
                                  return
                                }
                                setOverlayRosterVisible(false)
                                return
                              }

                              setOverlayRosterVisible(true)
                            }}
                            onPointerDown={e => {
                              if (!isAdmin) return
                              e.stopPropagation()
                            }}
                            aria-label={isAdmin ? 'Toggle session avatars' : undefined}
                            style={{ pointerEvents: isAdmin ? 'auto' : 'none' }}
                          >
                            <div className="w-6 h-6 rounded-full bg-slate-900 text-white text-[10px] font-semibold flex items-center justify-center">
                              {badge.initials}
                            </div>
                            <div className="text-[11px] text-slate-700 max-w-[180px] truncate">
                              {badge.name}
                            </div>
                          </button>
                        )
                      })()}
                    </div>
                  )}
                  {hasWriteAccess ? (
                    topPanelStepsPayload ? (
                      topPanelStepsPayload.steps.length ? (
                        <div
                          className="text-slate-900 leading-relaxed text-center"
                          style={topPanelRenderPayload.style}
                        >
                          {topPanelStepsPayload.steps.map(({ index, latex }) => {
                            const selected = topPanelStepsPayload.selectedIndex === index
                            const html = renderLatexStepInline(latex)
                            return (
                              <div key={index} className="py-1">
                                <button
                                  type="button"
                                  data-top-panel-step
                                  data-step-idx={String(index)}
                                  className={`w-full rounded px-2 py-1 focus:outline-none focus:ring-0 text-center ${selected ? 'bg-slate-100' : 'bg-transparent'}`}
                                  onClick={(ev) => {
                                    ev.preventDefault()
                                    ev.stopPropagation()
                                    void loadTopPanelStepForEditing(index)
                                  }}
                                >
                                  {html ? (
                                    <span className="inline align-middle" dangerouslySetInnerHTML={{ __html: html }} />
                                  ) : (
                                    <span className="text-slate-500">&nbsp;</span>
                                  )}
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <p className="text-slate-500 text-sm text-center">Send a step to make it selectable here.</p>
                        </div>
                      )
                    ) : topPanelRenderPayload.markup ? (
                      <div
                        className="text-slate-900 leading-relaxed"
                        style={topPanelRenderPayload.style}
                        dangerouslySetInnerHTML={{ __html: topPanelRenderPayload.markup }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <p className="text-slate-500 text-sm text-center">Convert to notes to preview the typeset LaTeX here.</p>
                      </div>
                    )
                  ) : useStackedStudentLayout ? (
                    <div className="h-full flex flex-col">
                      {!hasWriteAccess && quizActive && !isAssignmentView ? (
                        <>
                          {quizTimeLeftSec != null && (
                            <div className="mb-2 flex items-center justify-end text-xs text-slate-500">
                              Time left: {formatCountdown(quizTimeLeftSec)}
                            </div>
                          )}
                          {topPanelRenderPayload.markup ? (
                            <div
                              className="text-slate-700 font-semibold leading-relaxed"
                              style={topPanelRenderPayload.style}
                              dangerouslySetInnerHTML={{ __html: topPanelRenderPayload.markup }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <p className="text-slate-500 text-sm text-center">Write your answer below to see your LaTeX here.</p>
                            </div>
                          )}
                        </>
                          ) : topPanelRenderPayload.markup ? (
                        <div
                          className="text-slate-900 leading-relaxed"
                              style={topPanelRenderPayload.style}
                              dangerouslySetInnerHTML={{ __html: topPanelRenderPayload.markup }}
                        />
                      ) : isAssignmentView ? null : (
                        <div className="w-full h-full flex items-center justify-center">
                          <p className="text-slate-500 text-sm text-center">Waiting for teacher notes…</p>
                        </div>
                      )}
                    </div>
                  ) : latexDisplayState.enabled ? (
                    topPanelRenderPayload.markup ? (
                      <div
                        className="text-slate-900 leading-relaxed"
                        style={topPanelRenderPayload.style}
                        dangerouslySetInnerHTML={{ __html: topPanelRenderPayload.markup }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <p className="text-slate-500 text-sm text-center">Waiting for teacher notes…</p>
                      </div>
                    )
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <p className="text-slate-500 text-sm text-center">Teacher hasn’t shared notes yet.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div
              role="separator"
              aria-orientation="horizontal"
              ref={splitHandleRef}
              className="relative z-20 flex items-center justify-center px-4 py-2 bg-white cursor-row-resize select-none"
              style={{ touchAction: 'none' }}
              onPointerMove={handleSplitPointerMove}
              onPointerUp={event => {
                event.stopPropagation()
                event.preventDefault()
                stopSplitDrag()
              }}
              onPointerCancel={event => {
                event.stopPropagation()
                event.preventDefault()
                stopSplitDrag()
              }}
              onPointerDown={event => {
                event.stopPropagation()
                event.preventDefault()
                startSplitDrag(event.pointerId, event.clientY)
                try {
                  event.currentTarget.setPointerCapture(event.pointerId)
                } catch {}
              }}
            >
              <div className="w-10 h-1.5 bg-slate-400 rounded-full" />
            </div>
            <div className="px-4 pb-3 flex flex-col min-h-0" style={{ flex: Math.max(1 - studentSplitRatio, 0.2), minHeight: '220px' }}>
              <div className={`flex items-center mb-2 ${canPersistLatex ? 'justify-between' : 'justify-end'}`}>
                {canPersistLatex ? (
                  (() => {
                    const simplified = Boolean(isOverlayMode || isCompactViewport)
                    return (
                      <div
                        className={`flex items-center gap-2 text-[11px] text-slate-600 ${simplified ? 'flex-nowrap' : 'flex-wrap'}`}
                      >
                        {simplified ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="px-2 py-1 text-slate-700 disabled:opacity-50"
                              title="Notes"
                              onClick={(e) => {
                                e.stopPropagation()
                                e.preventDefault()
                                void openNotesLibrary()
                              }}
                              disabled={notesLibraryLoading}
                            >
                              <span className="sr-only">Open notes</span>
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 24 24"
                                  width="18"
                                  height="18"
                                  fill="currentColor"
                                  className="text-slate-700"
                                  aria-hidden="true"
                                >
                                  <path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm2 16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11v5h3v10z" />
                                  <path d="M7 12h10v8H7z" opacity="0.2" />
                                  <path d="M7 12h10v8H7zm2 2v4h6v-4H9z" />
                                </svg>
                            </button>

                            <button
                              type="button"
                              className="px-2 py-1 text-slate-700 disabled:opacity-50"
                              title="Undo"
                              onClick={() => runCanvasAction(handleUndo)}
                              disabled={(status !== 'ready') || Boolean(fatalError) || isViewOnly || (!canUndo && !(useAdminStepComposer && hasWriteAccess))}
                              onPointerDown={(e) => {
                                if ((status !== 'ready') || Boolean(fatalError) || isViewOnly) return
                                if (!canUndo && !(useAdminStepComposer && hasWriteAccess)) return
                                pressRepeatTriggeredRef.current = false
                                pressRepeatActiveRef.current = true
                                pressRepeatPointerIdRef.current = e.pointerId
                                if (pressRepeatTimeoutRef.current) {
                                  clearTimeout(pressRepeatTimeoutRef.current)
                                  pressRepeatTimeoutRef.current = null
                                }
                                pressRepeatTimeoutRef.current = setTimeout(() => {
                                  if (!pressRepeatActiveRef.current) return
                                  pressRepeatTriggeredRef.current = true

                                  const tick = async () => {
                                    if (!pressRepeatActiveRef.current) return
                                    await runCanvasAction(handleUndo)
                                    if (!pressRepeatActiveRef.current) return
                                    pressRepeatTimeoutRef.current = setTimeout(() => {
                                      void tick()
                                    }, 110)
                                  }

                                  void tick()
                                }, 320)
                                try {
                                  e.currentTarget.setPointerCapture(e.pointerId)
                                } catch {}
                              }}
                              onPointerUp={(e) => {
                                if (pressRepeatPointerIdRef.current !== e.pointerId) return
                                pressRepeatActiveRef.current = false
                                pressRepeatPointerIdRef.current = null
                                if (pressRepeatTimeoutRef.current) {
                                  clearTimeout(pressRepeatTimeoutRef.current)
                                  pressRepeatTimeoutRef.current = null
                                }
                              }}
                              onPointerCancel={(e) => {
                                if (pressRepeatPointerIdRef.current !== e.pointerId) return
                                pressRepeatActiveRef.current = false
                                pressRepeatPointerIdRef.current = null
                                if (pressRepeatTimeoutRef.current) {
                                  clearTimeout(pressRepeatTimeoutRef.current)
                                  pressRepeatTimeoutRef.current = null
                                }
                              }}
                            >
                              <span className="sr-only">Undo</span>
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                width="18"
                                height="18"
                                fill="currentColor"
                                className="text-slate-700"
                                aria-hidden="true"
                              >
                                <path d="M12.5 8H7.83l2.58-2.59L9 4 4 9l5 5 1.41-1.41L7.83 10H12.5A5.5 5.5 0 1 1 7 15h-2a7.5 7.5 0 1 0 7.5-7.5z" />
                              </svg>
                            </button>

                            <button
                              type="button"
                              className="px-2 py-1 text-slate-700 disabled:opacity-50"
                              title="Redo"
                              onClick={() => runCanvasAction(handleRedo)}
                              disabled={(status !== 'ready') || Boolean(fatalError) || isViewOnly || (!canRedo && !(useAdminStepComposer && hasWriteAccess))}
                              onPointerDown={(e) => {
                                if ((status !== 'ready') || Boolean(fatalError) || isViewOnly) return
                                if (!canRedo && !(useAdminStepComposer && hasWriteAccess)) return
                                pressRepeatTriggeredRef.current = false
                                pressRepeatActiveRef.current = true
                                pressRepeatPointerIdRef.current = e.pointerId
                                if (pressRepeatTimeoutRef.current) {
                                  clearTimeout(pressRepeatTimeoutRef.current)
                                  pressRepeatTimeoutRef.current = null
                                }
                                pressRepeatTimeoutRef.current = setTimeout(() => {
                                  if (!pressRepeatActiveRef.current) return
                                  pressRepeatTriggeredRef.current = true

                                  const tick = async () => {
                                    if (!pressRepeatActiveRef.current) return
                                    await runCanvasAction(handleRedo)
                                    if (!pressRepeatActiveRef.current) return
                                    pressRepeatTimeoutRef.current = setTimeout(() => {
                                      void tick()
                                    }, 110)
                                  }

                                  void tick()
                                }, 320)
                                try {
                                  e.currentTarget.setPointerCapture(e.pointerId)
                                } catch {}
                              }}
                              onPointerUp={(e) => {
                                if (pressRepeatPointerIdRef.current !== e.pointerId) return
                                pressRepeatActiveRef.current = false
                                pressRepeatPointerIdRef.current = null
                                if (pressRepeatTimeoutRef.current) {
                                  clearTimeout(pressRepeatTimeoutRef.current)
                                  pressRepeatTimeoutRef.current = null
                                }
                              }}
                              onPointerCancel={(e) => {
                                if (pressRepeatPointerIdRef.current !== e.pointerId) return
                                pressRepeatActiveRef.current = false
                                pressRepeatPointerIdRef.current = null
                                if (pressRepeatTimeoutRef.current) {
                                  clearTimeout(pressRepeatTimeoutRef.current)
                                  pressRepeatTimeoutRef.current = null
                                }
                              }}
                            >
                              <span className="sr-only">Redo</span>
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                width="18"
                                height="18"
                                fill="currentColor"
                                className="text-slate-700"
                                aria-hidden="true"
                              >
                                <path d="M11.5 8H16.17l-2.58-2.59L15 4l5 5-5 5-1.41-1.41L16.17 10H11.5A5.5 5.5 0 1 0 17 15h2a7.5 7.5 0 1 1-7.5-7.5z" />
                              </svg>
                            </button>

                            <button
                              type="button"
                              className="px-2 py-1 text-slate-700 disabled:opacity-50"
                              title="Clear"
                              onClick={(e) => {
                                if (binLongPressTriggeredRef.current) {
                                  // Long press already cleared everything.
                                  binLongPressTriggeredRef.current = false
                                  e.preventDefault()
                                  e.stopPropagation()
                                  return
                                }
                                runCanvasAction(handleClear)
                              }}
                              disabled={!canClear || status !== 'ready' || Boolean(fatalError) || isViewOnly}
                              onPointerDown={(e) => {
                                if ((status !== 'ready') || Boolean(fatalError) || isViewOnly) return
                                binLongPressTriggeredRef.current = false
                                if (binLongPressTimeoutRef.current) {
                                  clearTimeout(binLongPressTimeoutRef.current)
                                  binLongPressTimeoutRef.current = null
                                }
                                binLongPressTimeoutRef.current = setTimeout(() => {
                                  binLongPressTimeoutRef.current = null
                                  binLongPressTriggeredRef.current = true
                                  void runCanvasAction(() => clearEverything())
                                }, 520)
                                try {
                                  e.currentTarget.setPointerCapture(e.pointerId)
                                } catch {}
                              }}
                              onPointerUp={() => {
                                if (binLongPressTimeoutRef.current) {
                                  clearTimeout(binLongPressTimeoutRef.current)
                                  binLongPressTimeoutRef.current = null
                                }
                              }}
                              onPointerCancel={() => {
                                if (binLongPressTimeoutRef.current) {
                                  clearTimeout(binLongPressTimeoutRef.current)
                                  binLongPressTimeoutRef.current = null
                                }
                              }}
                            >
                              <span className="sr-only">Clear</span>
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                width="18"
                                height="18"
                                fill="currentColor"
                                className="text-slate-700"
                                aria-hidden="true"
                              >
                                <path d="M6 7h12l-1 14H7L6 7zm3-3h6l1 2H8l1-2z" />
                              </svg>
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="px-2 py-1 text-slate-700 disabled:opacity-50 whitespace-nowrap"
                            onClick={() => { void openNotesLibrary() }}
                            disabled={notesLibraryLoading}
                          >
                            {notesLibraryLoading ? 'Loading…' : 'Notes'}
                          </button>
                        )}

                        {!simplified && (
                          <>
                            <button
                              type="button"
                              className="px-2 py-1 text-slate-700 disabled:opacity-50"
                              onClick={() => handleLoadSavedLatex('shared')}
                              disabled={!latestSharedSave}
                            >
                              Load class
                            </button>
                            <button
                              type="button"
                              className="px-2 py-1 text-slate-700 disabled:opacity-50"
                              onClick={() => handleLoadSavedLatex('mine')}
                              disabled={!latestPersonalSave}
                            >
                              Load my notes
                            </button>
                            <button
                              type="button"
                              className="px-2 py-1 text-slate-700"
                              onClick={fetchLatexSaves}
                            >
                              Refresh
                            </button>
                          </>
                        )}

                        {latexSaveError && (
                          <span className={`text-red-600 text-[11px] ${simplified ? 'truncate max-w-[40vw]' : ''}`}>
                            {latexSaveError}
                          </span>
                        )}
                      </div>
                    )
                  })()
                ) : null}

                {(isAdmin || quizActive || (!isAdmin && typeof onRequestVideoOverlay === 'function')) ? (
                  <div className="flex items-center gap-2">
                    {isAdmin && isCompactViewport && (
                      <button
                        type="button"
                        className="px-2 py-1"
                        title="Diagrams"
                        onClick={() => {
                          toggleMobileDiagramTray()
                          openPickerOrApplySingle('diagram')
                        }}
                        disabled={Boolean(fatalError)}
                      >
                        <span className="sr-only">Diagrams</span>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          width="18"
                          height="18"
                          fill="currentColor"
                          className="text-slate-700"
                          aria-hidden="true"
                        >
                          <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5zm2 0v14h12V5H6z" />
                          <path d="M8 15l2.5-3 2 2.4L15 12l3 4H8z" opacity="0.25" />
                          <path d="M8 15l2.5-3 2 2.4L15 12l3 4H8z" />
                          <circle cx="9" cy="9" r="1.4" />
                        </svg>
                      </button>
                    )}

                    {showTextIcon && (
                      <button
                        type="button"
                        className="px-2 py-1"
                        title="Text"
                        onClick={() => {
                          const canOpenTray = isAdmin || allowStudentTextTray
                          const now = Date.now()
                          const last = textIconLastTapRef.current

                          if (textIconTapTimeoutRef.current) {
                            clearTimeout(textIconTapTimeoutRef.current)
                            textIconTapTimeoutRef.current = null
                          }

                          if (last && (now - last) < 320) {
                            // Double tap: keep the current behaviour (tray + picker).
                            textIconLastTapRef.current = null
                            if (canOpenTray) {
                              toggleMobileTextTray()
                              if (isAdmin) {
                                openPickerOrApplySingle('text')
                              }
                            }
                            return
                          }

                          // Single tap: toggle Editing Mode. Delay slightly to allow double-tap.
                          textIconLastTapRef.current = now
                          textIconTapTimeoutRef.current = setTimeout(() => {
                            textIconTapTimeoutRef.current = null
                            setTopPanelEditingMode(prev => {
                              const next = !prev
                              if (!next) {
                                clearTopPanelSelection()
                              }
                              return next
                            })
                          }, 260)
                        }}
                        disabled={Boolean(fatalError)}
                      >
                        <span className="sr-only">Text</span>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          width="18"
                          height="18"
                          fill="currentColor"
                          className="text-slate-700"
                          aria-hidden="true"
                        >
                          <path d="M5 4h14v3h-5v13h-4V7H5V4z" />
                        </svg>
                      </button>
                    )}

                    {isAdmin && isCompactViewport && (
                      <button
                        type="button"
                        className="px-2 py-1"
                        title="LaTeX"
                        onClick={() => {
                          toggleMobileLatexTray()
                          openPickerOrApplySingle('latex')
                        }}
                        disabled={Boolean(fatalError)}
                      >
                        <span className="sr-only">LaTeX</span>
                        <span className="text-slate-700 text-[16px] leading-none font-semibold" aria-hidden="true">Σ</span>
                      </button>
                    )}

                    {isOverlayMode && (
                      <button
                        type="button"
                        className={`px-2 py-1 rounded ${isEraserMode ? 'bg-slate-900/10' : ''} ${isViewOnly ? 'opacity-50' : ''}`}
                        title={isEraserMode ? (eraserShimReady ? 'Eraser (on)' : 'Eraser (on, initializing)') : (eraserShimReady ? 'Eraser' : 'Eraser (initializing)')}
                        aria-pressed={isEraserMode}
                        onClick={(e) => {
                          if (eraserLongPressTriggeredRef.current) {
                            eraserLongPressTriggeredRef.current = false
                            e.preventDefault()
                            e.stopPropagation()
                            return
                          }
                          if (isViewOnly) return
                          setIsEraserMode(prev => !prev)
                        }}
                        disabled={status !== 'ready' || Boolean(fatalError) || isViewOnly}
                        onPointerDown={(e) => {
                          if ((status !== 'ready') || Boolean(fatalError) || isViewOnly) return
                          eraserLongPressTriggeredRef.current = false
                          if (eraserLongPressTimeoutRef.current) {
                            clearTimeout(eraserLongPressTimeoutRef.current)
                            eraserLongPressTimeoutRef.current = null
                          }
                          if (isAdmin) {
                            // Admin-only: long press opens the old canvas controls (replaces the gear icon).
                            eraserLongPressTimeoutRef.current = setTimeout(() => {
                              eraserLongPressTimeoutRef.current = null
                              eraserLongPressTriggeredRef.current = true
                              openOverlayControls()
                            }, 520)
                          }
                          try {
                            e.currentTarget.setPointerCapture(e.pointerId)
                          } catch {}
                        }}
                        onPointerUp={() => {
                          if (eraserLongPressTimeoutRef.current) {
                            clearTimeout(eraserLongPressTimeoutRef.current)
                            eraserLongPressTimeoutRef.current = null
                          }
                        }}
                        onPointerCancel={() => {
                          if (eraserLongPressTimeoutRef.current) {
                            clearTimeout(eraserLongPressTimeoutRef.current)
                            eraserLongPressTimeoutRef.current = null
                          }
                        }}
                      >
                        <span className="sr-only">Eraser</span>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          width="18"
                          height="18"
                          fill="currentColor"
                          className={isEraserMode ? 'text-slate-900' : 'text-slate-700'}
                          aria-hidden="true"
                        >
                          <path d="M16.24 3.56a2.5 2.5 0 0 1 3.54 0l.66.66a2.5 2.5 0 0 1 0 3.54l-9.2 9.2a2.5 2.5 0 0 1-1.77.73H5.5a1.5 1.5 0 0 1-1.06-.44l-1.1-1.1a1.5 1.5 0 0 1 0-2.12l12.9-12.9z" opacity="0.25" />
                          <path d="M15.53 4.27 4.04 15.76a.5.5 0 0 0 0 .71l1.1 1.1c.09.1.22.15.35.15h3.97c.2 0 .38-.08.52-.21l9.2-9.2a1.5 1.5 0 0 0 0-2.12l-.66-.66a1.5 1.5 0 0 0-2.12 0z" />
                          <path d="M4 20h16v2H4v-2z" />
                        </svg>
                      </button>
                    )}



                    <button
                      type="button"
                      className="px-2 py-1"
                      title={isAssignmentSolutionAuthoring ? 'Commit / Save' : 'Send step'}
                      onClick={handleSendStepClick}
                      disabled={
                        status !== 'ready'
                        || Boolean(fatalError)
                        || (
                          isStudentSendContext
                            ? quizSubmitting
                            : (canUseAdminSend
                              ? (adminSendingStep || (!adminDraftLatex && !canClear && !(adminSteps.length > 0)))
                              : true)
                        )
                      }
                    >
                      <span className="sr-only">Send</span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        width="18"
                        height="18"
                        fill="currentColor"
                        className="text-slate-700"
                        aria-hidden="true"
                      >
                        <path d="M21.9 2.6c.2-.7-.5-1.3-1.2-1.1L2.4 7.7c-.9.3-1 1.6-.1 2l7 3.2 3.2 7c.4.9 1.7.8 2-.1l6.2-18.2zM10.2 12.5 5.2 10.2l12.3-4.2-7.3 6.5zm2.3 6.3-2.3-5 6.5-7.3-4.2 12.3z" />
                      </svg>
                    </button>

                    {isCompactViewport && mobileLatexTrayOpen && (
                      <div
                        className="fixed left-2 right-2 z-50 rounded-lg border border-slate-200 bg-white shadow-sm p-3"
                        style={{ bottom: viewportBottomOffsetPx + STACKED_BOTTOM_OVERLAY_RESERVE_PX + 8 }}
                        role="dialog"
                        aria-label="LaTeX actions"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-sm text-slate-700 font-medium">
                            {isLessonAuthoring ? 'LaTeX for this point' : 'LaTeX'}
                          </div>
                          <button
                            type="button"
                            className="px-2 py-1 text-slate-700"
                            onClick={() => setMobileLatexTrayOpen(false)}
                          >
                            Close
                          </button>
                        </div>
                        {isLessonAuthoring ? (
                          <div className="text-[11px] text-slate-600">
                            <button
                              type="button"
                              className="px-2 py-1 text-slate-700"
                              onClick={() => setAuthoringLatexExpanded(v => !v)}
                            >
                              {authoringLatexExpanded ? 'Collapse' : 'Expand'} ({authoringLatexEntries.length})
                            </button>

                            {authoringLatexExpanded && (
                              <div className="mt-2 max-h-[32vh] overflow-auto border border-slate-200 rounded-md">
                                {authoringLatexEntries.length === 0 ? (
                                  <div className="px-3 py-2 text-slate-500">No LaTeX saved for this point yet.</div>
                                ) : (
                                  <div className="flex flex-col">
                                    {authoringLatexEntries.map((latex, idx) => (
                                      <button
                                        key={`authoring-latex-${idx}`}
                                        type="button"
                                        className="text-left px-3 py-2 border-b border-slate-200 last:border-b-0 hover:bg-slate-50"
                                        onClick={() => {
                                          applyLoadedLatex(latex)
                                          setMobileLatexTrayOpen(false)
                                        }}
                                      >
                                        <div className="text-[12px] text-slate-900 truncate">{latex}</div>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-600">
                            <button
                              type="button"
                              className="px-2 py-1 text-slate-700"
                              onClick={() => setAuthoringLatexExpanded(v => !v)}
                            >
                              {authoringLatexExpanded ? 'Collapse' : 'Expand'}
                            </button>

                            {authoringLatexExpanded && (
                              <div className="mt-2 max-h-[32vh] overflow-auto border border-slate-200 rounded-md">
                                {(() => {
                                  const latexModules = v2ModuleChoices.filter(({ mod }) => mod.type === 'latex')
                                  if (latexModules.length === 0) {
                                    return <div className="px-3 py-2 text-slate-500">No LaTeX modules for this point.</div>
                                  }
                                  return (
                                    <div className="flex flex-col">
                                      <div className="px-3 py-2 border-b border-slate-200">
                                        <div className="text-[12px] text-slate-700 font-medium">Selected</div>
                                        {sessionLatexSelection?.latex ? (
                                          <div className="mt-1">
                                            <div className="text-[12px] text-slate-900 truncate">{sessionLatexSelection.latex}</div>
                                            <div className="mt-2 flex items-center gap-2">
                                              {hasWriteAccess && (
                                                <button
                                                  type="button"
                                                  className="px-2 py-1 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                                  disabled={sessionLatexSelection.moduleIndex < 0}
                                                  onClick={() => {
                                                    suppressStackedNotesPreviewUntilTsRef.current = 0
                                                    applyLoadedLatex(sessionLatexSelection.latex)
                                                    void applyLessonScriptPlaybackV2(lessonScriptPhaseKey, lessonScriptPointIndex, sessionLatexSelection.moduleIndex)
                                                    setMobileLatexTrayOpen(false)
                                                  }}
                                                >
                                                  Add to display
                                                </button>
                                              )}
                                              <button
                                                type="button"
                                                className="px-2 py-1 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                                onClick={() => {
                                                  suppressStackedNotesPreviewUntilTsRef.current = 0
                                                  if (hasWriteAccess) {
                                                    void clearLessonModules()
                                                  } else {
                                                    setLatexDisplayState(curr => ({ ...curr, enabled: false }))
                                                  }
                                                  setSessionLatexSelection(null)
                                                  setMobileLatexTrayOpen(false)
                                                }}
                                              >
                                                Don’t add
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="mt-1 text-slate-500">Tap a line below to preview it in the top panel.</div>
                                        )}
                                      </div>
                                      {latexModules.map(({ index, mod }, idx) => {
                                        const value = mod.type === 'latex' ? String(mod.latex || '').trim() : ''
                                        const label = value || `LaTeX ${idx + 1}`
                                        return (
                                          <button
                                            key={`session-latex-${index}`}
                                            type="button"
                                            className="text-left px-3 py-2 border-b border-slate-200 last:border-b-0 hover:bg-slate-50"
                                            onClick={() => {
                                              if (!value) return
                                              // Preview locally (top panel) without implicitly broadcasting.
                                              suppressStackedNotesPreviewUntilTsRef.current = Date.now() + 12000
                                              applyLoadedLatex(value)
                                              setSessionLatexSelection({ moduleIndex: index, latex: value })
                                            }}
                                          >
                                            <div className="text-[12px] text-slate-900 truncate">{label}</div>
                                          </button>
                                        )
                                      })}
                                    </div>
                                  )
                                })()}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {isCompactViewport && mobileModulePicker && (
                      <div
                        className="fixed left-2 right-2 z-50 rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden"
                        style={{ bottom: viewportBottomOffsetPx + STACKED_BOTTOM_OVERLAY_RESERVE_PX + 88 }}
                        role="dialog"
                        aria-label="Select module"
                      >
                        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
                          <div className="text-sm text-slate-700 font-medium">
                            {mobileModulePicker.type === 'diagram' ? 'Diagrams' : mobileModulePicker.type === 'text' ? 'Text' : 'LaTeX'} for this point
                          </div>
                          <button
                            type="button"
                            className="px-2 py-1 text-slate-700"
                            onClick={closeMobileModulePicker}
                          >
                            Close
                          </button>
                        </div>
                        <div className="p-2 max-h-[40vh] overflow-auto">
                          <div className="flex flex-col gap-1">
                            {v2ModuleChoices
                              .filter(({ mod }) => mod.type === mobileModulePicker.type)
                              .map(({ index, mod }) => {
                                const label = (() => {
                                  if (mod.type === 'diagram') return (mod.diagram?.title || mod.title || 'Diagram').trim() || 'Diagram'
                                  if (mod.type === 'text') return (mod.text || '').trim() || 'Text'
                                  return (mod.latex || '').trim() || 'LaTeX'
                                })()
                                return (
                                  <button
                                    key={`${mobileModulePicker.type}-${index}`}
                                    type="button"
                                    className="text-left px-3 py-2 rounded-md border border-slate-200 bg-white hover:bg-slate-50"
                                    onClick={() => {
                                      closeMobileModulePicker()
                                      void applyLessonScriptPlaybackV2(lessonScriptPhaseKey, lessonScriptPointIndex, index)
                                    }}
                                  >
                                    <div className="text-[12px] text-slate-900 truncate">{label}</div>
                                  </button>
                                )
                              })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="rounded bg-white relative overflow-hidden flex flex-col flex-1 min-h-0">
                <div
                  ref={studentViewportRef}
                  className="relative flex-1 min-h-0 overflow-auto"
                  style={{
                    touchAction: 'pan-x pan-y pinch-zoom',
                    paddingBottom: showBottomHorizontalScrollbar
                      ? `calc(env(safe-area-inset-bottom) + ${viewportBottomOffsetPx}px + ${STACKED_BOTTOM_OVERLAY_RESERVE_PX}px)`
                      : undefined,
                  }}
                >
                  <div
                    style={{
                      transform: `scale(${studentViewScale})`,
                      transformOrigin: 'top left',
                      width: `${(100 * inkSurfaceWidthFactor) / studentViewScale}%`,
                      height: `${100 / studentViewScale}%`,
                    }}
                  >
                    <div
                      ref={editorHostRef}
                      className={editorHostClass}
                      style={{ ...editorHostStyle, height: '100%' }}
                      data-orientation={canvasOrientation}
                    />
                  </div>
                </div>

                {(status === 'loading' || status === 'idle') && (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500 bg-white/70">
                    Preparing collaborative canvas…
                  </div>
                )}
                {isViewOnly && !forceEditableForAssignment && !(isSessionQuizMode && quizActive && !isAdmin) && !(!isAdmin && !useStackedStudentLayout && latexDisplayState.enabled) && (
                  <div className="absolute inset-0 flex items-center justify-center text-xs sm:text-sm text-white text-center px-4 bg-slate-900/40 pointer-events-none">
                    {controlOwnerLabel || 'Teacher'} locked the board. You're in view-only mode.
                  </div>
                )}
                {!isAdmin && !useStackedStudentLayout && latexDisplayState.enabled && (
                  <div className="absolute inset-0 flex items-center justify-center text-center px-4 bg-white/95 backdrop-blur-sm overflow-auto">
                    {topPanelRenderPayload.markup ? (
                      <div
                        className="text-slate-900 leading-relaxed max-w-3xl"
                        style={topPanelRenderPayload.style}
                        dangerouslySetInnerHTML={{ __html: topPanelRenderPayload.markup }}
                      />
                    ) : (
                      <p className="text-slate-500 text-sm">Waiting for teacher notes…</p>
                    )}
                  </div>
                )}
                {!isOverlayMode && (
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="absolute top-2 left-2 text-xs bg-white/80 px-2 py-1 rounded border"
                  >
                    {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                  </button>
                )}

                {isOverlayMode && (
                  <div
                    className={`canvas-overlay-controls ${overlayControlsVisible ? 'is-visible' : ''}`}
                    style={{
                      pointerEvents: overlayControlsVisible ? 'auto' : 'none',
                      cursor: overlayControlsVisible ? 'default' : undefined,
                    }}
                    onClick={closeOverlayControls}
                  >
                    <div
                      className="canvas-overlay-controls__panel"
                      onClick={event => {
                        event.stopPropagation()
                        kickOverlayAutoHide()
                      }}
                    >
                      <p className="canvas-overlay-controls__title">Canvas controls</p>
                      {hasWriteAccess ? renderOverlayAdminControls() : renderToolbarBlock()}
                      <button type="button" className="canvas-overlay-controls__dismiss" onClick={closeOverlayControls}>
                        Return to drawing
                      </button>
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>
        )}

        {hasMounted && horizontalScrollbar}
        {hasMounted && leftVerticalScrollbar}
        {hasMounted && rightMasterGainSlider}

        {!useStackedStudentLayout && (
          <div className={`border rounded bg-white relative overflow-hidden ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
          <div
            ref={editorHostRef}
            className={editorHostClass}
            style={editorHostStyle}
            data-orientation={canvasOrientation}
          />

          {ENABLE_EMBEDDED_DIAGRAMS && diagramManagerOpen && hasWriteAccess && (
            <div className="absolute inset-0 z-50 bg-slate-900/30 backdrop-blur-sm" onClick={() => setDiagramManagerOpen(false)}>
              <div
                className="absolute top-3 right-3 left-3 sm:left-auto sm:w-[420px] max-h-[85%] overflow-auto card p-3"
                onClick={e => e.stopPropagation()}
                onPaste={async e => {
                  if (!hasWriteAccess) return
                  if (!e.clipboardData) return
                  const item = Array.from(e.clipboardData.items || []).find(i => i.type.startsWith('image/'))
                  if (!item) return
                  const file = item.getAsFile()
                  if (!file) return
                  setDiagramBusy(true)
                  try {
                    const form = new FormData()
                    form.append('sessionKey', channelName)
                    form.append('file', file)
                    const uploadRes = await fetch('/api/diagrams/upload', { method: 'POST', credentials: 'same-origin', body: form })
                    if (!uploadRes.ok) throw new Error('Upload failed')
                    const uploadPayload = await uploadRes.json()
                    const url = uploadPayload?.url
                    if (!url) throw new Error('Missing URL')
                    const createRes = await fetch('/api/diagrams', {
                      method: 'POST',
                      credentials: 'same-origin',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ sessionKey: channelName, imageUrl: url, title: diagramTitleInput || 'Pasted diagram' }),
                    })
                    if (!createRes.ok) throw new Error('Create failed')
                    const createdPayload = await createRes.json()
                    const diagram = createdPayload?.diagram
                    if (diagram?.id) {
                      const record: any = {
                        id: String(diagram.id),
                        title: typeof diagram.title === 'string' ? diagram.title : '',
                        imageUrl: String(diagram.imageUrl || url),
                        order: typeof diagram.order === 'number' ? diagram.order : 0,
                        annotations: diagram.annotations ? normalizeAnnotations(diagram.annotations) : null,
                      }
                      setDiagrams(prev => {
                        if (prev.some(d => d.id === record.id)) return prev
                        const next = [...prev, record]
                        next.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id))
                        return next
                      })
                      await publishDiagramMessage({ kind: 'add', diagram: record })
                      await setDiagramOverlayState({ activeDiagramId: record.id, isOpen: true })
                    }
                  } catch (err) {
                    console.warn('Paste diagram failed', err)
                  }
                  setDiagramBusy(false)
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Diagram stack</p>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => setDiagramManagerOpen(false)}>
                    Close
                  </button>
                </div>

                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      className="input"
                      placeholder="Image URL"
                      value={diagramUrlInput}
                      onChange={e => setDiagramUrlInput(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={diagramBusy || !diagramUrlInput.trim()}
                      onClick={async () => {
                        if (!hasWriteAccess) return
                        const url = diagramUrlInput.trim()
                        if (!url) return
                        setDiagramBusy(true)
                        try {
                          const createRes = await fetch('/api/diagrams', {
                            method: 'POST',
                            credentials: 'same-origin',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ sessionKey: channelName, imageUrl: url, title: diagramTitleInput || '' }),
                          })
                          if (!createRes.ok) throw new Error('Create failed')
                          const createdPayload = await createRes.json()
                          const diagram = createdPayload?.diagram
                          if (diagram?.id) {
                            const record: any = {
                              id: String(diagram.id),
                              title: typeof diagram.title === 'string' ? diagram.title : '',
                              imageUrl: String(diagram.imageUrl || url),
                              order: typeof diagram.order === 'number' ? diagram.order : 0,
                              annotations: diagram.annotations ? normalizeAnnotations(diagram.annotations) : null,
                            }
                            setDiagrams(prev => {
                              if (prev.some(d => d.id === record.id)) return prev
                              const next = [...prev, record]
                              next.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id))
                              return next
                            })
                            await publishDiagramMessage({ kind: 'add', diagram: record })
                            await setDiagramOverlayState({ activeDiagramId: record.id, isOpen: true })
                            setDiagramUrlInput('')
                          }
                        } catch (err) {
                          console.warn('Add diagram failed', err)
                        }
                        setDiagramBusy(false)
                      }}
                    >
                      Add
                    </button>
                  </div>

                  <label className="btn btn-secondary" style={{ cursor: diagramBusy ? 'not-allowed' : 'pointer' }}>
                    Upload
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      disabled={diagramBusy}
                      onChange={async e => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        setDiagramBusy(true)
                        try {
                          const form = new FormData()
                          form.append('sessionKey', channelName)
                          form.append('file', file)
                          const uploadRes = await fetch('/api/diagrams/upload', { method: 'POST', credentials: 'same-origin', body: form })
                          if (!uploadRes.ok) throw new Error('Upload failed')
                          const uploadPayload = await uploadRes.json()
                          const url = uploadPayload?.url
                          if (!url) throw new Error('Missing URL')
                          const createRes = await fetch('/api/diagrams', {
                            method: 'POST',
                            credentials: 'same-origin',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ sessionKey: channelName, imageUrl: url, title: diagramTitleInput || file.name }),
                          })
                          if (!createRes.ok) throw new Error('Create failed')
                          const createdPayload = await createRes.json()
                          const diagram = createdPayload?.diagram
                          if (diagram?.id) {
                            const record: any = {
                              id: String(diagram.id),
                              title: typeof diagram.title === 'string' ? diagram.title : '',
                              imageUrl: String(diagram.imageUrl || url),
                              order: typeof diagram.order === 'number' ? diagram.order : 0,
                              annotations: diagram.annotations ? normalizeAnnotations(diagram.annotations) : null,
                            }
                            setDiagrams(prev => {
                              if (prev.some(d => d.id === record.id)) return prev
                              const next = [...prev, record]
                              next.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id))
                              return next
                            })
                            await publishDiagramMessage({ kind: 'add', diagram: record })
                            await setDiagramOverlayState({ activeDiagramId: record.id, isOpen: true })
                          }
                        } catch (err) {
                          console.warn('Upload diagram failed', err)
                        }
                        setDiagramBusy(false)
                        try {
                          e.target.value = ''
                        } catch {}
                      }}
                    />
                  </label>

                  <p className="text-[11px] text-slate-600">Tip: paste an image into this panel to add it.</p>
                </div>

                <div className="mt-3">
                  <p className="text-xs font-semibold text-slate-700">Diagrams</p>
                  {diagrams.length === 0 ? (
                    <p className="text-xs text-slate-500 mt-1">No diagrams yet.</p>
                  ) : (
                    <div className="mt-2 space-y-1">
                      {diagrams.map(d => (
                        <button
                          key={d.id}
                          type="button"
                          className={`w-full text-left px-2 py-2 rounded border ${diagramState.activeDiagramId === d.id ? 'border-slate-400 bg-slate-50' : 'border-slate-200 bg-white'}`}
                          onClick={async () => {
                            await setDiagramOverlayState({ activeDiagramId: d.id, isOpen: true })
                          }}
                        >
                          <div className="text-xs font-semibold">{d.title || 'Untitled diagram'}</div>
                          <div className="text-[11px] text-slate-500 truncate">{d.imageUrl}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {ENABLE_EMBEDDED_DIAGRAMS && diagramState.isOpen && activeDiagram && (
            <div
              className={hasWriteAccess ? 'absolute inset-0 z-40' : 'fixed inset-0 z-[200]'}
              aria-label="Diagram overlay"
            >
              <div className="absolute inset-0 bg-black/20" aria-hidden="true" />
              <div className="absolute inset-3 sm:inset-6 rounded-xl border border-white/10 bg-white/95 overflow-hidden shadow-sm">
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-200 bg-white">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500">Diagram</p>
                    <p className="text-sm font-semibold truncate">{activeDiagram.title || 'Untitled diagram'}</p>
                  </div>
                </div>
                <div className="relative w-full h-[calc(100%-44px)]">
                  <div
                    ref={diagramStageRef}
                    className="absolute inset-0"
                    onContextMenuCapture={e => {
                      if (!hasWriteAccess) return
                      if (!activeDiagram?.id) return
                      if (diagramToolRef.current !== 'select') return
                      e.preventDefault()
                      e.stopPropagation()

                      const stage = diagramStageRef.current
                      if (!stage) return
                      const rect = stage.getBoundingClientRect()
                      const x = (e.clientX - rect.left) / Math.max(rect.width, 1)
                      const y = (e.clientY - rect.top) / Math.max(rect.height, 1)
                      const point = { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }

                      const diagramId = activeDiagram.id
                      const hit = hitTestAnnotation(diagramId, point)
                      const existing = diagramSelectionRef.current
                      const selection = hit || existing
                      if (!selection) {
                        setDiagramContextMenu(null)
                        return
                      }
                      if (hit && (!existing || existing.id !== hit.id || existing.kind !== hit.kind)) {
                        setDiagramSelection(hit)
                      }

                      const menuWidth = 224
                      const menuHeight = 420
                      const px = e.clientX - rect.left
                      const py = e.clientY - rect.top
                      const clampedX = Math.max(8, Math.min(px, rect.width - menuWidth - 8))
                      const clampedY = Math.max(8, Math.min(py, rect.height - menuHeight - 8))
                      setDiagramContextMenu({ diagramId, selection, xPx: clampedX, yPx: clampedY, point })
                    }}
                    onPointerDownCapture={e => {
                      if (!diagramContextMenu) return
                      const menuEl = diagramContextMenuRef.current
                      if (menuEl && e.target instanceof Node && menuEl.contains(e.target)) return
                      setDiagramContextMenu(null)
                    }}
                  >
                    {hasWriteAccess && (
                      <div className="absolute top-2 right-2 z-30 pointer-events-none">
                        <div className="pointer-events-auto flex items-center gap-2">
                          <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 py-1 shadow-sm">
                            <button
                              type="button"
                              className={`p-2 rounded-md border ${diagramTool === 'select' ? 'border-slate-400 bg-slate-50' : 'border-slate-200 bg-white'} text-slate-700 hover:bg-slate-50`}
                              onClick={() => setDiagramTool('select')}
                              aria-label="Select tool"
                              title="Select"
                            >
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M7 4l10 10-4 1 2 4-2 1-2-4-3 3V4z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className={`p-2 rounded-md border ${diagramTool === 'pen' ? 'border-slate-400 bg-slate-50' : 'border-slate-200 bg-white'} text-slate-700 hover:bg-slate-50`}
                              onClick={() => setDiagramTool('pen')}
                              aria-label="Pen tool"
                              title="Pen"
                            >
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className={`p-2 rounded-md border ${diagramTool === 'arrow' ? 'border-slate-400 bg-slate-50' : 'border-slate-200 bg-white'} text-slate-700 hover:bg-slate-50`}
                              onClick={() => setDiagramTool('arrow')}
                              aria-label="Arrow tool"
                              title="Arrow"
                            >
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M4 12h13" />
                                <path d="M14 7l5 5-5 5" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className={`p-2 rounded-md border ${diagramTool === 'eraser' ? 'border-slate-400 bg-slate-50' : 'border-slate-200 bg-white'} text-slate-700 hover:bg-slate-50`}
                              onClick={() => setDiagramTool('eraser')}
                              aria-label="Eraser tool"
                              title="Eraser"
                            >
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M20 20H9" />
                                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L10 16l-4 0-2-2 0-4L16.5 3.5z" />
                              </svg>
                            </button>
                            <div className="w-px h-6 bg-slate-200 mx-1" aria-hidden="true" />
                            <button
                              type="button"
                              className="p-2 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                              onClick={async () => {
                                if (!activeDiagram?.id) return
                                const diagram = diagramsRef.current.find(d => d.id === activeDiagram.id)
                                const current = diagram?.annotations ? normalizeAnnotations(diagram.annotations) : { strokes: [], arrows: [] }
                                const prev = diagramUndoRef.current.pop() || null
                                if (!prev) return
                                diagramRedoRef.current.push(cloneDiagramAnnotations(current))
                                syncDiagramHistoryFlags()
                                await commitDiagramAnnotations(activeDiagram.id, prev, null)
                              }}
                              disabled={!diagramCanUndo}
                              aria-label="Undo"
                              title="Undo"
                            >
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M9 14l-4-4 4-4" />
                                <path d="M20 20a8 8 0 0 0-8-8H5" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="p-2 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                              onClick={async () => {
                                if (!activeDiagram?.id) return
                                const diagram = diagramsRef.current.find(d => d.id === activeDiagram.id)
                                const current = diagram?.annotations ? normalizeAnnotations(diagram.annotations) : { strokes: [], arrows: [] }
                                const next = diagramRedoRef.current.pop() || null
                                if (!next) return
                                diagramUndoRef.current.push(cloneDiagramAnnotations(current))
                                syncDiagramHistoryFlags()
                                await commitDiagramAnnotations(activeDiagram.id, next, null)
                              }}
                              disabled={!diagramCanRedo}
                              aria-label="Redo"
                              title="Redo"
                            >
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M15 6l4 4-4 4" />
                                <path d="M4 20a8 8 0 0 1 8-8h7" />
                              </svg>
                            </button>
                          </div>

                          <button
                            type="button"
                            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm"
                            onClick={() => setDiagramManagerOpen(true)}
                            aria-label="Switch diagram"
                            title="Switch diagram"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M12 2l7 4v6c0 5-3 9-7 10-4-1-7-5-7-10V6l7-4z" />
                              <path d="M9 12h6" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm"
                            onClick={() => setDiagramOverlayState({ activeDiagramId: diagramState.activeDiagramId, isOpen: false })}
                            aria-label="Close diagram"
                            title="Close"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M18 6L6 18" />
                              <path d="M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    )}
                    <img
                      ref={diagramImageRef}
                      src={activeDiagram.imageUrl}
                      alt={activeDiagram.title || 'Diagram'}
                      className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
                      onLoad={() => {
                        redrawDiagramCanvas()
                      }}
                    />
                    <canvas
                      ref={diagramCanvasRef}
                      className={`absolute inset-0 ${hasWriteAccess ? (diagramTool === 'select' ? 'cursor-default' : diagramTool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair') : 'pointer-events-none'}`}
                      onPointerDown={async e => {
                        if (!hasWriteAccess) return
                        if (!activeDiagram?.id) return
                        if (diagramDrawingRef.current) return
                        const stage = diagramStageRef.current
                        if (!stage) return
                        const rect = stage.getBoundingClientRect()
                        const x = (e.clientX - rect.left) / Math.max(rect.width, 1)
                        const y = (e.clientY - rect.top) / Math.max(rect.height, 1)
                        const point = { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }

                        const tool = diagramToolRef.current
                        if (tool === 'select') {
                          const diagramId = activeDiagram.id

                          const existing = diagramSelectionRef.current
                          const bbox = existing ? selectionBbox(diagramId, existing) : null
                          const handle = (() => {
                            if (!existing || !bbox) return null
                            const w = Math.max(rect.width, 1)
                            const h = Math.max(rect.height, 1)
                            return hitTestHandle(point, bbox, w, h)
                          })()

                          const hit = hitTestAnnotation(diagramId, point)

                          if (handle && existing && bbox) {
                            {
                              const annNow = diagramAnnotationsForRender(diagramId)
                              if (isSelectionLockedInAnnotations(annNow, existing)) {
                                return
                              }
                            }
                            const base = diagramAnnotationsForRender(diagramId)
                            const corners = bboxCornerPoints(bbox)
                            const anchorHandle = oppositeHandle(handle)
                            const anchorPoint = corners[anchorHandle]
                            diagramEditRef.current = {
                              diagramId,
                              selection: existing,
                              mode: 'scale',
                              handle,
                              startPoint: point,
                              base,
                              baseBbox: bbox,
                              anchorPoint,
                            }
                          } else if (hit) {
                            if (!existing || existing.id !== hit.id || existing.kind !== hit.kind) {
                              setDiagramSelection(hit)
                            }
                            {
                              const annNow = diagramAnnotationsForRender(diagramId)
                              if (isSelectionLockedInAnnotations(annNow, hit)) {
                                return
                              }
                            }
                            const startBBox = selectionBbox(diagramId, hit)
                            if (!startBBox) return
                            const base = diagramAnnotationsForRender(diagramId)
                            diagramEditRef.current = {
                              diagramId,
                              selection: hit,
                              mode: 'move',
                              startPoint: point,
                              base,
                              baseBbox: startBBox,
                            }
                          } else {
                            setDiagramSelection(null)
                            return
                          }

                          diagramDrawingRef.current = true
                          diagramPointerIdRef.current = e.pointerId
                          try {
                            ;(e.currentTarget as any).setPointerCapture?.(e.pointerId)
                          } catch {}
                          return
                        }

                        if (tool === 'eraser') {
                          await eraseDiagramAt(activeDiagram.id, point)
                          return
                        }

                        diagramDrawingRef.current = true
                        diagramPointerIdRef.current = e.pointerId
                        try {
                          ;(e.currentTarget as any).setPointerCapture?.(e.pointerId)
                        } catch {}

                        if (tool === 'arrow') {
                          const arrowId = `${clientIdRef.current}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
                          diagramCurrentArrowRef.current = { id: arrowId, color: '#ef4444', width: 3, start: point, end: point, headSize: 12 }
                          redrawDiagramCanvas()
                          return
                        }

                        const strokeId = `${clientIdRef.current}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
                        diagramCurrentStrokeRef.current = { id: strokeId, color: '#ef4444', width: 3, points: [point] }
                        redrawDiagramCanvas()
                      }}
                      onPointerMove={e => {
                        if (!hasWriteAccess) return
                        const stage = diagramStageRef.current
                        const tool = diagramToolRef.current
                        if (!stage) return
                        const rect = stage.getBoundingClientRect()
                        const x = (e.clientX - rect.left) / Math.max(rect.width, 1)
                        const y = (e.clientY - rect.top) / Math.max(rect.height, 1)
                        const point = { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }

                        if (tool === 'select' && !diagramDrawingRef.current) {
                          const canvasEl = e.currentTarget as HTMLCanvasElement
                          if (!activeDiagram?.id) {
                            canvasEl.style.cursor = 'default'
                            return
                          }

                          const diagramId = activeDiagram.id
                          const sel = diagramSelectionRef.current

                          if (sel) {
                            const bbox = selectionBbox(diagramId, sel)
                            if (bbox) {
                              const handle = hitTestHandle(point, bbox, rect.width, rect.height)
                              if (handle) {
                                canvasEl.style.cursor = handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize'
                                return
                              }

                              const hit = hitTestAnnotation(diagramId, point)
                              if (hit && hit.kind === sel.kind && hit.id === sel.id) {
                                canvasEl.style.cursor = 'move'
                                return
                              }
                            }
                            canvasEl.style.cursor = 'default'
                            return
                          }

                          const hit = hitTestAnnotation(diagramId, point)
                          canvasEl.style.cursor = hit ? 'pointer' : 'default'
                          return
                        }

                        if (!diagramDrawingRef.current) return
                        if (diagramPointerIdRef.current !== null && e.pointerId !== diagramPointerIdRef.current) return

                        const currStroke = diagramCurrentStrokeRef.current
                        const currArrow = diagramCurrentArrowRef.current

                        if (tool === 'select') {
                          const edit = diagramEditRef.current
                          if (!edit) return
                          const dx = point.x - edit.startPoint.x
                          const dy = point.y - edit.startPoint.y
                          if (edit.mode === 'move') {
                            const preview = applyMoveToAnnotations(edit.base, edit.selection, dx, dy)
                            diagramPreviewRef.current = { diagramId: edit.diagramId, annotations: preview }
                            redrawDiagramCanvas()
                            return
                          }
                          if (edit.mode === 'scale' && edit.handle && edit.anchorPoint) {
                            const corners = bboxCornerPoints(edit.baseBbox)
                            const baseCorner = corners[edit.handle]
                            const preview = applyScaleToAnnotations(edit.base, edit.selection, edit.anchorPoint, baseCorner, point)
                            diagramPreviewRef.current = { diagramId: edit.diagramId, annotations: preview }
                            redrawDiagramCanvas()
                            return
                          }
                          return
                        }

                        if (tool === 'arrow') {
                          if (!currArrow) return
                          currArrow.end = point
                        } else {
                          if (!currStroke) return
                          currStroke.points.push(point)
                        }
                        const now = Date.now()
                        if (now - diagramLastPublishTsRef.current > 120) {
                          diagramLastPublishTsRef.current = now
                          redrawDiagramCanvas()
                        }
                      }}
                      onPointerUp={async e => {
                        if (!hasWriteAccess) return
                        if (!diagramDrawingRef.current) return
                        if (diagramPointerIdRef.current !== null && e.pointerId !== diagramPointerIdRef.current) return
                        diagramDrawingRef.current = false
                        diagramPointerIdRef.current = null

                        if (diagramToolRef.current === 'select') {
                          const edit = diagramEditRef.current
                          diagramEditRef.current = null
                          const preview = diagramPreviewRef.current
                          diagramPreviewRef.current = null
                          redrawDiagramCanvas()
                          if (!edit || !preview || preview.diagramId !== edit.diagramId || !preview.annotations) return

                          const diagram = diagramsRef.current.find(d => d.id === edit.diagramId)
                          const before = diagram?.annotations ? normalizeAnnotations(diagram.annotations) : { strokes: [], arrows: [] }
                          await commitDiagramAnnotations(edit.diagramId, preview.annotations, before)
                          return
                        }

                        const stroke = diagramCurrentStrokeRef.current
                        const arrow = diagramCurrentArrowRef.current
                        diagramCurrentStrokeRef.current = null
                        diagramCurrentArrowRef.current = null
                        redrawDiagramCanvas()

                        if (!activeDiagram?.id) return
                        const currentDiagram = diagramsRef.current.find(d => d.id === activeDiagram.id)
                        const before = currentDiagram?.annotations ? normalizeAnnotations(currentDiagram.annotations) : { strokes: [], arrows: [] }

                        if (arrow) {
                          const next: any = { ...before, arrows: [...(before.arrows || []), arrow] }
                          await commitDiagramAnnotations(activeDiagram.id, next, before)
                          return
                        }

                        if (!stroke) return
                        const next: any = { ...before, strokes: [...(before.strokes || []), stroke], arrows: before.arrows || [] }
                        await commitDiagramAnnotations(activeDiagram.id, next, before)
                      }}
                      onPointerCancel={() => {
                        diagramDrawingRef.current = false
                        diagramPointerIdRef.current = null
                        diagramCurrentStrokeRef.current = null
                        diagramCurrentArrowRef.current = null
                        diagramEditRef.current = null
                        diagramPreviewRef.current = null
                        redrawDiagramCanvas()
                      }}
                    />

                    {isAdmin && diagramContextMenu && diagramContextMenu.diagramId === activeDiagram.id && (
                      <div
                        ref={diagramContextMenuRef}
                        className="absolute z-40 w-56 rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden"
                        style={{ left: diagramContextMenu.xPx, top: diagramContextMenu.yPx }}
                        onPointerDown={e => e.stopPropagation()}
                        onContextMenu={e => {
                          e.preventDefault()
                          e.stopPropagation()
                        }}
                      >
                        <div className="px-3 py-2 text-xs font-semibold text-slate-500 border-b border-slate-200">Annotation</div>

                        <div className="py-1">
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                            onClick={async () => {
                              await applyDiagramContextAction('copy', diagramContextMenu.diagramId, diagramContextMenu.selection)
                            }}
                          >
                            Copy
                          </button>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                            onClick={async () => {
                              await applyDiagramContextAction('paste', diagramContextMenu.diagramId, diagramContextMenu.selection, diagramContextMenu.point)
                            }}
                          >
                            Paste
                          </button>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                            onClick={async () => {
                              await applyDiagramContextAction('duplicate', diagramContextMenu.diagramId, diagramContextMenu.selection)
                            }}
                          >
                            Duplicate
                          </button>
                        </div>

                        <div className="h-px bg-slate-200" aria-hidden="true" />

                        <div className="py-1">
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                            onClick={async () => {
                              await applyDiagramContextAction('bring-front', diagramContextMenu.diagramId, diagramContextMenu.selection)
                            }}
                          >
                            Bring to front
                          </button>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                            onClick={async () => {
                              await applyDiagramContextAction('send-back', diagramContextMenu.diagramId, diagramContextMenu.selection)
                            }}
                          >
                            Send to back
                          </button>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                            onClick={async () => {
                              await applyDiagramContextAction('lock', diagramContextMenu.diagramId, diagramContextMenu.selection)
                            }}
                          >
                            Lock
                          </button>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                            onClick={async () => {
                              await applyDiagramContextAction('unlock', diagramContextMenu.diagramId, diagramContextMenu.selection)
                            }}
                          >
                            Unlock
                          </button>
                        </div>

                        <div className="h-px bg-slate-200" aria-hidden="true" />

                        <div className="px-3 pt-2 text-xs font-semibold text-slate-500">Color</div>
                        <div className="px-3 pb-2 pt-1 flex flex-wrap gap-2">
                          {diagramColorPresets.map(p => (
                            <button
                              key={p.key}
                              type="button"
                              className="h-6 w-6 rounded border border-slate-200"
                              style={{ background: p.value }}
                              onClick={async () => {
                                await applyDiagramContextAction(`set-color:${p.value}`, diagramContextMenu.diagramId, diagramContextMenu.selection)
                              }}
                              aria-label={`Set color ${p.label}`}
                              title={p.label}
                            />
                          ))}
                        </div>

                        <div className="h-px bg-slate-200" aria-hidden="true" />

                        <div className="px-3 pt-2 text-xs font-semibold text-slate-500">Thickness</div>
                        <div className="px-3 pb-2 pt-1 flex items-center gap-2">
                          {diagramWidthPresets.map(p => (
                            <button
                              key={p.key}
                              type="button"
                              className="px-2 py-1 rounded border border-slate-200 text-xs text-slate-700 hover:bg-slate-50"
                              onClick={async () => {
                                await applyDiagramContextAction(`set-width:${p.value}`, diagramContextMenu.diagramId, diagramContextMenu.selection)
                              }}
                              title={p.label}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>

                        <div className="h-px bg-slate-200" aria-hidden="true" />

                        <div className="py-1">
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                            onClick={async () => {
                              await applyDiagramContextAction('snap-smooth', diagramContextMenu.diagramId, diagramContextMenu.selection)
                            }}
                          >
                            Snap / Smooth
                          </button>
                        </div>

                        <div className="h-px bg-slate-200" aria-hidden="true" />

                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                          onClick={async () => {
                            await applyDiagramContextAction('delete', diagramContextMenu.diagramId, diagramContextMenu.selection)
                          }}
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                          onClick={async () => {
                            await applyDiagramContextAction('flip-h', diagramContextMenu.diagramId, diagramContextMenu.selection)
                          }}
                        >
                          Flip horizontal
                        </button>
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                          onClick={async () => {
                            await applyDiagramContextAction('flip-v', diagramContextMenu.diagramId, diagramContextMenu.selection)
                          }}
                        >
                          Flip vertical
                        </button>
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                          onClick={async () => {
                            await applyDiagramContextAction('rotate-90', diagramContextMenu.diagramId, diagramContextMenu.selection)
                          }}
                        >
                          Rotate 90°
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {(status === 'loading' || status === 'idle') && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500 bg-white/70">
              Preparing collaborative canvas…
            </div>
          )}
          {status === 'error' && fatalError && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-red-600 bg-white/80 text-center px-4">
              {fatalError}
            </div>
          )}
          {transientError && status === 'ready' && (
            <div className="absolute bottom-2 left-2 max-w-[60%] text-[11px] text-red-600 bg-white/90 border border-red-300 rounded px-2 py-1 shadow-sm pointer-events-none">
              {transientError}
            </div>
          )}
          {editorReconnecting && (
            <div className="absolute inset-0 z-20 pointer-events-auto bg-transparent" aria-hidden="true" />
          )}
          {isViewOnly && !(isSessionQuizMode && quizActive && !isAdmin) && !(!isAdmin && !useStackedStudentLayout && latexDisplayState.enabled) && (
            <div className="absolute inset-0 flex items-center justify-center text-xs sm:text-sm text-white text-center px-4 bg-slate-900/40 pointer-events-none">
              {controlOwnerLabel || 'Teacher'} locked the board. You're in view-only mode.
            </div>
          )}
          {!isAdmin && !useStackedStudentLayout && latexDisplayState.enabled && (
            <div className="absolute inset-0 flex items-center justify-center text-center px-4 bg-white/95 backdrop-blur-sm overflow-auto">
              {topPanelRenderPayload.markup ? (
                <div
                  className="text-slate-900 leading-relaxed max-w-3xl"
                  style={topPanelRenderPayload.style}
                  dangerouslySetInnerHTML={{ __html: topPanelRenderPayload.markup }}
                />
              ) : (
                <p className="text-slate-500 text-sm">Waiting for teacher notes…</p>
              )}
            </div>
          )}
          {!isOverlayMode && (
            <button
              type="button"
              onClick={toggleFullscreen}
              className="absolute top-2 left-2 text-xs bg-white/80 px-2 py-1 rounded border"
            >
              {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            </button>
          )}
        </div>
        )}

        {isOverlayMode && useStackedStudentLayout && (
          <div
            className={`canvas-overlay-controls ${overlayControlsVisible ? 'is-visible' : ''}`}
            style={{
              pointerEvents: overlayControlsVisible ? 'auto' : 'none',
              cursor: overlayControlsVisible ? 'default' : undefined,
              zIndex: 50,
            }}
            onClick={closeOverlayControls}
          >
            <div className="canvas-overlay-controls__panel" onClick={event => {
              event.stopPropagation()
              kickOverlayAutoHide()
            }}>
              <p className="canvas-overlay-controls__title">Canvas controls</p>
              {hasWriteAccess ? renderOverlayAdminControls() : renderToolbarBlock()}
              <button type="button" className="canvas-overlay-controls__dismiss" onClick={closeOverlayControls}>
                Return to drawing
              </button>
            </div>
          </div>
        )}

        {!isOverlayMode && renderToolbarBlock()}

        {!isOverlayMode && (
          <div className="orientation-panel">
            <p className="orientation-panel__label">Canvas orientation</p>
            <div className="orientation-panel__options">
              <button
                className={`btn ${canvasOrientation === 'landscape' ? 'btn-secondary' : ''}`}
                type="button"
                onClick={() => handleOrientationChange('landscape')}
              >
                Landscape
              </button>
              <button
                className={`btn ${canvasOrientation === 'portrait' ? 'btn-secondary' : ''}`}
                type="button"
                onClick={() => handleOrientationChange('portrait')}
                disabled={orientationLockedToLandscape}
                title={orientationLockedToLandscape ? 'Portrait view is disabled while the teacher projects fullscreen.' : undefined}
              >
                Portrait
              </button>
            </div>
            <p className="orientation-panel__note">
              {isAdmin
                ? orientationLockedToLandscape
                  ? 'Fullscreen keeps you in landscape for the widest writing surface.'
                  : 'Switch layouts when not projecting fullscreen.'
                : 'Choose the layout that fits your device—this only affects your view.'}
            </p>
          </div>
        )}

        {isAdmin && !isOverlayMode && (
          <div className="canvas-settings-panel">
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Notes font size</span>
              <input
                type="range"
                min="0.7"
                max="1.6"
                step="0.05"
                value={latexProjectionOptions.fontScale}
                onChange={e => updateLatexProjectionOptions({ fontScale: Number(e.target.value) })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Text alignment</span>
              <select
                className="canvas-settings-panel__select"
                value={latexProjectionOptions.textAlign}
                onChange={e => updateLatexProjectionOptions({ textAlign: e.target.value as LatexDisplayOptions['textAlign'] })}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={latexProjectionOptions.alignAtEquals}
                onChange={e => updateLatexProjectionOptions({ alignAtEquals: e.target.checked })}
              />
              <span className="font-semibold">Align at “=”</span>
            </label>
          </div>
        )}

        {isAdmin && !isOverlayMode && (
          <div className="canvas-settings-panel">
            <button
              className="btn"
              type="button"
              onClick={() => navigateToPage(pageIndex - 1)}
              disabled={pageIndex === 0}
            >
              Previous Page
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => navigateToPage(pageIndex + 1)}
              disabled={pageIndex >= pageRecordsRef.current.length - 1}
            >
              Next Page
            </button>
            <button className="btn" type="button" onClick={addNewPage}>
              New Page
            </button>
            <button className="btn btn-primary" type="button" onClick={shareCurrentPageWithStudents}>
              Show Current Page to Students
            </button>
            <span className="font-semibold">
              Your Page: {pageIndex + 1} / {pageRecordsRef.current.length}
            </span>
            <span className="canvas-settings-panel__hint">
              Students See Page {sharedPageIndex + 1}
            </span>
          </div>
        )}

        {!isOverlayMode && gradeLabel && (
          <p className="text-xs muted">Canvas is scoped to the {gradeLabel} cohort.</p>
        )}

        {!isOverlayMode && isAdmin && (
          <div className="flex items-center gap-2 text-xs mb-1">
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => saveLatexSnapshot({ shared: true })}
              disabled={isSavingLatex}
            >
              {isSavingLatex ? 'Saving…' : 'Save class notes'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={fetchLatexSaves}
              disabled={isSavingLatex}
            >
              Refresh
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => handleLoadSavedLatex('shared')}
              disabled={!latestSharedSave}
            >
              Load class notes
            </button>
            {latexSaveError && <span className="text-red-600">{latexSaveError}</span>}
          </div>
        )}

        {!isOverlayMode && latexOutput && (
          <div>
            <p className="text-xs font-semibold uppercase text-white mb-1">Latest notes</p>
            <pre className="text-sm bg-slate-900/80 border border-white/10 rounded-xl p-3 text-blue-100 overflow-auto whitespace-pre-wrap">{latexOutput}</pre>
          </div>
        )}
        {!isOverlayMode && process.env.NEXT_PUBLIC_MYSCRIPT_DEBUG === '1' && (
          <div className="canvas-debug-panel">
            <div className="font-semibold">Debug</div>
            <div>localVersion: {localVersionRef.current}</div>
            <div>appliedVersion: {appliedVersionRef.current}</div>
            <div>lastRemoteVersion: {lastAppliedRemoteVersionRef.current}</div>
            <div>symbolCount: {lastSymbolCountRef.current}</div>
            <div>suppressUntil: {suppressBroadcastUntilTsRef.current}</div>
            <div>appliedIds: {appliedSnapshotIdsRef.current.size}</div>
            <div>realtimeConnected: {isRealtimeConnected ? 'yes' : 'no'}</div>
            <div>queueLen: {pendingPublishQueueRef.current.length}</div>
            <div>reconnectAttempts: {reconnectAttemptsRef.current}</div>
          </div>
        )}
        {!isOverlayMode && (
          <div className="canvas-admin-controls">
          {hasWriteAccess && (
            <button
              type="button"
              onClick={toggleBroadcastPause}
              className="canvas-admin-controls__button"
            >
              {isBroadcastPaused ? 'Resume Broadcast' : 'Pause Updates'}
            </button>
          )}
          {hasWriteAccess && connectedClients.length > 0 && (
            <select
              className="canvas-admin-controls__select"
              value={selectedClientId}
              onChange={e => setSelectedClientId(e.target.value)}
            >
              <option value="all">All students</option>
              {connectedClients
                .filter(c => c.clientId !== clientId && c.clientId !== ALL_STUDENTS_ID)
                // Exclude presenters from the dropdown list (they already show separately as a badge).
                // Keep the currently-selected client visible even if they are a presenter, to avoid an invalid <select> value.
                .filter(c => {
                  if (selectedClientId && selectedClientId === c.clientId) return true
                  const displayName = normalizeName((c as any)?.name || '') || String(c.clientId)
                  const cUserId = typeof (c as any)?.userId === 'string' ? String((c as any).userId) : undefined
                  const userKey = getUserKey(cUserId, displayName) || `name:${normalizeName(displayName).toLowerCase()}`
                  const allowed = (userKey && controllerRightsUserAllowlistRef.current.has(userKey)) || controllerRightsAllowlistRef.current.has(c.clientId)
                  return !allowed
                })
                .map(c => (
                  <option key={c.clientId} value={c.clientId}>
                    {(() => {
                      const displayName = normalizeName((c as any)?.name || '') || String(c.clientId)
                      const cUserId = typeof (c as any)?.userId === 'string' ? String((c as any).userId) : undefined
                      const userKey = getUserKey(cUserId, displayName) || `name:${normalizeName(displayName).toLowerCase()}`
                      const allowed = (userKey && controllerRightsUserAllowlistRef.current.has(userKey)) || controllerRightsAllowlistRef.current.has(c.clientId)
                      return displayName + (controllerRightsVersion >= 0 && allowed ? ' (presenter)' : '')
                    })()}
                  </option>
                ))}
            </select>
          )}
          {isAdmin && selectedClientId !== 'all' && (
            <button
              type="button"
              onClick={() => {
                const resolved = connectedClientsRef.current.find(c => c.clientId === selectedClientId)
                const resolvedName = normalizeName((resolved as any)?.name || '') || String(selectedClientId)
                const resolvedUserId = typeof (resolved as any)?.userId === 'string' ? String((resolved as any).userId) : undefined
                const userKey = getUserKey(resolvedUserId, resolvedName) || `name:${normalizeName(resolvedName).toLowerCase()}`
                const currentlyAllowed = (userKey && controllerRightsUserAllowlistRef.current.has(userKey)) || controllerRightsAllowlistRef.current.has(selectedClientId)
                void setPresenterRightsForClient(selectedClientId, !currentlyAllowed)
              }}
              className="canvas-admin-controls__button"
              disabled={Boolean(fatalError) || status !== 'ready'}
            >
              {(() => {
                const resolved = connectedClientsRef.current.find(c => c.clientId === selectedClientId)
                const resolvedName = normalizeName((resolved as any)?.name || '') || String(selectedClientId)
                const resolvedUserId = typeof (resolved as any)?.userId === 'string' ? String((resolved as any).userId) : undefined
                const userKey = getUserKey(resolvedUserId, resolvedName) || `name:${normalizeName(resolvedName).toLowerCase()}`
                const currentlyAllowed = (userKey && controllerRightsUserAllowlistRef.current.has(userKey)) || controllerRightsAllowlistRef.current.has(selectedClientId)
                return currentlyAllowed ? 'Revoke Presenter Rights' : 'Grant Presenter Rights'
              })()}
            </button>
          )}
          <span className="canvas-settings-panel__hint">Editing and publishing require presenter rights.</span>
          {!isRealtimeConnected && (
            <span className="text-xs text-amber-200">Realtime disconnected — updates will be queued</span>
          )}
          </div>
        )}
      </div>

      {finishQuestionModalOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-label="Save question as notes"
          onMouseDown={(e) => {
            // Click outside to close.
            if (e.target === e.currentTarget) setFinishQuestionModalOpen(false)
          }}
        >
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />
          <div className="relative w-[min(560px,calc(100vw-24px))] rounded-lg bg-slate-50 shadow-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 bg-slate-900 text-white">
              <div className="text-sm font-semibold">Save As</div>
              <div className="text-[11px] text-slate-200 mt-0.5">
                Saves the full question (all top steps) into Notes.
              </div>
            </div>

            <form
              className="p-4"
              onSubmit={(e) => {
                e.preventDefault()
                void confirmFinishQuestionSave()
              }}
            >
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <label className="block text-xs font-medium text-slate-700">Title</label>
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20"
                  value={finishQuestionTitle}
                  onChange={(e) => setFinishQuestionTitle(e.target.value)}
                  autoFocus
                  placeholder="e.g. Solve for x"
                />
                {finishQuestionNoteId && (
                  <div className="mt-2 text-[11px] text-slate-500">
                    Internal ID saved (hidden): <span className="font-mono">{finishQuestionNoteId}</span>
                  </div>
                )}
              </div>

              {latexSaveError && (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{latexSaveError}</div>
              )}

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setFinishQuestionModalOpen(false)}
                  disabled={isSavingLatex}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={isSavingLatex || !finishQuestionNoteId}
                >
                  {isSavingLatex ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {notesLibraryOpen && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-label="Session notes"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setNotesLibraryOpen(false)
          }}
        >
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />
          <div className="relative w-[min(680px,calc(100vw-24px))] max-h-[min(78vh,720px)] rounded-lg bg-slate-50 shadow-xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Notes</div>
                <div className="text-[11px] text-slate-200 mt-0.5">Saved questions for this session</div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => setNotesLibraryOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="p-4 overflow-auto">
              {notesLibraryLoading ? (
                <div className="text-sm text-slate-600">Loading…</div>
              ) : notesLibraryError ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {notesLibraryError}
                </div>
              ) : notesLibraryItems.length === 0 ? (
                <div className="text-sm text-slate-600">No saved questions yet.</div>
              ) : (
                <div className="space-y-2">
                  {notesLibraryItems.map((item) => {
                    const updatedAt = (item as any)?.updatedAt
                    const when = updatedAt ? new Date(updatedAt).toLocaleString() : ''
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="w-full text-left rounded-md border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50"
                        onClick={() => {
                          applySavedNotesRecord(item)
                          setNotesLibraryOpen(false)
                        }}
                      >
                        <div className="text-sm font-medium text-slate-800 truncate">{item.title || 'Untitled'}</div>
                        <div className="mt-0.5 text-[11px] text-slate-500 flex items-center justify-between gap-2">
                          <span className="truncate">{when}</span>
                          <span className="font-mono text-[10px] text-slate-400">{String((item as any)?.noteId || (item as any)?.payload?.noteId || '').slice(0, 14)}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-slate-200 bg-white flex items-center justify-between">
              <div className="text-[11px] text-slate-500">
                Selecting a question overwrites your current notes view.
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => { void openNotesLibrary() }}
                disabled={notesLibraryLoading}
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      )}



    </div>
  )
}

export default MyScriptMathCanvas
export { MyScriptMathCanvas }


