import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type DiagramStrokePoint = { x: number; y: number }
type DiagramStroke = { id: string; color: string; width: number; points: DiagramStrokePoint[] }
type DiagramAnnotations = { strokes: DiagramStroke[] }

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

const sanitizeIdentifier = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60)

const makeChannelName = (boardId?: string, gradeLabel?: string | null) => {
  const base = boardId
    ? sanitizeIdentifier(boardId).toLowerCase()
    : gradeLabel
      ? `grade-${sanitizeIdentifier(gradeLabel).toLowerCase()}`
      : 'shared'
  return `myscript:${base}`
}

export default function DiagramOverlayModule(props: {
  boardId?: string
  gradeLabel?: string | null
  userId: string
  userDisplayName?: string
  isAdmin: boolean
}) {
  const { boardId, gradeLabel, userId, userDisplayName, isAdmin } = props

  const clientId = useMemo(() => {
    const base = sanitizeIdentifier(userId || 'anonymous')
    const randomSuffix = Math.random().toString(36).slice(2, 8)
    return `${base}-${randomSuffix}`
  }, [userId])

  const channelName = useMemo(() => makeChannelName(boardId, gradeLabel), [boardId, gradeLabel])

  const channelRef = useRef<any>(null)
  const clientIdRef = useRef(clientId)
  useEffect(() => {
    clientIdRef.current = clientId
  }, [clientId])

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

  const activeDiagram = useMemo(() => {
    if (!diagramState.activeDiagramId) return null
    return diagrams.find(d => d.id === diagramState.activeDiagramId) || null
  }, [diagramState.activeDiagramId, diagrams])

  const normalizeAnnotations = (value: any): DiagramAnnotations => {
    const strokes = Array.isArray(value?.strokes) ? value.strokes : []
    return {
      strokes: strokes
        .map((s: any) => ({
          id: typeof s?.id === 'string' ? s.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          color: typeof s?.color === 'string' ? s.color : '#ef4444',
          width: typeof s?.width === 'number' ? s.width : 3,
          points: Array.isArray(s?.points)
            ? s.points
                .map((p: any) => ({ x: typeof p?.x === 'number' ? p.x : 0, y: typeof p?.y === 'number' ? p.y : 0 }))
                .filter((p: any) => Number.isFinite(p.x) && Number.isFinite(p.y))
            : [],
        }))
        .filter((s: any) => s.points.length >= 1),
    }
  }

  const loadFromServer = useCallback(async () => {
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
      nextDiagrams.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id))
      setDiagrams(nextDiagrams)

      const serverState = payload.state
      const nextState: DiagramState = {
        activeDiagramId: typeof serverState?.activeDiagramId === 'string' ? serverState.activeDiagramId : null,
        isOpen: typeof serverState?.isOpen === 'boolean' ? serverState.isOpen : false,
      }
      if (!nextState.activeDiagramId && nextDiagrams.length) nextState.activeDiagramId = nextDiagrams[0].id
      setDiagramState(nextState)
    } catch {
      // ignore
    }
  }, [channelName])

  useEffect(() => {
    if (!userId) return
    void loadFromServer()
  }, [loadFromServer, userId])

  const publish = useCallback(async (message: DiagramRealtimeMessage) => {
    const ch = channelRef.current
    if (!ch) return
    try {
      await ch.publish('diagram', {
        ...message,
        ts: message.ts ?? Date.now(),
        sender: message.sender ?? clientIdRef.current,
      })
    } catch {
      // ignore
    }
  }, [])

  const persistState = useCallback(async (next: DiagramState) => {
    if (!isAdmin) return
    try {
      await fetch('/api/diagrams/state', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionKey: channelName, activeDiagramId: next.activeDiagramId, isOpen: next.isOpen }),
      })
    } catch {
      // ignore
    }
  }, [channelName, isAdmin])

  const setOverlayState = useCallback(async (next: DiagramState) => {
    setDiagramState(next)
    if (!isAdmin) return
    await persistState(next)
    await publish({ kind: 'state', activeDiagramId: next.activeDiagramId, isOpen: next.isOpen })

    // Also broadcast the active diagram record + full annotations so students can render immediately.
    if (next.isOpen && next.activeDiagramId) {
      const diag = diagramsRef.current.find(d => d.id === next.activeDiagramId)
      if (diag) {
        await publish({ kind: 'add', diagram: diag })
        await publish({ kind: 'annotations-set', diagramId: diag.id, annotations: diag.annotations ?? { strokes: [] } })
      }
    }
  }, [isAdmin, persistState, publish])

  // Ably connection (independent from canvas)
  useEffect(() => {
    if (!userId) return

    let disposed = false
    let channel: any = null
    let realtime: any = null

    const setup = async () => {
      try {
        const Ably = await import('ably')
        realtime = new Ably.Realtime.Promise({
          authUrl: `/api/realtime/ably-token?clientId=${encodeURIComponent(clientIdRef.current)}`,
          autoConnect: true,
          closeOnUnload: false,
          transports: ['web_socket', 'xhr_streaming', 'xhr_polling'],
        })

        await new Promise<void>((resolve, reject) => {
          realtime.connection.once('connected', () => resolve())
          realtime.connection.once('failed', (err: any) => reject(err))
        })

        if (disposed) return

        channel = realtime.channels.get(channelName)
        channelRef.current = channel
        await channel.attach()

        const handle = (message: any) => {
          const data = message?.data as DiagramRealtimeMessage
          if (!data || typeof data !== 'object') return
          if ((data as any).sender && (data as any).sender === clientIdRef.current) return

          if (data.kind === 'state') {
            const next: DiagramState = {
              activeDiagramId: typeof data.activeDiagramId === 'string' ? data.activeDiagramId : null,
              isOpen: Boolean(data.isOpen),
            }
            setDiagramState(prev => {
              if (!next.activeDiagramId && prev.activeDiagramId) return { ...prev, isOpen: next.isOpen }
              return next
            })
            if (next.isOpen && next.activeDiagramId) {
              const known = diagramsRef.current.some(d => d.id === next.activeDiagramId)
              if (!known) void loadFromServer()
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
            return
          }

          if (data.kind === 'remove') {
            setDiagrams(prev => prev.filter(d => d.id !== data.diagramId))
            return
          }

          if (data.kind === 'clear') {
            setDiagrams(prev => prev.map(d => (d.id === data.diagramId ? { ...d, annotations: { strokes: [] } } : d)))
            return
          }

          if (data.kind === 'annotations-set') {
            setDiagrams(prev => prev.map(d => (d.id === data.diagramId ? { ...d, annotations: data.annotations ? normalizeAnnotations(data.annotations) : null } : d)))
            return
          }

          if (data.kind === 'stroke-commit') {
            setDiagrams(prev => prev.map(d => {
              if (d.id !== data.diagramId) return d
              const current = d.annotations ? normalizeAnnotations(d.annotations) : { strokes: [] }
              return { ...d, annotations: { strokes: [...current.strokes, data.stroke] } }
            }))
          }
        }

        channel.subscribe('diagram', handle)

        // Presence: on new join, admin pushes current diagram state.
        try {
          await channel.presence.enter({ name: userDisplayName || 'Participant', isAdmin: Boolean(isAdmin) })
          channel.presence.subscribe(async (presenceMsg: any) => {
            if (!isAdmin) return
            if (presenceMsg?.action !== 'enter') return
            const state = diagramStateRef.current
            await publish({ kind: 'state', activeDiagramId: state.activeDiagramId, isOpen: Boolean(state.isOpen) })
            const activeId = state.activeDiagramId
            if (state.isOpen && activeId) {
              const diag = diagramsRef.current.find(d => d.id === activeId)
              if (diag) {
                await publish({ kind: 'add', diagram: diag })
                await publish({ kind: 'annotations-set', diagramId: activeId, annotations: diag.annotations ?? { strokes: [] } })
              }
            }
          })
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    }

    void setup()

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
      } catch {
        // ignore
      }
    }
  }, [channelName, isAdmin, loadFromServer, publish, userDisplayName, userId])

  // Rendering
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const drawingRef = useRef(false)
  const currentStrokeRef = useRef<DiagramStroke | null>(null)

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const host = containerRef.current
    if (!canvas || !host) return

    const rect = host.getBoundingClientRect()
    const w = Math.max(1, Math.floor(rect.width))
    const h = Math.max(1, Math.floor(rect.height))
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)

    const diag = activeDiagram
    if (!diag) return
    const annotations = diag.annotations ? normalizeAnnotations(diag.annotations) : { strokes: [] }

    for (const s of annotations.strokes) {
      const pts = s.points || []
      if (pts.length === 0) continue
      ctx.strokeStyle = s.color
      ctx.lineWidth = Math.max(1, s.width)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(pts[0].x * w, pts[0].y * h)
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x * w, pts[i].y * h)
      }
      ctx.stroke()
    }

    const current = currentStrokeRef.current
    if (current && drawingRef.current) {
      const pts = current.points
      if (pts.length >= 1) {
        ctx.strokeStyle = current.color
        ctx.lineWidth = Math.max(1, current.width)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(pts[0].x * w, pts[0].y * h)
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * w, pts[i].y * h)
        ctx.stroke()
      }
    }
  }, [activeDiagram])

  useEffect(() => {
    redraw()
  }, [redraw, diagrams, diagramState.activeDiagramId, diagramState.isOpen])

  useEffect(() => {
    const host = containerRef.current
    if (!host || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => redraw())
    ro.observe(host)
    return () => ro.disconnect()
  }, [redraw])

  const toPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const host = containerRef.current
    if (!host) return null
    const rect = host.getBoundingClientRect()
    const x = (e.clientX - rect.left) / Math.max(rect.width, 1)
    const y = (e.clientY - rect.top) / Math.max(rect.height, 1)
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
  }

  const onPointerDown = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isAdmin) return
    if (!activeDiagram?.id) return
    if (!diagramState.isOpen) return

    const p = toPoint(e)
    if (!p) return
    drawingRef.current = true
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    currentStrokeRef.current = { id, color: '#ef4444', width: 4, points: [p] }
    redraw()
    try {
      ;(e.target as any).setPointerCapture?.(e.pointerId)
    } catch {}
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isAdmin) return
    if (!drawingRef.current) return
    const p = toPoint(e)
    if (!p) return
    const stroke = currentStrokeRef.current
    if (!stroke) return
    stroke.points.push(p)
    redraw()
  }

  const onPointerUp = async () => {
    if (!isAdmin) return
    if (!activeDiagram?.id) return
    if (!drawingRef.current) return
    drawingRef.current = false
    const stroke = currentStrokeRef.current
    currentStrokeRef.current = null
    if (!stroke || stroke.points.length < 2) {
      redraw()
      return
    }

    const diagramId = activeDiagram.id
    setDiagrams(prev => prev.map(d => {
      if (d.id !== diagramId) return d
      const current = d.annotations ? normalizeAnnotations(d.annotations) : { strokes: [] }
      return { ...d, annotations: { strokes: [...current.strokes, stroke] } }
    }))

    await publish({ kind: 'stroke-commit', diagramId, stroke })
    redraw()
  }

  if (!diagramState.isOpen) {
    if (!isAdmin) return null
    return (
      <div className="fixed top-16 right-4 z-[200]">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setOverlayState({
            activeDiagramId: diagramState.activeDiagramId || (diagrams[0]?.id ?? null),
            isOpen: true,
          })}
          disabled={diagrams.length === 0}
        >
          Show diagram
        </button>
      </div>
    )
  }

  if (!activeDiagram) return null

  return (
    <div className="fixed inset-0 z-[200]" aria-label="Diagram overlay module">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
      <div className="absolute inset-3 sm:inset-6 rounded-xl border border-white/10 bg-white/95 overflow-hidden shadow-sm">
        <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-200 bg-white">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">Diagram</p>
            <p className="text-sm font-semibold truncate">{activeDiagram.title || 'Untitled diagram'}</p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <select
                className="input"
                value={diagramState.activeDiagramId ?? ''}
                onChange={async (e) => {
                  const nextId = e.target.value || null
                  await setOverlayState({ activeDiagramId: nextId, isOpen: true })
                }}
              >
                {diagrams.map(d => (
                  <option key={d.id} value={d.id}>{d.title || 'Untitled diagram'}</option>
                ))}
              </select>
            )}
            {isAdmin && (
              <button
                type="button"
                className="btn"
                onClick={() => setOverlayState({ activeDiagramId: diagramState.activeDiagramId, isOpen: false })}
              >
                Close
              </button>
            )}
          </div>
        </div>

        <div ref={containerRef} className="relative w-full h-[calc(100%-44px)]">
          <img
            ref={imageRef}
            src={activeDiagram.imageUrl}
            alt={activeDiagram.title || 'Diagram'}
            className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
            onLoad={() => redraw()}
          />
          <canvas
            ref={canvasRef}
            className={isAdmin ? 'absolute inset-0 cursor-crosshair' : 'absolute inset-0 pointer-events-none'}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>
      </div>
    </div>
  )
}
