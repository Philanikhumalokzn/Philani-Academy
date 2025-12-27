import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const IMAGE_SPACE = 'image' as const

type DiagramStrokePoint = { x: number; y: number }
type DiagramStroke = { id: string; color: string; width: number; points: DiagramStrokePoint[]; z?: number; locked?: boolean }
type DiagramArrow = { id: string; color: string; width: number; start: DiagramStrokePoint; end: DiagramStrokePoint; headSize?: number; z?: number; locked?: boolean }
type DiagramAnnotations = { space?: 'image'; strokes: DiagramStroke[]; arrows?: DiagramArrow[] }

type DiagramTool = 'select' | 'pen' | 'arrow' | 'eraser'
type DiagramSelection = { kind: 'stroke' | 'arrow'; id: string } | null

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

type ScriptDiagramEventDetail = {
  title?: string | null
  open?: boolean
}

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
  lessonAuthoring?: { phaseKey: string; pointId: string }
  autoOpen?: boolean
  autoPromptUpload?: boolean
}) {
  const { boardId, gradeLabel, userId, userDisplayName, isAdmin, lessonAuthoring, autoOpen, autoPromptUpload } = props

  const LESSON_AUTHORING_STORAGE_KEY = 'philani:lesson-authoring:draft-v2'
  const isLessonAuthoring = Boolean(lessonAuthoring?.phaseKey && lessonAuthoring?.pointId)
  const didAutoOpenInAuthoringRef = useRef(false)

  const saveDiagramIntoLessonDraft = useCallback(() => {
    if (!isLessonAuthoring) return false
    if (typeof window === 'undefined') return false
    const active = (() => {
      const state = diagramStateRef.current
      if (!state?.activeDiagramId) return null
      return diagramsRef.current.find(d => d.id === state.activeDiagramId) || null
    })()
    if (!active?.title || !active?.imageUrl) return false
    try {
      const raw = window.localStorage.getItem(LESSON_AUTHORING_STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      const draft = parsed?.draft
      if (!draft || typeof draft !== 'object') return false

      const phaseKey = String(lessonAuthoring!.phaseKey)
      const pointId = String(lessonAuthoring!.pointId)
      const phasePoints = Array.isArray((draft as any)[phaseKey]) ? (draft as any)[phaseKey] : null
      if (!phasePoints) return false

      const snapshot = { title: active.title, imageUrl: active.imageUrl, annotations: active.annotations ?? null }
      const nextPhasePoints = phasePoints.map((p: any) => (String(p?.id) === pointId ? { ...p, diagramSnapshot: snapshot } : p))
      const next = { ...(draft as any), [phaseKey]: nextPhasePoints }
      window.localStorage.setItem(LESSON_AUTHORING_STORAGE_KEY, JSON.stringify({ updatedAt: Date.now(), draft: next }))
      return true
    } catch {
      return false
    }
  }, [isLessonAuthoring, lessonAuthoring])

  const [mobileTrayOpen, setMobileTrayOpen] = useState(false)
  const [mobileTrayBottomOffsetPx, setMobileTrayBottomOffsetPx] = useState(0)
  const [mobileTrayReservePx, setMobileTrayReservePx] = useState(28)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const mobileTrayBottomCss = useMemo(
    () => `calc(env(safe-area-inset-bottom) + ${mobileTrayBottomOffsetPx}px + ${mobileTrayReservePx}px)`,
    [mobileTrayBottomOffsetPx, mobileTrayReservePx]
  )

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

  useEffect(() => {
    if (!isLessonAuthoring) return
    if (!diagramState.isOpen) return
    if (!diagramState.activeDiagramId) return
    if (!activeDiagram) return
    // Keep authoring UX identical: no special buttons. Just auto-save the current diagram snapshot.
    saveDiagramIntoLessonDraft()
  }, [
    activeDiagram?.annotations,
    activeDiagram?.imageUrl,
    activeDiagram?.title,
    diagramState.activeDiagramId,
    diagramState.isOpen,
    isLessonAuthoring,
    saveDiagramIntoLessonDraft,
  ])

  const normalizeAnnotations = (value: any): DiagramAnnotations => {
    const space = value?.space === 'image' ? 'image' : undefined
    const strokes = Array.isArray(value?.strokes) ? value.strokes : []
    const arrows = Array.isArray(value?.arrows) ? value.arrows : []
    return {
      space,
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

  const requestUpload = useCallback(() => {
    if (!isAdmin) return
    setUploadError(null)
    fileInputRef.current?.click()
  }, [isAdmin])

  const didAutoPromptUploadRef = useRef(false)
  useEffect(() => {
    if (!autoPromptUpload) return
    if (!autoOpen) return
    if (!isAdmin) return
    if (didAutoPromptUploadRef.current) return
    if (uploading) return
    if (diagrams.length > 0) return
    if (!diagramState.isOpen) return
    if (typeof window === 'undefined') return

    // Best-effort: browsers may block file dialogs that aren't a direct user gesture.
    didAutoPromptUploadRef.current = true
    const t = window.setTimeout(() => {
      try {
        requestUpload()
      } catch {}
    }, 50)
    return () => window.clearTimeout(t)
  }, [autoOpen, autoPromptUpload, diagramState.isOpen, diagrams.length, isAdmin, requestUpload, uploading])

  const uploadAndCreateDiagram = useCallback(
    async (file: File, title?: string) => {
      if (!isAdmin) return
      if (!channelName) return
      setUploadError(null)
      setUploading(true)
      try {
        const form = new FormData()
        form.append('file', file)
        form.append('sessionKey', channelName)

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
          body: JSON.stringify({
            sessionKey: channelName,
            imageUrl: url,
            title: title || file.name,
          }),
        })

        if (!createRes.ok) {
          const msg = await createRes.text().catch(() => '')
          throw new Error(msg || `Create failed (${createRes.status})`)
        }

        await loadFromServer()
        setMobileTrayOpen(false)

        if (isLessonAuthoring) {
          try {
            saveDiagramIntoLessonDraft()
          } catch {}
        }
      } finally {
        setUploading(false)
      }
    },
    [channelName, isAdmin, isLessonAuthoring, loadFromServer, saveDiagramIntoLessonDraft]
  )

  const onFilePicked = useCallback(
    async (e: any) => {
      const file = e?.target?.files?.[0] as File | undefined
      if (e?.target) e.target.value = ''
      if (!file) return

      const title = (typeof window !== 'undefined' ? window.prompt('Diagram title?', file.name) : null) ?? undefined
      try {
        await uploadAndCreateDiagram(file, title)
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Upload failed')
      }
    },
    [uploadAndCreateDiagram]
  )

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
        await publish({ kind: 'annotations-set', diagramId: diag.id, annotations: diag.annotations ?? { space: IMAGE_SPACE, strokes: [], arrows: [] } })
      }
    }
  }, [isAdmin, persistState, publish])

  const didAutoOpenExplicitRef = useRef(false)
  useEffect(() => {
    if (!autoOpen) return
    if (!isAdmin) return
    if (didAutoOpenExplicitRef.current) return
    didAutoOpenExplicitRef.current = true
    void setOverlayState({ ...diagramStateRef.current, isOpen: true })
  }, [autoOpen, isAdmin, setOverlayState])

  useEffect(() => {
    if (!isLessonAuthoring) return
    if (didAutoOpenInAuthoringRef.current) return
    if (typeof window !== 'undefined' && window.innerWidth < 768) return
    didAutoOpenInAuthoringRef.current = true

    // When coming from the dashboard's "Open diagram module" button, the board page can dispatch
    // events before this module is mounted. Auto-open here to avoid landing on a blank canvas.
    void setOverlayState({ ...diagramStateRef.current, isOpen: true })
  }, [isLessonAuthoring, setOverlayState])

  // Pop the tray over the middle separator: raise z-index, and position higher (about 50% up from the bottom, but still above the bottom bar).
  const trayPopOverSeparatorCss = useMemo(
    () => ({
      left: 0,
      right: 0,
      position: 'fixed',
      zIndex: 600, // higher than separator and scrollbars
      bottom: `calc(50vh - 44px)`, // 44px = approx separator + icon row height
      pointerEvents: 'auto',
    }),
    []
  )
  const mobileDiagramTray = isAdmin && mobileTrayOpen ? (
    <div
      className="md:hidden"
      style={trayPopOverSeparatorCss as any}
      onClick={e => {
        if (e.target === e.currentTarget) setMobileTrayOpen(false)
      }}
    >
      <div
        className="mx-3 mb-2 bg-white border border-slate-200 rounded-lg shadow-lg px-2 py-2"
        onClick={e => e.stopPropagation()}
      >
        <input ref={fileInputRef} type="file" accept="image/*" onChange={onFilePicked} style={{ display: 'none' }} />

        <div className="flex gap-2 overflow-x-auto">
          <button
            type="button"
            className="shrink-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            disabled={uploading}
            onClick={requestUpload}
            title="Upload a new diagram"
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>

          {diagrams.length === 0 ? (
            <div className="text-[11px] text-slate-500 px-2 py-2">No diagrams yet.</div>
          ) : (
            diagrams.map(d => (
              <button
                key={d.id}
                type="button"
                className={`shrink-0 w-28 rounded-md border px-2 py-2 text-left ${diagramState.activeDiagramId === d.id ? 'border-slate-400 bg-slate-50' : 'border-slate-200 bg-white'}`}
                onClick={() => {
                  setMobileTrayOpen(false)
                  void setOverlayState({ activeDiagramId: d.id, isOpen: true })
                }}
              >
                <div className="w-full h-14 rounded bg-slate-100 overflow-hidden">
                  {d.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.imageUrl} alt={d.title || 'Diagram'} className="w-full h-full object-cover" />
                  ) : null}
                </div>
                <div className="mt-1 text-[11px] text-slate-700 truncate">{d.title || 'Diagram'}</div>
              </button>
            ))
          )}
        </div>

        {uploadError ? <div className="mt-2 text-[11px] text-red-600 px-1">{uploadError}</div> : null}
      </div>
    </div>
  ) : null

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handler = (event: Event) => {
      const detail = (event as CustomEvent)?.detail as any
      if (detail && typeof detail === 'object') {
        if (typeof detail.bottomOffsetPx === 'number' && Number.isFinite(detail.bottomOffsetPx)) {
          setMobileTrayBottomOffsetPx(Math.max(0, Math.round(detail.bottomOffsetPx)))
        }
        if (typeof detail.reservePx === 'number' && Number.isFinite(detail.reservePx)) {
          setMobileTrayReservePx(Math.max(0, Math.round(detail.reservePx)))
        }
      }
      setMobileTrayOpen(prev => !prev)
    }

    window.addEventListener('philani-diagrams:toggle-tray', handler as any)
    return () => {
      window.removeEventListener('philani-diagrams:toggle-tray', handler as any)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handler = (event: Event) => {
      if (!isAdmin) return
      const detail = (event as CustomEvent)?.detail as ScriptDiagramEventDetail
      const wantsOpen = typeof detail?.open === 'boolean' ? detail.open : true
      const title = typeof detail?.title === 'string' ? detail.title.trim() : ''

      if (!wantsOpen) {
        void setOverlayState({ ...diagramStateRef.current, isOpen: false })
        return
      }

      if (!title) {
        void setOverlayState({ ...diagramStateRef.current, isOpen: true })
        return
      }

      const match = diagramsRef.current.find(d => (d.title || '').trim().toLowerCase() === title.toLowerCase())
      if (!match) {
        // If not found, at least open whatever is currently active.
        void setOverlayState({ ...diagramStateRef.current, isOpen: true })
        return
      }

      void setOverlayState({ activeDiagramId: match.id, isOpen: true })
    }

    window.addEventListener('philani-diagrams:script-apply', handler as any)
    return () => window.removeEventListener('philani-diagrams:script-apply', handler as any)
  }, [isAdmin, setOverlayState])

  useEffect(() => {
    if (diagramState.isOpen) {
      setMobileTrayOpen(false)
    }
  }, [diagramState.isOpen])

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
            setDiagrams(prev => prev.map(d => (d.id === data.diagramId ? { ...d, annotations: { space: 'image', strokes: [], arrows: [] } } : d)))
            return
          }

          if (data.kind === 'annotations-set') {
            setDiagrams(prev => prev.map(d => (d.id === data.diagramId ? { ...d, annotations: data.annotations ? normalizeAnnotations(data.annotations) : null } : d)))
            return
          }

          if (data.kind === 'stroke-commit') {
            setDiagrams(prev => prev.map(d => {
              if (d.id !== data.diagramId) return d
              const current = d.annotations ? normalizeAnnotations(d.annotations) : { space: 'image', strokes: [], arrows: [] }
              return { ...d, annotations: { space: 'image', strokes: [...current.strokes, data.stroke], arrows: current.arrows || [] } }
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
                await publish({ kind: 'annotations-set', diagramId: activeId, annotations: diag.annotations ?? { space: IMAGE_SPACE, strokes: [], arrows: [] } })
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
  const currentArrowRef = useRef<DiagramArrow | null>(null)
  const previewRef = useRef<null | { diagramId: string; annotations: DiagramAnnotations | null }>(null)
  const migratedDiagramIdsRef = useRef<Set<string>>(new Set())

  const [tool, setTool] = useState<DiagramTool>('pen')
  const [selection, setSelection] = useState<DiagramSelection>(null)
  const selectionRef = useRef<DiagramSelection>(null)
  useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  const clipboardRef = useRef<null | { kind: 'stroke' | 'arrow'; data: DiagramStroke | DiagramArrow }>(null)
  const [contextMenu, setContextMenu] = useState<null | { x: number; y: number; diagramId: string; selection: DiagramSelection; point: DiagramStrokePoint | null }>(null)

  const dragRef = useRef<null | {
    diagramId: string
    selection: NonNullable<DiagramSelection>
    mode: 'move' | 'scale'
    handle?: 'nw' | 'ne' | 'sw' | 'se'
    startPoint: DiagramStrokePoint
    baseAnnotations: DiagramAnnotations
    anchor?: DiagramStrokePoint
    baseCorner?: DiagramStrokePoint
  }>(null)

  const eraseThrottleRef = useRef<{ lastTs: number; lastKey: string } | null>(null)

  const cloneAnnotations = useCallback((ann: DiagramAnnotations | null | undefined): DiagramAnnotations => {
    const normalized = ann ? normalizeAnnotations(ann) : { space: IMAGE_SPACE, strokes: [], arrows: [] }
    return {
      space: IMAGE_SPACE,
      strokes: (normalized.strokes || []).map(s => ({
        id: String(s.id),
        color: typeof s.color === 'string' ? s.color : '#ef4444',
        width: typeof s.width === 'number' ? s.width : 3,
        z: typeof (s as any)?.z === 'number' && Number.isFinite((s as any).z) ? (s as any).z : undefined,
        locked: Boolean((s as any)?.locked),
        points: Array.isArray(s.points) ? s.points.map(p => ({ x: Number(p.x), y: Number(p.y) })) : [],
      })),
      arrows: (normalized.arrows || []).map(a => ({
        id: String(a.id),
        color: typeof a.color === 'string' ? a.color : '#ef4444',
        width: typeof a.width === 'number' ? a.width : 3,
        headSize: typeof a.headSize === 'number' ? a.headSize : 12,
        z: typeof (a as any)?.z === 'number' && Number.isFinite((a as any).z) ? (a as any).z : undefined,
        locked: Boolean((a as any)?.locked),
        start: { x: Number(a.start?.x ?? 0), y: Number(a.start?.y ?? 0) },
        end: { x: Number(a.end?.x ?? 0), y: Number(a.end?.y ?? 0) },
      })),
    }
  }, [normalizeAnnotations])

  const undoRef = useRef<DiagramAnnotations[]>([])
  const redoRef = useRef<DiagramAnnotations[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const activeHistoryDiagramIdRef = useRef<string | null>(null)

  const syncHistoryFlags = useCallback(() => {
    setCanUndo(undoRef.current.length > 0)
    setCanRedo(redoRef.current.length > 0)
  }, [])

  useEffect(() => {
    const id = activeDiagram?.id ?? null
    if (activeHistoryDiagramIdRef.current !== id) {
      activeHistoryDiagramIdRef.current = id
      undoRef.current = []
      redoRef.current = []
      syncHistoryFlags()
    }
  }, [activeDiagram?.id, syncHistoryFlags])

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

  const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

  const pointDistanceSq = (a: DiagramStrokePoint, b: DiagramStrokePoint) => {
    const dx = a.x - b.x
    const dy = a.y - b.y
    return dx * dx + dy * dy
  }

  const distancePointToSegmentSq = (p: DiagramStrokePoint, a: DiagramStrokePoint, b: DiagramStrokePoint) => {
    const abx = b.x - a.x
    const aby = b.y - a.y
    const apx = p.x - a.x
    const apy = p.y - a.y
    const abLenSq = abx * abx + aby * aby
    if (abLenSq <= 1e-12) return pointDistanceSq(p, a)
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq))
    const proj = { x: a.x + t * abx, y: a.y + t * aby }
    return pointDistanceSq(p, proj)
  }

  const annotationsForRender = useCallback((diagramId: string) => {
    const preview = previewRef.current
    if (preview && preview.diagramId === diagramId) {
      return preview.annotations ? normalizeAnnotations(preview.annotations) : { space: IMAGE_SPACE, strokes: [], arrows: [] }
    }
    const d = diagramsRef.current.find(x => x.id === diagramId)
    return d?.annotations ? normalizeAnnotations(d.annotations) : { space: IMAGE_SPACE, strokes: [], arrows: [] }
  }, [normalizeAnnotations])

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

  const selectionBboxFromAnnotations = (ann: DiagramAnnotations, sel: NonNullable<DiagramSelection>) => {
    if (sel.kind === 'stroke') {
      const stroke = (ann.strokes || []).find(s => s.id === sel.id)
      if (!stroke) return null
      return bboxFromStroke(stroke)
    }
    const arrows = ann.arrows || []
    const arrow = arrows.find(a => a.id === sel.id)
    if (!arrow) return null
    return bboxFromArrow(arrow)
  }

  const isSelectionLockedInAnnotations = (ann: DiagramAnnotations, sel: NonNullable<DiagramSelection>) => {
    if (sel.kind === 'stroke') {
      const stroke = (ann.strokes || []).find(s => s.id === sel.id)
      return Boolean((stroke as any)?.locked)
    }
    const arrow = (ann.arrows || []).find(a => a.id === sel.id)
    return Boolean((arrow as any)?.locked)
  }

  const getMaxZ = (ann: DiagramAnnotations) => {
    let max = 0
    for (const s of ann.strokes || []) {
      if (typeof (s as any)?.z === 'number' && Number.isFinite((s as any).z)) max = Math.max(max, (s as any).z)
    }
    for (const a of ann.arrows || []) {
      if (typeof (a as any)?.z === 'number' && Number.isFinite((a as any).z)) max = Math.max(max, (a as any).z)
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
    for (const a of ann.arrows || []) {
      if (typeof (a as any)?.z === 'number' && Number.isFinite((a as any).z)) {
        min = hasAny ? Math.min(min, (a as any).z) : (a as any).z
        hasAny = true
      }
    }
    return hasAny ? min : 0
  }

  const hitTestHandle = (point: DiagramStrokePoint, bbox: { minX: number; minY: number; maxX: number; maxY: number }, stageWidth: number, stageHeight: number) => {
    const corners = bboxCornerPoints(bbox)
    const rPx = 10
    const rx = rPx / Math.max(stageWidth, 1)
    const ry = rPx / Math.max(stageHeight, 1)
    const rSq = Math.max(rx * rx, ry * ry)
    for (const key of Object.keys(corners) as Array<keyof typeof corners>) {
      const c = corners[key]
      const dSq = pointDistanceSq(point, c)
      if (dSq <= rSq) return key as 'nw' | 'ne' | 'sw' | 'se'
    }
    return null
  }

  const hitTestAnnotation = useCallback((diagramId: string, point: DiagramStrokePoint): NonNullable<DiagramSelection> | null => {
    const ann = annotationsForRender(diagramId)
    const strokes = ann.strokes || []
    const arrows = ann.arrows || []

    const threshold = 0.02
    const thresholdSq = threshold * threshold

    let best: { kind: 'stroke' | 'arrow'; id: string; distSq: number; z: number } | null = null

    const zOf = (sel: { kind: 'stroke' | 'arrow'; id: string }) => {
      if (sel.kind === 'stroke') {
        const s = strokes.find(x => x.id === sel.id)
        return typeof (s as any)?.z === 'number' && Number.isFinite((s as any).z) ? (s as any).z : 0
      }
      const a = arrows.find(x => x.id === sel.id)
      return typeof (a as any)?.z === 'number' && Number.isFinite((a as any).z) ? (a as any).z : 0
    }

    for (const s of strokes) {
      const pts = s.points || []
      if (pts.length === 1) {
        const dSq = pointDistanceSq(point, pts[0])
        if (dSq <= thresholdSq) {
          const cand = { kind: 'stroke' as const, id: s.id }
          const z = zOf(cand)
          if (!best || z > best.z || (z === best.z && dSq < best.distSq)) best = { kind: 'stroke', id: s.id, distSq: dSq, z }
        }
        continue
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const dSq = distancePointToSegmentSq(point, pts[i], pts[i + 1])
        if (dSq <= thresholdSq) {
          const cand = { kind: 'stroke' as const, id: s.id }
          const z = zOf(cand)
          if (!best || z > best.z || (z === best.z && dSq < best.distSq)) best = { kind: 'stroke', id: s.id, distSq: dSq, z }
        }
      }
    }

    for (const a of arrows) {
      const dSq = distancePointToSegmentSq(point, a.start, a.end)
      if (dSq <= thresholdSq) {
        const cand = { kind: 'arrow' as const, id: a.id }
        const z = zOf(cand)
        if (!best || z > best.z || (z === best.z && dSq < best.distSq)) best = { kind: 'arrow', id: a.id, distSq: dSq, z }
      }
    }

    return best ? ({ kind: best.kind, id: best.id } as NonNullable<DiagramSelection>) : null
  }, [annotationsForRender])

  const applyMoveToAnnotations = (base: DiagramAnnotations, sel: NonNullable<DiagramSelection>, dx: number, dy: number) => {
    const next = cloneAnnotations(base)
    if (sel.kind === 'stroke') {
      next.strokes = (next.strokes || []).map(s => {
        if (s.id !== sel.id) return s
        return { ...s, points: (s.points || []).map(p => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) })) }
      })
      return next
    }
    next.arrows = (next.arrows || []).map(a => {
      if (a.id !== sel.id) return a
      return { ...a, start: { x: clamp01(a.start.x + dx), y: clamp01(a.start.y + dy) }, end: { x: clamp01(a.end.x + dx), y: clamp01(a.end.y + dy) } }
    })
    return next
  }

  const applyScaleToAnnotations = (base: DiagramAnnotations, sel: NonNullable<DiagramSelection>, anchor: DiagramStrokePoint, baseCorner: DiagramStrokePoint, currCorner: DiagramStrokePoint) => {
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

    const next = cloneAnnotations(base)
    const scalePoint = (p: DiagramStrokePoint) => ({ x: clamp01(anchor.x + (p.x - anchor.x) * sx), y: clamp01(anchor.y + (p.y - anchor.y) * sy) })

    if (sel.kind === 'stroke') {
      next.strokes = (next.strokes || []).map(s => (s.id === sel.id ? { ...s, points: (s.points || []).map(scalePoint) } : s))
      return next
    }
    next.arrows = (next.arrows || []).map(a => (a.id === sel.id ? { ...a, start: scalePoint(a.start), end: scalePoint(a.end) } : a))
    return next
  }

  const deleteSelectionFromAnnotations = (base: DiagramAnnotations, sel: NonNullable<DiagramSelection>) => {
    const next = cloneAnnotations(base)
    if (sel.kind === 'stroke') {
      next.strokes = (next.strokes || []).filter(s => s.id !== sel.id)
      return next
    }
    next.arrows = (next.arrows || []).filter(a => a.id !== sel.id)
    return next
  }

  const setSelectionZInAnnotations = (base: DiagramAnnotations, sel: NonNullable<DiagramSelection>, z: number) => {
    const next = cloneAnnotations(base)
    if (sel.kind === 'stroke') {
      next.strokes = (next.strokes || []).map(s => (s.id === sel.id ? { ...s, z } : s))
      return next
    }
    next.arrows = (next.arrows || []).map(a => (a.id === sel.id ? { ...a, z } : a))
    return next
  }

  const setSelectionStyleInAnnotations = (base: DiagramAnnotations, sel: NonNullable<DiagramSelection>, patch: Partial<{ color: string; width: number; locked: boolean }>) => {
    const next = cloneAnnotations(base)
    if (sel.kind === 'stroke') {
      next.strokes = (next.strokes || []).map(s => {
        if (s.id !== sel.id) return s
        return {
          ...s,
          ...(typeof patch.color === 'string' ? { color: patch.color } : null),
          ...(typeof patch.width === 'number' ? { width: patch.width } : null),
          ...(typeof patch.locked === 'boolean' ? { locked: patch.locked } : null),
        }
      })
      return next
    }
    next.arrows = (next.arrows || []).map(a => {
      if (a.id !== sel.id) return a
      return {
        ...a,
        ...(typeof patch.color === 'string' ? { color: patch.color } : null),
        ...(typeof patch.width === 'number' ? { width: patch.width } : null),
        ...(typeof patch.locked === 'boolean' ? { locked: patch.locked } : null),
      }
    })
    return next
  }

  const duplicateSelectionInAnnotations = (base: DiagramAnnotations, sel: NonNullable<DiagramSelection>, dx = 0.02, dy = 0.02) => {
    const next = cloneAnnotations(base)
    const newId = `${clientIdRef.current}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const maxZ = getMaxZ(base)

    if (sel.kind === 'stroke') {
      const stroke = (base.strokes || []).find(s => s.id === sel.id)
      if (!stroke) return next
      const copy: DiagramStroke = {
        ...cloneAnnotations({ space: 'image', strokes: [stroke], arrows: [] }).strokes[0],
        id: newId,
        locked: false,
        z: maxZ + 1,
        points: (stroke.points || []).map(p => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) })),
      }
      next.strokes = [...(next.strokes || []), copy]
      return next
    }

    const arrow = (base.arrows || []).find(a => a.id === sel.id)
    if (!arrow) return next
    const copy: DiagramArrow = {
      ...cloneAnnotations({ space: 'image', strokes: [], arrows: [arrow] }).arrows![0],
      id: newId,
      locked: false,
      z: maxZ + 1,
      start: { x: clamp01(arrow.start.x + dx), y: clamp01(arrow.start.y + dy) },
      end: { x: clamp01(arrow.end.x + dx), y: clamp01(arrow.end.y + dy) },
    }
    next.arrows = [...(next.arrows || []), copy]
    return next
  }

  const applySnapOrSmooth = (base: DiagramAnnotations, sel: NonNullable<DiagramSelection>) => {
    if (sel.kind === 'arrow') {
      const next = cloneAnnotations(base)
      next.arrows = (next.arrows || []).map(a => {
        if (a.id !== sel.id) return a
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
        return { ...a, start: { x: clamp01(midX - ux * half), y: clamp01(midY - uy * half) }, end: { x: clamp01(midX + ux * half), y: clamp01(midY + uy * half) } }
      })
      return next
    }

    const next = cloneAnnotations(base)
    next.strokes = (next.strokes || []).map(s => {
      if (s.id !== sel.id) return s
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

    const annotations = annotationsForRender(diag.id)
    const strokes = annotations.strokes || []
    const arrows = annotations.arrows || []

    const drawArrow = (arrow: DiagramArrow) => {
      const start = arrow.start
      const end = arrow.end
      const sx = mapImageToCanvasPx(start, w, h).x
      const sy = mapImageToCanvasPx(start, w, h).y
      const ex = mapImageToCanvasPx(end, w, h).x
      const ey = mapImageToCanvasPx(end, w, h).y
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
    arrows.forEach((a, i) => {
      const z = typeof (a as any)?.z === 'number' && Number.isFinite((a as any).z) ? (a as any).z : i
      items.push({ kind: 'arrow', z, arrow: a })
    })
    strokes.forEach((s, i) => {
      const z = typeof (s as any)?.z === 'number' && Number.isFinite((s as any).z) ? (s as any).z : 1000 + i
      items.push({ kind: 'stroke', z, stroke: s })
    })
    items.sort((a, b) => a.z - b.z)
    for (const item of items) {
      if (item.kind === 'arrow') {
        drawArrow(item.arrow)
        continue
      }
      const s = item.stroke
      const pts = s.points || []
      if (!pts.length) continue
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
    if (current && current.points.length >= 1) {
      const pts = current.points
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

    const currArrow = currentArrowRef.current
    if (currArrow) {
      drawArrow(currArrow)
    }

    const sel = selectionRef.current
    if (sel) {
      const bbox = selectionBboxFromAnnotations(annotations, sel)
      if (bbox) {
        const imgRect = getContainRect(w, h)
        const pad = 0.008
        const minX = Math.max(0, bbox.minX - pad)
        const minY = Math.max(0, bbox.minY - pad)
        const maxX = Math.min(1, bbox.maxX + pad)
        const maxY = Math.min(1, bbox.maxY + pad)
        const p0 = mapImageToCanvasPx({ x: minX, y: minY }, w, h)
        const p1 = mapImageToCanvasPx({ x: maxX, y: maxY }, w, h)
        const x = p0.x
        const y = p0.y
        const ww = Math.max(1, p1.x - p0.x)
        const hh = Math.max(1, p1.y - p0.y)

        ctx.save()
        ctx.strokeStyle = 'rgba(15,23,42,0.85)'
        ctx.lineWidth = 1
        ctx.setLineDash([6, 4])
        ctx.strokeRect(x, y, ww, hh)
        ctx.setLineDash([])

        const corners = bboxCornerPoints({ minX, minY, maxX, maxY })
        const r = 6
        for (const key of Object.keys(corners) as Array<keyof typeof corners>) {
          const c = corners[key]
          const cp = mapImageToCanvasPx(c, w, h)
          // only draw handles if they are within the contain rect (safety)
          if (cp.x < imgRect.x - 4 || cp.y < imgRect.y - 4 || cp.x > imgRect.x + imgRect.w + 4 || cp.y > imgRect.y + imgRect.h + 4) continue
          ctx.fillStyle = '#ffffff'
          ctx.strokeStyle = 'rgba(15,23,42,0.85)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(cp.x, cp.y, r, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
        }
        ctx.restore()
      }
    }
  }, [activeDiagram, annotationsForRender, getContainRect, mapImageToCanvasPx, normalizeAnnotations])

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

  const applyAnnotations = useCallback((diagramId: string, annotations: DiagramAnnotations) => {
    previewRef.current = null
    setDiagrams(prev => prev.map(d => (d.id === diagramId ? { ...d, annotations } : d)))
    void persistAnnotations(diagramId, annotations)
    void publish({ kind: 'annotations-set', diagramId, annotations })
    redraw()
  }, [persistAnnotations, publish, redraw])

  const pushUndoSnapshot = useCallback((diagramId: string) => {
    try {
      const diag = diagramsRef.current.find(d => d.id === diagramId)
      const before = cloneAnnotations(diag?.annotations ?? null)
      undoRef.current.push(before)
      redoRef.current = []
      syncHistoryFlags()
    } catch {
      // ignore
    }
  }, [cloneAnnotations, syncHistoryFlags])

  const eraseAt = useCallback(async (diagramId: string, point: DiagramStrokePoint) => {
    const diag = diagramsRef.current.find(d => d.id === diagramId)
    const before = diag?.annotations ? normalizeAnnotations(diag.annotations) : { space: IMAGE_SPACE, strokes: [], arrows: [] }
    const strokes = before.strokes || []
    const arrows = before.arrows || []

    const threshold = 0.018
    const thresholdSq = threshold * threshold
    let best: { kind: 'stroke' | 'arrow'; id: string; distSq: number } | null = null

    for (const s of strokes) {
      const pts = s.points || []
      if (pts.length === 1) {
        const dSq = pointDistanceSq(point, pts[0])
        if (dSq <= thresholdSq && (!best || dSq < best.distSq)) best = { kind: 'stroke', id: s.id, distSq: dSq }
        continue
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const dSq = distancePointToSegmentSq(point, pts[i], pts[i + 1])
        if (dSq <= thresholdSq && (!best || dSq < best.distSq)) best = { kind: 'stroke', id: s.id, distSq: dSq }
      }
    }

    for (const a of arrows) {
      const dSq = distancePointToSegmentSq(point, a.start, a.end)
      if (dSq <= thresholdSq && (!best || dSq < best.distSq)) best = { kind: 'arrow', id: a.id, distSq: dSq }
    }
    if (!best) return

    if (best.kind === 'stroke') {
      const s = strokes.find(x => x.id === best!.id)
      if (Boolean((s as any)?.locked)) return
    } else {
      const a = arrows.find(x => x.id === best!.id)
      if (Boolean((a as any)?.locked)) return
    }

    const next: DiagramAnnotations = {
      space: IMAGE_SPACE,
      strokes: best.kind === 'stroke' ? strokes.filter(s => s.id !== best!.id) : strokes,
      arrows: best.kind === 'arrow' ? arrows.filter(a => a.id !== best!.id) : arrows,
    }
    pushUndoSnapshot(diagramId)
    setSelection(null)
    applyAnnotations(diagramId, next)
  }, [applyAnnotations, normalizeAnnotations, pushUndoSnapshot])

  const onPointerDown = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isAdmin) return
    if (!activeDiagram?.id) return
    if (!diagramState.isOpen) return
    setContextMenu(null)

    const diagramId = activeDiagram.id
    const p = toPoint(e)
    if (!p) return

    // Selection tool
    if (tool === 'select') {
      const hit = hitTestAnnotation(diagramId, p)
      setSelection(hit)
      if (!hit) {
        previewRef.current = null
        dragRef.current = null
        redraw()
        return
      }
      const ann = annotationsForRender(diagramId)
      if (isSelectionLockedInAnnotations(ann, hit)) {
        dragRef.current = null
        redraw()
        return
      }
      const host = containerRef.current
      if (!host) return
      const rect = host.getBoundingClientRect()
      const imgRect = getContainRect(Math.max(1, rect.width), Math.max(1, rect.height))
      const bbox = selectionBboxFromAnnotations(ann, hit)
      if (!bbox) return
      const handle = hitTestHandle(p, bbox, imgRect.w, imgRect.h)
      if (handle) {
        const corners = bboxCornerPoints(bbox)
        const anchorCorner = corners[oppositeHandle(handle)]
        dragRef.current = {
          diagramId,
          selection: hit,
          mode: 'scale',
          handle,
          startPoint: p,
          baseAnnotations: cloneAnnotations(ann),
          anchor: anchorCorner,
          baseCorner: corners[handle],
        }
      } else {
        dragRef.current = {
          diagramId,
          selection: hit,
          mode: 'move',
          startPoint: p,
          baseAnnotations: cloneAnnotations(ann),
        }
      }
      redraw()
      try {
        ;(e.target as any).setPointerCapture?.(e.pointerId)
      } catch {}
      return
    }

    // Eraser tool
    if (tool === 'eraser') {
      drawingRef.current = true
      await eraseAt(diagramId, p)
      try {
        ;(e.target as any).setPointerCapture?.(e.pointerId)
      } catch {}
      return
    }

    // Arrow tool
    if (tool === 'arrow') {
      drawingRef.current = true
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      currentArrowRef.current = { id, color: '#ef4444', width: 4, headSize: 12, start: p, end: p }
      redraw()
      try {
        ;(e.target as any).setPointerCapture?.(e.pointerId)
      } catch {}
      return
    }

    // Pen tool
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
    const diagramId = activeDiagram?.id
    if (!diagramId) return

    const p = toPoint(e)
    if (!p) return

    const drag = dragRef.current
    if (drag && drag.diagramId === diagramId) {
      const dx = p.x - drag.startPoint.x
      const dy = p.y - drag.startPoint.y
      const base = drag.baseAnnotations
      let next: DiagramAnnotations | null = null
      if (drag.mode === 'move') {
        next = applyMoveToAnnotations(base, drag.selection, dx, dy)
      } else if (drag.mode === 'scale' && drag.anchor && drag.baseCorner) {
        const currCorner = { x: drag.baseCorner.x + dx, y: drag.baseCorner.y + dy }
        next = applyScaleToAnnotations(base, drag.selection, drag.anchor, drag.baseCorner, currCorner)
      }
      if (next) {
        previewRef.current = { diagramId, annotations: next }
        redraw()
      }
      return
    }

    if (!drawingRef.current) return

    if (tool === 'eraser') {
      const now = Date.now()
      const key = `${Math.round(p.x * 1000)}:${Math.round(p.y * 1000)}`
      const last = eraseThrottleRef.current
      if (last && now - last.lastTs < 40 && last.lastKey === key) return
      eraseThrottleRef.current = { lastTs: now, lastKey: key }
      void eraseAt(diagramId, p)
      return
    }

    if (tool === 'arrow') {
      const arrow = currentArrowRef.current
      if (!arrow) return
      arrow.end = p
      redraw()
      return
    }

    const stroke = currentStrokeRef.current
    if (!stroke) return
    stroke.points.push(p)
    redraw()
  }

  const onPointerUp = () => {
    if (!isAdmin) return
    const diagramId = activeDiagram?.id
    if (!diagramId) return

    const drag = dragRef.current
    if (drag && drag.diagramId === diagramId) {
      dragRef.current = null
      const preview = previewRef.current
      if (preview && preview.diagramId === diagramId && preview.annotations) {
        pushUndoSnapshot(diagramId)
        applyAnnotations(diagramId, { ...normalizeAnnotations(preview.annotations), space: IMAGE_SPACE })
      }
      previewRef.current = null
      redraw()
      return
    }

    if (!drawingRef.current) return
    drawingRef.current = false

    const arrow = currentArrowRef.current
    if (tool === 'arrow' && arrow) {
      currentArrowRef.current = null
      const diag = diagramsRef.current.find(d => d.id === diagramId)
      const before = diag?.annotations ? normalizeAnnotations(diag.annotations) : { space: IMAGE_SPACE, strokes: [], arrows: [] }
      const maxZ = getMaxZ(before)
      const next: DiagramAnnotations = {
        space: IMAGE_SPACE,
        strokes: before.strokes || [],
        arrows: [...(before.arrows || []), { ...arrow, locked: false, z: maxZ + 1 }],
      }
      pushUndoSnapshot(diagramId)
      setDiagrams(prev => prev.map(d => (d.id === diagramId ? { ...d, annotations: next } : d)))
      redraw()
      void persistAnnotations(diagramId, next)
      void publish({ kind: 'annotations-set', diagramId, annotations: next })
      return
    }

    const stroke = currentStrokeRef.current
    if (tool === 'pen' && stroke) {
      if (stroke.points.length < 2) {
        currentStrokeRef.current = null
        redraw()
        return
      }
      currentStrokeRef.current = null
      const diag = diagramsRef.current.find(d => d.id === diagramId)
      const before = diag?.annotations ? normalizeAnnotations(diag.annotations) : { space: IMAGE_SPACE, strokes: [], arrows: [] }
      const maxZ = getMaxZ(before)
      const next: DiagramAnnotations = {
        space: IMAGE_SPACE,
        strokes: [...(before.strokes || []), { ...stroke, locked: false, z: maxZ + 1 }],
        arrows: before.arrows || [],
      }
      pushUndoSnapshot(diagramId)
      setDiagrams(prev => prev.map(d => (d.id === diagramId ? { ...d, annotations: next } : d)))
      redraw()
      void persistAnnotations(diagramId, next)
      void publish({ kind: 'annotations-set', diagramId, annotations: next })
      return
    }

    currentStrokeRef.current = null
    currentArrowRef.current = null
    redraw()
  }

  const handleUndo = useCallback(() => {
    if (!isAdmin) return
    if (!activeDiagram?.id) return
    const diagramId = activeDiagram.id
    const prev = undoRef.current.pop() || null
    if (!prev) {
      syncHistoryFlags()
      return
    }
    const diag = diagramsRef.current.find(d => d.id === diagramId)
    const current = cloneAnnotations(diag?.annotations ?? null)
    redoRef.current.push(current)
    syncHistoryFlags()
    applyAnnotations(diagramId, { space: IMAGE_SPACE, strokes: prev.strokes || [], arrows: prev.arrows || [] })
  }, [activeDiagram?.id, applyAnnotations, cloneAnnotations, isAdmin, syncHistoryFlags])

  const handleRedo = useCallback(() => {
    if (!isAdmin) return
    if (!activeDiagram?.id) return
    const diagramId = activeDiagram.id
    const next = redoRef.current.pop() || null
    if (!next) {
      syncHistoryFlags()
      return
    }
    const diag = diagramsRef.current.find(d => d.id === diagramId)
    const current = cloneAnnotations(diag?.annotations ?? null)
    undoRef.current.push(current)
    syncHistoryFlags()
    applyAnnotations(diagramId, { space: IMAGE_SPACE, strokes: next.strokes || [], arrows: next.arrows || [] })
  }, [activeDiagram?.id, applyAnnotations, cloneAnnotations, isAdmin, syncHistoryFlags])

  const handleClearInk = useCallback(() => {
    if (!isAdmin) return
    if (!activeDiagram?.id) return
    const diagramId = activeDiagram.id
    const diag = diagramsRef.current.find(d => d.id === diagramId)
    const before = cloneAnnotations(diag?.annotations ?? null)
    undoRef.current.push(before)
    redoRef.current = []
    syncHistoryFlags()
    applyAnnotations(diagramId, { space: IMAGE_SPACE, strokes: [], arrows: [] })
  }, [activeDiagram?.id, applyAnnotations, cloneAnnotations, isAdmin, syncHistoryFlags])

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
      space: IMAGE_SPACE,
      strokes: (normalized.strokes || []).map(s => ({
        ...s,
        points: Array.isArray(s.points) ? s.points.map(toImg) : [],
      })),
      arrows: (normalized.arrows || []).map(a => ({
        ...a,
        start: toImg(a.start),
        end: toImg(a.end),
      })),
    }

    migratedDiagramIdsRef.current.add(diag.id)
    setDiagrams(prev => prev.map(d => (d.id === diag.id ? { ...d, annotations: migrated } : d)))
    void persistAnnotations(diag.id, migrated)
    void publish({ kind: 'annotations-set', diagramId: diag.id, annotations: migrated })
  }, [activeDiagram, diagramState.isOpen, getContainRect, isAdmin, normalizeAnnotations, persistAnnotations, publish])

  const handlePasteAtPoint = useCallback((diagramId: string, point: DiagramStrokePoint) => {
    const clip = clipboardRef.current
    if (!clip) return
    const diag = diagramsRef.current.find(d => d.id === diagramId)
    const before = diag?.annotations ? normalizeAnnotations(diag.annotations) : { space: IMAGE_SPACE, strokes: [], arrows: [] }
    const base = cloneAnnotations(before)
    const maxZ = getMaxZ(base)
    const newId = `${clientIdRef.current}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    if (clip.kind === 'stroke') {
      const stroke = clip.data as DiagramStroke
      const bbox = bboxFromStroke(stroke)
      const cx = (bbox.minX + bbox.maxX) / 2
      const cy = (bbox.minY + bbox.maxY) / 2
      const dx = point.x - cx
      const dy = point.y - cy
      const copy: DiagramStroke = {
        ...cloneAnnotations({ space: IMAGE_SPACE, strokes: [stroke], arrows: [] }).strokes[0],
        id: newId,
        locked: false,
        z: maxZ + 1,
        points: (stroke.points || []).map(pt => ({ x: clamp01(pt.x + dx), y: clamp01(pt.y + dy) })),
      }
      base.strokes = [...(base.strokes || []), copy]
      pushUndoSnapshot(diagramId)
      setSelection({ kind: 'stroke', id: newId })
      applyAnnotations(diagramId, base)
      return
    }

    const arrow = clip.data as DiagramArrow
    const bbox = bboxFromArrow(arrow)
    const cx = (bbox.minX + bbox.maxX) / 2
    const cy = (bbox.minY + bbox.maxY) / 2
    const dx = point.x - cx
    const dy = point.y - cy
    const copy: DiagramArrow = {
      ...cloneAnnotations({ space: IMAGE_SPACE, strokes: [], arrows: [arrow] }).arrows![0],
      id: newId,
      locked: false,
      z: maxZ + 1,
      start: { x: clamp01(arrow.start.x + dx), y: clamp01(arrow.start.y + dy) },
      end: { x: clamp01(arrow.end.x + dx), y: clamp01(arrow.end.y + dy) },
    }
    base.arrows = [...(base.arrows || []), copy]
    pushUndoSnapshot(diagramId)
    setSelection({ kind: 'arrow', id: newId })
    applyAnnotations(diagramId, base)
  }, [applyAnnotations, cloneAnnotations, normalizeAnnotations, pushUndoSnapshot])

  const applyContextAction = useCallback(async (action: string, diagramId: string, sel: NonNullable<DiagramSelection>) => {
    const diag = diagramsRef.current.find(d => d.id === diagramId)
    const before = diag?.annotations ? normalizeAnnotations(diag.annotations) : { space: IMAGE_SPACE, strokes: [], arrows: [] }

    if (action === 'copy') {
      if (sel.kind === 'stroke') {
        const stroke = (before.strokes || []).find(s => s.id === sel.id)
        if (stroke) clipboardRef.current = { kind: 'stroke', data: cloneAnnotations({ space: 'image', strokes: [stroke], arrows: [] }).strokes[0] }
      } else {
        const arrow = (before.arrows || []).find(a => a.id === sel.id)
        if (arrow) clipboardRef.current = { kind: 'arrow', data: cloneAnnotations({ space: 'image', strokes: [], arrows: [arrow] }).arrows![0] }
      }
      setContextMenu(null)
      return
    }

    if (action === 'delete') {
      const next = deleteSelectionFromAnnotations(before, sel)
      pushUndoSnapshot(diagramId)
      setContextMenu(null)
      setSelection(null)
      applyAnnotations(diagramId, next)
      return
    }

    if (action === 'duplicate') {
      const next = duplicateSelectionInAnnotations(before, sel)
      pushUndoSnapshot(diagramId)
      setContextMenu(null)
      applyAnnotations(diagramId, next)
      return
    }

    if (action === 'bring-front') {
      const next = setSelectionZInAnnotations(before, sel, getMaxZ(before) + 1)
      pushUndoSnapshot(diagramId)
      setContextMenu(null)
      applyAnnotations(diagramId, next)
      return
    }
    if (action === 'send-back') {
      const next = setSelectionZInAnnotations(before, sel, getMinZ(before) - 1)
      pushUndoSnapshot(diagramId)
      setContextMenu(null)
      applyAnnotations(diagramId, next)
      return
    }

    if (action === 'lock' || action === 'unlock') {
      const next = setSelectionStyleInAnnotations(before, sel, { locked: action === 'lock' })
      pushUndoSnapshot(diagramId)
      setContextMenu(null)
      applyAnnotations(diagramId, next)
      return
    }

    if (action.startsWith('set-color:')) {
      const color = action.slice('set-color:'.length)
      const next = setSelectionStyleInAnnotations(before, sel, { color })
      pushUndoSnapshot(diagramId)
      setContextMenu(null)
      applyAnnotations(diagramId, next)
      return
    }

    if (action.startsWith('set-width:')) {
      const width = Number(action.slice('set-width:'.length))
      if (!Number.isFinite(width)) {
        setContextMenu(null)
        return
      }
      const next = setSelectionStyleInAnnotations(before, sel, { width })
      pushUndoSnapshot(diagramId)
      setContextMenu(null)
      applyAnnotations(diagramId, next)
      return
    }

    if (action === 'snap-smooth') {
      if (isSelectionLockedInAnnotations(before, sel)) {
        setContextMenu(null)
        return
      }
      const next = applySnapOrSmooth(before, sel)
      pushUndoSnapshot(diagramId)
      setContextMenu(null)
      applyAnnotations(diagramId, next)
      return
    }

    if (isSelectionLockedInAnnotations(before, sel)) {
      setContextMenu(null)
      return
    }

    const bbox = selectionBboxFromAnnotations(before, sel)
    if (!bbox) {
      setContextMenu(null)
      return
    }
    const cx = (bbox.minX + bbox.maxX) / 2
    const cy = (bbox.minY + bbox.maxY) / 2
    if (action !== 'flip-h' && action !== 'flip-v' && action !== 'rotate') {
      setContextMenu(null)
      return
    }

    const mapPoint = (p: DiagramStrokePoint) => {
      if (action === 'flip-h') return { x: clamp01(cx - (p.x - cx)), y: clamp01(p.y) }
      if (action === 'flip-v') return { x: clamp01(p.x), y: clamp01(cy - (p.y - cy)) }
      // rotate 90° clockwise around center
      const dx = p.x - cx
      const dy = p.y - cy
      return { x: clamp01(cx + dy), y: clamp01(cy - dx) }
    }

    const next = cloneAnnotations(before)
    if (sel.kind === 'stroke') {
      next.strokes = (next.strokes || []).map(s => (s.id === sel.id ? { ...s, points: (s.points || []).map(mapPoint) } : s))
    } else {
      next.arrows = (next.arrows || []).map(a => (a.id === sel.id ? { ...a, start: mapPoint(a.start), end: mapPoint(a.end) } : a))
    }
    pushUndoSnapshot(diagramId)
    setContextMenu(null)
    applyAnnotations(diagramId, next)
  }, [applyAnnotations, applySnapOrSmooth, cloneAnnotations, deleteSelectionFromAnnotations, duplicateSelectionInAnnotations, getMaxZ, getMinZ, isSelectionLockedInAnnotations, normalizeAnnotations, pushUndoSnapshot, setSelectionStyleInAnnotations, setSelectionZInAnnotations])

  const selectionIsLocked = (() => {
    if (!diagramState.isOpen) return false
    if (!activeDiagram) return false
    if (!selection) return false
    const ann = activeDiagram.annotations ? normalizeAnnotations(activeDiagram.annotations) : { space: IMAGE_SPACE, strokes: [], arrows: [] }
    return isSelectionLockedInAnnotations(ann, selection)
  })()

  return (
    <>
      {mobileDiagramTray}
      {diagramState.isOpen && !activeDiagram ? (
        <div className={isAdmin ? 'absolute inset-0 z-[200]' : 'fixed inset-0 z-[200]'} aria-label="Diagram overlay module">
          <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
          <div className="absolute inset-3 sm:inset-6 rounded-xl border border-white/10 bg-white/95 overflow-hidden shadow-sm text-slate-900">
            <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-200 bg-white">
              <div className="min-w-0">
                <p className="text-xs text-slate-500">Diagram</p>
                <p className="text-sm font-semibold truncate">No diagrams yet</p>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <button type="button" className="btn" disabled={uploading} onClick={requestUpload}>
                    {uploading ? 'Uploading…' : 'Upload'}
                  </button>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      void setOverlayState({ activeDiagramId: diagramState.activeDiagramId, isOpen: false })
                    }}
                  >
                    Close
                  </button>
                )}
              </div>
            </div>
            <div className="p-4">
              <p className="text-sm text-slate-700">Upload an image to start a diagram.</p>
              {uploadError ? <p className="mt-2 text-sm text-red-600">{uploadError}</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      {diagramState.isOpen && activeDiagram ? (
        <div className={isAdmin ? 'absolute inset-0 z-[200]' : 'fixed inset-0 z-[200]'} aria-label="Diagram overlay module">
          <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
          <div className="absolute inset-3 sm:inset-6 rounded-xl border border-white/10 bg-white/95 overflow-hidden shadow-sm text-slate-900">
        <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-200 bg-white">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">Diagram</p>
            <p className="text-sm font-semibold truncate">{activeDiagram.title || 'Untitled diagram'}</p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button type="button" className="btn" disabled={uploading} onClick={requestUpload}>
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            )}
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
                onClick={() => {
                  void setOverlayState({ activeDiagramId: diagramState.activeDiagramId, isOpen: false })
                }}
              >
                Close
              </button>
            )}
          </div>
        </div>

        <div
          ref={containerRef}
          className="relative w-full h-[calc(100%-44px)]"
          onMouseDown={() => setContextMenu(null)}
        >
          {isAdmin && (
            <div className="absolute bottom-2 left-2 z-40 pointer-events-none">
              <div className="pointer-events-auto inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 py-1 shadow-sm">
                <button
                  type="button"
                  className={tool === 'select'
                    ? 'p-2 rounded-md border border-slate-200 bg-slate-100 text-slate-900'
                    : 'p-2 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }
                  onClick={() => setTool('select')}
                  aria-label="Select"
                  title="Select"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 3l7 18 2-8 8-2L3 3z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={tool === 'pen'
                    ? 'p-2 rounded-md border border-slate-200 bg-slate-100 text-slate-900'
                    : 'p-2 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }
                  onClick={() => setTool('pen')}
                  aria-label="Pen"
                  title="Pen"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={tool === 'arrow'
                    ? 'p-2 rounded-md border border-slate-200 bg-slate-100 text-slate-900'
                    : 'p-2 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }
                  onClick={() => setTool('arrow')}
                  aria-label="Arrow"
                  title="Arrow"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 19L19 5" />
                    <path d="M9 5h10v10" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={tool === 'eraser'
                    ? 'p-2 rounded-md border border-slate-200 bg-slate-100 text-slate-900'
                    : 'p-2 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }
                  onClick={() => setTool('eraser')}
                  aria-label="Eraser"
                  title="Eraser"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 20H9" />
                    <path d="M3 14l7-7 8 8-7 7H6l-3-3z" />
                  </svg>
                </button>
                <div className="w-px h-6 bg-slate-200 mx-1" aria-hidden="true" />
                <button
                  type="button"
                  className="p-2 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  onClick={() => selection && void applyContextAction('flip-h', activeDiagram.id, selection)}
                  disabled={!selection || selectionIsLocked}
                  aria-label="Flip horizontal"
                  title="Flip horizontal"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 3v18" />
                    <path d="M5 7l6 5-6 5V7z" />
                    <path d="M19 7l-6 5 6 5V7z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="p-2 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  onClick={() => selection && void applyContextAction('flip-v', activeDiagram.id, selection)}
                  disabled={!selection || selectionIsLocked}
                  aria-label="Flip vertical"
                  title="Flip vertical"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 12h18" />
                    <path d="M7 5l5 6 5-6H7z" />
                    <path d="M7 19l5-6 5 6H7z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="p-2 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  onClick={() => selection && void applyContextAction('rotate', activeDiagram.id, selection)}
                  disabled={!selection || selectionIsLocked}
                  aria-label="Rotate"
                  title="Rotate 90°"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-3-6.7" />
                    <path d="M21 3v6h-6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="p-2 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  onClick={handleUndo}
                  disabled={!canUndo}
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
                  onClick={handleRedo}
                  disabled={!canRedo}
                  aria-label="Redo"
                  title="Redo"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M15 6l4 4-4 4" />
                    <path d="M4 20a8 8 0 0 1 8-8h7" />
                  </svg>
                </button>
                <div className="w-px h-6 bg-slate-200 mx-1" aria-hidden="true" />
                <button
                  type="button"
                  className="p-2 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  onClick={handleClearInk}
                  aria-label="Clear ink"
                  title="Clear ink"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 20H9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L10 16l-4 0-2-2 0-4L16.5 3.5z" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {isAdmin && contextMenu && (
            <div
              className="absolute z-50"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
            >
              <div className="min-w-[200px] rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden text-slate-900">
                {contextMenu.selection && (
                  <>
                    <button type="button" className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-50" onClick={() => void applyContextAction('copy', contextMenu.diagramId, contextMenu.selection!)}>
                      Copy
                    </button>
                    <button type="button" className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-50" onClick={() => void applyContextAction('duplicate', contextMenu.diagramId, contextMenu.selection!)}>
                      Duplicate
                    </button>
                    <button type="button" className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-50" onClick={() => void applyContextAction('delete', contextMenu.diagramId, contextMenu.selection!)}>
                      Delete
                    </button>
                    <div className="h-px bg-slate-200" />
                    <button type="button" className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-50" onClick={() => void applyContextAction('bring-front', contextMenu.diagramId, contextMenu.selection!)}>
                      Bring to front
                    </button>
                    <button type="button" className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-50" onClick={() => void applyContextAction('send-back', contextMenu.diagramId, contextMenu.selection!)}>
                      Send to back
                    </button>
                    <div className="h-px bg-slate-200" />
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-50"
                      onClick={() => void applyContextAction(isSelectionLockedInAnnotations(normalizeAnnotations(diagramsRef.current.find(d => d.id === contextMenu.diagramId)?.annotations ?? null), contextMenu.selection!) ? 'unlock' : 'lock', contextMenu.diagramId, contextMenu.selection!)}
                    >
                      Toggle lock
                    </button>
                    <button type="button" className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-50" onClick={() => void applyContextAction('snap-smooth', contextMenu.diagramId, contextMenu.selection!)}>
                      Snap / smooth
                    </button>
                    <div className="h-px bg-slate-200" />
                    <button type="button" className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-50" onClick={() => void applyContextAction('flip-h', contextMenu.diagramId, contextMenu.selection!)}>
                      Flip horizontal
                    </button>
                    <button type="button" className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-50" onClick={() => void applyContextAction('flip-v', contextMenu.diagramId, contextMenu.selection!)}>
                      Flip vertical
                    </button>
                    <button type="button" className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-50" onClick={() => void applyContextAction('rotate', contextMenu.diagramId, contextMenu.selection!)}>
                      Rotate 90°
                    </button>
                    <div className="h-px bg-slate-200" />
                    <div className="px-3 py-2 text-xs text-slate-500">Color</div>
                    <div className="flex items-center gap-2 px-3 pb-2">
                      {['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#111827'].map(c => (
                        <button
                          key={c}
                          type="button"
                          className="w-5 h-5 rounded-full border border-slate-200"
                          style={{ backgroundColor: c }}
                          onClick={() => void applyContextAction(`set-color:${c}`, contextMenu.diagramId, contextMenu.selection!)}
                          aria-label={`Set color ${c}`}
                          title={`Set color ${c}`}
                        />
                      ))}
                    </div>
                    <div className="px-3 py-2 text-xs text-slate-500">Width</div>
                    <div className="flex items-center gap-2 px-3 pb-3">
                      {[2, 4, 6, 10].map(w => (
                        <button
                          key={w}
                          type="button"
                          className="px-2 py-1 rounded-md border border-slate-200 text-xs hover:bg-slate-50"
                          onClick={() => void applyContextAction(`set-width:${w}`, contextMenu.diagramId, contextMenu.selection!)}
                        >
                          {w}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {Boolean(clipboardRef.current) && contextMenu.point && (
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-50"
                    onClick={() => {
                      handlePasteAtPoint(contextMenu.diagramId, contextMenu.point as DiagramStrokePoint)
                      setContextMenu(null)
                    }}
                  >
                    Paste
                  </button>
                )}
              </div>
            </div>
          )}
          <img
            ref={imageRef}
            src={activeDiagram.imageUrl}
            alt={activeDiagram.title || 'Diagram'}
            className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
            onLoad={() => redraw()}
          />
          <canvas
            ref={canvasRef}
            className={isAdmin
              ? tool === 'select'
                ? 'absolute inset-0 cursor-default'
                : tool === 'eraser'
                  ? 'absolute inset-0 cursor-cell'
                  : 'absolute inset-0 cursor-crosshair'
              : 'absolute inset-0 pointer-events-none'
            }
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={(e) => {
              if (!isAdmin) return
              if (!activeDiagram?.id) return
              e.preventDefault()
              e.stopPropagation()
              const host = containerRef.current
              if (!host) return
              const rect = host.getBoundingClientRect()
              const x = e.clientX - rect.left
              const y = e.clientY - rect.top
              const pt = mapClientToImageSpace(e.clientX, e.clientY)
              const hit = pt ? hitTestAnnotation(activeDiagram.id, pt) : null
              setSelection(hit)
              setContextMenu({ x, y, diagramId: activeDiagram.id, selection: hit, point: pt })
            }}
          />
        </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
