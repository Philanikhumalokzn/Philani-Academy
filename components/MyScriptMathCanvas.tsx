import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
  control?: {
    type: 'set-broadcaster' | 'set-mode'
    broadcasterClientId?: string | null
    bidirectional?: boolean
  }
}

type BroadcastOptions = {
  force?: boolean
  reason?: 'update' | 'clear'
}

const SCRIPT_ID = 'myscript-iink-ts-loader'
const SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/iink-ts@3.0.2/dist/iink.min.js'

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
}

const missingKeyMessage = 'Missing MyScript credentials. Set NEXT_PUBLIC_MYSCRIPT_APPLICATION_KEY and NEXT_PUBLIC_MYSCRIPT_HMAC_KEY.'

const sanitizeIdentifier = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60)

const isSnapshotEmpty = (snapshot: SnapshotPayload | null) => {
  if (!snapshot) return true
  const sym = snapshot.symbols as any
  const symCount = Array.isArray(sym)
    ? sym.length
    : (Array.isArray(sym?.events) ? sym.events.length : 0)
  const hasSymbols = symCount > 0
  const hasLatex = Boolean(snapshot.latex)
  const hasJiix = Boolean(snapshot.jiix)
  return !hasSymbols && !hasLatex && !hasJiix
}

export default function MyScriptMathCanvas({ gradeLabel, roomId, userId, userDisplayName, isAdmin }: MyScriptMathCanvasProps) {
  const editorHostRef = useRef<HTMLDivElement | null>(null)
  const editorInstanceRef = useRef<any>(null)
  const realtimeRef = useRef<any>(null)
  const channelRef = useRef<any>(null)
  const clientIdRef = useRef('')
  const latestSnapshotRef = useRef<SnapshotRecord | null>(null)
  const localVersionRef = useRef(0)
  const appliedVersionRef = useRef(0)
  const lastSymbolCountRef = useRef(0)
  const pendingBroadcastRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingExportRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isApplyingRemoteRef = useRef(false)
  const lastAppliedRemoteVersionRef = useRef(0)
  const suppressBroadcastUntilTsRef = useRef(0)
  const appliedSnapshotIdsRef = useRef<Set<string>>(new Set())
  const [status, setStatus] = useState<CanvasStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [transientError, setTransientError] = useState<string | null>(null)
  const [latexOutput, setLatexOutput] = useState('')
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [canClear, setCanClear] = useState(false)
  const [isConverting, setIsConverting] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [activeBroadcasterClientId, setActiveBroadcasterClientId] = useState<string | null>(null)
  const activeBroadcasterClientIdRef = useRef<string | null>(null)
  const [connectedClients, setConnectedClients] = useState<Array<{ clientId: string; name?: string }>>([])
  const [isBroadcastPaused, setIsBroadcastPaused] = useState(false)
  const isBroadcastPausedRef = useRef(false)
  const [isBidirectionalBroadcast, setIsBidirectionalBroadcast] = useState(false)
  const isBidirectionalBroadcastRef = useRef(false)
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(true)
  const pendingPublishQueueRef = useRef<Array<SnapshotRecord>>([])
  const reconnectAttemptsRef = useRef(0)
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconcileIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clientId = useMemo(() => {
    const base = userId ? sanitizeIdentifier(userId) : 'guest'
    const randomSuffix = Math.random().toString(36).slice(2, 8)
    return `${base}-${randomSuffix}`
  }, [userId])

  useEffect(() => {
    clientIdRef.current = clientId
  }, [clientId])

  const channelName = useMemo(() => {
    const safeRoom = roomId ? sanitizeIdentifier(roomId).toLowerCase() : 'default'
    return `myscript:${safeRoom || 'default'}`
  }, [roomId])

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

  const broadcastSnapshot = useCallback(
    (immediate = false, options?: BroadcastOptions) => {
      if (isApplyingRemoteRef.current) return
      // Gating: allow any client to send when bidirectional is enabled; otherwise only active broadcaster.
      const activeId = activeBroadcasterClientIdRef.current
      const canSendByRole = isBidirectionalBroadcastRef.current || (activeId && activeId === clientIdRef.current)
      if (!canSendByRole) {
        if (!options?.force) return
      }
      // Pause overrides everything except forced clears
      if (isBroadcastPausedRef.current && !options?.force) return
      const channel = channelRef.current
      if (!channel) return
      const reason: 'update' | 'clear' = options?.reason ?? 'update'
      // If disconnected, queue snapshot for later instead of attempting publish now
      if (!isRealtimeConnected) {
        const queuedSnapshot = collectEditorSnapshot(true)
        if (queuedSnapshot) {
          const previousCount = lastSymbolCountRef.current
          const currentCount = queuedSnapshot.symbols ? queuedSnapshot.symbols.length : 0
          const isErase = previousCount > 0 && currentCount === 0
          if (reason === 'clear' || isErase || !isSnapshotEmpty(queuedSnapshot)) {
            pendingPublishQueueRef.current.push({ snapshot: queuedSnapshot, ts: Date.now(), reason })
          }
        }
        return
      }
      const snapshot = collectEditorSnapshot(true)
      if (!snapshot) return
      // Allow broadcasting empty snapshot if it represents an actual erase (previous symbol count > 0)
      const previousCount = lastSymbolCountRef.current
      const currentCount = snapshot.symbols ? snapshot.symbols.length : 0
      const isErase = previousCount > 0 && currentCount === 0
      if (isSnapshotEmpty(snapshot) && !options?.force && !isErase) {
        return
      }

      const record: SnapshotRecord = { snapshot, ts: Date.now(), reason }

      latestSnapshotRef.current = record

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
      }, 180)
    },
    [collectEditorSnapshot, userDisplayName]
  )

  const applySnapshot = useCallback(async (message: SnapshotMessage, receivedTs?: number) => {
    const snapshot = message?.snapshot ?? null
    const reason = message?.reason ?? 'update'
    // Control message handling: update active broadcaster or mode
    if (message.control?.type === 'set-broadcaster') {
      activeBroadcasterClientIdRef.current = message.control.broadcasterClientId ?? null
      setActiveBroadcasterClientId(message.control.broadcasterClientId ?? null)
      return
    }
    if (message.control?.type === 'set-mode') {
      const bidirectional = Boolean(message.control.bidirectional)
      isBidirectionalBroadcastRef.current = bidirectional
      setIsBidirectionalBroadcast(bidirectional)
      return
    }
    if (!snapshot) return
    const incomingSymbolCount = (() => {
      const sym: any = snapshot.symbols as any
      if (Array.isArray(sym)) return sym.length
      if (Array.isArray(sym?.events)) return sym.events.length
      return 0
    })()
    const previousCount = lastSymbolCountRef.current
    // Skip redundant empty updates when both sides already empty.
    if (incomingSymbolCount === 0 && previousCount === 0 && reason !== 'clear') {
      return
    }
    // Idempotency & origin checks
    if (snapshot.snapshotId && appliedSnapshotIdsRef.current.has(snapshot.snapshotId)) return
    if (message.originClientId && message.originClientId === clientIdRef.current) return
    const editor = editorInstanceRef.current
    if (!editor) return
    // Ignore stale versions
    if (snapshot.version <= appliedVersionRef.current) return

    isApplyingRemoteRef.current = true
    try {
      if (reason === 'clear') {
        editor.clear()
        if (typeof editor.waitForIdle === 'function') await editor.waitForIdle()
      } else if (incomingSymbolCount < previousCount) {
        // Remote performed an erase/undo sequence. Rebuild from full snapshot (including empty).
        editor.clear()
        if (incomingSymbolCount > 0 && snapshot.symbols) {
          try {
            if (typeof editor.waitForIdle === 'function') await editor.waitForIdle()
            await editor.importPointEvents(snapshot.symbols)
            if (typeof editor.waitForIdle === 'function') await editor.waitForIdle()
          } catch (e) {
            console.error('Failed to rebuild after shrink', e)
          }
        } else {
          // Fully empty after erase
          setLatexOutput('')
        }
      } else if (snapshot.symbols && incomingSymbolCount > previousCount) {
        // Import only new tail delta
        const all = Array.isArray(snapshot.symbols)
          ? snapshot.symbols
          : (Array.isArray((snapshot.symbols as any)?.events) ? (snapshot.symbols as any).events : [])
        const delta = all.slice(previousCount)
        if (delta.length) {
          try {
            await editor.importPointEvents(delta)
            if (typeof editor.waitForIdle === 'function') await editor.waitForIdle()
          } catch (e) {
            console.warn('Delta import failed; attempting full import', e)
            try {
              editor.clear()
              if (typeof editor.waitForIdle === 'function') await editor.waitForIdle()
              await editor.importPointEvents(all)
              if (typeof editor.waitForIdle === 'function') await editor.waitForIdle()
            } catch (e2) {
              console.error('Full import failed', e2)
            }
          }
        }
      }

      // Tracking
  lastSymbolCountRef.current = incomingSymbolCount
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

      setLatexOutput(snapshot.latex ?? '')
    } catch (err) {
      console.error('Failed to apply remote snapshot', err)
    } finally {
      isApplyingRemoteRef.current = false
      setIsConverting(false)
      latestSnapshotRef.current = { snapshot, ts: Date.now(), reason }
    }
  }, [])

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
      setError(missingKeyMessage)
      return
    }

    setStatus('loading')
    setError(null)

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
          // Only the active broadcaster should increment version and send.
          const canSend = !!activeBroadcasterClientIdRef.current && activeBroadcasterClientIdRef.current === clientIdRef.current && !isBroadcastPausedRef.current
          const snapshot = collectEditorSnapshot(canSend)
          if (!snapshot) return
          if (snapshot.version === lastAppliedRemoteVersionRef.current) return
          // Update local symbol count tracking for accurate delta math for remote peers.
          if (snapshot.symbols) {
            const sym: any = snapshot.symbols as any
            lastSymbolCountRef.current = Array.isArray(sym) ? sym.length : (Array.isArray(sym?.events) ? sym.events.length : 0)
          }
          if (canSend) {
            broadcastSnapshot(false)
          }

          // Debounce a lightweight export request (not convert) so JIIX/LaTeX stay updated without heavy operations.
          if (pendingExportRef.current) {
            clearTimeout(pendingExportRef.current)
            pendingExportRef.current = null
          }
          pendingExportRef.current = setTimeout(() => {
            try {
              if (typeof (editor as any)?.export === 'function') {
                ;(editor as any).export(['application/x-latex', 'application/vnd.myscript.jiix'])
              }
            } catch {}
          }, 300)
        }
        const handleExported = (evt: any) => {
          const exports = evt.detail || {}
          const latex = exports['application/x-latex'] || ''
          setLatexOutput(typeof latex === 'string' ? latex : '')
          setIsConverting(false)
          // On export, only the active broadcaster should send immediately
          const canSend = !!activeBroadcasterClientIdRef.current && activeBroadcasterClientIdRef.current === clientIdRef.current && !isBroadcastPausedRef.current
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
            setError(raw)
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
        setError(err instanceof Error ? err.message : String(err))
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
          if (connected && pendingPublishQueueRef.current.length && channelRef.current) {
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

        const handleStroke = async (message: any) => {
          const data = message?.data as SnapshotMessage
          if (!data || data.clientId === clientIdRef.current) return
          await applySnapshot(data, typeof message?.timestamp === 'number' ? message.timestamp : undefined)
        }

        const handleSyncState = async (message: any) => {
          const data = message?.data as SnapshotMessage
          if (!data || data.clientId === clientIdRef.current) return
          await applySnapshot(data, typeof message?.timestamp === 'number' ? message.timestamp : undefined)
        }

        const handleSyncRequest = async (message: any) => {
          const data = message?.data
          if (!data || data.clientId === clientIdRef.current) return
          const existingRecord = (() => {
            if (latestSnapshotRef.current) {
              return latestSnapshotRef.current
            }
            const freshSnapshot = collectEditorSnapshot(false)
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

        channel.subscribe('stroke', handleStroke)
        channel.subscribe('sync-state', handleSyncState)
        channel.subscribe('sync-request', handleSyncRequest)
        channel.subscribe('control', async (message: any) => {
          const data = message?.data as SnapshotMessage
          if (data?.control?.type === 'set-broadcaster') {
            activeBroadcasterClientIdRef.current = data.control.broadcasterClientId
            setActiveBroadcasterClientId(data.control.broadcasterClientId)
          }
        })

        const snapshot = collectEditorSnapshot(true)
        // Publish initial state if there are existing symbols.
        if (snapshot && snapshot.symbols && snapshot.symbols.length) {
          const record: SnapshotRecord = {
            snapshot,
            ts: Date.now(),
            reason: 'update',
          }
          latestSnapshotRef.current = record
          await channel.publish('stroke', {
            clientId: clientIdRef.current,
            author: userDisplayName,
            snapshot: record.snapshot,
            ts: record.ts,
            reason: record.reason,
          })
        }

        await channel.publish('sync-request', {
          clientId: clientIdRef.current,
          author: userDisplayName,
          ts: Date.now(),
        })

        // Presence tracking
        try {
          await channel.presence.enter({ name: userDisplayName, isAdmin: Boolean(isAdmin) })
          const members = await channel.presence.get()
          setConnectedClients(members.map((m: any) => ({ clientId: m.clientId, name: m.data?.name })))
          // Helper: attempt broadcaster election when needed
          const tryElection = async () => {
            try {
              const list = await channel.presence.get()
              const memberIds: string[] = list.map((m: any) => m.clientId)
              const current = activeBroadcasterClientIdRef.current
              // If bidirectional mode is enabled, skip election; otherwise ensure a broadcaster exists
              if (isBidirectionalBroadcastRef.current) return
              // If current broadcaster is present, do nothing
              if (current && memberIds.includes(current)) return
              // Prefer an admin if present, else lexicographically smallest clientId
              const adminMember = list
                .filter((m: any) => m?.data?.isAdmin)
                .sort((a: any, b: any) => (a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0))[0]
              const candidateId: string | null = adminMember?.clientId || (memberIds.length ? [...memberIds].sort()[0] : null)
              if (!candidateId) return
              // Only self-elect if we are the candidate to avoid setting others without consent
              if (candidateId === clientIdRef.current && current !== candidateId) {
                activeBroadcasterClientIdRef.current = candidateId
                setActiveBroadcasterClientId(candidateId)
                try {
                  await channel.publish('control', {
                    clientId: clientIdRef.current,
                    control: { type: 'set-broadcaster', broadcasterClientId: candidateId },
                    ts: Date.now(),
                  })
                } catch {}
              }
            } catch {}
          }

          channel.presence.subscribe(async (presenceMsg: any) => {
            try {
              const list = await channel.presence.get()
              setConnectedClients(list.map((m: any) => ({ clientId: m.clientId, name: m.data?.name })))
              // Elect a broadcaster if missing or left
              await tryElection()
              // When someone new enters, proactively send a full snapshot if we are the broadcaster
              if (presenceMsg?.action === 'enter' && activeBroadcasterClientIdRef.current === clientIdRef.current) {
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
              }
            } catch {}
          })
          // Initial election after we joined
          await tryElection()
        } catch (e) {
          console.warn('Presence tracking failed', e)
        }

        // Default broadcaster assignment if admin
        if (isAdmin && !activeBroadcasterClientIdRef.current) {
          activeBroadcasterClientIdRef.current = clientIdRef.current
          setActiveBroadcasterClientId(clientIdRef.current)
          try {
            await channel.publish('control', {
              clientId: clientIdRef.current,
              control: { type: 'set-broadcaster', broadcasterClientId: clientIdRef.current },
              ts: Date.now(),
            })
          } catch (e) {
            console.warn('Failed to publish initial broadcaster control', e)
          }
        }

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

        // Periodic reconcile: active broadcaster sends a full snapshot periodically so late joiners catch up
        reconcileIntervalRef.current = setInterval(async () => {
          try {
            if (!channelRef.current) return
            if (!isRealtimeConnected) return
            if (isBroadcastPausedRef.current) return
            if (activeBroadcasterClientIdRef.current !== clientIdRef.current) return
            // Use current latest snapshot if available; collect without increment to avoid version bump
            const rec = latestSnapshotRef.current ?? (() => {
              const snap = collectEditorSnapshot(false)
              return snap ? { snapshot: snap, ts: Date.now(), reason: 'update' as const } : null
            })()
            if (!rec || !rec.snapshot) return
            // If empty, skip
            if (isSnapshotEmpty(rec.snapshot)) return
            await channelRef.current.publish('stroke', {
              clientId: clientIdRef.current,
              author: userDisplayName,
              snapshot: rec.snapshot,
              ts: rec.ts,
              reason: rec.reason,
              originClientId: clientIdRef.current,
            })
          } catch (e) {
            // non-fatal
          }
        }, 8000)
      } catch (err) {
        console.error('Failed to initialise Ably realtime collaboration', err)
        if (!disposed) {
          setError('Realtime collaboration is currently unavailable. Please retry later.')
        }
      }
    }

    setupRealtime()

    return () => {
      disposed = true
      try {
        channelRef.current = null
        if (channel) {
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
      }
    }
  }, [applySnapshot, collectEditorSnapshot, channelName, status, userDisplayName])

  const handleClear = () => {
    if (!editorInstanceRef.current) return
    editorInstanceRef.current.clear()
    setLatexOutput('')
    lastSymbolCountRef.current = 0
    broadcastSnapshot(true, { force: true, reason: 'clear' })
  }

  const handleUndo = () => {
    if (!editorInstanceRef.current) return
    editorInstanceRef.current.undo()
    broadcastSnapshot(false)
  }

  const handleRedo = () => {
    if (!editorInstanceRef.current) return
    editorInstanceRef.current.redo()
    broadcastSnapshot(false)
  }

  const handleConvert = () => {
    if (!editorInstanceRef.current) return
    setIsConverting(true)
    editorInstanceRef.current.convert()
  }

  const handleSetBroadcaster = async (targetClientId: string) => {
    if (!isAdmin) return
    const channel = channelRef.current
    if (!channel) return
    activeBroadcasterClientIdRef.current = targetClientId
    setActiveBroadcasterClientId(targetClientId)
    try {
      await channel.publish('control', {
        clientId: clientIdRef.current,
        control: { type: 'set-broadcaster', broadcasterClientId: targetClientId },
        ts: Date.now(),
      })
    } catch (e) {
      console.warn('Failed to set broadcaster', e)
    }
  }

  const handleToggleSelfBroadcast = async () => {
    const channel = channelRef.current
    if (!channel) return
    const current = activeBroadcasterClientIdRef.current
    const canSelfToggle = Boolean(isAdmin) || !current || current === clientIdRef.current
    if (!canSelfToggle) return
    const nextId = current === clientIdRef.current ? null : clientIdRef.current
    activeBroadcasterClientIdRef.current = nextId
    setActiveBroadcasterClientId(nextId)
    try {
      await channel.publish('control', {
        clientId: clientIdRef.current,
        control: { type: 'set-broadcaster', broadcasterClientId: nextId },
        ts: Date.now(),
      })
    } catch (e) {
      console.warn('Failed to toggle self broadcaster', e)
    }
  }

  const isActiveBroadcaster = isBidirectionalBroadcast || activeBroadcasterClientId === clientIdRef.current

  const toggleBroadcastPause = () => {
    if (!isAdmin) return
    setIsBroadcastPaused(prev => {
      const next = !prev
      isBroadcastPausedRef.current = next
      return next
    })
  }

  const toggleBidirectionalMode = async () => {
    if (!isAdmin) return
    const channel = channelRef.current
    if (!channel) return
    const next = !isBidirectionalBroadcastRef.current
    isBidirectionalBroadcastRef.current = next
    setIsBidirectionalBroadcast(next)
    try {
      await channel.publish('control', {
        clientId: clientIdRef.current,
        control: { type: 'set-mode', bidirectional: next },
        ts: Date.now(),
      })
    } catch (e) {
      console.warn('Failed to toggle bidirectional mode', e)
    }
  }

  const toggleFullscreen = () => {
    setIsFullscreen(prev => !prev)
    // Resize editor after layout change
    try {
      editorInstanceRef.current?.resize?.()
    } catch {}
  }

  return (
    <div>
      <div className="flex flex-col gap-3">
        <div className={`border rounded bg-white relative overflow-hidden ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
          <div
            ref={editorHostRef}
            className={isFullscreen ? 'w-full h-full' : 'w-full h-[24rem]'}
            style={{ minHeight: isFullscreen ? undefined : '384px' }}
          />
          {(status === 'loading' || status === 'idle') && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500 bg-white/70">
              Preparing collaborative canvas…
            </div>
          )}
          {status === 'error' && error && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-red-600 bg-white/80 text-center px-4">
              {error}
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
          <button
            type="button"
            onClick={toggleFullscreen}
            className="absolute top-2 left-2 text-xs bg-white/80 px-2 py-1 rounded border"
          >
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="btn" type="button" onClick={handleUndo} disabled={!canUndo || status !== 'ready' || Boolean(error)}>
            Undo
          </button>
          <button className="btn" type="button" onClick={handleRedo} disabled={!canRedo || status !== 'ready' || Boolean(error)}>
            Redo
          </button>
          <button className="btn" type="button" onClick={handleClear} disabled={!canClear || status !== 'ready' || Boolean(error)}>
            Clear
          </button>
          <button className="btn btn-primary" type="button" onClick={handleConvert} disabled={status !== 'ready' || Boolean(error)}>
            {isConverting ? 'Converting…' : 'Convert to LaTeX'}
          </button>
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
            <div>broadcaster: {activeBroadcasterClientId || '—'}</div>
            <div>isActiveBroadcaster: {isActiveBroadcaster ? 'yes' : 'no'}</div>
            <div>realtimeConnected: {isRealtimeConnected ? 'yes' : 'no'}</div>
            <div>queueLen: {pendingPublishQueueRef.current.length}</div>
            <div>reconnectAttempts: {reconnectAttemptsRef.current}</div>
          </div>
        )}
        <div className="text-xs mt-2">
          <span className="px-2 py-1 rounded border bg-white">Broadcast mode: {isActiveBroadcaster ? 'Active (sending)' : 'Receiving only'}</span>
          {isAdmin && (
            <button
              type="button"
              onClick={toggleBroadcastPause}
              className="ml-2 px-2 py-1 rounded border text-xs bg-white"
            >
              {isBroadcastPaused ? 'Resume Broadcast' : 'Pause Broadcast'}
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={toggleBidirectionalMode}
              className="ml-2 px-2 py-1 rounded border text-xs bg-white"
            >
              {isBidirectionalBroadcast ? 'Disable Bidirectional' : 'Enable Bidirectional'}
            </button>
          )}
          {isAdmin && isBroadcastPaused && (
            <span className="ml-2 text-[10px] text-red-600">Paused: no strokes sent</span>
          )}
          {!isRealtimeConnected && (
            <span className="ml-2 text-[10px] text-orange-600">Realtime disconnected — updates will be queued and sent on reconnect</span>
          )}
          {(isAdmin || !activeBroadcasterClientId || activeBroadcasterClientId === clientIdRef.current) && !error && (
            <button
              type="button"
              onClick={handleToggleSelfBroadcast}
              className="ml-2 px-2 py-1 rounded border text-xs bg-white"
            >
              {isActiveBroadcaster ? 'Stop Broadcasting' : 'Become Broadcaster'}
            </button>
          )}
        </div>
        {isAdmin && (
          <div className="mt-3 p-2 border rounded bg-white">
            <p className="text-xs font-semibold mb-2">Select Active Broadcaster</p>
            <div className="flex flex-wrap gap-2">
              {connectedClients.map(c => (
                <button
                  key={c.clientId}
                  type="button"
                  onClick={() => handleSetBroadcaster(c.clientId)}
                  className={`text-xs px-2 py-1 rounded border ${c.clientId === activeBroadcasterClientId ? 'bg-green-100 border-green-500' : 'bg-white'}`}
                >
                  {(c.name || c.clientId)}{c.clientId === clientIdRef.current ? ' (you)' : ''}
                </button>
              ))}
              {connectedClients.length === 0 && <span className="text-xs text-slate-500">No other clients connected.</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
