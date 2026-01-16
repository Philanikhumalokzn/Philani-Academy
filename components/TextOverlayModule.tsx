import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import katex from 'katex'

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
  id?: string
  text?: string | null
  visible?: boolean
}

const sanitizeIdentifier = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60)

const makeChannelName = (boardId?: string, gradeLabel?: string | null, realtimeScopeId?: string) => {
  const base = realtimeScopeId
    ? sanitizeIdentifier(realtimeScopeId).toLowerCase()
    : boardId
      ? sanitizeIdentifier(boardId).toLowerCase()
      : gradeLabel
        ? `grade-${sanitizeIdentifier(gradeLabel).toLowerCase()}`
        : 'shared'
  return `myscript:${base}`
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

const randomId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const SCRIPT_BOX_ID = 'lesson-script-text'
const QUIZ_BOX_ID = 'quiz-prompt'
const QUIZ_FEEDBACK_BOX_ID = 'quiz-feedback'
const QUIZ_RESPONSE_EVENT = 'philani-quiz:text-response'
const QUIZ_SUBMITTED_EVENT = 'philani-quiz:submitted'

const MIN_BOX_PX_W = 140
const MIN_BOX_PX_H = 56
const MAX_BOX_FRAC = 0.98

const MAX_MATH_SEGMENTS = 24
const MAX_MATH_CHARS = 2000

function renderInlineEmphasis(text: string, keyPrefix: string) {
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

    // Consume plain text until the next potential emphasis marker.
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
}

function renderTextWithKatex(text: string) {
  const input = typeof text === 'string' ? text : ''
  if (!input) return [input]

  // Basic scanner that supports:
  // - $$...$$ (display)
  // - $...$ (inline)
  // - \[...\] (display)
  // - \(...\) (inline)
  // This keeps everything else as plain text.
  const nodes: Array<string | { kind: 'katex'; display: boolean; expr: string }> = []
  let i = 0
  let segments = 0

  const pushText = (s: string) => {
    if (!s) return
    const last = nodes[nodes.length - 1]
    if (typeof last === 'string') {
      nodes[nodes.length - 1] = last + s
    } else {
      nodes.push(s)
    }
  }

  const tryReadDelimited = (open: string, close: string, display: boolean) => {
    if (!input.startsWith(open, i)) return false
    const start = i + open.length
    const end = input.indexOf(close, start)
    if (end < 0) return false
    const expr = input.slice(start, end)
    i = end + close.length

    if (segments >= MAX_MATH_SEGMENTS) {
      pushText(open + expr + close)
      return true
    }

    const trimmed = expr.trim()
    if (!trimmed) {
      pushText(open + expr + close)
      return true
    }

    if (trimmed.length > MAX_MATH_CHARS) {
      pushText(open + trimmed.slice(0, MAX_MATH_CHARS) + close)
      return true
    }

    segments += 1
    nodes.push({ kind: 'katex', display, expr: trimmed })
    return true
  }

  while (i < input.length) {
    // Prefer longer delimiters first.
    if (tryReadDelimited('$$', '$$', true)) continue
    if (tryReadDelimited('\\[', '\\]', true)) continue
    if (tryReadDelimited('\\(', '\\)', false)) continue

    // Inline $...$ (ignore escaped \$)
    if (input[i] === '$' && (i === 0 || input[i - 1] !== '\\')) {
      // Avoid treating $$ as $.
      if (input[i + 1] === '$') {
        pushText('$')
        i += 1
        continue
      }
      const start = i + 1
      let end = start
      while (end < input.length) {
        if (input[end] === '$' && input[end - 1] !== '\\') break
        end += 1
      }
      if (end < input.length && input[end] === '$') {
        const expr = input.slice(start, end)
        i = end + 1
        if (segments >= MAX_MATH_SEGMENTS) {
          pushText(`$${expr}$`)
          continue
        }
        const trimmed = expr.trim()
        if (!trimmed) {
          pushText(`$${expr}$`)
          continue
        }
        if (trimmed.length > MAX_MATH_CHARS) {
          pushText(`$${trimmed.slice(0, MAX_MATH_CHARS)}$`)
          continue
        }
        segments += 1
        nodes.push({ kind: 'katex', display: false, expr: trimmed })
        continue
      }
      // No closing $, treat as literal.
      pushText('$')
      i += 1
      continue
    }

    pushText(input[i])
    i += 1
  }

  return nodes.map((n, idx) => {
    if (typeof n === 'string') {
      return <span key={`t-${idx}`}>{renderInlineEmphasis(n, `t-${idx}`)}</span>
    }
    try {
      const html = katex.renderToString(n.expr, { displayMode: n.display, throwOnError: false, strict: 'ignore' })
      return (
        <span
          key={`k-${idx}`}
          className={n.display ? 'block my-1' : 'inline'}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )
    } catch {
      // If KaTeX fails for any reason, fall back to the raw text.
      return (
        <span key={`f-${idx}`}>
          {n.display ? `\n${n.expr}\n` : n.expr}
        </span>
      )
    }
  })
}

export default function TextOverlayModule(props: {
  boardId?: string
  realtimeScopeId?: string
  gradeLabel?: string | null
  userId: string
  userDisplayName?: string
  isAdmin: boolean
}) {
  const { boardId, realtimeScopeId, gradeLabel, userId, userDisplayName, isAdmin } = props

  const [presenterOverride, setPresenterOverride] = useState(false)
  const canPresent = Boolean(isAdmin) || presenterOverride
  const canPresentRef = useRef(canPresent)
  useEffect(() => {
    canPresentRef.current = canPresent
  }, [canPresent])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (event: Event) => {
      const detail = (event as CustomEvent)?.detail as any
      setPresenterOverride(Boolean(detail?.isPresenter ?? detail?.isActivePresenter ?? detail?.canPresent))
    }
    window.addEventListener('philani-canvas:presenter', handler as any)
    return () => window.removeEventListener('philani-canvas:presenter', handler as any)
  }, [])

  const clientId = useMemo(() => {
    const base = sanitizeIdentifier(userId || 'anonymous')
    const randomSuffix = Math.random().toString(36).slice(2, 8)
    return `${base}-${randomSuffix}`
  }, [userId])
  const clientIdRef = useRef(clientId)
  useEffect(() => {
    clientIdRef.current = clientId
  }, [clientId])

  const channelName = useMemo(() => makeChannelName(boardId, gradeLabel, realtimeScopeId), [boardId, gradeLabel, realtimeScopeId])

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

  // Student-local boxes (not broadcast). Used for instant feedback after quiz submission.
  const [studentLocalBoxes, setStudentLocalBoxes] = useState<TextBoxRecord[]>([])
  const studentLocalBoxesRef = useRef<TextBoxRecord[]>([])
  useEffect(() => {
    studentLocalBoxesRef.current = studentLocalBoxes
  }, [studentLocalBoxes])

  const quizFeedbackAutoHideTimerRef = useRef<number | null>(null)
  const clearQuizFeedbackAutoHide = useCallback(() => {
    if (typeof window === 'undefined') return
    if (quizFeedbackAutoHideTimerRef.current != null) {
      window.clearTimeout(quizFeedbackAutoHideTimerRef.current)
      quizFeedbackAutoHideTimerRef.current = null
    }
  }, [])

  // Student-local overrides for the quiz prompt box.
  // Students should be able to move/resize/close the prompt without affecting others.
  const [localQuizOverride, setLocalQuizOverride] = useState<null | { x?: number; y?: number; w?: number; h?: number; hidden?: boolean }>(null)
  const localQuizOverrideRef = useRef<null | { x?: number; y?: number; w?: number; h?: number; hidden?: boolean }>(null)
  useEffect(() => {
    localQuizOverrideRef.current = localQuizOverride
  }, [localQuizOverride])

  const [studentQuizTextResponse, setStudentQuizTextResponse] = useState('')
  const lastDispatchedStudentQuizTextRef = useRef<string>('')
  const dispatchStudentQuizTextResponse = useCallback((text: string) => {
    if (typeof window === 'undefined') return
    const normalized = typeof text === 'string' ? text : ''
    if (normalized === lastDispatchedStudentQuizTextRef.current) return
    lastDispatchedStudentQuizTextRef.current = normalized
    try {
      window.dispatchEvent(new CustomEvent(QUIZ_RESPONSE_EVENT, { detail: { text: normalized } }))
    } catch {}
  }, [])

  // Student-only: when a quiz is submitted, hide quiz-specific popups locally.
  // This preserves all teacher-authored lesson/context text boxes.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (isAdmin) return

    const handler = () => {
      setLocalQuizOverride(prev => ({ ...(prev || {}), hidden: true }))
      clearQuizFeedbackAutoHide()
      setStudentLocalBoxes(prev => prev.map(b => (b.id === QUIZ_FEEDBACK_BOX_ID ? { ...b, visible: false } : b)))
      setStudentQuizTextResponse('')
      dispatchStudentQuizTextResponse('')
    }

    window.addEventListener(QUIZ_SUBMITTED_EVENT, handler as any)
    return () => window.removeEventListener(QUIZ_SUBMITTED_EVENT, handler as any)
  }, [clearQuizFeedbackAutoHide, dispatchStudentQuizTextResponse, isAdmin])

  const [closingPopupIds, setClosingPopupIds] = useState<Record<string, boolean>>({})

  type TextTimelineEvent = {
    ts: number
    kind: 'overlay-state' | 'box'
    action: string
    boxId?: string
    visible?: boolean
    textSnippet?: string
  }
  const textTimelineRef = useRef<TextTimelineEvent[]>([])
  const pushTextTimeline = useCallback((evt: TextTimelineEvent) => {
    const next = [...textTimelineRef.current, evt]
    // Bound memory: keep last ~250 events.
    textTimelineRef.current = next.length > 250 ? next.slice(next.length - 250) : next
  }, [])

  const lastQuizPromptSignatureRef = useRef<string>('')

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
    if (!canPresentRef.current) return
    await publish({ kind: 'state', state: overlayStateRef.current })
    await publish({ kind: 'boxes', boxes: boxesRef.current })
  }, [publish])

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

            // If the quiz prompt content is updated (or re-shown), re-open it for students.
            if (!isAdmin) {
              const quiz = normalized.find(b => b.id === QUIZ_BOX_ID) || null
              const signature = quiz ? `${quiz.visible ? '1' : '0'}|${quiz.text || ''}` : ''
              if (signature && signature !== lastQuizPromptSignatureRef.current) {
                lastQuizPromptSignatureRef.current = signature
                setLocalQuizOverride(prev => (prev?.hidden ? { ...prev, hidden: false } : prev))
                  setClosingPopupIds(prev => {
                    if (!prev[QUIZ_BOX_ID]) return prev
                    const next = { ...prev }
                    delete next[QUIZ_BOX_ID]
                    return next
                  })
              }
            }
            return
          }
        }

        channel.subscribe('text', handleTextMessage)

        // Presence: when someone joins, the teacher rebroadcasts the latest state.
        try {
          await channel.presence.enter({ name: userDisplayName || 'Participant', isAdmin: Boolean(isAdmin) })
          channel.presence.subscribe(async (presenceMsg: any) => {
            if (!canPresentRef.current) return
            if (presenceMsg?.action !== 'enter') return
            await broadcastFullState()
          })
        } catch {
          // ignore
        }

        // Teacher: publish initial state so late joiners get something quickly.
        if (canPresentRef.current) {
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
      if (!canPresentRef.current) return
      setOverlayState(prev => ({ ...prev, isOpen: !prev.isOpen }))
    }
    window.addEventListener('philani-text:toggle-tray', handler as any)
    return () => window.removeEventListener('philani-text:toggle-tray', handler as any)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handler = (event: Event) => {
      if (!canPresentRef.current) return
      const detail = (event as CustomEvent)?.detail as { requestId?: string } | undefined
      const requestId = typeof detail?.requestId === 'string' ? detail.requestId : ''
      if (!requestId) return

      const visibleBoxes = boxesRef.current
        .filter(b => Boolean(b.visible))
        .map(b => ({ id: b.id, text: b.text || '', visible: Boolean(b.visible), z: b.z }))

      window.dispatchEvent(new CustomEvent('philani-text:context', {
        detail: {
          requestId,
          ts: Date.now(),
          overlayState: overlayStateRef.current,
          boxes: visibleBoxes,
          timeline: textTimelineRef.current.slice(Math.max(0, textTimelineRef.current.length - 80)),
        },
      }))
    }

    window.addEventListener('philani-text:request-context', handler as any)
    return () => window.removeEventListener('philani-text:request-context', handler as any)
  }, [])

  const setStateAndBroadcast = useCallback(async (next: TextOverlayState) => {
    setOverlayState(next)
    if (!canPresent) return
    pushTextTimeline({
      ts: Date.now(),
      kind: 'overlay-state',
      action: next.isOpen ? 'open' : 'close',
    })
    await publish({ kind: 'state', state: next })
  }, [canPresent, publish, pushTextTimeline])

  const setBoxesAndBroadcast = useCallback(async (nextBoxes: TextBoxRecord[]) => {
    const prev = boxesRef.current
    setBoxes(nextBoxes)
    boxesRef.current = nextBoxes
    if (!canPresent) return

    try {
      const prevById = new Map(prev.map(b => [b.id, b]))
      const nextById = new Map(nextBoxes.map(b => [b.id, b]))
      const ids = new Set<string>([...prevById.keys(), ...nextById.keys()])
      for (const id of ids) {
        const p = prevById.get(id) || null
        const n = nextById.get(id) || null
        if (!p && n) {
          pushTextTimeline({ ts: Date.now(), kind: 'box', action: 'create', boxId: id, visible: Boolean(n.visible), textSnippet: (n.text || '').trim().slice(0, 220) })
          continue
        }
        if (p && !n) {
          pushTextTimeline({ ts: Date.now(), kind: 'box', action: 'delete', boxId: id })
          continue
        }
        if (!p || !n) continue

        const pVis = Boolean(p.visible)
        const nVis = Boolean(n.visible)
        if (pVis !== nVis) {
          pushTextTimeline({ ts: Date.now(), kind: 'box', action: nVis ? 'show' : 'hide', boxId: id, visible: nVis, textSnippet: (n.text || '').trim().slice(0, 220) })
        }
        const pText = (p.text || '').trim()
        const nText = (n.text || '').trim()
        if (pText !== nText) {
          pushTextTimeline({ ts: Date.now(), kind: 'box', action: 'text', boxId: id, visible: nVis, textSnippet: nText.slice(0, 220) })
        }
      }
    } catch {
      // ignore
    }

    await publish({ kind: 'boxes', boxes: nextBoxes })
  }, [canPresent, publish, pushTextTimeline])

  const upsertScriptBox = useCallback(async (detail: ScriptTextEventDetail) => {
    if (!canPresentRef.current) return
    const targetIdRaw = typeof detail?.id === 'string' ? detail.id : ''
    const targetId = targetIdRaw.trim().length > 0 ? targetIdRaw.trim() : SCRIPT_BOX_ID
    // Backwards-compat + safety: if an unknown id is passed, allow it, but cap length.
    const resolvedId = targetId.length > 64 ? targetId.slice(0, 64) : targetId
    const text = typeof detail?.text === 'string' ? detail.text : (detail?.text === null ? '' : undefined)
    const wantsVisible = typeof detail?.visible === 'boolean' ? detail.visible : undefined

    const existing = boxesRef.current.find(b => b.id === resolvedId) || null
    const maxZ = boxesRef.current.reduce((m, b) => Math.max(m, b.z), 0)

    // Hide/remove
    if (text !== undefined && text.trim().length === 0 && (wantsVisible === false || detail?.text === null)) {
      if (!existing) return
      const nextBoxes = boxesRef.current.map(b => (b.id === resolvedId ? { ...b, visible: false } : b))
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
          id: resolvedId,
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
      ? boxesRef.current.map(b => (b.id === resolvedId ? nextRecord : b))
      : [...boxesRef.current, nextRecord]
    await setBoxesAndBroadcast(nextBoxes)
  }, [setBoxesAndBroadcast])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handler = (event: Event) => {
      if (!canPresentRef.current) return
      const detail = (event as CustomEvent)?.detail as ScriptTextEventDetail
      void upsertScriptBox(detail || {})
    }

    window.addEventListener('philani-text:script-apply', handler as any)
    return () => window.removeEventListener('philani-text:script-apply', handler as any)
  }, [upsertScriptBox])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handler = (event: Event) => {
      if (isAdmin) return
      const detail = (event as CustomEvent)?.detail as ScriptTextEventDetail
      const targetIdRaw = typeof detail?.id === 'string' ? detail.id : QUIZ_FEEDBACK_BOX_ID
      const targetId = targetIdRaw.trim().length > 0 ? targetIdRaw.trim() : QUIZ_FEEDBACK_BOX_ID
      if (targetId !== QUIZ_FEEDBACK_BOX_ID) return

      const text = typeof detail?.text === 'string' ? detail.text : (detail?.text === null ? '' : undefined)
      const wantsVisible = typeof detail?.visible === 'boolean' ? detail.visible : undefined

      // Student-only: auto-hide feedback after 30 seconds.
      clearQuizFeedbackAutoHide()
      if (wantsVisible !== false) {
        quizFeedbackAutoHideTimerRef.current = window.setTimeout(() => {
          setClosingPopupIds(prev => ({ ...prev, [QUIZ_FEEDBACK_BOX_ID]: true }))
          window.setTimeout(() => {
            setStudentLocalBoxes(prev => prev.map(b => (b.id === QUIZ_FEEDBACK_BOX_ID ? { ...b, visible: false } : b)))
            setClosingPopupIds(prev => {
              if (!prev[QUIZ_FEEDBACK_BOX_ID]) return prev
              const next = { ...prev }
              delete next[QUIZ_FEEDBACK_BOX_ID]
              return next
            })
          }, 230)
        }, 30_000)
      }

      setStudentLocalBoxes(prev => {
        const existing = prev.find(b => b.id === QUIZ_FEEDBACK_BOX_ID) || null

        if (wantsVisible === false) {
          if (!existing) return prev
          const next = prev.map(b => (b.id === QUIZ_FEEDBACK_BOX_ID ? { ...b, visible: false } : b))
          studentLocalBoxesRef.current = next
          return next
        }

        const maxZ = prev.reduce((m, b) => Math.max(m, b.z), 0)
        const nextRecord: TextBoxRecord = existing
          ? {
              ...existing,
              text: text !== undefined ? text : existing.text,
              visible: true,
              z: Math.max(existing.z, maxZ + 1, 9999),
              locked: true,
            }
          : {
              id: QUIZ_FEEDBACK_BOX_ID,
              text: text !== undefined ? text : ' ',
              x: 0.5,
              y: 0.74,
              w: 0.6,
              h: 0.16,
              z: Math.max(maxZ + 1, 9999),
              surface: 'stage',
              visible: true,
              locked: true,
            }

        const next = existing
          ? prev.map(b => (b.id === QUIZ_FEEDBACK_BOX_ID ? nextRecord : b))
          : [...prev, nextRecord]
        studentLocalBoxesRef.current = next
        return next
      })

      // Ensure "pop in" runs if it was closing.
      setClosingPopupIds(prev => {
        if (!prev[QUIZ_FEEDBACK_BOX_ID]) return prev
        const next = { ...prev }
        delete next[QUIZ_FEEDBACK_BOX_ID]
        return next
      })
    }

    window.addEventListener('philani-text:local-apply', handler as any)
    return () => window.removeEventListener('philani-text:local-apply', handler as any)
  }, [clearQuizFeedbackAutoHide, isAdmin])

  const addBox = useCallback(async () => {
    if (!canPresentRef.current) return
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
  }, [setBoxesAndBroadcast, setStateAndBroadcast])

  const deleteBoxById = useCallback(async (boxId: string) => {
    if (!canPresentRef.current) return
    const nextBoxes = boxesRef.current.filter(b => b.id !== boxId)
    const nextActive = nextBoxes[0]?.id ?? null
    await setBoxesAndBroadcast(nextBoxes)
    if (overlayStateRef.current.activeId === boxId) {
      await setStateAndBroadcast({ ...overlayStateRef.current, activeId: nextActive })
    }
  }, [setBoxesAndBroadcast, setStateAndBroadcast])

  const toggleBoxVisibilityById = useCallback(async (boxId: string) => {
    if (!canPresentRef.current) return
    const nextBoxes = boxesRef.current.map(b => (b.id === boxId ? { ...b, visible: !b.visible } : b))
    await setBoxesAndBroadcast(nextBoxes)
  }, [setBoxesAndBroadcast])

  const toggleBoxLockById = useCallback(async (boxId: string) => {
    if (!canPresentRef.current) return
    const nextBoxes = boxesRef.current.map(b => (b.id === boxId ? { ...b, locked: !Boolean(b.locked) } : b))
    await setBoxesAndBroadcast(nextBoxes)
  }, [setBoxesAndBroadcast])

  const bringBoxToFrontById = useCallback(async (boxId: string) => {
    if (!canPresentRef.current) return
    const maxZ = boxesRef.current.reduce((m, b) => Math.max(m, b.z), 0)
    const nextBoxes = boxesRef.current.map(b => (b.id === boxId ? { ...b, z: maxZ + 1 } : b))
    await setBoxesAndBroadcast(nextBoxes)
  }, [setBoxesAndBroadcast])

  const sendBoxToBackById = useCallback(async (boxId: string) => {
    if (!canPresentRef.current) return
    const minZ = boxesRef.current.reduce((m, b) => Math.min(m, b.z), 0)
    const nextBoxes = boxesRef.current.map(b => (b.id === boxId ? { ...b, z: minZ - 1 } : b))
    await setBoxesAndBroadcast(nextBoxes)
  }, [setBoxesAndBroadcast])

  const deleteActive = useCallback(async () => {
    if (!canPresentRef.current) return
    const targetId = overlayStateRef.current.activeId
    if (!targetId) return
    await deleteBoxById(targetId)
  }, [deleteBoxById])

  const updateActiveText = useCallback(async (text: string) => {
    if (!canPresentRef.current) return
    const targetId = overlayStateRef.current.activeId
    if (!targetId) return
    const nextBoxes = boxesRef.current.map(b => (b.id === targetId ? { ...b, text } : b))
    await setBoxesAndBroadcast(nextBoxes)
  }, [setBoxesAndBroadcast])

  const toggleActiveVisibility = useCallback(async () => {
    if (!canPresentRef.current) return
    const targetId = overlayStateRef.current.activeId
    if (!targetId) return
    await toggleBoxVisibilityById(targetId)
  }, [toggleBoxVisibilityById])

  const toggleActiveLock = useCallback(async () => {
    if (!canPresentRef.current) return
    const targetId = overlayStateRef.current.activeId
    if (!targetId) return
    await toggleBoxLockById(targetId)
  }, [toggleBoxLockById])

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

  const resizeRef = useRef<{
    id: string
    startClientX: number
    startClientY: number
    startW: number
    startH: number
    hostWidth: number
    hostHeight: number
    didResize: boolean
  } | null>(null)

  const longPressRef = useRef<null | { timer: number; pointerId: number; startX: number; startY: number; boxId: string }>(null)

  const openBoxContextMenu = useCallback((boxId: string, clientX: number, clientY: number, host: HTMLElement | null) => {
    if (!canPresentRef.current) return
    if (!host) return
    const rect = host.getBoundingClientRect()
    const x = Math.max(0, Math.round(clientX - rect.left))
    const y = Math.max(0, Math.round(clientY - rect.top))
    setContextMenu({ x, y, boxId })
  }, [])

  const onBoxPointerDown = useCallback((box: TextBoxRecord, event: React.PointerEvent<HTMLDivElement>) => {
    const isQuizBox = box.id === QUIZ_BOX_ID
    const canManipulate = canPresentRef.current || isQuizBox
    if (!canManipulate) return
    event.stopPropagation()

    if (canPresentRef.current) {
      void setStateAndBroadcast({ ...overlayStateRef.current, activeId: box.id })
    }

    // Long-press opens context menu (similar to diagram module behaviour).
    if (typeof window !== 'undefined' && canPresentRef.current) {
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
    const initial = !isAdmin && isQuizBox && localQuizOverrideRef.current
      ? {
          x: typeof localQuizOverrideRef.current?.x === 'number' ? localQuizOverrideRef.current.x : box.x,
          y: typeof localQuizOverrideRef.current?.y === 'number' ? localQuizOverrideRef.current.y : box.y,
        }
      : { x: box.x, y: box.y }

    dragRef.current = {
      id: box.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: initial.x,
      startY: initial.y,
      hostWidth: Math.max(1, hostRect.width),
      hostHeight: Math.max(1, hostRect.height),
      didMove: false,
    }

    try {
      ;(event.currentTarget as any).setPointerCapture?.(event.pointerId)
    } catch {}
  }, [isAdmin, openBoxContextMenu, setStateAndBroadcast])

  const onResizeHandlePointerDown = useCallback((box: TextBoxRecord, event: React.PointerEvent<HTMLButtonElement>) => {
    const isQuizBox = box.id === QUIZ_BOX_ID
    const canManipulate = canPresentRef.current || isQuizBox
    if (!canManipulate) return
    event.preventDefault()
    event.stopPropagation()

    const hostEl = ((event.currentTarget as any).parentElement?.parentElement as HTMLElement | null)?.parentElement as HTMLElement | null
    const hostRect = hostEl?.getBoundingClientRect()
    if (!hostRect) return

    const initial = !isAdmin && isQuizBox && localQuizOverrideRef.current
      ? {
          w: typeof localQuizOverrideRef.current?.w === 'number' ? localQuizOverrideRef.current.w : box.w,
          h: typeof localQuizOverrideRef.current?.h === 'number' ? localQuizOverrideRef.current.h : box.h,
        }
      : { w: box.w, h: box.h }

    resizeRef.current = {
      id: box.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startW: initial.w,
      startH: initial.h,
      hostWidth: Math.max(1, hostRect.width),
      hostHeight: Math.max(1, hostRect.height),
      didResize: false,
    }

    try {
      ;(event.currentTarget as any).setPointerCapture?.(event.pointerId)
    } catch {}
  }, [isAdmin])

  const onBoxPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const resize = resizeRef.current
    if (!drag && !resize) return

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

    // Resize takes precedence if active.
    if (resize) {
      const targetId = resize.id
      const isQuizBox = targetId === QUIZ_BOX_ID

      const dxPx = event.clientX - resize.startClientX
      const dyPx = event.clientY - resize.startClientY
      if (!resize.didResize && (dxPx * dxPx + dyPx * dyPx) < 9) return
      resize.didResize = true

      const dw = dxPx / Math.max(resize.hostWidth, 1)
      const dh = dyPx / Math.max(resize.hostHeight, 1)
      const minW = MIN_BOX_PX_W / Math.max(resize.hostWidth, 1)
      const minH = MIN_BOX_PX_H / Math.max(resize.hostHeight, 1)

      const nextW = clamp01(Math.min(MAX_BOX_FRAC, Math.max(minW, resize.startW + dw)))
      const nextH = clamp01(Math.min(MAX_BOX_FRAC, Math.max(minH, resize.startH + dh)))

      if (!isAdmin && isQuizBox) {
        setLocalQuizOverride(prev => ({
          ...(prev || {}),
          w: nextW,
          h: nextH,
        }))
        return
      }

      if (!canPresentRef.current) return
      const target = boxesRef.current.find(b => b.id === targetId)
      if (!target || Boolean(target.locked)) return

      const nextBoxes = boxesRef.current.map(b => (b.id === targetId ? { ...b, w: nextW, h: nextH } : b))
      boxesRef.current = nextBoxes
      setBoxes(nextBoxes)
      return
    }

    if (!drag) return
    const targetId = drag.id
    const isQuizBox = targetId === QUIZ_BOX_ID
    if (canPresentRef.current) {
      const target = boxesRef.current.find(b => b.id === targetId)
      if (!target || Boolean(target.locked)) return
    }

    const dxPx = event.clientX - drag.startClientX
    const dyPx = event.clientY - drag.startClientY

    // Require a tiny movement before we consider it a drag (prevents accidental nudges).
    if (!drag.didMove && (dxPx * dxPx + dyPx * dyPx) < 9) return
    drag.didMove = true

    const dx = dxPx / Math.max(drag.hostWidth, 1)
    const dy = dyPx / Math.max(drag.hostHeight, 1)

    const nextX = clamp01(drag.startX + dx)
    const nextY = clamp01(drag.startY + dy)

    if (!isAdmin && isQuizBox) {
      setLocalQuizOverride(prev => ({
        ...(prev || {}),
        x: nextX,
        y: nextY,
      }))
      return
    }

    if (!canPresentRef.current) return

    const nextBoxes = boxesRef.current.map(b => {
      if (b.id !== targetId) return b
      return {
        ...b,
        x: nextX,
        y: nextY,
      }
    })

    boxesRef.current = nextBoxes
    setBoxes(nextBoxes)
  }, [isAdmin])

  const onBoxPointerUp = useCallback(async () => {
    if (typeof window !== 'undefined' && longPressRef.current?.timer) {
      window.clearTimeout(longPressRef.current.timer)
    }
    longPressRef.current = null

    const drag = dragRef.current
    const resize = resizeRef.current
    dragRef.current = null
    resizeRef.current = null

    // Non-presenters: local-only changes (no publish).
    if (!canPresentRef.current) return

    const didChange = Boolean(drag?.didMove) || Boolean(resize?.didResize)
    if (!didChange) return
    await publish({ kind: 'boxes', boxes: boxesRef.current })
  }, [publish])

  const onBoxContextMenu = useCallback((box: TextBoxRecord, event: React.MouseEvent<HTMLDivElement>) => {
    if (!canPresentRef.current) return
    event.preventDefault()
    event.stopPropagation()
    void setStateAndBroadcast({ ...overlayStateRef.current, activeId: box.id })
    openBoxContextMenu(box.id, event.clientX, event.clientY, (event.currentTarget.parentElement as HTMLElement | null))
  }, [openBoxContextMenu, setStateAndBroadcast])

  const tray = overlayState.isOpen && canPresent ? (
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

  const mergedBoxes = useMemo(() => {
    if (isAdmin) return boxes
    if (!studentLocalBoxes.length) return boxes
    const byId = new Map<string, TextBoxRecord>()
    for (const b of boxes) byId.set(b.id, b)
    for (const b of studentLocalBoxes) byId.set(b.id, b)
    return Array.from(byId.values())
  }, [boxes, isAdmin, studentLocalBoxes])

  // When quiz prompt box disappears, clear the typed response so the next quiz starts clean.
  useEffect(() => {
    if (isAdmin) return
    const quizBox = mergedBoxes.find(b => b.id === QUIZ_BOX_ID) || null
    const quizVisible = Boolean(quizBox?.visible) && !Boolean(localQuizOverrideRef.current?.hidden)
    if (quizVisible) return
    if (!studentQuizTextResponse) {
      dispatchStudentQuizTextResponse('')
      return
    }
    setStudentQuizTextResponse('')
    dispatchStudentQuizTextResponse('')
  }, [dispatchStudentQuizTextResponse, isAdmin, mergedBoxes, studentQuizTextResponse])

  const renderBoxes = mergedBoxes
    .filter(b => {
      const isClosing = Boolean(closingPopupIds[b.id])
      if (!b.visible && !isClosing) return false
      if (!isAdmin && b.id === QUIZ_BOX_ID && localQuizOverrideRef.current?.hidden && !isClosing) return false
      return true
    })
    .sort((a, b) => (a.z - b.z) || a.id.localeCompare(b.id))

  const showRestoreQuizButton = useMemo(() => {
    if (isAdmin) return false
    if (!localQuizOverrideRef.current?.hidden) return false
    const quizBox = mergedBoxes.find(b => b.id === QUIZ_BOX_ID) || null
    return Boolean(quizBox?.visible)
  }, [isAdmin, mergedBoxes])

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
          const isQuizBox = box.id === QUIZ_BOX_ID
          const isQuizFeedbackBox = box.id === QUIZ_FEEDBACK_BOX_ID
          const isQuizPopupBox = isQuizBox || isQuizFeedbackBox
          const isClosing = Boolean(closingPopupIds[box.id])
          const allowCanvasInkThrough = !isAdmin && isQuizPopupBox
          const effective = (!isAdmin && isQuizBox && localQuizOverrideRef.current)
            ? {
                ...box,
                x: typeof localQuizOverrideRef.current.x === 'number' ? localQuizOverrideRef.current.x : box.x,
                y: typeof localQuizOverrideRef.current.y === 'number' ? localQuizOverrideRef.current.y : box.y,
                w: typeof localQuizOverrideRef.current.w === 'number' ? localQuizOverrideRef.current.w : box.w,
                h: typeof localQuizOverrideRef.current.h === 'number' ? localQuizOverrideRef.current.h : box.h,
              }
            : box
          const shouldAutoFitHeight = isQuizFeedbackBox || (!isAdmin && isQuizBox)
          return (
            <div
              key={box.id}
              className="pointer-events-auto"
              style={{
                position: 'absolute',
                left: isQuizFeedbackBox ? '50%' : `${effective.x * 100}%`,
                top: `${effective.y * 100}%`,
                width: isQuizFeedbackBox ? 'fit-content' : `${effective.w * 100}%`,
                minWidth: isQuizFeedbackBox ? undefined : MIN_BOX_PX_W,
                maxWidth: '92vw',
                height: shouldAutoFitHeight ? 'fit-content' : `${effective.h * 100}%`,
                minHeight: shouldAutoFitHeight ? undefined : MIN_BOX_PX_H,
                zIndex: 520 + box.z,
                transform: isQuizFeedbackBox ? 'translateX(-50%)' : undefined,
                // Critical: allow handwriting on the canvas even if the quiz popup overlaps it.
                // We keep specific interactive controls (close, textarea) as pointer-events:auto.
                pointerEvents: allowCanvasInkThrough ? 'none' : 'auto',
              }}
              onPointerDown={event => onBoxPointerDown(box, event)}
              onPointerMove={onBoxPointerMove}
              onPointerUp={onBoxPointerUp}
              onPointerCancel={onBoxPointerUp}
              onContextMenu={event => onBoxContextMenu(box, event)}
            >
              <div
                className={`relative rounded-2xl border p-3 ${(!isAdmin && isQuizPopupBox) ? (isClosing ? 'philani-quiz-pop-out' : 'philani-quiz-pop') : ''}`}
                style={{
                  background: 'rgba(0,0,0,0.65)',
                  borderColor: isActive ? 'rgba(106,165,255,0.6)' : 'rgba(255,255,255,0.18)',
                  color: 'white',
                  backdropFilter: 'blur(10px)',
                  cursor: (canPresent || isQuizBox) ? (box.locked ? 'default' : 'grab') : 'default',
                  height: shouldAutoFitHeight ? 'auto' : '100%',
                  overflow: shouldAutoFitHeight ? 'hidden' : 'auto',
                  touchAction: 'none',
                  userSelect: 'none',
                  pointerEvents: allowCanvasInkThrough ? 'none' : 'auto',
                }}
              >
                {(isQuizBox || isQuizFeedbackBox) && (
                  <button
                    type="button"
                    className="absolute right-2 top-2 px-2 py-1 text-xs text-white/80 hover:text-white"
                    style={{ pointerEvents: 'auto' }}
                    onClick={async e => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (isAdmin) {
                        await toggleBoxVisibilityById(box.id)
                        return
                      }
                      if (isQuizBox) {
                        setClosingPopupIds(prev => ({ ...prev, [QUIZ_BOX_ID]: true }))
                        window.setTimeout(() => {
                          setLocalQuizOverride(prev => ({ ...(prev || {}), hidden: true }))
                          setClosingPopupIds(prev => {
                            if (!prev[QUIZ_BOX_ID]) return prev
                            const next = { ...prev }
                            delete next[QUIZ_BOX_ID]
                            return next
                          })
                        }, 230)
                        return
                      }
                      clearQuizFeedbackAutoHide()
                      setClosingPopupIds(prev => ({ ...prev, [QUIZ_FEEDBACK_BOX_ID]: true }))
                      window.setTimeout(() => {
                        setStudentLocalBoxes(prev => prev.map(b => (b.id === QUIZ_FEEDBACK_BOX_ID ? { ...b, visible: false } : b)))
                        setClosingPopupIds(prev => {
                          if (!prev[QUIZ_FEEDBACK_BOX_ID]) return prev
                          const next = { ...prev }
                          delete next[QUIZ_FEEDBACK_BOX_ID]
                          return next
                        })
                      }, 230)
                    }}
                    onPointerDown={e => {
                      // Prevent the drag handler from swallowing a click on mobile.
                      e.stopPropagation()
                    }}
                    aria-label="Close"
                    title="Close"
                  >
                    ×
                  </button>
                )}
                <div className="text-sm whitespace-pre-wrap">{renderTextWithKatex(box.text)}</div>

                {!isAdmin && isQuizBox && (
                  <div className="mt-3">
                    <div className="mb-1 text-xs text-white/80">Your typed answer (optional)</div>
                    <textarea
                      className="w-full rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:outline-none"
                      style={{ minHeight: 88, resize: 'vertical', userSelect: 'text', touchAction: 'auto', pointerEvents: 'auto' }}
                      value={studentQuizTextResponse}
                      onChange={e => {
                        const next = e.target.value
                        setStudentQuizTextResponse(next)
                        dispatchStudentQuizTextResponse(next)
                      }}
                      placeholder="Type your answer here…"
                      onPointerDown={e => {
                        // Let students type without dragging the popup.
                        e.stopPropagation()
                      }}
                      onClick={e => e.stopPropagation()}
                    />
                  </div>
                )}

                {isQuizBox && (
                  <button
                    type="button"
                    className="absolute right-1 bottom-1 h-5 w-5 cursor-se-resize text-white/60 hover:text-white/80"
                    onPointerDown={e => onResizeHandlePointerDown(box, e)}
                    aria-label="Resize"
                    title="Resize"
                  >
                    ◢
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {showRestoreQuizButton && (
          <button
            type="button"
            className="pointer-events-auto fixed right-3 bottom-20 z-[700] rounded-full border border-white/15 bg-black/60 px-3 py-2 text-xs text-white/90"
            style={{ backdropFilter: 'blur(10px)' }}
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              setLocalQuizOverride(prev => ({ ...(prev || {}), hidden: false }))
            }}
            aria-label="Show quiz prompt"
            title="Show quiz prompt"
          >
            Show quiz
          </button>
        )}

        {canPresent && contextMenu && (
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
            onPointerUp={e => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <div className="min-w-[200px] rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden text-slate-900">
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-50"
                onPointerUp={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  const boxId = contextMenu.boxId
                  setContextMenu(null)
                  void deleteBoxById(boxId)
                }}
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
                onPointerUp={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  const boxId = contextMenu.boxId
                  setContextMenu(null)
                  void bringBoxToFrontById(boxId)
                }}
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
                onPointerUp={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  const boxId = contextMenu.boxId
                  setContextMenu(null)
                  void sendBoxToBackById(boxId)
                }}
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
                onPointerUp={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  const boxId = contextMenu.boxId
                  setContextMenu(null)
                  void toggleBoxVisibilityById(boxId)
                }}
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
                onPointerUp={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  const boxId = contextMenu.boxId
                  setContextMenu(null)
                  void toggleBoxLockById(boxId)
                }}
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
