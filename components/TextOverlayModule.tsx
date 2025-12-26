import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type TextSurface = 'stage'

type TextBoxRecord = {
  id: string
  text: string
  x: number
  y: number
  w: number
  h: number
  z: number
  surface: TextSurface
  visible: boolean
}

type TextOverlayState = {
  isOpen: boolean
  activeId: string | null
}

type TextRealtimeMessage =
  | { kind: 'state'; state: TextOverlayState; ts?: number; sender?: string }
  | { kind: 'boxes'; boxes: TextBoxRecord[]; ts?: number; sender?: string }

type ScriptTextEventDetail = {
  text?: string | null
  visible?: boolean
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

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

const randomId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const SCRIPT_BOX_ID = 'lesson-script-text'

export default function TextOverlayModule(props: {
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
  const clientIdRef = useRef(clientId)
  useEffect(() => {
    clientIdRef.current = clientId
  }, [clientId])

  const channelName = useMemo(() => makeChannelName(boardId, gradeLabel), [boardId, gradeLabel])

  const channelRef = useRef<any>(null)
  const realtimeRef = useRef<any>(null)

  const [overlayState, setOverlayState] = useState<TextOverlayState>({ isOpen: false, activeId: null })
  const overlayStateRef = useRef<TextOverlayState>({ isOpen: false, activeId: null })
  useEffect(() => {
    overlayStateRef.current = overlayState
  }, [overlayState])

  const [boxes, setBoxes] = useState<TextBoxRecord[]>([])
  const boxesRef = useRef<TextBoxRecord[]>([])
  useEffect(() => {
    boxesRef.current = boxes
  }, [boxes])

  const activeBox = useMemo(() => {
    if (!overlayState.activeId) return null
    return boxes.find(b => b.id === overlayState.activeId) || null
  }, [boxes, overlayState.activeId])

  const publish = useCallback(async (message: TextRealtimeMessage) => {
    const ch = channelRef.current
    if (!ch) return
    try {
      await ch.publish('text', {
        ...message,
        ts: message.ts ?? Date.now(),
        sender: (message as any).sender ?? clientIdRef.current,
      })
    } catch {
      // ignore
    }
  }, [])

  const broadcastFullState = useCallback(async () => {
    if (!isAdmin) return
    await publish({ kind: 'state', state: overlayStateRef.current })
    await publish({ kind: 'boxes', boxes: boxesRef.current })
  }, [isAdmin, publish])

  useEffect(() => {
    if (!userId) return
    let disposed = false

    const setup = async () => {
      try {
        const Ably = await import('ably')
        const realtime = new Ably.Realtime.Promise({
          authUrl: `/api/realtime/ably-token?clientId=${encodeURIComponent(clientIdRef.current)}`,
          autoConnect: true,
          closeOnUnload: false,
          transports: ['web_socket', 'xhr_streaming', 'xhr_polling'],
        })
        realtimeRef.current = realtime

        await new Promise<void>((resolve, reject) => {
          realtime.connection.once('connected', () => resolve())
          realtime.connection.once('failed', (err: any) => reject(err))
        })

        if (disposed) return

        const channel = realtime.channels.get(channelName)
        channelRef.current = channel
        await channel.attach()

        const handleTextMessage = (message: any) => {
          const data = message?.data as any
          if (!data || typeof data !== 'object') return
          if (data.sender && data.sender === clientIdRef.current) return

          if (data.kind === 'state') {
            const next: TextOverlayState = {
              isOpen: Boolean(data.state?.isOpen),
              activeId: typeof data.state?.activeId === 'string' ? data.state.activeId : null,
            }
            setOverlayState(next)
            return
          }

          if (data.kind === 'boxes') {
            const incoming = Array.isArray(data.boxes) ? data.boxes : []
            const normalized: TextBoxRecord[] = incoming
              .map((b: any) => {
                const id = typeof b?.id === 'string' ? b.id : ''
                if (!id) return null
                return {
                  id,
                  text: typeof b.text === 'string' ? b.text : '',
                  x: typeof b.x === 'number' ? clamp01(b.x) : 0.1,
                  y: typeof b.y === 'number' ? clamp01(b.y) : 0.1,
                  w: typeof b.w === 'number' ? clamp01(b.w) : 0.45,
                  h: typeof b.h === 'number' ? clamp01(b.h) : 0.18,
                  z: typeof b.z === 'number' && Number.isFinite(b.z) ? b.z : 0,
                  surface: 'stage',
                  visible: typeof b.visible === 'boolean' ? b.visible : true,
                } as TextBoxRecord
              })
              .filter(Boolean) as TextBoxRecord[]
            normalized.sort((a, b) => (a.z - b.z) || a.id.localeCompare(b.id))
            setBoxes(normalized)
            return
          }
        }

        channel.subscribe('text', handleTextMessage)

        // Presence: when someone joins, the teacher rebroadcasts the latest state.
        try {
          await channel.presence.enter({ name: userDisplayName || 'Participant', isAdmin: Boolean(isAdmin) })
          channel.presence.subscribe(async (presenceMsg: any) => {
            if (!isAdmin) return
            if (presenceMsg?.action !== 'enter') return
            await broadcastFullState()
          })
        } catch {
          // ignore
        }

        // Teacher: publish initial state so late joiners get something quickly.
        if (isAdmin) {
          await broadcastFullState()
        }
      } catch (err) {
        console.warn('TextOverlayModule realtime setup failed', err)
      }
    }

    void setup()

    return () => {
      disposed = true
      try {
        channelRef.current?.detach?.()
      } catch {}
      try {
        realtimeRef.current?.close?.()
      } catch {}
      channelRef.current = null
      realtimeRef.current = null
    }
  }, [boardId, broadcastFullState, channelName, isAdmin, userDisplayName, userId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => {
      if (!isAdmin) return
      setOverlayState(prev => ({ ...prev, isOpen: !prev.isOpen }))
    }
    window.addEventListener('philani-text:toggle-tray', handler as any)
    return () => window.removeEventListener('philani-text:toggle-tray', handler as any)
  }, [isAdmin])

  const setStateAndBroadcast = useCallback(async (next: TextOverlayState) => {
    setOverlayState(next)
    if (!isAdmin) return
    await publish({ kind: 'state', state: next })
  }, [isAdmin, publish])

  const setBoxesAndBroadcast = useCallback(async (nextBoxes: TextBoxRecord[]) => {
    setBoxes(nextBoxes)
    if (!isAdmin) return
    await publish({ kind: 'boxes', boxes: nextBoxes })
  }, [isAdmin, publish])

  const upsertScriptBox = useCallback(async (detail: ScriptTextEventDetail) => {
    if (!isAdmin) return
    const text = typeof detail?.text === 'string' ? detail.text : (detail?.text === null ? '' : undefined)
    const wantsVisible = typeof detail?.visible === 'boolean' ? detail.visible : undefined

    const existing = boxesRef.current.find(b => b.id === SCRIPT_BOX_ID) || null
    const maxZ = boxesRef.current.reduce((m, b) => Math.max(m, b.z), 0)

    // Hide/remove
    if (text !== undefined && text.trim().length === 0 && (wantsVisible === false || detail?.text === null)) {
      if (!existing) return
      const nextBoxes = boxesRef.current.map(b => (b.id === SCRIPT_BOX_ID ? { ...b, visible: false } : b))
      await setBoxesAndBroadcast(nextBoxes)
      return
    }

    // Show/update
    const nextRecord: TextBoxRecord = existing
      ? {
          ...existing,
          text: text !== undefined ? text : existing.text,
          visible: wantsVisible !== undefined ? wantsVisible : true,
          z: Math.max(existing.z, maxZ + 1),
        }
      : {
          id: SCRIPT_BOX_ID,
          text: text !== undefined ? text : ' ',
          x: 0.06,
          y: 0.06,
          w: 0.72,
          h: 0.2,
          z: maxZ + 1,
          surface: 'stage',
          visible: wantsVisible !== undefined ? wantsVisible : true,
        }

    const nextBoxes = existing
      ? boxesRef.current.map(b => (b.id === SCRIPT_BOX_ID ? nextRecord : b))
      : [...boxesRef.current, nextRecord]
    await setBoxesAndBroadcast(nextBoxes)
  }, [isAdmin, setBoxesAndBroadcast])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handler = (event: Event) => {
      if (!isAdmin) return
      const detail = (event as CustomEvent)?.detail as ScriptTextEventDetail
      void upsertScriptBox(detail || {})
    }

    window.addEventListener('philani-text:script-apply', handler as any)
    return () => window.removeEventListener('philani-text:script-apply', handler as any)
  }, [isAdmin, upsertScriptBox])

  const addBox = useCallback(async () => {
    if (!isAdmin) return
    const id = randomId()
    const maxZ = boxesRef.current.reduce((m, b) => Math.max(m, b.z), 0)
    const next: TextBoxRecord = {
      id,
      text: 'New text',
      x: 0.1,
      y: 0.12,
      w: 0.55,
      h: 0.18,
      z: maxZ + 1,
      surface: 'stage',
      visible: true,
    }
    const nextBoxes = [...boxesRef.current, next]
    await setBoxesAndBroadcast(nextBoxes)
    await setStateAndBroadcast({ isOpen: true, activeId: id })
  }, [isAdmin, setBoxesAndBroadcast, setStateAndBroadcast])

  const deleteActive = useCallback(async () => {
    if (!isAdmin) return
    const targetId = overlayStateRef.current.activeId
    if (!targetId) return
    const nextBoxes = boxesRef.current.filter(b => b.id !== targetId)
    const nextActive = nextBoxes[0]?.id ?? null
    await setBoxesAndBroadcast(nextBoxes)
    await setStateAndBroadcast({ ...overlayStateRef.current, activeId: nextActive })
  }, [isAdmin, setBoxesAndBroadcast, setStateAndBroadcast])

  const updateActiveText = useCallback(async (text: string) => {
    if (!isAdmin) return
    const targetId = overlayStateRef.current.activeId
    if (!targetId) return
    const nextBoxes = boxesRef.current.map(b => (b.id === targetId ? { ...b, text } : b))
    await setBoxesAndBroadcast(nextBoxes)
  }, [isAdmin, setBoxesAndBroadcast])

  const toggleActiveVisibility = useCallback(async () => {
    if (!isAdmin) return
    const targetId = overlayStateRef.current.activeId
    if (!targetId) return
    const nextBoxes = boxesRef.current.map(b => (b.id === targetId ? { ...b, visible: !b.visible } : b))
    await setBoxesAndBroadcast(nextBoxes)
  }, [isAdmin, setBoxesAndBroadcast])

  const dragRef = useRef<{
    id: string
    startClientX: number
    startClientY: number
    startX: number
    startY: number
  } | null>(null)

  const onBoxPointerDown = useCallback((box: TextBoxRecord, event: React.PointerEvent<HTMLDivElement>) => {
    if (!isAdmin) return
    event.stopPropagation()
    const host = (event.currentTarget.parentElement as HTMLElement | null)?.getBoundingClientRect()
    if (!host) return

    dragRef.current = {
      id: box.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: box.x,
      startY: box.y,
    }

    try {
      ;(event.currentTarget as any).setPointerCapture?.(event.pointerId)
    } catch {}

    void setStateAndBroadcast({ ...overlayStateRef.current, activeId: box.id })
  }, [isAdmin, setStateAndBroadcast])

  const onBoxPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isAdmin) return
    const drag = dragRef.current
    if (!drag) return

    const host = (event.currentTarget.parentElement as HTMLElement | null)?.getBoundingClientRect()
    if (!host) return

    const dxPx = event.clientX - drag.startClientX
    const dyPx = event.clientY - drag.startClientY

    const dx = dxPx / Math.max(host.width, 1)
    const dy = dyPx / Math.max(host.height, 1)

    const nextBoxes = boxesRef.current.map(b => {
      if (b.id !== drag.id) return b
      return {
        ...b,
        x: clamp01(drag.startX + dx),
        y: clamp01(drag.startY + dy),
      }
    })

    // Local update only while moving; broadcast on pointer up.
    setBoxes(nextBoxes)
  }, [isAdmin])

  const onBoxPointerUp = useCallback(async () => {
    if (!isAdmin) return
    if (!dragRef.current) return
    dragRef.current = null
    await publish({ kind: 'boxes', boxes: boxesRef.current })
  }, [isAdmin, publish])

  const tray = overlayState.isOpen && isAdmin ? (
    <div className="fixed inset-x-2 bottom-16 z-[650] md:hidden">
      <div className="card p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold">Text</div>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setStateAndBroadcast({ ...overlayStateRef.current, isOpen: false })}>
            Close
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary btn-xs" onClick={addBox}>Add text</button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={toggleActiveVisibility} disabled={!activeBox}>Toggle</button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={deleteActive} disabled={!activeBox}>Delete</button>
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2">
          <select
            className="input"
            value={overlayState.activeId ?? ''}
            onChange={e => setStateAndBroadcast({ ...overlayStateRef.current, activeId: e.target.value || null })}
          >
            <option value="">Select a text box</option>
            {boxes.map(b => (
              <option key={b.id} value={b.id}>
                {(b.text || 'Text').slice(0, 36)}
              </option>
            ))}
          </select>

          {activeBox && (
            <textarea
              className="input"
              style={{ borderRadius: 16, minHeight: 92 }}
              value={activeBox.text}
              onChange={e => updateActiveText(e.target.value)}
              placeholder="Type text…"
            />
          )}
        </div>
      </div>
    </div>
  ) : null

  const renderBoxes = boxes
    .filter(b => b.visible)
    .sort((a, b) => (a.z - b.z) || a.id.localeCompare(b.id))

  return (
    <>
      <div
        className="pointer-events-none absolute inset-0"
        style={{ zIndex: 520 }}
        onPointerDown={() => {
          // tap outside - keep simple
        }}
      >
        {renderBoxes.map(box => {
          const isActive = overlayState.activeId === box.id
          return (
            <div
              key={box.id}
              className="pointer-events-auto"
              style={{
                position: 'absolute',
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.w * 100}%`,
                minWidth: 140,
                maxWidth: '92vw',
                height: `${box.h * 100}%`,
                minHeight: 56,
                zIndex: 520 + box.z,
              }}
              onPointerDown={event => onBoxPointerDown(box, event)}
              onPointerMove={onBoxPointerMove}
              onPointerUp={onBoxPointerUp}
              onPointerCancel={onBoxPointerUp}
            >
              <div
                className="rounded-2xl border p-3"
                style={{
                  background: 'rgba(0,0,0,0.65)',
                  borderColor: isActive ? 'rgba(106,165,255,0.6)' : 'rgba(255,255,255,0.18)',
                  color: 'white',
                  backdropFilter: 'blur(10px)',
                  cursor: isAdmin ? 'grab' : 'default',
                  height: '100%',
                  overflow: 'auto',
                }}
              >
                <div className="text-sm whitespace-pre-wrap">{box.text}</div>
              </div>
            </div>
          )
        })}
      </div>
      {tray}
    </>
  )
}
