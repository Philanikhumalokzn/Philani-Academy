import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { renderToString } from 'katex'

declare global {
  interface Window {
    iink?: {
      Editor: {
        load: (element: HTMLElement, editorType: string, options?: unknown) => Promise<any>
      }
    }
  }
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

type PresenceClient = {
  clientId: string
  name?: string
  isAdmin?: boolean
}

type BroadcastOptions = {
  force?: boolean
  reason?: 'update' | 'clear'
}

const SCRIPT_ID = 'myscript-iink-ts-loader'
const SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/iink-ts@3.0.2/dist/iink.min.js'
const DEFAULT_BROADCAST_DEBOUNCE_MS = 60
const ALL_STUDENTS_ID = '__all__'

let scriptPromise: Promise<void> | null = null

function loadIinkRuntime(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('MyScript iink runtime can only load in a browser context.'))
  }

  if (window.iink) {
    return Promise.resolve()
  }

  if (scriptPromise) {
    return scriptPromise
  }

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null

    const handleLoad = () => {
      resolve()
    }

    const handleError = () => {
      console.error('Failed to load MyScript iink script')
      reject(new Error('Failed to load the MyScript iink runtime.'))
    }

    if (existing) {
      if (existing.getAttribute('data-loaded') === 'true') {
        resolve()
        return
      }
      existing.addEventListener('load', handleLoad, { once: true })
      existing.addEventListener('error', handleError, { once: true })
      return
    }

    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = SCRIPT_URL
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
    .catch(err => {
      scriptPromise = null
      throw err
    })
    .then(() => {
      scriptPromise = null
    })

  return scriptPromise ?? Promise.resolve()
}

type MyScriptMathCanvasProps = {
  gradeLabel?: string
  roomId: string
  userId: string
  userDisplayName?: string
  isAdmin?: boolean
  boardId?: string // optional logical board identifier; if absent, we'll use a shared/global per grade
}

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

export default function MyScriptMathCanvas({ gradeLabel, roomId, userId, userDisplayName, isAdmin, boardId }: MyScriptMathCanvasProps) {
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
  // Broadcaster role removed: all clients can publish.
  const [connectedClients, setConnectedClients] = useState<Array<PresenceClient>>([])
  const [selectedClientId, setSelectedClientId] = useState<string>('all')
  const [isBroadcastPaused, setIsBroadcastPaused] = useState(false)
  const isBroadcastPausedRef = useRef(false)
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(true)
  const [controlState, setControlState] = useState<ControlState>(null)
  const [latexDisplayState, setLatexDisplayState] = useState<{ enabled: boolean; latex: string }>({ enabled: false, latex: '' })
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
  const latexDisplayStateRef = useRef<{ enabled: boolean; latex: string }>({ enabled: false, latex: '' })
  const forcedConvertDepthRef = useRef(0)

  const clientId = useMemo(() => {
    const base = userId ? sanitizeIdentifier(userId) : 'guest'
    const randomSuffix = Math.random().toString(36).slice(2, 8)
    return `${base}-${randomSuffix}`
  }, [userId])

  useEffect(() => {
    clientIdRef.current = clientId
  }, [clientId])

  useEffect(() => {
    latexDisplayStateRef.current = latexDisplayState
  }, [latexDisplayState])

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

  const broadcastSnapshot = useCallback(
    (immediate = false, options?: BroadcastOptions) => {
      if (!isAdmin) {
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
    [broadcastDebounceMs, collectEditorSnapshot, userDisplayName, isAdmin]
  )

  const publishLatexDisplayState = useCallback(
    async (enabled: boolean, latex: string) => {
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
    publishLatexDisplayState(true, trimmed)
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
    const websocketHost = process.env.NEXT_PUBLIC_MYSCRIPT_SERVER_HOST || 'cloud.myscript.com'

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

        const editor = await window.iink.Editor.load(host, 'INTERACTIVEINKSSR', options)
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
          const canSend = isAdmin && !isBroadcastPausedRef.current && !lockedOutRef.current
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
          const canSend = isAdmin && !isBroadcastPausedRef.current
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
          const data = message?.data as SnapshotMessage
          if (!data || data.clientId === clientIdRef.current) return
          enqueueSnapshot(data, typeof message?.timestamp === 'number' ? message.timestamp : undefined)
        }

        const handleSyncState = (message: any) => {
          const data = message?.data as SnapshotMessage
          if (!data || data.clientId === clientIdRef.current) return
          enqueueSnapshot(data, typeof message?.timestamp === 'number' ? message.timestamp : undefined)
        }

        const handleSyncRequest = async (message: any) => {
          if (!isAdmin) return
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
            action?: 'wipe' | 'convert' | 'force-resync' | 'latex-display'
            targetClientId?: string
            snapshot?: SnapshotPayload | null
            enabled?: boolean
            latex?: string
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
            setLatexDisplayState({ enabled, latex })
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
              // When someone new enters, proactively push current snapshot (any client may respond)
              if (presenceMsg?.action === 'enter' && !isBroadcastPausedRef.current && isAdmin) {
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
    broadcastSnapshot(true, { force: true, reason: 'clear' })
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
    if (isAdmin && !isBroadcastPausedRef.current) {
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
    setLatexDisplayState({ enabled: nextEnabled, latex })
    await publishLatexDisplayState(nextEnabled, latex)
  }

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

  const toggleFullscreen = () => {
    setIsFullscreen(prev => !prev)
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
    try {
      return renderToString(latexDisplayState.latex, {
        throwOnError: false,
        displayMode: true,
      })
    } catch (err) {
      console.warn('Failed to render LaTeX overlay', err)
      return ''
    }
  }, [latexDisplayState.latex])

  return (
    <div>
      <div className="flex flex-col gap-3">
        <div className={`border rounded bg-white relative overflow-hidden ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
          <div
            ref={editorHostRef}
            className={isFullscreen ? 'w-full h-full' : 'w-full h-[24rem]'}
            style={{
              minHeight: isFullscreen ? undefined : '384px',
              pointerEvents: isViewOnly ? 'none' : undefined,
            }}
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
          {isViewOnly && !( !isAdmin && latexDisplayState.enabled) && (
            <div className="absolute inset-0 flex items-center justify-center text-xs sm:text-sm text-white text-center px-4 bg-slate-900/40 pointer-events-none">
              {controlOwnerLabel || 'Instructor'} locked the board. You're in view-only mode.
            </div>
          )}
          {!isAdmin && latexDisplayState.enabled && (
            <div className="absolute inset-0 flex items-center justify-center text-center px-4 bg-white/95 backdrop-blur-sm overflow-auto">
              {latexProjectionMarkup ? (
                <div
                  className="text-slate-900 text-base sm:text-xl leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: latexProjectionMarkup }}
                />
              ) : (
                <p className="text-slate-500 text-sm">Waiting for instructor LaTeX…</p>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="absolute top-2 left-2 text-xs bg-white/80 px-2 py-1 rounded border"
          >
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="btn" type="button" onClick={handleUndo} disabled={!canUndo || status !== 'ready' || Boolean(fatalError) || isViewOnly}>
            Undo
          </button>
          <button className="btn" type="button" onClick={handleRedo} disabled={!canRedo || status !== 'ready' || Boolean(fatalError) || isViewOnly}>
            Redo
          </button>
          <button className="btn" type="button" onClick={handleClear} disabled={!canClear || status !== 'ready' || Boolean(fatalError) || isViewOnly}>
            Clear
          </button>
          <button className="btn btn-primary" type="button" onClick={handleConvert} disabled={status !== 'ready' || Boolean(fatalError) || isViewOnly}>
            {isConverting ? 'Converting…' : 'Convert to LaTeX'}
          </button>
          {isAdmin && (
            <button
              className="btn"
              type="button"
              onClick={forcePublishLatex}
              disabled={status !== 'ready' || Boolean(fatalError) || !latexOutput || latexOutput.trim().length === 0}
            >
              Publish LaTeX to Students
            </button>
          )}
          {isAdmin && (
            <button
              className={`btn ${latexDisplayState.enabled ? 'btn-secondary' : ''}`}
              type="button"
              onClick={toggleLatexProjection}
              disabled={status !== 'ready' || Boolean(fatalError)}
            >
              {latexDisplayState.enabled ? 'Stop LaTeX Display Mode' : 'Project LaTeX onto Student Canvas'}
            </button>
          )}
          {isAdmin && (
            <button
              className="btn"
              type="button"
              onClick={() => forcePublishCanvas(selectedClientId === 'all' ? undefined : selectedClientId)}
              disabled={status !== 'ready' || Boolean(fatalError)}
            >
              Publish Canvas to {selectedClientId === 'all' ? 'All Students' : 'Student'}
            </button>
          )}
          {isAdmin && selectedClientId !== 'all' && (
            <button
              className="btn"
              type="button"
              onClick={() => forceClearStudentCanvas(selectedClientId)}
              disabled={status !== 'ready' || Boolean(fatalError)}
            >
              Wipe Selected Student Canvas
            </button>
          )}
          {isAdmin && (
            <button
              className="btn"
              type="button"
              onClick={allowSelectedClientEditing}
              disabled={status !== 'ready' || Boolean(fatalError)}
            >
              {selectedClientId === 'all' ? 'Allow All Students to Edit' : 'Allow Selected Student to Edit'}
            </button>
          )}
          <button className="btn" type="button" onClick={toggleFullscreen}>
            {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          </button>
        </div>

        {gradeLabel && (
          <p className="text-xs muted">Canvas is scoped to the {gradeLabel} cohort.</p>
        )}

        {latexOutput && (
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500 mb-1">Latest LaTeX export</p>
            <pre className="text-sm bg-slate-100 border rounded p-3 overflow-auto whitespace-pre-wrap">{latexOutput}</pre>
          </div>
        )}
        {process.env.NEXT_PUBLIC_MYSCRIPT_DEBUG === '1' && (
          <div className="text-[10px] mt-2 p-2 rounded border bg-white shadow-sm space-y-1">
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
        <div className="text-xs mt-2">
          {isAdmin && (
            <button
              type="button"
              onClick={toggleBroadcastPause}
              className="px-2 py-1 rounded border text-xs bg-white"
            >
              {isBroadcastPaused ? 'Resume Broadcast' : 'Pause Updates'}
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={controlState && controlState.controllerId === clientId ? unlockStudentEditing : lockStudentEditing}
              className="px-2 py-1 rounded border text-xs bg-white ml-2"
              disabled={Boolean(fatalError) || status !== 'ready'}
            >
              {controlState && controlState.controllerId === clientId ? 'Unlock Student Editing' : 'Lock Student Editing'}
            </button>
          )}
          {isAdmin && connectedClients.length > 0 && (
            <select
              className="ml-2 text-xs border rounded px-2 py-1 bg-white"
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
            <span className="ml-2 text-[10px] text-slate-600 align-middle">
              Student editing locked by {controlOwnerLabel}
            </span>
          )}
          {controlState && controlState.controllerId === ALL_STUDENTS_ID && (
            <span className="ml-2 text-[10px] text-slate-600 align-middle">All students may edit the board.</span>
          )}
          {!isRealtimeConnected && (
            <span className="ml-2 text-[10px] text-orange-600">Realtime disconnected — updates will be queued</span>
          )}
        </div>
      </div>
    </div>
  )
}
