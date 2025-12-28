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
  locked?: boolean
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

  const [contextMenu, setContextMenu] = useState<null | { x: number; y: number; boxId: string }>(null)
  useEffect(() => {
    if (!contextMenu) return
    if (typeof window === 'undefined') return

    const onDown = () => setContextMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('pointerdown', onDown, { capture: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, { capture: true } as any)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])

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
                  locked: typeof b.locked === 'boolean' ? b.locked : false,
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
    boxesRef.current = nextBoxes
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
          locked: Boolean(existing.locked),
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
          locked: false,
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
      locked: false,
    }
    const nextBoxes = [...boxesRef.current, next]
    await setBoxesAndBroadcast(nextBoxes)
    await setStateAndBroadcast({ isOpen: true, activeId: id })
  }, [isAdmin, setBoxesAndBroadcast, setStateAndBroadcast])

  const deleteBoxById = useCallback(async (boxId: string) => {
    if (!isAdmin) return
    const nextBoxes = boxesRef.current.filter(b => b.id !== boxId)
    const nextActive = nextBoxes[0]?.id ?? null
    await setBoxesAndBroadcast(nextBoxes)
    if (overlayStateRef.current.activeId === boxId) {
      await setStateAndBroadcast({ ...overlayStateRef.current, activeId: nextActive })
    }
  }, [isAdmin, setBoxesAndBroadcast, setStateAndBroadcast])

  const toggleBoxVisibilityById = useCallback(async (boxId: string) => {
    if (!isAdmin) return
    const nextBoxes = boxesRef.current.map(b => (b.id === boxId ? { ...b, visible: !b.visible } : b))
    await setBoxesAndBroadcast(nextBoxes)
  }, [isAdmin, setBoxesAndBroadcast])

  const toggleBoxLockById = useCallback(async (boxId: string) => {
    if (!isAdmin) return
    const nextBoxes = boxesRef.current.map(b => (b.id === boxId ? { ...b, locked: !Boolean(b.locked) } : b))
    await setBoxesAndBroadcast(nextBoxes)
  }, [isAdmin, setBoxesAndBroadcast])

  const bringBoxToFrontById = useCallback(async (boxId: string) => {
    if (!isAdmin) return
    const maxZ = boxesRef.current.reduce((m, b) => Math.max(m, b.z), 0)
    const nextBoxes = boxesRef.current.map(b => (b.id === boxId ? { ...b, z: maxZ + 1 } : b))
    await setBoxesAndBroadcast(nextBoxes)
  }, [isAdmin, setBoxesAndBroadcast])

  const sendBoxToBackById = useCallback(async (boxId: string) => {
    if (!isAdmin) return
    const minZ = boxesRef.current.reduce((m, b) => Math.min(m, b.z), 0)
    const nextBoxes = boxesRef.current.map(b => (b.id === boxId ? { ...b, z: minZ - 1 } : b))
    await setBoxesAndBroadcast(nextBoxes)
  }, [isAdmin, setBoxesAndBroadcast])

  const deleteActive = useCallback(async () => {
    if (!isAdmin) return
    const targetId = overlayStateRef.current.activeId
    if (!targetId) return
    await deleteBoxById(targetId)
  }, [deleteBoxById, isAdmin])

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
    await toggleBoxVisibilityById(targetId)
  }, [isAdmin, toggleBoxVisibilityById])

  const toggleActiveLock = useCallback(async () => {
    if (!isAdmin) return
    const targetId = overlayStateRef.current.activeId
    if (!targetId) return
    await toggleBoxLockById(targetId)
  }, [isAdmin, toggleBoxLockById])

  const dragRef = useRef<{
    id: string
    startClientX: number
    startClientY: number
    startX: number
    startY: number
    hostWidth: number
    hostHeight: number
    didMove: boolean
  } | null>(null)

  const longPressRef = useRef<null | { timer: number; pointerId: number; startX: number; startY: number; boxId: string }>(null)

  const openBoxContextMenu = useCallback((boxId: string, clientX: number, clientY: number, host: HTMLElement | null) => {
    if (!isAdmin) return
    if (!host) return
    const rect = host.getBoundingClientRect()
    const x = Math.max(0, Math.round(clientX - rect.left))
    const y = Math.max(0, Math.round(clientY - rect.top))
    setContextMenu({ x, y, boxId })
  }, [isAdmin])

  const onBoxPointerDown = useCallback((box: TextBoxRecord, event: React.PointerEvent<HTMLDivElement>) => {
    if (!isAdmin) return
    event.stopPropagation()

    void setStateAndBroadcast({ ...overlayStateRef.current, activeId: box.id })

    // Long-press opens context menu (similar to diagram module behaviour).
    if (typeof window !== 'undefined') {
      if (longPressRef.current?.timer) {
        window.clearTimeout(longPressRef.current.timer)
      }
      const pointerId = event.pointerId
      const startX = event.clientX
      const startY = event.clientY
      const timer = window.setTimeout(() => {
        // Only open if still pending and pointer hasn't moved much.
        const pending = longPressRef.current
        if (!pending) return
        if (pending.pointerId !== pointerId) return
        openBoxContextMenu(box.id, startX, startY, (event.currentTarget.parentElement as HTMLElement | null))
        longPressRef.current = null
        dragRef.current = null
      }, 520)
      longPressRef.current = { timer, pointerId, startX, startY, boxId: box.id }
    }

    const hostEl = (event.currentTarget.parentElement as HTMLElement | null)
    const hostRect = hostEl?.getBoundingClientRect()
    if (!hostRect) return

    // Start drag immediately, but if the box is locked we won't move it.
    dragRef.current = {
      id: box.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: box.x,
      startY: box.y,
      hostWidth: Math.max(1, hostRect.width),
      hostHeight: Math.max(1, hostRect.height),
      didMove: false,
    }

    try {
      ;(event.currentTarget as any).setPointerCapture?.(event.pointerId)
    } catch {}
  }, [isAdmin, openBoxContextMenu, setStateAndBroadcast])

  const onBoxPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isAdmin) return
    const drag = dragRef.current
    if (!drag) return

    // Cancel long press if user moves.
    const pending = longPressRef.current
    if (pending && pending.pointerId === event.pointerId) {
      const dx = event.clientX - pending.startX
      const dy = event.clientY - pending.startY
      if ((dx * dx + dy * dy) > 36) {
        if (typeof window !== 'undefined') window.clearTimeout(pending.timer)
        longPressRef.current = null
      }
    }

    const target = boxesRef.current.find(b => b.id === drag.id)
    if (!target || Boolean(target.locked)) return

    const dxPx = event.clientX - drag.startClientX
    const dyPx = event.clientY - drag.startClientY

    // Require a tiny movement before we consider it a drag (prevents accidental nudges).
    if (!drag.didMove && (dxPx * dxPx + dyPx * dyPx) < 9) return
    drag.didMove = true

    const dx = dxPx / Math.max(drag.hostWidth, 1)
    const dy = dyPx / Math.max(drag.hostHeight, 1)

    const nextBoxes = boxesRef.current.map(b => {
      if (b.id !== drag.id) return b
      return {
        ...b,
        x: clamp01(drag.startX + dx),
        y: clamp01(drag.startY + dy),
      }
    })

    // Local update while moving.
    boxesRef.current = nextBoxes
    setBoxes(nextBoxes)
  }, [isAdmin])

  const onBoxPointerUp = useCallback(async () => {
    if (!isAdmin) return
    if (typeof window !== 'undefined' && longPressRef.current?.timer) {
      window.clearTimeout(longPressRef.current.timer)
    }
    longPressRef.current = null

    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    if (!drag.didMove) return
    await publish({ kind: 'boxes', boxes: boxesRef.current })
  }, [isAdmin, publish])

  const onBoxContextMenu = useCallback((box: TextBoxRecord, event: React.MouseEvent<HTMLDivElement>) => {
    if (!isAdmin) return
    event.preventDefault()
    event.stopPropagation()
    void setStateAndBroadcast({ ...overlayStateRef.current, activeId: box.id })
    openBoxContextMenu(box.id, event.clientX, event.clientY, (event.currentTarget.parentElement as HTMLElement | null))
  }, [isAdmin, openBoxContextMenu, setStateAndBroadcast])

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
          <button type="button" className="btn btn-ghost btn-xs" onClick={toggleActiveLock} disabled={!activeBox}>Lock</button>
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
              onContextMenu={event => onBoxContextMenu(box, event)}
            >
              <div
                className="rounded-2xl border p-3"
                style={{
                  background: 'rgba(0,0,0,0.65)',
                  borderColor: isActive ? 'rgba(106,165,255,0.6)' : 'rgba(255,255,255,0.18)',
                  color: 'white',
                  backdropFilter: 'blur(10px)',
                  cursor: isAdmin ? (box.locked ? 'default' : 'grab') : 'default',
                  height: '100%',
                  overflow: 'auto',
                  touchAction: 'none',
                  userSelect: 'none',
                }}
              >
                <div className="text-sm whitespace-pre-wrap">{box.text}</div>
              </div>
            </div>
          )
        })}

        {isAdmin && contextMenu && (
          <div
            className="pointer-events-auto absolute z-[900]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onMouseDown={e => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onPointerDown={e => {
              e.stopPropagation()
            }}
          >
            <div className="min-w-[200px] rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden text-slate-900">
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-50"
                onClick={() => {
                  const boxId = contextMenu.boxId
                  setContextMenu(null)
                  void deleteBoxById(boxId)
                }}
              >
                Delete
              </button>
              <div className="h-px bg-slate-200" />
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-50"
                onClick={() => {
                  const boxId = contextMenu.boxId
                  setContextMenu(null)
                  void bringBoxToFrontById(boxId)
                }}
              >
                Bring to front
              </button>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-50"
                onClick={() => {
                  const boxId = contextMenu.boxId
                  setContextMenu(null)
                  void sendBoxToBackById(boxId)
                }}
              >
                Send to back
              </button>
              <div className="h-px bg-slate-200" />
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-50"
                onClick={() => {
                  const boxId = contextMenu.boxId
                  setContextMenu(null)
                  void toggleBoxVisibilityById(boxId)
                }}
              >
                Toggle visibility
              </button>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-50"
                onClick={() => {
                  const boxId = contextMenu.boxId
                  setContextMenu(null)
                  void toggleBoxLockById(boxId)
                }}
              >
                Toggle lock
              </button>
            </div>
          </div>
        )}
      </div>
      {tray}
    </>
  )
}
