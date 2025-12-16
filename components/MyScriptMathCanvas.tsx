import { CSSProperties, Ref, useCallback, useEffect, useMemo, useRef, useState, useImperativeHandle } from 'react'
import { renderToString } from 'katex'

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

type ControlState = {
  controllerId: string
  controllerName?: string
  ts: number
} | null

type LatexDisplayOptions = {
  fontScale: number
  textAlign: 'left' | 'center' | 'right'
  alignAtEquals: boolean
}

type LatexDisplayState = {
  enabled: boolean
  latex: string
  options: LatexDisplayOptions
}

type CanvasOrientation = 'portrait' | 'landscape'

type PresenceClient = {
  clientId: string
  name?: string
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
  boardId?: string
  uiMode?: 'default' | 'overlay'
  defaultOrientation?: CanvasOrientation
  overlayControlsHandleRef?: Ref<OverlayControlsHandle>
  onOverlayChromeVisibilityChange?: (visible: boolean) => void
}

const DEFAULT_BROADCAST_DEBOUNCE_MS = 32
const ALL_STUDENTS_ID = 'all-students'
const missingKeyMessage = 'Missing MyScript credentials. Set NEXT_PUBLIC_MYSCRIPT_APPLICATION_KEY and NEXT_PUBLIC_MYSCRIPT_HMAC_KEY.'

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

const MyScriptMathCanvas = ({ gradeLabel, roomId, userId, userDisplayName, isAdmin, boardId, uiMode = 'default', defaultOrientation, overlayControlsHandleRef, onOverlayChromeVisibilityChange }: MyScriptMathCanvasProps) => {
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
  const isApplyingRemoteRef = useRef(false)
  const lastAppliedRemoteVersionRef = useRef(0)
  const suppressBroadcastUntilTsRef = useRef(0)
  const appliedSnapshotIdsRef = useRef<Set<string>>(new Set())
  const lastGlobalUpdateTsRef = useRef(0)
  const [status, setStatus] = useState<CanvasStatus>('idle')
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [transientError, setTransientError] = useState<string | null>(null)
  const [latexOutput, setLatexOutput] = useState('')
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [canClear, setCanClear] = useState(false)
  const [isConverting, setIsConverting] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const initialOrientation: CanvasOrientation = defaultOrientation || (isAdmin ? 'landscape' : 'portrait')
  const [canvasOrientation, setCanvasOrientation] = useState<CanvasOrientation>(initialOrientation)
  const isOverlayMode = uiMode === 'overlay'
  const [isCompactViewport, setIsCompactViewport] = useState(false)
  const [stackedLatexControlsVisible, setStackedLatexControlsVisible] = useState(false)
  const stackedLatexHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Broadcaster role removed: all clients can publish.
  const [connectedClients, setConnectedClients] = useState<Array<PresenceClient>>([])
  const [selectedClientId, setSelectedClientId] = useState<string>('all')
  const [isBroadcastPaused, setIsBroadcastPaused] = useState(false)
  const isBroadcastPausedRef = useRef(false)
  const [isStudentPublishEnabled, setIsStudentPublishEnabled] = useState(false)
  const isStudentPublishEnabledRef = useRef(false)
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(true)
  const [controlState, setControlState] = useState<ControlState>(null)
  const [latexDisplayState, setLatexDisplayState] = useState<LatexDisplayState>({ enabled: false, latex: '', options: DEFAULT_LATEX_OPTIONS })
  const [latexProjectionOptions, setLatexProjectionOptions] = useState<LatexDisplayOptions>(DEFAULT_LATEX_OPTIONS)
  const [studentSplitRatio, setStudentSplitRatio] = useState(0.55) // portion for LaTeX panel when stacked
  const studentSplitRatioRef = useRef(0.55)
  const [studentViewScale, setStudentViewScale] = useState(0.9)
  const [latestSharedLatex, setLatestSharedLatex] = useState<string | null>(null)
  const [latestPersonalLatex, setLatestPersonalLatex] = useState<string | null>(null)
  const [isSavingLatex, setIsSavingLatex] = useState(false)
  const [latexSaveError, setLatexSaveError] = useState<string | null>(null)
  const [pageIndex, setPageIndex] = useState(0)
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
  const lockedOutRef = useRef(!isAdmin)
  const hasExclusiveControlRef = useRef(false)
  const lastControlBroadcastTsRef = useRef(0)
  const lastLatexBroadcastTsRef = useRef(0)
  const latexDisplayStateRef = useRef<LatexDisplayState>({ enabled: false, latex: '', options: DEFAULT_LATEX_OPTIONS })
  const latexProjectionOptionsRef = useRef<LatexDisplayOptions>(DEFAULT_LATEX_OPTIONS)
  const studentStackRef = useRef<HTMLDivElement | null>(null)
  const studentViewportRef = useRef<HTMLDivElement | null>(null)
  const splitHandleRef = useRef<HTMLDivElement | null>(null)
  const splitDragActiveRef = useRef(false)
  const splitDragStartYRef = useRef(0)
  const splitStartRatioRef = useRef(0.55)
  const splitDragPointerIdRef = useRef<number | null>(null)
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
    clientIdRef.current = clientId
  }, [clientId])

  useEffect(() => {
    latexDisplayStateRef.current = latexDisplayState
  }, [latexDisplayState])

  useEffect(() => {
    latexProjectionOptionsRef.current = latexProjectionOptions
  }, [latexProjectionOptions])

  const clearStackedLatexAutoHide = useCallback(() => {
    if (stackedLatexHideTimeoutRef.current) {
      clearTimeout(stackedLatexHideTimeoutRef.current)
      stackedLatexHideTimeoutRef.current = null
    }
  }, [])

  const hideStackedLatexControls = useCallback(() => {
    clearStackedLatexAutoHide()
    setStackedLatexControlsVisible(false)
  }, [clearStackedLatexAutoHide])

  const revealStackedLatexControls = useCallback(() => {
    // Only enable tap-to-show controls on compact viewports or when embedded in overlay mode.
    if (!isOverlayMode && !isCompactViewport) return
    setStackedLatexControlsVisible(true)
    clearStackedLatexAutoHide()
    stackedLatexHideTimeoutRef.current = setTimeout(() => {
      setStackedLatexControlsVisible(false)
    }, 1500)
  }, [clearStackedLatexAutoHide, isCompactViewport, isOverlayMode])

  useEffect(() => {
    if (!onOverlayChromeVisibilityChange) return
    if (!isOverlayMode && !isCompactViewport) return
    onOverlayChromeVisibilityChange(stackedLatexControlsVisible)
  }, [isCompactViewport, isOverlayMode, onOverlayChromeVisibilityChange, stackedLatexControlsVisible])

  useEffect(() => {
    return () => {
      clearStackedLatexAutoHide()
    }
  }, [clearStackedLatexAutoHide])

  useEffect(() => {
    studentSplitRatioRef.current = studentSplitRatio
  }, [studentSplitRatio])

  useEffect(() => {
    isStudentPublishEnabledRef.current = isStudentPublishEnabled
  }, [isStudentPublishEnabled])

  useEffect(() => {
    sharedPageIndexRef.current = sharedPageIndex
  }, [sharedPageIndex])

  useEffect(() => {
    try {
      editorInstanceRef.current?.resize?.()
    } catch {}
  }, [canvasOrientation, isFullscreen])

  // Student split drag listeners
  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!splitDragActiveRef.current) return
      const stackEl = studentStackRef.current
      if (!stackEl) return
      event.preventDefault()
      const rect = stackEl.getBoundingClientRect()
      const delta = event.clientY - splitDragStartYRef.current
      const nextRatio = splitStartRatioRef.current + delta / Math.max(rect.height, 1)
      const clamped = Math.min(Math.max(nextRatio, 0.2), 0.8)
      setStudentSplitRatio(clamped)
      studentSplitRatioRef.current = clamped
    }

    const handlePointerUp = () => {
      if (!splitDragActiveRef.current) return
      splitDragActiveRef.current = false
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
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [])

  const broadcastDebounceMs = useMemo(() => getBroadcastDebounce(), [])

  const updateControlState = useCallback(
    (next: ControlState) => {
      controlStateRef.current = next
      const controllerId = next?.controllerId
      const isExclusiveController = Boolean(controllerId && controllerId === clientIdRef.current)
      hasExclusiveControlRef.current = isExclusiveController
      const hasWriteAccess = Boolean(isAdmin) || controllerId === clientIdRef.current || controllerId === ALL_STUDENTS_ID
      const lockedOut = !hasWriteAccess
      lockedOutRef.current = lockedOut
      if (lockedOut) {
        pendingPublishQueueRef.current = []
      }
      setControlState(next)
    },
    [isAdmin]
  )

  const studentCanPublish = useCallback(() => {
    if (!isStudentPublishEnabledRef.current) return false
    const controllerId = controlStateRef.current?.controllerId
    if (!controllerId) return false
    if (controllerId === ALL_STUDENTS_ID) return true
    return controllerId === clientIdRef.current
  }, [])

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

  const channelName = useMemo(() => {
    // Force a single shared board across instances unless a specific boardId is provided.
    // Prefer per-grade board scoping if gradeLabel is present.
    const base = boardId
      ? sanitizeIdentifier(boardId).toLowerCase()
      : gradeLabel
      ? `grade-${sanitizeIdentifier(gradeLabel).toLowerCase()}`
      : 'shared'
    return `myscript:${base}`
  }, [boardId, gradeLabel])

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
      const canPublish = isAdmin || studentCanPublish()
      if (!canPublish) {
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
    [broadcastDebounceMs, collectEditorSnapshot, userDisplayName, isAdmin, pageIndex, studentCanPublish]
  )

  const publishLatexDisplayState = useCallback(
    async (enabled: boolean, latex: string, options?: LatexDisplayOptions) => {
      if (!isAdmin) return
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
    [isAdmin, userDisplayName]
  )

  useEffect(() => {
    if (!isAdmin) return
    if (!latexDisplayStateRef.current.enabled) return
    const trimmed = (latexOutput || '').trim()
    if (trimmed === latexDisplayStateRef.current.latex) return
    setLatexDisplayState(curr => (curr.enabled ? { ...curr, latex: trimmed } : curr))
    publishLatexDisplayState(true, trimmed, latexProjectionOptionsRef.current)
  }, [latexOutput, isAdmin, publishLatexDisplayState])

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
    if (isAdmin) {
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
  }, [applySnapshotCore, isAdmin])

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

    setStatus('loading')
  setFatalError(null)

    let resizeHandler: (() => void) | null = null
    const listeners: Array<{ type: string; handler: (event: any) => void }> = []

    loadIinkRuntime()
      .then(async () => {
        if (cancelled) return
        if (!window.iink?.Editor?.load) {
          throw new Error('MyScript iink runtime did not expose the expected API.')
        }

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
        setStatus('ready')

        const handleChanged = (evt: any) => {
          setCanUndo(Boolean(evt.detail?.canUndo))
          setCanRedo(Boolean(evt.detail?.canRedo))
          setCanClear(Boolean(evt.detail?.canClear))
          const now = Date.now()
          if (now < suppressBroadcastUntilTsRef.current) {
            return
          }
          if (!isAdmin) {
            const controllerId = controlStateRef.current?.controllerId
            const hasPermission = controllerId === clientIdRef.current || controllerId === ALL_STUDENTS_ID
            if (!hasPermission) {
              enforceAuthoritativeSnapshot()
              return
            }
          }
          const isSharedPage = pageIndex === sharedPageIndexRef.current
          const canSend = (isAdmin || studentCanPublish()) && isSharedPage && !isBroadcastPausedRef.current && !lockedOutRef.current
          const snapshot = collectEditorSnapshot(canSend)
          if (!snapshot) return
          if (snapshot.version === lastAppliedRemoteVersionRef.current) return
          // Update local symbol count tracking for accurate delta math for remote peers.
          lastSymbolCountRef.current = countSymbols(snapshot.symbols)
          if (canSend) {
            broadcastSnapshot(false)
          }

          // Removed auto-export on change to prevent cumulative/garbage LaTeX updates.
        }
        const handleExported = (evt: any) => {
          const exports = evt.detail || {}
          const latex = exports['application/x-latex'] || ''
          setLatexOutput(typeof latex === 'string' ? latex : '')
          setIsConverting(false)
          const isSharedPage = pageIndex === sharedPageIndexRef.current
          const canSend = (isAdmin || studentCanPublish()) && isSharedPage && !isBroadcastPausedRef.current && !lockedOutRef.current
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
          const isSessionTooLong = /session too long/.test(lower)
          const isAuthMissing = /missing.*key|unauthorized|forbidden/.test(lower)
          const isSymbolsUndefined = /cannot read properties of undefined.*symbols/i.test(raw)
          const fatal = isSessionTooLong || isAuthMissing

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
    }
  }, [broadcastSnapshot])

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
          if (isAdmin && connected && pendingPublishQueueRef.current.length && channelRef.current) {
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
            action?: 'wipe' | 'convert' | 'force-resync' | 'latex-display' | 'student-broadcast'
            targetClientId?: string
            snapshot?: SnapshotPayload | null
            enabled?: boolean
            latex?: string
            options?: Partial<LatexDisplayOptions>
          }
          if (data?.action === 'student-broadcast') {
            const enabled = Boolean(data.enabled)
            setIsStudentPublishEnabled(enabled)
            isStudentPublishEnabledRef.current = enabled
            if (enabled) {
              const ts = data?.ts ?? Date.now()
              const controllerId = data.controllerId || ALL_STUDENTS_ID
              const controllerName = data.controllerName || 'All Students'
              updateControlState({ controllerId, controllerName, ts })
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

        channel.subscribe('stroke', handleStroke)
        channel.subscribe('sync-state', handleSyncState)
  channel.subscribe('sync-request', handleSyncRequest)
        channel.subscribe('control', handleControlMessage)
  channel.subscribe('latex', handleLatexMessage)
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
          if (isAdmin) {
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
          await channel.presence.enter({ name: userDisplayName, isAdmin: Boolean(isAdmin) })
          const members = await channel.presence.get()
          setConnectedClients(members.map((m: any) => ({ clientId: m.clientId, name: m.data?.name, isAdmin: Boolean(m.data?.isAdmin) })))
          channel.presence.subscribe(async (presenceMsg: any) => {
            try {
              const list = await channel.presence.get()
              setConnectedClients(list.map((m: any) => ({ clientId: m.clientId, name: m.data?.name, isAdmin: Boolean(m.data?.isAdmin) })))
              // When someone new enters, proactively push current snapshot and states from any client with data.
              if (presenceMsg?.action === 'enter' && !isBroadcastPausedRef.current) {
                const rec = latestSnapshotRef.current ?? (() => {
                  const snap = collectEditorSnapshot(false)
                  return snap ? { snapshot: snap, ts: Date.now(), reason: 'update' as const } : null
                })()
                if (rec && rec.snapshot && !isSnapshotEmpty(rec.snapshot)) {
                  await channel.publish('stroke', {
                    clientId: clientIdRef.current,
                    author: userDisplayName,
                    snapshot: rec.snapshot,
                    ts: rec.ts,
                    reason: rec.reason,
                    originClientId: clientIdRef.current,
                  })
                }
                if (latexDisplayStateRef.current.enabled) {
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
                if (isStudentPublishEnabledRef.current) {
                  try {
                    await channel.publish('control', {
                      clientId: clientIdRef.current,
                      author: userDisplayName,
                      action: 'student-broadcast',
                      enabled: true,
                      controllerId: ALL_STUDENTS_ID,
                      controllerName: 'All Students',
                      ts: Date.now(),
                    })
                  } catch (err) {
                    console.warn('Failed to rebroadcast student publish state', err)
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

  const handleClear = () => {
    if (!editorInstanceRef.current) return
    if (lockedOutRef.current) return
    editorInstanceRef.current.clear()
    setLatexOutput('')
    lastSymbolCountRef.current = 0
    lastBroadcastBaseCountRef.current = 0
    if (pageIndex === sharedPageIndexRef.current) {
      broadcastSnapshot(true, { force: true, reason: 'clear' })
    }
  }

  const handleUndo = () => {
    if (!editorInstanceRef.current) return
    if (lockedOutRef.current) return
    editorInstanceRef.current.undo()
    broadcastSnapshot(false)
  }

  const handleRedo = () => {
    if (!editorInstanceRef.current) return
    if (lockedOutRef.current) return
    editorInstanceRef.current.redo()
    broadcastSnapshot(false)
  }

  const handleConvert = () => {
    if (!editorInstanceRef.current) return
    if (lockedOutRef.current) return
    setIsConverting(true)
    editorInstanceRef.current.convert()
    if (isAdmin && pageIndex === sharedPageIndexRef.current && !isBroadcastPausedRef.current) {
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
    if (!isAdmin) return
    setIsBroadcastPaused(prev => {
      const next = !prev
      isBroadcastPausedRef.current = next
      return next
    })
  }

  const toggleStudentPublishing = async () => {
    if (!isAdmin) return
    const next = !isStudentPublishEnabledRef.current
    setIsStudentPublishEnabled(next)
    isStudentPublishEnabledRef.current = next
    const channel = channelRef.current
    if (!channel) return
    const ts = Date.now()
    try {
      await channel.publish('control', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        action: 'student-broadcast',
        enabled: next,
        controllerId: next ? ALL_STUDENTS_ID : controlStateRef.current?.controllerId,
        controllerName: next ? 'All Students' : controlStateRef.current?.controllerName,
        ts,
      })
      if (next) {
        updateControlState({ controllerId: ALL_STUDENTS_ID, controllerName: 'All Students', ts })
      }
    } catch (err) {
      console.warn('Failed to toggle student publishing', err)
    }
  }

  const disableStudentPublishingAndTakeControl = useCallback(async () => {
    if (!isAdmin) return
    setIsStudentPublishEnabled(false)
    isStudentPublishEnabledRef.current = false
    const channel = channelRef.current
    const ts = Date.now()
    try {
      await channel?.publish('control', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        action: 'student-broadcast',
        enabled: false,
        controllerId: clientIdRef.current,
        controllerName: userDisplayName,
        ts,
      })
    } catch (err) {
      console.warn('Failed to disable student publishing', err)
    }
    updateControlState({ controllerId: clientIdRef.current, controllerName: userDisplayName, ts })
    try {
      await channel?.publish('control', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        locked: true,
        controllerId: clientIdRef.current,
        controllerName: userDisplayName,
        ts: ts + 1,
      })
      lastControlBroadcastTsRef.current = ts + 1
    } catch (err) {
      console.warn('Failed to lock board for admin takeover', err)
    }
  }, [isAdmin, updateControlState, userDisplayName])

  const lockStudentEditing = async () => {
    if (!isAdmin) return
    if (controlStateRef.current && controlStateRef.current.controllerId === clientIdRef.current) return
    const channel = channelRef.current
    if (!channel) return
    const ts = Date.now()
    try {
      await channel.publish('control', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        locked: true,
        controllerId: clientIdRef.current,
        controllerName: userDisplayName,
        ts,
      })
      lastControlBroadcastTsRef.current = ts
      updateControlState({ controllerId: clientIdRef.current, controllerName: userDisplayName, ts })
    } catch (err) {
      console.warn('Failed to request exclusive control', err)
    }
  }

  const unlockStudentEditing = async () => {
    if (!isAdmin) return
    if (!controlStateRef.current || controlStateRef.current.controllerId !== clientIdRef.current) return
    const channel = channelRef.current
    if (!channel) {
      updateControlState(null)
      return
    }
    const ts = Date.now()
    try {
      await channel.publish('control', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        locked: false,
        controllerId: ALL_STUDENTS_ID,
        controllerName: 'All Students',
        ts,
      })
      lastControlBroadcastTsRef.current = ts
      updateControlState({ controllerId: ALL_STUDENTS_ID, controllerName: 'All Students', ts })
    } catch (err) {
      console.warn('Failed to release exclusive control', err)
      updateControlState({ controllerId: ALL_STUDENTS_ID, controllerName: 'All Students', ts })
    }
  }

  const allowSelectedClientEditing = async () => {
    if (!isAdmin) return
    const targetId = selectedClientId
    if (!targetId) return
    const channel = channelRef.current
    if (!channel) return
    const ts = Date.now()
    const isAll = targetId === 'all'
    const targetRecord = connectedClients.find(c => c.clientId === targetId)
    const controllerId = isAll ? ALL_STUDENTS_ID : targetId
    const controllerName = isAll ? 'All Students' : targetRecord?.name || targetId
    try {
      await channel.publish('control', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        locked: !isAll,
        controllerId,
        controllerName,
        ts,
      })
      lastControlBroadcastTsRef.current = ts
      updateControlState({ controllerId, controllerName, ts })
    } catch (err) {
      console.warn('Failed to grant selected client editing rights', err)
    }
  }

  useEffect(() => {
    if (!isAdmin) return
    if (status !== 'ready') return
    if (!channelRef.current) return
    if (controlState?.controllerId === clientId) return
    if (controlState?.controllerId === ALL_STUDENTS_ID) return
    lockStudentEditing()
  }, [isAdmin, status, controlState?.controllerId, clientId, lockStudentEditing])

  const forcePublishLatex = async () => {
    if (!isAdmin) return
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
    if (!isAdmin) return
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

  const forcePublishCanvas = async (targetClientId?: string) => {
    if (!isAdmin) return
    const channel = channelRef.current
    if (!channel) return
    const snapshot = captureFullSnapshot()
    if (!snapshot || isSnapshotEmpty(snapshot)) return
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
        setSharedPageIndex(pageIndex)
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
    if (!isAdmin) return
    await forcePublishCanvas()
  }, [forcePublishCanvas, isAdmin])

  const publishAdminLatexAndCanvasToAll = useCallback(async () => {
    if (!isAdmin) return
    await disableStudentPublishingAndTakeControl()
    await forcePublishLatex()
    await forcePublishCanvas()
  }, [disableStudentPublishingAndTakeControl, forcePublishCanvas, forcePublishLatex, isAdmin])

  const forceClearStudentCanvas = async (targetClientId: string) => {
    if (!isAdmin || !targetClientId) return
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
    if (!isAdmin) return
    const channel = channelRef.current
    if (!channel) return

    // Snapshot current publishing state to restore after the wipe
    const wasStudentPublishEnabled = isStudentPublishEnabledRef.current

    // Temporarily disable student publishing to avoid bounce-back during wipes
    isStudentPublishEnabledRef.current = false
    setIsStudentPublishEnabled(false)
    try {
      await channel.publish('control', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        action: 'student-broadcast',
        enabled: false,
        controllerId: clientIdRef.current,
        controllerName: userDisplayName,
        ts: Date.now(),
      })
    } catch (err) {
      console.warn('Failed to disable student publishing before wipe', err)
    }

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

    // Restore control to all students (unlock) and optionally re-enable student publishing
    const tsRestore = Date.now()
    try {
      await channel.publish('control', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        locked: false,
        controllerId: ALL_STUDENTS_ID,
        controllerName: 'All Students',
        ts: tsRestore,
      })
      updateControlState({ controllerId: ALL_STUDENTS_ID, controllerName: 'All Students', ts: tsRestore })
    } catch (err) {
      console.warn('Failed to unlock after wipe', err)
    }

    if (wasStudentPublishEnabled) {
      try {
        await channel.publish('control', {
          clientId: clientIdRef.current,
          author: userDisplayName,
          action: 'student-broadcast',
          enabled: true,
          controllerId: ALL_STUDENTS_ID,
          controllerName: 'All Students',
          ts: tsRestore + 1,
        })
        setIsStudentPublishEnabled(true)
        isStudentPublishEnabledRef.current = true
      } catch (err) {
        console.warn('Failed to re-enable student publishing after wipe', err)
      }
    }
  }, [connectedClients, forcePublishCanvas, isAdmin, updateControlState, userDisplayName])

  const navigateToPage = useCallback(
    async (targetIndex: number) => {
      if (!isAdmin) return
      if (targetIndex === pageIndex) return
      if (targetIndex < 0 || targetIndex >= pageRecordsRef.current.length) return
      persistCurrentPageSnapshot()
      const snapshot = pageRecordsRef.current[targetIndex]?.snapshot ?? null
      await applyPageSnapshot(snapshot)
      setPageIndex(targetIndex)
    },
    [applyPageSnapshot, isAdmin, pageIndex, persistCurrentPageSnapshot]
  )

  const addNewPage = useCallback(async () => {
    if (!isAdmin) return
    persistCurrentPageSnapshot()
    pageRecordsRef.current.push({ snapshot: null })
    const targetIndex = pageRecordsRef.current.length - 1
    await applyPageSnapshot(null)
    setPageIndex(targetIndex)
  }, [applyPageSnapshot, isAdmin, persistCurrentPageSnapshot])

  const shareCurrentPageWithStudents = useCallback(async () => {
    if (!isAdmin) return
    persistCurrentPageSnapshot()
    await disableStudentPublishingAndTakeControl()
    await forcePublishCanvas()
    setSharedPageIndex(pageIndex)
  }, [disableStudentPublishingAndTakeControl, forcePublishCanvas, isAdmin, pageIndex, persistCurrentPageSnapshot])

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

  const hasWriteAccess = Boolean(isAdmin) || Boolean(
    controlState && (controlState.controllerId === clientId || controlState.controllerId === ALL_STUDENTS_ID)
  )
  const isViewOnly = !hasWriteAccess
  const controlOwnerLabel = (() => {
    if (controlState) {
      if (controlState.controllerId === ALL_STUDENTS_ID) {
        return 'Everyone'
      }
      if (controlState.controllerId === clientId) {
        return 'You'
      }
      return controlState.controllerName || 'Instructor'
    }
    return 'Instructor'
  })()
  const latexProjectionMarkup = useMemo(() => {
    if (!latexDisplayState.latex) return ''
    let latexString = latexDisplayState.latex
    if (latexDisplayState.options.alignAtEquals && !/\\begin\{aligned}/.test(latexString)) {
      const lines = latexString.split(/\\\\/g).map(line => line.trim()).filter(Boolean)
      if (lines.length) {
        const processed = lines.map(line => {
          const equalsIndex = line.indexOf('=')
          if (equalsIndex === -1) return line
          const left = line.slice(0, equalsIndex).trim()
          const right = line.slice(equalsIndex + 1).trim()
          return `${left} &= ${right}`
        })
        latexString = `\\begin{aligned}${processed.join(' \\ ')}\\end{aligned}`
      }
    }
    try {
      return renderToString(latexString, {
        throwOnError: false,
        displayMode: true,
      })
    } catch (err) {
      console.warn('Failed to render LaTeX overlay', err)
      return ''
    }
  }, [latexDisplayState.latex, latexDisplayState.options.alignAtEquals])

  const latexOverlayStyle = useMemo<CSSProperties>(
    () => ({
      fontSize: `${latexDisplayState.options.fontScale}rem`,
      textAlign: latexDisplayState.options.textAlign,
    }),
    [latexDisplayState.options.fontScale, latexDisplayState.options.textAlign]
  )

  const isStudentView = !isAdmin
  const useStackedStudentLayout = isStudentView
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

  const orientationLockedToLandscape = Boolean(isAdmin && isFullscreen)

  const sessionKey = roomId

  const applyLoadedLatex = useCallback((latexValue: string | null) => {
    if (!latexValue) return
    setLatexDisplayState(curr => ({ ...curr, enabled: true, latex: latexValue }))
  }, [])

  const fetchLatexSaves = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionKey)}/latex-saves`)
      if (!res.ok) return
      const data = await res.json()
      const latestShared = Array.isArray(data?.shared) && data.shared.length > 0 ? data.shared[0] : null
      const latestMine = Array.isArray(data?.mine) && data.mine.length > 0 ? data.mine[0] : null
      setLatestSharedLatex(latestShared?.latex || null)
      setLatestPersonalLatex(latestMine?.latex || null)
    } catch (err) {
      console.warn('Failed to fetch saved LaTeX', err)
    }
  }, [sessionKey])

  const saveLatexSnapshot = useCallback(
    async (options?: { shared?: boolean; auto?: boolean }) => {
      const isAuto = Boolean(options?.auto)
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
          const message = errorData?.message || 'Failed to save LaTeX'
          throw new Error(typeof message === 'string' ? message : 'Failed to save LaTeX')
        }
        const payload = await res.json()
        if (payload?.shared) {
          setLatestSharedLatex(payload.latex || latexValue)
        } else {
          setLatestPersonalLatex(payload.latex || latexValue)
        }
        lastSavedHashRef.current = hash
      } catch (err: any) {
        const message = err?.message || 'Failed to save LaTeX'
        if (!isAuto) setLatexSaveError(message)
        console.warn('Save LaTeX error', err)
      } finally {
        if (!isAuto) setIsSavingLatex(false)
      }
    },
    [isAdmin, latexOutput, sessionKey]
  )

  useEffect(() => {
    fetchLatexSaves()
    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current)
      }
    }
  }, [fetchLatexSaves])

  useEffect(() => {
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
  }, [isAdmin, latexDisplayState.latex, latexOutput, saveLatexSnapshot])

  const handleLoadSavedLatex = useCallback(
    (scope: 'shared' | 'mine') => {
      const value = scope === 'shared' ? latestSharedLatex : latestPersonalLatex
      applyLoadedLatex(value || null)
    },
    [applyLoadedLatex, latestPersonalLatex, latestSharedLatex]
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
          disabled={!canUndo || status !== 'ready' || Boolean(fatalError) || isViewOnly}
        >
          Undo
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => runCanvasAction(handleRedo)}
          disabled={!canRedo || status !== 'ready' || Boolean(fatalError) || isViewOnly}
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
          {isConverting ? 'Converting…' : 'Convert to LaTeX'}
        </button>
      </div>
      {isAdmin && (
        <div className="canvas-toolbar__buttons">
          <button
            className="btn"
            type="button"
            onClick={() => runCanvasAction(publishAdminLatexAndCanvasToAll)}
            disabled={status !== 'ready' || Boolean(fatalError) || !latexOutput || latexOutput.trim().length === 0}
          >
            Publish LaTeX to Students
          </button>
          <button
            className={`btn ${latexDisplayState.enabled ? 'btn-secondary' : ''}`}
            type="button"
            onClick={() => runCanvasAction(toggleLatexProjection)}
            disabled={status !== 'ready' || Boolean(fatalError)}
          >
            {latexDisplayState.enabled ? 'Stop LaTeX Display Mode' : 'Project LaTeX onto Student Canvas'}
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
          <button
            className="btn"
            type="button"
            onClick={() => runCanvasAction(allowSelectedClientEditing)}
            disabled={status !== 'ready' || Boolean(fatalError)}
          >
            {selectedClientId === 'all' ? 'Allow All Students to Edit' : 'Allow Selected Student to Edit'}
          </button>
          <button
            className={`btn ${isStudentPublishEnabled ? 'btn-secondary' : ''}`}
            type="button"
            onClick={() => runCanvasAction(toggleStudentPublishing)}
            disabled={status !== 'ready' || Boolean(fatalError)}
          >
            {isStudentPublishEnabled ? 'Disable Student Publishing' : 'Enable Student Publishing'}
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div>
      <div className="flex flex-col gap-3">
        {useStackedStudentLayout && (
          <div
            ref={studentStackRef}
            className="border rounded bg-white p-0 shadow-sm flex flex-col"
            style={{
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
              {!isOverlayMode && !isCompactViewport && (
                <div className="px-4 pt-3 pb-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                  {isAdmin ? (
                    <button
                      type="button"
                      className="px-2 py-1 border rounded"
                      onClick={() => saveLatexSnapshot({ shared: true })}
                      disabled={isSavingLatex}
                    >
                      {isSavingLatex ? 'Saving…' : 'Save for class'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="px-2 py-1 border rounded"
                      onClick={() => saveLatexSnapshot({ shared: false })}
                      disabled={isSavingLatex}
                    >
                      {isSavingLatex ? 'Saving…' : 'Save my copy'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="px-2 py-1 border rounded"
                    onClick={() => handleLoadSavedLatex('shared')}
                    disabled={!latestSharedLatex}
                  >
                    Load class
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 border rounded"
                    onClick={() => handleLoadSavedLatex('mine')}
                    disabled={!latestPersonalLatex}
                  >
                    Load my save
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 border rounded"
                    onClick={fetchLatexSaves}
                  >
                    Refresh
                  </button>
                  {latexSaveError && <span className="text-red-600 text-[11px]">{latexSaveError}</span>}
                </div>
              )}
              <div className={`${isOverlayMode || isCompactViewport ? 'px-3 py-3' : 'mt-2 px-4 pb-2'} flex-1 min-h-[140px]`}>
                <div
                  className="h-full bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-auto relative"
                  onPointerDown={() => {
                    revealStackedLatexControls()
                  }}
                >
                  {(isOverlayMode || isCompactViewport) && stackedLatexControlsVisible && (
                    <div className="absolute left-2 right-2 top-2 z-10 pointer-events-none">
                      <div className="pointer-events-auto inline-flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white/95 backdrop-blur-sm px-2 py-2 text-[11px] text-slate-700">
                        {isAdmin ? (
                          <button
                            type="button"
                            className="px-2 py-1 border rounded"
                            onClick={() => {
                              revealStackedLatexControls()
                              saveLatexSnapshot({ shared: true })
                            }}
                            disabled={isSavingLatex}
                          >
                            {isSavingLatex ? 'Saving…' : 'Save for class'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="px-2 py-1 border rounded"
                            onClick={() => {
                              revealStackedLatexControls()
                              saveLatexSnapshot({ shared: false })
                            }}
                            disabled={isSavingLatex}
                          >
                            {isSavingLatex ? 'Saving…' : 'Save my copy'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="px-2 py-1 border rounded"
                          onClick={() => {
                            revealStackedLatexControls()
                            handleLoadSavedLatex('shared')
                          }}
                          disabled={!latestSharedLatex}
                        >
                          Load class
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 border rounded"
                          onClick={() => {
                            revealStackedLatexControls()
                            handleLoadSavedLatex('mine')
                          }}
                          disabled={!latestPersonalLatex}
                        >
                          Load my save
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 border rounded"
                          onClick={() => {
                            revealStackedLatexControls()
                            fetchLatexSaves()
                          }}
                        >
                          Refresh
                        </button>
                        {latexSaveError && <span className="text-red-600 text-[11px]">{latexSaveError}</span>}
                      </div>
                    </div>
                  )}
                  {latexDisplayState.enabled ? (
                    latexProjectionMarkup ? (
                      <div
                        className="text-slate-900 leading-relaxed"
                        style={latexOverlayStyle}
                        dangerouslySetInnerHTML={{ __html: latexProjectionMarkup }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <p className="text-slate-500 text-sm text-center">Waiting for instructor LaTeX…</p>
                      </div>
                    )
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <p className="text-slate-500 text-sm text-center">Instructor has not enabled LaTeX display.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div
              role="separator"
              aria-orientation="horizontal"
              ref={splitHandleRef}
              className="flex items-center justify-center px-4 py-2 bg-white cursor-row-resize select-none"
              style={{ touchAction: 'none' }}
              onPointerDown={event => {
                event.preventDefault()
                splitDragActiveRef.current = true
                splitDragStartYRef.current = event.clientY
                splitStartRatioRef.current = studentSplitRatioRef.current
                splitDragPointerIdRef.current = event.pointerId
                try {
                  event.currentTarget.setPointerCapture(event.pointerId)
                } catch {}
                document.body.style.userSelect = 'none'
              }}
            >
              <div className="w-full h-0.5 bg-slate-200 relative">
                <div className="absolute left-1/2 -translate-x-1/2 w-12 h-1.5 bg-slate-400 rounded-full" />
              </div>
            </div>
            <div className="px-4 pb-3" style={{ flex: Math.max(1 - studentSplitRatio, 0.2), minHeight: '220px' }}>
              <div className="flex items-center justify-end mb-2">
                {studentScaleControl && (
                  <div className="flex items-center gap-1 text-[11px] text-slate-600">
                    <button
                      type="button"
                      className="px-2 py-1 border rounded"
                      onClick={() => studentScaleControl.handleAdjust(-0.1)}
                    >
                      -
                    </button>
                    <span className="px-1 w-12 text-center">{(studentViewScale * 100).toFixed(0)}%</span>
                    <button
                      type="button"
                      className="px-2 py-1 border rounded"
                      onClick={() => studentScaleControl.handleAdjust(0.1)}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="px-2 py-1 border rounded"
                      onClick={() => studentScaleControl.handleFit()}
                    >
                      Fit
                    </button>
                  </div>
                )}
              </div>
              <div
                ref={studentViewportRef}
                className="border rounded bg-white relative h-full overflow-auto"
                style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
              >
                <div
                  style={{
                    transform: `scale(${studentViewScale})`,
                    transformOrigin: 'top left',
                    width: `${100 / studentViewScale}%`,
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
                  <div className="absolute bottom-2 left-2 max-w-[60%] text-[11px] text-red-600 bg-white/90 border border-red-300 rounded px-2 py-1 shadow-sm">
                    {transientError}
                  </div>
                )}
                {status === 'ready' && (
                  <div className="absolute top-2 right-2 text-xs text-green-600 bg-white/80 px-2 py-1 rounded">
                    Ready
                  </div>
                )}
                {isViewOnly && !(!isAdmin && !useStackedStudentLayout && latexDisplayState.enabled) && (
                  <div className="absolute inset-0 flex items-center justify-center text-xs sm:text-sm text-white text-center px-4 bg-slate-900/40 pointer-events-none">
                    {controlOwnerLabel || 'Instructor'} locked the board. You're in view-only mode.
                  </div>
                )}
                {!isAdmin && !useStackedStudentLayout && latexDisplayState.enabled && (
                  <div className="absolute inset-0 flex items-center justify-center text-center px-4 bg-white/95 backdrop-blur-sm overflow-auto">
                    {latexProjectionMarkup ? (
                      <div
                        className="text-slate-900 leading-relaxed max-w-3xl"
                        style={latexOverlayStyle}
                        dangerouslySetInnerHTML={{ __html: latexProjectionMarkup }}
                      />
                    ) : (
                      <p className="text-slate-500 text-sm">Waiting for instructor LaTeX…</p>
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
                      {renderToolbarBlock()}
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

        {!useStackedStudentLayout && (
          <div className={`border rounded bg-white relative overflow-hidden ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
          <div
            ref={editorHostRef}
            className={editorHostClass}
            style={editorHostStyle}
            data-orientation={canvasOrientation}
          />
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
            <div className="absolute bottom-2 left-2 max-w-[60%] text-[11px] text-red-600 bg-white/90 border border-red-300 rounded px-2 py-1 shadow-sm">
              {transientError}
            </div>
          )}
          {status === 'ready' && (
            <div className="absolute top-2 right-2 text-xs text-green-600 bg-white/80 px-2 py-1 rounded">
              Ready
            </div>
          )}
          {isViewOnly && !(!isAdmin && !useStackedStudentLayout && latexDisplayState.enabled) && (
            <div className="absolute inset-0 flex items-center justify-center text-xs sm:text-sm text-white text-center px-4 bg-slate-900/40 pointer-events-none">
              {controlOwnerLabel || 'Instructor'} locked the board. You're in view-only mode.
            </div>
          )}
          {!isAdmin && !useStackedStudentLayout && latexDisplayState.enabled && (
            <div className="absolute inset-0 flex items-center justify-center text-center px-4 bg-white/95 backdrop-blur-sm overflow-auto">
              {latexProjectionMarkup ? (
                <div
                  className="text-slate-900 leading-relaxed max-w-3xl"
                  style={latexOverlayStyle}
                  dangerouslySetInnerHTML={{ __html: latexProjectionMarkup }}
                />
              ) : (
                <p className="text-slate-500 text-sm">Waiting for instructor LaTeX…</p>
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
              <div className="canvas-overlay-controls__panel" onClick={event => {
                event.stopPropagation()
                kickOverlayAutoHide()
              }}>
                <p className="canvas-overlay-controls__title">Canvas controls</p>
                {renderToolbarBlock()}
                <button type="button" className="canvas-overlay-controls__dismiss" onClick={closeOverlayControls}>
                  Return to drawing
                </button>
              </div>
            </div>
          )}
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
                title={orientationLockedToLandscape ? 'Portrait view is disabled while the instructor projects fullscreen.' : undefined}
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
              <span className="font-semibold">LaTeX font size</span>
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
              {isSavingLatex ? 'Saving…' : 'Save class LaTeX'}
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
              disabled={!latestSharedLatex}
            >
              Load class save
            </button>
            {latexSaveError && <span className="text-red-600">{latexSaveError}</span>}
          </div>
        )}

        {!isOverlayMode && latexOutput && (
          <div>
            <p className="text-xs font-semibold uppercase text-white mb-1">Latest LaTeX export</p>
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
          {isAdmin && (
            <button
              type="button"
              onClick={toggleBroadcastPause}
              className="canvas-admin-controls__button"
            >
              {isBroadcastPaused ? 'Resume Broadcast' : 'Pause Updates'}
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={controlState && controlState.controllerId === clientId ? unlockStudentEditing : lockStudentEditing}
              className="canvas-admin-controls__button"
              disabled={Boolean(fatalError) || status !== 'ready'}
            >
              {controlState && controlState.controllerId === clientId ? 'Unlock Student Editing' : 'Lock Student Editing'}
            </button>
          )}
          {isAdmin && connectedClients.length > 0 && (
            <select
              className="canvas-admin-controls__select"
              value={selectedClientId}
              onChange={e => setSelectedClientId(e.target.value)}
            >
              <option value="all">All students</option>
              {connectedClients
                .filter(c => c.clientId !== clientId)
                .map(c => (
                  <option key={c.clientId} value={c.clientId}>
                    {c.name || c.clientId}
                  </option>
                ))}
            </select>
          )}
          {controlState && controlState.controllerId !== ALL_STUDENTS_ID && (
            <span className="canvas-settings-panel__hint">
              Student editing locked by {controlOwnerLabel}
            </span>
          )}
          {controlState && controlState.controllerId === ALL_STUDENTS_ID && (
            <span className="canvas-settings-panel__hint">All students may edit the board.</span>
          )}
          <span className="canvas-settings-panel__hint">
            Student publishing is {isStudentPublishEnabled ? 'enabled' : 'disabled'} by the instructor.
          </span>
          {!isRealtimeConnected && (
            <span className="text-xs text-amber-200">Realtime disconnected — updates will be queued</span>
          )}
          </div>
        )}
      </div>
    </div>
  )
}

export default MyScriptMathCanvas
export { MyScriptMathCanvas }
