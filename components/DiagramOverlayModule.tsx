import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type DiagramStrokePoint = { x: number; y: number }
type DiagramStroke = { id: string; color: string; width: number; points: DiagramStrokePoint[] }
type DiagramAnnotations = { space?: 'image'; strokes: DiagramStroke[] }

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
    const space = value?.space === 'image' ? 'image' : undefined
    const strokes = Array.isArray(value?.strokes) ? value.strokes : []
    return {
      space,
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
        await publish({ kind: 'annotations-set', diagramId: diag.id, annotations: diag.annotations ?? { space: 'image', strokes: [] } })
      }
    }
  }, [isAdmin, persistState, publish])

  const persistAnnotations = useCallback(async (diagramId: string, annotations: DiagramAnnotations | null) => {
    if (!isAdmin) return
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
            setDiagrams(prev => prev.map(d => (d.id === data.diagramId ? { ...d, annotations: { space: 'image', strokes: [] } } : d)))
            return
          }

          if (data.kind === 'annotations-set') {
            setDiagrams(prev => prev.map(d => (d.id === data.diagramId ? { ...d, annotations: data.annotations ? normalizeAnnotations(data.annotations) : null } : d)))
            return
          }

          if (data.kind === 'stroke-commit') {
            setDiagrams(prev => prev.map(d => {
              if (d.id !== data.diagramId) return d
              const current = d.annotations ? normalizeAnnotations(d.annotations) : { space: 'image', strokes: [] }
              return { ...d, annotations: { space: 'image', strokes: [...current.strokes, data.stroke] } }
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
                await publish({ kind: 'annotations-set', diagramId: activeId, annotations: diag.annotations ?? { space: 'image', strokes: [] } })
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
  const migratedDiagramIdsRef = useRef<Set<string>>(new Set())

  const getContainRect = useCallback((containerW: number, containerH: number) => {
    const img = imageRef.current
    const naturalW = img?.naturalWidth ?? 0
    const naturalH = img?.naturalHeight ?? 0
    if (!naturalW || !naturalH || !Number.isFinite(containerW) || !Number.isFinite(containerH) || containerW <= 0 || containerH <= 0) {
      return { x: 0, y: 0, w: Math.max(1, containerW), h: Math.max(1, containerH) }
    }
    const scale = Math.min(containerW / naturalW, containerH / naturalH)
    const w = naturalW * scale
    const h = naturalH * scale
    const x = (containerW - w) / 2
    const y = (containerH - h) / 2
    return { x, y, w, h }
  }, [])

  const mapClientToImageSpace = useCallback((clientX: number, clientY: number) => {
    const host = containerRef.current
    if (!host) return null
    const rect = host.getBoundingClientRect()
    const containerW = Math.max(1, rect.width)
    const containerH = Math.max(1, rect.height)

    const px = clientX - rect.left
    const py = clientY - rect.top
    const imgRect = getContainRect(containerW, containerH)

    if (px < imgRect.x || py < imgRect.y || px > imgRect.x + imgRect.w || py > imgRect.y + imgRect.h) {
      return null
    }

    const x = (px - imgRect.x) / Math.max(1e-6, imgRect.w)
    const y = (py - imgRect.y) / Math.max(1e-6, imgRect.h)
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
  }, [getContainRect])

  const mapImageToCanvasPx = useCallback((p: DiagramStrokePoint, canvasW: number, canvasH: number) => {
    const imgRect = getContainRect(canvasW, canvasH)
    return {
      x: imgRect.x + p.x * imgRect.w,
      y: imgRect.y + p.y * imgRect.h,
    }
  }, [getContainRect])

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
    const annotations = diag.annotations ? normalizeAnnotations(diag.annotations) : { space: 'image', strokes: [] }

    for (const s of annotations.strokes) {
      const pts = s.points || []
      if (pts.length === 0) continue
      ctx.strokeStyle = s.color
      ctx.lineWidth = Math.max(1, s.width)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      const p0 = mapImageToCanvasPx(pts[0], w, h)
      ctx.moveTo(p0.x, p0.y)
      for (let i = 1; i < pts.length; i++) {
        const pi = mapImageToCanvasPx(pts[i], w, h)
        ctx.lineTo(pi.x, pi.y)
      }
      ctx.stroke()
    }

    const current = currentStrokeRef.current
    if (current) {
      const pts = current.points
      if (pts.length >= 1) {
        ctx.strokeStyle = current.color
        ctx.lineWidth = Math.max(1, current.width)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        const p0 = mapImageToCanvasPx(pts[0], w, h)
        ctx.moveTo(p0.x, p0.y)
        for (let i = 1; i < pts.length; i++) {
          const pi = mapImageToCanvasPx(pts[i], w, h)
          ctx.lineTo(pi.x, pi.y)
        }
        ctx.stroke()
      }
    }
  }, [activeDiagram, mapImageToCanvasPx, normalizeAnnotations])

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

  const toPoint = (e: React.PointerEvent<HTMLCanvasElement>) => mapClientToImageSpace(e.clientX, e.clientY)

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

  const onPointerUp = () => {
    if (!isAdmin) return
    if (!activeDiagram?.id) return
    if (!drawingRef.current) return
    drawingRef.current = false
    const stroke = currentStrokeRef.current
    if (!stroke || stroke.points.length < 2) {
      currentStrokeRef.current = null
      redraw()
      return
    }

    const diagramId = activeDiagram.id
    // Keep the just-finished stroke visible immediately, even if React batching delays
    // the diagram state update until after this handler returns.
    currentStrokeRef.current = stroke
    setDiagrams(prev => prev.map(d => {
      if (d.id !== diagramId) return d
      const current = d.annotations ? normalizeAnnotations(d.annotations) : { space: 'image', strokes: [] }
      return { ...d, annotations: { space: 'image', strokes: [...current.strokes, stroke] } }
    }))

    redraw()
    void publish({ kind: 'stroke-commit', diagramId, stroke })

    // Clear the preview stroke after the next paint.
    try {
      requestAnimationFrame(() => {
        currentStrokeRef.current = null
        redraw()
      })
    } catch {
      currentStrokeRef.current = null
    }
  }

  // Best-effort migration: legacy strokes were stored in container-normalized space (0..1 of host).
  // Convert to image-relative space so portrait/landscape clients render identically.
  useEffect(() => {
    if (!isAdmin) return
    if (!diagramState.isOpen) return
    const diag = activeDiagram
    if (!diag?.id) return
    if (migratedDiagramIdsRef.current.has(diag.id)) return

    const imgEl = imageRef.current
    const host = containerRef.current
    if (!imgEl || !host) return
    if (!imgEl.complete || !imgEl.naturalWidth || !imgEl.naturalHeight) return

    const normalized = diag.annotations ? normalizeAnnotations(diag.annotations) : null
    if (!normalized) {
      migratedDiagramIdsRef.current.add(diag.id)
      return
    }
    if (normalized.space === 'image') {
      migratedDiagramIdsRef.current.add(diag.id)
      return
    }

    const rect = host.getBoundingClientRect()
    const containerW = Math.max(1, rect.width)
    const containerH = Math.max(1, rect.height)
    const imgRect = getContainRect(containerW, containerH)

    const toImg = (p: DiagramStrokePoint) => {
      const stagePxX = p.x * containerW
      const stagePxY = p.y * containerH
      const x = (stagePxX - imgRect.x) / Math.max(1e-6, imgRect.w)
      const y = (stagePxY - imgRect.y) / Math.max(1e-6, imgRect.h)
      return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
    }

    const migrated: DiagramAnnotations = {
      space: 'image',
      strokes: (normalized.strokes || []).map(s => ({
        ...s,
        points: Array.isArray(s.points) ? s.points.map(toImg) : [],
      })),
    }

    migratedDiagramIdsRef.current.add(diag.id)
    setDiagrams(prev => prev.map(d => (d.id === diag.id ? { ...d, annotations: migrated } : d)))
    void persistAnnotations(diag.id, migrated)
    void publish({ kind: 'annotations-set', diagramId: diag.id, annotations: migrated })
  }, [activeDiagram, diagramState.isOpen, getContainRect, isAdmin, normalizeAnnotations, persistAnnotations, publish])

  if (!diagramState.isOpen) {
    if (!isAdmin) return null
    return (
      <div className={isAdmin ? 'absolute top-2 right-2 z-[200]' : 'fixed top-16 right-4 z-[200]'}>
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
    <div className={isAdmin ? 'absolute inset-0 z-[200]' : 'fixed inset-0 z-[200]'} aria-label="Diagram overlay module">
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
