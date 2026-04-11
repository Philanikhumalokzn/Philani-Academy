import { CSSProperties, Fragment, Ref, useCallback, useEffect, useMemo, useRef, useState, useImperativeHandle } from 'react'
import type { MathfieldElement as MathfieldElementType } from 'mathlive'

import { createPortal } from 'react-dom'
import { renderToString } from 'katex'
import '@cortex-js/compute-engine'
import BottomSheet from './BottomSheet'
import FullScreenGlassOverlay from './FullScreenGlassOverlay'
import { toDisplayFileName } from '../lib/fileName'
import {
  buildSolutionSessionPayloadV2,
  buildQuestionPayloadV1,
  extractNotebookSaveState,
  extractNotebookSolutionId,
  extractSolutionSessionEditorState,
  getNotebookRevisionKind,
  isNotebookLibraryRecord,
  type NotebookTextBoxRecord,
  type NotebookTextOverlayState,
  type NotebookTextTimelineEvent,
  type NotebookRevisionKind,
  type NotesSaveRecord,
  type NotebookStepRecord,
  type SolutionSessionEditorStateV2,
} from '../lib/stackedCanvasNotebook'
import RecognitionDebugPanel, { DebugSection } from './RecognitionDebugPanel'
import { createLessonRoleProfile, type LessonRoleProfile } from '../lib/lessonAccessControl'
import {
  buildRosterAvatarLayout,
  deriveActivePresenterBadge,
  deriveAvailableRosterAttendees,
  getInitials as getPresenterInitials,
  getUserKey as getPresenterUserKey,
  normalizeDisplayName,
  resolveHandoffSelection,
  waitForResolvedValue,
} from '../lib/presenterControl'
import { evaluateSwitchingAuthorities } from '../lib/switchingBehavior'

function renderTextWithInlineKatex(inputRaw: string) {
  const input = typeof inputRaw === 'string' ? inputRaw : ''
  if (!input) return [input]

  // Supports:
  // - $$...$$ (display)
  // - $...$ (inline)
  // - \[...\] (display)
  // - \(...\) (inline)
  const nodes: Array<string | { kind: 'katex'; display: boolean; expr: string }> = []
  let i = 0
  let segments = 0
  const MAX_MATH_SEGMENTS = 24
  const MAX_MATH_CHARS = 2000

  const pushText = (s: string) => {
    if (!s) return
    const last = nodes[nodes.length - 1]
    if (typeof last === 'string') nodes[nodes.length - 1] = last + s
    else nodes.push(s)
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
    if (tryReadDelimited('$$', '$$', true)) continue
    if (tryReadDelimited('\\[', '\\]', true)) continue
    if (tryReadDelimited('\\(', '\\)', false)) continue

    // Inline $...$ (ignore escaped \$)
    if (input[i] === '$' && (i === 0 || input[i - 1] !== '\\')) {
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
      pushText('$')
      i += 1
      continue
    }

    pushText(input[i])
    i += 1
  }

  return nodes
}

const PHILANI_ERASER_POINTER_TYPE = 'eraser'
const TOUCH_INK_DISAMBIGUATION_DELAY_MS = 50
const TOUCH_INK_PENDING_MOVE_QUEUE_LIMIT = 240
const TOUCH_QUARANTINE_STALE_RESET_MS = 70

function normalizeIinkPointerInfo(info: any, scale: number): any {
  if (!info || typeof info !== 'object') return info
  if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 0.0001) return info

  const next = { ...info }

  const normalizeXY = (target: any) => {
    if (!target || typeof target !== 'object') return
    if (typeof target.x === 'number') target.x = target.x / scale
    if (typeof target.y === 'number') target.y = target.y / scale
  }

  // iink pointer payloads are not consistently typed across runtime builds.
  // Normalize the common relative coordinate shapes that may appear.
  normalizeXY(next)
  if (typeof next.offsetX === 'number') next.offsetX = next.offsetX / scale
  if (typeof next.offsetY === 'number') next.offsetY = next.offsetY / scale
  normalizeXY(next.position)
  normalizeXY(next.point)
  normalizeXY(next.pointer)

  return next
}

function installIinkEraserPointerTypeShim(
  editor: any,
  isEraserActive: () => boolean,
  getInputScale?: () => number,
  getTouchInkDelayMs?: () => number,
): boolean {
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
    const originalCancel = typeof candidate.onPointerCancel === 'function'
      ? candidate.onPointerCancel.bind(candidate)
      : null
    let touchActiveCount = 0
    let touchQuarantine = false
    let lastTouchSignalTs = 0
    const pendingTouchPointers = new Map<number, {
      timer: ReturnType<typeof setTimeout> | null
      downInfo: any
      moveQueue: any[]
      upInfo: any | null
    }>()

    const getSafeScale = () => {
      const scaleRaw = typeof getInputScale === 'function' ? Number(getInputScale()) : 1
      return Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1
    }

    const maybeSyncGeometryForCommit = (scale: number) => {
      if (Math.abs(scale - 1) < 0.0001) return
      try {
        editor.resize?.()
      } catch {}
    }

    const getPointerId = (info: any): number => {
      const raw = (info as any)?.pointerId
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw
      return -1
    }

    const getTouchDelayMs = () => {
      const raw = typeof getTouchInkDelayMs === 'function' ? Number(getTouchInkDelayMs()) : 0
      if (!Number.isFinite(raw) || raw <= 0) return 0
      return Math.round(raw)
    }

    const shouldDelayTouchInk = (info: any) => {
      if (!info || typeof info !== 'object') return false
      if (getTouchDelayMs() <= 0) return false
      return info.pointerType === 'touch'
    }

    const cancelAllPendingTouchPointers = () => {
      if (!pendingTouchPointers.size) return
      for (const [id, pending] of pendingTouchPointers.entries()) {
        if (pending.timer) {
          clearTimeout(pending.timer)
          pending.timer = null
        }
        pendingTouchPointers.delete(id)
      }
    }

    const enterTouchQuarantine = () => {
      touchQuarantine = true
      cancelAllPendingTouchPointers()
    }

    const noteTouchSignal = () => {
      lastTouchSignalTs = Date.now()
    }

    const resetTouchQuarantineState = () => {
      touchActiveCount = 0
      touchQuarantine = false
      cancelAllPendingTouchPointers()
    }

    const maybeResetStaleTouchQuarantine = () => {
      if (!touchQuarantine) return
      const now = Date.now()
      if (!lastTouchSignalTs) {
        resetTouchQuarantineState()
        return
      }
      if ((now - lastTouchSignalTs) > TOUCH_QUARANTINE_STALE_RESET_MS) {
        resetTouchQuarantineState()
      }
    }

    const handleTouchBufferedEnd = (isBufferedTouch: boolean) => {
      if (!isBufferedTouch) return false
      touchActiveCount = Math.max(0, touchActiveCount - 1)
      if (!touchQuarantine) return false
      if (touchActiveCount === 0) {
        touchQuarantine = false
        cancelAllPendingTouchPointers()
      }
      return true
    }

    const flushPendingTouchPointer = (pointerId: number) => {
      const pending = pendingTouchPointers.get(pointerId)
      if (!pending) return

      if (pending.timer) {
        clearTimeout(pending.timer)
        pending.timer = null
      }

      pendingTouchPointers.delete(pointerId)

      originalDown(pending.downInfo)
      if (pending.moveQueue.length) {
        for (const queuedMove of pending.moveQueue) {
          originalMove(queuedMove)
        }
      }

      if (pending.upInfo) {
        const safeScale = getSafeScale()
        const result = originalUp(pending.upInfo)
        if (Math.abs(safeScale - 1) >= 0.0001 && typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => {
            maybeSyncGeometryForCommit(getSafeScale())
          })
        }
        return result
      }

      return undefined
    }

    const buildNext = (info: any) => {
      let next = info
      if (isEraserActive() && info && typeof info === 'object') {
        next = { ...next, pointerType: PHILANI_ERASER_POINTER_TYPE }
      }
      const safeScale = getSafeScale()
      return normalizeIinkPointerInfo(next, safeScale)
    }

    candidate.onPointerDown = (info: any) => {
      const next = buildNext(info)
      const pointerId = getPointerId(next)
      const isBufferedTouch = shouldDelayTouchInk(next)

      if (isBufferedTouch) {
        maybeResetStaleTouchQuarantine()
        noteTouchSignal()
        touchActiveCount += 1
        if (touchActiveCount >= 2) {
          enterTouchQuarantine()
          return undefined
        }
      }

      if (touchQuarantine && isBufferedTouch) {
        return undefined
      }

      if (!isBufferedTouch) {
        return originalDown(next)
      }

      const existingPending = pendingTouchPointers.get(pointerId)
      if (existingPending?.timer) {
        clearTimeout(existingPending.timer)
      }

      const pending = {
        timer: null as ReturnType<typeof setTimeout> | null,
        downInfo: next,
        moveQueue: [] as any[],
        upInfo: null as any | null,
      }
      pending.timer = setTimeout(() => {
        flushPendingTouchPointer(pointerId)
      }, getTouchDelayMs())

      pendingTouchPointers.set(pointerId, pending)
      return undefined
    }

    candidate.onPointerMove = (info: any) => {
      const next = buildNext(info)
      const pointerId = getPointerId(next)
      const isBufferedTouch = shouldDelayTouchInk(next)

      if (isBufferedTouch) {
        noteTouchSignal()
      }

      if (isBufferedTouch && touchQuarantine) {
        return undefined
      }

      const pending = pendingTouchPointers.get(pointerId)
      if (!pending) {
        return originalMove(next)
      }

      pending.moveQueue.push(next)
      if (pending.moveQueue.length > TOUCH_INK_PENDING_MOVE_QUEUE_LIMIT) {
        pending.moveQueue.splice(0, pending.moveQueue.length - TOUCH_INK_PENDING_MOVE_QUEUE_LIMIT)
      }
      return undefined
    }

    candidate.onPointerUp = (info: any) => {
      const next = buildNext(info)
      const pointerId = getPointerId(next)
      const isBufferedTouch = shouldDelayTouchInk(next)

      if (isBufferedTouch) {
        noteTouchSignal()
      }

      if (handleTouchBufferedEnd(isBufferedTouch)) {
        return undefined
      }

      const pending = pendingTouchPointers.get(pointerId)
      if (pending) {
        pending.upInfo = next
        // If the delay window already elapsed, flush immediately.
        if (!pending.timer) {
          return flushPendingTouchPointer(pointerId)
        }
        return undefined
      }

      const safeScale = getSafeScale()
      const result = originalUp(next)
      if (Math.abs(safeScale - 1) >= 0.0001 && typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          maybeSyncGeometryForCommit(getSafeScale())
        })
      }
      return result
    }

    candidate.onPointerCancel = (info: any) => {
      const next = buildNext(info)
      const pointerId = getPointerId(next)
      const isBufferedTouch = shouldDelayTouchInk(next)

      if (isBufferedTouch) {
        noteTouchSignal()
      }

      if (handleTouchBufferedEnd(isBufferedTouch)) {
        return undefined
      }

      const pending = pendingTouchPointers.get(pointerId)
      if (pending) {
        if (pending.timer) {
          clearTimeout(pending.timer)
          pending.timer = null
        }
        pendingTouchPointers.delete(pointerId)
        return undefined
      }

      if (originalCancel) {
        return originalCancel(next)
      }
      return originalUp(next)
    }

    try {
      ;(editor as PhilaniReplayablePointerEditor).__philaniReplayPointerEvent = (type, info) => {
        const next = buildNext(info)
        const pointerId = getPointerId(next)
        const isBufferedTouch = shouldDelayTouchInk(next)

        if (type === 'pointerdown' && isBufferedTouch) {
          maybeResetStaleTouchQuarantine()
          noteTouchSignal()
          touchActiveCount += 1
          if (touchActiveCount >= 2) {
            enterTouchQuarantine()
            return
          }
        }

        if ((type === 'pointermove' || type === 'pointerup' || type === 'pointercancel') && isBufferedTouch) {
          noteTouchSignal()
        }

        if (isBufferedTouch && touchQuarantine) {
          if (type === 'pointerup' || type === 'pointercancel') {
            handleTouchBufferedEnd(true)
          }
          return
        }

        if (type === 'pointerdown') {
          const pending = pendingTouchPointers.get(pointerId)
          if (pending?.timer) {
            clearTimeout(pending.timer)
          }
          pendingTouchPointers.delete(pointerId)
          originalDown(next)
          return
        }
        if (type === 'pointermove') {
          const pending = pendingTouchPointers.get(pointerId)
          if (pending) {
            pending.moveQueue.push(next)
            if (pending.moveQueue.length > TOUCH_INK_PENDING_MOVE_QUEUE_LIMIT) {
              pending.moveQueue.splice(0, pending.moveQueue.length - TOUCH_INK_PENDING_MOVE_QUEUE_LIMIT)
            }
            return
          }
          originalMove(next)
          return
        }

        if (type === 'pointercancel') {
          handleTouchBufferedEnd(isBufferedTouch)

          const pending = pendingTouchPointers.get(pointerId)
          if (pending) {
            if (pending.timer) {
              clearTimeout(pending.timer)
              pending.timer = null
            }
            pendingTouchPointers.delete(pointerId)
            return
          }

          if (originalCancel) {
            originalCancel(next)
          } else {
            originalUp(next)
          }
          return
        }

        if (type === 'pointerup' && isBufferedTouch) {
          handleTouchBufferedEnd(true)
        }

        const pending = pendingTouchPointers.get(pointerId)
        if (pending) {
          pending.upInfo = next
          if (pending.timer) {
            clearTimeout(pending.timer)
            pending.timer = null
          }
          flushPendingTouchPointer(pointerId)
          return
        }

        const safeScale = getSafeScale()
        const result = originalUp(next)
        if (Math.abs(safeScale - 1) >= 0.0001 && typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => {
            maybeSyncGeometryForCommit(getSafeScale())
          })
        }
        return result
      }
    } catch {}

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

type CanvasMode = 'math' | 'raw-ink'

type RecognitionEngine = 'keyboard' | 'myscript' | 'mathpix'

type RawInkPoint = {
  x: number
  y: number
}

type RawInkStroke = {
  id: string
  color: string
  width: number
  points: RawInkPoint[]
}

type RawInkPayload = {
  strokes: RawInkStroke[]
}

type SnapshotPayload = {
  mode?: CanvasMode
  symbols: any[] | null
  rawInk?: RawInkPayload | null
  latex?: string
  jiix?: string | null
  version: number
  snapshotId: string
  baseSymbolCount?: number
}

type PhilaniReplayablePointerEditor = {
  __philaniReplayPointerEvent?: (type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', info: any) => void
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
  isEditing: boolean
}

type TopPanelStepsPayload = {
  steps: TopPanelStepItem[]
  selectedIndex: number | null
  editingIndex: number | null
  options: LatexDisplayOptions
}

type LoadedNotebookRevisionState = {
  saveId: string
  solutionId: string | null
  selectedStepIndex: number | null
  editingStepIndex: number | null
  loadedAt: number
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
  canOrchestrateLesson?: boolean
}

type EditingAuthorityCandidate = {
  userKey: string
  name: string
  clientIds: Set<string>
  grantTs: number
  lastBroadcastTs: number
  reasons: Set<string>
}

type PresenterHandoffTarget = null | {
  clientId: string
  userId?: string
  userKey: string
  displayName: string
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
  canOrchestrateLesson?: boolean
  roleProfile?: LessonRoleProfile
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
  initialComposedLatex?: string
  onLatexOutputChange?: (latex: string) => void
  onComposedLatexChange?: (latex: string) => void
  onRequestVideoOverlay?: () => void
  lessonAuthoring?: { phaseKey: string; pointId: string }
  compactEdgeToEdge?: boolean
  initialRecognitionEngine?: 'keyboard' | 'myscript' | 'mathpix'
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
const DEFAULT_RECOGNITION_ENGINE: RecognitionEngine = 'keyboard'
const DEFAULT_CANVAS_MODE: CanvasMode = 'math'
const RECOGNITION_ENGINE_STORAGE_KEY = 'philani.math.recognition-engine'
const DEBUG_PANEL_STORAGE_KEY = 'philani.math.debug-panel-visible'
const RAW_INK_STROKE_COLOR = '#0f172a'
const RAW_INK_STROKE_WIDTH = 2.6
const RAW_INK_VIEWBOX_SIZE = 1000
const RAW_INK_ERASER_RADIUS = 0.018
const KEYBOARD_ENGINE_TEMPLATES = ['x', 'y', '=', '+', '-', '\\times', '\\div', '\\frac{}{}', '\\sqrt{}', '()', '[]', '^{}']
const KEYBOARD_IDLE_MS = 3000
const KEYBOARD_TRANSIENT_RADICAL_IDLE_MS = 2000
const KEYBOARD_TRANSIENT_RADICAL_INDEX_PROMPT_PREFIX = 'kbd-rad-i-'
const KEYBOARD_TRANSIENT_RADICAL_RADICAND_PROMPT_PREFIX = 'kbd-rad-r-'
const KEYBOARD_REPRESENTATIVE_TAP_MS = 260
const KEYBOARD_REPRESENTATIVE_LONG_PRESS_MS = 420
const KEYBOARD_SWIPE_DISAMBIGUATION_DISTANCE_PX = 14
const KEYBOARD_SWIPE_MIN_DISTANCE_PX = 28
const KEYBOARD_SWIPE_STEP_DISTANCE_PX = 34
const KEYBOARD_SWIPE_HOLD_DELAY_MS = 170
const KEYBOARD_SWIPE_HOLD_REPEAT_MS = 82

type KeyboardActionDefinition = {
  id: string
  title: string
  description: string
  latex?: string
  label?: string
  token?: string
  renderLatex?: (baseSymbol?: string) => string
  apply: (prev: string, baseSymbol?: string) => string
}

type KeyboardRepresentativeKeyDefinition = {
  id: string
  title: string
  description: string
  latex?: string
  label?: string
  singleTapActionId: string
  radialActionIds: string[]
  familyRows: string[][]
  familyTitle: string
}

type KeyboardVisibleKeyDefinition = {
  actionId: string
  label?: string
  insertedToken?: string
  representativeKeyId?: string
}

type KeyboardOverlayAnchor = {
  keyId: string
  x: number
  y: number
}

type KeyboardStageTarget = {
  id: string
  title: string
  description: string
  representativeKeyId: string
  singleTapActionId: string
  displayActionId: string
  radialActionIds: string[]
  familyRows: string[][]
  familyTitle: string
  baseSymbol?: string
  payloadSymbol?: string
  referenceTarget?: KeyboardReferenceTarget | null
}

type KeyboardSwipeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

type KeyboardSelectionState = {
  start: number
  end: number
}

type KeyboardReferenceTarget = {
  start: number
  end: number
  symbol: string
}

type KeyboardEditResult = {
  value: string
  selectionStart: number
  selectionEnd: number
}

type KeyboardRadicalRegion = {
  start: number
  end: number
  hasIndex: boolean
  indexGroupStart: number | null
  indexGroupEnd: number | null
  indexContentStart: number | null
  indexContentEnd: number | null
  indexSymbol: string
  radicandGroupStart: number
  radicandGroupEnd: number
  radicandContentStart: number
  radicandContentEnd: number
  radicandSymbol: string
}

type KeyboardPromptPlaceholder = {
  id: string | null
  body: string
}

type KeyboardPromptPlaceholderOccurrence = KeyboardPromptPlaceholder & {
  start: number
  end: number
  prefix: string
  suffix: string
}

type KeyboardTransientRadicalPromptIds = {
  radicalId: string
  indexPromptId: string
  radicandPromptId: string
}

type KeyboardTransientRadicalProgrammaticEditContext = {
  anchorStart: number
  promptIds: KeyboardTransientRadicalPromptIds
  targetField: 'index' | 'radicand'
  targetSelectionStart: number
  targetSelectionEnd: number
}

type KeyboardTransientRadicalSelectionIntent = {
  anchorSelection: KeyboardSelectionState
  command: string
}

type KeyboardRadicalRewriteResult = {
  value: string
  selectionStart: number
  selectionEnd: number
  radicandPromptId: string | null
}

type KeyboardHistoryAwareMathfield = MathfieldElementType & {
  canUndo?: () => boolean
  canRedo?: () => boolean
  undoDepth?: number
  redoDepth?: number
}

type KeyboardMountedRowDefinition = {
  id: string
  label: string
  actionIds: string[]
}

const KEYBOARD_RADIAL_POSITIONS = [
  { actionIndex: 0, className: 'left-1/2 top-2 -translate-x-1/2' },
  { actionIndex: 1, className: 'right-10 top-8' },
  { actionIndex: 2, className: 'right-3 top-1/2 -translate-y-1/2' },
  { actionIndex: 3, className: 'bottom-8 right-10' },
  { actionIndex: 4, className: 'bottom-2 left-1/2 -translate-x-1/2' },
  { actionIndex: 5, className: 'bottom-8 left-10' },
  { actionIndex: 6, className: 'left-3 top-1/2 -translate-y-1/2' },
  { actionIndex: 7, className: 'left-10 top-8' },
] as const

const removeLastKeyboardChunk = (value: string) => {
  const trimmed = value.trimEnd()
  if (!trimmed) return ''
  const patterns = [
    /\\left\([^)]*\\right\)$/,
    /\\sqrt\{[^{}]*\}$/,
    /\\frac\{[^{}]*\}\{\\phantom\{a\}\}$/,
    /\\cdot\s*$/,
    /\\ast\s*$/,
    /\\leq\s*$/,
    /\\geq\s*$/,
    /\\pm\s*$/,
    /\\mp\s*$/,
    /\\setminus\s*$/,
    /\\times\s*$/,
    /\\div\s*$/,
    /\\sum\s*$/,
    /\\prod\s*$/,
    /\^\{2\}$/,
    /[+\-=()/:]\s*$/,
    /x\s*$/,
  ]
  for (const pattern of patterns) {
    if (pattern.test(trimmed)) {
      return trimmed.replace(pattern, '').trimEnd()
    }
  }
  return trimmed.slice(0, -1).trimEnd()
}

const isEmptyFractionDenominatorPlaceholderAtPosition = (value: string, position: number) => {
  // Match denominators that are empty ({}) or still contain our placeholder (#? / \placeholder{...})
  const pattern = /\\frac\{[^{}]*\}(\{#\?\}|\{\\placeholder(?:\{[^{}]*\})?\}|\{\})/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value)) !== null) {
    const denomStart = match.index + match[0].indexOf(match[1])
    const denomEnd = denomStart + match[1].length
    if (position >= denomStart && position <= denomEnd) {
      return true
    }
  }
  return false
}

const findKeyboardBalancedGroupEnd = (value: string, startIndex: number, openChar: string, closeChar: string) => {
  let depth = 0
  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index]
    if (char === openChar) {
      depth += 1
      continue
    }
    if (char === closeChar) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

const parseKeyboardPromptPlaceholder = (value: string): KeyboardPromptPlaceholder | null => {
  const trimmed = value.trim()
  if (!trimmed.startsWith('\\placeholder')) return null

  let cursor = '\\placeholder'.length
  let id: string | null = null

  if (trimmed[cursor] === '[') {
    const indexGroupEnd = findKeyboardBalancedGroupEnd(trimmed, cursor, '[', ']')
    if (indexGroupEnd < 0) return null
    id = trimmed.slice(cursor + 1, indexGroupEnd)
    cursor = indexGroupEnd + 1
  }

  if (trimmed[cursor] !== '{') return null
  const bodyGroupEnd = findKeyboardBalancedGroupEnd(trimmed, cursor, '{', '}')
  if (bodyGroupEnd < 0 || bodyGroupEnd !== trimmed.length - 1) return null

  return {
    id,
    body: trimmed.slice(cursor + 1, bodyGroupEnd),
  }
}

const findKeyboardPromptPlaceholderOccurrence = (
  value: string,
  expectedPromptId?: string | null,
): KeyboardPromptPlaceholderOccurrence | null => {
  let searchIndex = 0

  while (searchIndex < value.length) {
    const placeholderStart = value.indexOf('\\placeholder', searchIndex)
    if (placeholderStart < 0) return null

    let cursor = placeholderStart + '\\placeholder'.length
    let id: string | null = null

    if (value[cursor] === '[') {
      const idGroupEnd = findKeyboardBalancedGroupEnd(value, cursor, '[', ']')
      if (idGroupEnd < 0) return null
      id = value.slice(cursor + 1, idGroupEnd)
      cursor = idGroupEnd + 1
    }

    if (value[cursor] !== '{') {
      searchIndex = placeholderStart + 1
      continue
    }

    const bodyGroupEnd = findKeyboardBalancedGroupEnd(value, cursor, '{', '}')
    if (bodyGroupEnd < 0) return null

    if (expectedPromptId == null || id === expectedPromptId) {
      return {
        id,
        body: value.slice(cursor + 1, bodyGroupEnd),
        start: placeholderStart,
        end: bodyGroupEnd + 1,
        prefix: value.slice(0, placeholderStart),
        suffix: value.slice(bodyGroupEnd + 1),
      }
    }

    searchIndex = bodyGroupEnd + 1
  }

  return null
}

const isKeyboardPlaceholderExpression = (symbol: string) => {
  const trimmed = symbol.trim()
  if (!trimmed) return true
  if (/^#\?$/.test(trimmed)) return true

  const prompt = parseKeyboardPromptPlaceholder(trimmed)
  if (prompt) {
    const promptBody = prompt.body.trim()
    return !promptBody || isKeyboardPlaceholderExpression(promptBody)
  }

  return /^\\placeholder(?:\{[^{}]*\})?$/.test(trimmed)
}

const buildKeyboardTransientRadicalIndexPromptId = (radicalId: string) => `${KEYBOARD_TRANSIENT_RADICAL_INDEX_PROMPT_PREFIX}${radicalId}`

const buildKeyboardTransientRadicalRadicandPromptId = (radicalId: string) => `${KEYBOARD_TRANSIENT_RADICAL_RADICAND_PROMPT_PREFIX}${radicalId}`

const getKeyboardTransientRadicalPromptIds = (radicalId: string): KeyboardTransientRadicalPromptIds => ({
  radicalId,
  indexPromptId: buildKeyboardTransientRadicalIndexPromptId(radicalId),
  radicandPromptId: buildKeyboardTransientRadicalRadicandPromptId(radicalId),
})

const buildKeyboardTransientRadicalIndexSegment = (indexPromptId: string, indexLatex = '') => indexLatex.trim()
  ? `[${indexLatex}]`
  : `[\\placeholder[${indexPromptId}]{}]`

const buildKeyboardTransientRadicalRadicandSegment = (radicandPromptId: string, radicandLatex = '') => radicandLatex.trim()
  ? `{${radicandLatex}}`
  : `{\\placeholder[${radicandPromptId}]{}}`

const buildKeyboardTransientRadicalLatex = (
  promptIds: KeyboardTransientRadicalPromptIds,
  radicandLatex = '',
  indexLatex = '',
) => `\\sqrt${buildKeyboardTransientRadicalIndexSegment(promptIds.indexPromptId, indexLatex)}${buildKeyboardTransientRadicalRadicandSegment(promptIds.radicandPromptId, radicandLatex)}`

const buildKeyboardCollapsedTransientRadicalLatex = (
  promptIds: KeyboardTransientRadicalPromptIds,
  radicandLatex = '',
) => `\\sqrt${buildKeyboardTransientRadicalRadicandSegment(promptIds.radicandPromptId, radicandLatex)}`

const normalizeKeyboardTransientRadicalFieldContent = (symbol: string, promptId: string) => {
  const occurrence = findKeyboardPromptPlaceholderOccurrence(symbol, promptId)
  return occurrence
    ? `${occurrence.prefix}${occurrence.body}${occurrence.suffix}`
    : symbol
}

const getKeyboardTransientRadicalFieldSelectionOffset = (
  regionStart: number,
  promptIds: KeyboardTransientRadicalPromptIds,
  indexLatex: string,
  radicandLatex: string,
  targetField: 'index' | 'radicand',
  expanded: boolean,
) => {
  if (targetField === 'index') {
    return regionStart + '\\sqrt['.length + indexLatex.length
  }

  const prefix = expanded
    ? `\\sqrt${buildKeyboardTransientRadicalIndexSegment(promptIds.indexPromptId, indexLatex)}{`
    : '\\sqrt{'
  return regionStart + prefix.length + radicandLatex.length
}

const getKeyboardTransientRadicalSerializedPrefixLength = (
  regionStart: number,
  indexLatex: string,
  radicandLatex: string,
  targetField: 'index' | 'radicand',
) => regionStart + indexLatex.length + (targetField === 'radicand' ? radicandLatex.length : 0)

const getKeyboardTransientRadicalFieldSelectionRange = (
  selection: KeyboardSelectionState,
  indexLatex: string,
  radicandLatex: string,
  targetField: 'index' | 'radicand',
): KeyboardSelectionState => {
  const normalizedStart = Math.max(0, Math.min(selection.start, selection.end))
  const normalizedEnd = Math.max(normalizedStart, Math.max(selection.start, selection.end))
  const prefixLength = targetField === 'radicand' ? indexLatex.length : 0
  const fieldLength = targetField === 'index' ? indexLatex.length : radicandLatex.length

  const selectionStart = Math.max(0, Math.min(fieldLength, normalizedStart - prefixLength))
  const selectionEnd = Math.max(selectionStart, Math.min(fieldLength, normalizedEnd - prefixLength))

  return {
    start: selectionStart,
    end: selectionEnd,
  }
}

const resolveKeyboardTransientRadicalFieldFromSelection = (
  region: KeyboardRadicalRegion,
  selection: KeyboardSelectionState,
  storedTargetField?: 'index' | 'radicand' | null,
  promptIds?: KeyboardTransientRadicalPromptIds | null,
): 'index' | 'radicand' => {
  if (!region.hasIndex) return 'radicand'

  const selectionStart = Math.max(0, Math.min(selection.start, selection.end))
  const selectionEnd = Math.max(0, Math.max(selection.start, selection.end))
  const indexLatex = promptIds && region.hasIndex
    ? normalizeKeyboardTransientRadicalFieldContent(region.indexSymbol, promptIds.indexPromptId)
    : region.indexSymbol
  const indexBoundary = indexLatex.length

  if (selectionEnd < indexBoundary) return 'index'
  if (selectionStart > indexBoundary) return 'radicand'

  return storedTargetField ?? 'radicand'
}

const buildKeyboardCanonicalTransientRadicalFromRegion = (
  region: KeyboardRadicalRegion,
  promptIds: KeyboardTransientRadicalPromptIds,
) => {
  const indexLatex = region.hasIndex
    ? normalizeKeyboardTransientRadicalFieldContent(region.indexSymbol, promptIds.indexPromptId)
    : ''
  const radicandLatex = normalizeKeyboardTransientRadicalFieldContent(region.radicandSymbol, promptIds.radicandPromptId)
  const value = region.hasIndex
    ? buildKeyboardTransientRadicalLatex(promptIds, radicandLatex, indexLatex)
    : buildKeyboardCollapsedTransientRadicalLatex(promptIds, radicandLatex)

  return {
    value,
    indexLatex,
    radicandLatex,
  }
}

const getKeyboardTransientRadicalIdFromPromptId = (promptId: string | null | undefined) => {
  if (!promptId) return null
  if (promptId.startsWith(KEYBOARD_TRANSIENT_RADICAL_INDEX_PROMPT_PREFIX)) {
    return promptId.slice(KEYBOARD_TRANSIENT_RADICAL_INDEX_PROMPT_PREFIX.length)
  }
  if (promptId.startsWith(KEYBOARD_TRANSIENT_RADICAL_RADICAND_PROMPT_PREFIX)) {
    return promptId.slice(KEYBOARD_TRANSIENT_RADICAL_RADICAND_PROMPT_PREFIX.length)
  }
  return null
}

const resolveKeyboardTransientRadicalPromptIds = (region: KeyboardRadicalRegion): KeyboardTransientRadicalPromptIds | null => {
  const indexPrompt = parseKeyboardPromptPlaceholder(region.indexSymbol)
  const radicandPrompt = parseKeyboardPromptPlaceholder(region.radicandSymbol)
  const radicalId = getKeyboardTransientRadicalIdFromPromptId(indexPrompt?.id)
    || getKeyboardTransientRadicalIdFromPromptId(radicandPrompt?.id)
  if (!radicalId) return null
  return getKeyboardTransientRadicalPromptIds(radicalId)
}

const selectKeyboardMathfieldPrompt = (
  field: MathfieldElementType | null | undefined,
  promptId: string | null | undefined,
) => {
  if (!field || !promptId) return false

  const promptField = field as MathfieldElementType & {
    getPromptRange?: (id: string) => [number, number] | null
    selection?: { ranges: [number, number][]; direction?: 'forward' | 'backward' | 'none' } | [number, number]
  }

  const promptRange = promptField.getPromptRange?.(promptId)
  if (!promptRange) return false

  try {
    promptField.selection = {
      ranges: [promptRange],
      direction: 'none',
    }
    return true
  } catch {
    try {
      promptField.selection = promptRange
      return true
    } catch {
      return false
    }
  }
}

const parseKeyboardRadicalRegionAt = (value: string, sqrtIndex: number): KeyboardRadicalRegion | null => {
  if (sqrtIndex < 0 || !value.startsWith('\\sqrt', sqrtIndex)) return null

  let cursor = sqrtIndex + '\\sqrt'.length
  let hasIndex = false
  let indexGroupStart: number | null = null
  let indexGroupEnd: number | null = null
  let indexContentStart: number | null = null
  let indexContentEnd: number | null = null
  let indexSymbol = ''

  if (value[cursor] === '[') {
    const resolvedIndexGroupEnd = findKeyboardBalancedGroupEnd(value, cursor, '[', ']')
    if (resolvedIndexGroupEnd < 0) return null
    hasIndex = true
    indexGroupStart = cursor
    indexGroupEnd = resolvedIndexGroupEnd
    indexContentStart = cursor + 1
    indexContentEnd = resolvedIndexGroupEnd
    indexSymbol = value.slice(indexContentStart, indexContentEnd)
    cursor = resolvedIndexGroupEnd + 1
  }

  if (value[cursor] !== '{') return null

  const radicandGroupStart = cursor
  const radicandGroupEnd = findKeyboardBalancedGroupEnd(value, radicandGroupStart, '{', '}')
  if (radicandGroupEnd < 0) return null

  return {
    start: sqrtIndex,
    end: radicandGroupEnd + 1,
    hasIndex,
    indexGroupStart,
    indexGroupEnd,
    indexContentStart,
    indexContentEnd,
    indexSymbol,
    radicandGroupStart,
    radicandGroupEnd,
    radicandContentStart: radicandGroupStart + 1,
    radicandContentEnd: radicandGroupEnd,
    radicandSymbol: value.slice(radicandGroupStart + 1, radicandGroupEnd),
  }
}

const findKeyboardRadicalRegionAtPosition = (value: string, position: number): KeyboardRadicalRegion | null => {
  let bestMatch: KeyboardRadicalRegion | null = null
  let searchIndex = 0
  const normalizedPosition = Math.max(0, Math.min(position, value.length))

  while (searchIndex < value.length) {
    const sqrtIndex = value.indexOf('\\sqrt', searchIndex)
    if (sqrtIndex < 0) break

    const region = parseKeyboardRadicalRegionAt(value, sqrtIndex)
    searchIndex = sqrtIndex + 1
    if (!region) continue

    if (normalizedPosition < region.start || normalizedPosition > region.end) continue
    if (!bestMatch || (region.end - region.start) <= (bestMatch.end - bestMatch.start)) {
      bestMatch = region
    }
  }

  return bestMatch
}

const findKeyboardRadicalRegionNearStart = (value: string, approxStart: number): KeyboardRadicalRegion | null => {
  let bestMatch: KeyboardRadicalRegion | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  let searchIndex = 0

  while (searchIndex < value.length) {
    const sqrtIndex = value.indexOf('\\sqrt', searchIndex)
    if (sqrtIndex < 0) break

    const region = parseKeyboardRadicalRegionAt(value, sqrtIndex)
    searchIndex = sqrtIndex + 1
    if (!region) continue

    const distance = Math.abs(region.start - approxStart)
    if (distance < bestDistance) {
      bestMatch = region
      bestDistance = distance
    }
  }

  return bestMatch
}

const isKeyboardRadicalIndexEmpty = (region: KeyboardRadicalRegion) => {
  if (!region.hasIndex) return true
  const trimmed = region.indexSymbol.trim()
  if (!trimmed) return true
  const prompt = parseKeyboardPromptPlaceholder(trimmed)
  if (prompt) return !prompt.body.trim() || isKeyboardPlaceholderExpression(prompt.body)
  return isKeyboardPlaceholderExpression(trimmed)
}

const mapKeyboardSelectionOffsetAfterRadicalExpansion = (region: KeyboardRadicalRegion, offset: number, insertedLength: number) => {
  if (offset <= region.radicandGroupStart) return offset
  return offset + insertedLength
}

const mapKeyboardSelectionOffsetAfterRadicalCollapse = (region: KeyboardRadicalRegion, offset: number) => {
  if (!region.hasIndex || region.indexGroupStart === null || region.indexGroupEnd === null) return offset
  const removedLength = region.indexGroupEnd - region.indexGroupStart + 1
  const collapsedRadicandContentStart = region.radicandContentStart - removedLength
  if (offset <= region.indexGroupStart) return offset
  if (offset <= region.radicandContentStart) return collapsedRadicandContentStart
  return Math.max(collapsedRadicandContentStart, offset - removedLength)
}

const expandKeyboardCollapsedRadical = (
  value: string,
  selection: KeyboardSelectionState,
  region: KeyboardRadicalRegion,
  promptIdsOverride?: KeyboardTransientRadicalPromptIds | null,
): KeyboardRadicalRewriteResult | null => {
  if (region.hasIndex) return null
  const promptIds = resolveKeyboardTransientRadicalPromptIds(region) || promptIdsOverride
  if (!promptIds) return null

  const radicandLatex = normalizeKeyboardTransientRadicalFieldContent(region.radicandSymbol, promptIds.radicandPromptId)
  const nextRadical = buildKeyboardTransientRadicalLatex(promptIds, radicandLatex)
  const nextValue = `${value.slice(0, region.start)}${nextRadical}${value.slice(region.end)}`
  const hasRadicandContent = Boolean(radicandLatex.trim())
  const radicandSelectionOffset = hasRadicandContent
    ? getKeyboardTransientRadicalFieldSelectionOffset(region.start, promptIds, '', radicandLatex, 'radicand', true)
    : mapKeyboardSelectionOffsetAfterRadicalExpansion(region, selection.end, buildKeyboardTransientRadicalIndexSegment(promptIds.indexPromptId).length)
  return {
    value: nextValue,
    selectionStart: hasRadicandContent ? radicandSelectionOffset : mapKeyboardSelectionOffsetAfterRadicalExpansion(region, selection.start, buildKeyboardTransientRadicalIndexSegment(promptIds.indexPromptId).length),
    selectionEnd: radicandSelectionOffset,
    radicandPromptId: hasRadicandContent ? null : promptIds.radicandPromptId,
  }
}

const collapseKeyboardExpandedRadical = (value: string, selection: KeyboardSelectionState, region: KeyboardRadicalRegion) => {
  if (!region.hasIndex || region.indexGroupStart === null || region.indexGroupEnd === null) return null
  if (!isKeyboardRadicalIndexEmpty(region)) return null

  const promptIds = resolveKeyboardTransientRadicalPromptIds(region)
  const collapsedRadicandBody = promptIds
    ? normalizeKeyboardTransientRadicalFieldContent(region.radicandSymbol, promptIds.radicandPromptId)
    : region.radicandSymbol

  const collapsedRadical = promptIds
    ? buildKeyboardCollapsedTransientRadicalLatex(promptIds, collapsedRadicandBody)
    : `${value.slice(region.start, region.indexGroupStart)}${value.slice(region.radicandGroupStart, region.end)}`
  const nextValue = `${value.slice(0, region.start)}${collapsedRadical}${value.slice(region.end)}`
  return {
    value: nextValue,
    selectionStart: mapKeyboardSelectionOffsetAfterRadicalCollapse(region, selection.start),
    selectionEnd: mapKeyboardSelectionOffsetAfterRadicalCollapse(region, selection.end),
    radicandPromptId: collapsedRadicandBody.trim() ? null : promptIds?.radicandPromptId ?? null,
  }
}

const findKeyboardFractionDenominatorRegionAtPosition = (value: string, position: number): KeyboardReferenceTarget | null => {
  let bestMatch: KeyboardReferenceTarget | null = null
  let searchIndex = 0

  while (searchIndex < value.length) {
    const fracIndex = value.indexOf('\\frac', searchIndex)
    if (fracIndex < 0) break

    const numeratorOpen = fracIndex + '\\frac'.length
    if (value[numeratorOpen] !== '{') {
      searchIndex = fracIndex + 1
      continue
    }

    const numeratorClose = findKeyboardBalancedGroupEnd(value, numeratorOpen, '{', '}')
    const denominatorOpen = numeratorClose >= 0 ? numeratorClose + 1 : -1
    if (numeratorClose < 0 || value[denominatorOpen] !== '{') {
      searchIndex = fracIndex + 1
      continue
    }

    const denominatorClose = findKeyboardBalancedGroupEnd(value, denominatorOpen, '{', '}')
    if (denominatorClose < 0) {
      searchIndex = fracIndex + 1
      continue
    }

    const targetStart = denominatorOpen + 1
    const targetEnd = denominatorClose
    const containsPosition = position >= targetStart && position <= targetEnd
    if (containsPosition) {
      const symbol = value.slice(targetStart, targetEnd)
      if (symbol.trim() && !isKeyboardPlaceholderExpression(symbol)) {
        if (!bestMatch || (targetEnd - targetStart) <= (bestMatch.end - bestMatch.start)) {
          bestMatch = { start: targetStart, end: targetEnd, symbol }
        }
      }
    }

    searchIndex = fracIndex + 1
  }

  return bestMatch
}

const replaceDisplayPromptPlaceholders = (latex: string): string => {
  if (!latex || !latex.includes('\\placeholder')) return latex

  let normalized = ''
  let cursor = 0

  while (cursor < latex.length) {
    const placeholderStart = latex.indexOf('\\placeholder', cursor)
    if (placeholderStart < 0) {
      normalized += latex.slice(cursor)
      break
    }

    normalized += latex.slice(cursor, placeholderStart)

    let groupCursor = placeholderStart + '\\placeholder'.length
    if (latex[groupCursor] === '[') {
      const promptIdGroupEnd = findKeyboardBalancedGroupEnd(latex, groupCursor, '[', ']')
      if (promptIdGroupEnd < 0) {
        normalized += latex.slice(placeholderStart)
        break
      }
      groupCursor = promptIdGroupEnd + 1
    }

    if (latex[groupCursor] !== '{') {
      normalized += '\\placeholder'
      cursor = placeholderStart + '\\placeholder'.length
      continue
    }

    const bodyGroupEnd = findKeyboardBalancedGroupEnd(latex, groupCursor, '{', '}')
    if (bodyGroupEnd < 0) {
      normalized += latex.slice(placeholderStart)
      break
    }

    const placeholderBody = latex.slice(groupCursor + 1, bodyGroupEnd)
    const normalizedBody = replaceDisplayPromptPlaceholders(placeholderBody)
    normalized += normalizedBody.trim() ? normalizedBody : '\\square'
    cursor = bodyGroupEnd + 1
  }

  return normalized
}

const normalizeDisplayPlaceholdersToBoxes = (latex: string) => {
  if (!latex) return ''
  return replaceDisplayPromptPlaceholders(latex)
    .replace(/#\?/g, '\\square')
    .replace(/\\placeholder(?:\{[^{}]*\})?/g, '\\square')
    .replace(/\\phantom\{a\}/g, '\\square')
    .replace(/\\frac\{\}\{\}/g, '\\frac{\\square}{\\square}')
    .replace(/\\frac\{([^{}]*)\}\{\}/g, '\\frac{$1}{\\square}')
    .replace(/\\frac\{\}\{([^{}]*)\}/g, '\\frac{\\square}{$1}')
}

const isLatexCommandFragment = (symbol: string) => {
  // Reject partial or complete LaTeX structural command names that are
  // part of the expression syntax, not a mathematical quantity.
  // e.g. \fr, \fra, \frac, \sq, \sqrt, \left – these appear when
  // field.position (an atom index) is mistakenly used as a string offset.
  return /^\\[a-zA-Z]{0,6}$/.test(symbol)
}

const isValidKeyboardExpressionEndForScript = (value: string) => {
  // Used only for the fallback insert path where we are not relying on atom
  // positions at all — just whether the expression ends with something
  // that can serve as a base: a word char, a closing bracket/brace/paren,
  // or a special symbol.
  const trimmed = value.trimEnd()
  if (!trimmed) return false
  if (/[\w\u03b1-\u03c9\u0391-\u03a9\u221e\u221a]$/.test(trimmed)) return true
  if (/[})\]|]$/.test(trimmed)) return true
  return false
}

const createAppendTextKeyboardAction = (
  id: string,
  text: string,
  title = text,
  description = text,
): KeyboardActionDefinition => ({
  id,
  title,
  description,
  token: text,
  label: text,
  renderLatex: () => text,
  apply: (prev) => `${prev}${text}`,
})

const createAppendLatexKeyboardAction = (
  id: string,
  latex: string,
  title: string,
  description: string,
  insertedText?: string,
): KeyboardActionDefinition => ({
  id,
  title,
  description,
  latex,
  renderLatex: () => latex,
  apply: (prev) => `${prev}${insertedText ?? latex}`,
})

const resolveKeyboardBaseSymbol = (baseSymbol?: string, fallback = 'x') => {
  const trimmed = typeof baseSymbol === 'string' ? baseSymbol.trim() : ''
  return trimmed || fallback
}

const createWrappedLatexKeyboardAction = (
  id: string,
  title: string,
  description: string,
  render: (baseSymbol: string) => string,
  insert?: (baseSymbol: string) => string,
): KeyboardActionDefinition => ({
  id,
  title,
  description,
  renderLatex: (baseSymbol) => render(resolveKeyboardBaseSymbol(baseSymbol, '#?')),
  apply: (prev, baseSymbol) => `${prev}${(insert ?? render)(resolveKeyboardBaseSymbol(baseSymbol, '#?'))}`,
})

const getKeyboardPreviousNonWhitespaceIndex = (value: string, selectionStart: number) => {
  let index = Math.max(0, Math.min(selectionStart, value.length)) - 1
  while (index >= 0 && /\s/.test(value[index])) index -= 1
  return index
}

const isKeyboardUnaryMinusContext = (value: string, selection: KeyboardSelectionState) => {
  const previousIndex = getKeyboardPreviousNonWhitespaceIndex(value, selection.start)
  if (previousIndex < 0) return true

  const prefix = value.slice(0, previousIndex + 1).trimEnd()
  const previousChar = prefix[prefix.length - 1] || ''

  if (['(', '[', '{', '=', '+', '-', '*', '/', '^', '_', ':', ',', ';', '<', '>', '|'].includes(previousChar)) {
    return true
  }
  if (['×', '÷', '≤', '≥', '≠', '≈'].includes(previousChar)) {
    return true
  }
  if (/\\(?:times|div|cdot|ast|pm|mp|leq|geq|neq|approx|to|setminus)$/.test(prefix)) {
    return true
  }

  return false
}

const resolveKeyboardDirectInsertText = (
  actionId: string,
  value: string,
  selection: KeyboardSelectionState,
) => {
  switch (actionId) {
    case 'plus':
      return ' + '
    case 'minus':
      return isKeyboardUnaryMinusContext(value, selection) ? '-' : ' - '
    case 'equals':
      return ' = '
    case 'times':
      return ' \\times '
    case 'cdot':
      return ' \\cdot '
    case 'ast':
      return ' \\ast '
    case 'divide':
      return ' \\div '
    case 'slash':
      return ' / '
    case 'ratio':
      return ' : '
    case 'leq':
      return ' \\leq '
    case 'geq':
      return ' \\geq '
    case 'pm':
      return ' \\pm '
    case 'mp':
      return ' \\mp '
    case 'sum':
      return '\\sum'
    case 'product':
      return '\\prod'
    case 'setminus':
      return ' \\setminus '
    default:
      return null
  }
}

const KEYBOARD_ACTIONS: KeyboardActionDefinition[] = [
  createAppendTextKeyboardAction('x', 'x', 'x', 'x'),
  createAppendTextKeyboardAction('y', 'y', 'y', 'y'),
  createAppendTextKeyboardAction('q', 'q', 'q', 'q'),
  createAppendTextKeyboardAction('w', 'w', 'w', 'w'),
  createAppendTextKeyboardAction('e', 'e', 'e', 'e'),
  createAppendTextKeyboardAction('r', 'r', 'r', 'r'),
  createAppendTextKeyboardAction('t', 't', 't', 't'),
  createAppendTextKeyboardAction('u', 'u', 'u', 'u'),
  createAppendTextKeyboardAction('i', 'i', 'i', 'i'),
  createAppendTextKeyboardAction('o', 'o', 'o', 'o'),
  createAppendTextKeyboardAction('p', 'p', 'p', 'p'),
  createAppendTextKeyboardAction('a', 'a', 'a', 'a'),
  createAppendTextKeyboardAction('s', 's', 's', 's'),
  createAppendTextKeyboardAction('d', 'd', 'd', 'd'),
  createAppendTextKeyboardAction('f', 'f', 'f', 'f'),
  createAppendTextKeyboardAction('g', 'g', 'g', 'g'),
  createAppendTextKeyboardAction('h', 'h', 'h', 'h'),
  createAppendTextKeyboardAction('j', 'j', 'j', 'j'),
  createAppendTextKeyboardAction('k', 'k', 'k', 'k'),
  createAppendTextKeyboardAction('l', 'l', 'l', 'l'),
  createAppendTextKeyboardAction('z', 'z', 'z', 'z'),
  createAppendTextKeyboardAction('c', 'c', 'c', 'c'),
  createAppendTextKeyboardAction('v', 'v', 'v', 'v'),
  createAppendTextKeyboardAction('b', 'b', 'b', 'b'),
  createAppendTextKeyboardAction('n', 'n', 'n', 'n'),
  createAppendTextKeyboardAction('m', 'm', 'm', 'm'),
  createAppendTextKeyboardAction('digit-1', '1', '1', '1'),
  createAppendTextKeyboardAction('digit-2', '2', '2', '2'),
  createAppendTextKeyboardAction('digit-3', '3', '3', '3'),
  createAppendTextKeyboardAction('digit-4', '4', '4', '4'),
  createAppendTextKeyboardAction('digit-5', '5', '5', '5'),
  createAppendTextKeyboardAction('digit-6', '6', '6', '6'),
  createAppendTextKeyboardAction('digit-7', '7', '7', '7'),
  createAppendTextKeyboardAction('digit-8', '8', '8', '8'),
  createAppendTextKeyboardAction('digit-9', '9', '9', '9'),
  createAppendTextKeyboardAction('digit-0', '0', '0', '0'),
  createAppendTextKeyboardAction('decimal', '.', 'decimal point', 'decimal point'),
  createAppendTextKeyboardAction('comma', ',', 'comma', 'comma'),
  createAppendTextKeyboardAction('space', ' ', 'space', 'space'),
  {
    id: 'uppercase',
    title: 'uppercase',
    description: 'uppercase',
    label: '↑',
    apply: (prev) => prev,
  },
  createAppendTextKeyboardAction('pi', 'π', 'pi', 'pi'),
  createAppendTextKeyboardAction('theta', 'θ', 'theta', 'theta'),
  createAppendTextKeyboardAction('degree', '°', 'degree', 'degree symbol'),
  createAppendTextKeyboardAction('infinity', '∞', 'infinity', 'infinity'),
  createAppendTextKeyboardAction('percent', '%', 'percent', 'percent'),
  createAppendTextKeyboardAction('to', ' → ', 'approaches', 'approaches'),
  createAppendLatexKeyboardAction('plus', '+', 'plus', 'plus', ' + '),
  {
    id: 'minus',
    title: 'minus',
    description: 'minus or negative sign',
    latex: '-',
    renderLatex: () => '-',
    apply: (prev) => `${prev} - `,
  },
  createAppendLatexKeyboardAction('pm', '\\pm', 'plus or minus', 'plus or minus', ' \\pm '),
  createAppendLatexKeyboardAction('sum', '\\sum', 'summation', 'summation', '\\sum'),
  createAppendLatexKeyboardAction('equals', '=', 'equals', 'equals', ' = '),
  createAppendLatexKeyboardAction('times', '\\times', 'times', 'times', ' \\times '),
  createAppendLatexKeyboardAction('cdot', '\\cdot', 'dot operator', 'dot operator', ' \\cdot '),
  createAppendLatexKeyboardAction('ast', '\\ast', 'asterisk multiplication', 'asterisk multiplication', ' \\ast '),
  createAppendLatexKeyboardAction('product', '\\prod', 'product', 'product', '\\prod'),
  createAppendLatexKeyboardAction('divide', '\\div', 'divide', 'divide', ' \\div '),
  createAppendLatexKeyboardAction('slash', '/', 'slash division', 'slash division', ' / '),
  createAppendLatexKeyboardAction('ratio', ':', 'ratio', 'ratio', ' : '),
  createAppendLatexKeyboardAction('mp', '\\mp', 'minus or plus', 'minus or plus', ' \\mp '),
  createAppendLatexKeyboardAction('setminus', '\\setminus', 'set difference', 'set difference', ' \\setminus '),
  createAppendTextKeyboardAction('lt', ' < ', 'less than', 'less than'),
  createAppendTextKeyboardAction('gt', ' > ', 'greater than', 'greater than'),
  createAppendTextKeyboardAction('neq', ' ≠ ', 'not equal to', 'not equal to'),
  createAppendTextKeyboardAction('approx', ' ≈ ', 'approximately equal to', 'approximately equal to'),
  {
    id: 'power2',
    title: 'square',
    description: 'square',
    latex: '#?^{2}',
    renderLatex: (baseSymbol) => `${baseSymbol || '#?'}^{2}`,
    apply: (prev, baseSymbol) => `${prev || (baseSymbol || 'x')}^2`,
  },
  {
    id: 'power3',
    title: 'cube',
    description: 'cube',
    latex: 'x^{3}',
    renderLatex: (baseSymbol) => `${baseSymbol || 'x'}^{3}`,
    apply: (prev, baseSymbol) => `${prev || (baseSymbol || 'x')}^3`,
  },
  {
    id: 'subscript',
    title: 'subscript',
    description: 'subscript',
    latex: 'x_{i}',
    renderLatex: (baseSymbol) => `${baseSymbol || 'x'}_{i}`,
    apply: (prev, baseSymbol) => `${prev || (baseSymbol || 'x')}_i`,
  },
  {
    id: 'sqrt',
    title: 'square root',
    description: 'square root',
    latex: '\\sqrt{x}',
    renderLatex: (baseSymbol) => `\\sqrt{${baseSymbol || 'x'}}`,
    apply: (prev, baseSymbol) => `${prev}sqrt(${baseSymbol || 'x'})`,
  },
  {
    id: 'cuberoot',
    title: 'cube root',
    description: 'cube root',
    latex: '\\sqrt[3]{x}',
    renderLatex: (baseSymbol) => `\\sqrt[3]{${baseSymbol || 'x'}}`,
    apply: (prev, baseSymbol) => `${prev}cbrt(${baseSymbol || 'x'})`,
  },
  {
    id: 'nth-root',
    title: 'nth root',
    description: 'nth root',
    latex: '\\sqrt[#?]{#?}',
    renderLatex: (baseSymbol) => `\\sqrt[#?]{${baseSymbol || '#?'}}`,
    apply: (prev, baseSymbol) => `${prev}root(${baseSymbol || 'x'}, n)`,
  },
  {
    id: 'fraction',
    title: 'fraction',
    description: 'fraction',
    latex: '\\frac{#?}{#?}',
    renderLatex: (baseSymbol) => `\\frac{${baseSymbol || '#?'}}{#?}`,
    apply: (prev, baseSymbol) => `${prev}(${baseSymbol || 'x'})/()`,
  },
  {
    id: 'fraction-denominator',
    title: 'fraction denominator',
    description: 'fraction denominator',
    latex: '\\frac{#?}{x}',
    renderLatex: (baseSymbol) => `\\frac{#?}{${baseSymbol || 'x'}}`,
    apply: (prev, baseSymbol) => `${prev}()/(${baseSymbol || 'x'})`,
  },
  {
    id: 'paren',
    title: 'parentheses',
    description: 'parentheses',
    latex: '\\left(#?\\right)',
    renderLatex: (baseSymbol) => `\\left(${baseSymbol || '#?'}\\right)`,
    apply: (prev, baseSymbol) => `${prev}(${baseSymbol || 'x'})`,
  },
  {
    id: 'bracket',
    title: 'square brackets',
    description: 'square brackets',
    latex: '\\left[#?\\right]',
    renderLatex: (baseSymbol) => `\\left[${baseSymbol || '#?'}\\right]`,
    apply: (prev, baseSymbol) => `${prev}[${baseSymbol || 'x'}]`,
  },
  {
    id: 'brace',
    title: 'curly braces',
    description: 'curly braces',
    latex: '\\left\\{#?\\right\\}',
    renderLatex: (baseSymbol) => `\\left\\{${baseSymbol || '#?'}\\right\\}`,
    apply: (prev, baseSymbol) => `${prev}{${baseSymbol || 'x'}}`,
  },
  {
    id: 'absolute',
    title: 'absolute value',
    description: 'absolute value',
    latex: '\\left|#?\\right|',
    renderLatex: (baseSymbol) => `\\left|${baseSymbol || '#?'}\\right|`,
    apply: (prev, baseSymbol) => `${prev}\\left|${baseSymbol || 'x'}\\right|`,
  },
  {
    id: 'floor',
    title: 'floor',
    description: 'floor',
    latex: '\\left\\lfloor #? \\right\\rfloor',
    renderLatex: (baseSymbol) => `\\left\\lfloor ${baseSymbol || '#?'} \\right\\rfloor`,
    apply: (prev, baseSymbol) => `${prev}\\left\\lfloor ${baseSymbol || 'x'} \\right\\rfloor`,
  },
  {
    id: 'ceiling',
    title: 'ceiling',
    description: 'ceiling',
    latex: '\\left\\lceil #? \\right\\rceil',
    renderLatex: (baseSymbol) => `\\left\\lceil ${baseSymbol || '#?'} \\right\\rceil`,
    apply: (prev, baseSymbol) => `${prev}\\left\\lceil ${baseSymbol || 'x'} \\right\\rceil`,
  },
  createWrappedLatexKeyboardAction('sin', 'sine', 'sine', (baseSymbol) => `\\sin\\left(${baseSymbol}\\right)`, (baseSymbol) => `sin(${baseSymbol})`),
  createWrappedLatexKeyboardAction('cos', 'cosine', 'cosine', (baseSymbol) => `\\cos\\left(${baseSymbol}\\right)`, (baseSymbol) => `cos(${baseSymbol})`),
  createWrappedLatexKeyboardAction('tan', 'tangent', 'tangent', (baseSymbol) => `\\tan\\left(${baseSymbol}\\right)`, (baseSymbol) => `tan(${baseSymbol})`),
  createWrappedLatexKeyboardAction('ln', 'natural logarithm', 'natural logarithm', (baseSymbol) => `\\ln\\left(${baseSymbol}\\right)`, (baseSymbol) => `ln(${baseSymbol})`),
  {
    id: 'log-base',
    title: 'logarithm with base',
    description: 'logarithm with arbitrary base',
    latex: '\\log_{#?}\\left(#?\\right)',
    renderLatex: () => '\\log_{#?}\\left(#?\\right)',
    apply: (prev) => `${prev}\\log_{#?}\\left(#?\\right)`,
  },
  createWrappedLatexKeyboardAction('log', 'logarithm', 'logarithm', (baseSymbol) => `\\log\\left(${baseSymbol}\\right)`, (baseSymbol) => `log(${baseSymbol})`),
  createWrappedLatexKeyboardAction('derivative', 'derivative', 'derivative', (baseSymbol) => `\\frac{d}{dx}\\left(${baseSymbol}\\right)`, (baseSymbol) => `d/dx(${baseSymbol})`),
  createWrappedLatexKeyboardAction('second-derivative', 'second derivative', 'second derivative', (baseSymbol) => `\\frac{d^{2}}{dx^{2}}\\left(${baseSymbol}\\right)`, (baseSymbol) => `d^2/dx^2(${baseSymbol})`),
  createWrappedLatexKeyboardAction('integral', 'integral', 'integral', (baseSymbol) => `\\int ${baseSymbol}\\,dx`, (baseSymbol) => `∫ ${baseSymbol} dx`),
  createWrappedLatexKeyboardAction('definite-integral', 'definite integral', 'definite integral', (baseSymbol) => `\\int_{a}^{b} ${baseSymbol}\\,dx`, (baseSymbol) => `∫[a,b] ${baseSymbol} dx`),
  createWrappedLatexKeyboardAction('limit', 'limit', 'limit', (baseSymbol) => `\\mathop{\\lim}\\limits_{x \\to a}\\,${baseSymbol}`, (baseSymbol) => `lim(x→a) ${baseSymbol}`),
  createWrappedLatexKeyboardAction('reciprocal', 'reciprocal', 'reciprocal', (baseSymbol) => `${baseSymbol}^{-1}`, (baseSymbol) => `${baseSymbol}^-1`),
  createAppendTextKeyboardAction('dx', ' dx', 'dx', 'dx'),
  createAppendTextKeyboardAction('partial', '∂', 'partial derivative symbol', 'partial derivative symbol'),
  createAppendLatexKeyboardAction('leq', ' \\leq ', 'less than or equal to', 'less than or equal to', ' ≤ '),
  createAppendLatexKeyboardAction('geq', ' \\geq ', 'greater than or equal to', 'greater than or equal to', ' ≥ '),
  {
    id: 'backspace',
    title: 'delete',
    description: 'delete',
    label: '⌫',
    apply: (prev) => removeLastKeyboardChunk(prev),
  },
  {
    id: 'clear',
    title: 'clear',
    description: 'clear',
    label: 'Clear',
    apply: () => '',
  },
]

const KEYBOARD_MOUNTED_ROWS: KeyboardMountedRowDefinition[] = [
  {
    id: 'functions',
    label: 'Functions',
    actionIds: ['sin', 'cos', 'tan', 'ln', 'log', 'pi', 'theta', 'degree', 'percent'],
  },
  {
    id: 'calculus',
    label: 'Calculus',
    actionIds: ['limit', 'to', 'derivative', 'second-derivative', 'integral', 'definite-integral', 'dx', 'partial', 'infinity'],
  },
  {
    id: 'relations',
    label: 'Relations',
    actionIds: ['plus', 'minus', 'times', 'divide', 'equals', 'lt', 'gt', 'leq', 'geq', 'neq', 'approx'],
  },
  {
    id: 'enclosures',
    label: 'Enclosures',
    actionIds: ['paren', 'bracket', 'brace', 'absolute', 'floor', 'ceiling'],
  },
  {
    id: 'radicals',
    label: 'Radicals',
    actionIds: ['sqrt', 'cuberoot', 'nth-root', 'fraction', 'fraction-denominator', 'power2', 'power3', 'reciprocal'],
  },
  {
    id: 'numbers',
    label: 'Numbers',
    actionIds: ['digit-1', 'digit-2', 'digit-3', 'digit-4', 'digit-5', 'digit-6', 'digit-7', 'digit-8', 'digit-9', 'digit-0', 'decimal'],
  },
  {
    id: 'qwerty-1',
    label: 'QWERTY',
    actionIds: ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  },
  {
    id: 'qwerty-2',
    label: '',
    actionIds: ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  },
  {
    id: 'qwerty-3',
    label: '',
    actionIds: ['z', 'x', 'c', 'v', 'b', 'n', 'm', 'comma', 'backspace'],
  },
  {
    id: 'qwerty-4',
    label: '',
    actionIds: ['space', 'clear'],
  },
]

const KEYBOARD_MOUNTED_ROW_MAP = Object.fromEntries(KEYBOARD_MOUNTED_ROWS.map((row) => [row.id, row])) as Record<string, KeyboardMountedRowDefinition>

const KEYBOARD_ACTION_ROW_MAP = KEYBOARD_MOUNTED_ROWS.reduce<Record<string, string>>((acc, row) => {
  for (const actionId of row.actionIds) {
    acc[actionId] = row.id
  }
  return acc
}, {})

const KEYBOARD_DIRECTIONAL_RADIAL_ACTION_IDS = ['fraction', 'power2', 'plus', 'subscript', 'fraction-denominator', 'sqrt', 'minus', 'paren']

const deriveKeyboardActionBaseSymbol = (action: KeyboardActionDefinition) => {
  const trimmedToken = typeof action.token === 'string' ? action.token.trim() : ''
  if (!trimmedToken) return undefined
  if (/^[A-Za-z0-9]$/.test(trimmedToken)) return trimmedToken
  if (/^\\[A-Za-z]+$/.test(trimmedToken)) return trimmedToken
  return undefined
}

const buildMountedKeyboardStageTarget = (actionId: string): KeyboardStageTarget | null => {
  const action = KEYBOARD_ACTION_MAP[actionId]
  if (!action) return null
  const payloadSymbol = deriveKeyboardActionBaseSymbol(action)
  const rowId = KEYBOARD_ACTION_ROW_MAP[actionId]
  const row = rowId ? KEYBOARD_MOUNTED_ROW_MAP[rowId] : null
  if (!row) return buildKeyboardStageTargetFromAction(actionId)
  return {
    id: actionId,
    title: action.title,
    description: action.description,
    representativeKeyId: row.id,
    singleTapActionId: actionId,
    displayActionId: actionId,
    radialActionIds: KEYBOARD_DIRECTIONAL_RADIAL_ACTION_IDS,
    familyRows: [row.actionIds],
    familyTitle: row.label || action.title,
    baseSymbol: payloadSymbol,
    payloadSymbol,
  }
}

const KEYBOARD_ACTION_MAP = Object.fromEntries(KEYBOARD_ACTIONS.map((action) => [action.id, action])) as Record<string, KeyboardActionDefinition>
const KEYBOARD_TEXT_ACTION_ID_BY_TOKEN = KEYBOARD_ACTIONS.reduce<Record<string, string>>((acc, action) => {
  if (action.token) acc[action.token] = action.id
  return acc
}, {})

const insertKeyboardTextAtSelection = (value: string, text: string, selection: KeyboardSelectionState): KeyboardEditResult => {
  const start = Math.max(0, Math.min(selection.start, value.length))
  const end = Math.max(start, Math.min(selection.end, value.length))
  const next = `${value.slice(0, start)}${text}${value.slice(end)}`
  const caret = start + text.length
  return { value: next, selectionStart: caret, selectionEnd: caret }
}

const insertKeyboardStructureAtSelection = (
  value: string,
  text: string,
  selection: KeyboardSelectionState,
  caretOffset: number,
): KeyboardEditResult => {
  const start = Math.max(0, Math.min(selection.start, value.length))
  const end = Math.max(start, Math.min(selection.end, value.length))
  const next = `${value.slice(0, start)}${text}${value.slice(end)}`
  const caret = start + Math.max(0, Math.min(caretOffset, text.length))
  return { value: next, selectionStart: caret, selectionEnd: caret }
}

const removeKeyboardTextAtSelection = (value: string, selection: KeyboardSelectionState): KeyboardEditResult => {
  const start = Math.max(0, Math.min(selection.start, value.length))
  const end = Math.max(start, Math.min(selection.end, value.length))
  if (start !== end) {
    const next = `${value.slice(0, start)}${value.slice(end)}`
    return { value: next, selectionStart: start, selectionEnd: start }
  }
  if (start <= 0) {
    return { value, selectionStart: 0, selectionEnd: 0 }
  }
  const next = `${value.slice(0, start - 1)}${value.slice(start)}`
  const caret = start - 1
  return { value: next, selectionStart: caret, selectionEnd: caret }
}

const findKeyboardBalancedGroupStart = (value: string, endIndex: number, openChar: string, closeChar: string) => {
  let depth = 0
  for (let index = endIndex; index >= 0; index -= 1) {
    const char = value[index]
    if (char === closeChar) {
      depth += 1
      continue
    }
    if (char === openChar) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

const getKeyboardFenceTokenLength = (value: string, index: number, kind: 'left' | 'right') => {
  const prefix = kind === 'left' ? '\\left' : '\\right'
  if (!value.startsWith(prefix, index)) return 0
  const delimiterIndex = index + prefix.length
  if (delimiterIndex >= value.length) return 0
  const delimiter = value[delimiterIndex] === '\\' && delimiterIndex + 1 < value.length
    ? value[delimiterIndex + 1]
    : value[delimiterIndex]
  if (!/[()\[\]{}|.]/.test(delimiter)) return 0
  const delimiterLength = value[delimiterIndex] === '\\' ? 2 : 1
  return prefix.length + delimiterLength
}

const findKeyboardLeftRightGroupStart = (value: string, endIndex: number) => {
  const rightSuffixes = ['\\right)', '\\right]', '\\right|', '\\right\\}', '\\right\\{', '\\right\\|', '\\right.']
  const prefix = value.slice(0, endIndex + 1)
  let rightStart = -1
  for (const suffix of rightSuffixes) {
    if (prefix.endsWith(suffix)) {
      rightStart = prefix.length - suffix.length
      break
    }
  }
  if (rightStart < 0) return -1

  let depth = 1
  for (let index = rightStart - 1; index >= 0; index -= 1) {
    if (value[index] !== '\\') continue
    const rightLength = getKeyboardFenceTokenLength(value, index, 'right')
    if (rightLength > 0 && index + rightLength <= rightStart) {
      depth += 1
      continue
    }
    const leftLength = getKeyboardFenceTokenLength(value, index, 'left')
    if (leftLength > 0) {
      depth -= 1
      if (depth === 0) return index
    }
  }

  return -1
}

const findKeyboardReferenceTarget = (value: string, selection: KeyboardSelectionState): KeyboardReferenceTarget | null => {
  const start = Math.max(0, Math.min(selection.start, value.length))
  const end = Math.max(start, Math.min(selection.end, value.length))
  if (start !== end) {
    const symbol = value.slice(start, end)
    return symbol ? { start, end, symbol } : null
  }
  let index = start - 1
  while (index >= 0 && /\s/.test(value[index])) index -= 1
  if (index < 0) return null

  const leftRightGroupStart = findKeyboardLeftRightGroupStart(value, index)
  if (leftRightGroupStart >= 0) {
    return {
      start: leftRightGroupStart,
      end: index + 1,
      symbol: value.slice(leftRightGroupStart, index + 1),
    }
  }

  const currentChar = value[index]

  if (currentChar === '}') {
    const groupStart = findKeyboardBalancedGroupStart(value, index, '{', '}')
    if (groupStart >= 0) {
      let targetStart = groupStart
      if (targetStart > 0 && value[targetStart - 1] === '^') {
        targetStart -= 1
      }
      if (targetStart > 0 && value[targetStart - 1] === '_') {
        targetStart -= 1
      }
      return {
        start: targetStart,
        end: index + 1,
        symbol: value.slice(targetStart, index + 1),
      }
    }
  }

  if (currentChar === ')' || currentChar === ']' || currentChar === '}') {
    const openChar = currentChar === ')' ? '(' : currentChar === ']' ? '[' : '{'
    const groupStart = findKeyboardBalancedGroupStart(value, index, openChar, currentChar)
    if (groupStart >= 0) {
      return {
        start: groupStart,
        end: index + 1,
        symbol: value.slice(groupStart, index + 1),
      }
    }
  }

  if (/[0-9.]/.test(currentChar)) {
    let tokenStart = index
    while (tokenStart - 1 >= 0 && /[0-9.]/.test(value[tokenStart - 1])) tokenStart -= 1
    return {
      start: tokenStart,
      end: index + 1,
      symbol: value.slice(tokenStart, index + 1),
    }
  }

  if (/[A-Za-z]/.test(currentChar)) {
    let tokenStart = index
    while (tokenStart - 1 >= 0 && /[A-Za-z]/.test(value[tokenStart - 1])) tokenStart -= 1
    if (tokenStart - 1 >= 0 && value[tokenStart - 1] === '\\') {
      tokenStart -= 1
    }
    return {
      start: tokenStart,
      end: index + 1,
      symbol: value.slice(tokenStart, index + 1),
    }
  }

  return {
    start: index,
    end: index + 1,
    symbol: value.slice(index, index + 1),
  }
}

const replaceKeyboardReferenceTarget = (value: string, target: KeyboardReferenceTarget | null, replacement: string, selection: KeyboardSelectionState): KeyboardEditResult => {
  if (!target) {
    return insertKeyboardTextAtSelection(value, replacement, selection)
  }
  const next = `${value.slice(0, target.start)}${replacement}${value.slice(target.end)}`
  const caret = target.start + replacement.length
  return { value: next, selectionStart: caret, selectionEnd: caret }
}

const isValidKeyboardStructuralReferenceTarget = (target: KeyboardReferenceTarget | null) => {
  const symbol = target?.symbol?.trim()
  if (!symbol) return false

  // Reject stand-alone operators or delimiters as structure anchors.
  if (/^[+\-*/=<>|]$/.test(symbol)) return false
  if (/^[×÷≤≥≠≈]$/.test(symbol)) return false
  if (/^[()\[\]{}.,]$/.test(symbol)) return false
  if (/^\\(times|div|leq|geq|neq|approx)$/.test(symbol)) return false
  if (symbol === '#?') return false
  if (/^\\placeholder(?:\{.*\})?$/.test(symbol)) return false
  if (/\\left/.test(symbol) && !/\\right/.test(symbol)) return false
  if (/\\right/.test(symbol) && !/\\left/.test(symbol)) return false
  // Reject LaTeX command fragments such as \fr, \fra produced when
  // field.position (an atom index) is misread as a LaTeX string offset.
  if (isLatexCommandFragment(symbol)) return false

  return true
}

const isKeyboardReferenceTargetCommandBoundarySafe = (value: string, target: KeyboardReferenceTarget | null) => {
  if (!target) return false
  const { start, end } = target
  if (start < 0 || end <= start || end > value.length) return false

  // Start cannot be inside a command name: e.g. targeting "left" in "\\left".
  if (start > 0 && value[start - 1] === '\\' && /[A-Za-z]/.test(value[start] || '')) {
    return false
  }

  // End cannot split command-name letters: e.g. ending on "\\righ" before "t".
  if (end < value.length && /[A-Za-z]/.test(value[end - 1] || '') && /[A-Za-z]/.test(value[end] || '')) {
    return false
  }

  // Reject known partial fence command fragments if they appear inside target text.
  if (/\\lef(?!t)/.test(target.symbol)) return false
  if (/\\righ(?!t)/.test(target.symbol)) return false

  return true
}

const resolveKeyboardSafeReferenceTarget = (
  value: string,
  selection: KeyboardSelectionState,
  options?: {
    requireStructuralValidity?: boolean
    allowFallbackToExpressionEnd?: boolean
  },
) => {
  const isTargetSafe = (target: KeyboardReferenceTarget | null) => {
    if (!target || !target.symbol.trim()) return false
    if (!isKeyboardReferenceTargetCommandBoundarySafe(value, target)) return false
    if (options?.requireStructuralValidity && !isValidKeyboardStructuralReferenceTarget(target)) return false
    return true
  }

  const primaryTarget = findKeyboardReferenceTarget(value, selection)
  if (isTargetSafe(primaryTarget)) return primaryTarget

  if (options?.allowFallbackToExpressionEnd && value.trim()) {
    const endSelection = { start: value.length, end: value.length }
    const endTarget = findKeyboardReferenceTarget(value, endSelection)
    if (isTargetSafe(endTarget)) return endTarget
  }

  return null
}

const findKeyboardFractionDenominatorTargetAtPosition = (value: string, position: number): KeyboardReferenceTarget | null => {
  const denominatorRegion = findKeyboardFractionDenominatorRegionAtPosition(value, position)
  if (!denominatorRegion) return null

  const relativePosition = Math.max(0, Math.min(position - denominatorRegion.start, denominatorRegion.symbol.length))
  const relativeTarget = findKeyboardReferenceTarget(denominatorRegion.symbol, {
    start: relativePosition,
    end: relativePosition,
  })

  if (
    relativeTarget &&
    relativeTarget.symbol.trim() &&
    !isKeyboardPlaceholderExpression(relativeTarget.symbol) &&
    isValidKeyboardStructuralReferenceTarget(relativeTarget)
  ) {
    return {
      start: denominatorRegion.start + relativeTarget.start,
      end: denominatorRegion.start + relativeTarget.end,
      symbol: relativeTarget.symbol,
    }
  }

  if (
    denominatorRegion.symbol.trim() &&
    !isKeyboardPlaceholderExpression(denominatorRegion.symbol) &&
    isValidKeyboardStructuralReferenceTarget(denominatorRegion)
  ) {
    return denominatorRegion
  }

  return null
}

const buildKeyboardContextualRadialOperation = (
  actionId: string,
  payloadSymbol?: string,
  referenceTarget?: KeyboardReferenceTarget | null,
) => {
  const referenceSymbol = referenceTarget?.symbol?.trim()
  const payload = payloadSymbol?.trim()
  if (!referenceSymbol || !payload) return null

  switch (actionId) {
    case 'power2':
      return {
        previewLatex: `${referenceSymbol}^{${payload}}`,
        replacement: `${referenceSymbol}^${payload}`,
      }
    case 'subscript':
      return {
        previewLatex: `${referenceSymbol}_{${payload}}`,
        replacement: `${referenceSymbol}_${payload}`,
      }
    case 'fraction':
      return {
        previewLatex: `\\frac{${payload}}{${referenceSymbol}}`,
        replacement: `(${payload})/(${referenceSymbol})`,
      }
    case 'fraction-denominator':
      return {
        previewLatex: `\\frac{${referenceSymbol}}{${payload}}`,
        replacement: `(${referenceSymbol})/(${payload})`,
      }
    case 'plus':
      return {
        previewLatex: `${referenceSymbol} + ${payload}`,
        replacement: `${referenceSymbol} + ${payload}`,
      }
    case 'minus':
      return {
        previewLatex: `${referenceSymbol} - ${payload}`,
        replacement: `${referenceSymbol} - ${payload}`,
      }
    case 'paren':
      return {
        previewLatex: `\\left(${payload}\\right)`,
        replacement: `(${payload})`,
      }
    default:
      return null
  }
}

const KEYBOARD_REPRESENTATIVE_KEYS: KeyboardRepresentativeKeyDefinition[] = [
  {
    id: 'letters',
    title: 'x',
    description: 'letters and numbers',
    latex: 'x',
    singleTapActionId: 'x',
    radialActionIds: ['fraction', 'power2', 'plus', 'subscript', 'fraction-denominator', 'sqrt', 'minus', 'paren'],
    familyRows: [
      ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
      ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
      ['uppercase', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'backspace'],
      ['comma', 'space', 'decimal'],
    ],
    familyTitle: 'QWERTY keyboard (no number row)',
  },
  {
    id: 'plus-operators',
    title: 'plus',
    description: 'addition family',
    latex: '+',
    singleTapActionId: 'plus',
    radialActionIds: [],
    familyRows: [['plus', 'sum', 'pm']],
    familyTitle: 'Addition family',
  },
  {
    id: 'minus-operators',
    title: 'minus',
    description: 'subtraction family',
    latex: '-',
    singleTapActionId: 'minus',
    radialActionIds: [],
    familyRows: [['minus', 'mp', 'setminus']],
    familyTitle: 'Subtraction family',
  },
  {
    id: 'times-operators',
    title: 'times',
    description: 'multiplication family',
    latex: '\\times',
    singleTapActionId: 'times',
    radialActionIds: [],
    familyRows: [['times', 'cdot', 'product', 'ast']],
    familyTitle: 'Multiplication family',
  },
  {
    id: 'divide-operators',
    title: 'divide',
    description: 'division family',
    latex: '\\div',
    singleTapActionId: 'divide',
    radialActionIds: [],
    familyRows: [['divide', 'fraction', 'slash', 'ratio']],
    familyTitle: 'Division family',
  },
  {
    id: 'relations',
    title: 'equals',
    description: 'relation family',
    latex: '=',
    singleTapActionId: 'equals',
    radialActionIds: ['equals', 'neq', 'leq', 'geq'],
    familyRows: [['equals', 'neq', 'lt', 'gt', 'leq', 'geq', 'approx']],
    familyTitle: 'Relation family',
  },
  {
    id: 'calculus',
    title: 'derivative',
    description: 'calculus family',
    latex: '\\frac{d}{dx}',
    singleTapActionId: 'derivative',
    radialActionIds: [],
    familyRows: [['derivative', 'second-derivative', 'integral', 'definite-integral', 'limit', 'to', 'dx', 'partial']],
    familyTitle: 'Calculus',
  },
  {
    id: 'enclosures',
    title: 'parentheses',
    description: 'enclosure family',
    latex: '\\left(x\\right)',
    singleTapActionId: 'paren',
    radialActionIds: [],
    familyRows: [['paren', 'bracket', 'brace', 'absolute', 'floor', 'ceiling']],
    familyTitle: 'Enclosures',
  },
  {
    id: 'radicals',
    title: 'square root',
    description: 'radical family',
    latex: '\\sqrt{x}',
    singleTapActionId: 'sqrt',
    radialActionIds: [],
    familyRows: [['sqrt', 'cuberoot', 'nth-root', 'fraction', 'fraction-denominator', 'power2', 'power3', 'reciprocal']],
    familyTitle: 'Radicals and powers',
  },
  {
    id: 'trig',
    title: 'sine',
    description: 'trigonometry family',
    latex: '\\sin(x)',
    singleTapActionId: 'sin',
    radialActionIds: [],
    familyRows: [['sin', 'cos', 'tan']],
    familyTitle: 'Trigonometry',
  },
  {
    id: 'logs',
    title: 'logarithm',
    description: 'logarithm family',
    latex: '\\log_{\\placeholder{}}\\left(\\placeholder{}\\right)',
    singleTapActionId: 'log-base',
    radialActionIds: [],
    familyRows: [['log-base', 'log', 'ln']],
    familyTitle: 'Logs',
  },
  {
    id: 'greek',
    title: 'theta',
    description: 'greek family',
    latex: '\\theta',
    singleTapActionId: 'theta',
    radialActionIds: [],
    familyRows: [['theta', 'pi', 'degree', 'infinity']],
    familyTitle: 'Greek symbols',
  },
  {
    id: 'editing',
    title: 'delete',
    description: 'editing controls',
    label: '⌫',
    singleTapActionId: 'backspace',
    radialActionIds: ['backspace', 'clear'],
    familyRows: [['backspace', 'clear']],
    familyTitle: 'Editing controls',
  },
]

const KEYBOARD_REPRESENTATIVE_MAP = Object.fromEntries(KEYBOARD_REPRESENTATIVE_KEYS.map((key) => [key.id, key])) as Record<string, KeyboardRepresentativeKeyDefinition>

const SIMPLE_KEYBOARD_NUMBER_ROW: KeyboardVisibleKeyDefinition[] = [
  { actionId: 'digit-1', label: '1' },
  { actionId: 'digit-2', label: '2' },
  { actionId: 'digit-3', label: '3' },
  { actionId: 'digit-4', label: '4' },
  { actionId: 'digit-5', label: '5' },
  { actionId: 'digit-6', label: '6' },
  { actionId: 'digit-7', label: '7' },
  { actionId: 'digit-8', label: '8' },
  { actionId: 'digit-9', label: '9' },
  { actionId: 'digit-0', label: '0' },
  { actionId: 'decimal', label: '.' },
]

const SIMPLE_KEYBOARD_TOP_FAMILY_KEYS: KeyboardVisibleKeyDefinition[] = [
  { actionId: 'sin', label: 'sin', representativeKeyId: 'trig' },
  { actionId: 'theta', label: 'θ', representativeKeyId: 'greek' },
]

const SIMPLE_KEYBOARD_CENTER_FAMILY_KEYS: {
  left: KeyboardVisibleKeyDefinition
  center: KeyboardVisibleKeyDefinition
  right: KeyboardVisibleKeyDefinition
  bottom: KeyboardVisibleKeyDefinition
} = {
  left: { actionId: 'paren', label: '()', representativeKeyId: 'enclosures' },
  center: { actionId: 'x', representativeKeyId: 'letters' },
  right: { actionId: 'sqrt', label: '√', representativeKeyId: 'radicals' },
  bottom: { actionId: 'equals', label: '=', representativeKeyId: 'relations' },
}

const KEYBOARD_ACTION_REPRESENTATIVE_MAP = KEYBOARD_REPRESENTATIVE_KEYS.reduce<Record<string, string>>((acc, key) => {
  acc[key.singleTapActionId] = key.id
  for (const row of key.familyRows) {
    for (const actionId of row) {
      acc[actionId] = key.id
    }
  }
  return acc
}, {})

export const estimateKeyboardCaretFromTapPosition = (
  value: string,
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  slotRects?: Array<Pick<DOMRect, 'left' | 'top' | 'right' | 'height'> | null>,
) => {
  const symbols = Array.from(value || '')
  if (!symbols.length) return 0

  const usableSlotRects = (slotRects || []).filter((entry): entry is Pick<DOMRect, 'left' | 'top' | 'right' | 'height'> => Boolean(entry))
  if (usableSlotRects.length) {
    const boundaryPositions = [
      { x: usableSlotRects[0].left, y: usableSlotRects[0].top + (usableSlotRects[0].height / 2) },
      ...usableSlotRects.map((entry) => ({ x: entry.right, y: entry.top + (entry.height / 2) })),
    ]
    let bestIndex = 0
    let bestDistanceSq = Number.POSITIVE_INFINITY
    boundaryPositions.forEach((position, index) => {
      const dx = clientX - position.x
      const dy = clientY - position.y
      const distanceSq = (dx * dx) + (dy * dy)
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq
        bestIndex = index
      }
    })
    return Math.max(0, Math.min(symbols.length, bestIndex))
  }

  const relativeX = clientX - rect.left
  const ratio = rect.width > 0 ? Math.max(0, Math.min(1, relativeX / rect.width)) : 1
  return Math.max(0, Math.min(symbols.length, Math.round(symbols.length * ratio)))
}

const buildKeyboardStageTarget = (representativeKeyId: string, singleTapActionId?: string): KeyboardStageTarget | null => {
  const representativeKey = KEYBOARD_REPRESENTATIVE_MAP[representativeKeyId]
  if (!representativeKey) return null
  const actionId = singleTapActionId || representativeKey.singleTapActionId
  const action = KEYBOARD_ACTION_MAP[actionId]
  if (!action) return null
  return {
    id: actionId,
    title: action.title,
    description: action.description,
    representativeKeyId,
    singleTapActionId: actionId,
    displayActionId: actionId,
    radialActionIds: representativeKey.radialActionIds,
    familyRows: representativeKey.familyRows,
    familyTitle: representativeKey.familyTitle,
    baseSymbol: action.token,
  }
}

const buildKeyboardStageTargetFromAction = (actionId: string): KeyboardStageTarget | null => {
  const representativeKeyId = KEYBOARD_ACTION_REPRESENTATIVE_MAP[actionId]
  if (!representativeKeyId) return null
  return buildKeyboardStageTarget(representativeKeyId, actionId)
}

const toDebugJson = (value: unknown, maxChars = 12000) => {
  if (value == null) return null
  try {
    const seen = new WeakSet<object>()
    const text = typeof value === 'string'
      ? value
      : JSON.stringify(value, (_key, current) => {
          if (typeof current === 'function') return '[function]'
          if (current && typeof current === 'object') {
            if (typeof Element !== 'undefined' && current instanceof Element) {
              return `[element ${current.tagName.toLowerCase()}]`
            }
            if (typeof Window !== 'undefined' && current instanceof Window) {
              return '[window]'
            }
            if (seen.has(current)) return '[circular]'
            seen.add(current)
          }
          return current
        }, 2)
    if (!text) return null
    if (text.length <= maxChars) return text
    return `${text.slice(0, maxChars)}\n...truncated...`
  } catch {
    return String(value)
  }
}

const collectRuntimeErrorSources = (value: unknown): string[] => {
  if (!value || typeof value !== 'object') return []
  const anyValue = value as any
  const values = [
    anyValue?.filename,
    anyValue?.fileName,
    anyValue?.sourceURL,
    anyValue?.url,
    anyValue?.src,
    anyValue?.target?.src,
    anyValue?.target?.href,
    anyValue?.currentTarget?.src,
    anyValue?.currentTarget?.href,
  ]
  return Array.from(new Set(values.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)))
}

const formatRuntimeErrorDetails = (value: unknown, fallback = 'Unknown client error') => {
  const raw = toDebugJson(value, 16000) || undefined

  if (value instanceof Error) {
    return {
      name: value.name || 'Error',
      message: value.message || String(value),
      stack: value.stack || '',
      source: undefined as string | undefined,
      raw,
    }
  }

  if (typeof value === 'string') {
    return {
      name: undefined as string | undefined,
      message: value,
      stack: '',
      source: undefined as string | undefined,
      raw,
    }
  }

  if (!value || typeof value !== 'object') {
    return {
      name: undefined as string | undefined,
      message: raw || fallback,
      stack: '',
      source: undefined as string | undefined,
      raw,
    }
  }

  const queue: unknown[] = [value]
  const seen = new WeakSet<object>()
  let name: string | undefined
  let message = ''
  let stack = ''
  let source = ''

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue

    if (current instanceof Error) {
      name ||= current.name || 'Error'
      message ||= current.message || String(current)
      stack ||= current.stack || ''
      continue
    }

    if (typeof current === 'string') {
      message ||= current
      continue
    }

    if (typeof current !== 'object') continue
    if (seen.has(current)) continue
    seen.add(current)

    const anyValue = current as any
    name ||= typeof anyValue?.name === 'string' ? anyValue.name : undefined
    message ||= [anyValue?.message, anyValue?.reason, anyValue?.statusText].find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) || ''
    stack ||= typeof anyValue?.stack === 'string' ? anyValue.stack : ''
    source ||= collectRuntimeErrorSources(anyValue)[0] || ''

    if (anyValue?.error) queue.push(anyValue.error)
    if (anyValue?.reason) queue.push(anyValue.reason)
    if (anyValue?.detail) queue.push(anyValue.detail)
    if (anyValue?.cause) queue.push(anyValue.cause)
    if (anyValue?.data) queue.push(anyValue.data)
  }

  return {
    name,
    message: message || raw || fallback,
    stack,
    source: source || undefined,
    raw,
  }
}

const isSilentMyScriptRuntimeMessage = (details: { message?: string; stack?: string; source?: string; raw?: string }) => {
  const normalized = [details.message || '', details.stack || '', details.source || '', details.raw || '']
    .join(' ')
    .toLowerCase()

  return normalized.includes('iink')
    || normalized.includes('interactiveinkssreditor')
    || normalized.includes('historymanager')
    || normalized.includes('myscript')
    || normalized.includes('webdemoapi.myscript.com')
}

const getSilentMyScriptRuntimeDisposition = (details: { message?: string; stack?: string; source?: string; raw?: string }) => {
  const normalized = [details.message || '', details.stack || '', details.source || '', details.raw || '']
    .join(' ')
    .toLowerCase()

  if (/viewsize(?:height|width) must not be null/.test(normalized)) return 'resize' as const
  if (/cannot read properties of undefined.*symbols/.test(normalized)) {
    return 'ignore' as const
  }
  if (/(session too long|max session duration|session is too old|session closed due to no activity|closed due to no activity|inactive session|unauthorized|forbidden|missing.*key|networkerror|network error|connection closed|websocket closed)/.test(normalized)) {
    return 'reinit' as const
  }
  if (isSilentMyScriptRuntimeMessage(details)) return 'ignore' as const
  return 'reinit' as const
}

const isHardMyScriptReconnectMessage = (details: { message?: string; stack?: string; source?: string; raw?: string }) => {
  const normalized = [details.message || '', details.stack || '', details.source || '', details.raw || '']
    .join(' ')
    .toLowerCase()

  return /(session too long|max session duration|session is too old|session closed due to no activity|closed due to no activity|inactive session|unauthorized|forbidden|missing.*key|networkerror|network error|connection closed|websocket closed)/.test(normalized)
}

const recordSilentCanvasRecovery = (kind: string, details: { message?: string; stack?: string; source?: string; raw?: string }) => {
  try {
    if (typeof window !== 'undefined') {
      ;(window as any).__philani_last_ignored_client_error = {
        kind,
        href: window.location.href,
        timestamp: Date.now(),
        details,
      }
    }
  } catch {
    // ignore
  }
}

const recordCanvasInitTrace = (details: Record<string, unknown>) => {
  try {
    if (typeof window !== 'undefined') {
      ;(window as any).__philani_last_canvas_init_trace = {
        timestamp: Date.now(),
        href: window.location.href,
        ...details,
      }
    }
  } catch {
    // ignore
  }
}

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

const getEnvToggle = (value: string | undefined, defaultValue = true) => {
  if (typeof value !== 'string') return defaultValue
  const normalized = value.trim().toLowerCase()
  if (!normalized) return defaultValue
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false
  return defaultValue
}

const ENABLE_RECOGNITION_DEBUG_PANEL = getEnvToggle(process.env.NEXT_PUBLIC_CANVAS_RECOGNITION_DEBUG_PANEL, true)
const ENABLE_SCROLL_DEBUG_PANEL = getEnvToggle(process.env.NEXT_PUBLIC_CANVAS_SCROLL_DEBUG_PANEL, true)

const countSymbols = (source: any): number => {
  if (!source) return 0
  if (Array.isArray(source)) return source.length
  if (Array.isArray(source?.events)) return source.events.length
  return 0
}

const getNonFatalIinkActionErrorMessage = (error: unknown): string => {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message || String(error)
  if (typeof error === 'object') {
    const anyError = error as any
    if (typeof anyError?.message === 'string') return anyError.message
    if (typeof anyError?.reason === 'string') return anyError.reason
  }
  try {
    return String(error)
  } catch {
    return ''
  }
}

const isNonFatalIinkActionError = (error: unknown): boolean => {
  const message = getNonFatalIinkActionErrorMessage(error).trim().toLowerCase()
  if (!message) return false
  return (
    message === 'undo not allowed'
    || message === 'redo not allowed'
    || message === 'clear not allowed'
    || message === 'convert not allowed'
    || message === 'export not allowed'
    || message === 'import not allowed'
    || message.includes("cannot read properties of undefined (reading 'symbols')")
  )
}

const recordIgnoredIinkActionError = (error: unknown) => {
  try {
    if (typeof window !== 'undefined') {
      ;(window as any).__philani_last_ignored_client_error = {
        kind: 'iink-action',
        href: window.location.href,
        timestamp: Date.now(),
        message: getNonFatalIinkActionErrorMessage(error),
      }
    }
  } catch {
    // ignore
  }
}

const runIinkActionSafely = async (action: () => unknown | Promise<unknown>): Promise<boolean> => {
  try {
    await action()
    return true
  } catch (error) {
    if (!isNonFatalIinkActionError(error)) {
      throw error
    }
    recordIgnoredIinkActionError(error)
    return false
  }
}

const normalizeSymbolEventType = (evt: any): string => {
  const raw = evt?.type ?? evt?.eventType ?? evt?.state ?? evt?.phase ?? evt?.kind ?? evt?.action ?? ''
  return String(raw).toLowerCase()
}

const splitSymbolEventsForReplay = (source: any): any[][] => {
  const events = Array.isArray(source)
    ? source
    : Array.isArray(source?.events)
      ? source.events
      : []
  if (!events.length) return []

  const batches: any[][] = []
  let current: any[] = []

  const flush = () => {
    if (!current.length) return
    batches.push(current)
    current = []
  }

  for (const evt of events) {
    const type = normalizeSymbolEventType(evt)
    const isStart = Boolean(evt?.isFirst || evt?.isStart) || /(down|start|begin)/.test(type)
    const isEnd = Boolean(evt?.isLast || evt?.isEnd) || /(up|end|stop)/.test(type)

    if (isStart && current.length) flush()
    current.push(evt)
    if (isEnd) flush()
  }

  flush()
  return batches.length ? batches : [events]
}

const getSnapshotMode = (_snapshot: SnapshotPayload | null | undefined): CanvasMode => {
  return 'math'
}

const cloneRawInkStrokes = (strokes: RawInkStroke[] | null | undefined): RawInkStroke[] => {
  if (!Array.isArray(strokes) || strokes.length === 0) return []
  return strokes.map((stroke) => ({
    id: String(stroke?.id || ''),
    color: typeof stroke?.color === 'string' && stroke.color ? stroke.color : RAW_INK_STROKE_COLOR,
    width: Number.isFinite(stroke?.width) ? Number(stroke.width) : RAW_INK_STROKE_WIDTH,
    points: Array.isArray(stroke?.points)
      ? stroke.points
          .map((point) => ({
            x: Number.isFinite(point?.x) ? Math.min(1, Math.max(0, Number(point.x))) : 0,
            y: Number.isFinite(point?.y) ? Math.min(1, Math.max(0, Number(point.y))) : 0,
          }))
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      : [],
  }))
}

const countRawInkStrokes = (snapshot: SnapshotPayload | null | undefined): number => {
  const strokes = snapshot?.rawInk?.strokes
  return Array.isArray(strokes) ? strokes.length : 0
}

const makeRawInkSnapshot = (strokes: RawInkStroke[], version: number, snapshotId: string): SnapshotPayload => ({
  mode: 'raw-ink',
  symbols: null,
  rawInk: { strokes: cloneRawInkStrokes(strokes) },
  latex: '',
  jiix: null,
  version,
  snapshotId,
  baseSymbolCount: -1,
})

const rawInkStrokeToSvgPoints = (stroke: RawInkStroke) => {
  return (Array.isArray(stroke.points) ? stroke.points : [])
    .map((point) => `${Math.round(point.x * RAW_INK_VIEWBOX_SIZE)},${Math.round(point.y * RAW_INK_VIEWBOX_SIZE)}`)
    .join(' ')
}

const pointToSegmentDistanceSquared = (point: RawInkPoint, start: RawInkPoint, end: RawInkPoint) => {
  const abx = end.x - start.x
  const aby = end.y - start.y
  const apx = point.x - start.x
  const apy = point.y - start.y
  const denom = abx * abx + aby * aby
  if (denom <= 0) {
    const dx = point.x - start.x
    const dy = point.y - start.y
    return dx * dx + dy * dy
  }
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / denom))
  const cx = start.x + abx * t
  const cy = start.y + aby * t
  const dx = point.x - cx
  const dy = point.y - cy
  return dx * dx + dy * dy
}

const cloneSnapshotPayload = (snapshot: SnapshotPayload | null | undefined): SnapshotPayload | null => {
  if (!snapshot) return null
  try {
    if (typeof structuredClone === 'function') {
      return structuredClone(snapshot)
    }
    return JSON.parse(JSON.stringify(snapshot))
  } catch {
    return {
      ...snapshot,
      symbols: snapshot.symbols ? JSON.parse(JSON.stringify(snapshot.symbols)) : null,
      rawInk: snapshot.rawInk ? { strokes: cloneRawInkStrokes(snapshot.rawInk.strokes) } : null,
    }
  }
}

const nextAnimationFrame = () =>
  typeof window === 'undefined'
    ? new Promise<void>(resolve => setTimeout(resolve, 16))
    : new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))

const isSnapshotEmpty = (snapshot: SnapshotPayload | null) => {
  if (!snapshot) return true
  if (getSnapshotMode(snapshot) === 'raw-ink') {
    return countRawInkStrokes(snapshot) <= 0
  }
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

const MyScriptMathCanvas = ({ gradeLabel, roomId, userId, userDisplayName, canOrchestrateLesson: legacyCanOrchestrateLesson, roleProfile, forceEditable, boardId, realtimeScopeId, autoOpenDiagramTray, quizMode, initialQuiz, assignmentSubmission, uiMode = 'default', defaultOrientation, overlayControlsHandleRef, onOverlayChromeVisibilityChange, initialComposedLatex, onLatexOutputChange, onComposedLatexChange, onRequestVideoOverlay, lessonAuthoring, compactEdgeToEdge, initialRecognitionEngine }: MyScriptMathCanvasProps): React.JSX.Element => {
  const lessonRoleProfile = useMemo(() => {
    if (roleProfile) return roleProfile
    return createLessonRoleProfile({ platformRole: legacyCanOrchestrateLesson ? 'teacher' : 'learner' })
  }, [legacyCanOrchestrateLesson, roleProfile])
  const isTechnicalAdmin = lessonRoleProfile.capabilities.canAccessTechnicalTools
  const hasTeacherPrivileges = lessonRoleProfile.capabilities.canOrchestrateLesson
  const canOrchestrateLesson = hasTeacherPrivileges
  const canUseTechnicalControls = isTechnicalAdmin
  // --- Debug Panel State (must be inside component) ---
  const [myscriptScriptLoaded, setMyScriptScriptLoaded] = useState(false)
  const [myscriptEditorReady, setMyScriptEditorReady] = useState(false)
  const [myscriptLastError, setMyScriptLastError] = useState<string | null>(null)
  const [myscriptLastSymbolExtract, setMyScriptLastSymbolExtract] = useState<number | null>(null)
  const [myscriptLastSymbolsPayload, setMyScriptLastSymbolsPayload] = useState<string | null>(null)
  const [myscriptLastExportPayload, setMyScriptLastExportPayload] = useState<string | null>(null)
  const [myscriptLastExportedLatex, setMyScriptLastExportedLatex] = useState<string | null>(null)
  const [myscriptReplayCounts, setMyScriptReplayCounts] = useState({ down: 0, move: 0, up: 0 })
  const [myscriptLastReplayAt, setMyScriptLastReplayAt] = useState<number | null>(null)
  const [myscriptLastReplayDownPayload, setMyScriptLastReplayDownPayload] = useState<string | null>(null)
  const [myscriptLastReplayMovePayload, setMyScriptLastReplayMovePayload] = useState<string | null>(null)
  const [myscriptLastReplayUpPayload, setMyScriptLastReplayUpPayload] = useState<string | null>(null)
  const [myscriptChangedCount, setMyScriptChangedCount] = useState(0)
  const [myscriptLastChangedAt, setMyScriptLastChangedAt] = useState<number | null>(null)
  const [myscriptLastChangedPayload, setMyScriptLastChangedPayload] = useState<string | null>(null)
  const [myscriptExportedCount, setMyScriptExportedCount] = useState(0)
  const [myscriptLastExportedAt, setMyScriptLastExportedAt] = useState<number | null>(null)
  const [myscriptModelSummary, setMyScriptModelSummary] = useState<string | null>(null)
  const [myscriptLastProbeAt, setMyScriptLastProbeAt] = useState<number | null>(null)
  const [debugTopPanelSource, setDebugTopPanelSource] = useState<string | null>(null)
  const [debugTopPanelHasMarkup, setDebugTopPanelHasMarkup] = useState(false)
  const [debugPanelVisible, setDebugPanelVisible] = useState(ENABLE_RECOGNITION_DEBUG_PANEL)
  const probeMyScriptRecognitionStateRef = useRef<() => Promise<void>>(async () => {})
  const scheduleMyScriptProbeRef = useRef<() => void>(() => {})
  const myscriptProbeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track MyScript script load
  useEffect(() => {
    const hasRuntime = Boolean(window?.iink?.Editor?.load)
    setMyScriptScriptLoaded(hasRuntime)
  }, [])

  // Track editor instance
  useEffect(() => {
    setMyScriptEditorReady(!!editorInstanceRef.current)
    // If you want to update when the ref changes, trigger this effect manually elsewhere.
  }, [])
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!ENABLE_RECOGNITION_DEBUG_PANEL || !isTechnicalAdmin) {
      setDebugPanelVisible(false)
      return
    }
    try {
      const saved = window.localStorage.getItem(DEBUG_PANEL_STORAGE_KEY)
      if (saved === '1') {
        setDebugPanelVisible(true)
      } else if (saved === '0') {
        setDebugPanelVisible(false)
      }
    } catch {}
  }, [isTechnicalAdmin])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!ENABLE_RECOGNITION_DEBUG_PANEL || !isTechnicalAdmin) return
    try {
      window.localStorage.setItem(DEBUG_PANEL_STORAGE_KEY, debugPanelVisible ? '1' : '0')
    } catch {}
  }, [debugPanelVisible, isTechnicalAdmin])

  const isAssignmentSolutionAuthoring = assignmentSubmission?.kind === 'solution'
  const isAssignmentView = Boolean(assignmentSubmission?.assignmentId && assignmentSubmission?.questionId)
  // Assignments & timeline challenges are single-user canvases. They must remain editable for the current
  // learner without requiring presenter/controller allowlisting (which is only for live sessions).
  const forceEditableForAssignment = Boolean(forceEditable) || Boolean((!canOrchestrateLesson || isAssignmentSolutionAuthoring) && isAssignmentView)
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
  const latexPreviewEpochRef = useRef(0)
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
  const editorReconnectPhaseRef = useRef<'pending-init' | 'waiting-result' | 'restoring' | null>(null)
  const editorReconnectRestoreSnapshotRef = useRef<SnapshotPayload | null>(null)
  const lastEditorInitTraceRef = useRef<null | {
    editorInitLayoutKey: string
    editorReinitNonce: number
    canvasMode: CanvasMode
    canOrchestrateLesson: boolean
    forceEditableForAssignment: boolean
    useStackedStudentLayout: boolean
    isCompactViewport: boolean
  }>(null)
  const suppressNextLoadingOverlayRef = useRef(false)
  const editorReconnectingRef = useRef(false)
  const [latexOutput, setLatexOutput] = useState('')
  const latexOutputRef = useRef('')
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [canClear, setCanClear] = useState(false)
  const [isConverting, setIsConverting] = useState(false)
  const [canvasMode, setCanvasMode] = useState<CanvasMode>(DEFAULT_CANVAS_MODE)
  const canvasModeRef = useRef<CanvasMode>(DEFAULT_CANVAS_MODE)
  const [recognitionEngine, setRecognitionEngine] = useState<RecognitionEngine>(DEFAULT_RECOGNITION_ENGINE)
  const recognitionEngineRef = useRef<RecognitionEngine>(DEFAULT_RECOGNITION_ENGINE)
  const keyboardSurfaceRef = useRef<HTMLDivElement | null>(null)
  const keyboardExpressionSurfaceRef = useRef<HTMLInputElement | null>(null)
  const keyboardMathfieldHostRef = useRef<HTMLDivElement | null>(null)
  const keyboardMathfieldViewportRef = useRef<HTMLDivElement | null>(null)
  const keyboardMathfieldZoomSurfaceRef = useRef<HTMLDivElement | null>(null)
  const [keyboardMathfieldHostNode, setKeyboardMathfieldHostNode] = useState<HTMLDivElement | null>(null)
  const [keyboardMathfieldViewportNode, setKeyboardMathfieldViewportNode] = useState<HTMLDivElement | null>(null)
  const [keyboardMathfieldZoomSurfaceNode, setKeyboardMathfieldZoomSurfaceNode] = useState<HTMLDivElement | null>(null)
  const keyboardMathfieldRef = useRef<MathfieldElementType | null>(null)
  const keyboardMathfieldCleanupRef = useRef<(() => void) | null>(null)
  const keyboardMathfieldSyncRef = useRef(false)
  const keyboardMathfieldZoomRef = useRef(1)
  const keyboardMathfieldTouchGestureRef = useRef<{
    singleTouchActive: boolean
    pinchActive: boolean
    selectionMode: boolean
    longPressTimer: ReturnType<typeof setTimeout> | null
    startX: number
    startY: number
    startScrollLeft: number
    startScrollTop: number
    startDist: number
    startZoom: number
    anchorX: number
    anchorY: number
    lastMidpointX: number
    lastMidpointY: number
  }>({
    singleTouchActive: false,
    pinchActive: false,
    selectionMode: false,
    longPressTimer: null,
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    startScrollTop: 0,
    startDist: 0,
    startZoom: 1,
    anchorX: 0,
    anchorY: 0,
    lastMidpointX: 0,
    lastMidpointY: 0,
  })
  const keyboardTopTypesetPreviewRef = useRef<HTMLDivElement | null>(null)
  const keyboardBottomTypesetPreviewRef = useRef<HTMLDivElement | null>(null)
  const [keyboardSelection, setKeyboardSelection] = useState<KeyboardSelectionState>({ start: 0, end: 0 })
  const keyboardSelectionRef = useRef<KeyboardSelectionState>({ start: 0, end: 0 })
  const keyboardSwipeGestureRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    active: boolean
    direction: KeyboardSwipeDirection | null
    appliedSteps: number
  } | null>(null)
  const keyboardPendingKeyGestureRef = useRef<{
    actionId: string
    pointerId: number
    startX: number
    startY: number
    swipeMode: boolean
    direction: KeyboardSwipeDirection | null
    appliedSteps: number
  } | null>(null)
  const keyboardSwipeHoldTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keyboardTransientRadicalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keyboardTransientRadicalAnchorStartRef = useRef<number | null>(null)
  const keyboardTransientRadicalPromptIdsRef = useRef<KeyboardTransientRadicalPromptIds | null>(null)
  const keyboardTransientRadicalActiveFieldRef = useRef<'index' | 'radicand' | null>(null)
  const keyboardTransientRadicalSequenceRef = useRef(0)
  const keyboardSwipeHoldStateRef = useRef<{
    pointerId: number | null
    direction: KeyboardSwipeDirection | null
    active: boolean
  }>({
    pointerId: null,
    direction: null,
    active: false,
  })
  const keyboardTopCaretSlotRefs = useRef<Array<HTMLSpanElement | null>>([])
  const keyboardBottomCaretSlotRefs = useRef<Array<HTMLSpanElement | null>>([])

  // Define setKeyboardSelectionState early to be used in MathLive initialization useEffect
  const setKeyboardSelectionState = useCallback((selection: KeyboardSelectionState) => {
    setKeyboardSelection(selection)
    keyboardSelectionRef.current = selection
  }, [])

  const setKeyboardMathfieldHostNodeRef = useCallback((node: HTMLDivElement | null) => {
    keyboardMathfieldHostRef.current = node
    setKeyboardMathfieldHostNode(node)
  }, [])

  const setKeyboardMathfieldViewportNodeRef = useCallback((node: HTMLDivElement | null) => {
    keyboardMathfieldViewportRef.current = node
    setKeyboardMathfieldViewportNode(node)
  }, [])

  const setKeyboardMathfieldZoomSurfaceNodeRef = useCallback((node: HTMLDivElement | null) => {
    keyboardMathfieldZoomSurfaceRef.current = node
    setKeyboardMathfieldZoomSurfaceNode(node)
  }, [])

  const applyKeyboardMathfieldZoomStyle = useCallback((zoom: number) => {
    keyboardMathfieldZoomRef.current = zoom
    const surface = keyboardMathfieldZoomSurfaceRef.current
    if (!surface) return
    ;(surface.style as any).zoom = String(zoom)
  }, [])

  const updateRecentLetters = useCallback((letter: string) => {
    setRecentLetters((prev) => {
      const normalizedLetter = letter.toLowerCase()
      const updated = [letter, ...prev.filter((candidate) => candidate.toLowerCase() !== normalizedLetter)].slice(0, 5)
      recentLettersRef.current = updated
      return updated
    })
  }, [])

  const updateRecentRepresentativeAction = useCallback((actionId: string) => {
    const representativeKeyId = KEYBOARD_ACTION_REPRESENTATIVE_MAP[actionId]
    if (!representativeKeyId || representativeKeyId === 'letters') return

    setRecentRepresentativeActions((prev) => {
      const current = prev[representativeKeyId] || []
      const next = [actionId, ...current.filter((candidate) => candidate !== actionId)].slice(0, 6)
      return {
        ...prev,
        [representativeKeyId]: next,
      }
    })
  }, [])

  const triggerKeyboardSwipeBlock = useCallback((message: string, blockedActionId?: string) => {
    setKeyboardTransientWarning(message)
    if (keyboardTransientWarningTimeoutRef.current) {
      clearTimeout(keyboardTransientWarningTimeoutRef.current)
    }
    keyboardTransientWarningTimeoutRef.current = setTimeout(() => {
      setKeyboardTransientWarning((current) => (current === message ? null : current))
    }, 2200)

    if (blockedActionId) {
      setKeyboardBlockedActionId(blockedActionId)
      if (keyboardBlockedActionTimeoutRef.current) {
        clearTimeout(keyboardBlockedActionTimeoutRef.current)
      }
      keyboardBlockedActionTimeoutRef.current = setTimeout(() => {
        setKeyboardBlockedActionId((current) => (current === blockedActionId ? null : current))
      }, 650)
    }
  }, [])

  const [selectedKeyboardKey, setSelectedKeyboardKey] = useState<string | null>(null)
  const [keyboardBlockedActionId, setKeyboardBlockedActionId] = useState<string | null>(null)
  const [keyboardTransientWarning, setKeyboardTransientWarning] = useState<string | null>(null)
  const keyboardBlockedActionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keyboardTransientWarningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [keyboardUppercase, setKeyboardUppercase] = useState(false)
  const [keyboardPaletteVisible, setKeyboardPaletteVisible] = useState(false)
  const [recentLetters, setRecentLetters] = useState<string[]>(['x', 'y', 'f', 'k', 't'])
  const recentLettersRef = useRef<string[]>(['x', 'y', 'f', 'k', 't'])
  const [recentRepresentativeActions, setRecentRepresentativeActions] = useState<Record<string, string[]>>({
    calculus: ['derivative', 'second-derivative', 'integral', 'limit'],
    relations: ['equals', 'neq', 'leq', 'geq'],
    trig: ['sin', 'cos', 'tan'],
    logs: ['log-base', 'log', 'ln'],
    greek: ['theta', 'pi', 'infinity', 'degree'],
    enclosures: ['paren', 'bracket', 'absolute', 'brace'],
  })
  const [activeKeyboardRadialTarget, setActiveKeyboardRadialTarget] = useState<KeyboardStageTarget | null>(null)
  const [activeKeyboardFamilyTarget, setActiveKeyboardFamilyTarget] = useState<KeyboardStageTarget | null>(null)
  const activeKeyboardFamilyTargetRef = useRef<KeyboardStageTarget | null>(null)
  const [keyboardOverlayAnchor, setKeyboardOverlayAnchor] = useState<KeyboardOverlayAnchor | null>(null)
  const [mathpixError, setMathpixError] = useState<string | null>(null)
  const [mathpixRawResponse, setMathpixRawResponse] = useState<string | null>(null)
  const [mathpixLastProxyPayload, setMathpixLastProxyPayload] = useState<string | null>(null)
  const [mathpixLastUpstreamPayload, setMathpixLastUpstreamPayload] = useState<string | null>(null)
  const [mathpixLastEventCount, setMathpixLastEventCount] = useState<number | null>(null)
  const [mathpixLocalStrokeCount, setMathpixLocalStrokeCount] = useState<number | null>(null)
  const [mathpixLocalPointCount, setMathpixLocalPointCount] = useState<number | null>(null)
  const [mathpixStatus, setMathpixStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
  const [mathpixLastRequestAt, setMathpixLastRequestAt] = useState<number | null>(null)
  const [mathpixLastResponseAt, setMathpixLastResponseAt] = useState<number | null>(null)
  const [mathpixLastStatusCode, setMathpixLastStatusCode] = useState<number | null>(null)
  const [mathpixLastStrokeCount, setMathpixLastStrokeCount] = useState<number | null>(null)
  const [mathpixLastPointCount, setMathpixLastPointCount] = useState<number | null>(null)
  const mathpixRequestSeqRef = useRef(0)
  const mathpixPreviewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mathpixLocalStrokesRef = useRef<Array<{ x: number[]; y: number[] }>>([])
  const mathpixActivePointerRef = useRef<Map<number, { x: number[]; y: number[] }>>(new Map())
  const [rawInkStrokes, setRawInkStrokes] = useState<RawInkStroke[]>([])
  const rawInkStrokesRef = useRef<RawInkStroke[]>([])
  const [rawInkActivePreview, setRawInkActivePreview] = useState<RawInkStroke[]>([])
  const rawInkActiveStrokesRef = useRef<Map<number, RawInkStroke>>(new Map())
  const rawInkTouchPointerIdsRef = useRef<Set<number>>(new Set())
  const rawInkEraserPointerIdsRef = useRef<Set<number>>(new Set())
  const rawInkRedoStackRef = useRef<RawInkStroke[][]>([])
  const rawInkBroadcastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rawInkModePageSnapshotsRef = useRef<Array<SnapshotPayload | null>>([{ mode: 'raw-ink', symbols: null, rawInk: { strokes: [] }, latex: '', jiix: null, version: 0, snapshotId: 'raw-initial', baseSymbolCount: -1 }])
  const mathModePageSnapshotsRef = useRef<Array<SnapshotPayload | null>>([null])
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [hasMounted, setHasMounted] = useState(false)
  const [viewportBottomOffsetPx, setViewportBottomOffsetPx] = useState(0)

  const [isEraserMode, setIsEraserMode] = useState(false)
  const isEraserModeRef = useRef(false)
  useEffect(() => {
    isEraserModeRef.current = isEraserMode
  }, [isEraserMode])

  useEffect(() => {
    latexOutputRef.current = latexOutput
  }, [latexOutput])

  useEffect(() => {
    const nextLength = latexOutput.length
    setKeyboardSelection((current) => {
      const nextSelection = {
        start: Math.min(current.start, nextLength),
        end: Math.min(current.end, nextLength),
      }
      keyboardSelectionRef.current = nextSelection
      return nextSelection
    })
  }, [latexOutput])

  useEffect(() => {
    keyboardSelectionRef.current = keyboardSelection
  }, [keyboardSelection])

  useEffect(() => {
    canvasModeRef.current = canvasMode
  }, [canvasMode])

  useEffect(() => {
    recognitionEngineRef.current = recognitionEngine
  }, [recognitionEngine])

  const syncKeyboardControlStripState = useCallback((mathfield?: MathfieldElementType | null, latexValueOverride?: string) => {
    if (recognitionEngineRef.current !== 'keyboard') return

    const field = (mathfield ?? keyboardMathfieldRef.current) as KeyboardHistoryAwareMathfield | null
    const nextValue = typeof latexValueOverride === 'string'
      ? latexValueOverride
      : (field?.getValue('latex') || latexOutputRef.current || '')

    let nextCanUndo = nextValue.trim().length > 0
    let nextCanRedo = false

    if (field) {
      if (typeof field.canUndo === 'function') {
        nextCanUndo = field.canUndo()
      } else if (typeof field.undoDepth === 'number') {
        nextCanUndo = field.undoDepth > 0
      }

      if (typeof field.canRedo === 'function') {
        nextCanRedo = field.canRedo()
      } else if (typeof field.redoDepth === 'number') {
        nextCanRedo = field.redoDepth > 0
      }
    }

    setCanUndo(nextCanUndo)
    setCanRedo(nextCanRedo)
    setCanClear(nextValue.trim().length > 0)
  }, [])

  const getKeyboardMathfieldLatexOffsetFromModelOffset = useCallback((field: MathfieldElementType | null | undefined, modelOffset: number) => {
    if (!field || typeof modelOffset !== 'number' || !Number.isFinite(modelOffset) || modelOffset <= 0) {
      return 0
    }

    const offsetReadableField = field as MathfieldElementType & {
      getValue(start: number, end: number, format?: 'latex'): string
    }

    try {
      return offsetReadableField.getValue(0, Math.max(0, modelOffset), 'latex').length
    } catch {
      return 0
    }
  }, [])

  const getKeyboardMathfieldModelOffsetFromLatexOffset = useCallback((
    field: MathfieldElementType | null | undefined,
    latexOffset: number,
    options?: { bias?: 'start' | 'end' },
  ) => {
    if (!field || typeof latexOffset !== 'number' || !Number.isFinite(latexOffset) || latexOffset <= 0) {
      return 0
    }

    const currentValue = field.getValue('latex') || ''
    const normalizedLatexOffset = Math.max(0, Math.min(latexOffset, currentValue.length))
    const offsetReadableField = field as MathfieldElementType & {
      getValue(start: number, end: number, format?: 'latex'): string
    }

    if (options?.bias === 'start') {
      let low = 0
      let high = currentValue.length
      let bestOffset = currentValue.length

      while (low <= high) {
        const mid = Math.floor((low + high) / 2)
        let prefixLength = 0
        try {
          prefixLength = offsetReadableField.getValue(0, mid, 'latex').length
        } catch {
          prefixLength = 0
        }

        if (prefixLength < normalizedLatexOffset) {
          low = mid + 1
        } else {
          bestOffset = mid
          high = mid - 1
        }
      }

      return bestOffset
    }

    let low = 0
    let high = currentValue.length
    let bestOffset = 0

    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      let prefixLength = 0
      try {
        prefixLength = offsetReadableField.getValue(0, mid, 'latex').length
      } catch {
        prefixLength = 0
      }

      if (prefixLength <= normalizedLatexOffset) {
        bestOffset = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }

    return bestOffset
  }, [])

  const getKeyboardMathfieldSelectionOffsets = useCallback((field: MathfieldElementType | null | undefined) => {
    const selectableField = field as (MathfieldElementType & {
      selection?: { ranges?: [number, number][]; direction?: 'forward' | 'backward' | 'none' }
    }) | null | undefined
    const range = selectableField?.selection?.ranges?.[0]
    if (range) {
      const [rangeStart, rangeEnd] = range
      const rawStart = getKeyboardMathfieldLatexOffsetFromModelOffset(field, Math.min(rangeStart, rangeEnd))
      const rawEnd = getKeyboardMathfieldLatexOffsetFromModelOffset(field, Math.max(rangeStart, rangeEnd))
      return {
        start: rawStart,
        end: rawEnd,
      }
    }

    const nextPosition = typeof field?.position === 'number' ? field.position : 0
    const rawPosition = getKeyboardMathfieldLatexOffsetFromModelOffset(field, nextPosition)
    return { start: rawPosition, end: rawPosition }
  }, [getKeyboardMathfieldLatexOffsetFromModelOffset])

  const getKeyboardMathfieldPreviousModelTerm = useCallback((field: MathfieldElementType | null | undefined) => {
    if (!field) return null

    const offsetReadableField = field as MathfieldElementType & {
      getValue(start: number, end: number, format?: 'latex'): string
    }
    const modelPosition = typeof field.position === 'number' ? field.position : 0
    if (!Number.isFinite(modelPosition) || modelPosition <= 0) return null

    let bestMatch: { start: number; end: number; symbol: string } | null = null
    let sawStableBestSlice = false
    const minStart = Math.max(0, modelPosition - 24)

    for (let start = modelPosition - 1; start >= minStart; start -= 1) {
      let slice = ''
      try {
        slice = offsetReadableField.getValue(start, modelPosition, 'latex') || ''
      } catch {
        slice = ''
      }
      if (!slice.trim()) continue

      const sliceTarget = findKeyboardReferenceTarget(slice, {
        start: slice.length,
        end: slice.length,
      })
      const isWholeSliceTarget = Boolean(
        sliceTarget &&
        sliceTarget.start === 0 &&
        sliceTarget.end === slice.length &&
        isKeyboardReferenceTargetCommandBoundarySafe(slice, sliceTarget) &&
        isValidKeyboardStructuralReferenceTarget(sliceTarget) &&
        !isKeyboardPlaceholderExpression(sliceTarget.symbol),
      )

      if (!isWholeSliceTarget) {
        if (bestMatch) break
        continue
      }

      if (bestMatch && slice === bestMatch.symbol) {
        sawStableBestSlice = true
        continue
      }

      if (bestMatch && sawStableBestSlice) {
        break
      }

      bestMatch = {
        start,
        end: modelPosition,
        symbol: slice,
      }
      sawStableBestSlice = false
    }

    return bestMatch
  }, [])

  const clearKeyboardTransientRadicalTimer = useCallback(() => {
    if (keyboardTransientRadicalTimeoutRef.current) {
      clearTimeout(keyboardTransientRadicalTimeoutRef.current)
      keyboardTransientRadicalTimeoutRef.current = null
    }
  }, [])

  const resolveKeyboardTransientRadicalPromptIdsForRegion = useCallback((region: KeyboardRadicalRegion) => {
    const promptIds = resolveKeyboardTransientRadicalPromptIds(region)
    if (promptIds) return promptIds

    const storedPromptIds = keyboardTransientRadicalPromptIdsRef.current
    const storedAnchorStart = keyboardTransientRadicalAnchorStartRef.current
    if (!storedPromptIds || storedAnchorStart === null) return null
    return Math.abs(storedAnchorStart - region.start) <= 1 ? storedPromptIds : null
  }, [])

  const resolveKeyboardTransientRadicalSelectionField = useCallback((
    field: MathfieldElementType | null | undefined,
    promptIds: KeyboardTransientRadicalPromptIds,
  ): 'index' | 'radicand' | null => {
    if (!field) return null

    const promptField = field as MathfieldElementType & {
      getPromptRange?: (id: string) => [number, number] | null
      selection?: { ranges?: [number, number][]; direction?: 'forward' | 'backward' | 'none' }
    }
    const selectionRange = promptField.selection?.ranges?.[0]
    if (!selectionRange) return null

    const selectionStart = Math.min(selectionRange[0], selectionRange[1])
    const selectionEnd = Math.max(selectionRange[0], selectionRange[1])
    const isWithinPrompt = (promptId: string) => {
      const promptRange = promptField.getPromptRange?.(promptId)
      if (!promptRange) return false
      const promptStart = Math.min(promptRange[0], promptRange[1])
      const promptEnd = Math.max(promptRange[0], promptRange[1])
      return selectionStart >= promptStart && selectionEnd <= promptEnd
    }

    if (isWithinPrompt(promptIds.radicandPromptId)) return 'radicand'
    if (isWithinPrompt(promptIds.indexPromptId)) return 'index'
    return null
  }, [])

  const resolveKeyboardTransientRadicalFieldFromLiveSelection = useCallback((
    field: MathfieldElementType | null | undefined,
    region: KeyboardRadicalRegion,
    selection: KeyboardSelectionState,
    storedTargetField?: 'index' | 'radicand' | null,
    promptIds?: KeyboardTransientRadicalPromptIds | null,
  ): 'index' | 'radicand' => {
    if (!region.hasIndex) return 'radicand'

    if (promptIds) {
      const promptTargetField = resolveKeyboardTransientRadicalSelectionField(field, promptIds)
      if (promptTargetField) return promptTargetField
    }

    const selectionField = field as MathfieldElementType & {
      selection?: { ranges?: [number, number][]; direction?: 'forward' | 'backward' | 'none' }
    }
    const selectionRange = selectionField?.selection?.ranges?.[0]
    if (selectionRange && field) {
      const rawSelectionStart = Math.min(selectionRange[0], selectionRange[1])
      const rawSelectionEnd = Math.max(selectionRange[0], selectionRange[1])
      const indexLatex = promptIds && region.hasIndex
        ? normalizeKeyboardTransientRadicalFieldContent(region.indexSymbol, promptIds.indexPromptId)
        : region.indexSymbol
      const boundaryStart = getKeyboardMathfieldModelOffsetFromLatexOffset(field, indexLatex.length, { bias: 'start' })
      const boundaryEnd = getKeyboardMathfieldModelOffsetFromLatexOffset(field, indexLatex.length, { bias: 'end' })

      if (rawSelectionEnd <= boundaryStart) return 'index'
      if (rawSelectionStart >= boundaryEnd) return 'radicand'
    }

    return resolveKeyboardTransientRadicalFieldFromSelection(region, selection, storedTargetField, promptIds)
  }, [getKeyboardMathfieldModelOffsetFromLatexOffset, resolveKeyboardTransientRadicalSelectionField])

  const createKeyboardTransientRadicalPromptIds = useCallback(() => {
    keyboardTransientRadicalSequenceRef.current += 1
    return getKeyboardTransientRadicalPromptIds(keyboardTransientRadicalSequenceRef.current.toString(36))
  }, [])

  const configureKeyboardMathfieldInstance = (
    field: MathfieldElementType,
    initialLatex: string,
  ) => {
    keyboardMathfieldRef.current = field
    field.className = 'keyboard-mathlive-field block h-full w-full bg-white text-slate-900'
    field.setAttribute('aria-label', 'Keyboard expression')
    field.setAttribute('spellcheck', 'false')
    field.mathVirtualKeyboardPolicy = 'manual'
    field.smartFence = true
    field.smartMode = false
    field.smartSuperscript = true
    field.readOnly = false
    field.value = initialLatex
    ;(field.style as CSSStyleDeclaration).overflow = 'visible'
    ;(field.style as CSSStyleDeclaration).width = 'max-content'
    ;(field.style as CSSStyleDeclaration).minWidth = '100%'
    ;(field.style as CSSStyleDeclaration).minHeight = '100%'
    ;(field.style as CSSStyleDeclaration).touchAction = 'none'
    ;(field.style as CSSStyleDeclaration).webkitUserSelect = 'text'
    ;(field.style as CSSStyleDeclaration).userSelect = 'text'

    const shadowRootHost = field as MathfieldElementType & { shadowRoot?: ShadowRoot | null }
    const shadowRoot = shadowRootHost.shadowRoot
    if (shadowRoot && !shadowRoot.getElementById('keyboard-mathlive-shadow-overrides')) {
      const overrideStyle = document.createElement('style')
      overrideStyle.id = 'keyboard-mathlive-shadow-overrides'
      overrideStyle.textContent = `
        [part="menu-toggle"],
        [part="virtual-keyboard-toggle"],
        [part="menu-toggle-container"],
        [part="virtual-keyboard-toggle-container"],
        [part="toolbar"],
        [part="controls"],
        [part="control-strip"],
        .ML__menu-toggle,
        .ML__virtual-keyboard-toggle,
        .ML__toolbar,
        .ML__controls,
        .ML__control-strip {
          display: none !important;
          width: 0 !important;
          min-width: 0 !important;
          max-width: 0 !important;
          padding: 0 !important;
          margin: 0 !important;
          border: 0 !important;
        }

        [part="container"],
        .ML__container {
          padding-right: 0 !important;
          inset-inline-end: 0 !important;
        }
      `
      shadowRoot.appendChild(overrideStyle)
    }

    const handleInput = () => {
      if (keyboardMathfieldSyncRef.current) return
      const rewroteTransientRadical = trackKeyboardTransientRadicalActivity(field, 'input')
      const activeField = keyboardMathfieldRef.current ?? field
      if (normalizeKeyboardTransientRadicalInput(activeField)) return
      if (rewroteTransientRadical) return
      syncKeyboardMathfieldState(activeField)
    }

    const handleSelectionChange = () => {
      if (keyboardMathfieldSyncRef.current) return
      setKeyboardSelectionState(getKeyboardMathfieldSelectionOffsets(field))
      trackKeyboardTransientRadicalActivity(field, 'selection')
    }

    field.addEventListener('input', handleInput)
    field.addEventListener('selection-change', handleSelectionChange)
    keyboardMathfieldCleanupRef.current = () => {
      field?.removeEventListener('input', handleInput)
      field?.removeEventListener('selection-change', handleSelectionChange)
      if (field?.parentElement) {
        try {
          field.parentElement.replaceChildren()
        } catch {}
      }
      if (keyboardMathfieldRef.current === field) {
        keyboardMathfieldRef.current = null
      }
    }
  }

  const rewriteKeyboardMathfieldLatex = (
    field: MathfieldElementType | null | undefined,
    nextValue: string,
    nextSelection: KeyboardSelectionState,
    options?: {
      moveToLastPlaceholder?: boolean
      targetPromptId?: string | null
      targetField?: 'index' | 'radicand'
      selectionAnchor?: KeyboardSelectionState | null
      selectionCommand?: string | null
      positionBias?: 'start' | 'end'
      transientRadicalSerializedPrefixLength?: number
    },
  ) => {
    const host = keyboardMathfieldHostNode
    if (!field || !host) return false

    const FieldConstructor = field.constructor as { new (): MathfieldElementType }
    const nextField = new FieldConstructor()
    const previousCleanup = keyboardMathfieldCleanupRef.current
    keyboardMathfieldCleanupRef.current = null
    previousCleanup?.()

    configureKeyboardMathfieldInstance(nextField, nextValue)

    if (!host.isConnected) return false
    host.replaceChildren(nextField)
    applyKeyboardMathfieldZoomStyle(keyboardMathfieldZoomRef.current)

    keyboardMathfieldSyncRef.current = true
    try {
      nextField.focus()
      if (options?.targetPromptId && selectKeyboardMathfieldPrompt(nextField, options.targetPromptId)) {
        // Prompt selection already positioned the caret in the intended editable region.
      } else if (options?.moveToLastPlaceholder) {
        nextField.position = typeof nextField.getValue === 'function' ? (nextField.getValue('latex') || '').length : 0
        nextField.executeCommand?.('moveToPreviousPlaceholder')
      } else {
        const selectionAnchor = options?.selectionAnchor ?? nextSelection
        const serializedPrefixLength = typeof options?.transientRadicalSerializedPrefixLength === 'number'
          ? options.transientRadicalSerializedPrefixLength
          : selectionAnchor.end
        const nextPosition = getKeyboardMathfieldModelOffsetFromLatexOffset(nextField, serializedPrefixLength, {
          bias: options?.positionBias,
        })
        nextField.position = nextPosition
        if (options?.selectionCommand) {
          nextField.executeCommand?.(options.selectionCommand)
        }
      }
    } finally {
      keyboardMathfieldSyncRef.current = false
    }

    syncKeyboardMathfieldState(nextField)
    return true
  }

  const collapseKeyboardTransientRadical = useCallback(() => {
    clearKeyboardTransientRadicalTimer()

    const field = keyboardMathfieldRef.current
    const anchorStart = keyboardTransientRadicalAnchorStartRef.current
    if (!field || anchorStart === null) return

    const currentValue = field.getValue('latex') || ''
    const region = findKeyboardRadicalRegionNearStart(currentValue, anchorStart)
    if (!region || !region.hasIndex || !isKeyboardRadicalIndexEmpty(region)) return

    const promptIds = resolveKeyboardTransientRadicalPromptIdsForRegion(region)
    if (promptIds) {
      keyboardTransientRadicalPromptIdsRef.current = promptIds
      keyboardTransientRadicalAnchorStartRef.current = region.start
    }

    const selection = getKeyboardMathfieldSelectionOffsets(field)
    const collapsed = collapseKeyboardExpandedRadical(currentValue, selection, region)
    if (!collapsed) return

    rewriteKeyboardMathfieldLatex(field, collapsed.value, {
      start: collapsed.selectionStart,
      end: collapsed.selectionEnd,
    }, {
      targetPromptId: collapsed.radicandPromptId,
    })
  }, [clearKeyboardTransientRadicalTimer, getKeyboardMathfieldSelectionOffsets, resolveKeyboardTransientRadicalPromptIdsForRegion, rewriteKeyboardMathfieldLatex])

  const scheduleKeyboardTransientRadicalTimer = useCallback((anchorStart: number, promptIds?: KeyboardTransientRadicalPromptIds | null) => {
    keyboardTransientRadicalAnchorStartRef.current = anchorStart
    if (promptIds) {
      keyboardTransientRadicalPromptIdsRef.current = promptIds
    }
    clearKeyboardTransientRadicalTimer()
    keyboardTransientRadicalTimeoutRef.current = setTimeout(() => {
      collapseKeyboardTransientRadical()
    }, KEYBOARD_TRANSIENT_RADICAL_IDLE_MS)
  }, [clearKeyboardTransientRadicalTimer, collapseKeyboardTransientRadical])

  const normalizeKeyboardTransientRadicalInput = useCallback((field: MathfieldElementType | null | undefined) => {
    if (!field) return false

    const currentValue = field.getValue('latex') || ''
    const selection = getKeyboardMathfieldSelectionOffsets(field)
    const probeOffset = selection.end > selection.start ? selection.end : Math.max(0, selection.end)
    const region = findKeyboardRadicalRegionAtPosition(currentValue, probeOffset)
      || (probeOffset > 0 ? findKeyboardRadicalRegionAtPosition(currentValue, probeOffset - 1) : null)
    if (!region) return false

    const promptIds = resolveKeyboardTransientRadicalPromptIdsForRegion(region)
    if (!promptIds) return false

    const canonical = buildKeyboardCanonicalTransientRadicalFromRegion(region, promptIds)
    if (canonical.value === currentValue.slice(region.start, region.end)) return false

    const editingIndex = region.hasIndex && selection.end <= region.radicandGroupStart
    const targetPromptId = editingIndex
      ? (canonical.indexLatex.trim() ? null : promptIds.indexPromptId)
      : (canonical.radicandLatex.trim() ? null : promptIds.radicandPromptId)
    const targetSelection = editingIndex && canonical.indexLatex.trim()
      ? getKeyboardTransientRadicalFieldSelectionOffset(region.start, promptIds, canonical.indexLatex, canonical.radicandLatex, 'index', true)
      : (!editingIndex && canonical.radicandLatex.trim())
        ? getKeyboardTransientRadicalFieldSelectionOffset(region.start, promptIds, canonical.indexLatex, canonical.radicandLatex, 'radicand', region.hasIndex)
        : selection.end

    const rewritten = rewriteKeyboardMathfieldLatex(
      field,
      `${currentValue.slice(0, region.start)}${canonical.value}${currentValue.slice(region.end)}`,
      { start: targetSelection, end: targetSelection },
      {
        targetPromptId,
        targetField: editingIndex ? 'index' : 'radicand',
        positionBias: 'start',
        transientRadicalSerializedPrefixLength: getKeyboardTransientRadicalSerializedPrefixLength(
          region.start,
          canonical.indexLatex,
          canonical.radicandLatex,
          editingIndex ? 'index' : 'radicand',
        ),
      },
    )

    if (rewritten) {
      keyboardTransientRadicalActiveFieldRef.current = editingIndex ? 'index' : 'radicand'
    }

    if (rewritten && region.hasIndex && !canonical.indexLatex.trim()) {
      scheduleKeyboardTransientRadicalTimer(region.start, promptIds)
    }

    return rewritten
  }, [getKeyboardMathfieldSelectionOffsets, resolveKeyboardTransientRadicalPromptIdsForRegion, rewriteKeyboardMathfieldLatex, scheduleKeyboardTransientRadicalTimer])

  const trackKeyboardTransientRadicalActivity = useCallback((
    field: MathfieldElementType | null | undefined,
    source: 'insert' | 'input' | 'selection',
  ) => {
    if (!field) return false

    const currentValue = field.getValue('latex') || ''
    const selection = getKeyboardMathfieldSelectionOffsets(field)
    const probeOffset = selection.end > selection.start ? selection.end : Math.max(0, selection.end)
    const region = findKeyboardRadicalRegionAtPosition(currentValue, probeOffset)
      || (probeOffset > 0 ? findKeyboardRadicalRegionAtPosition(currentValue, probeOffset - 1) : null)

    if (!region) {
      return false
    }

    const shouldExpandCollapsedSelection = source === 'selection'
      && !region.hasIndex
      && keyboardTransientRadicalAnchorStartRef.current !== null
      && Math.abs(keyboardTransientRadicalAnchorStartRef.current - region.start) <= 1
      && selection.end <= region.start

    if ((source === 'input' || shouldExpandCollapsedSelection) && !region.hasIndex) {
      const promptIds = resolveKeyboardTransientRadicalPromptIdsForRegion(region)
      const expanded = expandKeyboardCollapsedRadical(currentValue, selection, region, promptIds)
      const expandedRegion = expanded ? findKeyboardRadicalRegionNearStart(expanded.value, region.start) : null
      const expandedPromptIds = expandedRegion ? (resolveKeyboardTransientRadicalPromptIds(expandedRegion) || promptIds) : promptIds
      const expandedIndexLatex = expandedRegion?.hasIndex && expandedPromptIds
        ? normalizeKeyboardTransientRadicalFieldContent(expandedRegion.indexSymbol, expandedPromptIds.indexPromptId)
        : ''
      const expandedRadicandLatex = expandedRegion && expandedPromptIds
        ? normalizeKeyboardTransientRadicalFieldContent(expandedRegion.radicandSymbol, expandedPromptIds.radicandPromptId)
        : ''
      const expandedTargetField = shouldExpandCollapsedSelection ? 'index' : 'radicand'
      const preserveCollapsedRadicandSelection = Boolean(
        expanded
        && expandedTargetField === 'radicand'
        && expandedRegion
        && expandedPromptIds
        && expandedRadicandLatex.trim(),
      )
      if (expanded && rewriteKeyboardMathfieldLatex(field, expanded.value, {
        start: expanded.selectionStart,
        end: expanded.selectionEnd,
      }, {
        targetPromptId: shouldExpandCollapsedSelection && promptIds ? promptIds.indexPromptId : expanded.radicandPromptId,
        targetField: expandedTargetField,
        selectionAnchor: preserveCollapsedRadicandSelection ? selection : undefined,
        positionBias: 'start',
        transientRadicalSerializedPrefixLength: preserveCollapsedRadicandSelection
          ? selection.end
          : expandedRegion
            ? getKeyboardTransientRadicalSerializedPrefixLength(
                expandedRegion.start,
                expandedIndexLatex,
                expandedRadicandLatex,
                expandedTargetField,
              )
            : undefined,
      })) {
        const nextRegion = expandedRegion
        if (nextRegion?.hasIndex) {
          scheduleKeyboardTransientRadicalTimer(nextRegion.start, promptIds)
        }
        keyboardTransientRadicalActiveFieldRef.current = shouldExpandCollapsedSelection ? 'index' : 'radicand'
        return true
      }
    }

    if (region.hasIndex) {
      const promptIds = resolveKeyboardTransientRadicalPromptIdsForRegion(region)
      keyboardTransientRadicalActiveFieldRef.current = resolveKeyboardTransientRadicalFieldFromLiveSelection(
        field,
        region,
        selection,
        keyboardTransientRadicalActiveFieldRef.current,
        promptIds,
      )
      scheduleKeyboardTransientRadicalTimer(region.start, promptIds)
    }

    return false
  }, [getKeyboardMathfieldSelectionOffsets, resolveKeyboardTransientRadicalFieldFromLiveSelection, resolveKeyboardTransientRadicalPromptIdsForRegion, rewriteKeyboardMathfieldLatex, scheduleKeyboardTransientRadicalTimer])

  const syncKeyboardMathfieldState = useCallback((mathfield?: MathfieldElementType | null) => {
    const field = mathfield ?? keyboardMathfieldRef.current
    if (!field) return
    const nextValue = field.getValue('latex') || ''
    const nextSelection = getKeyboardMathfieldSelectionOffsets(field)
    setLatexOutput(nextValue)
    latexOutputRef.current = nextValue
    if (useAdminStepComposerRef.current && canOrchestrateLesson) {
      setAdminDraftLatex(nextValue)
    }
    setKeyboardSelectionState(nextSelection)
    syncKeyboardControlStripState(field, nextValue)
  }, [canOrchestrateLesson, getKeyboardMathfieldSelectionOffsets, setKeyboardSelectionState, syncKeyboardControlStripState])

  const captureKeyboardTransientRadicalProgrammaticEditContext = useCallback((field: MathfieldElementType | null | undefined): KeyboardTransientRadicalProgrammaticEditContext | null => {
    if (!field) return null

    const currentValue = field.getValue('latex') || ''
    const selection = getKeyboardMathfieldSelectionOffsets(field)
    const probeOffset = selection.end > selection.start ? selection.end : Math.max(0, selection.end)
    const region = findKeyboardRadicalRegionAtPosition(currentValue, probeOffset)
      || (probeOffset > 0 ? findKeyboardRadicalRegionAtPosition(currentValue, probeOffset - 1) : null)
    if (!region) return null

    const promptIds = resolveKeyboardTransientRadicalPromptIdsForRegion(region)
    if (!promptIds) return null

    const storedTargetField = keyboardTransientRadicalAnchorStartRef.current !== null
      && Math.abs(keyboardTransientRadicalAnchorStartRef.current - region.start) <= 1
      ? keyboardTransientRadicalActiveFieldRef.current
      : null
    const indexLatex = region.hasIndex
      ? normalizeKeyboardTransientRadicalFieldContent(region.indexSymbol, promptIds.indexPromptId)
      : ''
    const radicandLatex = normalizeKeyboardTransientRadicalFieldContent(region.radicandSymbol, promptIds.radicandPromptId)
    const targetField = resolveKeyboardTransientRadicalFieldFromLiveSelection(field, region, selection, storedTargetField, promptIds)
    const targetSelection = getKeyboardTransientRadicalFieldSelectionRange(selection, indexLatex, radicandLatex, targetField)

    return {
      anchorStart: region.start,
      promptIds,
      targetField,
      targetSelectionStart: targetSelection.start,
      targetSelectionEnd: targetSelection.end,
    }
  }, [getKeyboardMathfieldSelectionOffsets, resolveKeyboardTransientRadicalFieldFromLiveSelection, resolveKeyboardTransientRadicalPromptIdsForRegion])

  const shouldUseNativeKeyboardTransientRadicalEditing = useCallback((
    field: MathfieldElementType | null | undefined,
    context: KeyboardTransientRadicalProgrammaticEditContext | null | undefined,
  ) => {
    if (!field || !context) return false

    const currentValue = field.getValue('latex') || ''
    const region = findKeyboardRadicalRegionNearStart(currentValue, context.anchorStart)
    if (!region) return false

    const promptIds = resolveKeyboardTransientRadicalPromptIdsForRegion(region) || context.promptIds
    if (!promptIds) return false

    const selection = getKeyboardMathfieldSelectionOffsets(field)
    const liveTargetField = resolveKeyboardTransientRadicalFieldFromLiveSelection(
      field,
      region,
      selection,
      null,
      promptIds,
    )
    if (liveTargetField !== context.targetField) return false

    const targetLatex = context.targetField === 'index'
      ? (region.hasIndex ? normalizeKeyboardTransientRadicalFieldContent(region.indexSymbol, promptIds.indexPromptId) : '')
      : normalizeKeyboardTransientRadicalFieldContent(region.radicandSymbol, promptIds.radicandPromptId)

    return Boolean(targetLatex.trim())
  }, [getKeyboardMathfieldSelectionOffsets, resolveKeyboardTransientRadicalFieldFromLiveSelection, resolveKeyboardTransientRadicalPromptIdsForRegion])

  const refreshKeyboardTransientRadicalNativeState = useCallback((
    field: MathfieldElementType | null | undefined,
    context: KeyboardTransientRadicalProgrammaticEditContext | null | undefined,
  ) => {
    if (!field || !context) return false

    const currentValue = field.getValue('latex') || ''
    const region = findKeyboardRadicalRegionNearStart(currentValue, context.anchorStart)
    if (!region) return false

    const promptIds = resolveKeyboardTransientRadicalPromptIdsForRegion(region) || context.promptIds
    if (!promptIds) return false

    keyboardTransientRadicalAnchorStartRef.current = region.start
    keyboardTransientRadicalPromptIdsRef.current = promptIds
    keyboardTransientRadicalActiveFieldRef.current = context.targetField

    if (region.hasIndex) {
      const indexLatex = normalizeKeyboardTransientRadicalFieldContent(region.indexSymbol, promptIds.indexPromptId)
      if (!indexLatex.trim()) {
        scheduleKeyboardTransientRadicalTimer(region.start, promptIds)
      } else {
        clearKeyboardTransientRadicalTimer()
      }
    } else {
      clearKeyboardTransientRadicalTimer()
    }

    syncKeyboardMathfieldState(field)
    return true
  }, [clearKeyboardTransientRadicalTimer, resolveKeyboardTransientRadicalPromptIdsForRegion, scheduleKeyboardTransientRadicalTimer, syncKeyboardMathfieldState])

  const reconcileKeyboardTransientRadicalProgrammaticEdit = useCallback((
    field: MathfieldElementType | null | undefined,
    context: KeyboardTransientRadicalProgrammaticEditContext | null | undefined,
    selectionIntent?: KeyboardTransientRadicalSelectionIntent | null,
  ) => {
    if (!field || !context) return false

    const currentValue = field.getValue('latex') || ''
    const currentSelection = getKeyboardMathfieldSelectionOffsets(field)
    const region = findKeyboardRadicalRegionNearStart(currentValue, context.anchorStart)
    if (!region) return false

    const promptIds = resolveKeyboardTransientRadicalPromptIdsForRegion(region) || context.promptIds
    if (!promptIds) return false

    const indexLatex = region.hasIndex
      ? normalizeKeyboardTransientRadicalFieldContent(region.indexSymbol, promptIds.indexPromptId)
      : ''
    const radicandLatex = normalizeKeyboardTransientRadicalFieldContent(region.radicandSymbol, promptIds.radicandPromptId)
    const nextRadical = buildKeyboardTransientRadicalLatex(promptIds, radicandLatex, indexLatex)
    const nextValue = `${currentValue.slice(0, region.start)}${nextRadical}${currentValue.slice(region.end)}`
    const targetPromptId = context.targetField === 'index'
      ? (indexLatex.trim() ? null : promptIds.indexPromptId)
      : (radicandLatex.trim() ? null : promptIds.radicandPromptId)
    const targetSelection = context.targetField === 'index'
      ? (indexLatex.trim()
          ? getKeyboardTransientRadicalFieldSelectionOffset(region.start, promptIds, indexLatex, radicandLatex, 'index', true)
          : currentSelection.end)
      : (radicandLatex.trim()
          ? getKeyboardTransientRadicalFieldSelectionOffset(region.start, promptIds, indexLatex, radicandLatex, 'radicand', true)
          : currentSelection.end)

    const rewritten = rewriteKeyboardMathfieldLatex(
      field,
      nextValue,
      { start: targetSelection, end: targetSelection },
      {
        targetPromptId,
        targetField: context.targetField,
        selectionAnchor: selectionIntent?.anchorSelection,
        selectionCommand: selectionIntent?.command,
        positionBias: 'start',
        transientRadicalSerializedPrefixLength: selectionIntent?.anchorSelection.end
          ?? getKeyboardTransientRadicalSerializedPrefixLength(
            region.start,
            indexLatex,
            radicandLatex,
            context.targetField,
          ),
      },
    )
    if (!rewritten) return false

    keyboardTransientRadicalActiveFieldRef.current = context.targetField
    if (!indexLatex.trim()) {
      scheduleKeyboardTransientRadicalTimer(region.start, promptIds)
    }

    return true
  }, [getKeyboardMathfieldSelectionOffsets, resolveKeyboardTransientRadicalPromptIdsForRegion, rewriteKeyboardMathfieldLatex, scheduleKeyboardTransientRadicalTimer])

  const applyKeyboardTransientRadicalTextInsert = useCallback((
    field: MathfieldElementType | null | undefined,
    insertedLatex: string,
    context: KeyboardTransientRadicalProgrammaticEditContext | null | undefined,
  ) => {
    if (!field || !context || !insertedLatex) return false

    const currentValue = field.getValue('latex') || ''
    const region = findKeyboardRadicalRegionNearStart(currentValue, context.anchorStart)
    if (!region) return false

    const promptIds = resolveKeyboardTransientRadicalPromptIdsForRegion(region) || context.promptIds
    if (!promptIds) return false

    const indexLatex = region.hasIndex
      ? normalizeKeyboardTransientRadicalFieldContent(region.indexSymbol, promptIds.indexPromptId)
      : ''
    const radicandLatex = normalizeKeyboardTransientRadicalFieldContent(region.radicandSymbol, promptIds.radicandPromptId)
    const selectionStart = Math.max(0, Math.min(context.targetSelectionStart, context.targetSelectionEnd))
    const selectionEnd = Math.max(selectionStart, Math.max(context.targetSelectionStart, context.targetSelectionEnd))
    const nextIndexLatex = context.targetField === 'index'
      ? `${indexLatex.slice(0, selectionStart)}${insertedLatex}${indexLatex.slice(selectionEnd)}`
      : indexLatex
    const nextRadicandLatex = context.targetField === 'radicand'
      ? `${radicandLatex.slice(0, selectionStart)}${insertedLatex}${radicandLatex.slice(selectionEnd)}`
      : radicandLatex
    const nextValue = `${currentValue.slice(0, region.start)}${buildKeyboardTransientRadicalLatex(promptIds, nextRadicandLatex, nextIndexLatex)}${currentValue.slice(region.end)}`
    const nextRelativeSelection = selectionStart + insertedLatex.length
    const targetSelection = getKeyboardTransientRadicalFieldSelectionOffset(
      region.start,
      promptIds,
      context.targetField === 'index' ? nextIndexLatex.slice(0, nextRelativeSelection) : nextIndexLatex,
      context.targetField === 'radicand' ? nextRadicandLatex.slice(0, nextRelativeSelection) : nextRadicandLatex,
      context.targetField,
      true,
    )

    const rewritten = rewriteKeyboardMathfieldLatex(
      field,
      nextValue,
      { start: targetSelection, end: targetSelection },
      {
        targetPromptId: null,
        targetField: context.targetField,
        positionBias: 'start',
        transientRadicalSerializedPrefixLength: getKeyboardTransientRadicalSerializedPrefixLength(
          region.start,
          context.targetField === 'index' ? nextIndexLatex.slice(0, nextRelativeSelection) : nextIndexLatex,
          context.targetField === 'radicand' ? nextRadicandLatex.slice(0, nextRelativeSelection) : nextRadicandLatex,
          context.targetField,
        ),
      },
    )
    if (!rewritten) return false

    keyboardTransientRadicalActiveFieldRef.current = context.targetField
    if (!nextIndexLatex.trim()) {
      scheduleKeyboardTransientRadicalTimer(region.start, promptIds)
    }

    return true
  }, [resolveKeyboardTransientRadicalPromptIdsForRegion, rewriteKeyboardMathfieldLatex, scheduleKeyboardTransientRadicalTimer])

  const finalizeKeyboardMathfieldProgrammaticEdit = useCallback((
    field: MathfieldElementType | null | undefined,
    transientRadicalContext?: KeyboardTransientRadicalProgrammaticEditContext | null,
    selectionIntent?: KeyboardTransientRadicalSelectionIntent | null,
  ) => {
    const activeField = keyboardMathfieldRef.current ?? field
    if (!activeField) return false

    if (transientRadicalContext && shouldUseNativeKeyboardTransientRadicalEditing(activeField, transientRadicalContext)) {
      return refreshKeyboardTransientRadicalNativeState(activeField, transientRadicalContext)
    }

    if (transientRadicalContext && reconcileKeyboardTransientRadicalProgrammaticEdit(activeField, transientRadicalContext, selectionIntent)) {
      return true
    }

    const rewroteTransientRadical = trackKeyboardTransientRadicalActivity(activeField, 'input')
    const nextField = keyboardMathfieldRef.current ?? activeField
    if (normalizeKeyboardTransientRadicalInput(nextField)) return true
    if (rewroteTransientRadical) return true

    syncKeyboardMathfieldState(nextField)
    return true
  }, [normalizeKeyboardTransientRadicalInput, reconcileKeyboardTransientRadicalProgrammaticEdit, refreshKeyboardTransientRadicalNativeState, shouldUseNativeKeyboardTransientRadicalEditing, syncKeyboardMathfieldState, trackKeyboardTransientRadicalActivity])

  useEffect(() => {
    if (recognitionEngine !== 'keyboard') return
    syncKeyboardControlStripState(keyboardMathfieldRef.current, latexOutput)
  }, [latexOutput, recognitionEngine, syncKeyboardControlStripState])

  useEffect(() => {
    if (!hasMounted) return
    if (!keyboardMathfieldHostNode) return

    let disposed = false

    ;(async () => {
      let field = keyboardMathfieldRef.current
      if (!field) {
        const { MathfieldElement } = await import('mathlive')
        if (disposed) return

        field = new MathfieldElement()
        configureKeyboardMathfieldInstance(field, latexOutputRef.current || '')
      }

      if (disposed || !field || !keyboardMathfieldHostNode.isConnected) return
      if (field.parentElement !== keyboardMathfieldHostNode) {
        keyboardMathfieldHostNode.replaceChildren(field)
      }
      applyKeyboardMathfieldZoomStyle(keyboardMathfieldZoomRef.current)
    })()

    return () => {
      disposed = true
      const field = keyboardMathfieldRef.current
      if (!field) return
      if (keyboardMathfieldHostNode.contains(field)) {
        keyboardMathfieldHostNode.replaceChildren()
      }
    }
  }, [applyKeyboardMathfieldZoomStyle, hasMounted, keyboardMathfieldHostNode, keyboardMathfieldZoomSurfaceNode])

  useEffect(() => {
    if (recognitionEngine !== 'keyboard') {
      applyKeyboardMathfieldZoomStyle(1)
    }
  }, [applyKeyboardMathfieldZoomStyle, recognitionEngine])

  useEffect(() => {
    if (recognitionEngine !== 'keyboard') return

    const viewport = keyboardMathfieldViewportNode
    if (!viewport) return

    const gesture = keyboardMathfieldTouchGestureRef.current
    const PINCH_START_THRESHOLD = 0.025
    const PAN_START_THRESHOLD_PX = 1.5
    const ZOOM_UPDATE_THRESHOLD = 0.04
    const PAN_UPDATE_THRESHOLD_PX = 0.8
    const TWO_FINGER_PAN_GAIN = 0.4
    const MIN_ZOOM = 1
    const MAX_ZOOM = 4

    const getPinchDistance = (touches: TouchList) => {
      const a = touches[0]
      const b = touches[1]
      if (!a || !b) return 0
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        if (event.cancelable) {
          event.preventDefault()
        }
        gesture.singleTouchActive = false
        gesture.selectionMode = false
        gesture.pinchActive = true

        const rect = viewport.getBoundingClientRect()
        const a = event.touches[0]
        const b = event.touches[1]
        const midpointX = rect ? ((a.clientX + b.clientX) / 2) - rect.left : viewport.clientWidth / 2
        const midpointY = rect ? ((a.clientY + b.clientY) / 2) - rect.top : viewport.clientHeight / 2

        gesture.startDist = getPinchDistance(event.touches)
        gesture.startZoom = keyboardMathfieldZoomRef.current
        gesture.startScrollLeft = viewport.scrollLeft
        gesture.startScrollTop = viewport.scrollTop
        gesture.anchorX = midpointX
        gesture.anchorY = midpointY
        gesture.lastMidpointX = midpointX
        gesture.lastMidpointY = midpointY
        return
      }

      if (event.touches.length === 1) {
        gesture.singleTouchActive = true
        gesture.pinchActive = false
        gesture.selectionMode = false
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      if (gesture.pinchActive && event.touches.length === 2) {
        event.preventDefault()
        const dist = getPinchDistance(event.touches)
        if (!dist || !gesture.startDist) return

        const rect = viewport.getBoundingClientRect()
        const a = event.touches[0]
        const b = event.touches[1]
        const midpointX = rect ? ((a.clientX + b.clientX) / 2) - rect.left : gesture.anchorX
        const midpointY = rect ? ((a.clientY + b.clientY) / 2) - rect.top : gesture.anchorY
        const midpointStepDx = midpointX - gesture.lastMidpointX
        const midpointStepDy = midpointY - gesture.lastMidpointY
        const scale = dist / gesture.startDist
        const midpointDx = midpointX - gesture.anchorX
        const midpointDy = midpointY - gesture.anchorY
        const panDistance = Math.hypot(midpointDx, midpointDy)

        if (Math.abs(scale - 1) < PINCH_START_THRESHOLD && panDistance < PAN_START_THRESHOLD_PX) return

        const nextZoom = Math.min(Math.max(gesture.startZoom * scale, MIN_ZOOM), MAX_ZOOM)
        if (Math.abs(nextZoom - keyboardMathfieldZoomRef.current) < ZOOM_UPDATE_THRESHOLD && panDistance < PAN_UPDATE_THRESHOLD_PX) return

        const prevZoom = Math.max(0.5, keyboardMathfieldZoomRef.current)
        const ratioDelta = nextZoom / prevZoom
        const currentLeft = viewport.scrollLeft
        const currentTop = viewport.scrollTop

        applyKeyboardMathfieldZoomStyle(nextZoom)

        const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
        const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
        const zoomLeft = (ratioDelta * (currentLeft + midpointX)) - midpointX
        const zoomTop = (ratioDelta * (currentTop + midpointY)) - midpointY
        const nextLeft = zoomLeft - (midpointStepDx * TWO_FINGER_PAN_GAIN)
        const nextTop = zoomTop - (midpointStepDy * TWO_FINGER_PAN_GAIN)

        viewport.scrollLeft = Math.max(0, Math.min(nextLeft, maxLeft))
        viewport.scrollTop = Math.max(0, Math.min(nextTop, maxTop))

        gesture.lastMidpointX = midpointX
        gesture.lastMidpointY = midpointY
        return
      }
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (gesture.pinchActive && event.touches.length < 2) {
        gesture.pinchActive = false
      }

      if (event.touches.length === 0) {
        gesture.singleTouchActive = false
        gesture.selectionMode = false
        return
      }

      if (event.touches.length === 1) {
        gesture.singleTouchActive = true
        gesture.selectionMode = false
      }
    }

    const onTouchCancel = () => {
      gesture.singleTouchActive = false
      gesture.pinchActive = false
      gesture.selectionMode = false
    }

    viewport.addEventListener('touchstart', onTouchStart, { passive: false })
    viewport.addEventListener('touchmove', onTouchMove, { passive: false })
    viewport.addEventListener('touchend', onTouchEnd, { passive: true })
    viewport.addEventListener('touchcancel', onTouchCancel, { passive: true })

    return () => {
      viewport.removeEventListener('touchstart', onTouchStart)
      viewport.removeEventListener('touchmove', onTouchMove)
      viewport.removeEventListener('touchend', onTouchEnd)
      viewport.removeEventListener('touchcancel', onTouchCancel)
      gesture.singleTouchActive = false
      gesture.pinchActive = false
      gesture.selectionMode = false
    }
  }, [applyKeyboardMathfieldZoomStyle, keyboardMathfieldViewportNode, recognitionEngine])

  useEffect(() => {
    return () => {
      keyboardMathfieldCleanupRef.current?.()
      keyboardMathfieldCleanupRef.current = null
    }
  }, [])

  useEffect(() => {
    const field = keyboardMathfieldRef.current
    if (!field || keyboardMathfieldSyncRef.current) return

    const currentValue = field.getValue('latex') || ''
    const nextValue = latexOutput || ''
    if (currentValue === nextValue) return

    keyboardMathfieldSyncRef.current = true
    try {
      field.setValue(nextValue)
      setKeyboardSelectionState(getKeyboardMathfieldSelectionOffsets(field))
    } finally {
      keyboardMathfieldSyncRef.current = false
    }
  }, [getKeyboardMathfieldSelectionOffsets, latexOutput, setKeyboardSelectionState])

  const keyboardIdleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keyboardRepresentativeTapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keyboardRepresentativeLastTapRef = useRef<{ keyId: string; ts: number } | null>(null)
  const keyboardRepresentativeLongPressRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null
    keyId: string | null
    pointerId: number | null
    triggered: boolean
  }>({
    timer: null,
    keyId: null,
    pointerId: null,
    triggered: false,
  })

  const closeKeyboardTransientOverlays = useCallback(() => {
    setActiveKeyboardRadialTarget(null)
    setActiveKeyboardFamilyTarget(null)
    activeKeyboardFamilyTargetRef.current = null
    setKeyboardOverlayAnchor(null)
  }, [])

  const clearKeyboardRepresentativeTapTimeout = useCallback(() => {
    if (!keyboardRepresentativeTapTimeoutRef.current) return
    clearTimeout(keyboardRepresentativeTapTimeoutRef.current)
    keyboardRepresentativeTapTimeoutRef.current = null
  }, [])

  const clearKeyboardRepresentativeLongPress = useCallback(() => {
    if (keyboardRepresentativeLongPressRef.current.timer) {
      clearTimeout(keyboardRepresentativeLongPressRef.current.timer)
    }
    keyboardRepresentativeLongPressRef.current = {
      timer: null,
      keyId: null,
      pointerId: null,
      triggered: false,
    }
  }, [])

  const stopKeyboardSwipeHold = useCallback(() => {
    if (keyboardSwipeHoldTimeoutRef.current) {
      clearTimeout(keyboardSwipeHoldTimeoutRef.current)
      keyboardSwipeHoldTimeoutRef.current = null
    }
    keyboardSwipeHoldStateRef.current = {
      pointerId: null,
      direction: null,
      active: false,
    }
  }, [])

  const clearKeyboardIdleTimeout = useCallback(() => {
    if (!keyboardIdleTimeoutRef.current) return
    clearTimeout(keyboardIdleTimeoutRef.current)
    keyboardIdleTimeoutRef.current = null
  }, [])

  const scheduleKeyboardFadeOut = useCallback(() => {
    clearKeyboardIdleTimeout()
    if (typeof window === 'undefined') return
    keyboardIdleTimeoutRef.current = setTimeout(() => {
      // Don't hide palette or close overlays while a family overlay is open.
      // It will be dismissed when the user taps away.
      if (activeKeyboardFamilyTargetRef.current) {
        keyboardIdleTimeoutRef.current = null
        return
      }
      setKeyboardPaletteVisible(false)
      closeKeyboardTransientOverlays()
      keyboardIdleTimeoutRef.current = null
    }, KEYBOARD_IDLE_MS)
  }, [clearKeyboardIdleTimeout, closeKeyboardTransientOverlays])

  const revealKeyboardPalette = useCallback(() => {
    if (recognitionEngineRef.current !== 'keyboard') return
    setKeyboardPaletteVisible(true)
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        keyboardExpressionSurfaceRef.current?.focus()
      }, 0)
    }
    scheduleKeyboardFadeOut()
  }, [scheduleKeyboardFadeOut])

  useEffect(() => {
    if (recognitionEngine !== 'keyboard') {
      setKeyboardPaletteVisible(false)
      closeKeyboardTransientOverlays()
      clearKeyboardRepresentativeTapTimeout()
      clearKeyboardRepresentativeLongPress()
      clearKeyboardIdleTimeout()
      return
    }
    const seed = (latexOutputRef.current || '').trim()
    setLatexOutput(seed)
    latexOutputRef.current = seed
  }, [clearKeyboardIdleTimeout, clearKeyboardRepresentativeLongPress, clearKeyboardRepresentativeTapTimeout, closeKeyboardTransientOverlays, recognitionEngine])

  useEffect(() => {
    return () => {
      clearKeyboardRepresentativeTapTimeout()
      clearKeyboardRepresentativeLongPress()
      clearKeyboardIdleTimeout()
      stopKeyboardSwipeHold()
    }
  }, [clearKeyboardIdleTimeout, clearKeyboardRepresentativeLongPress, clearKeyboardRepresentativeTapTimeout, stopKeyboardSwipeHold])

  useEffect(() => {
    rawInkStrokesRef.current = rawInkStrokes
  }, [rawInkStrokes])

  useEffect(() => {
    if (canvasMode !== 'raw-ink') return
    setStatus('ready')
    setFatalError(null)
    setTransientError(null)
    setIsConverting(false)
    setMyScriptEditorReady(false)
    setMyScriptLastError(null)
    setLatexOutput('')
  }, [canvasMode])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const currentCount = Number((window as any).__philani_stacked_canvas_active_count || 0)
    ;(window as any).__philani_stacked_canvas_active_count = currentCount + 1
    ;(window as any).__philani_silence_stacked_canvas_errors = true
    return () => {
      const nextCount = Math.max(0, Number((window as any).__philani_stacked_canvas_active_count || 1) - 1)
      ;(window as any).__philani_stacked_canvas_active_count = nextCount
      if (nextCount === 0) {
        ;(window as any).__philani_silence_stacked_canvas_errors = false
      }
    }
  }, [])

  const updateMathpixLocalCounts = useCallback(() => {
    const strokes = mathpixLocalStrokesRef.current
    if (!strokes.length) {
      setMathpixLocalStrokeCount(null)
      setMathpixLocalPointCount(null)
      return
    }
    setMathpixLocalStrokeCount(strokes.length)
    setMathpixLocalPointCount(strokes.reduce((sum, stroke) => sum + stroke.x.length, 0))
  }, [])

  const clearMathpixLocalStrokes = useCallback(() => {
    mathpixLocalStrokesRef.current = []
    mathpixActivePointerRef.current.clear()
    setMathpixLocalStrokeCount(null)
    setMathpixLocalPointCount(null)
  }, [])

  const clearMathEditorForLocalReload = useCallback(async () => {
    const editor = editorInstanceRef.current
    if (!editor) return

    try {
      editor.clear?.()
    } catch {}

    try {
      if (typeof editor.waitForIdle === 'function') {
        await editor.waitForIdle()
      }
    } catch {}

    await nextAnimationFrame()
  }, [])

  const syncMathEditorGeometryForLocalReload = useCallback(async () => {
    try {
      editorInstanceRef.current?.resize?.()
    } catch {}
    await nextAnimationFrame()

    const editor = editorInstanceRef.current
    if (!editor) return

    try {
      if (typeof editor.waitForIdle === 'function') {
        await editor.waitForIdle()
      }
    } catch {}
  }, [])

  useEffect(() => {
    if (recognitionEngine !== 'mathpix') {
      clearMathpixLocalStrokes()
    }
  }, [recognitionEngine, clearMathpixLocalStrokes])

  useEffect(() => {
    if (!isEraserMode) return
    clearMathpixLocalStrokes()
  }, [clearMathpixLocalStrokes, isEraserMode])

  useEffect(() => {
    if (canvasModeRef.current === 'raw-ink') return
    const host = editorHostRef.current
    if (!host) return

    const addPoint = (evt: PointerEvent, stroke: { x: number[]; y: number[] }) => {
      const rect = host.getBoundingClientRect()
      const px = evt.clientX - rect.left
      const py = evt.clientY - rect.top
      if (!Number.isFinite(px) || !Number.isFinite(py)) return
      stroke.x.push(Math.round(px))
      stroke.y.push(Math.round(py))
    }

    const handlePointerDown = (evt: PointerEvent) => {
      if (recognitionEngineRef.current !== 'mathpix') return
      if (isEraserModeRef.current) return
      const stroke = { x: [], y: [] }
      mathpixActivePointerRef.current.set(evt.pointerId, stroke)
      mathpixLocalStrokesRef.current.push(stroke)
      addPoint(evt, stroke)
      updateMathpixLocalCounts()
    }

    const handlePointerMove = (evt: PointerEvent) => {
      if (recognitionEngineRef.current !== 'mathpix') return
      if (isEraserModeRef.current) return
      const stroke = mathpixActivePointerRef.current.get(evt.pointerId)
      if (!stroke) return
      addPoint(evt, stroke)
      updateMathpixLocalCounts()
    }

    const handlePointerUp = (evt: PointerEvent) => {
      if (mathpixActivePointerRef.current.has(evt.pointerId)) {
        mathpixActivePointerRef.current.delete(evt.pointerId)
        updateMathpixLocalCounts()
      }
    }

    host.addEventListener('pointerdown', handlePointerDown, { passive: true })
    host.addEventListener('pointermove', handlePointerMove, { passive: true })
    window.addEventListener('pointerup', handlePointerUp, { passive: true })
    window.addEventListener('pointercancel', handlePointerUp, { passive: true })

    return () => {
      host.removeEventListener('pointerdown', handlePointerDown)
      host.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [updateMathpixLocalCounts])

  useEffect(() => {
    if (!isTechnicalAdmin) return
    if (uiMode === 'overlay') return
    if (typeof window === 'undefined') return
    try {
      const saved = window.localStorage.getItem(RECOGNITION_ENGINE_STORAGE_KEY)
      if (saved === 'keyboard' || saved === 'myscript' || saved === 'mathpix') {
        setRecognitionEngine(saved)
      }
    } catch {}
  }, [isTechnicalAdmin])

  useEffect(() => {
    if (!isTechnicalAdmin) return
    if (uiMode === 'overlay') return
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(RECOGNITION_ENGINE_STORAGE_KEY, recognitionEngine)
    } catch {}
  }, [isTechnicalAdmin, recognitionEngine, uiMode])

  useEffect(() => {
    if (!initialRecognitionEngine) return
    setRecognitionEngine((prev) => (prev === initialRecognitionEngine ? prev : initialRecognitionEngine))
    setMathpixError(null)
  }, [initialRecognitionEngine])

  const [eraserShimReady, setEraserShimReady] = useState(false)
  const eraserLongPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const eraserLongPressTriggeredRef = useRef(false)

  const initialOrientation: CanvasOrientation = defaultOrientation || (canOrchestrateLesson ? 'landscape' : 'portrait')
  const [canvasOrientation, setCanvasOrientation] = useState<CanvasOrientation>(initialOrientation)
  const isOverlayMode = uiMode === 'overlay'
  const canUseDebugPanel = ENABLE_RECOGNITION_DEBUG_PANEL && isTechnicalAdmin
  const canUseScrollDebugPanel = ENABLE_SCROLL_DEBUG_PANEL && isTechnicalAdmin
  const [isCompactViewport, setIsCompactViewport] = useState(false)

  useEffect(() => {
    if (typeof onLatexOutputChange !== 'function') return
    onLatexOutputChange(latexOutput)
  }, [latexOutput, onLatexOutputChange])

  useEffect(() => {
    if (initialQuiz || isAssignmentView) return
    const seedLatex = typeof initialComposedLatex === 'string' ? initialComposedLatex.trim() : ''
    setLatexOutput(seedLatex)
    latexOutputRef.current = seedLatex
  }, [initialComposedLatex, initialQuiz, isAssignmentView])

  const isStudentView = !canOrchestrateLesson
  const isQuizMode = Boolean(quizMode)
  const isChallengeBoard = useMemo(
    () => typeof boardId === 'string' && boardId.startsWith('challenge:'),
    [boardId]
  )
  const isSessionQuizMode = !isAssignmentView && !forceEditableForAssignment && !isChallengeBoard
  const useStackedStudentLayout = isStudentView || (canOrchestrateLesson && isCompactViewport)
  const useCompactEdgeToEdge = Boolean(compactEdgeToEdge && isOverlayMode && isCompactViewport)
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

  // Teacher-only: single unified quiz setup overlay (replaces native prompt chain).
  const [quizSetupOpen, setQuizSetupOpen] = useState(false)
  const [quizSetupLoading, setQuizSetupLoading] = useState(false)
  const [quizSetupError, setQuizSetupError] = useState<string | null>(null)
  const [quizSetupLabel, setQuizSetupLabel] = useState('')
  const [quizSetupPrompt, setQuizSetupPrompt] = useState('')
  const [quizSetupMinutes, setQuizSetupMinutes] = useState(5)
  const [quizSetupSeconds, setQuizSetupSeconds] = useState(0)

  const clampQuizDurationSec = useCallback((seconds: number) => {
    const s = Number.isFinite(seconds) ? Math.trunc(seconds) : 0
    return Math.max(30, Math.min(1800, s))
  }, [])

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

    // Notify the quiz popup (TextOverlayModule) to hide any timer UI.
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('philani-quiz:timer', { detail: { active: false } }))
      }
    } catch {}
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

  const [presenterStateVersion, setPresenterStateVersion] = useState(0)

  const bumpPresenterStateVersion = useCallback(() => {
    setPresenterStateVersion(v => v + 1)
  }, [])

  const normalizeName = useCallback((value: string) => normalizeDisplayName(value), [])
  const getUserKey = useCallback((maybeUserId?: string, maybeName?: string) => getPresenterUserKey(maybeUserId, maybeName), [])

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
    // Controller-only actions (quiz/lesson orchestration) are teacher-only.
    return Boolean(canOrchestrateLesson)
  }, [canOrchestrateLesson])

  // Exclusive snapshot publishing rule:
  // - ONLY the active presenter may publish SnapshotPayload.
  // - Assignments/challenges remain locally editable regardless of presenter state.
  const canPublishSnapshots = useCallback(() => {
    if (forceEditableForAssignment) return true
    return isSelfActivePresenter()
  }, [forceEditableForAssignment, isSelfActivePresenter])

  const canPublishSnapshotsRef = useRef(canPublishSnapshots)

  useEffect(() => {
    canPublishSnapshotsRef.current = canPublishSnapshots
  }, [canPublishSnapshots])

  // Board write rights (edit UI + mutate local editor state):
  // - presenter-owned in live sessions,
  // - explicit quiz unlock for students,
  // - assignment/challenge local override.
  const hasBoardWriteRights = useCallback(() => {
    if (forceEditableForAssignment) return true
    if (!canOrchestrateLesson && isSessionQuizMode && quizActiveRef.current) return true
    return isSelfActivePresenter()
  }, [forceEditableForAssignment, canOrchestrateLesson, isSelfActivePresenter, isSessionQuizMode])

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

  // Step-composer mode is available to the teacher and to the active presenter.
  // This powers the multi-step editing UX (commit steps, recall/edit steps, step-boundary undo/redo).
  const useAdminStepComposer = Boolean(
    useStackedStudentLayout
    && (canOrchestrateLesson || hasBoardWriteRights())
    && !isAssignmentView
    && !isChallengeBoard
    // Do not enable the admin step-composer on single-user canvases (assignments/challenges).
    // Those flows use `studentCommittedLatex` + `latexOutput` and should append steps as new lines.
    && (canOrchestrateLesson || !forceEditable)
  )
  useEffect(() => {
    useAdminStepComposerRef.current = useAdminStepComposer
  }, [useAdminStepComposer])

  const allowStudentTextTray = (!canOrchestrateLesson || isAssignmentSolutionAuthoring) && (isAssignmentView || isChallengeBoard)
  const useStudentStepComposer = useStackedStudentLayout && (
    (!canOrchestrateLesson && (isAssignmentView || isChallengeBoard))
    || (isAssignmentSolutionAuthoring && isAssignmentView)
  )
  const showTextIcon = useAdminStepComposer || useStudentStepComposer || allowStudentTextTray

  const [selectedClientId, setSelectedClientId] = useState<string>('all')
  const [isBroadcastPaused, setIsBroadcastPaused] = useState(false)
  const isBroadcastPausedRef = useRef(false)
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(true)
  const [controlState, setControlState] = useState<ControlState>(null)

  const [overlayRosterVisible, setOverlayRosterVisible] = useState(false)
  const [handoffSwitching, setHandoffSwitching] = useState(false)
  const [handoffMessage, setHandoffMessage] = useState<string | null>(null)
  const [editingAuthorityUserKeys, setEditingAuthorityUserKeys] = useState<string[]>([])
  const [switchConflictActive, setSwitchConflictActive] = useState(false)
  const handoffMessageTimerRef = useRef<number | null>(null)
  const handoffInFlightRef = useRef(false)
  const pendingHandoffTargetRef = useRef<PresenterHandoffTarget>(null)
  const lastPresenterSetTsRef = useRef(0)
  const editingAuthorityUserKeysRef = useRef<Set<string>>(new Set())
  const switchConflictActiveRef = useRef(false)
  const conflictStartedAtRef = useRef<number | null>(null)
  const lastConflictReasonRef = useRef('')
  const conflictResolverInFlightRef = useRef(false)
  const lastConflictEnforceSignatureRef = useRef('')
  const lastConflictEnforceTsRef = useRef(0)
  const [highlightedController, setHighlightedController] = useState<{ clientId: string; userId?: string; name?: string; ts: number } | null>(null)
  const highlightedControllerRef = useRef<{ clientId: string; userId?: string; name?: string; ts: number } | null>(null)
  useEffect(() => {
    highlightedControllerRef.current = highlightedController
  }, [highlightedController])
  useEffect(() => {
    editingAuthorityUserKeysRef.current = new Set(editingAuthorityUserKeys)
  }, [editingAuthorityUserKeys])
  useEffect(() => {
    switchConflictActiveRef.current = switchConflictActive
  }, [switchConflictActive])
  useEffect(() => {
    if (!overlayChromePeekVisible || !isOverlayMode || !isCompactViewport) {
      setOverlayRosterVisible(false)
    }
  }, [isCompactViewport, isOverlayMode, overlayChromePeekVisible])

  const showHandoffFailure = useCallback((message: string) => {
    setHandoffMessage(message)
    if (typeof window === 'undefined') return
    if (handoffMessageTimerRef.current != null) {
      window.clearTimeout(handoffMessageTimerRef.current)
    }
    handoffMessageTimerRef.current = window.setTimeout(() => {
      handoffMessageTimerRef.current = null
      setHandoffMessage(null)
    }, 2600)
  }, [])

  useEffect(() => {
    return () => {
      if (typeof window === 'undefined') return
      if (handoffMessageTimerRef.current != null) {
        window.clearTimeout(handoffMessageTimerRef.current)
        handoffMessageTimerRef.current = null
      }
      if (continuityFallbackTimerRef.current != null) {
        window.clearTimeout(continuityFallbackTimerRef.current)
        continuityFallbackTimerRef.current = null
      }
    }
  }, [])

  const teacherBadge = useMemo(() => {
    const resolvedName = normalizeDisplayName(userDisplayName || '') || 'Teacher'
    return {
      name: resolvedName,
      initials: getPresenterInitials(resolvedName, 'T'),
    }
  }, [userDisplayName])

  const rawActivePresenterBadge = useMemo(() => deriveActivePresenterBadge({
    activePresenterUserKey: activePresenterUserKey || activePresenterUserKeyRef.current,
    activePresenterClientIds: activePresenterClientIdsRef.current,
    connectedClients,
    fallbackInitial: 'P',
  }), [activePresenterUserKey, connectedClients, presenterStateVersion])

  const activePresenterBadge = useMemo(() => {
    if (canOrchestrateLesson && isSelfActivePresenter()) return null
    return rawActivePresenterBadge
  }, [canOrchestrateLesson, isSelfActivePresenter, rawActivePresenterBadge])

  const setEditingAuthorityKeysStable = useCallback((nextKeys: string[]) => {
    const nextUnique = Array.from(new Set(nextKeys.filter(Boolean))).sort((a, b) => a.localeCompare(b))
    const current = editingAuthorityUserKeysRef.current
    if (current.size === nextUnique.length) {
      let same = true
      for (const key of nextUnique) {
        if (!current.has(key)) {
          same = false
          break
        }
      }
      if (same) return
    }
    setEditingAuthorityUserKeys(nextUnique)
  }, [])

  const setSwitchConflictActiveStable = useCallback((next: boolean) => {
    if (switchConflictActiveRef.current === next) return
    setSwitchConflictActive(next)
  }, [])

  const resolvePresenceByClientId = useCallback((candidateClientId?: string) => {
    const wanted = String(candidateClientId || '').trim()
    if (!wanted) return null
    return connectedClientsRef.current.find(client => client.clientId === wanted) || null
  }, [])

  const resolveUserForClientId = useCallback((candidateClientId?: string) => {
    const member = resolvePresenceByClientId(candidateClientId)
    if (!member) return null
    const name = normalizeDisplayName(member.name || '') || member.clientId
    const userKey = getUserKey(member.userId, name) || `client:${member.clientId}`
    return {
      userKey,
      name,
      clientId: member.clientId,
      userId: member.userId,
    }
  }, [getUserKey, resolvePresenceByClientId])

  const resolveIdentityForUserKey = useCallback((candidateUserKey?: string) => {
    const userKey = String(candidateUserKey || '').trim()
    if (!userKey) return null
    const members = connectedClientsRef.current.filter(client => {
      if (!client.clientId || client.clientId === 'all' || client.clientId === ALL_STUDENTS_ID) return false
      const name = normalizeDisplayName(client.name || '') || client.clientId
      const key = getUserKey(client.userId, name) || `client:${client.clientId}`
      return key === userKey
    })
    const first = members[0] || null
    return {
      userKey,
      name: first ? (normalizeDisplayName(first.name || '') || first.clientId) : userKey.replace(/^uid:|^name:|^client:/, ''),
      userId: first?.userId,
      clientIds: members.map(member => member.clientId),
    }
  }, [getUserKey])

  const isAvatarEditingAuthority = useCallback((userKey?: string | null) => {
    const key = String(userKey || '').trim()
    if (!key) return false
    return editingAuthorityUserKeysRef.current.has(key)
  }, [])

  const availableRosterAttendees = useMemo(() => deriveAvailableRosterAttendees({
    connectedClients,
    selfClientId: clientIdRef.current || '',
    selfUserId: String(userId || '').trim(),
    activePresenterUserKey: activePresenterUserKey || activePresenterUserKeyRef.current,
    activePresenterClientIds: activePresenterClientIdsRef.current,
    excludedClientIds: ['all', ALL_STUDENTS_ID],
  }), [activePresenterUserKey, connectedClients, presenterStateVersion, userId])

  const rosterAvatarLayout = useMemo(() => buildRosterAvatarLayout({
    activePresenterBadge,
    availableAttendees: availableRosterAttendees,
    overlayRosterVisible,
    attendeeInitialFallback: 'U',
  }), [activePresenterBadge, availableRosterAttendees, overlayRosterVisible])
  const showSwitchingToast = handoffSwitching || switchConflictActive
  const switchingStatusLabel = switchConflictActive ? 'Switching... conflict detected' : 'Switching...'
  const teacherAvatarGold = isAvatarEditingAuthority(selfUserKey)
  const [latexDisplayState, setLatexDisplayState] = useState<LatexDisplayState>({ enabled: false, latex: '', options: DEFAULT_LATEX_OPTIONS })
  const [latexProjectionOptions, setLatexProjectionOptions] = useState<LatexDisplayOptions>(DEFAULT_LATEX_OPTIONS)
  const [stackedNotesState, setStackedNotesState] = useState<StackedNotesState>({ latex: '', options: DEFAULT_LATEX_OPTIONS, ts: 0 })

  type AdminStep = { latex: string; symbols: any[] | null; jiix?: string | null; rawStrokes?: any[] | null; strokeGroups?: any[] | null }
  const [adminSteps, setAdminSteps] = useState<AdminStep[]>([])
  const [adminDraftLatex, setAdminDraftLatex] = useState('')
  const [adminSendingStep, setAdminSendingStep] = useState(false)
  const [adminEditIndex, setAdminEditIndex] = useState<number | null>(null)
  const adminTopPanelRef = useRef<HTMLDivElement | null>(null)
  const adminLastTapRef = useRef<{ ts: number; y: number } | null>(null)
  const previewExportInFlightRef = useRef(false)
  const latexRenderSourceRef = useRef('')
  const useAdminStepComposerRef = useRef(false)
  const computeEngine = useMemo(() => {
    try {
      const registry = (globalThis as any)?.[Symbol.for('io.cortexjs.compute-engine')]
      const Ctor = registry?.ComputeEngine
      return typeof Ctor === 'function' ? new Ctor() : null
    } catch {
      return null
    }
  }, [])

  type StudentStep = { latex: string; symbols: any[] | null; jiix?: string | null; rawStrokes?: any[] | null; strokeGroups?: any[] | null; createdAt?: string | number; updatedAt?: string | number }
  const [studentSteps, setStudentSteps] = useState<StudentStep[]>([])
  const [studentEditIndex, setStudentEditIndex] = useState<number | null>(null)
  const [keyboardSteps, setKeyboardSteps] = useState<NotebookStepRecord[]>([])
  const [keyboardEditIndex, setKeyboardEditIndex] = useState<number | null>(null)
  const parseCommittedStudentSteps = useCallback((source: string): StudentStep[] => {
    const committed = (source || '').trim()
    if (!committed) return []
    return committed
      .replace(/\r\n/g, '\n')
      .replace(/\\/g, '\n')
      .split('\n')
      .map(step => step.trim())
      .filter(Boolean)
      .map(latex => ({ latex, symbols: null, jiix: null, rawStrokes: null, strokeGroups: null }))
  }, [])
  const derivedStudentCommittedSteps = useMemo(
    () => parseCommittedStudentSteps(studentCommittedLatex),
    [parseCommittedStudentSteps, studentCommittedLatex]
  )
  useEffect(() => {
    if (!useStudentStepComposer) return
    if (recognitionEngine !== 'keyboard') return
    if (studentSteps.length > 0) return
    if (!derivedStudentCommittedSteps.length) return

    setStudentSteps(derivedStudentCommittedSteps)
  }, [derivedStudentCommittedSteps, recognitionEngine, studentSteps.length, useStudentStepComposer])
  const studentEditIndexRef = useRef<number | null>(null)
  useEffect(() => {
    studentEditIndexRef.current = studentEditIndex
  }, [studentEditIndex])

  const [topPanelEditingMode, setTopPanelEditingMode] = useState(false)
  const topPanelEditingModeRef = useRef(false)
  useEffect(() => {
    topPanelEditingModeRef.current = topPanelEditingMode
  }, [topPanelEditingMode])

  const [topPanelSelectedStep, setTopPanelSelectedStep] = useState<number | null>(null)
  const topPanelSelectedStepRef = useRef<number | null>(null)
  useEffect(() => {
    topPanelSelectedStepRef.current = topPanelSelectedStep
  }, [topPanelSelectedStep])
  const activeStepEditBaselineRef = useRef<{
    symbols: any[] | null
    jiix: string | null
    rawStrokes: any[] | null
    strokeGroups: any[] | null
  } | null>(null)
  const resyncLatexPreviewFromEditorRef = useRef<null | (() => Promise<void>)>(null)
  const [mobileTopPanelActionStepIndex, setMobileTopPanelActionStepIndex] = useState<number | null>(null)

  useEffect(() => {
    if (!isCompactViewport) {
      setMobileTopPanelActionStepIndex(null)
      return
    }
    if (topPanelSelectedStep === null || mobileTopPanelActionStepIndex !== topPanelSelectedStep) {
      setMobileTopPanelActionStepIndex(null)
    }
  }, [isCompactViewport, mobileTopPanelActionStepIndex, topPanelSelectedStep])

  useEffect(() => {
    if (!isCompactViewport) return
    if (mobileTopPanelActionStepIndex === null) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      const shell = target?.closest?.('[data-top-panel-step-shell]') as HTMLElement | null
      const shellIndex = shell?.getAttribute('data-step-idx')
      if (shellIndex === String(mobileTopPanelActionStepIndex)) return
      setMobileTopPanelActionStepIndex(null)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [isCompactViewport, mobileTopPanelActionStepIndex])

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

  const diagramIconTapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const diagramIconLastTapRef = useRef<number | null>(null)

  const textIconLastTapRef = useRef<number | null>(null)
  const textIconTapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const topPanelStepLongPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const topPanelStepLongPressTriggeredRef = useRef<number | null>(null)

  const clearTopPanelStepLongPress = useCallback(() => {
    if (topPanelStepLongPressTimeoutRef.current) {
      clearTimeout(topPanelStepLongPressTimeoutRef.current)
      topPanelStepLongPressTimeoutRef.current = null
    }
  }, [])

  const clearTopPanelSelection = useCallback(() => {
    activeStepEditBaselineRef.current = null
    setTopPanelSelectedStep(null)
  }, [])

  useEffect(() => {
    if (!initialQuiz) return
    if (canOrchestrateLesson) return
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

    // Notify the quiz popup (TextOverlayModule) so learners can see a timer on the prompt.
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('philani-quiz:timer', { detail: { active: true, endsAt, durationSec } }))
      }
    } catch {}

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

      // IMPORTANT: assignment responses store multi-step work using LaTeX line breaks (\\).
      // Do NOT split on a single backslash: that would destroy LaTeX commands (\frac, \sqrt, etc).
      const parsed = String(initialAssignmentLatex || '')
        .replace(/\r\n/g, '\n')
        .replace(/\\\\/g, '\n')
        .split('\n')
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
  }, [assignmentSubmission?.initialLatex, initialQuiz, canOrchestrateLesson, isQuizMode, playSnapSound, setQuizActiveState])

  const importStoredStepInk = useCallback(async (step: { symbols?: any[] | null; jiix?: string | null } | null | undefined) => {
    const editor = editorInstanceRef.current
    if (!editor) return 0

    const stepRawStrokes = Array.isArray((step as any)?.rawStrokes) ? (step as any).rawStrokes : []
    const stepStrokeGroups = Array.isArray((step as any)?.strokeGroups) ? (step as any).strokeGroups : []
    if (stepRawStrokes.length && typeof editor.reDraw === 'function') {
      try {
        await nextAnimationFrame()
        editor.reDraw(
          JSON.parse(JSON.stringify(stepRawStrokes)),
          JSON.parse(JSON.stringify(stepStrokeGroups))
        )
        if (typeof editor.waitForIdle === 'function') {
          await editor.waitForIdle()
        }
        const model = editor.model ?? {}
        const rawStrokes = Array.isArray((model as any).rawStrokes) ? (model as any).rawStrokes : []
        return rawStrokes.length
      } catch (err) {
        console.warn('Failed to redraw stored strokes for editing; falling back to JIIX/point events', err)
      }
    }

    const stepJiix = typeof step?.jiix === 'string' ? step.jiix.trim() : ''
    if (stepJiix && typeof editor.import_ === 'function') {
      try {
        await nextAnimationFrame()
        await editor.import_(stepJiix, 'application/vnd.myscript.jiix')
        if (typeof editor.waitForIdle === 'function') {
          await editor.waitForIdle()
        }
        const model = editor.model ?? {}
        return countSymbols((model as any).symbols)
      } catch (err) {
        console.warn('Failed to import stored JIIX for editing; falling back to point events', err)
      }
    }

    const stepSymbols = step?.symbols
    if (stepSymbols && Array.isArray(stepSymbols) && stepSymbols.length) {
      await nextAnimationFrame()
      await editor.importPointEvents(stepSymbols)
      if (typeof editor.waitForIdle === 'function') {
        await editor.waitForIdle()
      }
      return stepSymbols.length
    }

    return 0
  }, [])

  const extractEditorStrokeState = useCallback(() => {
    const editor = editorInstanceRef.current
    if (!editor) {
      return { rawStrokes: null, strokeGroups: null }
    }

    const model = editor.model ?? {}
    const rawStrokes = Array.isArray((model as any).rawStrokes)
      ? JSON.parse(JSON.stringify((model as any).rawStrokes))
      : null
    const strokeGroups = Array.isArray((model as any).strokeGroups)
      ? JSON.parse(JSON.stringify((model as any).strokeGroups))
      : null

    return { rawStrokes, strokeGroups }
  }, [])

  const mergeSerializedStepSymbols = useCallback((baselineSymbols: any[] | null | undefined, currentSymbols: any[] | null | undefined) => {
    const baseline = Array.isArray(baselineSymbols) ? baselineSymbols : []
    const current = Array.isArray(currentSymbols) ? currentSymbols : []
    if (!baseline.length) return current.length ? JSON.parse(JSON.stringify(current)) : null
    if (!current.length) return JSON.parse(JSON.stringify(baseline))
    return JSON.parse(JSON.stringify([...baseline, ...current]))
  }, [])

  const loadAdminStepForEditing = useCallback(async (index: number) => {
    if (!useAdminStepComposer) return
    if (index < 0 || index >= adminSteps.length) return

    const editor = editorInstanceRef.current
    if (!editor) return
    if (lockedOutRef.current) return

    setTopPanelSelectedStep(index)

    // Load selected step ink.
    suppressBroadcastUntilTsRef.current = Date.now() + 1200
    await clearMathEditorForLocalReload()
    if (useStackedStudentLayout) {
      await syncMathEditorGeometryForLocalReload()
    }

    const stepSymbols = adminSteps[index]?.symbols
    const stepJiix = adminSteps[index]?.jiix || null
    const stepLatex = adminSteps[index]?.latex || ''
    activeStepEditBaselineRef.current = {
      symbols: Array.isArray(stepSymbols) ? JSON.parse(JSON.stringify(stepSymbols)) : null,
      jiix: stepJiix,
      rawStrokes: Array.isArray(adminSteps[index]?.rawStrokes) ? JSON.parse(JSON.stringify(adminSteps[index]?.rawStrokes)) : null,
      strokeGroups: Array.isArray(adminSteps[index]?.strokeGroups) ? JSON.parse(JSON.stringify(adminSteps[index]?.strokeGroups)) : null,
    }
    let symbolCount = 0
    try {
      symbolCount = await importStoredStepInk(adminSteps[index])
    } catch (err) {
      console.warn('Failed to load step ink for editing', err)
    }
    lastSymbolCountRef.current = symbolCount
    lastBroadcastBaseCountRef.current = symbolCount

    await resyncLatexPreviewFromEditorRef.current?.()

    const recalledSnapshot = cloneSnapshotPayload({
      mode: 'math',
      symbols: Array.isArray(stepSymbols) ? stepSymbols : null,
      rawInk: null,
      latex: stepLatex,
      jiix: stepJiix,
      version: localVersionRef.current,
      snapshotId: `${clientIdRef.current}-${Date.now()}-step-edit-${index}`,
      baseSymbolCount: -1,
    })
    if (recalledSnapshot) {
      const page = pageIndexRef.current
      while (pageRecordsRef.current.length <= page) {
        pageRecordsRef.current.push({ snapshot: null })
      }
      while (mathModePageSnapshotsRef.current.length <= page) {
        mathModePageSnapshotsRef.current.push(null)
      }
      pageRecordsRef.current[page] = { snapshot: recalledSnapshot }
      mathModePageSnapshotsRef.current[page] = recalledSnapshot
      latestSnapshotRef.current = {
        snapshot: recalledSnapshot,
        ts: Date.now(),
        reason: symbolCount > 0 || stepLatex.trim() ? 'update' : 'clear',
      }
    }

    // Mark this step as the active edit target (so the next send overwrites it).
    setAdminEditIndex(index)
    setAdminDraftLatex(stepLatex)
  }, [adminSteps, clearMathEditorForLocalReload, importStoredStepInk, syncMathEditorGeometryForLocalReload, useAdminStepComposer, useStackedStudentLayout])

  const loadStudentStepForEditing = useCallback(async (index: number) => {
    const sourceSteps = studentSteps.length ? studentSteps : derivedStudentCommittedSteps
    if (index < 0 || index >= sourceSteps.length) return

    if (recognitionEngineRef.current === 'keyboard') {
      const stepLatex = sourceSteps[index]?.latex || ''
      setTopPanelSelectedStep(index)
      setStudentEditIndex(index)
      setLatexOutput(stepLatex)
      latexOutputRef.current = stepLatex
      const caret = stepLatex.length
      setKeyboardSelectionState({ start: caret, end: caret })
      return
    }

    const editor = editorInstanceRef.current
    if (!editor) return
    if (lockedOutRef.current) return

    setTopPanelSelectedStep(index)

    suppressBroadcastUntilTsRef.current = Date.now() + 1200
    await clearMathEditorForLocalReload()
    if (useStackedStudentLayout) {
      await syncMathEditorGeometryForLocalReload()
    }

    const stepSymbols = sourceSteps[index]?.symbols
    const stepJiix = sourceSteps[index]?.jiix || null
    const stepLatex = sourceSteps[index]?.latex || ''
    activeStepEditBaselineRef.current = {
      symbols: Array.isArray(stepSymbols) ? JSON.parse(JSON.stringify(stepSymbols)) : null,
      jiix: stepJiix,
      rawStrokes: Array.isArray(sourceSteps[index]?.rawStrokes) ? JSON.parse(JSON.stringify(sourceSteps[index]?.rawStrokes)) : null,
      strokeGroups: Array.isArray(sourceSteps[index]?.strokeGroups) ? JSON.parse(JSON.stringify(sourceSteps[index]?.strokeGroups)) : null,
    }
    let symbolCount = 0
    try {
      symbolCount = await importStoredStepInk(sourceSteps[index])
    } catch (err) {
      console.warn('Failed to load step ink for editing', err)
    }
    lastSymbolCountRef.current = symbolCount
    lastBroadcastBaseCountRef.current = symbolCount

    await resyncLatexPreviewFromEditorRef.current?.()

    const recalledSnapshot = cloneSnapshotPayload({
      mode: 'math',
      symbols: Array.isArray(stepSymbols) ? stepSymbols : null,
      rawInk: null,
      latex: stepLatex,
      jiix: stepJiix,
      version: localVersionRef.current,
      snapshotId: `${clientIdRef.current}-${Date.now()}-step-edit-${index}`,
      baseSymbolCount: -1,
    })
    if (recalledSnapshot) {
      const page = pageIndexRef.current
      while (pageRecordsRef.current.length <= page) {
        pageRecordsRef.current.push({ snapshot: null })
      }
      while (mathModePageSnapshotsRef.current.length <= page) {
        mathModePageSnapshotsRef.current.push(null)
      }
      pageRecordsRef.current[page] = { snapshot: recalledSnapshot }
      mathModePageSnapshotsRef.current[page] = recalledSnapshot
      latestSnapshotRef.current = {
        snapshot: recalledSnapshot,
        ts: Date.now(),
        reason: symbolCount > 0 || stepLatex.trim() ? 'update' : 'clear',
      }
    }

    setStudentEditIndex(index)
    setLatexOutput(stepLatex)
  }, [clearMathEditorForLocalReload, derivedStudentCommittedSteps, importStoredStepInk, setKeyboardSelectionState, studentSteps, syncMathEditorGeometryForLocalReload, useStackedStudentLayout])

  const loadTopPanelStepForEditing = useCallback(async (index: number) => {
    if (useAdminStepComposer) {
      if (recognitionEngineRef.current === 'keyboard') {
        if (index < 0 || index >= keyboardSteps.length) return
        const step = keyboardSteps[index]
        const nextLatex = step?.latex || ''
        setTopPanelSelectedStep(index)
        setKeyboardEditIndex(index)
        setLatexOutput(nextLatex)
        latexOutputRef.current = nextLatex
        if (useAdminStepComposerRef.current && hasControllerRights()) {
          setAdminDraftLatex(nextLatex)
        }
        const caret = nextLatex.length
        setKeyboardSelectionState({ start: caret, end: caret })
        return
      }
      await loadAdminStepForEditing(index)
      return
    }
    if (useStudentStepComposer) {
      await loadStudentStepForEditing(index)
    }
  }, [hasControllerRights, keyboardSteps, loadAdminStepForEditing, loadStudentStepForEditing, setKeyboardSelectionState, useAdminStepComposer, useStudentStepComposer])

  const clearTopPanelComposerCanvas = useCallback(async () => {
    suppressBroadcastUntilTsRef.current = Date.now() + 1200
    await clearMathEditorForLocalReload()
    clearMathpixLocalStrokes()
    lastSymbolCountRef.current = 0
    lastBroadcastBaseCountRef.current = 0
  }, [clearMathEditorForLocalReload, clearMathpixLocalStrokes])

  const startNewTopPanelStepDraft = useCallback(async () => {
    if (!useAdminStepComposer && !useStudentStepComposer) return
    if (lockedOutRef.current) return
    activeStepEditBaselineRef.current = null

    if (recognitionEngineRef.current === 'keyboard' && (useAdminStepComposer || useStudentStepComposer)) {
      if (useAdminStepComposer) {
        setKeyboardEditIndex(null)
      }
      if (useStudentStepComposer) {
        setStudentEditIndex(null)
      }
      setLatexOutput('')
      latexOutputRef.current = ''
      if (useAdminStepComposerRef.current && hasControllerRights()) {
        setAdminDraftLatex('')
      }
      clearTopPanelSelection()
      setKeyboardSelectionState({ start: 0, end: 0 })
      setTopPanelSelectedStep(null)
      return
    }

    if (useAdminStepComposer) {
      setAdminEditIndex(null)
      setAdminDraftLatex('')
    }
    if (useStudentStepComposer) {
      setStudentEditIndex(null)
    }

    setLatexOutput('')
    clearTopPanelSelection()
    await clearTopPanelComposerCanvas()
  }, [clearTopPanelComposerCanvas, clearTopPanelSelection, hasControllerRights, setKeyboardSelectionState, useAdminStepComposer, useStudentStepComposer])

  const duplicateTopPanelStepAsNew = useCallback(async (index: number) => {
    const studentSourceSteps = studentSteps.length ? studentSteps : derivedStudentCommittedSteps
    const sourceStep = useAdminStepComposer
      ? (recognitionEngineRef.current === 'keyboard' ? keyboardSteps[index] : adminSteps[index])
      : (useStudentStepComposer ? studentSourceSteps[index] : null)
    if (!sourceStep) return
    if (lockedOutRef.current) return
    activeStepEditBaselineRef.current = null

    if (recognitionEngineRef.current === 'keyboard' && (useAdminStepComposer || useStudentStepComposer)) {
      if (useAdminStepComposer) {
        setKeyboardEditIndex(null)
      }
      if (useStudentStepComposer) {
        setStudentEditIndex(null)
      }
      setTopPanelSelectedStep(index)
      const nextLatex = sourceStep.latex || ''
      setLatexOutput(nextLatex)
      latexOutputRef.current = nextLatex
      if (useAdminStepComposerRef.current && hasControllerRights()) {
        setAdminDraftLatex(nextLatex)
      }
      const caret = nextLatex.length
      setKeyboardSelectionState({ start: caret, end: caret })
      return
    }

    if (useAdminStepComposer) {
      setAdminEditIndex(null)
      setAdminDraftLatex(sourceStep.latex || '')
    }
    if (useStudentStepComposer) {
      setStudentEditIndex(null)
    }

    setTopPanelSelectedStep(index)
    setLatexOutput(sourceStep.latex || '')
    await clearTopPanelComposerCanvas()

    if ((Array.isArray(sourceStep.symbols) && sourceStep.symbols.length) || sourceStep.jiix) {
      try {
        const importedCount = await importStoredStepInk(sourceStep)
        lastSymbolCountRef.current = importedCount
        lastBroadcastBaseCountRef.current = importedCount
      } catch (err) {
        console.warn('Failed to duplicate step ink into composer', err)
      }
    }
  }, [adminSteps, clearTopPanelComposerCanvas, derivedStudentCommittedSteps, hasControllerRights, importStoredStepInk, keyboardSteps, setKeyboardSelectionState, studentSteps, useAdminStepComposer, useStudentStepComposer])

  const deleteTopPanelStep = useCallback(async (index: number) => {
    const studentSourceSteps = studentSteps.length ? studentSteps : derivedStudentCommittedSteps
    const sourceSteps = useAdminStepComposer
      ? (recognitionEngineRef.current === 'keyboard' ? keyboardSteps : adminSteps)
      : (useStudentStepComposer ? studentSourceSteps : [])
    if (!sourceSteps.length) return
    if (index < 0 || index >= sourceSteps.length) return

    const confirmed = typeof window === 'undefined'
      ? true
      : window.confirm(`Delete step ${index + 1}?`)
    if (!confirmed) return

    const deletingAdminEditTarget = useAdminStepComposer && recognitionEngineRef.current !== 'keyboard' && adminEditIndex === index
    const deletingKeyboardEditTarget = useAdminStepComposer && recognitionEngineRef.current === 'keyboard' && keyboardEditIndex === index
    const deletingStudentEditTarget = useStudentStepComposer && studentEditIndex === index
    const deletingKeyboardStudentEditTarget = useStudentStepComposer && recognitionEngineRef.current === 'keyboard' && studentEditIndex === index

    if (useAdminStepComposer && recognitionEngineRef.current === 'keyboard') {
      setKeyboardSteps(prev => prev.filter((_, stepIndex) => stepIndex !== index))
      setKeyboardEditIndex(prev => {
        if (prev === null) return null
        if (prev === index) return null
        return prev > index ? prev - 1 : prev
      })
      if (deletingKeyboardEditTarget) {
        setLatexOutput('')
        latexOutputRef.current = ''
        if (useAdminStepComposerRef.current && hasControllerRights()) {
          setAdminDraftLatex('')
        }
        setKeyboardSelectionState({ start: 0, end: 0 })
      }
    }

    if (useAdminStepComposer && recognitionEngineRef.current !== 'keyboard') {
      setAdminSteps(prev => prev.filter((_, stepIndex) => stepIndex !== index))
      setAdminEditIndex(prev => {
        if (prev === null) return null
        if (prev === index) return null
        return prev > index ? prev - 1 : prev
      })
      if (deletingAdminEditTarget) {
        setAdminDraftLatex('')
      }
    }

    if (useStudentStepComposer) {
      setStudentSteps(prev => prev.filter((_, stepIndex) => stepIndex !== index))
      setStudentEditIndex(prev => {
        if (prev === null) return null
        if (prev === index) return null
        return prev > index ? prev - 1 : prev
      })
      if (deletingKeyboardStudentEditTarget) {
        setLatexOutput('')
        latexOutputRef.current = ''
        setKeyboardSelectionState({ start: 0, end: 0 })
      }
    }

    setTopPanelSelectedStep(prev => {
      if (prev === null) return null
      if (prev === index) return null
      return prev > index ? prev - 1 : prev
    })

    if (deletingAdminEditTarget || deletingKeyboardEditTarget || deletingStudentEditTarget || deletingKeyboardStudentEditTarget) {
      setLatexOutput('')
      clearTopPanelSelection()
      if (recognitionEngineRef.current !== 'keyboard') {
        await clearTopPanelComposerCanvas()
      }
    }
  }, [adminEditIndex, adminSteps, clearTopPanelComposerCanvas, clearTopPanelSelection, derivedStudentCommittedSteps, hasControllerRights, keyboardEditIndex, keyboardSteps, setKeyboardSelectionState, studentEditIndex, studentSteps, useAdminStepComposer, useStudentStepComposer])

  const [lessonScriptResolved, setLessonScriptResolved] = useState<any | null>(null)
  const [lessonScriptLoading, setLessonScriptLoading] = useState(false)
  const [lessonScriptError, setLessonScriptError] = useState<string | null>(null)
  const [lessonScriptPhaseKey, setLessonScriptPhaseKey] = useState<LessonScriptPhaseKey>('engage')
  const [lessonScriptStepIndex, setLessonScriptStepIndex] = useState(-1)

  const [lessonScriptPointIndex, setLessonScriptPointIndex] = useState(0)
  const [lessonScriptModuleIndex, setLessonScriptModuleIndex] = useState(-1)
  const VIEW_ONLY_SPLIT_RATIO = 0.8
  const EDITABLE_SPLIT_RATIO = 0.2
  const KEYBOARD_STACKED_SPLIT_RATIO = 0.28
  const KEYBOARD_BOTTOM_CHROME_MIN_HEIGHT_PX = 48
  const KEYBOARD_FIXED_PANEL_MIN_HEIGHT_PX = 348
  const KEYBOARD_MATHLIVE_MIN_HEIGHT_PX = 56
  const KEYBOARD_BOTTOM_SAFE_AREA_RESERVE_PX = 44
  const [studentSplitRatio, setStudentSplitRatio] = useState(EDITABLE_SPLIT_RATIO) // portion for LaTeX panel when stacked
  const studentSplitRatioRef = useRef(EDITABLE_SPLIT_RATIO)

  const [latestSharedSave, setLatestSharedSave] = useState<NotesSaveRecord | null>(null)
  const [latestContinuitySave, setLatestContinuitySave] = useState<NotesSaveRecord | null>(null)
  const [latestPersonalSave, setLatestPersonalSave] = useState<NotesSaveRecord | null>(null)
  const latestSharedSaveRef = useRef<NotesSaveRecord | null>(null)
  const latestContinuitySaveRef = useRef<NotesSaveRecord | null>(null)
  useEffect(() => {
    latestSharedSaveRef.current = latestSharedSave
  }, [latestSharedSave])
  useEffect(() => {
    latestContinuitySaveRef.current = latestContinuitySave
  }, [latestContinuitySave])
  const [isSavingLatex, setIsSavingLatex] = useState(false)
  const [latexSaveError, setLatexSaveError] = useState<string | null>(null)

  const [activeNotebookSolutionId, setActiveNotebookSolutionId] = useState<string | null>(null)
  const [loadedNotebookRevision, setLoadedNotebookRevision] = useState<LoadedNotebookRevisionState | null>(null)
  const [finishQuestionModalOpen, setFinishQuestionModalOpen] = useState(false)
  const [finishQuestionTitle, setFinishQuestionTitle] = useState('')
  const [finishQuestionNoteId, setFinishQuestionNoteId] = useState<string | null>(null)

  const [notesLibraryOpen, setNotesLibraryOpen] = useState(false)
  const [notesLibraryLoading, setNotesLibraryLoading] = useState(false)
  const [notesLibraryError, setNotesLibraryError] = useState<string | null>(null)
  const [notesLibraryItems, setNotesLibraryItems] = useState<NotesSaveRecord[]>([])
  const [notesLibrarySelectedSolutionId, setNotesLibrarySelectedSolutionId] = useState<string | null>(null)
  const [notesLibraryCollapsedSolutionIds, setNotesLibraryCollapsedSolutionIds] = useState<string[]>([])
  const notesLibraryGroups = useMemo(() => {
    const toTimestamp = (value: unknown) => {
      if (typeof value !== 'string' || !value) return 0
      const parsed = Date.parse(value)
      return Number.isFinite(parsed) ? parsed : 0
    }

    const grouped = new Map<string, {
      solutionId: string
      title: string
      latestTs: number
      items: NotesSaveRecord[]
    }>()

    for (const item of notesLibraryItems) {
      const solutionId = extractNotebookSolutionId(item) || String(item.id || '') || `ungrouped:${grouped.size}`
      const title = String(item.title || '').trim() || 'Untitled'
      const itemTs = toTimestamp((item as any)?.updatedAt) || toTimestamp((item as any)?.createdAt)
      const existing = grouped.get(solutionId)
      if (!existing) {
        grouped.set(solutionId, {
          solutionId,
          title,
          latestTs: itemTs,
          items: [item],
        })
        continue
      }
      existing.items.push(item)
      if (itemTs >= existing.latestTs) {
        existing.latestTs = itemTs
        existing.title = title || existing.title
      }
    }

    return Array.from(grouped.values())
      .map(group => ({
        ...group,
        items: [...group.items].sort((left, right) => {
          const rightTs = toTimestamp((right as any)?.updatedAt) || toTimestamp((right as any)?.createdAt)
          const leftTs = toTimestamp((left as any)?.updatedAt) || toTimestamp((left as any)?.createdAt)
          return rightTs - leftTs
        }),
      }))
      .sort((left, right) => right.latestTs - left.latestTs)
  }, [notesLibraryItems])
  const selectedNotesLibraryGroup = useMemo(() => {
    if (!notesLibraryGroups.length) return null
    if (notesLibrarySelectedSolutionId) {
      const selected = notesLibraryGroups.find(group => group.solutionId === notesLibrarySelectedSolutionId)
      if (selected) return selected
    }
    if (activeNotebookSolutionId) {
      const active = notesLibraryGroups.find(group => group.solutionId === activeNotebookSolutionId)
      if (active) return active
    }
    return notesLibraryGroups[0] || null
  }, [activeNotebookSolutionId, notesLibraryGroups, notesLibrarySelectedSolutionId])

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
  const formatDebugTime = (ts: number | null) => (ts ? new Date(ts).toLocaleTimeString() : 'never')
  const mathpixResponseSize = mathpixRawResponse ? `${mathpixRawResponse.length} chars` : '—'

  const copyDebugPayload = useCallback(async (value: string | null, label: string) => {
    if (!value) return
    try {
      await navigator.clipboard?.writeText(value)
      return
    } catch (err) {
      console.warn('Failed to copy debug payload', err)
    }
    try {
      if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
        window.prompt(`Copy ${label} payload`, value)
      }
    } catch (err) {
      console.warn('Failed to open copy prompt', err)
    }
  }, [])

  const triggerMyScriptProbe = useCallback(() => {
    void probeMyScriptRecognitionStateRef.current()
  }, [])

  const renderDebugBlob = useCallback((label: string, value: string | null) => {
    if (!value) return 'none'
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
        <button
          type="button"
          onClick={() => { void copyDebugPayload(value, label) }}
          style={{
            alignSelf: 'flex-start',
            border: '1px solid rgba(255,255,255,0.18)',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.08)',
            color: '#fff',
            padding: '2px 8px',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          Copy
        </button>
        <pre style={{
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: 'rgba(15,23,42,0.52)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 10,
          padding: 10,
          maxHeight: 220,
          overflow: 'auto',
          fontSize: 11,
          lineHeight: 1.35,
        }}>{value}</pre>
      </div>
    )
  }, [copyDebugPayload])

  const debugSections: DebugSection[] = [
    {
      title: 'Realtime',
      fields: [
        { label: 'localVersion', value: localVersionRef.current },
        { label: 'appliedVersion', value: appliedVersionRef.current },
        { label: 'lastRemoteVersion', value: lastAppliedRemoteVersionRef.current },
        { label: 'symbolCount', value: lastSymbolCountRef.current },
        { label: 'suppressUntil', value: suppressBroadcastUntilTsRef.current },
        { label: 'appliedIds', value: appliedSnapshotIdsRef.current.size },
        { label: 'realtimeConnected', value: isRealtimeConnected ? 'yes' : 'no' },
        { label: 'queueLen', value: pendingPublishQueueRef.current.length },
        { label: 'reconnectAttempts', value: reconnectAttemptsRef.current },
      ],
    },
    {
      title: 'Recognition',
      fields: [
        { label: 'activeEngine', value: recognitionEngine },
        { label: 'engineReady', value: status },
      ],
    },
    {
      title: 'MyScript',
      fields: [
        { label: 'scriptLoaded', value: myscriptScriptLoaded ? 'yes' : 'no' },
        { label: 'editorInstance', value: editorInstanceRef.current ? 'yes' : 'no' },
        { label: 'editorReady', value: myscriptEditorReady ? 'yes' : 'no' },
        { label: 'replayedInput', value: `down ${myscriptReplayCounts.down}, move ${myscriptReplayCounts.move}, up ${myscriptReplayCounts.up}` },
        { label: 'lastReplay', value: formatDebugTime(myscriptLastReplayAt) },
        { label: 'replayDownPayload', value: renderDebugBlob('MyScript replay down', myscriptLastReplayDownPayload) },
        { label: 'replayMovePayload', value: renderDebugBlob('MyScript replay move', myscriptLastReplayMovePayload) },
        { label: 'replayUpPayload', value: renderDebugBlob('MyScript replay up', myscriptLastReplayUpPayload) },
        { label: 'changedEvents', value: `${myscriptChangedCount} @ ${formatDebugTime(myscriptLastChangedAt)}` },
        { label: 'exportedEvents', value: `${myscriptExportedCount} @ ${formatDebugTime(myscriptLastExportedAt)}` },
        {
          label: 'probe',
          value: (
            <button
              type="button"
              onClick={triggerMyScriptProbe}
              style={{
                border: '1px solid rgba(255,255,255,0.18)',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.08)',
                color: '#fff',
                padding: '4px 10px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Probe now
            </button>
          ),
        },
        { label: 'lastProbe', value: formatDebugTime(myscriptLastProbeAt) },
        { label: 'lastError', value: myscriptLastError || 'none' },
        { label: 'lastExtraction', value: formatDebugTime(myscriptLastSymbolExtract) },
        { label: 'lastLatex', value: myscriptLastExportedLatex || 'none' },
        { label: 'latexOutput', value: latexOutput || 'none' },
        { label: 'topPanelSource', value: debugTopPanelSource || 'none' },
        { label: 'topPanelMarkup', value: debugTopPanelHasMarkup ? 'yes' : 'no' },
        { label: 'modelSummary', value: renderDebugBlob('MyScript model summary', myscriptModelSummary) },
        { label: 'lastChangedDetail', value: renderDebugBlob('MyScript changed detail', myscriptLastChangedPayload) },
        { label: 'sentSymbols', value: renderDebugBlob('MyScript symbols', myscriptLastSymbolsPayload) },
        { label: 'returnedExports', value: renderDebugBlob('MyScript exports', myscriptLastExportPayload) },
      ],
    },
    {
      title: 'Mathpix',
      fields: [
        { label: 'status', value: mathpixStatus },
        { label: 'lastRequest', value: formatDebugTime(mathpixLastRequestAt) },
        { label: 'lastResponse', value: formatDebugTime(mathpixLastResponseAt) },
        { label: 'httpStatus', value: mathpixLastStatusCode ?? '—' },
        { label: 'lastStrokes', value: mathpixLastStrokeCount ?? '—' },
        { label: 'lastPoints', value: mathpixLastPointCount ?? '—' },
        { label: 'lastEventCount', value: mathpixLastEventCount ?? '—' },
        { label: 'localStrokes', value: mathpixLocalStrokeCount ?? '—' },
        { label: 'localPoints', value: mathpixLocalPointCount ?? '—' },
        { label: 'lastError', value: mathpixError || 'none' },
        { label: 'lastResponseSize', value: mathpixResponseSize },
        { label: 'sentPayload', value: renderDebugBlob('Mathpix sent payload', mathpixLastProxyPayload) },
        { label: 'returnedPayload', value: renderDebugBlob('Mathpix returned payload', mathpixRawResponse) },
      ],
    },
  ]

  const cacheModeSnapshotForPage = useCallback((page: number, snapshot: SnapshotPayload | null) => {
    while (pageRecordsRef.current.length <= page) {
      pageRecordsRef.current.push({ snapshot: null })
    }
    while (mathModePageSnapshotsRef.current.length <= page) {
      mathModePageSnapshotsRef.current.push(null)
    }
    while (rawInkModePageSnapshotsRef.current.length <= page) {
      rawInkModePageSnapshotsRef.current.push(null)
    }

    const cloned = cloneSnapshotPayload(snapshot)
    pageRecordsRef.current[page] = { snapshot: cloned }
    if (!cloned) return

    if (getSnapshotMode(cloned) === 'raw-ink') {
      rawInkModePageSnapshotsRef.current[page] = cloned
    } else {
      mathModePageSnapshotsRef.current[page] = cloned
    }
  }, [])

  const getCachedModeSnapshotForPage = useCallback((page: number, mode: CanvasMode) => {
    const store = mode === 'raw-ink' ? rawInkModePageSnapshotsRef.current : mathModePageSnapshotsRef.current
    while (store.length <= page) {
      store.push(null)
    }
    return cloneSnapshotPayload(store[page])
  }, [])

  const replaceRawInkState = useCallback((strokes: RawInkStroke[], options?: { clearRedo?: boolean }) => {
    rawInkActiveStrokesRef.current.clear()
    rawInkTouchPointerIdsRef.current.clear()
    rawInkEraserPointerIdsRef.current.clear()
    setRawInkActivePreview([])
    setRawInkStrokes(cloneRawInkStrokes(strokes))
    if (options?.clearRedo !== false) {
      rawInkRedoStackRef.current = []
    }
  }, [])

  const getRawInkSnapshotStrokes = useCallback((includeActive = true) => {
    const committed = cloneRawInkStrokes(rawInkStrokesRef.current)
    if (!includeActive) return committed
    const active = Array.from(rawInkActiveStrokesRef.current.values())
      .map((stroke) => ({ ...stroke, points: cloneRawInkStrokes([stroke])[0]?.points || [] }))
      .filter((stroke) => stroke.points.length > 0)
    return [...committed, ...active]
  }, [])

  const buildRawInkSnapshot = useCallback((incrementVersion: boolean, includeActive = true): SnapshotPayload => {
    const strokes = getRawInkSnapshotStrokes(includeActive)
    const version = incrementVersion ? ++localVersionRef.current : localVersionRef.current
    return makeRawInkSnapshot(
      strokes,
      version,
      `${clientIdRef.current}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    )
  }, [getRawInkSnapshotStrokes])
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
  const lockedOutRef = useRef(!canOrchestrateLesson && !forceEditableForAssignment)
  const hasExclusiveControlRef = useRef(false)
  const lastControlBroadcastTsRef = useRef(0)
  const lastLatexBroadcastTsRef = useRef(0)
  const latexDisplayStateRef = useRef<LatexDisplayState>({ enabled: false, latex: '', options: DEFAULT_LATEX_OPTIONS })
  const suppressStackedNotesPreviewUntilTsRef = useRef(0)
  const latexProjectionOptionsRef = useRef<LatexDisplayOptions>(DEFAULT_LATEX_OPTIONS)
  const studentStackRef = useRef<HTMLDivElement | null>(null)
  const studentViewportRef = useRef<HTMLDivElement | null>(null)
  const stackedZoomContentRef = useRef<HTMLDivElement | null>(null)
  const multiTouchPanRef = useRef<{
    pointers: Map<number, { x: number; y: number }>
    active: boolean
    lastMid: { x: number; y: number } | null
    suppressedPointers: Set<number>
    pendingTouch: null | {
      pointerId: number
      timer: ReturnType<typeof setTimeout> | null
      downEvent: PointerEvent
      moveQueue: PointerEvent[]
    }
  }>({
    pointers: new Map(),
    active: false,
    lastMid: null,
    suppressedPointers: new Set(),
    pendingTouch: null,
  })
  const resolvedTouchInkPointerIdsRef = useRef<Set<number>>(new Set())
  const resolvedTouchKeepaliveAtRef = useRef(0)
  // Debug-only: used to schedule a single undo after a pan ends.
  const debugPanUndoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const splitHandleRef = useRef<HTMLDivElement | null>(null)
  const splitDragActiveRef = useRef(false)
  const splitDragStartYRef = useRef(0)
  const splitStartRatioRef = useRef(0.2)
  const splitDragPointerIdRef = useRef<number | null>(null)
  const splitWindowCleanupRef = useRef<null | (() => void)>(null)

  const editorResizeRafRef = useRef<number | null>(null)
  const editorResizeRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestEditorResize = useCallback(() => {
    if (typeof window === 'undefined') return
    if (editorResizeRafRef.current) return
    editorResizeRafRef.current = window.requestAnimationFrame(() => {
      editorResizeRafRef.current = null
      const host = editorHostRef.current
      if (!host || !host.isConnected) return
      if (host.clientWidth < 1 || host.clientHeight < 1) return
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
    requestEditorResize()
  }, [canvasOrientation, isFullscreen, requestEditorResize])

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
      if (editorResizeRetryTimeoutRef.current) {
        clearTimeout(editorResizeRetryTimeoutRef.current)
        editorResizeRetryTimeoutRef.current = null
      }
      if (editorResizeRafRef.current && typeof window !== 'undefined') {
        try {
          window.cancelAnimationFrame(editorResizeRafRef.current)
        } catch {}
        editorResizeRafRef.current = null
      }
    }
  }, [editorReinitNonce, requestEditorResize])

  const clampStudentSplitRatio = useCallback((nextRatio: number, containerHeight?: number) => {
    if (recognitionEngine !== 'keyboard') {
      return Math.min(Math.max(nextRatio, 0.2), 0.8)
    }

    const resolvedHeight = Math.max(
      containerHeight ?? studentStackRef.current?.getBoundingClientRect().height ?? 0,
      1,
    )
    const minRatio = Math.min(Math.max(120 / resolvedHeight, 0.16), 0.4)
    const maxRatio = Math.max(
      minRatio,
      Math.min(0.72, 1 - ((KEYBOARD_BOTTOM_CHROME_MIN_HEIGHT_PX + KEYBOARD_FIXED_PANEL_MIN_HEIGHT_PX + KEYBOARD_MATHLIVE_MIN_HEIGHT_PX + KEYBOARD_BOTTOM_SAFE_AREA_RESERVE_PX) / resolvedHeight)),
    )

    return Math.min(Math.max(nextRatio, minRatio), maxRatio)
  }, [KEYBOARD_BOTTOM_CHROME_MIN_HEIGHT_PX, KEYBOARD_BOTTOM_SAFE_AREA_RESERVE_PX, KEYBOARD_FIXED_PANEL_MIN_HEIGHT_PX, KEYBOARD_MATHLIVE_MIN_HEIGHT_PX, recognitionEngine])

  const updateSplitRatioFromClientY = useCallback((clientY: number) => {
    if (!splitDragActiveRef.current) return
    const stackEl = studentStackRef.current
    if (!stackEl) return
    const rect = stackEl.getBoundingClientRect()
    const delta = clientY - splitDragStartYRef.current
    const nextRatio = splitStartRatioRef.current + delta / Math.max(rect.height, 1)
    const clamped = clampStudentSplitRatio(nextRatio, rect.height)
    setStudentSplitRatio(clamped)
    studentSplitRatioRef.current = clamped
    requestEditorResize()
  }, [clampStudentSplitRatio, requestEditorResize])

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

  // Permission checks rely on `clientIdRef.current`. If controller/presenter rights arrive before
  // the Ably clientId is populated (or if it changes on reconnect), the UI can get stuck in
  // view-only mode. Recompute lock state whenever `clientId` changes.
  useEffect(() => {
    updateControlState(controlStateRef.current)
  }, [clientId, updateControlState])

  const setPresenterForClients = useCallback(async (targetClientIds: string[], allowed: boolean, opts?: { userKey?: string; name?: string }) => {
    if (!canOrchestrateLesson) return
    const targets = Array.from(new Set(targetClientIds.filter(id => id && id !== 'all' && id !== ALL_STUDENTS_ID)))
    const userKey = typeof opts?.userKey === 'string' ? opts?.userKey : ''
    if (!targets.length && !userKey) return

    const channel = channelRef.current
    if (!channel) return
    const ts = Date.now()
    try {
      if (allowed) {
        const presenterKey = userKey || null
        if (!presenterKey) return
        setActivePresenterUserKey(presenterKey)
        activePresenterUserKeyRef.current = presenterKey ? String(presenterKey) : ''
        activePresenterClientIdsRef.current = new Set(targets)
        bumpPresenterStateVersion()

        // Recompute permissions now that presenter changed.
        updateControlState(controlStateRef.current)

        // Admin relinquishes snapshot publishing immediately.
        pendingPublishQueueRef.current = []
        if (pendingBroadcastRef.current) {
          clearTimeout(pendingBroadcastRef.current)
          pendingBroadcastRef.current = null
        }
        await channel.publish('control', {
          clientId: clientIdRef.current,
          author: userDisplayName,
          action: 'presenter-set',
          presenterUserKey: presenterKey,
          targetClientIds: targets,
          targetClientId: targets[0],
          ts,
        } satisfies PresenterSetMessage)
      } else {
        // If we're revoking the active presenter, clear it.
        const activeKey = activePresenterUserKeyRef.current
        if (userKey && activeKey && userKey === activeKey) {
          setActivePresenterUserKey(null)
          activePresenterUserKeyRef.current = ''
          activePresenterClientIdsRef.current = new Set()
          bumpPresenterStateVersion()
          updateControlState(controlStateRef.current)
          await channel.publish('control', {
            clientId: clientIdRef.current,
            author: userDisplayName,
            action: 'presenter-set',
            presenterUserKey: null,
            targetClientIds: [],
            ts,
          } satisfies PresenterSetMessage)
        }
      }
    } catch (err) {
      console.warn('Failed to update presenter handoff', err)
    }
  }, [bumpPresenterStateVersion, canOrchestrateLesson, updateControlState, userDisplayName])

  const reclaimAdminControl = useCallback(async () => {
    if (!canOrchestrateLesson) return false

    const teacherClientId = clientIdRef.current
    const teacherPresenterKey = (selfUserKey || '').trim() || (teacherClientId ? `client:${teacherClientId}` : null)
    bumpPresenterStateVersion()

    // Reclaim means the teacher becomes the exclusive snapshot publisher.
    // This guarantees we never end up with two concurrent publishers even if a client misses revoke messages.
    setActivePresenterUserKey(teacherPresenterKey)
    activePresenterUserKeyRef.current = teacherPresenterKey ? String(teacherPresenterKey) : ''
    activePresenterClientIdsRef.current = teacherClientId ? new Set([teacherClientId]) : new Set()

    // Recompute local permission refs immediately.
    updateControlState(controlStateRef.current)

    const channel = channelRef.current
    if (!channel) return false
    const ts = Date.now()

    try {
      // Defensive ordering for reclaim:
      // 1) Drop any existing presenter globally.
      // 2) Re-assert teacher as exclusive presenter.
      await channel.publish('control', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        action: 'presenter-set',
        presenterUserKey: null,
        targetClientIds: [],
        ts,
      } satisfies PresenterSetMessage)

      // Re-assert teacher as the exclusive presenter globally.
      await channel.publish('control', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        action: 'presenter-set',
        presenterUserKey: teacherPresenterKey,
        targetClientIds: teacherClientId ? [teacherClientId] : [],
        ts: ts + 1,
      } satisfies PresenterSetMessage)

      return true
    } catch (err) {
      console.warn('Failed to reclaim admin control', err)
      return false
    }
  }, [bumpPresenterStateVersion, canOrchestrateLesson, selfUserKey, updateControlState, userDisplayName])

  const setPresenterForClient = useCallback(async (targetClientId: string, allowed: boolean) => {
    const resolved = connectedClientsRef.current.find(c => c.clientId === targetClientId)
    const resolvedUserId = typeof (resolved as any)?.userId === 'string' ? String((resolved as any)?.userId) : undefined
    const resolvedName = normalizeName((resolved as any)?.name || '') || String(targetClientId)
    const userKey = getUserKey(resolvedUserId, resolvedName) || (resolvedName ? `name:${normalizeName(resolvedName).toLowerCase()}` : '')

    const resolvedSelection = resolveHandoffSelection({
      clickedClientId: targetClientId,
      clickedUserId: resolvedUserId,
      clickedUserKey: userKey,
      clickedDisplayName: resolvedName,
      connectedClients: connectedClientsRef.current,
      excludedClientIds: ['all', ALL_STUDENTS_ID],
    })

    await setPresenterForClients(
      resolvedSelection.nextClientIds.length ? resolvedSelection.nextClientIds : [targetClientId],
      allowed,
      {
        userKey,
        name: resolvedSelection.resolvedDisplayName || resolvedName,
      }
    )
  }, [setPresenterForClients])

  const autoSaveCurrentQuestionAsNotesRef = useRef<null | ((options?: { requireEmptyBottom?: boolean }) => Promise<NotesSaveRecord | null>)>(null)
  const pendingPresenterContinuitySaveRef = useRef<NotesSaveRecord | null>(null)
  const continuityPullInFlightRef = useRef(false)
  const continuityFallbackTimerRef = useRef<number | null>(null)

  const handOverPresentation = useCallback(
    (target: PresenterHandoffTarget) => {
      if (!canOrchestrateLesson) return

      void (async () => {
        if (handoffInFlightRef.current) {
          pendingHandoffTargetRef.current = target
          return
        }
        handoffInFlightRef.current = true
        setHandoffSwitching(true)
        setHandoffMessage(null)

        let continuitySave: NotesSaveRecord | null = null

        // Best-effort: silently capture the current question into Notes before switching presenter context.
        // For admin reclaim, bypass the "bottom canvas empty" gating since the teacher may be viewing the
        // student's board state (which would otherwise block the auto-save).
        try {
          continuitySave = await autoSaveCurrentQuestionAsNotesRef.current?.({ requireEmptyBottom: Boolean(target) }) ?? null
        } catch {}

        // Bidirectional: null target means the admin reclaims control.
        if (!target) {
          try {
            const continuityRecord = continuitySave || latestContinuitySaveRef.current
            const channel = channelRef.current
            const myClientId = clientIdRef.current
            if (continuityRecord && channel && myClientId) {
              const now = Date.now()
              await channel.publish('control', {
                clientId: myClientId,
                author: userDisplayName,
                action: 'presenter-continuity-load',
                targetClientIds: [myClientId],
                targetClientId: myClientId,
                continuitySaveId: continuityRecord.id,
                continuitySessionKey: boardId || null,
                ts: now,
              })
            }
            const ok = await reclaimAdminControl()
            if (!ok) showHandoffFailure('Switch failed. Please try again.')
          } finally {
            setHandoffSwitching(false)
            handoffInFlightRef.current = false
          }
          return
        }

        const clickedClientId = String(target.clientId || '').trim()
        const clickedUserId = String(target.userId || '').trim()
        const clickedUserKey = String(target.userKey || '').trim()
        const displayName = String(target.displayName || '').trim()

        if (!clickedClientId && !clickedUserKey) {
          showHandoffFailure('Switch failed. Please select a valid user.')
          setHandoffSwitching(false)
          handoffInFlightRef.current = false
          return
        }

        const resolvedSelection = resolveHandoffSelection({
          clickedClientId,
          clickedUserId,
          clickedUserKey,
          clickedDisplayName: displayName,
          connectedClients,
          excludedClientIds: ['all', ALL_STUDENTS_ID],
        })

        const nextClientIds = resolvedSelection.nextClientIds
        if (!nextClientIds.length) {
          showHandoffFailure('Switch failed. User is not connected.')
          setHandoffSwitching(false)
          handoffInFlightRef.current = false
          return
        }

        const resolvedPresenterKey = resolvedSelection.resolvedPresenterKey
        if (!resolvedPresenterKey) {
          showHandoffFailure('Switch failed. Could not resolve user identity.')
          setHandoffSwitching(false)
          handoffInFlightRef.current = false
          return
        }

        const previousPresenterKey = activePresenterUserKeyRef.current || null
        const previousPresenterClientIds = new Set(activePresenterClientIdsRef.current)

        const nextPresenterKey = resolvedPresenterKey
        setActivePresenterUserKey(nextPresenterKey)
        activePresenterUserKeyRef.current = nextPresenterKey ? String(nextPresenterKey) : ''
        activePresenterClientIdsRef.current = new Set(nextClientIds)
        bumpPresenterStateVersion()
        updateControlState(controlStateRef.current)

        pendingPublishQueueRef.current = []
        if (pendingBroadcastRef.current) {
          clearTimeout(pendingBroadcastRef.current)
          pendingBroadcastRef.current = null
        }

        const channel = await waitForResolvedValue(() => channelRef.current, { timeoutMs: 1000, intervalMs: 50 })
        if (!channel) {
          setActivePresenterUserKey(previousPresenterKey)
          activePresenterUserKeyRef.current = previousPresenterKey ? String(previousPresenterKey) : ''
          activePresenterClientIdsRef.current = previousPresenterClientIds
          bumpPresenterStateVersion()
          updateControlState(controlStateRef.current)
          showHandoffFailure('Switch failed. Realtime channel unavailable.')
          setHandoffSwitching(false)
          handoffInFlightRef.current = false
          return
        }

        const ts = Date.now()
        try {
          const continuityRecord = continuitySave || latestContinuitySaveRef.current
          if (continuityRecord) {
            await channel.publish('control', {
              clientId: clientIdRef.current,
              author: userDisplayName,
              action: 'presenter-continuity-load',
              targetClientIds: nextClientIds,
              targetClientId: nextClientIds[0],
              continuitySaveId: continuityRecord.id,
              continuitySessionKey: boardId || null,
              ts,
            })
          }

          await channel.publish('control', {
            clientId: clientIdRef.current,
            author: userDisplayName,
            action: 'presenter-set',
            presenterUserKey: nextPresenterKey,
            targetClientIds: nextClientIds,
            targetClientId: nextClientIds[0],
            ts: ts + 1,
          } satisfies PresenterSetMessage)
        } catch (err) {
          setActivePresenterUserKey(previousPresenterKey)
          activePresenterUserKeyRef.current = previousPresenterKey ? String(previousPresenterKey) : ''
          activePresenterClientIdsRef.current = previousPresenterClientIds
          bumpPresenterStateVersion()
          updateControlState(controlStateRef.current)
          showHandoffFailure('Switch failed. Please try again.')
          console.warn('Failed to hand over presentation', err)
        } finally {
          setHandoffSwitching(false)
          handoffInFlightRef.current = false
          const pending = pendingHandoffTargetRef.current
          pendingHandoffTargetRef.current = null
          if (pending) {
            handOverPresentation(pending)
          }
        }
      })()
    },
    [boardId, bumpPresenterStateVersion, connectedClients, canOrchestrateLesson, reclaimAdminControl, showHandoffFailure, updateControlState, userDisplayName]
  )

  const handleRosterAttendeeAvatarClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault()
      e.stopPropagation()
      if (!canOrchestrateLesson) return

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
    [handOverPresentation, canOrchestrateLesson]
  )

  const broadcastHighlightedController = useCallback(async (payload: { clientId: string; userId?: string; name?: string } | null) => {
    if (!canOrchestrateLesson) return
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
  }, [canOrchestrateLesson, userDisplayName])

  const enforceCanonicalPresenter = useCallback(async (userKey: string, reason: string) => {
    if (!canOrchestrateLesson) return
    if (handoffInFlightRef.current || conflictResolverInFlightRef.current) return

    const now = Date.now()
    const signature = `${userKey}::${reason}`
    if (signature === lastConflictEnforceSignatureRef.current && now - lastConflictEnforceTsRef.current < 1500) {
      return
    }
    lastConflictEnforceSignatureRef.current = signature
    lastConflictEnforceTsRef.current = now

    conflictResolverInFlightRef.current = true
    try {
      if (selfUserKey && userKey === selfUserKey) {
        await reclaimAdminControl()
        return
      }

      const identity = resolveIdentityForUserKey(userKey)
      const targetClientIds = Array.from(new Set((identity?.clientIds || []).filter(id => id && id !== 'all' && id !== ALL_STUDENTS_ID)))
      if (!targetClientIds.length) return

      setActivePresenterUserKey(userKey)
      activePresenterUserKeyRef.current = userKey
      activePresenterClientIdsRef.current = new Set(targetClientIds)
      bumpPresenterStateVersion()
      updateControlState(controlStateRef.current)

      const channel = channelRef.current
      if (!channel) return
      await channel.publish('control', {
        clientId: clientIdRef.current,
        author: userDisplayName,
        action: 'presenter-set',
        presenterUserKey: userKey,
        targetClientIds,
        targetClientId: targetClientIds[0],
        ts: now,
      } satisfies PresenterSetMessage)
    } catch (err) {
      console.warn('Failed to enforce canonical presenter', err)
    } finally {
      conflictResolverInFlightRef.current = false
    }
  }, [bumpPresenterStateVersion, canOrchestrateLesson, reclaimAdminControl, resolveIdentityForUserKey, selfUserKey, updateControlState, userDisplayName])

  const evaluateSwitchingAuthority = useCallback(() => {
    if (!canOrchestrateLesson || forceEditableForAssignment || (isSessionQuizMode && quizActiveRef.current)) {
      conflictStartedAtRef.current = null
      lastConflictReasonRef.current = ''
      setSwitchConflictActiveStable(false)
      setEditingAuthorityKeysStable([])
      if (!handoffInFlightRef.current) {
        setHandoffSwitching(false)
      }
      return
    }

    const FAILURE_TIMEOUT_MS = 60000
    const now = Date.now()

    const evaluation = evaluateSwitchingAuthorities({
      connectedClients: connectedClientsRef.current,
      excludedClientIds: ['all', ALL_STUDENTS_ID],
      activePresenterUserKey: activePresenterUserKeyRef.current,
      activePresenterClientIds: activePresenterClientIdsRef.current,
      lastPresenterSetTs: lastPresenterSetTsRef.current,
      nowTs: now,
    })

    const activeCandidates = evaluation.activeCandidates as EditingAuthorityCandidate[]
    const activeUserKeys = evaluation.activeUserKeys
    setEditingAuthorityKeysStable(activeUserKeys)

    if (activeCandidates.length <= 1) {
      conflictStartedAtRef.current = null
      lastConflictReasonRef.current = ''
      setSwitchConflictActiveStable(false)
      if (!handoffInFlightRef.current) {
        setHandoffSwitching(false)
      }
      const only = activeCandidates[0]
      if (only) {
        const highlightedClientId = Array.from(only.clientIds)[0] || ''
        const resolvedIdentity = resolveIdentityForUserKey(only.userKey)
        const prev = highlightedControllerRef.current
        const changed = !prev || prev.clientId !== highlightedClientId || prev.userId !== resolvedIdentity?.userId || prev.name !== only.name
        if (changed) {
          setHighlightedController({
            clientId: highlightedClientId,
            userId: resolvedIdentity?.userId,
            name: only.name,
            ts: now,
          })
        }
        if (changed && highlightedClientId) {
          void broadcastHighlightedController({
            clientId: highlightedClientId,
            userId: resolvedIdentity?.userId,
            name: only.name,
          })
        }
      }
      return
    }

    setSwitchConflictActiveStable(true)
    setHandoffSwitching(true)

    const canonical: EditingAuthorityCandidate | null = evaluation.canonicalCandidate as EditingAuthorityCandidate | null
    const unresolvedReason = evaluation.unresolvedReason

    if (canonical) {
      conflictStartedAtRef.current = null
      lastConflictReasonRef.current = ''
      const canonicalClientId = Array.from(canonical.clientIds)[0] || ''
      const resolvedIdentity = resolveIdentityForUserKey(canonical.userKey)
      const prev = highlightedControllerRef.current
      const changed = !prev || prev.clientId !== canonicalClientId || prev.userId !== resolvedIdentity?.userId || prev.name !== canonical.name
      if (changed) {
        setHighlightedController({
          clientId: canonicalClientId,
          userId: resolvedIdentity?.userId,
          name: canonical.name,
          ts: now,
        })
      }
      if (changed && canonicalClientId) {
        void broadcastHighlightedController({
          clientId: canonicalClientId,
          userId: resolvedIdentity?.userId,
          name: canonical.name,
        })
      }
      void enforceCanonicalPresenter(canonical.userKey, 'timestamp-winner')
      return
    }

    if (!conflictStartedAtRef.current) {
      conflictStartedAtRef.current = now
    }
    lastConflictReasonRef.current = unresolvedReason
    if (now - conflictStartedAtRef.current < FAILURE_TIMEOUT_MS) {
      return
    }
    if (conflictResolverInFlightRef.current) {
      return
    }

    conflictResolverInFlightRef.current = true
    void (async () => {
      try {
        const fallbackReason = lastConflictReasonRef.current || 'Unknown conflict state'
        const ok = await reclaimAdminControl()
        if (ok) {
          showHandoffFailure(`Failed to switch: ${fallbackReason} Returned editing to admin.`)
        } else {
          showHandoffFailure(`Failed to switch: ${fallbackReason} Could not force admin reclaim.`)
        }
      } finally {
        conflictStartedAtRef.current = null
        setSwitchConflictActiveStable(false)
        setHandoffSwitching(false)
        conflictResolverInFlightRef.current = false
      }
    })()
  }, [
    broadcastHighlightedController,
    enforceCanonicalPresenter,
    forceEditableForAssignment,
    canOrchestrateLesson,
    isSessionQuizMode,
    reclaimAdminControl,
    resolveIdentityForUserKey,
    setEditingAuthorityKeysStable,
    setSwitchConflictActiveStable,
    showHandoffFailure,
  ])

  useEffect(() => {
    if (!canOrchestrateLesson) {
      setEditingAuthorityKeysStable([])
      setSwitchConflictActiveStable(false)
      return
    }
    evaluateSwitchingAuthority()
    if (typeof window === 'undefined') return
    const timer = window.setInterval(() => {
      evaluateSwitchingAuthority()
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [evaluateSwitchingAuthority, canOrchestrateLesson, setEditingAuthorityKeysStable, setSwitchConflictActiveStable])

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

  const runCanvasAction = useCallback(async (action: () => void | Promise<void>) => {
    try {
      if (typeof action === 'function') {
        await action()
      }
    } catch (error) {
      if (!isNonFatalIinkActionError(error)) {
        throw error
      }
      recordIgnoredIinkActionError(error)
    } finally {
      if (isOverlayMode) {
        clearOverlayAutoHide()
        setOverlayControlsVisible(false)
      }
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
    if (!canOrchestrateLesson) return
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
  }, [boardId, canOrchestrateLesson])

  useEffect(() => {
    if (!canOrchestrateLesson) return
    if (!boardId) return
    void loadLessonScript()
  }, [boardId, canOrchestrateLesson, loadLessonScript])

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
    if (!canOrchestrateLesson) return
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
  }, [channelName, canOrchestrateLesson])

  const setDiagramOverlayState = useCallback(
    async (next: DiagramState) => {
      setDiagramState(next)
      if (canOrchestrateLesson) {
        await persistDiagramState(next)
        await publishDiagramMessage({ kind: 'state', activeDiagramId: next.activeDiagramId, isOpen: next.isOpen })
      }
    },
    [canOrchestrateLesson, persistDiagramState, publishDiagramMessage]
  )

  const persistDiagramAnnotations = useCallback(async (diagramId: string, annotations: DiagramAnnotations | null) => {
    if (!canOrchestrateLesson) return
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
  }, [canOrchestrateLesson])

  const commitDiagramAnnotations = useCallback(async (diagramId: string, next: DiagramAnnotations | null, pushUndoFrom?: DiagramAnnotations | null) => {
    if (!canOrchestrateLesson) return

    if (pushUndoFrom) {
      diagramUndoRef.current.push(cloneDiagramAnnotations(pushUndoFrom))
      diagramRedoRef.current = []
      syncDiagramHistoryFlags()
    }

    applyDiagramAnnotations(diagramId, next)
    await persistDiagramAnnotations(diagramId, next)
    await publishDiagramMessage({ kind: 'annotations-set', diagramId, annotations: next })
  }, [applyDiagramAnnotations, cloneDiagramAnnotations, canOrchestrateLesson, persistDiagramAnnotations, publishDiagramMessage, syncDiagramHistoryFlags])

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

  const extractEditorSymbols = useCallback(() => {
    const editor = editorInstanceRef.current
    if (!editor) return null
    const model = editor.model ?? {}
    try {
      const raw = (model as any).symbols
      const src = Array.isArray(raw) ? raw : (Array.isArray(raw?.events) ? raw.events : null)
      if (src) return JSON.parse(JSON.stringify(src))
    } catch (err) {
      console.warn('Unable to serialize MyScript symbols', err)
    }
    return null
  }, [])

  const collectEditorSnapshot = useCallback((incrementVersion: boolean): SnapshotPayload | null => {
    if (canvasModeRef.current === 'raw-ink') {
      return buildRawInkSnapshot(incrementVersion)
    }

    const editor = editorInstanceRef.current
    if (!editor) return null

    const model = editor.model ?? {}
    const symbols = extractEditorSymbols()
    const exports = model.exports ?? {}
    const latexExport = exports['application/x-latex']
    const jiixRaw = exports['application/vnd.myscript.jiix']
    const fallbackLatex = typeof latexExport === 'string' ? latexExport : ''
    const engineLatex = recognitionEngineRef.current !== 'myscript'
      ? (latexOutputRef.current || '')
      : fallbackLatex

    const snapshot: SnapshotPayload = {
      mode: 'math',
      symbols,
      rawInk: null,
      latex: engineLatex || fallbackLatex || '',
      jiix: typeof jiixRaw === 'string' ? jiixRaw : jiixRaw ? JSON.stringify(jiixRaw) : null,
      version: incrementVersion ? ++localVersionRef.current : localVersionRef.current,
      snapshotId: `${clientIdRef.current}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    }

    return snapshot
  }, [buildRawInkSnapshot, extractEditorSymbols])

  const captureFullSnapshot = useCallback((): SnapshotPayload | null => {
    const snapshot = collectEditorSnapshot(false)
    if (!snapshot) return null
    return { ...snapshot, baseSymbolCount: -1 }
  }, [collectEditorSnapshot])

  const captureSettledCommitSnapshot = useCallback(async (expectedLatex?: string): Promise<SnapshotPayload | null> => {
    const editor = editorInstanceRef.current
    const normalizeForCommitSnapshot = (value: string) => String(value || '')
      .trim()
      .replace(/^\s*\\begin\{aligned\}/, '')
      .replace(/\\end\{aligned\}\s*$/, '')
      .trim()
    const normalizedExpected = normalizeForCommitSnapshot(expectedLatex || '')
    let bestSnapshot: SnapshotPayload | null = null

    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (editor && typeof editor.waitForIdle === 'function') {
        try {
          await editor.waitForIdle()
        } catch {}
      }

      if (editor && typeof editor.export_ === 'function') {
        try {
          await editor.export_(['application/x-latex', 'application/vnd.myscript.jiix'])
        } catch {}
      }

      await nextAnimationFrame()

      const currentSnapshot = captureFullSnapshot()
      const latestSnapshot = cloneSnapshotPayload(latestSnapshotRef.current?.snapshot ?? null)
      const candidates = [currentSnapshot, latestSnapshot].filter((candidate): candidate is SnapshotPayload => Boolean(candidate))

      for (const candidate of candidates) {
        const normalizedCandidate = normalizeForCommitSnapshot(candidate.latex || '')
        const symbolCount = countSymbols(candidate.symbols)

        if (!bestSnapshot || symbolCount > countSymbols(bestSnapshot.symbols)) {
          bestSnapshot = candidate
        }

        if (!normalizedExpected) {
          if (symbolCount > 0) return candidate
          continue
        }

        if (normalizedCandidate === normalizedExpected) {
          if (!bestSnapshot || symbolCount >= countSymbols(bestSnapshot.symbols)) {
            bestSnapshot = candidate
          }
          if (symbolCount > 0) {
            return candidate
          }
        }
      }

      if (attempt < 3) {
        await new Promise<void>(resolve => setTimeout(resolve, 80))
      }
    }

    return bestSnapshot ?? captureFullSnapshot()
  }, [captureFullSnapshot])

  const applyPageSnapshot = useCallback(
    async (snapshot: SnapshotPayload | null) => {
      const mode = getSnapshotMode(snapshot)
      setCanvasMode(mode)
      cacheModeSnapshotForPage(pageIndexRef.current, snapshot)

      if (mode === 'raw-ink') {
        replaceRawInkState(snapshot?.rawInk?.strokes || [], { clearRedo: true })
        setLatexOutput('')
        lastSymbolCountRef.current = countRawInkStrokes(snapshot)
        lastBroadcastBaseCountRef.current = lastSymbolCountRef.current
        return
      }

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
    [cacheModeSnapshotForPage, replaceRawInkState]
  )

  const persistCurrentPageSnapshot = useCallback(() => {
    const currentSnapshot = captureFullSnapshot()
    cacheModeSnapshotForPage(pageIndex, currentSnapshot && !isSnapshotEmpty(currentSnapshot) ? currentSnapshot : null)
  }, [cacheModeSnapshotForPage, captureFullSnapshot, pageIndex])

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
          const queuedMode = getSnapshotMode(queuedSnapshot)
          const currentCount = queuedMode === 'raw-ink' ? countRawInkStrokes(queuedSnapshot) : countSymbols(queuedSnapshot.symbols)
          lastSymbolCountRef.current = currentCount
          const baseCount = queuedMode === 'raw-ink'
            ? -1
            : (reason === 'clear' ? previousCount : lastBroadcastBaseCountRef.current)
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
      const snapshotMode = getSnapshotMode(snapshot)
      const currentCount = snapshotMode === 'raw-ink' ? countRawInkStrokes(snapshot) : countSymbols(snapshot.symbols)
      lastSymbolCountRef.current = currentCount
      const isErase = previousCount > 0 && currentCount === 0
      const baseCount = snapshotMode === 'raw-ink'
        ? -1
        : (reason === 'clear' ? previousCount : lastBroadcastBaseCountRef.current)
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
    const snapshotMode = getSnapshotMode(snapshot)
    const targetClientId = message?.targetClientId
    if (targetClientId && targetClientId !== clientIdRef.current) {
      return
    }
    const msgTs = typeof receivedTs === 'number' ? receivedTs : typeof message?.ts === 'number' ? (message.ts as number) : Date.now()
    if (snapshotMode === 'raw-ink') {
      const incomingStrokeCount = countRawInkStrokes(snapshot)
      const isNewer = msgTs >= lastGlobalUpdateTsRef.current
      if (!isNewer && reason !== 'clear') {
        return
      }
      if (snapshot.snapshotId && appliedSnapshotIdsRef.current.has(snapshot.snapshotId)) return
      if (message.originClientId && message.originClientId === clientIdRef.current && !targetClientId) return
      if (!hasControllerRights() && quizActiveRef.current) {
        return
      }

      isApplyingRemoteRef.current = true
      try {
        setCanvasMode('raw-ink')
        replaceRawInkState(snapshot.rawInk?.strokes || [], { clearRedo: true })
        setLatexOutput('')
        appliedVersionRef.current = snapshot.version
        lastAppliedRemoteVersionRef.current = snapshot.version
        lastSymbolCountRef.current = incomingStrokeCount
        lastBroadcastBaseCountRef.current = incomingStrokeCount
        suppressBroadcastUntilTsRef.current = Date.now() + 500
        if (snapshot.snapshotId) {
          appliedSnapshotIdsRef.current.add(snapshot.snapshotId)
          if (appliedSnapshotIdsRef.current.size > 200) {
            const iter = appliedSnapshotIdsRef.current.values()
            appliedSnapshotIdsRef.current.delete(iter.next().value as string)
          }
        }
        const canonical = cloneSnapshotPayload({ ...snapshot, baseSymbolCount: -1 })
        if (canonical) {
          latestSnapshotRef.current = { snapshot: canonical, ts: msgTs, reason }
          cacheModeSnapshotForPage(pageIndexRef.current, canonical)
        }
        if (isNewer || reason === 'clear') {
          lastGlobalUpdateTsRef.current = Math.max(lastGlobalUpdateTsRef.current, msgTs)
        }
      } catch (err) {
        console.error('Failed to apply remote raw ink snapshot', err)
      } finally {
        isApplyingRemoteRef.current = false
        setIsConverting(false)
      }
      return
    }

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
        cacheModeSnapshotForPage(pageIndexRef.current, canonical)
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
  }, [cacheModeSnapshotForPage, captureFullSnapshot, replaceRawInkState])

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
      replaceRawInkState([], { clearRedo: true })
      setCanvasMode('math')
      setLatexOutput('')
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
  }, [applySnapshotCore, hasControllerRights, replaceRawInkState])

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

    const firstLine = raw.split(/\\\\/).map(part => part.trim()).filter(Boolean)[0] || raw
    const simplified = firstLine
      .replace(/\$\$?/g, '')
      .replace(/\\\(|\\\)/g, '')
      .replace(/\\begin\{[^}]+\}|\\end\{[^}]+\}/g, '')
      .replace(/\\(left|right)/g, '')
      .replace(/\\text\s*\{([^}]*)\}/g, ' $1 ')
      .replace(/\\(?:dfrac|tfrac|frac)\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '$1 over $2')
      .replace(/\\sqrt\s*\{([^{}]+)\}/g, 'sqrt $1')
      .replace(/\\(cdot|times|ast)/g, ' x ')
      .replace(/\\div/g, ' / ')
      .replace(/\\pm/g, ' plus or minus ')
      .replace(/\\mp/g, ' minus or plus ')
      .replace(/\\sum/g, ' sum ')
      .replace(/\\prod/g, ' product ')
      .replace(/\\setminus/g, ' set minus ')
      .replace(/\\geq/g, ' >= ')
      .replace(/\\leq/g, ' <= ')
      .replace(/\\neq/g, ' != ')
      .replace(/\\to/g, ' -> ')
      .replace(/[_^]\{([^}]*)\}/g, ' $1 ')
      .replace(/[_^]([A-Za-z0-9])/g, ' $1 ')
      .replace(/&/g, ' ')
      .replace(/[{}]/g, ' ')
      .replace(/\\{2,}/g, ' ')
      .replace(/\\(quad|qquad|,|;|:|!)/g, ' ')
      .replace(/\\[A-Za-z]+/g, ' ')
      .replace(/\s*([=+\-*/()\[\],])\s*/g, ' $1 ')
      .replace(/\s+/g, ' ')
      .trim()

    return simplified.length > 72 ? `${simplified.slice(0, 72).trim()}…` : simplified
  }, [normalizeStepLatex])

  const extractLatexRhsFromStep = useCallback((value: string) => {
    const raw = normalizeStepLatex(value)
    if (!raw) return ''
    const eqIndex = raw.lastIndexOf('=')
    if (eqIndex < 0) return raw
    const rhs = raw.slice(eqIndex + 1).trim()
    return rhs || ''
  }, [normalizeStepLatex])

  const sanitizeLatexForEvaluation = useCallback((value: string) => {
    const raw = String(value || '').trim()
    if (!raw) return ''
    return raw
      .replace(/\\(left|right)/g, '')
      .replace(/\\\\/g, '')
      .replace(/&/g, '')
      .replace(/\\(,|;|:|!|quad|qquad)/g, '')
      .replace(/\\(dfrac|tfrac)/g, '\\frac')
      .replace(/\\,\s*/g, '')
      .replace(/\\!/g, '')
      .trim()
  }, [])

  const extractNumericRhsFromStep = useCallback((value: string) => {
    const raw = normalizeStepLatex(value)
    if (!raw) return ''
    const eqIndex = raw.lastIndexOf('=')
    let rhs = eqIndex < 0 ? raw : raw.slice(eqIndex + 1).trim()
    if (!rhs) return ''

    rhs = rhs
      .replace(/\$+/g, '')
      .replace(/\\\$/g, '')
      .replace(/\\(left|right)/g, '')
      .replace(/\\times/g, '*')
      .replace(/\\cdot/g, '*')
      .replace(/\\ast/g, '*')
      .replace(/\\div/g, '/')
      .replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, '($1)/($2)')
      .replace(/\\(,|;|:|!|quad|qquad)/g, '')
      .replace(/[×]/g, '*')
      .replace(/[÷]/g, '/')
      .replace(/[–−]/g, '-')
      .replace(/,/g, '')
      .replace(/[{}]/g, match => (match === '{' ? '(' : ')'))
      .replace(/\s+/g, '')

    return rhs
  }, [normalizeStepLatex])

  const evaluateNumericExpression = useCallback((expr: string) => {
    if (!expr) return null

    const tokens: string[] = []
    let i = 0
    while (i < expr.length) {
      const ch = expr[i]
      if (ch >= '0' && ch <= '9' || ch === '.') {
        let num = ch
        i += 1
        while (i < expr.length && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')) {
          num += expr[i]
          i += 1
        }
        if (num === '.' || num === '+.' || num === '-.') return null
        tokens.push(num)
        continue
      }

      if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '(' || ch === ')') {
        tokens.push(ch)
        i += 1
        continue
      }

      return null
    }

    const output: string[] = []
    const ops: string[] = []
    const precedence: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, 'u+': 3, 'u-': 3 }
    const isRightAssoc = (op: string) => op === 'u+' || op === 'u-'

    let prevToken: string | null = null
    for (const token of tokens) {
      const isNumber = /^(\d+(\.\d+)?|\.\d+)$/.test(token)
      if (isNumber) {
        output.push(token)
        prevToken = token
        continue
      }

      if (token === '(') {
        ops.push(token)
        prevToken = token
        continue
      }

      if (token === ')') {
        while (ops.length && ops[ops.length - 1] !== '(') {
          output.push(ops.pop() as string)
        }
        if (!ops.length) return null
        ops.pop()
        prevToken = token
        continue
      }

      let op = token
      if ((token === '+' || token === '-') && (!prevToken || prevToken === '(' || /[+\-*/]/.test(prevToken))) {
        op = token === '+' ? 'u+' : 'u-'
      }

      while (ops.length) {
        const top = ops[ops.length - 1]
        if (top === '(') break
        const pTop = precedence[top]
        const pOp = precedence[op]
        if (pTop > pOp || (pTop === pOp && !isRightAssoc(op))) {
          output.push(ops.pop() as string)
          continue
        }
        break
      }

      ops.push(op)
      prevToken = op
    }

    while (ops.length) {
      const op = ops.pop() as string
      if (op === '(' || op === ')') return null
      output.push(op)
    }

    const stack: number[] = []
    for (const token of output) {
      if (/^(\d+(\.\d+)?|\.\d+)$/.test(token)) {
        const n = Number(token)
        if (!Number.isFinite(n)) return null
        stack.push(n)
        continue
      }

      if (token === 'u+' || token === 'u-') {
        if (stack.length < 1) return null
        const v = stack.pop() as number
        stack.push(token === 'u-' ? -v : v)
        continue
      }

      if (stack.length < 2) return null
      const b = stack.pop() as number
      const a = stack.pop() as number
      let res = 0
      if (token === '+') res = a + b
      else if (token === '-') res = a - b
      else if (token === '*') res = a * b
      else if (token === '/') res = a / b
      else return null

      if (!Number.isFinite(res)) return null
      stack.push(res)
    }

    if (stack.length !== 1) return null
    return stack[0]
  }, [])

  const evaluateLatexExpression = useCallback((expr: string) => {
    if (!expr) return null
    if (!computeEngine) return null
    try {
      const cleaned = sanitizeLatexForEvaluation(expr)
      if (!cleaned) return null
      const boxed = computeEngine.parse(cleaned)
      const numericBoxed: any = boxed?.N ? boxed.N() : boxed
      if (!numericBoxed) return null

      const value = (typeof numericBoxed.valueOf === 'function') ? numericBoxed.valueOf() : null
      if (typeof value === 'number' && Number.isFinite(value)) return value

      const numericValue = (numericBoxed as any).numericValue
      if (typeof numericValue === 'number' && Number.isFinite(numericValue)) return numericValue

      const rawValue = (numericBoxed as any).value
      if (typeof rawValue === 'number' && Number.isFinite(rawValue)) return rawValue
    } catch {
      // ignore
    }
    return null
  }, [computeEngine, sanitizeLatexForEvaluation])

  const formatComputedValue = useCallback((value: number) => {
    if (Number.isInteger(value)) return String(value)
    const rounded = Math.round(value * 1e10) / 1e10
    let text = String(rounded)
    if (text.includes('e') || text.includes('E')) {
      text = rounded.toFixed(10)
    }
    return text.replace(/0+$/, '').replace(/\.$/, '')
  }, [])

  const cleanupStepLatexWithJiix = useCallback(
    (latex: string, snapshot: SnapshotPayload | null): string => {
      let cleaned = (latex || '').trim()
      if (!cleaned) return cleaned

      // First pass: try to normalize with the CortexJS Compute Engine if available.
      if (computeEngine) {
        try {
          const expr = (computeEngine as any).parse(cleaned)
          const normalized = typeof expr?.latex === 'function' ? expr.latex() : null
          if (typeof normalized === 'string' && normalized.trim()) {
            cleaned = normalized.trim()
          }
        } catch {
          // If normalization fails, fall back to the original LaTeX.
        }
      }

      // Second pass: safely parse JIIX so future geometry-aware cleanups
      // can reason about mis-split fraction bars or radicals.
      if (snapshot?.jiix) {
        try {
          const jiix = JSON.parse(snapshot.jiix)
          void jiix
        } catch {
          // Ignore invalid JIIX; cleanup remains best-effort.
        }
      }

      return cleaned
    },
    [computeEngine]
  )

  const appendComputedLineFromLastStep = useCallback(() => {
    let lastStep = adminSteps.length ? adminSteps[adminSteps.length - 1]?.latex || '' : ''
    if (!lastStep) {
      const fallback = (latexRenderSourceRef.current || '').trim()
      if (fallback) {
        const parts = fallback.split(/\\\\/).map(part => part.trim()).filter(Boolean)
        lastStep = parts.length ? (parts[parts.length - 1] || '') : ''
      }
    }
    if (!lastStep) return

    const latexExpr = extractLatexRhsFromStep(lastStep)
    const valueFromLatex = latexExpr ? evaluateLatexExpression(latexExpr) : null
    let value = valueFromLatex

    if (value === null) {
      const expr = extractNumericRhsFromStep(lastStep)
      if (!expr) return
      value = evaluateNumericExpression(expr)
    }
    if (value === null) return

    const computedLine = `=${formatComputedValue(value)}`
    if (useAdminStepComposerRef.current) {
      if (recognitionEngineRef.current === 'keyboard') {
        const now = Date.now()
        setKeyboardSteps(prev => [...prev, {
          latex: computedLine,
          symbols: [],
          jiix: null,
          createdAt: now,
          updatedAt: now,
        }])
      } else {
        setAdminSteps(prev => [...prev, { latex: computedLine, symbols: null, jiix: null, rawStrokes: null, strokeGroups: null }])
      }
    } else {
      setLatexDisplayState(prev => {
        const existing = (prev.latex || '').trim()
        const nextLatex = [existing, computedLine].filter(Boolean).join(' \\\\ ')
        return { ...prev, latex: nextLatex }
      })
    }
    clearTopPanelSelection()
  }, [adminSteps, clearTopPanelSelection, evaluateLatexExpression, evaluateNumericExpression, extractLatexRhsFromStep, extractNumericRhsFromStep, formatComputedValue])
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

  const probeMyScriptRecognitionState = useCallback(async () => {
    const editor = editorInstanceRef.current
    setMyScriptLastProbeAt(Date.now())
    if (!editor) {
      setMyScriptModelSummary(toDebugJson({ hasEditor: false }))
      return
    }

    const model = editor.model ?? {}
    const rawSymbols = (model as any).symbols
    const exportsPayload = model.exports ?? null
    const symbols = extractEditorSymbols()
    const summary = {
      hasEditor: true,
      hasModel: Boolean(editor.model),
      modelKeys: Object.keys(model || {}).slice(0, 24),
      symbolContainerType: Array.isArray(rawSymbols) ? 'array' : rawSymbols ? typeof rawSymbols : 'none',
      symbolCount: countSymbols(symbols),
      exportKeys: exportsPayload && typeof exportsPayload === 'object' ? Object.keys(exportsPayload).slice(0, 24) : [],
    }

    setMyScriptModelSummary(toDebugJson(summary))
    setMyScriptLastSymbolsPayload(toDebugJson(symbols))
    setMyScriptLastExportPayload(toDebugJson(exportsPayload))

    try {
      const latex = await exportLatexFromEditor()
      setMyScriptLastSymbolExtract(Date.now())
      setMyScriptLastExportedLatex(latex || null)
    } catch (err) {
      setMyScriptLastError(err instanceof Error ? err.message : String(err))
    }
  }, [exportLatexFromEditor, extractEditorSymbols])

  const scheduleMyScriptProbe = useCallback(() => {
    if (myscriptProbeTimeoutRef.current) {
      clearTimeout(myscriptProbeTimeoutRef.current)
      myscriptProbeTimeoutRef.current = null
    }
    myscriptProbeTimeoutRef.current = setTimeout(() => {
      myscriptProbeTimeoutRef.current = null
      void probeMyScriptRecognitionState()
    }, 180)
  }, [probeMyScriptRecognitionState])

  probeMyScriptRecognitionStateRef.current = probeMyScriptRecognitionState
  scheduleMyScriptProbeRef.current = scheduleMyScriptProbe

  const getMathpixEventList = useCallback((symbols: any[] | null) => {
    return Array.isArray(symbols)
      ? symbols
      : Array.isArray((symbols as any)?.events)
      ? (symbols as any).events
      : []
  }, [])

  const getMathpixLocalStrokesPayload = useCallback(() => {
    const strokes = mathpixLocalStrokesRef.current
      .map(stroke => ({ x: stroke.x, y: stroke.y }))
      .filter(stroke => stroke.x.length && stroke.y.length)
    if (!strokes.length) return null
    return {
      x: strokes.map(stroke => stroke.x),
      y: strokes.map(stroke => stroke.y),
    }
  }, [])

  const buildMathpixStrokesPayload = useCallback((symbols: any[] | null) => {
    const events: any[] = getMathpixEventList(symbols)
    if (!events.length) return getMathpixLocalStrokesPayload()

    const hasStrokeIds = events.some(e => e && (e.strokeId != null || e.stroke_id != null))
    const toNumber = (value: unknown) => {
      const n = Number(value)
      return Number.isFinite(n) ? n : null
    }

    if (hasStrokeIds) {
      const order: string[] = []
      const map = new Map<string, { x: number[]; y: number[] }>()
      for (const e of events) {
        const keyRaw = e?.strokeId ?? e?.stroke_id
        if (keyRaw == null) continue
        const key = String(keyRaw)
        const x = toNumber(e?.x ?? e?.point?.x)
        const y = toNumber(e?.y ?? e?.point?.y)
        if (x == null || y == null) continue
        if (!map.has(key)) {
          map.set(key, { x: [], y: [] })
          order.push(key)
        }
        map.get(key)!.x.push(Math.round(x))
        map.get(key)!.y.push(Math.round(y))
      }
      const x: number[][] = []
      const y: number[][] = []
      order.forEach(key => {
        const entry = map.get(key)
        if (!entry || entry.x.length === 0 || entry.y.length === 0) return
        x.push(entry.x)
        y.push(entry.y)
      })
      return x.length ? { x, y } : null
    }

    const x: number[][] = []
    const y: number[][] = []
    let currentX: number[] = []
    let currentY: number[] = []

    const flush = () => {
      if (currentX.length && currentY.length) {
        x.push(currentX)
        y.push(currentY)
      }
      currentX = []
      currentY = []
    }

    const normalizeType = (evt: any) => {
      const raw = evt?.type ?? evt?.eventType ?? evt?.state ?? evt?.phase ?? evt?.kind ?? evt?.action ?? ''
      return String(raw).toLowerCase()
    }

    for (const e of events) {
      const type = normalizeType(e)
      const isStart = Boolean(e?.isFirst || e?.isStart) || /(down|start|begin)/.test(type)
      const isEnd = Boolean(e?.isLast || e?.isEnd) || /(up|end|stop)/.test(type)

      if (isStart && currentX.length) flush()

      const px = toNumber(e?.x ?? e?.point?.x)
      const py = toNumber(e?.y ?? e?.point?.y)
      if (px != null && py != null) {
        currentX.push(Math.round(px))
        currentY.push(Math.round(py))
      }

      if (isEnd) flush()
    }

    flush()
    return x.length ? { x, y } : getMathpixLocalStrokesPayload()
  }, [getMathpixEventList, getMathpixLocalStrokesPayload])

  const requestMathpixLatex = useCallback(async (symbols: any[] | null) => {
    const events = getMathpixEventList(symbols)
    setMathpixLastEventCount(events.length || null)

    const strokes = buildMathpixStrokesPayload(symbols)
    if (!strokes) {
      setMathpixLastProxyPayload(null)
      setMathpixLastUpstreamPayload(null)
      setMathpixStatus('error')
      setMathpixError('No strokes extracted from MyScript symbols.')
      setMathpixLastResponseAt(Date.now())
      return ''
    }

    const proxyPayload = { strokes }
    const upstreamPayload = {
      strokes: { strokes },
      formats: ['latex_styled', 'text'],
      rm_spaces: true,
      metadata: { improve_mathpix: false },
    }
    setMathpixLastProxyPayload(JSON.stringify(proxyPayload, null, 2))
    setMathpixLastUpstreamPayload(JSON.stringify(upstreamPayload, null, 2))

    const requestId = ++mathpixRequestSeqRef.current
    setMathpixError(null)
    setMathpixRawResponse(null)
    setMathpixStatus('pending')
    setMathpixLastRequestAt(Date.now())
    setMathpixLastStrokeCount(strokes.x.length)
    setMathpixLastPointCount(strokes.x.reduce((sum, stroke) => sum + stroke.length, 0))
    setMathpixLastStatusCode(null)

    try {
      const res = await fetch('/api/mathpix/strokes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strokes }),
      })
      const data = await res.json().catch(() => null)
      setMathpixLastStatusCode(res.status)
      setMathpixLastResponseAt(Date.now())
      if (!res.ok) {
        const message = data?.error || `Mathpix request failed (${res.status}).`
        if (requestId === mathpixRequestSeqRef.current) {
          setMathpixError(message)
          setMathpixRawResponse(data ? JSON.stringify(data, null, 2) : null)
          setMathpixStatus('error')
        }
        return ''
      }
      if (requestId !== mathpixRequestSeqRef.current) return ''
      setMathpixRawResponse(data ? JSON.stringify(data, null, 2) : null)
      setMathpixStatus('success')
      return typeof data?.latex === 'string' ? data.latex : ''
    } catch (err: any) {
      if (requestId === mathpixRequestSeqRef.current) {
        setMathpixError(err?.message || 'Mathpix request failed.')
        setMathpixRawResponse(err ? String(err?.stack || err?.message || err) : null)
        setMathpixStatus('error')
        setMathpixLastResponseAt(Date.now())
      }
      return ''
    }
  }, [buildMathpixStrokesPayload, getMathpixEventList])

  const getLatexFromEditorModel = useCallback(() => {
    const editor = editorInstanceRef.current
    const exports = editor?.model?.exports ?? {}
    const latex = exports?.['application/x-latex']
    return typeof latex === 'string' ? latex : ''
  }, [])

  const convertLatexFromEditor = useCallback(async () => {
    const editor = editorInstanceRef.current
    if (!editor) return ''

    const readLatestLatex = async () => {
      const modelLatex = getLatexFromEditorModel()
      if (modelLatex && modelLatex.trim()) return modelLatex
      const exportedLatex = await exportLatexFromEditor()
      return typeof exportedLatex === 'string' ? exportedLatex : ''
    }

    const initial = await readLatestLatex()
    if (initial.trim()) return initial
    if (typeof editor.convert !== 'function') return initial

    return await new Promise<string>((resolve) => {
      let done = false
      const cleanup = () => {
        try {
          editor.event?.removeEventListener?.('exported', handleExported)
        } catch {}
        try {
          editor.event?.removeEventListener?.('error', handleError)
        } catch {}
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
      }
      const finish = async () => {
        if (done) return
        done = true
        cleanup()
        const latest = await readLatestLatex()
        setIsConverting(false)
        resolve(latest)
      }
      const handleExported = () => {
        void finish()
      }
      const handleError = () => {
        void finish()
      }
      const timeoutId = setTimeout(() => {
        void finish()
      }, 1500)

      try {
        editor.event?.addEventListener?.('exported', handleExported)
        editor.event?.addEventListener?.('error', handleError)
      } catch {}

      try {
        forcedConvertDepthRef.current += 1
        setIsConverting(true)
        void runIinkActionSafely(() => editor.convert())
      } catch {
        void finish()
      }
    })
  }, [exportLatexFromEditor, getLatexFromEditorModel])

  const exportLatexFromEngine = useCallback(async (options?: { allowConvertFallback?: boolean }) => {
    const allowConvertFallback = options?.allowConvertFallback !== false
    if (recognitionEngineRef.current === 'keyboard') {
      return latexOutputRef.current || ''
    }
    if (recognitionEngineRef.current === 'mathpix') {
      const symbols = extractEditorSymbols()
      setMyScriptLastSymbolsPayload(toDebugJson(symbols))
      return requestMathpixLatex(symbols)
    }
    // Only MyScript: if MyScript fails, do not fallback to MathPix, just return empty string
    try {
      const symbols = extractEditorSymbols()
      setMyScriptLastSymbolsPayload(toDebugJson(symbols))
      let latex = await exportLatexFromEditor()
      if (allowConvertFallback && (!latex || !latex.trim()) && countSymbols(symbols) > 0) {
        latex = await convertLatexFromEditor()
      }
      setMyScriptLastSymbolExtract(Date.now())
      setMyScriptLastExportedLatex(latex || null)
      return latex
    } catch (err) {
      setLatexOutput('')
      setMyScriptLastError(err instanceof Error ? err.message : String(err))
      return ''
    }
  }, [convertLatexFromEditor, exportLatexFromEditor, extractEditorSymbols, requestMathpixLatex])

  const scheduleMathpixPreview = useCallback(() => {
    if (recognitionEngineRef.current !== 'mathpix') return
    const previewEpoch = latexPreviewEpochRef.current
    if (mathpixPreviewTimeoutRef.current) {
      clearTimeout(mathpixPreviewTimeoutRef.current)
      mathpixPreviewTimeoutRef.current = null
    }
    mathpixPreviewTimeoutRef.current = setTimeout(() => {
      mathpixPreviewTimeoutRef.current = null
      const symbols = extractEditorSymbols()
      const symbolCount = countSymbols(symbols)
      if (symbolCount === 0) {
        setLatexOutput('')
        if (useAdminStepComposerRef.current && hasControllerRights()) {
          setAdminDraftLatex('')
        }
        return
      }
      requestMathpixLatex(symbols)
        .then(latex => {
          if (previewEpoch !== latexPreviewEpochRef.current) return
          setLatexOutput(latex)
          if (useAdminStepComposerRef.current && hasControllerRights()) {
            setAdminDraftLatex(normalizeStepLatex(latex))
          }
        })
        .catch(() => {})
    }, 420)
  }, [extractEditorSymbols, hasControllerRights, normalizeStepLatex, requestMathpixLatex])

  const getLatexFromEngineModel = useCallback(() => {
    if (recognitionEngineRef.current !== 'myscript') {
      return latexOutputRef.current || ''
    }
    return getLatexFromEditorModel()
  }, [getLatexFromEditorModel])

  const invalidatePendingLatexPreviewWork = useCallback(() => {
    latexPreviewEpochRef.current += 1
    if (pendingExportRef.current) {
      clearTimeout(pendingExportRef.current)
      pendingExportRef.current = null
    }
    if (studentQuizPreviewExportRef.current) {
      clearTimeout(studentQuizPreviewExportRef.current)
      studentQuizPreviewExportRef.current = null
    }
    if (mathpixPreviewTimeoutRef.current) {
      clearTimeout(mathpixPreviewTimeoutRef.current)
      mathpixPreviewTimeoutRef.current = null
    }
    previewExportInFlightRef.current = false
    studentQuizPreviewExportInFlightRef.current = false
  }, [])

  const resyncLatexPreviewFromEditor = useCallback(async () => {
    invalidatePendingLatexPreviewWork()

    const editor = editorInstanceRef.current
    if (!editor) {
      setLatexOutput('')
      if (useAdminStepComposerRef.current && hasControllerRights()) {
        setAdminDraftLatex('')
      }
      return
    }

    try {
      if (typeof editor.waitForIdle === 'function') {
        await editor.waitForIdle()
      }
    } catch {}

    const symbols = extractEditorSymbols()
    const symbolCount = countSymbols(symbols)
    lastSymbolCountRef.current = symbolCount

    if (symbolCount === 0) {
      setLatexOutput('')
      if (useAdminStepComposerRef.current && hasControllerRights()) {
        setAdminDraftLatex('')
      }
      return
    }

    let latexValue = getLatexFromEngineModel()
    if (recognitionEngineRef.current === 'mathpix') {
      latexValue = await requestMathpixLatex(symbols)
    } else if (recognitionEngineRef.current === 'myscript' && (!latexValue || latexValue.trim().length === 0)) {
      const exported = await exportLatexFromEngine({ allowConvertFallback: false })
      latexValue = typeof exported === 'string' ? exported : ''
    }

    setLatexOutput(latexValue)
    if (useAdminStepComposerRef.current && hasControllerRights()) {
      setAdminDraftLatex(normalizeStepLatex(latexValue))
    }
  }, [exportLatexFromEngine, extractEditorSymbols, getLatexFromEngineModel, hasControllerRights, invalidatePendingLatexPreviewWork, normalizeStepLatex, requestMathpixLatex])

  useEffect(() => {
    resyncLatexPreviewFromEditorRef.current = resyncLatexPreviewFromEditor
    return () => {
      resyncLatexPreviewFromEditorRef.current = null
    }
  }, [resyncLatexPreviewFromEditor])

  // Used to safely re-initialize the iink editor when admin layout switches on mobile.
  // Learners always use the stacked layout, so we avoid coupling re-init to isCompactViewport for them.
  const editorInitLayoutKey = hasControllerRights() ? (isCompactViewport ? 'admin-compact' : 'admin-wide') : 'learner'
  const editorInitKey = `${editorInitLayoutKey}:${editorReinitNonce}`

  const triggerEditorReinit = useCallback((reason?: string) => {
    if (editorReconnectingRef.current) return
    const reconnectSnapshot = cloneSnapshotPayload(latestSnapshotRef.current?.snapshot ?? captureFullSnapshot())
    if (reconnectSnapshot) {
      reconnectSnapshot.baseSymbolCount = -1
    }
    editorReconnectRestoreSnapshotRef.current = reconnectSnapshot
    editorReconnectingRef.current = true
    editorReconnectPhaseRef.current = 'pending-init'
    suppressNextLoadingOverlayRef.current = true
    setEditorReconnecting(true)
    setStatus('idle')
    setMyScriptEditorReady(false)
    setTransientError(null)
    setFatalError(null)
    // Intentionally do not show the raw engine error text here.
    // This path is used for the iink "session expired" / max-duration cases and should be seamless.
    setEditorReinitNonce(n => n + 1)
  }, [captureFullSnapshot])

  useEffect(() => {
    if (!editorReconnecting) return
    if (editorReconnectPhaseRef.current === 'pending-init') return
    if (editorReconnectPhaseRef.current === 'restoring') return
    if (status === 'ready') {
      const reconnectSnapshot = cloneSnapshotPayload(editorReconnectRestoreSnapshotRef.current)
      editorReconnectPhaseRef.current = 'restoring'
      void (async () => {
        try {
          if (reconnectSnapshot) {
            await applyPageSnapshot(reconnectSnapshot)
          }
        } catch (err) {
          console.warn('Failed to restore editor state after reconnect', err)
        } finally {
          editorReconnectRestoreSnapshotRef.current = null
          setEditorReconnecting(false)
          editorReconnectingRef.current = false
          editorReconnectPhaseRef.current = null
          suppressNextLoadingOverlayRef.current = false
        }
      })()
      return
    }
    if (status === 'error') {
      editorReconnectRestoreSnapshotRef.current = null
      setEditorReconnecting(false)
      editorReconnectingRef.current = false
      editorReconnectPhaseRef.current = null
      suppressNextLoadingOverlayRef.current = false
    }
  }, [applyPageSnapshot, editorReconnecting, status])

  useEffect(() => {
    let cancelled = false
    const host = editorHostRef.current

    const initTraceState = {
      editorInitLayoutKey,
      editorReinitNonce,
      canvasMode,
      canOrchestrateLesson,
      forceEditableForAssignment,
      useStackedStudentLayout,
      isCompactViewport,
    }
    const previousInitTraceState = lastEditorInitTraceRef.current
    const initReasons = previousInitTraceState
      ? [
          previousInitTraceState.editorReinitNonce !== initTraceState.editorReinitNonce ? 'editor-reinit-nonce' : null,
          previousInitTraceState.editorInitLayoutKey !== initTraceState.editorInitLayoutKey ? 'layout-key' : null,
          previousInitTraceState.canvasMode !== initTraceState.canvasMode ? 'canvas-mode' : null,
          previousInitTraceState.canOrchestrateLesson !== initTraceState.canOrchestrateLesson ? 'orchestration-rights' : null,
          previousInitTraceState.forceEditableForAssignment !== initTraceState.forceEditableForAssignment ? 'force-editable' : null,
          previousInitTraceState.useStackedStudentLayout !== initTraceState.useStackedStudentLayout ? 'stacked-layout' : null,
          previousInitTraceState.isCompactViewport !== initTraceState.isCompactViewport ? 'compact-viewport' : null,
        ].filter(Boolean)
      : ['initial-mount']
    lastEditorInitTraceRef.current = initTraceState

    recordCanvasInitTrace({
      kind: 'editor-init-effect',
      reasons: initReasons,
      suppressedLoadingOverlay: suppressNextLoadingOverlayRef.current,
      state: initTraceState,
    })

    if (editorReconnectPhaseRef.current === 'pending-init') {
      editorReconnectPhaseRef.current = 'waiting-result'
    }

    if (!host) {
      return
    }

    if (canvasMode === 'raw-ink') {
      setStatus('ready')
      setFatalError(null)
      setMyScriptEditorReady(false)
      setMyScriptLastError(null)
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
    setMyScriptEditorReady(false)
    setMyScriptLastError(null)

    let resizeHandler: (() => void) | null = null
    const listeners: Array<{ type: string; handler: (event: any) => void }> = []

    loadIinkRuntime()
      .then(async () => {
        if (cancelled) return
        setMyScriptScriptLoaded(Boolean(window?.iink?.Editor?.load))
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

        try {
          host.replaceChildren()
        } catch {
          try {
            host.innerHTML = ''
          } catch {}
        }

        const options = {
          configuration: {
            server: {
              scheme,
              host: websocketHost,
              applicationKey: appKey,
              hmacKey,
            },
            convert: {
              'convert-on-double-tap': false,
            },
            recognition: {
              type: 'MATH',
              import: {
                jiix: true,
              },
              export: {
                jiix: {
                  strokes: true,
                },
              },
              gesture: {
                enable: false,
              },
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
        setMyScriptEditorReady(true)
        setEraserShimReady(
          installIinkEraserPointerTypeShim(
            editor,
            () => isEraserModeRef.current,
            () => stackedInputScaleRef.current,
            () => (useStackedStudentLayout ? TOUCH_INK_DISAMBIGUATION_DELAY_MS : 0),
          )
        )
        setStatus('ready')
        setMyScriptLastError(null)

        // Ensure the editor has a valid view size after any initial layout shifts.
        requestEditorResize()

        const handleChanged = (evt: any) => {
          setMyScriptChangedCount((count) => count + 1)
          setMyScriptLastChangedAt(Date.now())
          setMyScriptLastChangedPayload(toDebugJson(evt?.detail ?? null))
          setCanUndo(Boolean(evt.detail?.canUndo))
          setCanRedo(Boolean(evt.detail?.canRedo))
          setCanClear(Boolean(evt.detail?.canClear))
          const now = Date.now()
          const suppressPublish = now < suppressBroadcastUntilTsRef.current
          // Respect assignment override + general lock state.
          // `lockedOutRef` is the single source of truth for whether the current user
          // is allowed to edit/publish (it already includes `forceEditableForAssignment`).
          if (!canOrchestrateLesson && lockedOutRef.current) {
            enforceAuthoritativeSnapshot()
            return
          }
          const isSharedPage = pageIndex === sharedPageIndexRef.current
          const canSend = !suppressPublish && canPublishSnapshotsRef.current() && isSharedPage && !isBroadcastPausedRef.current && !lockedOutRef.current
          const snapshot = collectEditorSnapshot(canSend)
          if (!snapshot) return
          if (snapshot.version === lastAppliedRemoteVersionRef.current) return

          const symbolCount = countSymbols(snapshot.symbols)
          setMyScriptLastSymbolsPayload(toDebugJson(snapshot.symbols))

          // Update local symbol count tracking for accurate delta math for remote peers.
          lastSymbolCountRef.current = symbolCount
          if (canSend) {
            broadcastSnapshot(false)
          }

          if (recognitionEngineRef.current === 'mathpix') {
            scheduleMathpixPreview()
          }

          // Admin compact/stacked mode: keep a live typeset preview updated without mutating the ink.
          if (useAdminStepComposerRef.current) {
            if (pendingExportRef.current) {
              clearTimeout(pendingExportRef.current)
            }
            const previewEpoch = latexPreviewEpochRef.current
            pendingExportRef.current = setTimeout(() => {
              pendingExportRef.current = null
              if (previewExportInFlightRef.current) return
              previewExportInFlightRef.current = true
              ;(async () => {
                let latexValue = getLatexFromEngineModel()
                if (recognitionEngineRef.current === 'mathpix') {
                  const exported = await exportLatexFromEngine({ allowConvertFallback: false })
                  latexValue = typeof exported === 'string' ? exported : ''
                } else if (!latexValue || latexValue.trim().length === 0) {
                  const exported = await exportLatexFromEngine({ allowConvertFallback: false })
                  latexValue = typeof exported === 'string' ? exported : ''
                }
                if (cancelled) return
                if (previewEpoch !== latexPreviewEpochRef.current) return
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
          if (!canOrchestrateLesson && (quizActiveRef.current || isAssignmentViewRef.current)) {
            if (studentQuizPreviewExportRef.current) {
              clearTimeout(studentQuizPreviewExportRef.current)
            }
            const previewEpoch = latexPreviewEpochRef.current
            studentQuizPreviewExportRef.current = setTimeout(() => {
              studentQuizPreviewExportRef.current = null
              if (studentQuizPreviewExportInFlightRef.current) return
              studentQuizPreviewExportInFlightRef.current = true
              ;(async () => {
                let latexValue = getLatexFromEngineModel()
                if (recognitionEngineRef.current === 'mathpix') {
                  const exported = await exportLatexFromEngine({ allowConvertFallback: false })
                  latexValue = typeof exported === 'string' ? exported : ''
                } else if (!latexValue || latexValue.trim().length === 0) {
                  const exported = await exportLatexFromEngine({ allowConvertFallback: false })
                  latexValue = typeof exported === 'string' ? exported : ''
                }
                if (cancelled) return
                if (previewEpoch !== latexPreviewEpochRef.current) return
                setLatexOutput(latexValue)
              })()
                .finally(() => {
                  studentQuizPreviewExportInFlightRef.current = false
                })
            }, 350)
          } else if (useStackedStudentLayout && hasWriteAccess && !useAdminStepComposerRef.current) {
            if (studentQuizPreviewExportRef.current) {
              clearTimeout(studentQuizPreviewExportRef.current)
            }
            const previewEpoch = latexPreviewEpochRef.current
            studentQuizPreviewExportRef.current = setTimeout(() => {
              studentQuizPreviewExportRef.current = null
              if (studentQuizPreviewExportInFlightRef.current) return
              studentQuizPreviewExportInFlightRef.current = true
              ;(async () => {
                let latexValue = getLatexFromEngineModel()
                if (!latexValue || latexValue.trim().length === 0) {
                  const exported = await exportLatexFromEngine({ allowConvertFallback: false })
                  latexValue = typeof exported === 'string' ? exported : ''
                }
                if (cancelled) return
                if (previewEpoch !== latexPreviewEpochRef.current) return
                setLatexOutput(latexValue)
              })()
                .finally(() => {
                  studentQuizPreviewExportInFlightRef.current = false
                })
            }, 350)
          }
        }
        const handleExported = (evt: any) => {
          if (recognitionEngineRef.current !== 'myscript') return
          setMyScriptExportedCount((count) => count + 1)
          setMyScriptLastExportedAt(Date.now())
          setMyScriptLastSymbolExtract(Date.now())

          const exports = evt.detail || {}
          setMyScriptLastExportPayload(toDebugJson(exports))

          const publishExportResult = (latexValue: string) => {
            setMyScriptLastExportedLatex(latexValue || null)
            setLatexOutput(latexValue)
            setIsConverting(false)

            const isSharedPage = pageIndex === sharedPageIndexRef.current
            const canSend = canPublishSnapshotsRef.current() && isSharedPage && !isBroadcastPausedRef.current && !lockedOutRef.current
            if (forcedConvertDepthRef.current > 0) {
              forcedConvertDepthRef.current = Math.max(0, forcedConvertDepthRef.current - 1)
              return
            }
            if (canSend) {
              broadcastSnapshot(true)
            }
          }

          const latex = exports['application/x-latex'] || ''
          const latexValue = typeof latex === 'string' ? latex : ''
          if (latexValue.trim()) {
            publishExportResult(latexValue)
            return
          }

          void (async () => {
            const fallbackLatex = await exportLatexFromEditor()
            publishExportResult(typeof fallbackLatex === 'string' ? fallbackLatex : '')
          })()
        }
        const handleError = (evt: any) => {
          const details = formatRuntimeErrorDetails(evt, 'Unknown error from MyScript editor.')
          const raw = details.message
          const sourceLabel = details.source ? `Source: ${details.source}` : ''
          const firstStackLine = details.stack ? String(details.stack).split('\n')[0] : ''
          const overlayMessage = [raw, sourceLabel || firstStackLine].filter(Boolean).join('\n')
          const debugMessage = [raw, sourceLabel, details.stack ? `Stack:\n${details.stack}` : '', details.raw ? `Raw:\n${details.raw}` : '']
            .filter(Boolean)
            .join('\n\n')

          setMyScriptLastError(debugMessage || raw)
          console.warn('[MyScript editor] runtime recovery', {
            message: raw,
            source: details.source,
            stack: details.stack,
            raw: details.raw,
          })

          const editingTopPanelStep = topPanelEditingModeRef.current
            && (adminEditIndex !== null || studentEditIndexRef.current !== null || topPanelSelectedStepRef.current !== null)
          const disposition = getSilentMyScriptRuntimeDisposition(details)
          const effectiveDisposition = editingTopPanelStep && disposition === 'reinit' && !isHardMyScriptReconnectMessage(details)
            ? 'ignore'
            : disposition

          if (effectiveDisposition === 'resize') {
            recordSilentCanvasRecovery('myscript-resize', details)
            if (editorResizeRetryTimeoutRef.current) {
              clearTimeout(editorResizeRetryTimeoutRef.current)
            }
            editorResizeRetryTimeoutRef.current = setTimeout(() => {
              editorResizeRetryTimeoutRef.current = null
              requestEditorResize()
            }, 120)
            return
          }

          if (effectiveDisposition === 'ignore') {
            recordSilentCanvasRecovery('myscript-ignore', details)
            return
          }

          if (effectiveDisposition === 'reinit') {
            recordSilentCanvasRecovery('myscript-reinit', details)
            triggerEditorReinit(raw)
            return
          }
        }

        listeners.push({ type: 'changed', handler: handleChanged })
        listeners.push({ type: 'exported', handler: handleExported })
        listeners.push({ type: 'error', handler: handleError })

        listeners.forEach(({ type, handler }) => {
          editor.event.addEventListener(type, handler)
        })

        resizeHandler = () => {
          requestEditorResize()
        }
        window.addEventListener('resize', resizeHandler)
      })
      .catch(err => {
        if (cancelled) return
        console.warn('MyScript initialization recovery', err)
        setMyScriptScriptLoaded(Boolean(window?.iink?.Editor?.load))
        const message = err instanceof Error ? err.message : String(err)
        setMyScriptLastError(message)
        recordSilentCanvasRecovery('myscript-init-retry', { message })
        triggerEditorReinit(message)
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
      if (editorResizeRetryTimeoutRef.current) {
        clearTimeout(editorResizeRetryTimeoutRef.current)
        editorResizeRetryTimeoutRef.current = null
      }
      if (mathpixPreviewTimeoutRef.current) {
        clearTimeout(mathpixPreviewTimeoutRef.current)
        mathpixPreviewTimeoutRef.current = null
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
        setMyScriptEditorReady(false)
      }
      try {
        const host = editorHostRef.current
        host?.replaceChildren?.()
      } catch {
        try {
          const host = editorHostRef.current
          if (host) host.innerHTML = ''
        } catch {}
      }

      if (eraserLongPressTimeoutRef.current) {
        clearTimeout(eraserLongPressTimeoutRef.current)
        eraserLongPressTimeoutRef.current = null
      }
    }
  }, [broadcastSnapshot, canvasMode, editorInitKey, exportLatexFromEngine, forceEditableForAssignment, getLatexFromEngineModel, canOrchestrateLesson, normalizeStepLatex, requestEditorResize, scheduleMathpixPreview, triggerEditorReinit, useStackedStudentLayout])

  useEffect(() => {
    if (!useAdminStepComposer) return
    setAdminSteps([])
    setAdminDraftLatex('')
    setAdminSendingStep(false)
    setAdminEditIndex(null)
    setKeyboardSteps([])
    setKeyboardEditIndex(null)
    setActiveNotebookSolutionId(null)
    setLoadedNotebookRevision(null)
    setFinishQuestionNoteId(null)
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

        if (canOrchestrateLesson && !forceEditableForAssignment && !activePresenterUserKeyRef.current) {
          const teacherClientId = clientIdRef.current
          const teacherPresenterKey = (selfUserKey || '').trim() || (teacherClientId ? `client:${teacherClientId}` : null)
          if (teacherPresenterKey) {
            setActivePresenterUserKey(teacherPresenterKey)
            activePresenterUserKeyRef.current = String(teacherPresenterKey)
            activePresenterClientIdsRef.current = teacherClientId ? new Set([teacherClientId]) : new Set()
            updateControlState(controlStateRef.current)
            try {
              await channel.publish('control', {
                clientId: clientIdRef.current,
                author: userDisplayName,
                action: 'presenter-set',
                presenterUserKey: teacherPresenterKey,
                targetClientIds: teacherClientId ? [teacherClientId] : [],
                ts: Date.now(),
              } satisfies PresenterSetMessage)
            } catch (err) {
              console.warn('Failed to bootstrap teacher presenter state', err)
            }
          }
        }

        const handleStroke = (message: any) => {
          if (!canOrchestrateLesson && latexDisplayStateRef.current.enabled) {
            return
          }
          const data = message?.data as SnapshotMessage
          if (!data || data.clientId === clientIdRef.current) return
          enqueueSnapshot(data, typeof message?.timestamp === 'number' ? message.timestamp : undefined)
        }

        const handleSyncState = (message: any) => {
          if (!canOrchestrateLesson && latexDisplayStateRef.current.enabled) {
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
              const current = latestSnapshotRef.current
              if (current?.snapshot) {
                return current
              }
            }
            const freshSnapshot = captureFullSnapshot()
            if (!freshSnapshot) {
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
            action?: 'wipe' | 'convert' | 'force-resync' | 'latex-display' | 'stacked-notes' | 'quiz' | 'controller-highlight' | 'presenter-set' | 'shared-page' | 'presenter-continuity-load'
            targetClientId?: string
            targetClientIds?: string[]
            snapshot?: SnapshotPayload | null
            save?: NotesSaveRecord | null
            continuitySaveId?: string
            continuitySessionKey?: string
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
            const incomingTs = typeof (data as any)?.ts === 'number' ? Number((data as any).ts) : Date.now()
            if (incomingTs < lastPresenterSetTsRef.current) {
              return
            }
            lastPresenterSetTsRef.current = incomingTs
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
              bumpPresenterStateVersion()
              pendingPublishQueueRef.current = []
            }

            // Presenter changes affect write/publish permissions. Recompute immediately for everyone,
            // including demoted presenters, before any early returns.
            updateControlState(controlStateRef.current)

            // If we're not the active presenter, immediately stop any queued publishes.
            if (nextKey && !(selfUserKey && nextKey === selfUserKey) && !activePresenterClientIdsRef.current.has(clientIdRef.current || '')) {
              pendingPublishQueueRef.current = []
              if (pendingBroadcastRef.current) {
                clearTimeout(pendingBroadcastRef.current)
                pendingBroadcastRef.current = null
              }
              return
            }

            // If we ARE the active presenter, immediately assert our current page + state.
            if (nextKey) {
              const pendingContinuitySave = pendingPresenterContinuitySaveRef.current
              if (pendingContinuitySave && isSelfActivePresenter()) {
                if (continuityFallbackTimerRef.current && typeof window !== 'undefined') {
                  window.clearTimeout(continuityFallbackTimerRef.current)
                  continuityFallbackTimerRef.current = null
                }
                pendingPresenterContinuitySaveRef.current = null
                void applySavedNotesRecord(pendingContinuitySave, { publish: true, continuity: true })
                return
              }
              if (continuityPullInFlightRef.current) {
                return
              }
              if (continuityFallbackTimerRef.current && typeof window !== 'undefined') {
                window.clearTimeout(continuityFallbackTimerRef.current)
                continuityFallbackTimerRef.current = null
              }
              if (typeof window !== 'undefined') {
                continuityFallbackTimerRef.current = window.setTimeout(() => {
                  continuityFallbackTimerRef.current = null
                  const pending = pendingPresenterContinuitySaveRef.current
                  if (pending && isSelfActivePresenter()) {
                    pendingPresenterContinuitySaveRef.current = null
                    void applySavedNotesRecord(pending, { publish: true, continuity: true })
                    return
                  }
                  const currentPage = pageIndexRef.current
                  setSharedPageIndex(currentPage)
                  void publishSharedPage(currentPage, Date.now())
                  void forcePublishCanvas(undefined, { shareIndex: currentPage })
                }, 600)
                return
              }
              const currentPage = pageIndexRef.current
              setSharedPageIndex(currentPage)
              void publishSharedPage(currentPage, Date.now())
              void forcePublishCanvas(undefined, { shareIndex: currentPage })
            }
            return
          }

          if (data?.action === 'presenter-continuity-load') {
            const targets: string[] = Array.isArray((data as any).targetClientIds)
              ? (data as any).targetClientIds.filter((id: unknown): id is string => typeof id === 'string')
              : []
            const fallbackTarget = typeof data.targetClientId === 'string' ? data.targetClientId : ''
            const dedupedTargets: string[] = targets.length ? Array.from(new Set(targets)) : (fallbackTarget ? [fallbackTarget] : [])
            if (dedupedTargets.length) {
              const myClientId = String(clientIdRef.current || '')
              if (!myClientId || !dedupedTargets.includes(myClientId)) return
            }

            const continuitySave = data?.save
            const continuitySaveId = typeof data?.continuitySaveId === 'string' ? data.continuitySaveId.trim() : ''
            const continuitySessionKey = typeof data?.continuitySessionKey === 'string' ? data.continuitySessionKey.trim() : ''

            if (continuitySave && typeof continuitySave === 'object') {
              pendingPresenterContinuitySaveRef.current = continuitySave as NotesSaveRecord
              if (isSelfActivePresenter()) {
                const pending = pendingPresenterContinuitySaveRef.current
                pendingPresenterContinuitySaveRef.current = null
                if (pending) {
                  if (continuityFallbackTimerRef.current && typeof window !== 'undefined') {
                    window.clearTimeout(continuityFallbackTimerRef.current)
                    continuityFallbackTimerRef.current = null
                  }
                  void applySavedNotesRecord(pending, { publish: true, continuity: true })
                }
              }
              return
            }

            if (!continuitySaveId || !continuitySessionKey) return
            continuityPullInFlightRef.current = true
            void (async () => {
              try {
                const res = await fetch(`/api/sessions/${encodeURIComponent(continuitySessionKey)}/latex-saves?take=200`, {
                  credentials: 'same-origin',
                })
                if (!res.ok) return
                const payload = await res.json().catch(() => null)
                const shared = Array.isArray(payload?.shared) ? payload.shared : []
                const pulled = shared.find((item: any) => String(item?.id || '') === continuitySaveId) || null
                if (!pulled || typeof pulled !== 'object') return
                pendingPresenterContinuitySaveRef.current = pulled as NotesSaveRecord

                if (isSelfActivePresenter()) {
                  const pending = pendingPresenterContinuitySaveRef.current
                  pendingPresenterContinuitySaveRef.current = null
                  if (pending) {
                    if (continuityFallbackTimerRef.current && typeof window !== 'undefined') {
                      window.clearTimeout(continuityFallbackTimerRef.current)
                      continuityFallbackTimerRef.current = null
                    }
                    await applySavedNotesRecord(pending, { publish: true, continuity: true })
                  }
                }
              } catch {
                // ignore continuity pull errors
              } finally {
                continuityPullInFlightRef.current = false
              }
            })()
            return
          }

          if (data?.action === 'shared-page') {
            const idxRaw = (data as any).sharedPageIndex
            const idx = (typeof idxRaw === 'number' && Number.isFinite(idxRaw)) ? Math.max(0, Math.trunc(idxRaw)) : 0
            setSharedPageIndex(idx)

            // Everyone except the active presenter follows the presenter's shared page.
            const isPresenter = isSelfActivePresenter()
            if (!isPresenter) {
              const prevPage = pageIndexRef.current
              const pageChanged = prevPage !== idx
              // Ensure local page list can represent this page index.
              while (pageRecordsRef.current.length <= idx) {
                pageRecordsRef.current.push({ snapshot: null })
              }
              if (pageChanged) {
                setPageIndex(idx)
              }

              // IMPORTANT UX: during presenter/controller switches the shared-page message is
              // frequently re-broadcast even when the page index is unchanged.
              // Don't clear the board in that case; keep the last-visible notes on screen and
              // let the sync-request reconcile in the background.
              if (pageChanged) {
                const cached = pageRecordsRef.current[idx]?.snapshot ?? null
                if (cached && !isSnapshotEmpty(cached)) {
                  void applyPageSnapshot(cached)
                } else {
                  try {
                    editor?.clear?.()
                  } catch {}
                  setLatexOutput('')
                  lastSymbolCountRef.current = 0
                  lastBroadcastBaseCountRef.current = 0
                }
              }
              void requestSyncFromPublisher()
            }
            return
          }
          if (data?.action === 'quiz') {
            const phase = data.phase
            // Teacher sees incoming submissions in realtime; minimal UX for now.
            if (canOrchestrateLesson && phase === 'submit') {
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
            if (!canOrchestrateLesson) {
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

                // Notify the quiz popup (TextOverlayModule) so learners see the countdown on the prompt.
                try {
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('philani-quiz:timer', { detail: { active: true, endsAt, durationSec } }))
                  }
                } catch {}

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

                // Ensure quiz popup timer clears immediately.
                try {
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('philani-quiz:timer', { detail: { active: false } }))
                  }
                } catch {}
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
            if (canOrchestrateLesson) return
            if (isBroadcastPausedRef.current) return
            if (!editor) return
            forcedConvertDepthRef.current += 1
            setIsConverting(true)
            void runIinkActionSafely(() => editor.convert())
            return
          }
          if (data?.action === 'latex-display') {
            const enabled = Boolean(data.enabled)
            const latex = typeof data.latex === 'string' ? data.latex : ''
            const options = sanitizeLatexOptions(data.options)
            setLatexDisplayState({ enabled, latex, options })
            if (!canOrchestrateLesson) {
              setLatexProjectionOptions(options)
            }
            if (!canOrchestrateLesson) {
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
            if (canvasModeRef.current === 'raw-ink') {
              replaceRawInkState([], { clearRedo: true })
            }
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
          await channel.presence.enter({
            name: userDisplayName,
            userId,
            platformRole: lessonRoleProfile.platformRole,
            technicalUserType: lessonRoleProfile.technicalUserType,
            canOrchestrateLesson: lessonRoleProfile.capabilities.canOrchestrateLesson,
          })
          const members = await channel.presence.get()
          const normalizePresenceName = (value: any) => String(value || '').trim().replace(/\s+/g, ' ')
          const toPresenceClient = (m: any) => ({
            clientId: String(m?.clientId || ''),
            name: normalizePresenceName(m?.data?.name),
            platformRole: typeof m?.data?.platformRole === 'string' ? m.data.platformRole : undefined,
            technicalUserType: m?.data?.technicalUserType === 'technical' ? 'technical' : (m?.data?.technicalUserType === 'non-technical' ? 'non-technical' : undefined),
            canOrchestrateLesson: Boolean(m?.data?.canOrchestrateLesson),
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
                if (ENABLE_EMBEDDED_DIAGRAMS && canOrchestrateLesson) {
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
                // Ensure late-joining students receive the current quiz state (so the timer appears).
                if (canOrchestrateLesson && quizActiveRef.current) {
                  try {
                    const quizId = (quizIdRef.current || '').trim()
                    const prompt = (quizPromptRef.current || '').trim()
                    if (quizId && prompt) {
                      await channel.publish('control', {
                        clientId: clientIdRef.current,
                        author: userDisplayName,
                        action: 'quiz',
                        phase: 'active',
                        enabled: true,
                        preQuizControl: adminPreQuizControlStateRef.current ?? undefined,
                        quizId,
                        quizLabel: quizLabelRef.current || undefined,
                        quizPhaseKey: quizPhaseKeyRef.current || undefined,
                        quizPointId: quizPointIdRef.current || undefined,
                        quizPointIndex: (Number.isFinite(quizPointIndexRef.current) && quizPointIndexRef.current >= 0) ? quizPointIndexRef.current : undefined,
                        prompt,
                        durationSec: (typeof quizDurationSecRef.current === 'number' && Number.isFinite(quizDurationSecRef.current) && quizDurationSecRef.current > 0)
                          ? Math.trunc(quizDurationSecRef.current)
                          : undefined,
                        endsAt: (typeof quizEndsAtRef.current === 'number' && Number.isFinite(quizEndsAtRef.current) && quizEndsAtRef.current > 0)
                          ? Math.trunc(quizEndsAtRef.current)
                          : undefined,
                        ts: Date.now(),
                      } satisfies QuizControlMessage)
                    }
                  } catch (err) {
                    console.warn('Failed to rebroadcast quiz state', err)
                  }
                }
                if (canOrchestrateLesson && hasExclusiveControlRef.current) {
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
        console.warn('Realtime collaboration recovery', err)
        if (!disposed) {
          recordSilentCanvasRecovery('realtime-retry', {
            message: err instanceof Error ? err.message : String(err),
          })
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
          if (canOrchestrateLesson && hasExclusiveControlRef.current) {
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
  }, [applySnapshotCore, captureFullSnapshot, collectEditorSnapshot, channelName, enqueueSnapshot, canOrchestrateLesson, lessonRoleProfile.capabilities.canOrchestrateLesson, lessonRoleProfile.platformRole, lessonRoleProfile.technicalUserType, status, updateControlState, userDisplayName])

  const isEditorEmptyNow = () => {
    if (recognitionEngineRef.current === 'keyboard') {
      return !((latexOutputRef.current || '').trim())
    }
    return lastSymbolCountRef.current <= 0
  }

  const isCurrentLineEmptyNow = () => {
    if (useAdminStepComposer && hasBoardWriteRights()) {
      return !(adminDraftLatex || '').trim()
    }
    return !((latexOutput || '').trim())
  }

  const clearEverything = () => {
    if (lockedOutRef.current && !canUseTeacherKeyboardLocalToolbarActions) return

    setActiveNotebookSolutionId(null)
    setLoadedNotebookRevision(null)
    setFinishQuestionNoteId(null)

    if (canvasModeRef.current === 'raw-ink') {
      const nextSnapshot = makeRawInkSnapshot([], localVersionRef.current, `${clientIdRef.current}-${Date.now()}-raw-clear`)
      replaceRawInkState([], { clearRedo: true })
      invalidatePendingLatexPreviewWork()
      setLatexOutput('')
      lastSymbolCountRef.current = 0
      lastBroadcastBaseCountRef.current = 0
      cacheModeSnapshotForPage(pageIndexRef.current, nextSnapshot)
      if (pageIndex === sharedPageIndexRef.current) {
        broadcastSnapshot(true, { force: true, reason: 'clear' })
      }
      return
    }

    if (recognitionEngineRef.current === 'keyboard') {
      const field = keyboardMathfieldRef.current
      if (field) {
        field.focus()
        field.executeCommand('deleteAll')
        syncKeyboardMathfieldState(field)
      } else {
        syncKeyboardDraftLatex('')
        setKeyboardSelectionState({ start: 0, end: 0 })
        syncKeyboardControlStripState(null, '')
      }

      setAdminSteps([])
      setAdminDraftLatex('')
      setAdminSendingStep(false)
      setAdminEditIndex(null)
      setKeyboardSteps([])
      setKeyboardEditIndex(null)
      clearTopPanelSelection()
      stepNavRedoStackRef.current = []
      return
    }

    if (!editorInstanceRef.current) return
    invalidatePendingLatexPreviewWork()

    try {
      editorInstanceRef.current.clear()
    } catch {}
    setLatexOutput('')
    clearMathpixLocalStrokes()
    lastSymbolCountRef.current = 0
    lastBroadcastBaseCountRef.current = 0

    if (useAdminStepComposer) {
      setAdminSteps([])
      setAdminDraftLatex('')
      setAdminSendingStep(false)
      setAdminEditIndex(null)
      setKeyboardSteps([])
      setKeyboardEditIndex(null)
      clearTopPanelSelection()
      stepNavRedoStackRef.current = []
    }

    if (pageIndex === sharedPageIndexRef.current) {
      broadcastSnapshot(true, { force: true, reason: 'clear' })
    }
  }

  const clearCurrentOnly = () => {
    if (lockedOutRef.current && !canUseTeacherKeyboardLocalToolbarActions) return

    if (canvasModeRef.current === 'raw-ink') {
      const nextSnapshot = makeRawInkSnapshot([], localVersionRef.current, `${clientIdRef.current}-${Date.now()}-raw-clear`)
      replaceRawInkState([], { clearRedo: true })
      invalidatePendingLatexPreviewWork()
      setLatexOutput('')
      lastSymbolCountRef.current = 0
      lastBroadcastBaseCountRef.current = 0
      cacheModeSnapshotForPage(pageIndexRef.current, nextSnapshot)
      if (pageIndex === sharedPageIndexRef.current) {
        broadcastSnapshot(true, { force: true, reason: 'clear' })
      }
      return
    }

    if (recognitionEngineRef.current === 'keyboard') {
      const field = keyboardMathfieldRef.current
      if (field) {
        field.focus()
        field.executeCommand('deleteAll')
        syncKeyboardMathfieldState(field)
      } else {
        syncKeyboardDraftLatex('')
        setKeyboardSelectionState({ start: 0, end: 0 })
        syncKeyboardControlStripState(null, '')
      }
      if (useAdminStepComposer && hasControllerRights()) {
        setAdminDraftLatex('')
        clearTopPanelSelection()
      }
      return
    }

    if (!editorInstanceRef.current) return
    invalidatePendingLatexPreviewWork()
    editorInstanceRef.current.clear()
    setLatexOutput('')
    clearMathpixLocalStrokes()
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
    if (recognitionEngineRef.current === 'keyboard') {
      const field = keyboardMathfieldRef.current
      if (field) {
        field.focus()
        field.executeCommand('deleteAll')
        syncKeyboardMathfieldState(field)
      } else {
        setLatexOutput('')
        latexOutputRef.current = ''
        setKeyboardSelectionState({ start: 0, end: 0 })
        if (useAdminStepComposerRef.current && hasControllerRights()) {
          setAdminDraftLatex('')
        }
        syncKeyboardControlStripState(null, '')
      }
      return
    }
    handleTrashClick()
  }

  const handleUndo = async () => {
    if (recognitionEngineRef.current === 'keyboard') {
      if (lockedOutRef.current && !canOrchestrateLesson) return
      const field = keyboardMathfieldRef.current
      if (!field) return
      field.focus()
      const didUndo = field.executeCommand('undo')
      if (!didUndo) return
      syncKeyboardMathfieldState(field)
      return
    }

    if (canvasModeRef.current === 'raw-ink') {
      if (lockedOutRef.current) return
      const current = rawInkStrokesRef.current
      if (!current.length) return
      rawInkRedoStackRef.current.push(cloneRawInkStrokes(current))
      const next = current.slice(0, -1)
      const nextSnapshot = makeRawInkSnapshot(next, localVersionRef.current, `${clientIdRef.current}-${Date.now()}-raw-undo`)
      setRawInkActivePreview([])
      setRawInkStrokes(cloneRawInkStrokes(next))
      lastSymbolCountRef.current = next.length
      lastBroadcastBaseCountRef.current = next.length
      cacheModeSnapshotForPage(pageIndexRef.current, nextSnapshot)
      broadcastSnapshot(false, { force: true, reason: next.length ? 'update' : 'clear' })
      return
    }

    if (!editorInstanceRef.current) return
    if (lockedOutRef.current) return

    const didUndo = await runIinkActionSafely(() => editorInstanceRef.current!.undo())
    if (!didUndo) return
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
    if (recognitionEngineRef.current === 'keyboard') {
      if (lockedOutRef.current && !canOrchestrateLesson) return
      const field = keyboardMathfieldRef.current
      if (!field) return
      field.focus()
      const didRedo = field.executeCommand('redo')
      if (!didRedo) return
      syncKeyboardMathfieldState(field)
      return
    }

    if (canvasModeRef.current === 'raw-ink') {
      if (lockedOutRef.current) return
      const next = rawInkRedoStackRef.current.pop()
      if (!next) return
      const nextSnapshot = makeRawInkSnapshot(next, localVersionRef.current, `${clientIdRef.current}-${Date.now()}-raw-redo`)
      setRawInkActivePreview([])
      setRawInkStrokes(cloneRawInkStrokes(next))
      lastSymbolCountRef.current = next.length
      lastBroadcastBaseCountRef.current = next.length
      cacheModeSnapshotForPage(pageIndexRef.current, nextSnapshot)
      broadcastSnapshot(false, { force: true, reason: next.length ? 'update' : 'clear' })
      return
    }

    if (!editorInstanceRef.current) return
    if (lockedOutRef.current) return

    const didRedo = await runIinkActionSafely(() => editorInstanceRef.current!.redo())
    if (!didRedo) return
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

  const applyMathfieldKeyboardAction = useCallback((actionId: string, baseSymbol?: string, overrideLatex?: string | null) => {
    const field = keyboardMathfieldRef.current
    const action = KEYBOARD_ACTION_MAP[actionId]
    if (!field || !action) return false

    field.focus()
    const transientRadicalEditContext = captureKeyboardTransientRadicalProgrammaticEditContext(field)
    const useNativeTransientRadicalEditing = Boolean(
      transientRadicalEditContext
      && shouldUseNativeKeyboardTransientRadicalEditing(field, transientRadicalEditContext),
    )

    if (actionId === 'backspace') {
      updateRecentRepresentativeAction(actionId)
      field.executeCommand('deleteBackward')
      finalizeKeyboardMathfieldProgrammaticEdit(field, transientRadicalEditContext)
      return true
    }

    if (actionId === 'clear') {
      updateRecentRepresentativeAction(actionId)
      field.executeCommand('deleteAll')
      finalizeKeyboardMathfieldProgrammaticEdit(field, transientRadicalEditContext)
      return true
    }

    const selectableField = field as MathfieldElementType & {
      selection: { ranges: [number, number][]; direction?: 'forward' | 'backward' | 'none' }
      selectionIsCollapsed: boolean
      getValue: (selection?: { ranges: [number, number][]; direction?: 'forward' | 'backward' | 'none' }, format?: 'latex') => string
      insert: (
        value: string,
        options?: {
          insertionMode?: 'replaceSelection' | 'replaceAll' | 'insertBefore' | 'insertAfter'
          selectionMode?: 'placeholder' | 'after' | 'before' | 'item'
        }
      ) => boolean
    }
    const selection = selectableField.selection
    const hasSelectionRange = !selectableField.selectionIsCollapsed && selection.ranges.length > 0

    // Enclosure actions: wrap selection if present, else insert empty enclosure
    if ([
      'paren', 'bracket', 'brace', 'absolute', 'floor', 'ceiling'
    ].includes(actionId)) {
      let left, right
      switch (actionId) {
        case 'paren':
          left = '\\left('; right = '\\right)'; break
        case 'bracket':
          left = '\\left['; right = '\\right]'; break
        case 'brace':
          left = '\\left\\{'; right = '\\right\\}'; break
        case 'absolute':
          left = '\\left|'; right = '\\right|'; break
        case 'floor':
          left = '\\left\\lfloor '; right = ' \\right\\rfloor'; break
        case 'ceiling':
          left = '\\left\\lceil '; right = ' \\right\\rceil'; break
        default:
          left = ''; right = ''
      }
      if (hasSelectionRange) {
        const selected = selectableField.getValue(selection, 'latex') || ''
        selectableField.insert(`${left}${selected}${right}`, {
          insertionMode: 'replaceSelection',
          selectionMode: 'item',
        })
        updateRecentRepresentativeAction(actionId)
        finalizeKeyboardMathfieldProgrammaticEdit(field, transientRadicalEditContext)
        return true
      }

      selectableField.insert(`${left}${right}`, {
        selectionMode: 'after',
      })
      field.executeCommand('moveToPreviousChar')
      updateRecentRepresentativeAction(actionId)
      finalizeKeyboardMathfieldProgrammaticEdit(field, transientRadicalEditContext)
      return true
    }

    if (actionId === 'log-base') {
      if (hasSelectionRange) {
        const selected = selectableField.getValue(selection, 'latex') || ''
        selectableField.insert(`\\log_{#?}\\left(${selected || '#?'}\\right)`, {
          insertionMode: 'replaceSelection',
          selectionMode: 'placeholder',
        })
      } else {
        selectableField.insert('\\log_{#?}\\left(#?\\right)', {
          selectionMode: 'placeholder',
        })
      }
      updateRecentRepresentativeAction(actionId)
      finalizeKeyboardMathfieldProgrammaticEdit(field, transientRadicalEditContext)
      return true
    }

    if (['sqrt', 'cuberoot', 'nth-root'].includes(actionId) && !hasSelectionRange) {
      let insertion = ''
      let transientPromptIds: KeyboardTransientRadicalPromptIds | null = null
      switch (actionId) {
        case 'sqrt':
          transientPromptIds = createKeyboardTransientRadicalPromptIds()
          insertion = buildKeyboardTransientRadicalLatex(transientPromptIds)
          break
        case 'cuberoot':
          insertion = '\\sqrt[3]{\\placeholder{}}'
          break
        case 'nth-root':
          transientPromptIds = createKeyboardTransientRadicalPromptIds()
          insertion = buildKeyboardTransientRadicalLatex(transientPromptIds)
          break
        default:
          insertion = ''
      }
      if (!insertion) return false
      field.executeCommand(['insert', insertion])
      let selectionIntent: KeyboardTransientRadicalSelectionIntent | null = null
      if (!transientPromptIds || !selectKeyboardMathfieldPrompt(field, transientPromptIds.radicandPromptId)) {
        selectionIntent = {
          anchorSelection: getKeyboardMathfieldSelectionOffsets(field),
          command: 'moveToPreviousPlaceholder',
        }
        field.executeCommand('moveToPreviousPlaceholder')
      }
      finalizeKeyboardMathfieldProgrammaticEdit(field, transientRadicalEditContext, selectionIntent)
      return true
    }

    // Radical and power actions: wrap selection if present.
    if (['sqrt', 'cuberoot', 'nth-root', 'fraction', 'fraction-denominator', 'power2', 'power3', 'reciprocal'].includes(actionId) && hasSelectionRange) {
      const selected = selectableField.getValue(selection, 'latex') || ''
      let wrapped = ''
      let transientPromptIds: KeyboardTransientRadicalPromptIds | null = null
      switch (actionId) {
        case 'sqrt':
          transientPromptIds = createKeyboardTransientRadicalPromptIds()
          wrapped = buildKeyboardTransientRadicalLatex(transientPromptIds, selected)
          break
        case 'cuberoot':
          wrapped = `\\sqrt[3]{${selected}}`
          break
        case 'nth-root':
          transientPromptIds = createKeyboardTransientRadicalPromptIds()
          wrapped = buildKeyboardTransientRadicalLatex(transientPromptIds, selected)
          break
        case 'fraction':
          wrapped = `\\frac{${selected}}{#?}`
          break
        case 'fraction-denominator':
          wrapped = `\\frac{#?}{${selected}}`
          break
        case 'power2':
          wrapped = `${selected}^{2}`
          break
        case 'power3':
          wrapped = `${selected}^{3}`
          break
        case 'reciprocal':
          wrapped = `${selected}^{-1}`
          break
        default:
          wrapped = ''
      }
      if (wrapped) {
        selectableField.insert(wrapped, {
          insertionMode: 'replaceSelection',
          selectionMode: 'after',
        })
        if (transientPromptIds) {
          selectKeyboardMathfieldPrompt(field, transientPromptIds.radicandPromptId)
        } else if (actionId === 'sqrt' || actionId === 'cuberoot' || actionId === 'nth-root') {
          field.executeCommand('moveToPreviousChar')
        }
        updateRecentRepresentativeAction(actionId)
        finalizeKeyboardMathfieldProgrammaticEdit(field, transientRadicalEditContext)
        return true
      }
    }

    if (actionId === 'power2') {
      if (!field.executeCommand('moveToSuperscript')) {
        field.executeCommand(['insert', '^{2}'])
      } else {
        field.executeCommand(['insert', '2'])
      }
      updateRecentRepresentativeAction(actionId)
      finalizeKeyboardMathfieldProgrammaticEdit(field, transientRadicalEditContext)
      return true
    }

    if (actionId === 'power3') {
      if (!field.executeCommand('moveToSuperscript')) {
        field.executeCommand(['insert', '^{3}'])
      } else {
        field.executeCommand(['insert', '3'])
      }
      updateRecentRepresentativeAction(actionId)
      finalizeKeyboardMathfieldProgrammaticEdit(field, transientRadicalEditContext)
      return true
    }

    if (actionId === 'subscript') {
      if (!field.executeCommand('moveToSubscript')) {
        field.executeCommand(['insert', '_{i}'])
      } else {
        field.executeCommand(['insert', 'i'])
      }
      updateRecentRepresentativeAction(actionId)
      finalizeKeyboardMathfieldProgrammaticEdit(field, transientRadicalEditContext)
      return true
    }

    let insertion = overrideLatex ?? ''
    let transientPromptIds: KeyboardTransientRadicalPromptIds | null = null
    if (!insertion) {
      if (action.token) {
        insertion = action.token
      } else if (actionId === 'fraction' || actionId === 'fraction-denominator') {
        insertion = '\\frac{#?}{#?}'
      } else if (actionId === 'sqrt') {
        transientPromptIds = createKeyboardTransientRadicalPromptIds()
        insertion = buildKeyboardTransientRadicalLatex(transientPromptIds)
      } else if (actionId === 'cuberoot') {
        insertion = '\\sqrt[3]{\\placeholder{}}'
      } else if (actionId === 'nth-root') {
        transientPromptIds = createKeyboardTransientRadicalPromptIds()
        insertion = buildKeyboardTransientRadicalLatex(transientPromptIds)
      } else if (actionId === 'paren') {
        insertion = '\\left(\\right)'
      } else if (actionId === 'bracket') {
        insertion = '\\left[\\right]'
      } else if (actionId === 'brace') {
        insertion = '\\left\\{\\right\\}'
      } else if (actionId === 'absolute') {
        insertion = '\\left|\\right|'
      } else if (actionId === 'floor') {
        insertion = '\\left\\lfloor \\right\\rfloor'
      } else if (actionId === 'ceiling') {
        insertion = '\\left\\lceil \\right\\rceil'
      } else {
        insertion = action.renderLatex?.(baseSymbol) ?? action.latex ?? ''
      }
    }

    if (!insertion) return false
    const canApplyTransientRadicalTextInsert = Boolean(
      transientRadicalEditContext
      && !useNativeTransientRadicalEditing
      && ![
        'sqrt', 'cuberoot', 'nth-root', 'fraction', 'fraction-denominator',
        'power2', 'power3', 'subscript', 'paren', 'bracket', 'brace',
        'absolute', 'floor', 'ceiling', 'log-base', 'reciprocal',
      ].includes(actionId),
    )
    if (canApplyTransientRadicalTextInsert && applyKeyboardTransientRadicalTextInsert(field, insertion, transientRadicalEditContext)) {
      updateRecentRepresentativeAction(actionId)
      return true
    }

    field.executeCommand(['insert', insertion])
    let selectionIntent: KeyboardTransientRadicalSelectionIntent | null = null
    if (!transientPromptIds || !selectKeyboardMathfieldPrompt(field, transientPromptIds.radicandPromptId)) {
      if (actionId === 'sqrt' || actionId === 'cuberoot' || actionId === 'nth-root' || actionId === 'fraction' || actionId === 'fraction-denominator') {
        const preferredPlaceholderCommand = actionId === 'fraction'
          ? 'moveUp'
          : actionId === 'fraction-denominator'
            ? 'moveDown'
            : 'moveToPreviousPlaceholder'
        const anchorSelection = getKeyboardMathfieldSelectionOffsets(field)
        let placeholderCommand = preferredPlaceholderCommand
        if (!field.executeCommand(placeholderCommand) && placeholderCommand !== 'moveToPreviousPlaceholder') {
          placeholderCommand = placeholderCommand === 'moveDown'
            ? 'moveToNextPlaceholder'
            : 'moveToPreviousPlaceholder'
          field.executeCommand(placeholderCommand)
        }
        selectionIntent = {
          anchorSelection,
          command: placeholderCommand,
        }
      }
    }
    updateRecentRepresentativeAction(actionId)
    finalizeKeyboardMathfieldProgrammaticEdit(field, transientRadicalEditContext, selectionIntent)
    return true
  }, [applyKeyboardTransientRadicalTextInsert, captureKeyboardTransientRadicalProgrammaticEditContext, createKeyboardTransientRadicalPromptIds, finalizeKeyboardMathfieldProgrammaticEdit, shouldUseNativeKeyboardTransientRadicalEditing, updateRecentRepresentativeAction])

  const  applyKeyboardAction = useCallback((actionId: string, baseSymbol?: string, insertedTokenOverride?: string) => {
    const action = KEYBOARD_ACTION_MAP[actionId]
    if (!action) return

    if (actionId === 'uppercase') {
      setSelectedKeyboardKey(actionId)
      setKeyboardUppercase((prev) => !prev)
      if (typeof window !== 'undefined') {
        window.setTimeout(() => setSelectedKeyboardKey(null), 220)
      } else {
        setSelectedKeyboardKey(null)
      }
      return
    }

    setSelectedKeyboardKey(actionId)
    const prev = latexOutputRef.current || ''
    const selection = keyboardSelectionRef.current
    const referenceTarget = resolveKeyboardSafeReferenceTarget(prev, selection, {
      allowFallbackToExpressionEnd: true,
    })
    const resolvedBaseSymbol = baseSymbol || referenceTarget?.symbol
    const isLetterTokenAction = Boolean(action.token && /^[a-z]$/.test(action.token))
    const tokenOverride = insertedTokenOverride || (isLetterTokenAction && keyboardUppercase ? action.token!.toUpperCase() : null)
    const directInsertText = tokenOverride || resolveKeyboardDirectInsertText(actionId, prev, selection)
    if (isLetterTokenAction && action.token) {
      updateRecentLetters(tokenOverride || action.token)
    }

    if (recognitionEngineRef.current === 'keyboard' && applyMathfieldKeyboardAction(actionId, resolvedBaseSymbol, directInsertText)) {
      if (isLetterTokenAction && keyboardUppercase) {
        setKeyboardUppercase(false)
      }
      scheduleKeyboardFadeOut()
      if (typeof window !== 'undefined') {
        window.setTimeout(() => setSelectedKeyboardKey(null), 220)
      } else {
        setSelectedKeyboardKey(null)
      }
      return
    }

    let result: KeyboardEditResult
    if (actionId === 'backspace') {
      result = removeKeyboardTextAtSelection(prev, selection)
    } else if (actionId === 'clear') {
      result = { value: '', selectionStart: 0, selectionEnd: 0 }
    } else if (selection.start === selection.end && actionId === 'log-base') {
      result = insertKeyboardStructureAtSelection(prev, '\\log_{#?}\\left(#?\\right)', selection, '\\log_{'.length)
    } else if (selection.start === selection.end && ['paren', 'bracket', 'brace', 'absolute', 'floor', 'ceiling'].includes(actionId)) {
      let insertion = ''
      let caretOffset = 0
      switch (actionId) {
        case 'paren':
          insertion = '()'
          caretOffset = 1
          break
        case 'bracket':
          insertion = '[]'
          caretOffset = 1
          break
        case 'brace':
          insertion = '{}'
          caretOffset = 1
          break
        case 'absolute':
          insertion = '||'
          caretOffset = 1
          break
        case 'floor':
          insertion = '\\left\\lfloor  \\right\\rfloor'
          caretOffset = '\\left\\lfloor '.length
          break
        case 'ceiling':
          insertion = '\\left\\lceil  \\right\\rceil'
          caretOffset = '\\left\\lceil '.length
          break
        default:
          insertion = ''
          caretOffset = 0
      }
      result = insertKeyboardStructureAtSelection(prev, insertion, selection, caretOffset)
    } else if (selection.start === selection.end && ['sqrt', 'cuberoot', 'nth-root'].includes(actionId)) {
      let insertion = ''
      let caretOffset = 0
      switch (actionId) {
        case 'sqrt':
          insertion = '\\sqrt[#?]{#?}'
          caretOffset = insertion.length - '#?}'.length
          break
        case 'cuberoot':
          insertion = '\\sqrt[3]{#?}'
          caretOffset = '\\sqrt[3]{'.length
          break
        case 'nth-root':
          insertion = '\\sqrt[#?]{#?}'
          caretOffset = insertion.length - '#?}'.length
          break
        default:
          insertion = ''
          caretOffset = 0
      }
      result = insertKeyboardStructureAtSelection(prev, insertion, selection, caretOffset)
    } else if (['sqrt', 'cuberoot', 'nth-root'].includes(actionId)) {
      let replacement = ''
      switch (actionId) {
        case 'sqrt':
          replacement = `\\sqrt[#?]{${selection.start === selection.end ? '#?' : prev.slice(selection.start, selection.end)}}`
          break
        case 'cuberoot':
          replacement = `\\sqrt[3]{${selection.start === selection.end ? '' : prev.slice(selection.start, selection.end)}}`
          break
        case 'nth-root':
          replacement = `\\sqrt[#?]{${selection.start === selection.end ? '#?' : prev.slice(selection.start, selection.end)}}`
          break
        default:
          replacement = ''
      }
      const rangeStart = Math.max(0, Math.min(selection.start, prev.length))
      const rangeEnd = Math.max(rangeStart, Math.min(selection.end, prev.length))
      const nextValue = `${prev.slice(0, rangeStart)}${replacement}${prev.slice(rangeEnd)}`
      const caret = rangeStart + replacement.length - 1
      result = { value: nextValue, selectionStart: caret, selectionEnd: caret }
    } else if (action.token) {
      result = insertKeyboardTextAtSelection(prev, tokenOverride || action.token, selection)
    } else if (directInsertText) {
      result = insertKeyboardTextAtSelection(prev, directInsertText, selection)
    } else {
      const replacement = action.apply('', resolvedBaseSymbol)
      result = replaceKeyboardReferenceTarget(prev, referenceTarget, replacement, selection)
    }

    setLatexOutput(result.value)
    latexOutputRef.current = result.value
    setKeyboardSelection({ start: result.selectionStart, end: result.selectionEnd })
    keyboardSelectionRef.current = { start: result.selectionStart, end: result.selectionEnd }
    if (isLetterTokenAction && keyboardUppercase) {
      setKeyboardUppercase(false)
    }
    if (useAdminStepComposerRef.current && hasControllerRights()) {
      setAdminDraftLatex(normalizeStepLatex(result.value))
    }
    updateRecentRepresentativeAction(actionId)
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        keyboardExpressionSurfaceRef.current?.focus()
      }, 0)
    }
    scheduleKeyboardFadeOut()
    if (typeof window !== 'undefined') {
      window.setTimeout(() => setSelectedKeyboardKey(null), 220)
    } else {
      setSelectedKeyboardKey(null)
    }
  }, [applyMathfieldKeyboardAction, closeKeyboardTransientOverlays, hasControllerRights, keyboardUppercase, normalizeStepLatex, scheduleKeyboardFadeOut, updateRecentLetters, updateRecentRepresentativeAction])

  const applyKeyboardRadialAction = useCallback((actionId: string, target: KeyboardStageTarget) => {
    const action = KEYBOARD_ACTION_MAP[actionId]
    if (!action) return

    if (actionId === 'sqrt') {
      closeKeyboardTransientOverlays()
      applyKeyboardAction(actionId)
      return
    }

    setSelectedKeyboardKey(actionId)
    const prev = latexOutputRef.current || ''
    const selection = keyboardSelectionRef.current
    const safeReferenceTarget = (target.referenceTarget && isKeyboardReferenceTargetCommandBoundarySafe(prev, target.referenceTarget))
      ? target.referenceTarget
      : resolveKeyboardSafeReferenceTarget(prev, selection, { allowFallbackToExpressionEnd: true })
    const contextual = buildKeyboardContextualRadialOperation(actionId, target.payloadSymbol || target.baseSymbol, safeReferenceTarget)
    const directInsertText = contextual ? null : resolveKeyboardDirectInsertText(actionId, prev, selection)

    if (recognitionEngineRef.current === 'keyboard') {
      const fallbackBaseSymbol = (target.payloadSymbol || target.baseSymbol) ?? safeReferenceTarget?.symbol
      const overrideLatex = contextual?.previewLatex || directInsertText || action.renderLatex?.(fallbackBaseSymbol) || action.latex || null
      if (applyMathfieldKeyboardAction(actionId, fallbackBaseSymbol, overrideLatex)) {
        closeKeyboardTransientOverlays()
        scheduleKeyboardFadeOut()
        if (typeof window !== 'undefined') {
          window.setTimeout(() => setSelectedKeyboardKey(null), 220)
        } else {
          setSelectedKeyboardKey(null)
        }
        return
      }
    }

    let result: KeyboardEditResult
    if (contextual) {
      result = replaceKeyboardReferenceTarget(prev, safeReferenceTarget || null, contextual.replacement, selection)
    } else if (directInsertText) {
      result = insertKeyboardTextAtSelection(prev, directInsertText, selection)
    } else {
      const resolvedBaseSymbol = (target.payloadSymbol || target.baseSymbol) ?? safeReferenceTarget?.symbol
      if (action.token) {
        result = insertKeyboardTextAtSelection(prev, action.token, selection)
      } else {
        const replacement = action.apply('', resolvedBaseSymbol)
        result = replaceKeyboardReferenceTarget(prev, safeReferenceTarget, replacement, selection)
      }
    }

    setLatexOutput(result.value)
    latexOutputRef.current = result.value
    setKeyboardSelection({ start: result.selectionStart, end: result.selectionEnd })
    keyboardSelectionRef.current = { start: result.selectionStart, end: result.selectionEnd }
    if (useAdminStepComposerRef.current && hasControllerRights()) {
      setAdminDraftLatex(normalizeStepLatex(result.value))
    }
    updateRecentRepresentativeAction(actionId)
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        keyboardExpressionSurfaceRef.current?.focus()
      }, 0)
    }
    scheduleKeyboardFadeOut()
    if (typeof window !== 'undefined') {
      window.setTimeout(() => setSelectedKeyboardKey(null), 220)
    } else {
      setSelectedKeyboardKey(null)
    }
  }, [applyKeyboardAction, applyMathfieldKeyboardAction, closeKeyboardTransientOverlays, hasControllerRights, normalizeStepLatex, scheduleKeyboardFadeOut, updateRecentRepresentativeAction])

  const moveKeyboardCaretBySwipe = useCallback((direction: KeyboardSwipeDirection, sourceActionId?: string) => {
    const field = keyboardMathfieldRef.current
    if (!field) return false

    field.focus()

    const tryExecute = (...commands: Array<string | [string, string]>) => {
      for (const command of commands) {
        try {
          const handled = Array.isArray(command)
            ? field.executeCommand(command)
            : field.executeCommand(command)
          if (handled) return true
        } catch {}
      }
      return false
    }

    const clampAndSetPosition = (delta: number) => {
      const currentValue = field.getValue('latex') || ''
      const currentPosition = typeof field.position === 'number' ? field.position : 0
      const nextPosition = Math.max(0, Math.min(currentValue.length, currentPosition + delta))
      if (nextPosition === currentPosition) return false
      field.position = nextPosition
      return true
    }

    const moveHorizontally = (delta: 1 | -1) => {
      if (tryExecute(delta > 0 ? 'moveToNextChar' : 'moveToPreviousChar')) return true
      return clampAndSetPosition(delta)
    }

    const moveHorizontallyThenApply = (delta: 1 | -1, structuralMove: () => boolean) => {
      const currentPosition = typeof field.position === 'number' ? field.position : 0
      if (!moveHorizontally(delta)) return false
      if (structuralMove()) return true
      field.position = currentPosition
      return false
    }

    const moveToSuperscript = () => {
      const currentValue = field.getValue('latex') || ''
      // Always block on empty field — MathLive would otherwise create a bare ^{} with no base.
      if (!currentValue.trim()) {
        triggerKeyboardSwipeBlock('Place the caret after a valid base before exponentiating.', sourceActionId)
        return false
      }
      // Trust MathLive's atom-aware navigation for non-empty expressions.
      // It understands the atom structure (fractions, groups, etc.) correctly;
      // our string-based lookup cannot reliably map atom indices to string offsets.
      if (tryExecute('moveToSuperscript')) return true
      // Fallback insert path: only reached when MathLive can't navigate to an
      // existing superscript. At this point we own the insertion, so validate
      // the end of the expression as a safe anchor heuristic.
      if (!isValidKeyboardExpressionEndForScript(currentValue)) {
        triggerKeyboardSwipeBlock('Place the caret after a valid base before exponentiating.', sourceActionId)
        return false
      }
      try {
        field.executeCommand(['insert', '^{}'])
        return true
      } catch {
        return false
      }
    }

    const moveToSubscript = () => {
      const currentValue = field.getValue('latex') || ''
      if (!currentValue.trim()) {
        triggerKeyboardSwipeBlock('Place the caret after a valid base before adding a subscript.', sourceActionId)
        return false
      }
      if (tryExecute('moveToSubscript')) return true
      if (!isValidKeyboardExpressionEndForScript(currentValue)) {
        triggerKeyboardSwipeBlock('Place the caret after a valid base before adding a subscript.', sourceActionId)
        return false
      }
      try {
        field.executeCommand(['insert', '_{}'])
        return true
      } catch {
        return false
      }
    }

    const moveVertical = (axis: 'up' | 'down') => {
      const currentValue = field.getValue('latex') || ''
      const currentSelection = getKeyboardMathfieldSelectionOffsets(field)
      const currentPosition = currentSelection.start
      setKeyboardSelectionState(currentSelection)
      const selectableField = field as MathfieldElementType & {
        selection: { ranges: [number, number][]; direction?: 'forward' | 'backward' | 'none' }
        selectionIsCollapsed: boolean
        getValue: (selection?: { ranges: [number, number][]; direction?: 'forward' | 'backward' | 'none' }, format?: 'latex') => string
        insert: (
          value: string,
          options?: {
            insertionMode?: 'replaceSelection' | 'replaceAll' | 'insertBefore'
            selectionMode?: 'item' | 'placeholder' | 'after' | 'before'
          }
        ) => boolean
      }

      // If a range is explicitly selected, trust MathLive's own selection model
      // and replace that exact selection as an atomic term for stacking.
      if (!selectableField.selectionIsCollapsed && selectableField.selection.ranges.length > 0) {
        const selected = selectableField.getValue(selectableField.selection, 'latex') || ''
        const trimmedSelected = selected.trim()
        if (!trimmedSelected) {
          triggerKeyboardSwipeBlock('Select a valid term before creating a fraction.', sourceActionId)
          return false
        }
        const replacement = axis === 'down'
          ? `\\frac{${trimmedSelected}}{\\placeholder{}}`
          : `\\frac{\\placeholder{}}{${trimmedSelected}}`
        try {
          selectableField.insert(replacement, {
            insertionMode: 'replaceSelection',
            selectionMode: 'placeholder',
          })
          if (axis === 'down') {
            tryExecute('moveToDenominator', 'moveToNextPlaceholder')
          } else {
            tryExecute('moveToNumerator', 'moveToPreviousPlaceholder')
          }
          syncKeyboardMathfieldState(field)
          return true
        } catch {
          triggerKeyboardSwipeBlock('Select a valid term before creating a fraction.', sourceActionId)
          return false
        }
      }

      if (axis === 'down' && isEmptyFractionDenominatorPlaceholderAtPosition(currentValue, currentPosition)) {
        triggerKeyboardSwipeBlock('Enter the denominator before stacking again.', sourceActionId)
        return false
      }
      // Use the selection ref first, but recover to expression-end targeting if
      // the live caret index does not map cleanly onto a LaTeX string offset.
      const denominatorTarget = axis === 'down' && currentSelection.start === currentSelection.end
        ? findKeyboardFractionDenominatorTargetAtPosition(currentValue, currentPosition)
        : null
      if (denominatorTarget) {
        const replacement = `\\frac{${denominatorTarget.symbol}}{\\placeholder{}}`
        const nextValue = `${currentValue.slice(0, denominatorTarget.start)}${replacement}${currentValue.slice(denominatorTarget.end)}`

        field.setValue(nextValue)
        field.position = getKeyboardMathfieldModelOffsetFromLatexOffset(field, denominatorTarget.start)
        tryExecute('moveToDenominator', 'moveToNextPlaceholder')
        syncKeyboardMathfieldState(field)
        return true
      }

      const previousModelTerm = getKeyboardMathfieldPreviousModelTerm(field)
      if (previousModelTerm) {
        const replacement = axis === 'down'
          ? `\\frac{${previousModelTerm.symbol}}{\\placeholder{}}`
          : `\\frac{\\placeholder{}}{${previousModelTerm.symbol}}`
        try {
          selectableField.selection = {
            ranges: [[previousModelTerm.start, previousModelTerm.end]],
            direction: 'none',
          }
          selectableField.insert(replacement, {
            insertionMode: 'replaceSelection',
            selectionMode: 'placeholder',
          })
          if (axis === 'down') {
            tryExecute('moveToDenominator', 'moveToNextPlaceholder')
          } else {
            tryExecute('moveToNumerator', 'moveToPreviousPlaceholder')
          }
          syncKeyboardMathfieldState(field)
          return true
        } catch {}
      }

      const referenceTarget = denominatorTarget ?? resolveKeyboardSafeReferenceTarget(currentValue, currentSelection, {
        requireStructuralValidity: true,
        allowFallbackToExpressionEnd: true,
      })

      if (!referenceTarget) {
        if (axis === 'up') {
          const handled = tryExecute('moveUp', 'moveToNumerator', 'moveToPreviousPlaceholder')
          if (handled) syncKeyboardMathfieldState(field)
          return handled
        }
        const handled = tryExecute('moveDown', 'moveToDenominator', 'moveToNextPlaceholder')
        if (handled) syncKeyboardMathfieldState(field)
        return handled
      }

      const numerator = axis === 'down' ? referenceTarget.symbol : '\\placeholder{}'
      const denominator = axis === 'up' ? referenceTarget.symbol : '\\placeholder{}'
      const replacement = `\\frac{${numerator}}{${denominator}}`
      const nextValue = `${currentValue.slice(0, referenceTarget.start)}${replacement}${currentValue.slice(referenceTarget.end)}`

      field.setValue(nextValue)
      field.position = getKeyboardMathfieldModelOffsetFromLatexOffset(field, referenceTarget.start)
      if (axis === 'down') {
        tryExecute('moveToDenominator', 'moveToNextPlaceholder')
      } else {
        tryExecute('moveToNumerator', 'moveToNextPlaceholder')
      }
      syncKeyboardMathfieldState(field)
      return true
    }

    const handled = (() => {
      switch (direction) {
        case 'e':
          return moveHorizontally(1)
        case 'w':
          return moveHorizontally(-1)
        case 'ne':
          return moveToSuperscript()
        case 'se':
          return moveToSubscript()
        case 'n':
          return moveVertical('up')
        case 's':
          return moveVertical('down')
        case 'nw':
          return moveHorizontallyThenApply(-1, moveToSuperscript)
        case 'sw':
          return moveHorizontallyThenApply(-1, moveToSubscript)
        default:
          return false
      }
    })()

    if (!handled) return false
    syncKeyboardMathfieldState(field)
    closeKeyboardTransientOverlays()
    scheduleKeyboardFadeOut()
    return true
  }, [closeKeyboardTransientOverlays, getKeyboardMathfieldModelOffsetFromLatexOffset, getKeyboardMathfieldPreviousModelTerm, getKeyboardMathfieldSelectionOffsets, scheduleKeyboardFadeOut, syncKeyboardMathfieldState, triggerKeyboardSwipeBlock])

  const getKeyboardSwipeContinuationDirection = useCallback((direction: KeyboardSwipeDirection): KeyboardSwipeDirection => {
    return direction
  }, [])

  const startKeyboardSwipeHold = useCallback((pointerId: number, direction: KeyboardSwipeDirection) => {
    stopKeyboardSwipeHold()

    keyboardSwipeHoldStateRef.current = {
      pointerId,
      direction,
      active: true,
    }

    const repeat = () => {
      const state = keyboardSwipeHoldStateRef.current
      if (!state.active || state.pointerId !== pointerId || !state.direction) return

      const repeatDirection = getKeyboardSwipeContinuationDirection(state.direction)
      if (!moveKeyboardCaretBySwipe(repeatDirection)) {
        stopKeyboardSwipeHold()
        return
      }

      keyboardSwipeHoldTimeoutRef.current = setTimeout(repeat, KEYBOARD_SWIPE_HOLD_REPEAT_MS)
    }

    keyboardSwipeHoldTimeoutRef.current = setTimeout(repeat, KEYBOARD_SWIPE_HOLD_DELAY_MS)
  }, [getKeyboardSwipeContinuationDirection, moveKeyboardCaretBySwipe, stopKeyboardSwipeHold])

  const openKeyboardRadial = useCallback((target: KeyboardStageTarget, anchor: KeyboardOverlayAnchor) => {
    const currentValue = latexOutputRef.current || ''
    const referenceTarget = resolveKeyboardSafeReferenceTarget(currentValue, keyboardSelectionRef.current, {
      allowFallbackToExpressionEnd: true,
    })
    setActiveKeyboardFamilyTarget(null)
    setActiveKeyboardRadialTarget({
      ...target,
      payloadSymbol: target.payloadSymbol || target.baseSymbol,
      referenceTarget,
    })
    setKeyboardOverlayAnchor(anchor)
    scheduleKeyboardFadeOut()
  }, [scheduleKeyboardFadeOut])

  const openKeyboardFamily = useCallback((target: KeyboardStageTarget, anchor: KeyboardOverlayAnchor) => {
    setActiveKeyboardRadialTarget(null)
    setActiveKeyboardFamilyTarget(target)
    activeKeyboardFamilyTargetRef.current = target
    setKeyboardOverlayAnchor(anchor)
    scheduleKeyboardFadeOut()
  }, [scheduleKeyboardFadeOut])

  // Close the family overlay when the user taps/clicks anywhere outside it.
  // The overlay panel calls stopPropagation on pointerdown, so events from
  // inside the panel never reach the document — only outside clicks reach here.
  useEffect(() => {
    if (!activeKeyboardFamilyTarget) return
    const handleOutsidePointerDown = () => {
      setActiveKeyboardFamilyTarget(null)
      activeKeyboardFamilyTargetRef.current = null
      setKeyboardOverlayAnchor(null)
    }
    document.addEventListener('pointerdown', handleOutsidePointerDown)
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown)
  }, [activeKeyboardFamilyTarget])

  const renderKeyboardCanvasSurface = () => {
    const activeRadialTarget = activeKeyboardRadialTarget
    const classifyKeyboardSwipeDirection = (dx: number, dy: number): KeyboardSwipeDirection => {
      const angle = Math.atan2(-dy, dx)
      const normalized = angle >= 0 ? angle : angle + (Math.PI * 2)
      const sector = Math.round(normalized / (Math.PI / 4)) % 8
      const directions: KeyboardSwipeDirection[] = ['e', 'ne', 'n', 'nw', 'w', 'sw', 's', 'se']
      return directions[sector] || 'e'
    }

    const isStructuralSwipeDirection = (direction: KeyboardSwipeDirection) => (
      direction === 'n'
      || direction === 's'
      || direction === 'ne'
      || direction === 'se'
      || direction === 'nw'
      || direction === 'sw'
    )

    const isContinuousSwipeDirection = (direction: KeyboardSwipeDirection) => (
      direction === 'e' || direction === 'w'
    )

    const applyKeyboardSwipeProgress = (
      gesture: {
        pointerId: number
        direction: KeyboardSwipeDirection | null
        appliedSteps: number
      },
      dx: number,
      dy: number,
    ) => {
      const distance = Math.hypot(dx, dy)
      if (distance < KEYBOARD_SWIPE_MIN_DISTANCE_PX) return false

      if (!gesture.direction) {
        gesture.direction = classifyKeyboardSwipeDirection(dx, dy)
      }

      let totalSteps = 1
      if (isContinuousSwipeDirection(gesture.direction)) {
        totalSteps += Math.max(0, Math.floor((distance - KEYBOARD_SWIPE_MIN_DISTANCE_PX) / KEYBOARD_SWIPE_STEP_DISTANCE_PX))
      }

      if (totalSteps <= gesture.appliedSteps) return false

      for (let stepIndex = gesture.appliedSteps; stepIndex < totalSteps; stepIndex += 1) {
        const direction = stepIndex === 0
          ? gesture.direction
          : getKeyboardSwipeContinuationDirection(gesture.direction)
        const sourceActionId = (gesture as { actionId?: string }).actionId
        if (!moveKeyboardCaretBySwipe(direction, sourceActionId)) {
          gesture.appliedSteps = stepIndex + 1
          return true
        }
        gesture.appliedSteps = stepIndex + 1
      }

      return true
    }

    const renderKeyboardActionContent = (actionId: string, baseSymbol?: string) => {
      const action = KEYBOARD_ACTION_MAP[actionId]
      if (!action) return <span className="text-sm font-normal">?</span>
      if (actionId === 'uppercase') {
        return <span className="text-sm font-normal">↑</span>
      }
      if (action.token && /^[a-z]$/.test(action.token)) {
        const label = keyboardUppercase ? action.token.toUpperCase() : action.token
        return <span className="text-sm font-normal">{label}</span>
      }
      const latex = action.renderLatex?.(baseSymbol) ?? action.latex
      if (latex) {
        try {
          return <span dangerouslySetInnerHTML={{ __html: renderToString(normalizeDisplayPlaceholdersToBoxes(latex), { throwOnError: false }) }} />
        } catch {
          return <span className="text-sm font-normal">{action.title}</span>
        }
      }
      return <span className="text-sm font-normal">{action.label ?? action.title}</span>
    }

    const computeFamilyOverlayPlacement = (target: KeyboardStageTarget, anchor: KeyboardOverlayAnchor) => {
      const rootRect = keyboardSurfaceRef.current?.getBoundingClientRect()
      if (!rootRect) {
        return { left: anchor.x, top: Math.max(8, anchor.y - 18), width: undefined as number | undefined }
      }

      const horizontalMargin = 1
      const verticalMargin = 8
      const desiredWidth = Math.max(256, Math.min(680, rootRect.width - (horizontalMargin * 2)))
      const width = Math.max(220, desiredWidth)

      const estimatedHeight = 132 + (target.familyRows.length * 56)
      const maxLeft = Math.max(horizontalMargin, rootRect.width - width - horizontalMargin)
      const left = Math.min(maxLeft, Math.max(horizontalMargin, anchor.x - (width / 2)))

      const preferredTop = anchor.y - estimatedHeight - 12
      let top = preferredTop
      if (top < verticalMargin) {
        top = anchor.y + 12
      }
      const maxTop = Math.max(verticalMargin, rootRect.height - estimatedHeight - verticalMargin)
      top = Math.min(maxTop, Math.max(verticalMargin, top))

      return { left, top, width }
    }

    const renderKeyboardRadialActionContent = (actionId: string, target: KeyboardStageTarget) => {
      const action = KEYBOARD_ACTION_MAP[actionId]
      if (!action) return <span className="text-sm font-normal">?</span>
      const currentValue = latexOutputRef.current || ''
      const safeReferenceTarget = (target.referenceTarget && isKeyboardReferenceTargetCommandBoundarySafe(currentValue, target.referenceTarget))
        ? target.referenceTarget
        : resolveKeyboardSafeReferenceTarget(currentValue, keyboardSelectionRef.current, { allowFallbackToExpressionEnd: true })
      const contextual = buildKeyboardContextualRadialOperation(actionId, target.payloadSymbol || target.baseSymbol, safeReferenceTarget)
      const fallbackBaseSymbol = (target.payloadSymbol || target.baseSymbol) ?? safeReferenceTarget?.symbol
      const latex = contextual?.previewLatex || action.renderLatex?.(fallbackBaseSymbol) || action.latex
      if (latex) {
        try {
          return <span dangerouslySetInnerHTML={{ __html: renderToString(normalizeDisplayPlaceholdersToBoxes(latex), { throwOnError: false }) }} />
        } catch {
          return <span className="text-sm font-normal">{action.title}</span>
        }
      }
      return <span className="text-sm font-normal">{action.label ?? action.title}</span>
    }

    const buildAnchorFromElement = (keyId: string, element: HTMLElement): KeyboardOverlayAnchor => {
      const rootRect = keyboardSurfaceRef.current?.getBoundingClientRect()
      const elementRect = element.getBoundingClientRect()
      if (!rootRect) {
        return {
          keyId,
          x: element.offsetLeft + (element.offsetWidth / 2),
          y: element.offsetTop + (element.offsetHeight / 2),
        }
      }
      return {
        keyId,
        x: elementRect.left - rootRect.left + (elementRect.width / 2),
        y: elementRect.top - rootRect.top + (elementRect.height / 2),
      }
    }

    const buildVisibleKeyboardStageTarget = (actionId: string, representativeKeyId?: string) => {
      if (!representativeKeyId) return null
      return buildKeyboardStageTarget(representativeKeyId, actionId)
    }

    const buildDynamicClusterKeys = () => {
      const letters = recentLetters.slice(0, 5)
      const centerLetter = letters[0] || 'x'
      return {
        center: { actionId: centerLetter, representativeKeyId: 'letters' },
        left: SIMPLE_KEYBOARD_CENTER_FAMILY_KEYS.left,
        right: SIMPLE_KEYBOARD_CENTER_FAMILY_KEYS.right,
        bottom: SIMPLE_KEYBOARD_CENTER_FAMILY_KEYS.bottom,
      }
    }

    const buildCornerLetterKeys = () => {
      const letters = recentLetters.slice(1, 5)
      return {
        nw: letters[0] ? { actionId: letters[0], representativeKeyId: 'letters' } : null,
        ne: letters[1] ? { actionId: letters[1], representativeKeyId: 'letters' } : null,
        sw: letters[2] ? { actionId: letters[2], representativeKeyId: 'letters' } : null,
        se: letters[3] ? { actionId: letters[3], representativeKeyId: 'letters' } : null,
      }
    }

    const buildLowerVariableColumnKeys = () => {
      const toVisibleLetterKey = (letter: string): KeyboardVisibleKeyDefinition => ({
        actionId: letter.toLowerCase(),
        label: letter,
        insertedToken: letter,
        representativeKeyId: 'letters',
      })

      const defaults = ['x', 'y', 'f', 't']
      const seen = new Set<string>()
      const ordered = [...recentLetters, ...defaults].filter((letter): letter is string => {
        if (!letter || !/^[a-z]$/i.test(letter)) return false
        const normalized = letter.toLowerCase()
        if (seen.has(normalized)) return false
        seen.add(normalized)
        return true
      })
      return ordered.slice(0, 4).map(toVisibleLetterKey)
    }

    const buildDynamicRepresentativeKey = (representativeKeyId: string) => {
      const representative = KEYBOARD_REPRESENTATIVE_MAP[representativeKeyId]
      if (!representative) return null

      const recent = recentRepresentativeActions[representativeKeyId] || []
      const familyActionIds = representative.familyRows.flat()
      const ordered = [...recent, representative.singleTapActionId, ...familyActionIds]
      const selectedActionId = ordered.find((actionId, index) => ordered.indexOf(actionId) === index && Boolean(KEYBOARD_ACTION_MAP[actionId]))
      if (!selectedActionId) return null

      return {
        actionId: selectedActionId,
        representativeKeyId,
      } as KeyboardVisibleKeyDefinition
    }

    // Polar positioning helper for the radial symbol cluster.
    // Container is 320×320px, center at (160,160).
    // angle: degrees clockwise from East (0°=E, -90°=N, 90°=S, 180°=W).
    const clusterSpokeStyle = (angleDeg: number, radius: number, halfSize = 22): React.CSSProperties => {
      const rad = (angleDeg * Math.PI) / 180
      return {
        position: 'absolute',
        left: Math.round(160 + Math.cos(rad) * radius - halfSize),
        top: Math.round(160 + Math.sin(rad) * radius - halfSize),
        width: halfSize * 2,
        height: halfSize * 2,
        padding: 0,
      }
    }

    const renderVisibleKeyboardButton = (
      key: KeyboardVisibleKeyDefinition,
      options?: {
        className?: string
        textClassName?: string
        activeClassName?: string
        style?: React.CSSProperties
      },
    ) => {
      const action = KEYBOARD_ACTION_MAP[key.actionId]
      if (!action) return null
      const isSelected = selectedKeyboardKey === key.actionId
      const isBlocked = keyboardBlockedActionId === key.actionId
      const hasExplicitSize = options?.style?.width != null
      return (
        <button
          key={`visible-key-${key.representativeKeyId || 'action'}-${key.actionId}-${key.insertedToken || key.label || 'default'}`}
          type="button"
          data-keyboard-row="simple-core"
          data-keyboard-standard-button="true"
          data-keyboard-action={key.actionId}
          data-keyboard-representative={key.representativeKeyId || key.actionId}
          className={`inline-flex h-full w-full min-h-[2.5rem] min-w-0 select-none items-center justify-center rounded-2xl border text-slate-900 shadow-sm transition-colors sm:min-h-[2.8rem] ${hasExplicitSize ? 'p-0' : 'px-3 py-0.5 sm:px-3.5 sm:py-1'} ${options?.className || 'border-slate-300 bg-white hover:bg-slate-100'} ${isBlocked ? 'border-red-300 bg-red-50 text-red-700' : isSelected ? (options?.activeClassName || 'border-sky-300 bg-sky-100 text-sky-700') : ''}`}
          style={options?.style}
          onPointerDown={(event) => handleMountedKeyPointerDown(event, key.actionId, key.representativeKeyId)}
          onPointerMove={(event) => handleMountedKeyPointerMove(event, key.actionId)}
          onPointerUp={(event) => handleMountedKeyPointerUp(event, key.actionId, key.insertedToken)}
          onPointerCancel={handleMountedKeyPointerCancel}
          onContextMenu={(event) => event.preventDefault()}
          title={action.title}
        >
          <span className={`keyboard-symbol-font leading-none ${options?.textClassName || 'text-[1.75rem] sm:text-[1.95rem] font-normal'}`}>
            {key.label ?? renderKeyboardActionContent(key.actionId)}
          </span>
        </button>
      )
    }

    const handleMountedKeyPointerDown = (event: React.PointerEvent<HTMLButtonElement>, actionId: string, representativeKeyId?: string) => {
      event.preventDefault()
      event.stopPropagation()
      stopKeyboardSwipeHold()
      clearKeyboardRepresentativeTapTimeout()
      clearKeyboardRepresentativeLongPress()
      keyboardPendingKeyGestureRef.current = {
        actionId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        swipeMode: false,
        direction: null,
        appliedSteps: 0,
      }
      const stageTarget = buildVisibleKeyboardStageTarget(actionId, representativeKeyId)
      if (!stageTarget) return
      const anchor = buildAnchorFromElement(actionId, event.currentTarget)
      keyboardRepresentativeLongPressRef.current = {
        timer: setTimeout(() => {
          keyboardRepresentativeLongPressRef.current.triggered = true
          openKeyboardFamily(stageTarget, anchor)
        }, KEYBOARD_REPRESENTATIVE_LONG_PRESS_MS),
        keyId: actionId,
        pointerId: event.pointerId,
        triggered: false,
      }
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {}
    }

    const handleMountedKeyPointerMove = (event: React.PointerEvent<HTMLButtonElement>, actionId: string) => {
      event.stopPropagation()
      const pending = keyboardPendingKeyGestureRef.current
      if (!pending || pending.actionId !== actionId || pending.pointerId !== event.pointerId) return

      const dx = event.clientX - pending.startX
      const dy = event.clientY - pending.startY
      const distance = Math.hypot(dx, dy)

      if (!pending.swipeMode && distance >= KEYBOARD_SWIPE_DISAMBIGUATION_DISTANCE_PX) {
        pending.swipeMode = true
        clearKeyboardRepresentativeLongPress()
      }

      if (pending.swipeMode && distance >= KEYBOARD_SWIPE_MIN_DISTANCE_PX) {
        event.preventDefault()
        applyKeyboardSwipeProgress(pending, dx, dy)
        if (pending.direction && isContinuousSwipeDirection(pending.direction)) {
          startKeyboardSwipeHold(pending.pointerId, pending.direction)
        }
      }
    }

    const handleMountedKeyPointerUp = (event: React.PointerEvent<HTMLButtonElement>, actionId: string, insertedTokenOverride?: string) => {
      event.stopPropagation()
      const pending = keyboardPendingKeyGestureRef.current
      keyboardPendingKeyGestureRef.current = null
      const longPress = keyboardRepresentativeLongPressRef.current
      const wasLongPress = longPress.triggered && longPress.keyId === actionId && longPress.pointerId === event.pointerId
      clearKeyboardRepresentativeLongPress()
      stopKeyboardSwipeHold()
      if (wasLongPress) return

      if (pending && pending.actionId === actionId && pending.pointerId === event.pointerId) {
        const dx = event.clientX - pending.startX
        const dy = event.clientY - pending.startY
        if (pending.swipeMode && Math.hypot(dx, dy) >= KEYBOARD_SWIPE_MIN_DISTANCE_PX) {
          event.preventDefault()
          applyKeyboardSwipeProgress(pending, dx, dy)
          return
        }
      }

      applyKeyboardAction(actionId, undefined, insertedTokenOverride)
    }

    const handleMountedKeyPointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      keyboardPendingKeyGestureRef.current = null
      stopKeyboardSwipeHold()
      clearKeyboardRepresentativeLongPress()
    }

    const handleKeyboardSurfacePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
      stopKeyboardSwipeHold()
      closeKeyboardTransientOverlays()
      const target = event.target as HTMLElement | null
      if (target?.closest('button')) {
        keyboardSwipeGestureRef.current = null
        return
      }
      keyboardSwipeGestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: true,
        direction: null,
        appliedSteps: 0,
      }
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {}
    }

    const handleKeyboardSurfacePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
      const gesture = keyboardSwipeGestureRef.current
      if (!gesture || !gesture.active || gesture.pointerId !== event.pointerId) return
      const dx = event.clientX - gesture.startX
      const dy = event.clientY - gesture.startY
      if (Math.hypot(dx, dy) >= KEYBOARD_SWIPE_MIN_DISTANCE_PX) {
        event.preventDefault()
        applyKeyboardSwipeProgress(gesture, dx, dy)
        if (gesture.direction && isContinuousSwipeDirection(gesture.direction)) {
          startKeyboardSwipeHold(gesture.pointerId, gesture.direction)
        }
      }
    }

    const handleKeyboardSurfacePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
      const gesture = keyboardSwipeGestureRef.current
      if (!gesture || gesture.pointerId !== event.pointerId) return
      keyboardSwipeGestureRef.current = null
      stopKeyboardSwipeHold()
      const dx = event.clientX - gesture.startX
      const dy = event.clientY - gesture.startY
      if (Math.hypot(dx, dy) < KEYBOARD_SWIPE_MIN_DISTANCE_PX) return
      event.preventDefault()
      applyKeyboardSwipeProgress(gesture, dx, dy)
    }

    const lowerVariableColumnKeys = buildLowerVariableColumnKeys()
    const dynamicCalculusKey = buildDynamicRepresentativeKey('calculus') || { actionId: 'derivative', representativeKeyId: 'calculus' }
    const dynamicRelationsKey = buildDynamicRepresentativeKey('relations') || { actionId: 'equals', representativeKeyId: 'relations' }
    const dynamicGreekKey = buildDynamicRepresentativeKey('greek') || { actionId: 'theta', representativeKeyId: 'greek' }
    const dynamicTrigKey = buildDynamicRepresentativeKey('trig') || { actionId: 'sin', representativeKeyId: 'trig' }
    const dynamicLogsKey = buildDynamicRepresentativeKey('logs') || { actionId: 'log-base', representativeKeyId: 'logs' }
    const dynamicEnclosuresKey = buildDynamicRepresentativeKey('enclosures') || { actionId: 'paren', representativeKeyId: 'enclosures' }

    return (
      <div
        data-keyboard-bottom-wrapper="true"
        className="relative z-30 flex h-full min-h-0 w-full flex-col overflow-hidden bg-white select-none keyboard-symbol-font"
        style={{
          WebkitUserSelect: 'none',
          userSelect: 'none',
          touchAction: 'auto',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          boxSizing: 'border-box',
        }}
      >
        <div
          className={`flex min-h-[4rem] flex-1 border-b border-slate-200 bg-slate-50/80 px-0 py-0 ${useCompactEdgeToEdge ? '-mx-2 sm:mx-0' : ''}`}
          style={{
            touchAction: 'auto',
            WebkitUserSelect: 'text',
            userSelect: 'text',
          }}
        >
          <div
            data-keyboard-mathlive-panel="true"
            className="h-full min-h-0 w-full"
            style={{
              touchAction: 'auto',
              WebkitUserSelect: 'text',
              userSelect: 'text',
            }}
          >
            {renderKeyboardBottomPanelPreviewSurface()}
          </div>
        </div>
        <div
          ref={keyboardSurfaceRef}
          className="relative h-[21.75rem] shrink-0 overflow-hidden sm:h-[24.25rem]"
          style={{ touchAction: 'none' }}
          onPointerDown={handleKeyboardSurfacePointerDown}
          onPointerMove={handleKeyboardSurfacePointerMove}
          onPointerUp={handleKeyboardSurfacePointerEnd}
          onPointerCancel={handleKeyboardSurfacePointerEnd}
        >
        <div className={`flex h-full items-stretch justify-stretch px-0 py-0 ${useCompactEdgeToEdge ? '-mx-2 w-[calc(100%+1rem)] sm:mx-0 sm:w-full' : 'w-full'}`}>
          <div
            data-keyboard-panel="true"
            className={useCompactEdgeToEdge
              ? 'h-full w-full border-0 rounded-none bg-[linear-gradient(180deg,#20252d_0%,#171b22_100%)] p-2 shadow-none sm:p-0'
              : 'h-full w-full rounded-2xl border border-slate-900/80 bg-[linear-gradient(180deg,#20252d_0%,#171b22_100%)] p-2 shadow-[0_20px_55px_rgba(15,23,42,0.45)] sm:p-3'}
          >
            <div className="flex flex-col gap-2.5">
              <div data-keyboard-top-grid="true" className="grid grid-cols-[repeat(4,minmax(0,1fr))_1.12fr] auto-rows-[2.5rem] gap-2 sm:auto-rows-[2.8rem]">
                {renderVisibleKeyboardButton({ actionId: 'nth-root', representativeKeyId: 'radicals' }, { className: 'border-transparent bg-slate-700 text-white hover:bg-slate-600 rounded-2xl', textClassName: 'text-xs sm:text-sm font-medium' })}
                {renderVisibleKeyboardButton({ actionId: 'fraction', representativeKeyId: 'radicals' }, { className: 'border-transparent bg-slate-700 text-white hover:bg-slate-600 rounded-2xl', textClassName: 'text-sm sm:text-base font-medium' })}
                {renderVisibleKeyboardButton({ actionId: 'power2', representativeKeyId: 'radicals' }, { className: 'border-transparent bg-slate-700 text-white hover:bg-slate-600 rounded-2xl', textClassName: 'text-sm sm:text-base font-medium' })}
                {renderVisibleKeyboardButton({ actionId: 'backspace' }, { className: 'border-transparent bg-lime-500 text-white hover:bg-lime-400', textClassName: 'text-sm sm:text-base font-semibold' })}
                {renderVisibleKeyboardButton({ actionId: 'clear', label: 'AC' }, { className: 'border-transparent bg-lime-500 text-white hover:bg-lime-400', textClassName: 'text-sm sm:text-base font-semibold' })}
                {renderVisibleKeyboardButton(dynamicCalculusKey, { className: 'border-transparent bg-slate-700 text-white hover:bg-slate-600 rounded-2xl', textClassName: 'text-sm sm:text-base font-medium' })}
                {renderVisibleKeyboardButton(dynamicGreekKey, { className: 'border-transparent bg-slate-700 text-white hover:bg-slate-600 rounded-2xl', textClassName: 'text-base sm:text-lg font-medium' })}
                {renderVisibleKeyboardButton(dynamicRelationsKey, { className: 'border-transparent bg-slate-700 text-white hover:bg-slate-600 rounded-2xl', textClassName: 'text-lg sm:text-xl font-medium' })}
                {renderVisibleKeyboardButton({ actionId: 'times', label: '×', representativeKeyId: 'times-operators' }, { className: 'border-transparent bg-slate-500 text-white hover:bg-slate-400', textClassName: 'text-xl sm:text-2xl font-medium' })}
                {renderVisibleKeyboardButton({ actionId: 'divide', label: '÷', representativeKeyId: 'divide-operators' }, { className: 'border-transparent bg-slate-500 text-white hover:bg-slate-400', textClassName: 'text-xl sm:text-2xl font-medium' })}
                {renderVisibleKeyboardButton(dynamicTrigKey, { className: 'border-transparent bg-slate-700 text-white hover:bg-slate-600 rounded-2xl', textClassName: 'text-base sm:text-lg font-medium' })}
                {renderVisibleKeyboardButton(dynamicLogsKey, { className: 'border-transparent bg-slate-700 text-white hover:bg-slate-600 rounded-2xl', textClassName: 'text-xs sm:text-sm font-medium' })}
                {renderVisibleKeyboardButton(dynamicEnclosuresKey, { className: 'border-transparent bg-slate-700 text-white hover:bg-slate-600 rounded-2xl', textClassName: 'text-base sm:text-lg font-medium' })}
                {renderVisibleKeyboardButton({ actionId: 'plus', representativeKeyId: 'plus-operators' }, { className: 'border-transparent bg-slate-500 text-white hover:bg-slate-400', textClassName: 'text-xl sm:text-2xl font-medium' })}
                {renderVisibleKeyboardButton({ actionId: 'minus', representativeKeyId: 'minus-operators' }, { className: 'border-transparent bg-slate-500 text-white hover:bg-slate-400', textClassName: 'text-xl sm:text-2xl font-medium' })}
              </div>

              <div data-keyboard-bottom-grid="true" className="grid grid-cols-[repeat(4,minmax(0,1fr))_1.12fr] auto-rows-[2.5rem] gap-2 sm:auto-rows-[2.8rem]">
                {[
                  { actionId: 'digit-7', label: '7' },
                  { actionId: 'digit-8', label: '8' },
                  { actionId: 'digit-9', label: '9' },
                  lowerVariableColumnKeys[0] || { actionId: 'x', label: 'x', insertedToken: 'x', representativeKeyId: 'letters' },
                ].map((key) =>
                  renderVisibleKeyboardButton(key, {
                    className: key.actionId.startsWith('digit-') ? 'border-transparent bg-slate-200 text-slate-900 hover:bg-slate-100' : 'border-transparent bg-slate-800 text-white hover:bg-slate-700',
                    textClassName: key.actionId.startsWith('digit-') ? 'text-2xl sm:text-[2rem] font-medium' : 'text-lg sm:text-xl font-medium',
                  })
                )}
                <button
                  type="button"
                  data-enter-step-key="true"
                  className="row-span-4 inline-flex min-h-0 select-none items-center justify-center rounded-2xl border border-transparent bg-white text-slate-900 shadow-sm transition-colors hover:bg-slate-100"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    onKeyboardEnterButtonClick()
                  }}
                  title="New step"
                >
                  <span className="flex flex-col items-center justify-center gap-2 leading-none">
                    <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-slate-500">Step</span>
                    <span className="text-3xl font-medium leading-none">⏎</span>
                  </span>
                </button>

                {[
                  { actionId: 'digit-4', label: '4' },
                  { actionId: 'digit-5', label: '5' },
                  { actionId: 'digit-6', label: '6' },
                  lowerVariableColumnKeys[1] || { actionId: 'y', label: 'y', insertedToken: 'y', representativeKeyId: 'letters' },
                ].map((key) =>
                  renderVisibleKeyboardButton(key, {
                    className: key.actionId.startsWith('digit-') ? 'border-transparent bg-slate-200 text-slate-900 hover:bg-slate-100' : 'border-transparent bg-slate-800 text-white hover:bg-slate-700',
                    textClassName: key.actionId.startsWith('digit-') ? 'text-2xl sm:text-[2rem] font-medium' : 'text-lg sm:text-xl font-medium',
                  })
                )}

                {[
                  { actionId: 'digit-1', label: '1' },
                  { actionId: 'digit-2', label: '2' },
                  { actionId: 'digit-3', label: '3' },
                  lowerVariableColumnKeys[2] || { actionId: 'f', label: 'f', insertedToken: 'f', representativeKeyId: 'letters' },
                ].map((key) =>
                  renderVisibleKeyboardButton(key, {
                    className: key.actionId.startsWith('digit-') ? 'border-transparent bg-slate-200 text-slate-900 hover:bg-slate-100' : 'border-transparent bg-slate-800 text-white hover:bg-slate-700',
                    textClassName: key.actionId.startsWith('digit-') ? 'text-2xl sm:text-[2rem] font-medium' : 'text-lg sm:text-xl font-medium',
                  })
                )}

                {renderVisibleKeyboardButton({ actionId: 'digit-0', label: '0' }, { className: 'col-span-2 border-transparent bg-slate-200 text-slate-900 hover:bg-slate-100', textClassName: 'text-2xl sm:text-[2rem] font-medium' })}
                {renderVisibleKeyboardButton({ actionId: 'decimal', label: '.' }, { className: 'border-transparent bg-slate-200 text-slate-900 hover:bg-slate-100', textClassName: 'text-2xl sm:text-[2rem] font-medium' })}
                {renderVisibleKeyboardButton(lowerVariableColumnKeys[3] || { actionId: 't', label: 't', insertedToken: 't', representativeKeyId: 'letters' }, { className: 'border-transparent bg-slate-700 text-white hover:bg-slate-600', textClassName: 'text-lg sm:text-xl font-medium' })}
              </div>
            </div>
          </div>
        </div>
        {keyboardTransientWarning ? (
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-xl border border-red-200 bg-red-50/95 px-3 py-2 text-center text-[11px] font-semibold text-red-700 shadow-sm">
            {keyboardTransientWarning}
          </div>
        ) : null}
        {activeKeyboardFamilyTarget && keyboardOverlayAnchor ? (
          <div className="pointer-events-none absolute inset-0 z-40">
            {(() => {
              const overlayPlacement = computeFamilyOverlayPlacement(activeKeyboardFamilyTarget, keyboardOverlayAnchor)
              return (
            <div
              className="pointer-events-auto absolute min-w-[16rem] max-w-[min(100vw,42.5rem)] rounded-3xl border border-slate-200 bg-white/98 p-3 shadow-[0_18px_50px_rgba(15,23,42,0.2)] backdrop-blur-sm"
              style={{ left: overlayPlacement.left, top: overlayPlacement.top, width: overlayPlacement.width, maxWidth: '100vw' }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-center rounded-2xl bg-slate-950 px-4 py-2 text-white">
                <span className="text-lg font-normal leading-none">{renderKeyboardActionContent(activeKeyboardFamilyTarget.displayActionId, activeKeyboardFamilyTarget.payloadSymbol || activeKeyboardFamilyTarget.baseSymbol)}</span>
              </div>
              {activeKeyboardFamilyTarget.representativeKeyId === 'letters' ? (
                <div className="flex w-full flex-col gap-2">
                  <div className="flex w-full items-center justify-center gap-1.5">
                    {['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'].map((actionId) => {
                      const isSelected = selectedKeyboardKey === actionId
                      return (
                        <button
                          key={`qwerty-row-1-${actionId}`}
                          type="button"
                          className={`inline-flex h-10 min-w-0 flex-1 select-none items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-1.5 text-white shadow-sm transition-colors sm:h-11 sm:px-2 ${isSelected ? 'border-sky-300 bg-sky-700 text-white' : 'hover:bg-slate-700'}`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            applyKeyboardAction(actionId)
                          }}
                          title={KEYBOARD_ACTION_MAP[actionId]?.title || actionId}
                        >
                          <span className="text-[1.05rem] font-normal leading-none">{renderKeyboardActionContent(actionId, activeKeyboardFamilyTarget.payloadSymbol || activeKeyboardFamilyTarget.baseSymbol)}</span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex w-full items-center justify-center gap-1.5 px-2 sm:px-4">
                    {['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'].map((actionId) => {
                      const isSelected = selectedKeyboardKey === actionId
                      return (
                        <button
                          key={`qwerty-row-2-${actionId}`}
                          type="button"
                          className={`inline-flex h-10 min-w-0 flex-1 select-none items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-1.5 text-white shadow-sm transition-colors sm:h-11 sm:px-2 ${isSelected ? 'border-sky-300 bg-sky-700 text-white' : 'hover:bg-slate-700'}`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            applyKeyboardAction(actionId)
                          }}
                          title={KEYBOARD_ACTION_MAP[actionId]?.title || actionId}
                        >
                          <span className="text-[1.05rem] font-normal leading-none">{renderKeyboardActionContent(actionId, activeKeyboardFamilyTarget.payloadSymbol || activeKeyboardFamilyTarget.baseSymbol)}</span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex w-full items-center justify-center gap-1.5">
                    {['uppercase', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'backspace'].map((actionId) => {
                      const isSelected = selectedKeyboardKey === actionId
                      const isWide = actionId === 'uppercase' || actionId === 'backspace'
                      return (
                        <button
                          key={`qwerty-row-3-${actionId}`}
                          type="button"
                          className={`inline-flex h-10 min-w-0 ${isWide ? 'flex-[1.25]' : 'flex-1'} select-none items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-1.5 text-white shadow-sm transition-colors sm:h-11 sm:px-2 ${isSelected ? 'border-sky-300 bg-sky-700 text-white' : 'hover:bg-slate-700'}`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            applyKeyboardAction(actionId)
                          }}
                          title={KEYBOARD_ACTION_MAP[actionId]?.title || actionId}
                        >
                          <span className="text-[1.05rem] font-normal leading-none">{actionId === 'uppercase' ? '↑' : actionId === 'backspace' ? '⌫' : renderKeyboardActionContent(actionId, activeKeyboardFamilyTarget.payloadSymbol || activeKeyboardFamilyTarget.baseSymbol)}</span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex w-full items-center justify-center gap-1">
                    <button
                      type="button"
                      className="inline-flex h-10 min-w-0 flex-[1.25] cursor-default select-none items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-1.5 text-white shadow-sm sm:h-11 sm:px-2"
                      onPointerDown={(event) => event.stopPropagation()}
                      title="Symbols"
                    >
                      <span className="text-[1.05rem] font-normal leading-none">!#1</span>
                    </button>
                    {['comma', 'space', 'decimal'].map((actionId) => {
                      const isSelected = selectedKeyboardKey === actionId
                      const isSpace = actionId === 'space'
                      return (
                        <button
                          key={`qwerty-row-4-${actionId}`}
                          type="button"
                          className={`inline-flex h-10 min-w-0 ${isSpace ? 'flex-[4] px-2.5 sm:px-4' : 'flex-[1.15] px-1.5 sm:px-2'} select-none items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-white shadow-sm transition-colors sm:h-11 ${isSelected ? 'border-sky-300 bg-sky-700 text-white' : 'hover:bg-slate-700'}`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            applyKeyboardAction(actionId)
                          }}
                          title={KEYBOARD_ACTION_MAP[actionId]?.title || actionId}
                        >
                          <span className="text-[1.05rem] font-normal leading-none">{actionId === 'comma' ? ',' : actionId === 'decimal' ? '.' : ' '}</span>
                        </button>
                      )
                    })}
                    <button
                      type="button"
                      data-enter-step-key="true"
                      className="inline-flex h-10 min-w-0 flex-[1.25] select-none items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-1.5 text-white shadow-sm sm:h-11 sm:px-2 hover:bg-slate-700"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        onKeyboardEnterButtonClick()
                      }}
                      title="New step"
                    >
                      <span className="text-[1.05rem] font-normal leading-none">↵</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {activeKeyboardFamilyTarget.familyRows.map((row, rowIndex) => (
                    <div key={`${activeKeyboardFamilyTarget.id}-family-row-${rowIndex}`} className="flex flex-wrap items-center justify-center gap-2">
                      {row.map((actionId) => {
                        const action = KEYBOARD_ACTION_MAP[actionId]
                        if (!action) return null
                        const isSelected = selectedKeyboardKey === actionId
                        return (
                          <button
                            key={`${activeKeyboardFamilyTarget.id}-${actionId}`}
                            type="button"
                            className={`inline-flex min-h-0 min-w-0 select-none items-center justify-center rounded-2xl border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm transition-colors ${isSelected ? 'border-sky-300 bg-sky-100 text-sky-700' : 'hover:bg-slate-100'}`}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation()
                              applyKeyboardAction(actionId)
                            }}
                            title={action.title}
                          >
                            <span className="text-[1.05rem] font-normal leading-none">{renderKeyboardActionContent(actionId, activeKeyboardFamilyTarget.payloadSymbol || activeKeyboardFamilyTarget.baseSymbol)}</span>
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
              )
            })()}
          </div>
        ) : null}
        {activeRadialTarget && keyboardOverlayAnchor ? (
          <div className="pointer-events-none absolute inset-0 z-40">
            <div
              className="absolute h-56 w-56 -translate-x-1/2 -translate-y-1/2"
              style={{ left: keyboardOverlayAnchor.x, top: keyboardOverlayAnchor.y }}
            >
              <div className="absolute inset-0 rounded-full bg-white/96 shadow-[0_18px_50px_rgba(15,23,42,0.2)]" />
              <div className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950 text-white shadow-lg">
                {renderKeyboardActionContent(activeRadialTarget.displayActionId, activeRadialTarget.payloadSymbol || activeRadialTarget.baseSymbol)}
              </div>
              {activeRadialTarget.radialActionIds.map((actionId, index) => {
                const action = KEYBOARD_ACTION_MAP[actionId]
                if (!action) return null
                const position = KEYBOARD_RADIAL_POSITIONS[index]
                if (!position) return null
                const isSelected = selectedKeyboardKey === actionId
                return (
                  <button
                    key={`${activeRadialTarget.id}-${actionId}`}
                    type="button"
                    className={`pointer-events-auto absolute flex h-12 w-12 select-none items-center justify-center rounded-full bg-white text-slate-900 shadow-md transition-all ${position.className} ${isSelected ? 'bg-sky-100 text-sky-700' : 'hover:bg-slate-100'}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      applyKeyboardRadialAction(actionId, activeRadialTarget)
                    }}
                    title={action.title}
                  >
                    <span className="text-[0.78rem] leading-none">{renderKeyboardRadialActionContent(actionId, activeRadialTarget)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}
        </div>
      </div>
    )
  }

  const handleConvert = () => {
    if (canvasModeRef.current === 'raw-ink') return
    if (!editorInstanceRef.current) return
    if (lockedOutRef.current) return
    if (recognitionEngineRef.current === 'keyboard') {
      const currentLatex = latexOutputRef.current || ''
      setLatexOutput(currentLatex)
      if (useAdminStepComposer && hasControllerRights()) {
        setAdminDraftLatex(normalizeStepLatex(currentLatex))
      }
      return
    }
    if (recognitionEngineRef.current === 'mathpix') {
      setIsConverting(true)
      const symbols = extractEditorSymbols()
      requestMathpixLatex(symbols)
        .then(latex => {
          setLatexOutput(latex)
          if (useAdminStepComposer && hasControllerRights()) {
            setAdminDraftLatex(normalizeStepLatex(latex))
          }
        })
        .finally(() => {
          setIsConverting(false)
        })
      return
    }

    setIsConverting(true)
    void runIinkActionSafely(() => editorInstanceRef.current!.convert())
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

  const syncRawInkUiState = useCallback((strokes: RawInkStroke[], activeCount: number) => {
    setCanUndo(strokes.length > 0)
    setCanRedo(rawInkRedoStackRef.current.length > 0)
    setCanClear(strokes.length > 0 || activeCount > 0)
  }, [])

  useEffect(() => {
    if (canvasMode !== 'raw-ink') return
    syncRawInkUiState(rawInkStrokes, rawInkActivePreview.length)
  }, [canvasMode, rawInkActivePreview.length, rawInkStrokes, syncRawInkUiState])

  const eraseRawInkAtPoint = useCallback((point: RawInkPoint) => {
    const radiusSq = RAW_INK_ERASER_RADIUS * RAW_INK_ERASER_RADIUS
    const current = rawInkStrokesRef.current
    if (!current.length) return false

    const next = current.filter((stroke) => {
      const points = Array.isArray(stroke.points) ? stroke.points : []
      if (!points.length) return false
      if (points.length === 1) {
        const dx = point.x - points[0].x
        const dy = point.y - points[0].y
        return (dx * dx + dy * dy) > radiusSq
      }
      for (let index = 1; index < points.length; index += 1) {
        if (pointToSegmentDistanceSquared(point, points[index - 1], points[index]) <= radiusSq) {
          return false
        }
      }
      return true
    })

    if (next.length === current.length) return false
    rawInkRedoStackRef.current = []
    setRawInkStrokes(cloneRawInkStrokes(next))
    lastSymbolCountRef.current = next.length
    lastBroadcastBaseCountRef.current = next.length
    syncRawInkUiState(next, rawInkActiveStrokesRef.current.size)
    return true
  }, [syncRawInkUiState])

  useEffect(() => {
    if (canvasMode !== 'raw-ink') return

    const host = editorHostRef.current
    if (!host) return

    const normalizePoint = (evt: PointerEvent): RawInkPoint | null => {
      const rect = host.getBoundingClientRect()
      if (!rect.width || !rect.height) return null
      const x = (evt.clientX - rect.left) / rect.width
      const y = (evt.clientY - rect.top) / rect.height
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      return {
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
      }
    }

    const publishRawInkSnapshot = (immediate = false) => {
      if (pageIndexRef.current !== sharedPageIndexRef.current) return
      broadcastSnapshot(immediate, { force: true, reason: rawInkStrokesRef.current.length ? 'update' : 'clear' })
    }

    const queueRawInkPublish = () => {
      if (rawInkBroadcastTimerRef.current) return
      rawInkBroadcastTimerRef.current = setTimeout(() => {
        rawInkBroadcastTimerRef.current = null
        publishRawInkSnapshot(false)
      }, getBroadcastDebounce())
    }

    const cancelActiveRawStroke = () => {
      rawInkActiveStrokesRef.current.clear()
      rawInkTouchPointerIdsRef.current.clear()
      setRawInkActivePreview([])
      syncRawInkUiState(rawInkStrokesRef.current, 0)
    }

    const handlePointerDown = (evt: PointerEvent) => {
      if (!hasBoardWriteRights()) return
      if (lockedOutRef.current) return
      if (uiMode === 'overlay' && overlayControlsVisible) return

      const point = normalizePoint(evt)
      if (!point) return

      if (evt.pointerType === 'touch') {
        if (rawInkTouchPointerIdsRef.current.size > 0) {
          cancelActiveRawStroke()
          return
        }
        rawInkTouchPointerIdsRef.current.add(evt.pointerId)
      }

      if (isEraserModeRef.current) {
        rawInkEraserPointerIdsRef.current.add(evt.pointerId)
        if (eraseRawInkAtPoint(point)) {
          cacheModeSnapshotForPage(pageIndexRef.current, makeRawInkSnapshot(rawInkStrokesRef.current, localVersionRef.current, `${clientIdRef.current}-${Date.now()}-raw-erase`))
          publishRawInkSnapshot(false)
        }
        return
      }

      rawInkRedoStackRef.current = []
      const stroke: RawInkStroke = {
        id: `${clientIdRef.current}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        color: RAW_INK_STROKE_COLOR,
        width: RAW_INK_STROKE_WIDTH,
        points: [point],
      }
      rawInkActiveStrokesRef.current.set(evt.pointerId, stroke)
      setRawInkActivePreview(Array.from(rawInkActiveStrokesRef.current.values()).map((item) => ({ ...item, points: [...item.points] })))
      syncRawInkUiState(rawInkStrokesRef.current, rawInkActiveStrokesRef.current.size)
      try {
        host.setPointerCapture(evt.pointerId)
      } catch {}
    }

    const handlePointerMove = (evt: PointerEvent) => {
      if (rawInkEraserPointerIdsRef.current.has(evt.pointerId)) {
        const point = normalizePoint(evt)
        if (!point) return
        if (eraseRawInkAtPoint(point)) {
          cacheModeSnapshotForPage(pageIndexRef.current, makeRawInkSnapshot(rawInkStrokesRef.current, localVersionRef.current, `${clientIdRef.current}-${Date.now()}-raw-erase`))
          queueRawInkPublish()
        }
        return
      }

      const stroke = rawInkActiveStrokesRef.current.get(evt.pointerId)
      if (!stroke) return
      const point = normalizePoint(evt)
      if (!point) return
      const lastPoint = stroke.points[stroke.points.length - 1]
      if (lastPoint && Math.abs(lastPoint.x - point.x) < 0.0008 && Math.abs(lastPoint.y - point.y) < 0.0008) return
      stroke.points = [...stroke.points, point]
      rawInkActiveStrokesRef.current.set(evt.pointerId, stroke)
      setRawInkActivePreview(Array.from(rawInkActiveStrokesRef.current.values()).map((item) => ({ ...item, points: [...item.points] })))
      syncRawInkUiState(rawInkStrokesRef.current, rawInkActiveStrokesRef.current.size)
      queueRawInkPublish()
    }

    const handlePointerDone = (evt: PointerEvent) => {
      if (evt.pointerType === 'touch') {
        rawInkTouchPointerIdsRef.current.delete(evt.pointerId)
      }

      if (rawInkEraserPointerIdsRef.current.delete(evt.pointerId)) {
        syncRawInkUiState(rawInkStrokesRef.current, rawInkActiveStrokesRef.current.size)
        return
      }

      const stroke = rawInkActiveStrokesRef.current.get(evt.pointerId)
      if (!stroke) return
      rawInkActiveStrokesRef.current.delete(evt.pointerId)
      if (stroke.points.length > 0) {
        const next = [...rawInkStrokesRef.current, { ...stroke, points: [...stroke.points] }]
        setRawInkStrokes(cloneRawInkStrokes(next))
        lastSymbolCountRef.current = next.length
        lastBroadcastBaseCountRef.current = next.length
        cacheModeSnapshotForPage(pageIndexRef.current, buildRawInkSnapshot(false, false))
        syncRawInkUiState(next, rawInkActiveStrokesRef.current.size)
      }
      setRawInkActivePreview(Array.from(rawInkActiveStrokesRef.current.values()).map((item) => ({ ...item, points: [...item.points] })))
      publishRawInkSnapshot(true)
      try {
        host.releasePointerCapture(evt.pointerId)
      } catch {}
    }

    host.addEventListener('pointerdown', handlePointerDown)
    host.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerDone)
    window.addEventListener('pointercancel', handlePointerDone)

    return () => {
      host.removeEventListener('pointerdown', handlePointerDown)
      host.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerDone)
      window.removeEventListener('pointercancel', handlePointerDone)
      if (rawInkBroadcastTimerRef.current) {
        clearTimeout(rawInkBroadcastTimerRef.current)
        rawInkBroadcastTimerRef.current = null
      }
    }
  }, [broadcastSnapshot, buildRawInkSnapshot, cacheModeSnapshotForPage, canvasMode, eraseRawInkAtPoint, hasBoardWriteRights, lockedOutRef, overlayControlsVisible, syncRawInkUiState, uiMode])

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

  const forcePublishCanvas = async (targetClientId?: string, opts?: { shareIndex?: number; snapshot?: SnapshotPayload | null; allowEmpty?: boolean }) => {
    if (!canPublishSnapshots()) return
    const channel = channelRef.current
    if (!channel) return
    const shareIndex = (typeof opts?.shareIndex === 'number' && Number.isFinite(opts.shareIndex)) ? Math.max(0, Math.trunc(opts.shareIndex)) : pageIndex
    const snapshot = cloneSnapshotPayload(opts?.snapshot ?? captureFullSnapshot())
    if (!snapshot || (isSnapshotEmpty(snapshot) && !opts?.allowEmpty)) {
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
      cacheModeSnapshotForPage(shareIndex, snapshot)
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

  const applyCanvasModeForCurrentPage = useCallback(async (_nextMode: CanvasMode) => {
    const currentPage = pageIndexRef.current
    const currentSnapshot = captureFullSnapshot()
    cacheModeSnapshotForPage(currentPage, currentSnapshot && !isSnapshotEmpty(currentSnapshot) ? currentSnapshot : null)
    setMobileLatexTrayOpen(false)
    setMobileModulePicker(null)
    setTopPanelEditingMode(false)
    clearTopPanelSelection()

    const nextMode: CanvasMode = 'math'
    const cached = getCachedModeSnapshotForPage(currentPage, nextMode)
    const targetSnapshot = cached || {
      mode: 'math',
      symbols: null,
      rawInk: null,
      latex: '',
      jiix: null,
      version: localVersionRef.current,
      snapshotId: `${clientIdRef.current}-${Date.now()}-math-mode`,
      baseSymbolCount: -1,
    }

    await applyPageSnapshot(targetSnapshot)
    latestSnapshotRef.current = { snapshot: cloneSnapshotPayload(targetSnapshot)!, ts: Date.now(), reason: 'update' }

    if (pageIndexRef.current === sharedPageIndexRef.current && canPublishSnapshots()) {
      await forcePublishCanvas(undefined, { shareIndex: currentPage, snapshot: targetSnapshot, allowEmpty: true })
    }
  }, [applyPageSnapshot, cacheModeSnapshotForPage, canPublishSnapshots, captureFullSnapshot, clearTopPanelSelection, forcePublishCanvas, getCachedModeSnapshotForPage])

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
      if (canOrchestrateLesson && isFullscreen && next !== 'landscape') {
        return
      }
      setCanvasOrientation(curr => (curr === next ? curr : next))
      if (canOrchestrateLesson && !isFullscreen) {
        adminOrientationPreferenceRef.current = next
      }
    },
    [canOrchestrateLesson, isFullscreen]
  )

  const toggleFullscreen = () => {
    const next = !isFullscreen
    setIsFullscreen(next)
    if (canOrchestrateLesson) {
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
  const isRawInkMode = false
  const shouldCollapseStackedView = Boolean(
    useStackedStudentLayout
    && !canOrchestrateLesson
    && isViewOnly
    && recognitionEngine !== 'keyboard'
    && !isRawInkMode
    && !forceEditableForAssignment
    && !(isSessionQuizMode && quizActive && !canOrchestrateLesson)
  )
  const isStudentSendContext = (!canOrchestrateLesson || isAssignmentSolutionAuthoring) && (quizActive || isAssignmentView)
  const canUseAdminSend = canOrchestrateLesson || hasWriteAccess
  const canUsePresenterMiddleStripTools = canOrchestrateLesson || isSelfActivePresenter()
  const shouldShowMiddleStripActionCluster = canUsePresenterMiddleStripTools || isStudentSendContext
  const areMiddleStripEditorActionsReady = recognitionEngine === 'keyboard' || status === 'ready'
  const canUseTeacherKeyboardLocalToolbarActions = recognitionEngine === 'keyboard' && canOrchestrateLesson
  const canUseTeacherKeyboardTopPanelComposerUi = hasWriteAccess || canUseTeacherKeyboardLocalToolbarActions
  const canUseKeyboardTextRecallMode = recognitionEngine === 'keyboard' && (useAdminStepComposer || useStudentStepComposer)
  const canUseKeyboardSendAction = recognitionEngine === 'keyboard'
    ? Boolean(normalizeStepLatex(latexOutput || adminDraftLatex || '')) || keyboardSteps.length > 0
    : Boolean(adminDraftLatex) || canClear || adminSteps.length > 0

  useEffect(() => {
    if (canvasMode !== 'raw-ink') return
    setCanvasMode('math')
  }, [canvasMode])

  useEffect(() => {
    if (isViewOnly) {
      setIsEraserMode(false)
    }
  }, [isViewOnly])

  useEffect(() => {
    if (!useStackedStudentLayout) return
    const next = recognitionEngine === 'keyboard'
      ? KEYBOARD_STACKED_SPLIT_RATIO
      : (viewOnlyMode ? VIEW_ONLY_SPLIT_RATIO : EDITABLE_SPLIT_RATIO)
    const clamped = clampStudentSplitRatio(next)
    setStudentSplitRatio(clamped)
    studentSplitRatioRef.current = clamped
  }, [EDITABLE_SPLIT_RATIO, KEYBOARD_STACKED_SPLIT_RATIO, VIEW_ONLY_SPLIT_RATIO, clampStudentSplitRatio, recognitionEngine, useStackedStudentLayout, viewOnlyMode])

  useEffect(() => {
    if (canOrchestrateLesson) return
    if (!isSessionQuizMode) return
    updateControlState(controlStateRef.current ?? null)
  }, [canOrchestrateLesson, isSessionQuizMode, quizActive, updateControlState])

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
    : (!canOrchestrateLesson && quizActive && !isAssignmentView && useStackedStudentLayout)
      ? { ...stackedNotesState.options, alignAtEquals: true }
    : (!canOrchestrateLesson && isAssignmentView && useStackedStudentLayout)
      ? { ...stackedNotesState.options, alignAtEquals: true }
      : hasWriteAccess
        ? latexProjectionOptions
        : useStackedStudentLayout
          ? stackedNotesState.options
          : latexDisplayState.options
  const latexRenderSource = useMemo(() => {
    if (useAdminStepComposer) {
      if (recognitionEngine === 'keyboard') {
        const lines = keyboardSteps.map(step => normalizeStepLatex(step?.latex || ''))
        const draft = normalizeStepLatex(latexOutput || '')
        if (keyboardEditIndex !== null) {
          if (draft) {
            lines[keyboardEditIndex] = draft
          }
        } else if (draft) {
          lines.push(draft)
        }
        const composed = lines.filter(Boolean).join(' \\\\ ').trim()
        return composed || (latexDisplayState.latex || '').trim()
      }
      const lines = adminSteps.map(s => s.latex)
      if (adminEditIndex !== null) {
        if (adminDraftLatex) {
          lines[adminEditIndex] = adminDraftLatex
        }
      } else if (adminDraftLatex) {
        lines.push(adminDraftLatex)
      }
      const composed = lines.filter(Boolean).join(' \\\\ ').trim()
      // In stacked (composer) mode, live recognition lands in latexOutput before anything is
      // explicitly promoted into the saved display state. Fall back through both sources so the
      // top panel reflects recognized ink immediately.
      return composed || (latexDisplayState.latex || latexOutput || '').trim()
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
    if (!canOrchestrateLesson && quizActive && !isAssignmentView && useStackedStudentLayout) {
      const committed = (studentCommittedLatex || '').trim()
      const live = (latexOutput || '').trim()
      return [committed, live].filter(Boolean).join(' \\\\ ').trim()
    }
    if (!canOrchestrateLesson && isAssignmentView && useStackedStudentLayout) {
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
  }, [adminDraftLatex, adminEditIndex, adminSteps, hasWriteAccess, canOrchestrateLesson, isAssignmentView, keyboardEditIndex, keyboardSteps, latexDisplayState.latex, latexOutput, normalizeStepLatex, quizActive, recognitionEngine, stackedNotesState.latex, studentCommittedLatex, studentEditIndex, studentSteps, useAdminStepComposer, useStackedStudentLayout, useStudentStepComposer])

  useEffect(() => {
    latexRenderSourceRef.current = latexRenderSource || ''
  }, [latexRenderSource])

  useEffect(() => {
    if (typeof onComposedLatexChange !== 'function') return
    onComposedLatexChange(latexRenderSource)
  }, [latexRenderSource, onComposedLatexChange])

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
    const hasSteps = useAdminStepComposer && (recognitionEngine === 'keyboard' ? keyboardSteps.length > 0 : adminSteps.length > 0)
    if (hasInk || hasSteps) {
      // Keep current stable preview.
      return
    }

    if (stableAdminStackedLatexRenderSourceRef.current) {
      stableAdminStackedLatexRenderSourceRef.current = ''
      setStableAdminStackedLatexRenderSource('')
    }
  }, [adminSteps.length, keyboardSteps.length, latexRenderSource, recognitionEngine, useAdminStepComposer, useStackedStudentLayout])

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

    let latexString = normalizeDisplayPlaceholdersToBoxes(raw)
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

  useEffect(() => {
    setDebugTopPanelSource((topPanelPayload.latex || '').trim() || null)
    setDebugTopPanelHasMarkup(Boolean(topPanelRenderPayload.markup))
  }, [topPanelPayload.latex, topPanelRenderPayload.markup])

  const adminTopPanelStepItems = useMemo(() => {
    if (!useAdminStepComposer) return [] as TopPanelStepItem[]
    if (!topPanelEditingMode) return [] as TopPanelStepItem[]
    if (recognitionEngine === 'keyboard') {
      return keyboardSteps.map((s, index) => {
        const latex = (keyboardEditIndex === index ? (latexOutput || '') : (s?.latex || '')).trimEnd()
        return { index, latex, isEditing: keyboardEditIndex === index }
      })
    }
    return adminSteps.map((s, index) => {
      const latex = (adminEditIndex === index ? adminDraftLatex : (s?.latex || '')).trimEnd()
      return { index, latex, isEditing: adminEditIndex === index }
    })
  }, [adminDraftLatex, adminEditIndex, adminSteps, keyboardEditIndex, keyboardSteps, latexOutput, recognitionEngine, topPanelEditingMode, useAdminStepComposer])

  const studentTopPanelStepItems = useMemo(() => {
    if (!useStudentStepComposer) return [] as TopPanelStepItem[]
    const sourceSteps = studentSteps.length ? studentSteps : derivedStudentCommittedSteps
    const shouldShowCommittedKeyboardSteps = recognitionEngine === 'keyboard' && sourceSteps.length > 0
    if (!topPanelEditingMode && !shouldShowCommittedKeyboardSteps) return [] as TopPanelStepItem[]
    return sourceSteps.map((s, index) => {
      const latex = (studentEditIndex === index ? (latexOutput || '') : (s?.latex || '')).trimEnd()
      return { index, latex, isEditing: studentEditIndex === index }
    })
  }, [derivedStudentCommittedSteps, latexOutput, recognitionEngine, studentEditIndex, studentSteps, topPanelEditingMode, useStudentStepComposer])

  const topPanelStepsPayload: TopPanelStepsPayload | null = useMemo(() => {
    if (useAdminStepComposer) {
      if (!topPanelEditingMode) return null
      return {
        steps: adminTopPanelStepItems,
        selectedIndex: topPanelSelectedStep,
        editingIndex: recognitionEngine === 'keyboard' ? keyboardEditIndex : adminEditIndex,
        options: topPanelPayload.options,
      }
    }
    if (useStudentStepComposer) {
      if (!topPanelEditingMode && !(recognitionEngine === 'keyboard' && studentTopPanelStepItems.length > 0)) return null
      return {
        steps: studentTopPanelStepItems,
        selectedIndex: topPanelSelectedStep,
        editingIndex: studentEditIndex,
        options: topPanelPayload.options,
      }
    }
    return null
  }, [adminEditIndex, adminTopPanelStepItems, keyboardEditIndex, recognitionEngine, studentEditIndex, studentTopPanelStepItems, topPanelEditingMode, topPanelPayload.options, topPanelSelectedStep, useAdminStepComposer, useStudentStepComposer])

  const activeComposerEditIndex = useMemo(() => {
    if (useAdminStepComposer) return recognitionEngine === 'keyboard' ? keyboardEditIndex : adminEditIndex
    if (useStudentStepComposer) return studentEditIndex
    return null
  }, [adminEditIndex, keyboardEditIndex, recognitionEngine, studentEditIndex, useAdminStepComposer, useStudentStepComposer])

  const isEditingExistingTopPanelStep = activeComposerEditIndex !== null && activeComposerEditIndex >= 0

  const normalizeLoadedStepIndex = useCallback((value: unknown, stepsLength: number) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    const index = Math.trunc(value)
    if (index < 0 || index >= stepsLength) return null
    return index
  }, [])

  const renderLatexStepInline = useCallback((latex: string) => {
    if (!latex) return ''
    try {
      return renderToString(normalizeDisplayPlaceholdersToBoxes(latex), { throwOnError: false, displayMode: false })
    } catch {
      return ''
    }
  }, [])

  const keyboardTopPanelExpression = useMemo(() => {
    const editableValue = useAdminStepComposer ? adminDraftLatex : latexOutput
    return normalizeStepLatex(editableValue || '')
  }, [adminDraftLatex, latexOutput, normalizeStepLatex, useAdminStepComposer])

  const keyboardDisplayLatex = useMemo(() => {
    const source = keyboardTopPanelExpression || ''
    if (!source.trim()) return ''

    const normalized = source
      .replace(/≤/g, ' \\leq ')
      .replace(/≥/g, ' \\geq ')
      .replace(/≠/g, ' \\neq ')
      .replace(/≈/g, ' \\approx ')
      .replace(/→/g, ' \\to ')
      .replace(/×/g, ' \\times ')
      .replace(/÷/g, ' \\div ')
      .replace(/π/g, ' \\pi ')
      .replace(/θ/g, ' \\theta ')
      .replace(/∞/g, ' \\infty ')
      .replace(/([A-Za-z0-9)])\^\[([^\]]+)\]/g, '$1^{$2}')
      .replace(/([A-Za-z0-9)])_\[([^\]]+)\]/g, '$1_{$2}')
      .replace(/([A-Za-z0-9)])\^([A-Za-z0-9]+)/g, '$1^{$2}')
      .replace(/([A-Za-z0-9)])_([A-Za-z0-9]+)/g, '$1_{$2}')
      .replace(/sqrt\(([^()]*)\)/g, '\\sqrt{$1}')
      .replace(/cbrt\(([^()]*)\)/g, '\\sqrt[3]{$1}')
      .replace(/root\(([^,]+),\s*([^()]+)\)/g, '\\sqrt[$2]{$1}')
      .replace(/sin\(([^()]*)\)/g, '\\sin\\left($1\\right)')
      .replace(/cos\(([^()]*)\)/g, '\\cos\\left($1\\right)')
      .replace(/tan\(([^()]*)\)/g, '\\tan\\left($1\\right)')
      .replace(/ln\(([^()]*)\)/g, '\\ln\\left($1\\right)')
      .replace(/log\(([^()]*)\)/g, '\\log\\left($1\\right)')
      .replace(/d\/dx\(([^()]*)\)/g, '\\frac{d}{dx}\\left($1\\right)')
      .replace(/d\^2\/dx\^2\(([^()]*)\)/g, '\\frac{d^{2}}{dx^{2}}\\left($1\\right)')
      .replace(/∫\s*([^∫]+?)\s*dx/g, '\\int $1\\,dx')
      .replace(/\(\s*([^()]+?)\s*\)\s*\/\s*\(\s*([^()]*?)\s*\)/g, '\\frac{$1}{$2}')
      .replace(/\s+/g, ' ')
      .trim()

    return normalizeDisplayPlaceholdersToBoxes(normalized)
  }, [keyboardTopPanelExpression])

  const keyboardTypesetPreviewMarkup = useMemo(() => {
    if (!keyboardDisplayLatex) return ''
    try {
      return renderToString(keyboardDisplayLatex, { throwOnError: false, displayMode: false })
    } catch (err) {
      console.warn('Failed to render keyboard preview LaTeX', err)
      return ''
    }
  }, [keyboardDisplayLatex])

  const handleKeyboardExpressionSelectionChange = useCallback(() => {
    const input = keyboardExpressionSurfaceRef.current
    if (!input) return
    const start = input.selectionStart ?? 0
    const end = input.selectionEnd ?? start
    setKeyboardSelectionState({ start, end })
    scheduleKeyboardFadeOut()
  }, [scheduleKeyboardFadeOut, setKeyboardSelectionState])

  const handleKeyboardExpressionInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value
    const nextSelectionStart = event.target.selectionStart ?? nextValue.length
    const nextSelectionEnd = event.target.selectionEnd ?? nextSelectionStart

    setLatexOutput(nextValue)
    latexOutputRef.current = nextValue
    if (useAdminStepComposerRef.current && hasControllerRights()) {
      setAdminDraftLatex(normalizeStepLatex(nextValue))
    }

    const nextSelection = { start: nextSelectionStart, end: nextSelectionEnd }
    setKeyboardSelectionState(nextSelection)
    closeKeyboardTransientOverlays()
    scheduleKeyboardFadeOut()
  }, [closeKeyboardTransientOverlays, hasControllerRights, normalizeStepLatex, scheduleKeyboardFadeOut, setKeyboardSelectionState])

  useEffect(() => {
    const input = keyboardExpressionSurfaceRef.current
    if (!input) return
    const nextStart = Math.max(0, Math.min(keyboardTopPanelExpression.length, keyboardSelection.start))
    const nextEnd = Math.max(nextStart, Math.min(keyboardTopPanelExpression.length, keyboardSelection.end))
    try {
      input.setSelectionRange(nextStart, nextEnd)
    } catch {
      // Ignore selection sync failures on unsupported platforms.
    }
  }, [keyboardSelection.end, keyboardSelection.start, keyboardTopPanelExpression])

  const estimateKeyboardCaretFromTap = useCallback((value: string, clientX: number, clientY: number, rect: DOMRect, slotRefs?: Array<HTMLSpanElement | null>) => {
    const symbols = Array.from(value || '')
    if (!symbols.length) return 0
    const slotRects = slotRefs
      ?.map((element) => element?.getBoundingClientRect() || null)
      .filter((entry): entry is DOMRect => Boolean(entry))
    if (slotRects && slotRects.length) {
      const boundaryPositions = [
        { x: slotRects[0].left, y: slotRects[0].top + (slotRects[0].height / 2) },
        ...slotRects.map((entry) => ({ x: entry.right, y: entry.top + (entry.height / 2) })),
      ]
      let bestIndex = 0
      let bestDistanceSq = Number.POSITIVE_INFINITY
      boundaryPositions.forEach((position, index) => {
        const dx = clientX - position.x
        const dy = clientY - position.y
        const distanceSq = (dx * dx) + (dy * dy)
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq
          bestIndex = index
        }
      })
      return Math.max(0, Math.min(symbols.length, bestIndex))
    }
    const relativeX = clientX - rect.left
    const ratio = rect.width > 0 ? Math.max(0, Math.min(1, relativeX / rect.width)) : 1
    return Math.max(0, Math.min(symbols.length, Math.round(symbols.length * ratio)))
  }, [])

  const focusKeyboardExpressionAtTap = useCallback((
    clientX: number,
    clientY: number,
    fallbackRect: DOMRect,
    typesetPreviewRef?: { current: HTMLDivElement | null },
    slotRefs?: { current: Array<HTMLSpanElement | null> },
  ) => {
    setOverlayChromePeekVisible(false)
    setTopPanelEditingMode(false)
    clearTopPanelSelection()
    setMobileTopPanelActionStepIndex(null)

    const mathfield = keyboardMathfieldRef.current
    if (mathfield) {
      const nextOffset = mathfield.getOffsetFromPoint(clientX, clientY, { bias: 0 })
      mathfield.focus()
      mathfield.position = nextOffset
      setKeyboardSelectionState({ start: nextOffset, end: nextOffset })
      scheduleKeyboardFadeOut()
      return
    }

    const measuredRect = typesetPreviewRef?.current?.getBoundingClientRect()
    const effectiveRect = measuredRect && measuredRect.width > 0 ? measuredRect : fallbackRect
    const caret = estimateKeyboardCaretFromTap(keyboardTopPanelExpression, clientX, clientY, effectiveRect, slotRefs?.current)
    setKeyboardSelectionState({ start: caret, end: caret })
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        const input = keyboardExpressionSurfaceRef.current
        if (!input) return
        input.focus()
        try {
          input.setSelectionRange(caret, caret)
        } catch {
          // Ignore selection placement failures on unsupported platforms.
        }
      }, 0)
    }
    scheduleKeyboardFadeOut()
  }, [clearTopPanelSelection, estimateKeyboardCaretFromTap, keyboardTopPanelExpression, scheduleKeyboardFadeOut, setKeyboardSelectionState])

  const syncKeyboardDraftLatex = useCallback((nextLatex: string) => {
    setLatexOutput(nextLatex)
    latexOutputRef.current = nextLatex
    if (useAdminStepComposerRef.current && hasControllerRights()) {
      setAdminDraftLatex(normalizeStepLatex(nextLatex))
    }
  }, [hasControllerRights, normalizeStepLatex])

  const startNewKeyboardStepDraft = useCallback(() => {
    setKeyboardEditIndex(null)
    syncKeyboardDraftLatex('')
    clearTopPanelSelection()
    setKeyboardSelectionState({ start: 0, end: 0 })
  }, [clearTopPanelSelection, setKeyboardSelectionState, syncKeyboardDraftLatex])

  const loadKeyboardStepForEditing = useCallback((index: number) => {
    if (index < 0 || index >= keyboardSteps.length) return
    const step = keyboardSteps[index]
    const nextLatex = step?.latex || ''
    setTopPanelSelectedStep(index)
    setKeyboardEditIndex(index)
    syncKeyboardDraftLatex(nextLatex)
    const caret = nextLatex.length
    setKeyboardSelectionState({ start: caret, end: caret })
  }, [keyboardSteps, setKeyboardSelectionState, syncKeyboardDraftLatex])

  const onKeyboardEnterButtonClick = useCallback(() => {
    const rawStep = `${latexOutputRef.current || ''}`
    const normalized = normalizeStepLatex(rawStep)
    if (!normalized) return

    const now = Date.now()
    setKeyboardSteps(prev => {
      const nextRecord: NotebookStepRecord = {
        latex: normalized,
        symbols: [],
        jiix: null,
        createdAt: keyboardEditIndex !== null && prev[keyboardEditIndex]?.createdAt != null
          ? prev[keyboardEditIndex].createdAt
          : now,
        updatedAt: now,
      }

      if (keyboardEditIndex !== null && keyboardEditIndex >= 0 && keyboardEditIndex < prev.length) {
        const next = [...prev]
        next[keyboardEditIndex] = {
          ...prev[keyboardEditIndex],
          ...nextRecord,
        }
        return next
      }

      return [...prev, nextRecord]
    })

    setKeyboardEditIndex(null)
    syncKeyboardDraftLatex('')
    clearTopPanelSelection()
    setKeyboardSelectionState({ start: 0, end: 0 })
  }, [clearTopPanelSelection, keyboardEditIndex, normalizeStepLatex, setKeyboardSelectionState, syncKeyboardDraftLatex])

  const renderKeyboardTypesetEditorSurface = useCallback((
    compact = false,
    attachFocusRef = false,
  ) => {
    if (attachFocusRef) {
      return (
        <div className="h-full w-full">
          <div
            ref={setKeyboardMathfieldViewportNodeRef}
            className={`relative h-full w-full overflow-auto bg-white ${useCompactEdgeToEdge ? 'rounded-none border-0' : 'rounded-[10px] border border-slate-200'} ${compact ? 'min-h-[2.75rem]' : 'min-h-[4.5rem]'}`}
            style={{
              WebkitOverflowScrolling: 'touch',
              overscrollBehavior: 'contain',
              touchAction: 'none',
            }}
          >
            <div
              ref={setKeyboardMathfieldZoomSurfaceNodeRef}
              className={`relative inline-block min-h-full min-w-full ${compact ? 'min-h-[2.75rem]' : 'min-h-[4.5rem]'}`}
              style={{
                zoom: 1,
                transformOrigin: 'top left',
                width: 'max-content',
                minWidth: '100%',
              }}
            >
              <div
                ref={setKeyboardMathfieldHostNodeRef}
                className={`overflow-visible bg-white ${compact ? 'min-h-[2.75rem]' : 'min-h-[4.5rem]'}`}
                style={{
                  touchAction: 'none',
                  WebkitUserSelect: 'text',
                  userSelect: 'text',
                  width: 'max-content',
                  minWidth: '100%',
                  minHeight: '100%',
                }}
              />
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className={`relative flex h-full w-full items-center justify-center overflow-hidden text-center text-slate-600 outline-none select-none ${useCompactEdgeToEdge ? 'px-0 py-0' : 'px-2 py-1'} ${compact ? 'min-h-[2.75rem]' : ''}`}>
          <span className={`text-center ${compact ? 'text-xs' : 'text-sm'}`}>
            Use the math field below to edit the current step.
          </span>
        </div>
      </div>
    )
  }, [useCompactEdgeToEdge])

  const renderKeyboardTopPanelEditorSurface = useCallback(() => {
    return renderKeyboardTypesetEditorSurface(false, true)
  }, [renderKeyboardTypesetEditorSurface])

  const renderKeyboardBottomPanelPreviewSurface = useCallback(() => {
    return renderKeyboardTypesetEditorSurface(false, true)
  }, [renderKeyboardTypesetEditorSurface])

  const finishQuestionSourceLatex = useMemo(() => {
    if (recognitionEngine === 'keyboard') {
      return normalizeStepLatex(keyboardSteps[0]?.latex || '')
    }
    return normalizeStepLatex(adminSteps[0]?.latex || '')
  }, [adminSteps, keyboardSteps, normalizeStepLatex, recognitionEngine])

  const finishQuestionSourcePreviewHtml = useMemo(() => {
    return renderLatexStepInline(finishQuestionSourceLatex)
  }, [finishQuestionSourceLatex, renderLatexStepInline])

  const finishQuestionSuggestedTitle = useMemo(() => {
    return prettyPrintTitleFromLatex(finishQuestionSourceLatex)
  }, [finishQuestionSourceLatex, prettyPrintTitleFromLatex])

  const studentQuizLatexPreviewMarkup = useMemo(() => {
    if (canOrchestrateLesson) return ''
    if (!quizActive) return ''
    const latexString = (latexOutput || '').trim()
    if (!latexString) return ''
    try {
      return renderToString(normalizeDisplayPlaceholdersToBoxes(latexString), {
        throwOnError: false,
        displayMode: true,
      })
    } catch (err) {
      console.warn('Failed to render student quiz preview', err)
      return ''
    }
  }, [canOrchestrateLesson, latexOutput, quizActive])

  const latexOverlayStyle = useMemo<CSSProperties>(
    () => ({
      fontSize: `${latexRenderOptions.fontScale}rem`,
      textAlign: latexRenderOptions.textAlign,
    }),
    [latexRenderOptions.fontScale, latexRenderOptions.textAlign]
  )

  const disableCanvasInput = isViewOnly || recognitionEngine === 'keyboard' || (isOverlayMode && overlayControlsVisible)
  const editorHostClass = isFullscreen ? 'w-full h-full' : 'w-full'
  const editorHostStyle = useMemo<CSSProperties>(() => {
    if (isFullscreen) {
      return {
        position: 'relative',
        width: '100%',
        height: '100%',
        touchAction: 'none',
        pointerEvents: disableCanvasInput ? 'none' : undefined,
        cursor: disableCanvasInput ? 'default' : undefined,
      }
    }
    if (useStackedStudentLayout) {
      return {
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '220px',
        touchAction: 'none',
        backgroundColor: 'transparent',
        pointerEvents: disableCanvasInput ? 'none' : undefined,
        cursor: disableCanvasInput ? 'default' : undefined,
      }
    }
    const landscape = canvasOrientation === 'landscape'
    const sizing: CSSProperties = landscape
      ? { minHeight: '384px', maxHeight: '520px', aspectRatio: '16 / 9' }
      : { minHeight: '480px', maxHeight: '640px', aspectRatio: '3 / 4' }
    return {
      position: 'relative',
      width: '100%',
      ...sizing,
      touchAction: 'none',
      pointerEvents: disableCanvasInput ? 'none' : undefined,
      cursor: disableCanvasInput ? 'default' : undefined,
    }
  }, [canvasOrientation, disableCanvasInput, isFullscreen, useStackedStudentLayout])

  const DEFAULT_STACKED_ZOOM = 3.7
  const stackedDefaultZoom = recognitionEngine === 'keyboard' ? 1 : DEFAULT_STACKED_ZOOM
  // Normalized zoom model: 1 = 1x, making min/max values intuitive.
  const stackedRenderZoomRef = useRef(1)
  const stackedZoomRef = useRef(stackedDefaultZoom)
  const stackedPinchActiveRef = useRef(false)
  const stackedPinchStateRef = useRef<{
    active: boolean
    startDist: number
    startZoom: number
    anchorX: number
    anchorY: number
    startScrollLeft: number
    startScrollTop: number
    lastDist: number
    lastMidpointX: number
    lastMidpointY: number
  }>({ active: false, startDist: 0, startZoom: stackedDefaultZoom, anchorX: 0, anchorY: 0, startScrollLeft: 0, startScrollTop: 0, lastDist: 0, lastMidpointX: 0, lastMidpointY: 0 })
  const [stackedZoom, setStackedZoom] = useState(stackedDefaultZoom)
  const [stackedZoomHudMounted, setStackedZoomHudMounted] = useState(false)
  const [stackedZoomHudActive, setStackedZoomHudActive] = useState(false)
  const stackedInputScaleRef = useRef(1)
  const stackedZoomHudFadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [stackedSurfaceBaseSize, setStackedSurfaceBaseSize] = useState({ width: 320, height: 640 })
  const stackedTouchActiveRef = useRef(false)
  const stackedInitialViewportCenterAppliedRef = useRef(false)
  const stackedInitialViewportCenterRafRef = useRef<number | null>(null)
  const stackedInteractionMotionRafRef = useRef<number | null>(null)
  const stackedInteractionStableFramesRef = useRef(0)
  const stackedInteractionLastSnapshotRef = useRef<{ left: number; top: number; zoom: number } | null>(null)
  const stackedMinZoom = Math.max(0.5, stackedRenderZoomRef.current)
  const stackedEffectiveZoom = Math.min(Math.max(stackedZoom, stackedMinZoom), 220)
  const stackedLiveScale = Math.min(Math.max(stackedEffectiveZoom / Math.max(1, stackedRenderZoomRef.current), 0.5), 220)
  const getDefaultStackedScrollLeft = useCallback((viewport: HTMLDivElement | null) => {
    if (!viewport) return 0
    return Math.max(0, viewport.scrollWidth - viewport.clientWidth) / 2
  }, [])

  const stopStackedInteractionMotionMonitor = useCallback(() => {
    if (typeof window === 'undefined') return
    if (stackedInteractionMotionRafRef.current !== null) {
      window.cancelAnimationFrame(stackedInteractionMotionRafRef.current)
      stackedInteractionMotionRafRef.current = null
    }
    stackedInteractionStableFramesRef.current = 0
    stackedInteractionLastSnapshotRef.current = null
  }, [])

  const startStackedInteractionMotionMonitor = useCallback(() => {
    if (typeof window === 'undefined') return
    if (stackedInteractionMotionRafRef.current !== null) return

    const tick = () => {
      const viewport = studentViewportRef.current
      const nextSnapshot = {
        left: viewport?.scrollLeft ?? 0,
        top: viewport?.scrollTop ?? 0,
        zoom: stackedZoomRef.current,
      }
      const prevSnapshot = stackedInteractionLastSnapshotRef.current
      const moved = !prevSnapshot
        || Math.abs(nextSnapshot.left - prevSnapshot.left) > 0.5
        || Math.abs(nextSnapshot.top - prevSnapshot.top) > 0.5
        || Math.abs(nextSnapshot.zoom - prevSnapshot.zoom) > 0.02
      stackedInteractionLastSnapshotRef.current = nextSnapshot

      const activeMotion = moved || stackedPinchActiveRef.current || stackedTouchActiveRef.current
      if (activeMotion) {
        stackedInteractionStableFramesRef.current = 0
        stackedInteractionMotionRafRef.current = window.requestAnimationFrame(tick)
        return
      }

      stackedInteractionStableFramesRef.current += 1
      if (stackedInteractionStableFramesRef.current >= 2) {
        stopStackedInteractionMotionMonitor()
        return
      }
      stackedInteractionMotionRafRef.current = window.requestAnimationFrame(tick)
    }

    stackedInteractionMotionRafRef.current = window.requestAnimationFrame(tick)
  }, [stopStackedInteractionMotionMonitor])

  const markStackedUserInteracting = useCallback(() => {
    stackedInteractionStableFramesRef.current = 0
    startStackedInteractionMotionMonitor()
  }, [startStackedInteractionMotionMonitor])

  const showStackedZoomHud = useCallback(() => {
    if (stackedZoomHudFadeTimeoutRef.current) {
      clearTimeout(stackedZoomHudFadeTimeoutRef.current)
      stackedZoomHudFadeTimeoutRef.current = null
    }
    setStackedZoomHudMounted(true)
    setStackedZoomHudActive(true)
  }, [])

  const hideStackedZoomHudWithFade = useCallback(() => {
    if (stackedZoomHudFadeTimeoutRef.current) {
      clearTimeout(stackedZoomHudFadeTimeoutRef.current)
    }
    setStackedZoomHudActive(false)
    stackedZoomHudFadeTimeoutRef.current = setTimeout(() => {
      setStackedZoomHudMounted(false)
      stackedZoomHudFadeTimeoutRef.current = null
    }, 900)
  }, [])

  useEffect(() => {
    stackedZoomRef.current = stackedEffectiveZoom
  }, [stackedEffectiveZoom])

  useEffect(() => {
    if (!useStackedStudentLayout) return
    stackedZoomRef.current = stackedDefaultZoom
    setStackedZoom(stackedDefaultZoom)
    stackedInitialViewportCenterAppliedRef.current = false
  }, [stackedDefaultZoom, useStackedStudentLayout])

  useEffect(() => {
    stackedInputScaleRef.current = useStackedStudentLayout ? stackedLiveScale : 1
  }, [stackedLiveScale, useStackedStudentLayout])

  useEffect(() => {
    if (!useStackedStudentLayout) return
    if (typeof window === 'undefined') return

    const viewport = studentViewportRef.current
    if (!viewport) return

    const updateBaseSize = () => {
      const compactPadding = window.matchMedia('(min-width: 640px)').matches ? 24 : 16
      const nextWidth = Math.max(320, Math.round(viewport.clientWidth - (compactPadding * 2)))
      const nextHeight = Math.max(320, Math.round(viewport.clientHeight * 2))
      setStackedSurfaceBaseSize((prev) => {
        if (Math.abs(prev.width - nextWidth) < 1 && Math.abs(prev.height - nextHeight) < 1) return prev
        return { width: nextWidth, height: nextHeight }
      })
    }

    updateBaseSize()
    window.addEventListener('resize', updateBaseSize)

    let ro: ResizeObserver | null = null
    try {
      ro = new ResizeObserver(() => updateBaseSize())
      ro.observe(viewport)
    } catch {
      // Ignore environments without ResizeObserver.
    }

    return () => {
      window.removeEventListener('resize', updateBaseSize)
      try {
        ro?.disconnect()
      } catch {}
    }
  }, [useStackedStudentLayout])

  useEffect(() => {
    return () => {
      stopStackedInteractionMotionMonitor()
    }
  }, [stopStackedInteractionMotionMonitor])

  useEffect(() => {
    return () => {
      if (stackedZoomHudFadeTimeoutRef.current) {
        clearTimeout(stackedZoomHudFadeTimeoutRef.current)
        stackedZoomHudFadeTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!useStackedStudentLayout) return
    requestEditorResize()
  }, [requestEditorResize, stackedEffectiveZoom, useStackedStudentLayout])

  const applyStackedLivePinchStyle = useCallback((zoomValue: number) => {
    const contentEl = stackedZoomContentRef.current
    if (!contentEl) return
    const scale = Math.min(Math.max(zoomValue / Math.max(1, stackedRenderZoomRef.current), 0.5), 220)
    contentEl.style.zoom = String(scale)
    contentEl.style.transform = ''
    contentEl.style.willChange = stackedPinchActiveRef.current ? 'transform' : ''
  }, [])

  // Mobile stacked mode: provide extra horizontal writing room by making the ink surface wider than
  // the viewport so users can scroll sideways for long expressions.
  const inkSurfaceWidthFactor = useMemo(() => {
    if (!useStackedStudentLayout) return 1
    if (!isCompactViewport) return 1
    if (recognitionEngine === 'keyboard') return 1
    // Intentionally large for narrow portrait phones: gives lots of horizontal room for long expressions.
    // Kept as a factor (not infinite) to avoid extreme memory/perf costs from a gigantic editor surface.
    return 12
  }, [isCompactViewport, recognitionEngine, useStackedStudentLayout])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!useStackedStudentLayout) {
      stackedInitialViewportCenterAppliedRef.current = false
      if (stackedInitialViewportCenterRafRef.current !== null) {
        window.cancelAnimationFrame(stackedInitialViewportCenterRafRef.current)
        stackedInitialViewportCenterRafRef.current = null
      }
      return
    }
    if (stackedInitialViewportCenterAppliedRef.current) return

    let attempts = 0
    const maxAttempts = 12

    const centerViewport = () => {
      stackedInitialViewportCenterRafRef.current = null
      const viewport = studentViewportRef.current
      if (!viewport) return

      const hasMeasuredViewport = viewport.clientWidth > 0 && viewport.clientHeight > 0
      const hasMeasuredContent = viewport.scrollWidth > 0 && viewport.scrollHeight > 0
      if ((!hasMeasuredViewport || !hasMeasuredContent) && attempts < maxAttempts) {
        attempts += 1
        stackedInitialViewportCenterRafRef.current = window.requestAnimationFrame(centerViewport)
        return
      }

      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      viewport.scrollLeft = getDefaultStackedScrollLeft(viewport)
      viewport.scrollTop = maxScrollTop / 2
      stackedInitialViewportCenterAppliedRef.current = true
    }

    stackedInitialViewportCenterRafRef.current = window.requestAnimationFrame(centerViewport)

    return () => {
      if (stackedInitialViewportCenterRafRef.current !== null) {
        window.cancelAnimationFrame(stackedInitialViewportCenterRafRef.current)
        stackedInitialViewportCenterRafRef.current = null
      }
    }
  }, [getDefaultStackedScrollLeft, inkSurfaceWidthFactor, stackedEffectiveZoom, stackedSurfaceBaseSize.height, stackedSurfaceBaseSize.width, useStackedStudentLayout])

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
  const [manualScrollGain, setManualScrollGain] = useState(1)
  const masterGainTrackRef = useRef<HTMLDivElement | null>(null)
  const masterGainDragRef = useRef<{ active: boolean; pointerId: number | null; startY: number; startValue: number; trackHeight: number }>(
    { active: false, pointerId: null, startY: 0, startValue: 1, trackHeight: 1 }
  )

  const canShowSliders = Boolean(useStackedStudentLayout && isCompactViewport && !shouldCollapseStackedView)
  const SLIDER_AUTO_HIDE_MS = 2500
  const [slidersVisible, setSlidersVisible] = useState(false)
  const sliderHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const bumpSlidersVisibility = useCallback(() => {
    if (!canShowSliders) return
    setSlidersVisible(true)
    if (sliderHideTimeoutRef.current) {
      clearTimeout(sliderHideTimeoutRef.current)
    }
    sliderHideTimeoutRef.current = setTimeout(() => {
      setSlidersVisible(false)
      sliderHideTimeoutRef.current = null
    }, SLIDER_AUTO_HIDE_MS)
  }, [canShowSliders])

  useEffect(() => {
    if (!canShowSliders) {
      setSlidersVisible(false)
      if (sliderHideTimeoutRef.current) {
        clearTimeout(sliderHideTimeoutRef.current)
        sliderHideTimeoutRef.current = null
      }
      return
    }
    const viewport = studentViewportRef.current
    if (!viewport) return

    const handle = () => bumpSlidersVisibility()
    viewport.addEventListener('scroll', handle, { passive: true })
    viewport.addEventListener('pointerdown', handle, { passive: true })
    viewport.addEventListener('wheel', handle, { passive: true })
    viewport.addEventListener('touchstart', handle, { passive: true })

    return () => {
      viewport.removeEventListener('scroll', handle)
      viewport.removeEventListener('pointerdown', handle)
      viewport.removeEventListener('wheel', handle)
      viewport.removeEventListener('touchstart', handle)
    }
  }, [bumpSlidersVisibility, canShowSliders])

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
      bumpSlidersVisibility()
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
      bumpSlidersVisibility()
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
      bumpSlidersVisibility()
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
  }, [bumpSlidersVisibility, horizontalPanThumbRatio, manualScrollGain, verticalPanThumbRatio])

  const suggestQuizPromptAndLabel = useCallback(async (previousPrompt?: string) => {
    const phaseKey = lessonScriptPhaseKey
    const pointIndex = lessonScriptPointIndex
    const pointId = lessonScriptV2ActivePoint?.id || ''
    const pointTitle = lessonScriptV2ActivePoint?.title || ''
    const isChallengeBoard = typeof boardId === 'string' && boardId.startsWith('challenge:')

    let promptText = (typeof previousPrompt === 'string' ? previousPrompt : quizPromptRef.current || '').trim()
    let quizLabel = (quizLabelRef.current || '').trim()
    if (isChallengeBoard) {
      return { promptText: promptText || 'Enter quiz instructions manually.', quizLabel }
    }

    try {
      const teacherLatexContext = (useAdminStepComposer
        ? [adminSteps.map(s => s?.latex || '').join(' \\\\ '), adminDraftLatex].filter(Boolean).join(' \\\\ ')
        : latexDisplayStateRef.current?.enabled
          ? (latexDisplayStateRef.current?.latex || '')
          : (latexOutput || '')
      ).trim()

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
        if (echoed) console.log('[quiz-prompt debug echo] lessonContextText (what Gemini received):\n' + echoed)
        const suggested = typeof data?.prompt === 'string' ? data.prompt.trim() : ''
        if (suggested) promptText = suggested
        const suggestedLabel = typeof data?.label === 'string' ? data.label.trim() : ''
        if (suggestedLabel) quizLabel = suggestedLabel
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
      if (!promptText) promptText = 'Gemini prompt suggestion failed. Enter quiz instructions manually.'
    }

    return { promptText: promptText || 'Enter quiz instructions manually.', quizLabel }
  }, [adminDraftLatex, adminSteps, boardId, buildLessonContextText, gradeLabel, latexOutput, lessonScriptPhaseKey, lessonScriptPointIndex, lessonScriptV2ActivePoint?.id, lessonScriptV2ActivePoint?.title, requestWindowContext, useAdminStepComposer])

  const suggestQuizTimerDurationSec = useCallback(async (promptText: string) => {
    const isChallengeBoard = typeof boardId === 'string' && boardId.startsWith('challenge:')
    if (isChallengeBoard) return 300
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
        if (Number.isFinite(maybe) && maybe > 0) return maybe
      } else {
        const rawBody = await timerRes.text().catch(() => '')
        console.warn('quiz-timer API failed', timerRes.status, rawBody)
      }
    } catch (err) {
      console.warn('quiz-timer API error', err)
    }
    return 300
  }, [boardId, gradeLabel])

  const openQuizSetupOverlay = useCallback(async () => {
    if (!canOrchestrateLesson) return
    setQuizSetupOpen(true)
    setQuizSetupLoading(true)
    setQuizSetupError(null)

    try {
      const prev = (quizPromptRef.current || '').trim()
      const suggested = await suggestQuizPromptAndLabel(prev)
      const promptText = (suggested?.promptText || '').trim()
      const quizLabel = (suggested?.quizLabel || '').trim()

      setQuizSetupPrompt(promptText)
      setQuizSetupLabel(quizLabel)

      const duration = clampQuizDurationSec(await suggestQuizTimerDurationSec(promptText || prev || 'Quiz'))
      const min = Math.max(0, Math.floor(duration / 60))
      const sec = Math.max(0, Math.min(59, Math.round(duration - min * 60)))
      setQuizSetupMinutes(min)
      setQuizSetupSeconds(sec)
    } catch {
      setQuizSetupError('Failed to load Gemini quiz suggestion. You can still type it manually.')
      setQuizSetupPrompt((quizPromptRef.current || '').trim() || 'Enter quiz instructions manually.')
    } finally {
      setQuizSetupLoading(false)
    }
  }, [clampQuizDurationSec, canOrchestrateLesson, suggestQuizPromptAndLabel, suggestQuizTimerDurationSec])

  useEffect(() => {
    if (!quizSetupOpen) return
    if (typeof window === 'undefined') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setQuizSetupOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [quizSetupOpen])

  const publishQuizState = useCallback(async (enabled: boolean, opts?: { promptText?: string; quizLabel?: string; durationSec?: number }) => {
    if (!hasControllerRights()) return
    const channel = channelRef.current
    if (!channel) return
    try {
      let quizId = quizIdRef.current
      let promptText = quizPromptRef.current
      let quizLabel = quizLabelRef.current
      let durationSec: number | undefined
      let endsAt: number | undefined

      if (enabled) {
        const forcedPrompt = typeof opts?.promptText === 'string' ? opts.promptText.trim() : ''
        const forcedLabel = typeof opts?.quizLabel === 'string' ? opts.quizLabel.trim() : ''
        const forcedDuration = typeof opts?.durationSec === 'number' && Number.isFinite(opts.durationSec) ? Math.trunc(opts.durationSec) : 0

        const hasForcedPrompt = Boolean(forcedPrompt)
        const hasForcedLabel = Boolean(forcedLabel)
        const hasForcedDuration = forcedDuration > 0

        if (hasForcedPrompt) promptText = forcedPrompt
        if (hasForcedLabel) quizLabel = forcedLabel
        if (hasForcedDuration) {
          durationSec = forcedDuration
          endsAt = Date.now() + forcedDuration * 1000
        }
      }

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
        // This keeps UX functional even if the setup overlay didn't provide a prompt.
        if (!isChallengeBoard && !(typeof opts?.promptText === 'string' && opts.promptText.trim())) {
          try {
            const teacherLatexContext = (useAdminStepComposer
              ? [adminSteps.map(s => s?.latex || '').join(' \\\\ '), adminDraftLatex].filter(Boolean).join(' \\\\ ')
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
              if (suggestedLabel && !(typeof opts?.quizLabel === 'string' && opts.quizLabel.trim())) {
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

        // Require a non-empty prompt (either from setup overlay or fallback suggestion).
        const required = (promptText || '').trim()
        if (!required) return
        promptText = required

        // Ask Gemini for a sensible quiz timer based on the final prompt (admin-only).
        // Never call AI tools for learner-created challenges.
        if (!isChallengeBoard && (!durationSec || !endsAt)) {
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

        // Timer overrides are handled by the quiz setup overlay.
        // Keep any pre-set durationSec/endsAt (from opts) or the Gemini/fallback above.
        if (!durationSec || !endsAt) {
          // Safety: ensure endsAt is consistent with durationSec.
          durationSec = durationSec || 300
          endsAt = Date.now() + durationSec * 1000
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

      // Persist current quiz timing on the teacher client so we can rebroadcast it to late joiners.
      if (enabled) {
        quizEndsAtRef.current = (typeof endsAt === 'number' && Number.isFinite(endsAt) && endsAt > 0) ? Math.trunc(endsAt) : null
        quizDurationSecRef.current = (typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0) ? Math.trunc(durationSec) : null
      } else {
        quizEndsAtRef.current = null
        quizDurationSecRef.current = null
      }

      // Stopping/aborting quiz: restore class state to what it was before the quiz started.
      if (!enabled) {
        // Clear captured pre-quiz state snapshots.
        adminPreQuizControlStateRef.current = null
        adminPreQuizControlCapturedRef.current = false
      }
    } catch (err) {
      console.warn('Failed to publish quiz state', err)
    }
  }, [adminDraftLatex, adminSteps, boardId, gradeLabel, hasControllerRights, canOrchestrateLesson, latexOutput, lessonScriptPhaseKey, lessonScriptPointIndex, lessonScriptV2ActivePoint?.id, lessonScriptV2ActivePoint?.title, useAdminStepComposer, userDisplayName])

  const startQuizFromOverlay = useCallback(async () => {
    const prompt = (quizSetupPrompt || '').trim()
    if (!prompt) {
      setQuizSetupError('Please enter a quiz question/instructions.')
      return
    }
    const label = (quizSetupLabel || '').trim()
    const min = Number.isFinite(quizSetupMinutes) ? Math.max(0, Math.trunc(quizSetupMinutes)) : 0
    const sec = Number.isFinite(quizSetupSeconds) ? Math.max(0, Math.min(59, Math.trunc(quizSetupSeconds))) : 0
    const durationSec = clampQuizDurationSec(min * 60 + sec)

    await runCanvasAction(async () => {
      await publishQuizState(true, { promptText: prompt, quizLabel: label, durationSec })
      setQuizActiveState(true)
    })

    setQuizSetupOpen(false)
  }, [clampQuizDurationSec, publishQuizState, quizSetupLabel, quizSetupMinutes, quizSetupPrompt, quizSetupSeconds, runCanvasAction, setQuizActiveState])

  const studentQuizCommitOrSubmit = useCallback(async (opts?: { forceSubmit?: boolean; skipConfirm?: boolean }) => {
    const isSolution = assignmentSubmission?.kind === 'solution'
    // This flow is for learners (and for teachers when authoring solutions).
    // Don't block it just because we grant write access on single-user canvases.
    if (canOrchestrateLesson && !isSolution) return

    const isAssignment = Boolean(assignmentSubmission?.assignmentId && assignmentSubmission?.questionId && assignmentSubmission?.sessionId)
    const isChallengeBoard = typeof boardId === 'string' && boardId.startsWith('challenge:')
    if (!quizActiveRef.current && !isAssignment) return
    if (quizSubmitting) return
    if (!boardId) {
      alert('This quiz session is missing a session id (boardId).')
      return
    }
    const forceSubmit = Boolean(opts?.forceSubmit)
    const skipConfirm = Boolean(opts?.skipConfirm)

    setQuizSubmitting(true)
    try {
      const commitKeyboardStudentStep = (step: string) => {
        const now = Date.now()
        let nextCombined = ''
        setStudentSteps(prev => {
          const current = prev.length ? prev : parseCommittedStudentSteps(quizCombinedLatexRef.current || studentCommittedLatex)
          const next = [...current]
          const nextRecord: NotebookStepRecord = {
            latex: step,
            symbols: [],
            jiix: null,
            createdAt: studentEditIndex !== null && current[studentEditIndex]?.createdAt != null
              ? current[studentEditIndex].createdAt
              : now,
            updatedAt: now,
          }
          if (studentEditIndex !== null && studentEditIndex >= 0 && studentEditIndex < next.length) {
            next[studentEditIndex] = {
              ...current[studentEditIndex],
              ...nextRecord,
            }
          } else {
            next.push(nextRecord)
          }
          nextCombined = next.map(s => s.latex).filter(Boolean).join(' \\ ')
          return next
        })
        quizCombinedLatexRef.current = nextCombined
        quizHasCommittedRef.current = Boolean(nextCombined)
        setStudentCommittedLatex(nextCombined)
        setStudentEditIndex(null)
        if (typeof window !== 'undefined') {
          window.setTimeout(() => {
            setTopPanelEditingMode(true)
          }, 360)
        } else {
          setTopPanelEditingMode(true)
        }
        activeStepEditBaselineRef.current = null
        clearTopPanelSelection()
        setLatexOutput('')
        latexOutputRef.current = ''
        setKeyboardSelectionState({ start: 0, end: 0 })
      }

      const editor = editorInstanceRef.current

      try {
        if (typeof editor?.waitForIdle === 'function') {
          await editor.waitForIdle()
        }
      } catch {}

      // Determine if canvas currently has ink.
      const snap = captureFullSnapshot()
      const symbolCount = countSymbols(snap?.symbols)
      const hasInk = symbolCount > 0
      const studentTextSnapshot = (studentQuizTextResponseRef.current || '').trim()
      const keyboardDraft = normalizeStepLatex(latexOutputRef.current || latexOutput || '')
      const isKeyboardStudentComposer = recognitionEngineRef.current === 'keyboard' && useStudentStepComposer

      const getStepLatex = async () => {
        let step = ''
        try {
          const modelLatex = getLatexFromEngineModel()
          const normalizedModel = normalizeStepLatex(modelLatex)
          if (normalizedModel) step = normalizedModel
        } catch {}
        if (!step) {
          for (let i = 0; i < 3 && !step; i += 1) {
            const exported = await exportLatexFromEngine()
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

      const applyStudentStepCommit = (
        step: string,
        symbols: any[] | null,
        jiix: string | null,
        rawStrokes: any[] | null,
        strokeGroups: any[] | null,
        snapshot: SnapshotPayload | null,
      ) => {
        const cleanedStep = cleanupStepLatexWithJiix(step, snapshot)
        const baseline = activeStepEditBaselineRef.current
        const shouldMergeSerializedBaseline = Boolean(
          studentEditIndex !== null
          && baseline
          && !baseline.rawStrokes?.length
          && (baseline.jiix || (Array.isArray(baseline.symbols) && baseline.symbols.length))
        )
        const storedSymbols = shouldMergeSerializedBaseline
          ? mergeSerializedStepSymbols(baseline?.symbols, symbols)
          : symbols
        const storedJiix = shouldMergeSerializedBaseline ? null : jiix
        const storedRawStrokes = shouldMergeSerializedBaseline ? null : rawStrokes
        const storedStrokeGroups = shouldMergeSerializedBaseline ? null : strokeGroups
        let nextCombined = ''
        setStudentSteps(prev => {
          const next = [...prev]
          if (studentEditIndex !== null && studentEditIndex >= 0 && studentEditIndex < next.length) {
            next[studentEditIndex] = { latex: cleanedStep, symbols: storedSymbols, jiix: storedJiix, rawStrokes: storedRawStrokes, strokeGroups: storedStrokeGroups }
          } else {
            next.push({ latex: cleanedStep, symbols: storedSymbols, jiix: storedJiix, rawStrokes: storedRawStrokes, strokeGroups: storedStrokeGroups })
          }
          nextCombined = next.map(s => s.latex).filter(Boolean).join(' \\\\ ')
          return next
        })
        quizCombinedLatexRef.current = nextCombined
        quizHasCommittedRef.current = true
        setStudentCommittedLatex(nextCombined)
        setStudentEditIndex(null)
        activeStepEditBaselineRef.current = null
        clearTopPanelSelection()
      }

      if (isKeyboardStudentComposer && keyboardDraft && !forceSubmit) {
        commitKeyboardStudentStep(keyboardDraft)
        if (isAssignment || isChallengeBoard) return
      }

      if (hasInk && !forceSubmit) {
        // First-stage send: commit this line into combined latex and clear bottom canvas.
        const step = await getStepLatex()
        if (!step) return
        const commitSnapshot = await captureSettledCommitSnapshot(step)
        const strokeState = extractEditorStrokeState()
        applyStudentStepCommit(
          step,
          commitSnapshot?.symbols ?? null,
          commitSnapshot?.jiix ?? null,
          strokeState.rawStrokes,
          strokeState.strokeGroups,
          commitSnapshot ?? snap,
        )

        invalidatePendingLatexPreviewWork()
        suppressBroadcastUntilTsRef.current = Date.now() + 1200
        try {
          editor.clear?.()
        } catch {}
        lastSymbolCountRef.current = 0
        lastBroadcastBaseCountRef.current = 0
        setLatexOutput('')
        if (!isChallengeBoard && !isAssignment) return
        if (isAssignment) return
        if (isChallengeBoard) return
      }

      // Force-submit mode (timer): include current ink as the last step if present.
      if (hasInk && forceSubmit) {
        const step = await getStepLatex()
        if (step) {
          const commitSnapshot = await captureSettledCommitSnapshot(step)
          const strokeState = extractEditorStrokeState()
          applyStudentStepCommit(
            step,
            commitSnapshot?.symbols ?? null,
            commitSnapshot?.jiix ?? null,
            strokeState.rawStrokes,
            strokeState.strokeGroups,
            commitSnapshot ?? snap,
          )
        }
      }

      if (isKeyboardStudentComposer && keyboardDraft && forceSubmit) {
        commitKeyboardStudentStep(keyboardDraft)
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
        const merged = stepLines.filter(Boolean).join(' \\\\ ').trim()
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
  }, [applyPageSnapshot, assignmentSubmission, boardId, captureFullSnapshot, clearQuizCountdown, clearTopPanelSelection, exportLatexFromEngine, forceEditableForAssignment, getLatexFromEngineModel, hasWriteAccess, invalidatePendingLatexPreviewWork, latexOutput, normalizeStepLatex, parseCommittedStudentSteps, playSnapSound, quizSubmitting, setKeyboardSelectionState, setQuizActiveState, studentCommittedLatex, studentEditIndex, studentSteps, updateControlState, useStudentStepComposer, userDisplayName, userId])

  const handleSendStepClick = useCallback(async () => {
    if ((!canOrchestrateLesson || isAssignmentSolutionAuthoring) && (quizActiveRef.current || isAssignmentViewRef.current)) {
      if (lockedOutRef.current) return
      await studentQuizCommitOrSubmit()
      return
    }

    if (recognitionEngineRef.current === 'keyboard') {
      if (lockedOutRef.current && !canOrchestrateLesson) return

      if (canOrchestrateLesson && !isAssignmentSolutionAuthoring) {
        const emptyCanvas = isEditorEmptyNow()
        const emptyLine = isCurrentLineEmptyNow()
        if (emptyCanvas && emptyLine && keyboardSteps.length > 0) {
          const noteId = activeNotebookSolutionId || finishQuestionNoteId || createSessionNoteId()
          setFinishQuestionNoteId(noteId)
          setActiveNotebookSolutionId(noteId)
          setFinishQuestionTitle(prettyPrintTitleFromLatex(keyboardSteps[0]?.latex || ''))
          setLatexSaveError(null)
          setFinishQuestionModalOpen(true)
          return
        }
      }

      const step = normalizeStepLatex(latexOutputRef.current || adminDraftLatex || '')
      if (!step) return

      const now = Date.now()
      setKeyboardSteps(prev => {
        const nextRecord: NotebookStepRecord = {
          latex: step,
          symbols: [],
          jiix: null,
          createdAt: keyboardEditIndex !== null && prev[keyboardEditIndex]?.createdAt != null
            ? prev[keyboardEditIndex].createdAt
            : now,
          updatedAt: now,
        }

        if (keyboardEditIndex !== null && keyboardEditIndex >= 0 && keyboardEditIndex < prev.length) {
          const next = [...prev]
          next[keyboardEditIndex] = {
            ...prev[keyboardEditIndex],
            ...nextRecord,
          }
          return next
        }

        return [...prev, nextRecord]
      })

      setKeyboardEditIndex(null)
      syncKeyboardDraftLatex('')
      clearTopPanelSelection()
      setKeyboardSelectionState({ start: 0, end: 0 })
      syncKeyboardControlStripState(null, '')
      return
    }

    const editor = editorInstanceRef.current
    if (!editor) return

    if (canOrchestrateLesson && !isAssignmentSolutionAuthoring) {
      const emptyCanvas = isEditorEmptyNow()
      const emptyLine = isCurrentLineEmptyNow()
      if (emptyCanvas && emptyLine && adminSteps.length > 0) {
        const noteId = activeNotebookSolutionId || finishQuestionNoteId || createSessionNoteId()
        setFinishQuestionNoteId(noteId)
        setActiveNotebookSolutionId(noteId)
        setFinishQuestionTitle(prettyPrintTitleFromLatex(adminSteps[0]?.latex || ''))
        setLatexSaveError(null)
        setFinishQuestionModalOpen(true)
        return
      }
    }

    // Reset the manual horizontal scrollbar to the default centered position whenever a step is sent.
    try {
      const viewport = studentViewportRef.current
      if (viewport) {
        viewport.scrollLeft = getDefaultStackedScrollLeft(viewport)
        setHorizontalPanValue(viewport.scrollLeft)
      } else {
        setHorizontalPanValue(horizontalPanMax / 2)
      }
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
        const modelLatex = getLatexFromEngineModel()
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
          const exported = await exportLatexFromEngine()
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

      const snapshot = await captureSettledCommitSnapshot(step)
      const baseline = activeStepEditBaselineRef.current
      const shouldMergeSerializedBaseline = Boolean(
        adminEditIndex !== null
        && baseline
        && !baseline.rawStrokes?.length
        && (baseline.jiix || (Array.isArray(baseline.symbols) && baseline.symbols.length))
      )
      const symbols = shouldMergeSerializedBaseline
        ? mergeSerializedStepSymbols(baseline?.symbols, snapshot?.symbols ?? null)
        : (snapshot?.symbols ?? null)
      const jiix = shouldMergeSerializedBaseline ? null : (snapshot?.jiix ?? null)
      const strokeState = extractEditorStrokeState()
      const storedRawStrokes = shouldMergeSerializedBaseline ? null : strokeState.rawStrokes
      const storedStrokeGroups = shouldMergeSerializedBaseline ? null : strokeState.strokeGroups
      const cleanedStep = cleanupStepLatexWithJiix(step, snapshot)
      setAdminSteps(prev => {
        const next = [...prev]
        if (adminEditIndex !== null && adminEditIndex >= 0 && adminEditIndex < next.length) {
          next[adminEditIndex] = {
            latex: cleanedStep,
            symbols,
            jiix,
            rawStrokes: storedRawStrokes,
            strokeGroups: storedStrokeGroups,
          }
        } else {
          next.push({
            latex: cleanedStep,
            symbols,
            jiix,
            rawStrokes: storedRawStrokes,
            strokeGroups: storedStrokeGroups,
          })
        }
        return next
      })
      setAdminDraftLatex('')
      setAdminEditIndex(null)
      activeStepEditBaselineRef.current = null
      setLatexOutput('')

      // Clear handwriting for next step without broadcasting a global clear.
      invalidatePendingLatexPreviewWork()
      suppressBroadcastUntilTsRef.current = Date.now() + 1200
      await clearMathEditorForLocalReload()
      clearMathpixLocalStrokes()
      lastSymbolCountRef.current = 0
      lastBroadcastBaseCountRef.current = 0
      clearTopPanelSelection()

      const clearedSnapshot = cloneSnapshotPayload({
        mode: 'math',
        symbols: null,
        rawInk: null,
        latex: '',
        jiix: null,
        version: localVersionRef.current,
        snapshotId: `${clientIdRef.current}-${Date.now()}-post-step-commit-clear`,
        baseSymbolCount: -1,
      })
      if (clearedSnapshot) {
        cacheModeSnapshotForPage(pageIndexRef.current, clearedSnapshot)
        latestSnapshotRef.current = {
          snapshot: clearedSnapshot,
          ts: Date.now(),
          reason: 'clear',
        }
      }
    } finally {
      setAdminSendingStep(false)
    }
  }, [
    activeNotebookSolutionId,
    adminDraftLatex,
    adminEditIndex,
    adminSendingStep,
    adminSteps,
    captureFullSnapshot,
    captureSettledCommitSnapshot,
    cacheModeSnapshotForPage,
    exportLatexFromEngine,
    finishQuestionNoteId,
    getLatexFromEngineModel,
    canOrchestrateLesson,
    isAssignmentSolutionAuthoring,
    keyboardEditIndex,
    keyboardSteps,
    clearTopPanelSelection,
    clearMathEditorForLocalReload,
    isCurrentLineEmptyNow,
    isEditorEmptyNow,
    invalidatePendingLatexPreviewWork,
    normalizeStepLatex,
    prettyPrintTitleFromLatex,
    getDefaultStackedScrollLeft,
    horizontalPanMax,
    setKeyboardSelectionState,
    studentQuizCommitOrSubmit,
    syncKeyboardControlStripState,
    syncKeyboardDraftLatex,
  ])

  useEffect(() => {
    if (canOrchestrateLesson) return
    if (!quizActive) return
    if (quizSubmitting) return
    if (quizTimeLeftSec == null) return
    if (quizTimeLeftSec > 0) return
    if (quizAutoSubmitTriggeredRef.current) return
    quizAutoSubmitTriggeredRef.current = true
    void (async () => {
      await studentQuizCommitOrSubmit({ forceSubmit: true, skipConfirm: true })
    })()
  }, [canOrchestrateLesson, quizActive, quizSubmitting, quizTimeLeftSec, studentQuizCommitOrSubmit])

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
  const strokeTrackRef = useRef<{ active: boolean; startX: number; lastX: number; minX: number; maxX: number }>(
    { active: false, startX: 0, lastX: 0, minX: 0, maxX: 0 }
  )
  const autoPanAnimRef = useRef<number | null>(null)
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
  }, [inkSurfaceWidthFactor, useStackedStudentLayout])

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
  }, [inkSurfaceWidthFactor, useStackedStudentLayout])

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

    const durationMs = 720
    const startTs = window.performance?.now?.() ?? Date.now()
    const ease = (t: number) => 0.5 - (Math.cos(Math.PI * t) / 2)

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
    const EDGE_TRIGGER_RATIO = 0.1
    const EDGE_CLEARANCE_RATIO = 0.5
    const AUTOPAN_DISTANCE_GAIN = 0.72

    const onDown = (event: PointerEvent) => {
      strokeTrackRef.current.active = true
      strokeTrackRef.current.startX = event.clientX
      strokeTrackRef.current.lastX = event.clientX
      strokeTrackRef.current.minX = event.clientX
      strokeTrackRef.current.maxX = event.clientX
    }
    const onMove = (event: PointerEvent) => {
      if (!strokeTrackRef.current.active) return
      const nextX = event.clientX
      strokeTrackRef.current.lastX = nextX
      strokeTrackRef.current.minX = Math.min(strokeTrackRef.current.minX, nextX)
      strokeTrackRef.current.maxX = Math.max(strokeTrackRef.current.maxX, nextX)
    }
    const onUpLike = () => {
      if (!strokeTrackRef.current.active) return
      strokeTrackRef.current.active = false

      // Only auto-pan between strokes (after pen lifts), to avoid disturbing handwriting.
      if (horizontalPanDragRef.current.active) return
      const viewport = studentViewportRef.current
      if (!viewport) return
      const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
      if (maxScroll <= 0) return

      const rect = viewport.getBoundingClientRect()
      const leftEdgeTrigger = rect.left + rect.width * EDGE_TRIGGER_RATIO
      const rightEdgeTrigger = rect.left + rect.width * (1 - EDGE_TRIGGER_RATIO)
      const targetX = rect.left + rect.width * EDGE_CLEARANCE_RATIO

      // Left-edge trigger on pointer-up (symmetric with right-edge behavior).
      if (strokeTrackRef.current.minX <= leftEdgeTrigger || strokeTrackRef.current.lastX <= leftEdgeTrigger) {
        const leftAnchor = Math.min(strokeTrackRef.current.minX, strokeTrackRef.current.lastX)
        const delta = leftAnchor - targetX
        if (delta < -1) {
          smoothScrollViewportBy(delta * AUTOPAN_DISTANCE_GAIN)
        }
        return
      }

      // Symmetric right-edge trigger: pan only when stroke reaches near the right edge.
      if (strokeTrackRef.current.maxX >= rightEdgeTrigger || strokeTrackRef.current.lastX >= rightEdgeTrigger) {
        const rightAnchor = Math.max(strokeTrackRef.current.maxX, strokeTrackRef.current.lastX)
        const delta = rightAnchor - targetX
        if (delta > 1) {
          smoothScrollViewportBy(delta * AUTOPAN_DISTANCE_GAIN)
        }
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
  const stackedScrollDebugLabel = useMemo(() => {
    const roundMetric = (value: number) => Math.round(Number.isFinite(value) ? value : 0)
    return {
      horizontal: `H ${roundMetric(horizontalPanValue)} / ${roundMetric(horizontalPanMax)} | thumb ${roundMetric(horizontalPanThumbRatio * 100)}% | pos ${roundMetric(horizontalScrollbarLeftPct)}%`,
      vertical: `V ${roundMetric(verticalPanValue)} / ${roundMetric(verticalPanMax)} | thumb ${roundMetric(verticalPanThumbRatio * 100)}% | pos ${roundMetric(verticalScrollbarTopPct)}%`,
    }
  }, [horizontalPanMax, horizontalPanThumbRatio, horizontalPanValue, horizontalScrollbarLeftPct, verticalPanMax, verticalPanThumbRatio, verticalPanValue, verticalScrollbarTopPct])

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

  const showSideSliders = canShowSliders

  // Keep side sliders short and docked above the bottom horizontal scrollbar.
  // Also reserve the same amount of space in the stacked scroll viewport so the fixed bar
  // never visually covers ink as the learner writes near the bottom.
  const sideSliderBottomCss = useMemo(
    () => `calc(env(safe-area-inset-bottom) + ${viewportBottomOffsetPx}px + ${STACKED_BOTTOM_OVERLAY_RESERVE_PX}px)`,
    [viewportBottomOffsetPx]
  )

  const leftVerticalScrollbar = showSideSliders ? (
    <div
      className={`fixed left-0 z-[520] pointer-events-none transition-opacity duration-200 ${slidersVisible ? 'opacity-100' : 'opacity-0'}`}
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
      className={`fixed right-0 z-[520] pointer-events-none transition-opacity duration-200 ${slidersVisible ? 'opacity-100' : 'opacity-0'}`}
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

  const showBottomHorizontalScrollbar = canShowSliders

  const horizontalScrollbar = showBottomHorizontalScrollbar ? (
    <div
      className={`fixed left-0 right-0 z-[500] pointer-events-none transition-opacity duration-200 ${slidersVisible ? 'opacity-100' : 'opacity-0'}`}
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

  const orientationLockedToLandscape = Boolean(canOrchestrateLesson && isFullscreen)

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
      const sharedSaves = Array.isArray(data?.shared) ? data.shared : []
      const latestShared = sharedSaves.find((record: any) => getNotebookRevisionKind(record?.payload) !== 'checkpoint') || null
      const latestCheckpoint = sharedSaves.find((record: any) => getNotebookRevisionKind(record?.payload) === 'checkpoint') || null
      const latestMine = Array.isArray(data?.mine) && data.mine.length > 0 ? data.mine[0] : null
      setLatestSharedSave(latestShared || null)
      setLatestContinuitySave(latestCheckpoint || null)
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
    const questions = shared.filter((record: unknown) => isNotebookLibraryRecord(record))
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
      const preferredSolutionId = activeNotebookSolutionId
        || extractNotebookSolutionId(items[0] || null)
        || null
      setNotesLibrarySelectedSolutionId(preferredSolutionId)
      setNotesLibraryCollapsedSolutionIds([])
    } catch (err: any) {
      console.warn('Failed to load session notes library', err)
      setNotesLibraryError(err?.message || 'Failed to load notes')
      setNotesLibraryItems([])
      setNotesLibrarySelectedSolutionId(null)
    } finally {
      setNotesLibraryLoading(false)
    }
  }, [activeNotebookSolutionId, canPersistLatex, fetchAllSessionQuestionNotes, sessionKey])

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
      const sharedFlag = options?.shared ?? canOrchestrateLesson
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
    [canPersistLatex, canOrchestrateLesson, isLessonAuthoring, latexOutput, saveLatexIntoLessonDraft, sessionKey]
  )

  // Auto-save shared class notes on presenter/controller switches.
  // This captures the current notes at the moment control changes, so the admin
  // doesn't have to manually click the floppy-disk save.
  const prevPresenterKeyForAutoSaveRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (isLessonAuthoring) return
    if (!canOrchestrateLesson) return
    if (!canPersistLatex || !sessionKey) return

    const nextKey = activePresenterUserKey ? String(activePresenterUserKey) : ''
    const prevKey = prevPresenterKeyForAutoSaveRef.current
    // Skip initial mount.
    if (prevKey === undefined) {
      prevPresenterKeyForAutoSaveRef.current = nextKey
      return
    }

    if (prevKey !== nextKey) {
      void saveLatexSnapshot({ shared: true, auto: true })
    }
    prevPresenterKeyForAutoSaveRef.current = nextKey
  }, [activePresenterUserKey, canPersistLatex, canOrchestrateLesson, isLessonAuthoring, saveLatexSnapshot, sessionKey])

  const saveQuestionAsNotes = useCallback(
    async (options: {
      title: string
      noteId: string
      stepsOverride?: NotebookStepRecord[]
      revisionKind?: NotebookRevisionKind
      status?: 'draft' | 'final'
    }) => {
      if (isLessonAuthoring) {
        setLatexSaveError('Finish Question is only available inside a live session.')
        return null
      }
      if (!canOrchestrateLesson) {
        setLatexSaveError('Finish Question is only available for teachers.')
        return null
      }
      if (!canPersistLatex || !sessionKey) {
        setLatexSaveError('Saving is only available inside a scheduled session.')
        return null
      }

      const keyboardSourceSteps = keyboardSteps
        .filter(s => s && typeof s === 'object')
        .map(s => ({
          latex: normalizeStepLatex((s as any).latex || ''),
          symbols: Array.isArray((s as any).symbols) ? (s as any).symbols : [],
          jiix: typeof (s as any).jiix === 'string' ? (s as any).jiix : null,
          rawStrokes: Array.isArray((s as any).rawStrokes) ? (s as any).rawStrokes : undefined,
          strokeGroups: Array.isArray((s as any).strokeGroups) ? (s as any).strokeGroups : undefined,
        }))
      const defaultStepsSource = recognitionEngineRef.current === 'keyboard' ? keyboardSourceSteps : adminSteps
      const steps = (Array.isArray(options.stepsOverride) ? options.stepsOverride : defaultStepsSource)
        .map(s => ({
          latex: normalizeStepLatex((s as any)?.latex || ''),
          symbols: Array.isArray((s as any)?.symbols) ? (s as any).symbols : [],
          jiix: typeof (s as any)?.jiix === 'string' ? (s as any).jiix : null,
          rawStrokes: Array.isArray((s as any)?.rawStrokes) ? (s as any).rawStrokes : undefined,
          strokeGroups: Array.isArray((s as any)?.strokeGroups) ? (s as any).strokeGroups : undefined,
        }))
        .filter(s => String(s.latex || '').trim() || (Array.isArray(s.symbols) && s.symbols.length) || Boolean(s.jiix) || (Array.isArray(s.rawStrokes) && s.rawStrokes.length) || (Array.isArray(s.strokeGroups) && s.strokeGroups.length))

      if (!steps.length) {
        setLatexSaveError('Nothing to save yet.')
        return null
      }

      const latexValue = steps.map(s => s.latex).filter(Boolean).join(' \\\\ ').trim()
      const legacyPayload = buildQuestionPayloadV1(options.noteId, steps)
      const revisionKind = options.revisionKind || 'final-save'
      const status = options.status || (revisionKind === 'final-save' ? 'final' : 'draft')
      const payload = buildSolutionSessionPayloadV2({
        notebook: {
          solutionId: options.noteId,
          revisionId: `${options.noteId}:${Date.now()}`,
          revisionKind,
          status,
          title: options.title,
        },
        editorState: await captureSolutionSessionEditorState(steps, latexValue),
      })

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
            legacyPayload,
          }),
        })
        if (!res.ok) {
          const errorData = await res.json().catch(() => null)
          const message = errorData?.message || 'Failed to save notes'
          throw new Error(typeof message === 'string' ? message : 'Failed to save notes')
        }
        const saved = await res.json()
        if (revisionKind === 'checkpoint') setLatestContinuitySave(saved)
        else setLatestSharedSave(saved)
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
    [adminSteps, canPersistLatex, canOrchestrateLesson, isLessonAuthoring, keyboardSteps, normalizeStepLatex, sessionKey]
  )

  // Silent "Finish Question" save (no modal) used when the admin is switching presenter context.
  // Mirrors the paper-plane empty-canvas flow by saving the full question (top steps) into Notes.
  const lastAutoQuestionNotesHashRef = useRef<string | null>(null)
  const autoSaveCurrentQuestionAsNotes = useCallback(async (options?: { requireEmptyBottom?: boolean }) => {
    if (isLessonAuthoring) return null
    if (!canOrchestrateLesson) return null
    if (!canPersistLatex || !sessionKey) return null

    const requireEmptyBottom = options?.requireEmptyBottom !== false

    const remotePresenterActive = Boolean(activePresenterUserKeyRef.current) && !isSelfActivePresenter()

    const stepsFromAdmin = (recognitionEngineRef.current === 'keyboard' ? keyboardSteps : adminSteps)
      .filter(s => s && typeof s === 'object')
      .map(s => ({
        latex: normalizeStepLatex((s as any)?.latex || ''),
        symbols: Array.isArray((s as any)?.symbols) ? (s as any).symbols : [],
        jiix: typeof (s as any)?.jiix === 'string' ? (s as any).jiix : null,
        rawStrokes: Array.isArray((s as any)?.rawStrokes) ? (s as any).rawStrokes : undefined,
        strokeGroups: Array.isArray((s as any)?.strokeGroups) ? (s as any).strokeGroups : undefined,
      }))
      .filter(s => String(s.latex || '').trim() || (Array.isArray(s.symbols) && s.symbols.length) || Boolean(s.jiix) || (Array.isArray(s.rawStrokes) && s.rawStrokes.length) || (Array.isArray(s.strokeGroups) && s.strokeGroups.length))

    const snapshotLatexRaw = latestSnapshotRef.current?.snapshot?.latex
    const snapshotLatex = normalizeStepLatex(typeof snapshotLatexRaw === 'string' ? snapshotLatexRaw : '')
    const snapshotSymbols = latestSnapshotRef.current?.snapshot?.symbols
    const snapshotJiix = latestSnapshotRef.current?.snapshot?.jiix ?? null

    const displayedLatex = normalizeStepLatex(typeof latexOutput === 'string' ? latexOutput : '')
    const remoteLatex = displayedLatex || snapshotLatex
    const remoteSymbols = Array.isArray(snapshotSymbols)
      ? snapshotSymbols
      : Array.isArray((snapshotSymbols as any)?.events)
        ? (snapshotSymbols as any).events
        : []

    const stepsForSave = remotePresenterActive
      ? ((remoteLatex || remoteSymbols.length || snapshotJiix)
        ? [{ latex: remoteLatex, symbols: remoteSymbols, jiix: snapshotJiix }]
        : [])
      : (stepsFromAdmin.length
        ? stepsFromAdmin
        : ((remoteLatex || remoteSymbols.length || snapshotJiix)
          ? [{ latex: remoteLatex, symbols: remoteSymbols, jiix: snapshotJiix }]
          : []))

    // Only enforce the "empty bottom canvas" rule when we're saving teacher-authored steps.
    // When saving the current presenter's published snapshot (learner work), the canvas is *expected*
    // to be non-empty, so blocking on emptiness would skip saves during learner→learner switches.
    if (!remotePresenterActive && stepsFromAdmin.length && requireEmptyBottom) {
      let emptyCanvas = false
      let emptyLine = false
      try {
        emptyCanvas = isEditorEmptyNow()
        emptyLine = isCurrentLineEmptyNow()
      } catch {
        return null
      }
      if (!emptyCanvas || !emptyLine) return null
    }

    if (!stepsForSave.length) return null
    const normalizedLatexParts = stepsForSave.map(s => normalizeStepLatex(s.latex || '')).filter(Boolean)
    const hash = normalizedLatexParts.length
      ? normalizedLatexParts.join('\n')
      : `symbols:${stepsForSave.reduce((acc, step) => acc + (Array.isArray((step as any).symbols) ? (step as any).symbols.length : 0), 0)}:jiix:${stepsForSave.reduce((acc, step) => acc + (typeof (step as any).jiix === 'string' && (step as any).jiix ? 1 : 0), 0)}`
    if (lastAutoQuestionNotesHashRef.current === hash) return latestContinuitySaveRef.current
    lastAutoQuestionNotesHashRef.current = hash

    const noteId = createSessionNoteId()
    const inferredTitle = prettyPrintTitleFromLatex(stepsForSave[0]?.latex || '')
    const title = (inferredTitle || '').trim() || 'Untitled question'
    return await saveQuestionAsNotes({
      title,
      noteId,
      stepsOverride: stepsForSave,
      revisionKind: 'checkpoint',
      status: 'draft',
    })
  }, [adminSteps, canPersistLatex, createSessionNoteId, canOrchestrateLesson, isLessonAuthoring, isCurrentLineEmptyNow, isEditorEmptyNow, isSelfActivePresenter, keyboardSteps, latexOutput, normalizeStepLatex, prettyPrintTitleFromLatex, saveQuestionAsNotes, sessionKey])

  useEffect(() => {
    autoSaveCurrentQuestionAsNotesRef.current = async (options?: { requireEmptyBottom?: boolean }) => {
      return await autoSaveCurrentQuestionAsNotes(options)
    }
    return () => {
      autoSaveCurrentQuestionAsNotesRef.current = null
    }
  }, [autoSaveCurrentQuestionAsNotes])

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

  const persistFinishQuestionSave = useCallback(async (mode: 'draft' | 'final', options?: { fork?: boolean }) => {
    if (!finishQuestionNoteId) return
    const title = String(finishQuestionTitle || '').trim()
    if (!title) {
      setLatexSaveError('Title is required.')
      return
    }
    const noteId = options?.fork ? createSessionNoteId() : finishQuestionNoteId
    const saved = await saveQuestionAsNotes({
      title,
      noteId,
      revisionKind: mode === 'draft' ? 'draft-save' : 'final-save',
      status: mode === 'draft' ? 'draft' : 'final',
    })
    if (!saved) return

    const solutionId = extractNotebookSolutionId(saved) || noteId
    setActiveNotebookSolutionId(solutionId)
    setFinishQuestionNoteId(solutionId)

    setFinishQuestionModalOpen(false)
    if (mode === 'draft') return

    setFinishQuestionNoteId(null)

    // Start the next question on a clean slate.
    try {
      setLatexDisplayState(curr => ({ ...curr, latex: '' }))
    } catch {}
    try {
      setStackedNotesState(curr => ({ ...curr, latex: '' }))
    } catch {}
    clearEverything()
  }, [clearEverything, createSessionNoteId, finishQuestionNoteId, finishQuestionTitle, saveQuestionAsNotes])

  const confirmFinishQuestionSave = useCallback(async () => {
    await persistFinishQuestionSave('final')
  }, [persistFinishQuestionSave])

  const confirmFinishQuestionDraftSave = useCallback(async () => {
    await persistFinishQuestionSave('draft')
  }, [persistFinishQuestionSave])

  const confirmFinishQuestionForkSave = useCallback(async () => {
    await persistFinishQuestionSave('draft', { fork: true })
  }, [persistFinishQuestionSave])

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
    setLatestContinuitySave(null)
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
      saveLatexSnapshot({ shared: canOrchestrateLesson, auto: true })
    }, 2500)
    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current)
      }
    }
  }, [canPersistLatex, canOrchestrateLesson, isLessonAuthoring, latexDisplayState.latex, latexOutput, saveLatexSnapshot])

  const importNotebookSymbolsForRestore = useCallback(async (symbols: any[] | null | undefined) => {
    const editor = editorInstanceRef.current
    if (!editor) return 0

    const events = Array.isArray(symbols) ? symbols : []
    if (!events.length) return 0

    const batches = splitSymbolEventsForReplay(events)
    const shouldReplayInBatches = batches.length > 1 && batches.length <= 64 && events.length <= 6000

    if (!shouldReplayInBatches) {
      await nextAnimationFrame()
      await editor.importPointEvents(events)
      if (typeof editor.waitForIdle === 'function') await editor.waitForIdle()
      return events.length
    }

    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index]
      if (!batch.length) continue
      await nextAnimationFrame()
      await editor.importPointEvents(batch)
      if (typeof editor.waitForIdle === 'function' && (index === batches.length - 1 || index % 6 === 5)) {
        await editor.waitForIdle()
      }
    }

    if (typeof editor.waitForIdle === 'function') await editor.waitForIdle()
    return events.length
  }, [])

  async function captureSolutionSessionEditorState(steps: NotebookStepRecord[], aggregatedLatex: string): Promise<SolutionSessionEditorStateV2> {
    const textCtx = await requestWindowContext<any>({
      requestEvent: 'philani-text:request-context',
      responseEvent: 'philani-text:context',
      timeoutMs: 220,
    })

    const textOverlayState: NotebookTextOverlayState | null = textCtx?.overlayState && typeof textCtx.overlayState === 'object'
      ? {
          isOpen: Boolean(textCtx.overlayState.isOpen),
          activeId: typeof textCtx.overlayState.activeId === 'string' ? textCtx.overlayState.activeId : null,
        }
      : null

    const textBoxes: NotebookTextBoxRecord[] = Array.isArray(textCtx?.boxes)
      ? textCtx.boxes
          .map((box: any) => {
            const id = typeof box?.id === 'string' ? box.id : ''
            if (!id) return null
            return {
              id,
              text: typeof box?.text === 'string' ? box.text : '',
              x: typeof box?.x === 'number' && Number.isFinite(box.x) ? Math.max(0, Math.min(1, box.x)) : 0.1,
              y: typeof box?.y === 'number' && Number.isFinite(box.y) ? Math.max(0, Math.min(1, box.y)) : 0.1,
              w: typeof box?.w === 'number' && Number.isFinite(box.w) ? Math.max(0, Math.min(1, box.w)) : 0.45,
              h: typeof box?.h === 'number' && Number.isFinite(box.h) ? Math.max(0, Math.min(1, box.h)) : 0.18,
              z: typeof box?.z === 'number' && Number.isFinite(box.z) ? box.z : 0,
              surface: 'stage' as const,
              visible: typeof box?.visible === 'boolean' ? box.visible : true,
              locked: typeof box?.locked === 'boolean' ? box.locked : false,
            }
          })
          .filter(Boolean) as NotebookTextBoxRecord[]
      : []

    const textTimeline: NotebookTextTimelineEvent[] = Array.isArray(textCtx?.timeline)
      ? textCtx.timeline
          .map((entry: any) => {
            const ts = typeof entry?.ts === 'number' && Number.isFinite(entry.ts) ? entry.ts : NaN
            const kind = entry?.kind === 'overlay-state' || entry?.kind === 'box' ? entry.kind : ''
            const action = typeof entry?.action === 'string' ? entry.action : ''
            if (!Number.isFinite(ts) || !kind || !action) return null
            return {
              ts,
              kind,
              action,
              boxId: typeof entry?.boxId === 'string' ? entry.boxId : undefined,
              visible: typeof entry?.visible === 'boolean' ? entry.visible : undefined,
              textSnippet: typeof entry?.textSnippet === 'string' ? entry.textSnippet : undefined,
            }
          })
          .filter(Boolean) as NotebookTextTimelineEvent[]
      : []

    return {
      content: {
        steps,
        draftStep: {
          latex: adminDraftLatex,
          symbols: [],
          rawStrokes: cloneRawInkStrokes(rawInkStrokesRef.current),
        },
        aggregatedLatex,
        stackedLatex: stackedNotesState.latex,
        rawInkStrokes: cloneRawInkStrokes(rawInkStrokesRef.current),
        diagrams: diagramsRef.current.map(diagram => ({
          id: diagram.id,
          title: diagram.title,
          imageUrl: diagram.imageUrl,
          order: diagram.order,
          annotations: cloneDiagramAnnotations(diagram.annotations),
        })),
        diagramState: {
          activeDiagramId: diagramStateRef.current.activeDiagramId,
          isOpen: diagramStateRef.current.isOpen,
        },
        textOverlay: {
          overlayState: textOverlayState,
          boxes: textBoxes,
          timeline: textTimeline,
        },
      },
      interaction: {
        canvasMode,
        topPanelEditingMode,
        selectedStepIndex: topPanelSelectedStep,
        editingStepIndex: adminEditIndex,
        studentEditingStepIndex: studentEditIndex,
        diagramTool: diagramToolRef.current,
        diagramSelection: diagramSelectionRef.current,
        splitRatio: studentSplitRatioRef.current,
      },
      history: {
        rawInkRedoStack: rawInkRedoStackRef.current.map(cloneRawInkStrokes),
        stepNavRedoStack: [...stepNavRedoStackRef.current],
        diagramUndoStack: diagramUndoRef.current.map(value => cloneDiagramAnnotations(value)),
        diagramRedoStack: diagramRedoRef.current.map(value => cloneDiagramAnnotations(value)),
      },
    }
  }

  const restoreSolutionSessionEditorState = useCallback((editorState: SolutionSessionEditorStateV2 | null, continuityLatex: string) => {
    if (!editorState) return

    if (typeof window !== 'undefined' && editorState.content?.textOverlay) {
      try {
        window.dispatchEvent(new CustomEvent('philani-text:restore-context', {
          detail: {
            overlayState: editorState.content.textOverlay.overlayState || null,
            boxes: Array.isArray(editorState.content.textOverlay.boxes) ? editorState.content.textOverlay.boxes : [],
            timeline: Array.isArray(editorState.content.textOverlay.timeline) ? editorState.content.textOverlay.timeline : [],
          },
        }))
      } catch {}
    }

    if (editorState.content?.stackedLatex) {
      setStackedNotesState(curr => ({
        ...curr,
        latex: editorState.content?.stackedLatex || continuityLatex,
        ts: Date.now(),
      }))
    }

    if (editorState.content?.rawInkStrokes) {
      const nextMode = editorState.interaction?.canvasMode === 'raw-ink' ? 'raw-ink' : 'math'
      setCanvasMode(nextMode)
      replaceRawInkState((editorState.content.rawInkStrokes as any[]) || [], { clearRedo: true })
      setCanUndo(Array.isArray(editorState.content.rawInkStrokes) && editorState.content.rawInkStrokes.length > 0)
    }

    if (editorState.content?.diagrams) {
      setDiagrams(editorState.content.diagrams.map((diagram: any) => ({
        id: String(diagram?.id || ''),
        title: typeof diagram?.title === 'string' ? diagram.title : '',
        imageUrl: typeof diagram?.imageUrl === 'string' ? diagram.imageUrl : '',
        order: Number.isFinite(diagram?.order) ? Number(diagram.order) : 0,
        annotations: diagram?.annotations ? normalizeAnnotations(diagram.annotations) : null,
      })))
    }

    if (editorState.content?.diagramState) {
      setDiagramState({
        activeDiagramId: editorState.content.diagramState.activeDiagramId || null,
        isOpen: Boolean(editorState.content.diagramState.isOpen),
      })
    }

    if (editorState.interaction?.diagramTool) {
      setDiagramTool(editorState.interaction.diagramTool)
    }

    setDiagramSelection((editorState.interaction?.diagramSelection as any) || null)

    if (typeof editorState.interaction?.topPanelEditingMode === 'boolean') {
      setTopPanelEditingMode(editorState.interaction.topPanelEditingMode)
    }

    if (typeof editorState.interaction?.splitRatio === 'number' && Number.isFinite(editorState.interaction.splitRatio)) {
      const nextSplitRatio = recognitionEngineRef.current === 'keyboard'
        ? clampStudentSplitRatio(editorState.interaction.splitRatio)
        : editorState.interaction.splitRatio
      setStudentSplitRatio(nextSplitRatio)
      studentSplitRatioRef.current = nextSplitRatio
    }

    rawInkRedoStackRef.current = Array.isArray(editorState.history?.rawInkRedoStack)
      ? editorState.history.rawInkRedoStack.map(strokes => cloneRawInkStrokes(strokes as any[]))
      : []
    stepNavRedoStackRef.current = Array.isArray(editorState.history?.stepNavRedoStack)
      ? editorState.history.stepNavRedoStack.filter(value => Number.isFinite(value)).map(value => Number(value))
      : []
    diagramUndoRef.current = Array.isArray(editorState.history?.diagramUndoStack)
      ? editorState.history.diagramUndoStack.map(value => cloneDiagramAnnotations(value as any))
      : []
    diagramRedoRef.current = Array.isArray(editorState.history?.diagramRedoStack)
      ? editorState.history.diagramRedoStack.map(value => cloneDiagramAnnotations(value as any))
      : []
    setDiagramCanUndo(diagramUndoRef.current.length > 0)
    setDiagramCanRedo(diagramRedoRef.current.length > 0)
    setCanRedo(rawInkRedoStackRef.current.length > 0)
  }, [clampStudentSplitRatio, cloneDiagramAnnotations, normalizeAnnotations, replaceRawInkState])

  const applySavedNotesRecord = useCallback(async (save: NotesSaveRecord, options?: { publish?: boolean; continuity?: boolean }) => {
    if (!save) return

    const editorState = extractSolutionSessionEditorState(save.payload)
    const solutionId = extractNotebookSolutionId(save)
    const previousSolutionId = activeNotebookSolutionId
    const {
      steps: stepsForComposer,
      mergedSymbols,
      continuityLatex,
    } = extractNotebookSaveState(save)

    if (options?.continuity && !mergedSymbols.length) {
      const latexValue = continuityLatex
      if (latexValue) {
        setLatexOutput(latexValue)
        setStackedNotesState(curr => ({ ...curr, latex: latexValue, ts: Date.now() }))
      }
      setLatexDisplayState(curr => ({ ...curr, enabled: false, latex: latexValue }))
      return
    }

    setActiveNotebookSolutionId(solutionId)
    setFinishQuestionNoteId(solutionId)
    if (solutionId) {
      setNotesLibrarySelectedSolutionId(solutionId)
      setNotesLibraryCollapsedSolutionIds(curr => curr.filter(id => id !== solutionId))
    } else {
      setNotesLibrarySelectedSolutionId(null)
    }

    // Overwrite the current local state.
    suppressBroadcastUntilTsRef.current = Date.now() + 1200
    try {
    } catch {}
    lastSymbolCountRef.current = 0
    lastBroadcastBaseCountRef.current = 0
      if (mergedSymbols.length) {
        try {
          await importNotebookSymbolsForRestore(mergedSymbols)
        } catch (err) {
          console.warn('Failed to import continuity notes symbols', err)
      }
      lastSymbolCountRef.current = mergedSymbols.length
      lastBroadcastBaseCountRef.current = mergedSymbols.length
    }

    if (stepsForComposer.length) {
      const sameSolutionLineage = Boolean(solutionId && previousSolutionId && solutionId === previousSolutionId)
      const savedSelectedStepIndex = normalizeLoadedStepIndex(editorState?.interaction?.selectedStepIndex, stepsForComposer.length)
      const savedAdminEditingStepIndex = normalizeLoadedStepIndex(editorState?.interaction?.editingStepIndex, stepsForComposer.length)
      const savedStudentEditingStepIndex = normalizeLoadedStepIndex(editorState?.interaction?.studentEditingStepIndex, stepsForComposer.length)
      const preservedSelectedStepIndex = sameSolutionLineage
        ? normalizeLoadedStepIndex(topPanelSelectedStep, stepsForComposer.length)
        : null
      const preservedEditingStepIndex = sameSolutionLineage
        ? normalizeLoadedStepIndex(activeComposerEditIndex, stepsForComposer.length)
        : null
      const nextSelectedStepIndex = savedSelectedStepIndex
        ?? preservedSelectedStepIndex
        ?? savedAdminEditingStepIndex
        ?? savedStudentEditingStepIndex
        ?? preservedEditingStepIndex
        ?? null
      const nextEditingStepIndex = savedAdminEditingStepIndex ?? preservedEditingStepIndex ?? null
      if (useAdminStepComposer && hasControllerRights()) {
        setAdminSteps(stepsForComposer)
        setAdminEditIndex(nextEditingStepIndex)
        setAdminDraftLatex(nextEditingStepIndex !== null
          ? (editorState?.content?.draftStep?.latex || stepsForComposer[nextEditingStepIndex]?.latex || '')
          : '')
        setTopPanelSelectedStep(nextSelectedStepIndex)
      }

      setLoadedNotebookRevision({
        saveId: String(save.id || ''),
        solutionId,
        selectedStepIndex: nextSelectedStepIndex,
        editingStepIndex: nextEditingStepIndex,
        loadedAt: Date.now(),
      })
    } else if (useAdminStepComposer && hasControllerRights()) {
      // If a non-question note is loaded in composer mode, clear the step list so the LaTeX panel can take over.
      setAdminSteps([])
      setAdminEditIndex(null)
      setAdminDraftLatex('')
      setTopPanelSelectedStep(null)
      setLoadedNotebookRevision({
        saveId: String(save.id || ''),
        solutionId,
        selectedStepIndex: null,
        editingStepIndex: null,
        loadedAt: Date.now(),
      })
    }

    if (options?.continuity) {
      const latexValue = continuityLatex
      setLatexOutput(latexValue)
      setStackedNotesState(curr => ({ ...curr, latex: latexValue, ts: Date.now() }))
      setLatexDisplayState(curr => ({ ...curr, enabled: false, latex: latexValue }))
    } else {
      applyLoadedLatex(continuityLatex || null)
    }
    const canonical = captureFullSnapshot()
    if (canonical && !isSnapshotEmpty(canonical)) {
      latestSnapshotRef.current = { snapshot: canonical, ts: Date.now(), reason: 'update' }
    }

    restoreSolutionSessionEditorState(editorState, continuityLatex)

    if (options?.publish && canPublishSnapshots()) {
      await forcePublishCanvas(undefined, { shareIndex: pageIndexRef.current })
    }
  }, [activeComposerEditIndex, activeNotebookSolutionId, applyLoadedLatex, canPublishSnapshots, captureFullSnapshot, forcePublishCanvas, hasControllerRights, importNotebookSymbolsForRestore, normalizeLoadedStepIndex, restoreSolutionSessionEditorState, topPanelSelectedStep, useAdminStepComposer])

  const handleLoadSavedLatex = useCallback(
    (scope: 'shared' | 'mine') => {
      const save = scope === 'shared' ? latestSharedSave : latestPersonalSave
      if (!save) return
      applySavedNotesRecord(save)
    },
    [applySavedNotesRecord, latestPersonalSave, latestSharedSave]
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!useStackedStudentLayout) return

    const state = multiTouchPanRef.current
    resolvedTouchInkPointerIdsRef.current.clear()

    return () => {
      state.pointers.clear()
      state.active = false
      state.lastMid = null
      state.suppressedPointers.clear()
      if (state.pendingTouch?.timer) {
        clearTimeout(state.pendingTouch.timer)
      }
      state.pendingTouch = null
      resolvedTouchInkPointerIdsRef.current.clear()
      if (debugPanUndoTimeoutRef.current) {
        clearTimeout(debugPanUndoTimeoutRef.current)
        debugPanUndoTimeoutRef.current = null
      }
    }
  }, [multiTouchPanRef, useStackedStudentLayout])

  useEffect(() => {
    if (!useStackedStudentLayout) return

    const viewport = studentViewportRef.current
    if (!viewport) return

    const touchState = { active: false, startX: 0, startY: 0, lastX: 0, lastY: 0 }

    const getPinchDistance = (touches: TouchList) => {
      const a = touches[0]
      const b = touches[1]
      if (!a || !b) return 0
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    }

    const onTouchStart = (e: TouchEvent) => {
      markStackedUserInteracting()
      stackedTouchActiveRef.current = true

      if (e.touches.length === 2) {
        const rect = viewport.getBoundingClientRect()
        const a = e.touches[0]
        const b = e.touches[1]
        const midpointX = rect ? ((a.clientX + b.clientX) / 2) - rect.left : viewport.clientWidth / 2
        const midpointY = rect ? ((a.clientY + b.clientY) / 2) - rect.top : viewport.clientHeight / 2
        stackedPinchActiveRef.current = true
        stackedPinchStateRef.current.active = true
        stackedPinchStateRef.current.startDist = getPinchDistance(e.touches)
        stackedPinchStateRef.current.startZoom = stackedZoomRef.current
        stackedPinchStateRef.current.startScrollLeft = viewport.scrollLeft
        stackedPinchStateRef.current.startScrollTop = viewport.scrollTop
        stackedPinchStateRef.current.anchorX = midpointX
        stackedPinchStateRef.current.anchorY = midpointY
        stackedPinchStateRef.current.lastDist = stackedPinchStateRef.current.startDist
        stackedPinchStateRef.current.lastMidpointX = midpointX
        stackedPinchStateRef.current.lastMidpointY = midpointY
        applyStackedLivePinchStyle(stackedZoomRef.current)
        showStackedZoomHud()
        touchState.active = false
        return
      }

      if (e.touches.length !== 1) return
      const t = e.touches[0]
      touchState.active = true
      touchState.startX = t.clientX
      touchState.startY = t.clientY
      touchState.lastX = t.clientX
      touchState.lastY = t.clientY
    }

    const onTouchMove = (e: TouchEvent) => {
      markStackedUserInteracting()

      if (stackedPinchStateRef.current.active && e.touches.length === 2) {
        const PINCH_START_THRESHOLD = 0.025
        const PAN_START_THRESHOLD_PX = 1.5
        const ZOOM_UPDATE_THRESHOLD = 0.08
        const PAN_UPDATE_THRESHOLD_PX = 0.8
        const TWO_FINGER_PAN_GAIN = 0.4
        e.preventDefault()

        const dist = getPinchDistance(e.touches)
        if (!dist || !stackedPinchStateRef.current.startDist) return

        const rect = viewport.getBoundingClientRect()
        const a = e.touches[0]
        const b = e.touches[1]
        const midpointX = rect ? ((a.clientX + b.clientX) / 2) - rect.left : stackedPinchStateRef.current.anchorX
        const midpointY = rect ? ((a.clientY + b.clientY) / 2) - rect.top : stackedPinchStateRef.current.anchorY
        const midpointStepDx = midpointX - stackedPinchStateRef.current.lastMidpointX
        const midpointStepDy = midpointY - stackedPinchStateRef.current.lastMidpointY
        const scale = dist / stackedPinchStateRef.current.startDist
        const midpointDx = midpointX - stackedPinchStateRef.current.anchorX
        const midpointDy = midpointY - stackedPinchStateRef.current.anchorY
        const panDistance = Math.hypot(midpointDx, midpointDy)

        if (Math.abs(scale - 1) < PINCH_START_THRESHOLD && panDistance < PAN_START_THRESHOLD_PX) return

        const gestureMinZoom = Math.max(0.5, stackedRenderZoomRef.current)
        const nextZoom = Math.min(Math.max(stackedPinchStateRef.current.startZoom * scale, gestureMinZoom), 220)
        if (Math.abs(nextZoom - stackedZoomRef.current) < ZOOM_UPDATE_THRESHOLD && panDistance < PAN_UPDATE_THRESHOLD_PX) return

        if (stackedZoomRef.current > 0) {
          const prevZoom = Math.max(1, stackedZoomRef.current)
          const ratioDelta = nextZoom / prevZoom
          const currentLeft = viewport.scrollLeft
          const currentTop = viewport.scrollTop

          applyStackedLivePinchStyle(nextZoom)

          const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
          const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
          const zoomLeft = (ratioDelta * (currentLeft + midpointX)) - midpointX
          const zoomTop = (ratioDelta * (currentTop + midpointY)) - midpointY
          const nextLeft = zoomLeft - (midpointStepDx * TWO_FINGER_PAN_GAIN)
          const nextTop = zoomTop - (midpointStepDy * TWO_FINGER_PAN_GAIN)

          const clampedLeft = Math.min(Math.max(nextLeft, 0), maxLeft)
          const clampedTop = Math.min(Math.max(nextTop, 0), maxTop)

          if (maxLeft > 1) {
            viewport.scrollLeft = clampedLeft
          }
          if (maxTop > 1) {
            viewport.scrollTop = clampedTop
          }
        }

        stackedPinchStateRef.current.lastDist = dist
        stackedPinchStateRef.current.lastMidpointX = midpointX
        stackedPinchStateRef.current.lastMidpointY = midpointY
        stackedZoomRef.current = nextZoom
        setStackedZoom(nextZoom)
        return
      }

      if (!touchState.active || e.touches.length !== 1) return
      const t = e.touches[0]
      touchState.lastX = t.clientX
      touchState.lastY = t.clientY
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (stackedPinchStateRef.current.active && e.touches.length < 2) {
        stackedPinchActiveRef.current = false
        stackedPinchStateRef.current.active = false
        applyStackedLivePinchStyle(stackedZoomRef.current)
        hideStackedZoomHudWithFade()
        if (editorResizeRetryTimeoutRef.current) {
          clearTimeout(editorResizeRetryTimeoutRef.current)
        }
        editorResizeRetryTimeoutRef.current = setTimeout(() => {
          editorResizeRetryTimeoutRef.current = null
          requestEditorResize()
        }, 80)
      }

      stackedTouchActiveRef.current = e.touches.length > 0
      if (e.touches.length === 0) {
        touchState.active = false
      }
      startStackedInteractionMotionMonitor()
    }

    const onScroll = () => {
      markStackedUserInteracting()
    }

    viewport.addEventListener('touchstart', onTouchStart, { passive: true })
    viewport.addEventListener('touchmove', onTouchMove, { passive: false })
    viewport.addEventListener('touchend', onTouchEnd)
    viewport.addEventListener('touchcancel', onTouchEnd)
    viewport.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      viewport.removeEventListener('touchstart', onTouchStart)
      viewport.removeEventListener('touchmove', onTouchMove)
      viewport.removeEventListener('touchend', onTouchEnd)
      viewport.removeEventListener('touchcancel', onTouchEnd)
      viewport.removeEventListener('scroll', onScroll)
      stackedPinchActiveRef.current = false
      stackedTouchActiveRef.current = false
      hideStackedZoomHudWithFade()
      startStackedInteractionMotionMonitor()
      applyStackedLivePinchStyle(stackedZoomRef.current)
      if (editorResizeRetryTimeoutRef.current) {
        clearTimeout(editorResizeRetryTimeoutRef.current)
        editorResizeRetryTimeoutRef.current = null
      }
    }
  }, [applyStackedLivePinchStyle, hideStackedZoomHudWithFade, markStackedUserInteracting, requestEditorResize, showStackedZoomHud, startStackedInteractionMotionMonitor, useStackedStudentLayout])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const host = useStackedStudentLayout ? studentViewportRef.current : editorHostRef.current
    if (!host) return

    const stopWheel = (event: WheelEvent) => {
      if (!event.cancelable) return
      if (event.ctrlKey) {
        event.preventDefault()
      }
    }

    const stopGesture = (event: Event) => {
      if (!event.cancelable) return
      event.preventDefault()
    }

    host.addEventListener('wheel', stopWheel, { passive: false })
    host.addEventListener('gesturestart', stopGesture, { passive: false })
    host.addEventListener('gesturechange', stopGesture, { passive: false })
    host.addEventListener('gestureend', stopGesture, { passive: false })

    return () => {
      host.removeEventListener('wheel', stopWheel as EventListener)
      host.removeEventListener('gesturestart', stopGesture as EventListener)
      host.removeEventListener('gesturechange', stopGesture as EventListener)
      host.removeEventListener('gestureend', stopGesture as EventListener)
    }
  }, [useStackedStudentLayout])

  const renderToolbarBlock = () => (
    <div className="canvas-toolbar">
      <div className="canvas-toolbar__buttons">
        <button
          className="btn"
          type="button"
          onClick={() => runCanvasAction(handleUndo)}
          disabled={(status !== 'ready') || Boolean(fatalError) || (!canUseTeacherKeyboardLocalToolbarActions && isViewOnly) || (!canUndo && !(useAdminStepComposer && hasWriteAccess))}
        >
          Undo
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => runCanvasAction(handleRedo)}
          disabled={(status !== 'ready') || Boolean(fatalError) || (!canUseTeacherKeyboardLocalToolbarActions && isViewOnly) || (!canRedo && !(useAdminStepComposer && hasWriteAccess))}
        >
          Redo
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => runCanvasAction(handleClear)}
          disabled={!canClear || status !== 'ready' || Boolean(fatalError) || (!canUseTeacherKeyboardLocalToolbarActions && isViewOnly)}
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
              if (quizActiveRef.current) {
                await publishQuizState(false)
                // Keep local admin indicator in sync.
                setQuizActiveState(false)
              } else {
                await openQuizSetupOverlay()
              }
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
        {canUseTechnicalControls && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold">Recognition engine</span>
            <select
              className="input"
              value={recognitionEngine}
              onChange={e => {
                const next = e.target.value as RecognitionEngine
                setRecognitionEngine(next)
                setMathpixError(null)
                if (next === 'keyboard') {
                  const seed = getLatexFromEditorModel() || latexOutputRef.current || ''
                  setLatexOutput(seed)
                  if (useAdminStepComposerRef.current && hasControllerRights()) {
                    setAdminDraftLatex(normalizeStepLatex(seed))
                  }
                }
              }}
              disabled={status !== 'ready' || Boolean(fatalError)}
              aria-label="Choose recognition engine"
            >
              <option value="keyboard">Keyboard (default)</option>
              <option value="myscript">MyScript (handwriting)</option>
              <option value="mathpix">Mathpix (backup)</option>
            </select>
            {recognitionEngine === 'mathpix' && mathpixError && (
              <span className="text-[11px] text-red-600">{mathpixError}</span>
            )}
            {recognitionEngine === 'keyboard' && (
              <div className="mt-2 rounded border border-slate-200 bg-white p-2">
                <textarea
                  className="input min-h-[90px] w-full"
                  value={latexOutput}
                  onChange={e => {
                    const next = e.target.value
                    setLatexOutput(next)
                    if (useAdminStepComposerRef.current && hasControllerRights()) {
                      setAdminDraftLatex(normalizeStepLatex(next))
                    }
                  }}
                  placeholder="Type LaTeX here, e.g. \\frac{x+1}{2}=y"
                  aria-label="Keyboard latex input"
                />
                <div className="mt-2 flex flex-wrap gap-1">
                  {KEYBOARD_ENGINE_TEMPLATES.map((token) => (
                    <button
                      key={token}
                      type="button"
                      className="rounded border border-slate-200 px-2 py-1 text-[11px]"
                      onClick={() => {
                        const next = `${latexOutput}${token}`
                        setLatexOutput(next)
                        if (useAdminStepComposerRef.current && hasControllerRights()) {
                          setAdminDraftLatex(normalizeStepLatex(next))
                        }
                      }}
                    >
                      {token}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {canUseDebugPanel && (
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={debugPanelVisible}
              onChange={e => setDebugPanelVisible(e.target.checked)}
            />
            <span className="font-semibold">Show debug panel</span>
          </label>
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
            className="bg-white p-0 shadow-sm flex flex-col relative"
            style={{
              flex: isOverlayMode ? 1 : undefined,
              minHeight: isOverlayMode ? '100%' : '520px',
              height: isOverlayMode ? '100%' : '80vh',
              maxHeight: isOverlayMode ? '100%' : 'calc(100vh - 140px)',
              overflow: 'hidden',
            }}
          >
            {!isRawInkMode && (
            <div
              className="flex flex-col"
              style={{ flex: shouldCollapseStackedView ? 1 : Math.max(studentSplitRatio, 0.2), minHeight: 0 }}
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
              <div
                  className="relative flex-1 min-h-0 w-full overflow-visible"
                  ref={(useAdminStepComposer || useStudentStepComposer) ? adminTopPanelRef : undefined}
                  style={{
                    paddingTop: 'max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px))',
                  }}
                  onPointerDown={(e) => {
                    if ((useAdminStepComposer || useStudentStepComposer) && topPanelEditingMode) {
                      // Step-recall mode: tap a step line to restore its ink for editing.
                      const target = e.target as HTMLElement | null
                      const actionEl = target?.closest?.('[data-top-panel-step-action]') as HTMLElement | null
                      if (actionEl) {
                        e.stopPropagation()
                        return
                      }
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
                  onClick={(useAdminStepComposer || useStudentStepComposer) && !topPanelEditingMode && recognitionEngine !== 'keyboard' ? async (e) => {
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
                  {canOrchestrateLesson && hasWriteAccess && !isAssignmentSolutionAuthoring && (
                    <button
                      type="button"
                      aria-label={quizActive ? 'Stop quiz mode' : 'Start quiz mode'}
                      title={quizActive ? 'Stop quiz mode' : 'Start quiz mode'}
                      className="absolute right-3 bottom-3 p-0 m-0 bg-transparent border-0 text-slate-700 hover:text-slate-900 focus:outline-none focus:ring-0"
                      onClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        void runCanvasAction(async () => {
                          if (quizActiveRef.current) {
                            await publishQuizState(false)
                            // Keep local admin indicator in sync.
                            setQuizActiveState(false)
                          } else {
                            await openQuizSetupOverlay()
                          }
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
                      className="fixed"
                      style={{
                        top: '50%',
                        left: 'calc(env(safe-area-inset-left, 0px) + 1rem)',
                        transform: 'translateY(-50%)',
                        zIndex: 2147483647,
                      }}
                    >
                      <div className="relative w-6">
                        {rosterAvatarLayout.top.length > 0 ? (
                          <div className="absolute left-0 bottom-[calc(100%+6px)] flex flex-col-reverse items-start gap-1.5">
                            {rosterAvatarLayout.top.map((avatar) => (
                              avatar.kind === 'presenter' ? (
                                <div
                                  key={avatar.userKey}
                                  className={`w-6 h-6 rounded-full text-white text-[10px] font-semibold flex items-center justify-center border shadow-sm ${isAvatarEditingAuthority(avatar.userKey) ? 'bg-amber-500 border-amber-700 ring-2 ring-amber-200' : 'bg-slate-700 border-white/60'}`}
                                  title={`${avatar.name} (presenter)`}
                                  aria-label={`${avatar.name} is a presenter`}
                                >
                                  {avatar.initials}
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  key={avatar.userKey}
                                  data-client-id={avatar.clientId || ''}
                                  data-user-id={avatar.userId || ''}
                                  data-user-key={avatar.userKey}
                                  data-display-name={avatar.name}
                                  className={`w-6 h-6 rounded-full text-white text-[10px] font-semibold flex items-center justify-center border shadow-sm ${isAvatarEditingAuthority(avatar.userKey) ? 'bg-amber-500 border-amber-700 ring-2 ring-amber-200' : 'bg-slate-700 border-white/60'}`}
                                  title={avatar.name}
                                  aria-label={`Make ${avatar.name} the presenter`}
                                  onClick={handleRosterAttendeeAvatarClick}
                                  onPointerDown={(e) => {
                                    e.stopPropagation()
                                  }}
                                >
                                  {avatar.initials}
                                </button>
                              )
                            ))}
                          </div>
                        ) : null}

                        <button
                          type="button"
                          className={`w-6 h-6 rounded-full text-white text-[10px] font-semibold flex items-center justify-center border shadow-sm ${teacherAvatarGold ? 'bg-amber-500 border-amber-700 ring-2 ring-amber-200' : 'bg-slate-900 border-white/60'}`}
                          onClick={(e) => {
                            if (!canOrchestrateLesson) return
                            e.preventDefault()
                            e.stopPropagation()
                            if (overlayRosterVisible) {
                              if (activePresenterUserKeyRef.current || activePresenterClientIdsRef.current.size) {
                                handOverPresentation(null)
                                return
                              }
                              setOverlayRosterVisible(false)
                              return
                            }
                            setOverlayRosterVisible(true)
                          }}
                          onPointerDown={(e) => {
                            if (!canOrchestrateLesson) return
                            e.stopPropagation()
                          }}
                          aria-label={canOrchestrateLesson ? 'Toggle session avatars' : undefined}
                          title={teacherBadge.name}
                          style={{ pointerEvents: canOrchestrateLesson ? 'auto' : 'none' }}
                        >
                          {teacherBadge.initials}
                        </button>

                        {showSwitchingToast ? (
                          <div
                            className="absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 shadow-sm"
                            style={{ zIndex: 2147483647 }}
                            role="status"
                            aria-live="polite"
                          >
                            {switchingStatusLabel}
                          </div>
                        ) : null}

                        {!showSwitchingToast && handoffMessage ? (
                          <div
                            className="absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2 max-w-[170px] rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 shadow-sm"
                            style={{ zIndex: 2147483647 }}
                            role="alert"
                          >
                            {handoffMessage}
                          </div>
                        ) : null}

                        {rosterAvatarLayout.bottom.length > 0 ? (
                          <div className="absolute left-0 top-[calc(100%+6px)] flex flex-col items-start gap-1.5">
                            {rosterAvatarLayout.bottom.map((avatar) => (
                              avatar.kind === 'presenter' ? (
                                <div
                                  key={avatar.userKey}
                                  className={`w-6 h-6 rounded-full text-white text-[10px] font-semibold flex items-center justify-center border shadow-sm ${isAvatarEditingAuthority(avatar.userKey) ? 'bg-amber-500 border-amber-700 ring-2 ring-amber-200' : 'bg-slate-700 border-white/60'}`}
                                  title={`${avatar.name} (presenter)`}
                                  aria-label={`${avatar.name} is a presenter`}
                                >
                                  {avatar.initials}
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  key={avatar.userKey}
                                  data-client-id={avatar.clientId || ''}
                                  data-user-id={avatar.userId || ''}
                                  data-user-key={avatar.userKey}
                                  data-display-name={avatar.name}
                                  className={`w-6 h-6 rounded-full text-white text-[10px] font-semibold flex items-center justify-center border shadow-sm ${isAvatarEditingAuthority(avatar.userKey) ? 'bg-amber-500 border-amber-700 ring-2 ring-amber-200' : 'bg-slate-700 border-white/60'}`}
                                  title={avatar.name}
                                  aria-label={`Make ${avatar.name} the presenter`}
                                  onClick={handleRosterAttendeeAvatarClick}
                                  onPointerDown={(e) => {
                                    e.stopPropagation()
                                  }}
                                >
                                  {avatar.initials}
                                </button>
                              )
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                  {canUseTeacherKeyboardTopPanelComposerUi ? (
                    topPanelStepsPayload ? (
                      topPanelStepsPayload.steps.length ? (
                        <div
                          className="text-slate-900 leading-relaxed text-center"
                          style={topPanelRenderPayload.style}
                        >
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                            <div>
                              {topPanelStepsPayload.editingIndex !== null
                                ? `Editing step ${topPanelStepsPayload.editingIndex + 1}. Send to update it.`
                                : 'Tap a step to edit it, or start a new step.'}
                            </div>
                            <button
                              type="button"
                              className="rounded border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50"
                              onClick={() => {
                                void startNewTopPanelStepDraft()
                              }}
                            >
                              New step
                            </button>
                          </div>
                          {topPanelStepsPayload.steps.map(({ index, latex, isEditing }) => {
                            const selected = topPanelStepsPayload.selectedIndex === index
                            const mobileActionsOpen = isCompactViewport && mobileTopPanelActionStepIndex === index
                            const html = renderLatexStepInline(latex)
                            return (
                              <div key={index} className="py-1" data-top-panel-step-shell data-step-idx={String(index)}>
                                <div className={`rounded border ${selected ? 'border-slate-300 bg-slate-50' : 'border-transparent bg-transparent'}`}>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      data-top-panel-step
                                      data-step-idx={String(index)}
                                      className={`min-w-0 flex-1 rounded px-2 py-1 focus:outline-none focus:ring-0 text-center ${selected ? 'bg-slate-100' : 'bg-transparent'}`}
                                      onPointerDown={(ev) => {
                                        ev.stopPropagation()
                                        if (!isCompactViewport) return
                                        topPanelStepLongPressTriggeredRef.current = null
                                        clearTopPanelStepLongPress()
                                        topPanelStepLongPressTimeoutRef.current = setTimeout(() => {
                                          topPanelStepLongPressTimeoutRef.current = null
                                          topPanelStepLongPressTriggeredRef.current = index
                                          setTopPanelSelectedStep(index)
                                          setMobileTopPanelActionStepIndex(index)
                                        }, 420)
                                      }}
                                      onPointerUp={() => {
                                        clearTopPanelStepLongPress()
                                      }}
                                      onPointerCancel={() => {
                                        clearTopPanelStepLongPress()
                                      }}
                                      onPointerLeave={() => {
                                        clearTopPanelStepLongPress()
                                      }}
                                      onClick={(ev) => {
                                        ev.preventDefault()
                                        ev.stopPropagation()
                                        if (topPanelStepLongPressTriggeredRef.current === index) {
                                          topPanelStepLongPressTriggeredRef.current = null
                                          return
                                        }
                                        topPanelStepLongPressTriggeredRef.current = null
                                        void loadTopPanelStepForEditing(index)
                                      }}
                                    >
                                      <span className="mr-2 inline-block min-w-[2.25rem] text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                        {isEditing ? 'Edit' : `Step ${index + 1}`}
                                      </span>
                                      {html ? (
                                        <span className="inline align-middle" dangerouslySetInnerHTML={{ __html: html }} />
                                      ) : (
                                        <span className="text-slate-500">&nbsp;</span>
                                      )}
                                    </button>

                                    {selected ? (
                                      isCompactViewport ? (
                                        <div className="flex shrink-0 items-center pr-1">
                                          <button
                                            type="button"
                                            data-top-panel-step-action="menu"
                                            className={`rounded border px-2 py-1 text-[10px] font-medium ${mobileActionsOpen ? 'border-slate-300 bg-slate-100 text-slate-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                                            onClick={(ev) => {
                                              ev.preventDefault()
                                              ev.stopPropagation()
                                              setMobileTopPanelActionStepIndex(current => (current === index ? null : index))
                                            }}
                                            aria-expanded={mobileActionsOpen}
                                            aria-label={`Step ${index + 1} actions`}
                                          >
                                            Actions
                                          </button>
                                        </div>
                                      ) : (
                                        <div className="flex shrink-0 items-center gap-1 pr-1">
                                          {!isEditing ? (
                                            <button
                                              type="button"
                                              data-top-panel-step-action="edit"
                                              className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
                                              onClick={(ev) => {
                                                ev.preventDefault()
                                                ev.stopPropagation()
                                                void loadTopPanelStepForEditing(index)
                                              }}
                                            >
                                              Edit
                                            </button>
                                          ) : null}
                                          <button
                                            type="button"
                                            data-top-panel-step-action="duplicate"
                                            className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
                                            onClick={(ev) => {
                                              ev.preventDefault()
                                              ev.stopPropagation()
                                              void duplicateTopPanelStepAsNew(index)
                                            }}
                                          >
                                            Copy
                                          </button>
                                          <button
                                            type="button"
                                            data-top-panel-step-action="delete"
                                            className="rounded border border-red-200 bg-white px-2 py-1 text-[10px] font-medium text-red-700 hover:bg-red-50"
                                            onClick={(ev) => {
                                              ev.preventDefault()
                                              ev.stopPropagation()
                                              void deleteTopPanelStep(index)
                                            }}
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      )
                                    ) : null}
                                  </div>

                                  {selected && mobileActionsOpen ? (
                                    <div className="px-2 pb-2">
                                      <div
                                        className="mt-1 flex flex-wrap items-center gap-1 rounded-md border border-slate-200 bg-white p-1.5"
                                        data-top-panel-step-action="menu-panel"
                                      >
                                        {!isEditing ? (
                                          <button
                                            type="button"
                                            data-top-panel-step-action="edit"
                                            className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
                                            onClick={(ev) => {
                                              ev.preventDefault()
                                              ev.stopPropagation()
                                              setMobileTopPanelActionStepIndex(null)
                                              void loadTopPanelStepForEditing(index)
                                            }}
                                          >
                                            Edit
                                          </button>
                                        ) : null}
                                        <button
                                          type="button"
                                          data-top-panel-step-action="duplicate"
                                          className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
                                          onClick={(ev) => {
                                            ev.preventDefault()
                                            ev.stopPropagation()
                                            setMobileTopPanelActionStepIndex(null)
                                            void duplicateTopPanelStepAsNew(index)
                                          }}
                                        >
                                          Copy as new
                                        </button>
                                        <button
                                          type="button"
                                          data-top-panel-step-action="delete"
                                          className="rounded border border-red-200 bg-white px-2 py-1 text-[10px] font-medium text-red-700 hover:bg-red-50"
                                          onClick={(ev) => {
                                            ev.preventDefault()
                                            ev.stopPropagation()
                                            setMobileTopPanelActionStepIndex(null)
                                            void deleteTopPanelStep(index)
                                          }}
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    </div>
                                  ) : null}

                                  {selected ? (
                                    <div className="px-2 pb-2 text-left text-[10px] text-slate-500">
                                      {isEditing
                                        ? 'This step is loaded into the board. Send to update it, or choose New step to append instead.'
                                        : (isCompactViewport
                                          ? 'Use Actions to edit, copy, or delete this step.'
                                          : 'Select Edit to overwrite this step, or Copy to use it as the starting point for a new step.')}
                                    </div>
                                  ) : null}
                                </div>
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
                        data-top-panel-katex-display="true"
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
                      {quizActive && !isAssignmentView && quizTimeLeftSec != null ? (
                        <div className="mb-2 flex items-center justify-end text-xs text-slate-500">
                          Time left: {formatCountdown(quizTimeLeftSec)}
                        </div>
                      ) : null}

                      {!hasWriteAccess && quizActive && !isAssignmentView ? (
                        <>
                          {topPanelRenderPayload.markup ? (
                            <div
                              data-top-panel-katex-display="true"
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
                          data-top-panel-katex-display="true"
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
                        data-top-panel-katex-display="true"
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
            )}
            {!isRawInkMode && (
            <div
              role="separator"
              aria-orientation="horizontal"
              ref={splitHandleRef}
              className="relative z-20 flex items-center justify-center px-4 py-2 bg-white cursor-row-resize select-none"
              aria-hidden={shouldCollapseStackedView}
              style={{
                touchAction: 'none',
                opacity: shouldCollapseStackedView ? 0 : 1,
                pointerEvents: shouldCollapseStackedView ? 'none' : undefined,
                minHeight: shouldCollapseStackedView ? 0 : undefined,
                maxHeight: shouldCollapseStackedView ? 0 : undefined,
                paddingTop: shouldCollapseStackedView ? 0 : undefined,
                paddingBottom: shouldCollapseStackedView ? 0 : undefined,
                overflow: shouldCollapseStackedView ? 'hidden' : undefined,
              }}
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
            )}
            <div
              className="px-4 pb-3 flex flex-col min-h-0"
              style={{
                flex: shouldCollapseStackedView ? 0 : (isRawInkMode ? 1 : Math.max(1 - studentSplitRatio, 0.2)),
                minHeight: shouldCollapseStackedView ? 0 : (recognitionEngine === 'keyboard'
                  ? `calc(${KEYBOARD_BOTTOM_CHROME_MIN_HEIGHT_PX + KEYBOARD_FIXED_PANEL_MIN_HEIGHT_PX + KEYBOARD_MATHLIVE_MIN_HEIGHT_PX}px + env(safe-area-inset-bottom, 0px))`
                  : '220px'),
                maxHeight: shouldCollapseStackedView ? 0 : undefined,
                opacity: shouldCollapseStackedView ? 0 : 1,
                pointerEvents: shouldCollapseStackedView ? 'none' : undefined,
                overflow: shouldCollapseStackedView ? 'hidden' : undefined,
                paddingTop: shouldCollapseStackedView ? 0 : undefined,
                paddingBottom: shouldCollapseStackedView ? 0 : undefined,
              }}
              aria-hidden={shouldCollapseStackedView}
            >
              <div className={`flex items-center mb-2 ${canPersistLatex ? 'justify-between' : 'justify-end'}`}>
                {!isRawInkMode && canPersistLatex ? (
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
                              className="px-2 py-1 text-slate-700 transition-colors hover:text-slate-900 disabled:opacity-50"
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
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.9"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className="text-slate-700"
                                  aria-hidden="true"
                                >
                                  <path d="M7 4.5h8.5L19 8v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 19V6a1.5 1.5 0 0 1 1-1.41Z" />
                                  <path d="M15 4.5V8h3.5" />
                                  <path d="M9 11h6" />
                                  <path d="M9 14.5h6" />
                                  <path d="M9 18h4" />
                                </svg>
                            </button>

                            <button
                              type="button"
                              className="px-2 py-1 text-slate-700 transition-colors hover:text-slate-900 disabled:opacity-50"
                              title="Undo"
                              onClick={() => runCanvasAction(handleUndo)}
                              disabled={!areMiddleStripEditorActionsReady || Boolean(fatalError) || (!canUseTeacherKeyboardLocalToolbarActions && isViewOnly) || (!canUndo && !(useAdminStepComposer && hasWriteAccess))}
                              onPointerDown={(e) => {
                                if (!areMiddleStripEditorActionsReady || Boolean(fatalError) || (!canUseTeacherKeyboardLocalToolbarActions && isViewOnly)) return
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
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.9"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="text-slate-700"
                                aria-hidden="true"
                              >
                                <path d="M9 7 4.5 11.5 9 16" />
                                <path d="M4.5 11.5H13a6.5 6.5 0 1 1 0 13h-1" />
                              </svg>
                            </button>

                            <button
                              type="button"
                              className="px-2 py-1 text-slate-700 transition-colors hover:text-slate-900 disabled:opacity-50"
                              title="Redo"
                              onClick={() => runCanvasAction(handleRedo)}
                              disabled={!areMiddleStripEditorActionsReady || Boolean(fatalError) || (!canUseTeacherKeyboardLocalToolbarActions && isViewOnly) || (!canRedo && !(useAdminStepComposer && hasWriteAccess))}
                              onPointerDown={(e) => {
                                if (!areMiddleStripEditorActionsReady || Boolean(fatalError) || (!canUseTeacherKeyboardLocalToolbarActions && isViewOnly)) return
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
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.9"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="text-slate-700"
                                aria-hidden="true"
                              >
                                <path d="m15 7 4.5 4.5L15 16" />
                                <path d="M19.5 11.5H11a6.5 6.5 0 1 0 0 13h1" />
                              </svg>
                            </button>

                            <button
                              type="button"
                              className="px-2 py-1 text-slate-700 transition-colors hover:text-slate-900 disabled:opacity-50"
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
                              disabled={!canClear || !areMiddleStripEditorActionsReady || Boolean(fatalError) || (!canUseTeacherKeyboardLocalToolbarActions && isViewOnly)}
                              onPointerDown={(e) => {
                                if (!areMiddleStripEditorActionsReady || Boolean(fatalError) || (!canUseTeacherKeyboardLocalToolbarActions && isViewOnly)) return
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
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.9"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="text-slate-700"
                                aria-hidden="true"
                              >
                                <path d="M4 7h16" />
                                <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
                                <path d="M7 7l.8 11a2 2 0 0 0 2 1.85h4.4a2 2 0 0 0 2-1.85L17 7" />
                                <path d="M10 10.5v5" />
                                <path d="M14 10.5v5" />
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

                {!isRawInkMode && (
                <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="px-2 py-1 text-slate-700 transition-colors hover:text-slate-900 disabled:opacity-50"
                        title="Compute answer"
                        onClick={() => runCanvasAction(appendComputedLineFromLastStep)}
                        disabled={Boolean(fatalError)}
                      >
                        <span className="sr-only">Compute</span>
                        <span className="text-[18px] font-semibold leading-none text-slate-700" aria-hidden="true">=</span>
                      </button>
                </div>
                )}

                {shouldShowMiddleStripActionCluster ? (
                  <div className="flex items-center gap-2">
                    {canUsePresenterMiddleStripTools && isCompactViewport && (
                      <button
                        type="button"
                        className="px-2 py-1 text-slate-700 transition-colors hover:text-slate-900 disabled:opacity-50"
                        title="Diagrams"
                        onClick={() => {
                          const now = Date.now()
                          const lastTap = diagramIconLastTapRef.current

                          if (diagramIconTapTimeoutRef.current) {
                            clearTimeout(diagramIconTapTimeoutRef.current)
                            diagramIconTapTimeoutRef.current = null
                          }

                          if (lastTap && (now - lastTap) < 320) {
                            diagramIconLastTapRef.current = null
                            try {
                              window.dispatchEvent(new CustomEvent('philani-diagrams:open-grid'))
                            } catch {}
                            return
                          }

                          diagramIconLastTapRef.current = now
                          diagramIconTapTimeoutRef.current = setTimeout(() => {
                            diagramIconTapTimeoutRef.current = null
                            diagramIconLastTapRef.current = null
                            toggleMobileDiagramTray()
                            openPickerOrApplySingle('diagram')
                          }, 260)
                        }}
                        disabled={Boolean(fatalError)}
                      >
                        <span className="sr-only">Diagrams</span>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          width="18"
                          height="18"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-slate-700"
                          aria-hidden="true"
                        >
                          <rect x="3.5" y="4.5" width="7" height="7" rx="1.5" />
                          <rect x="13.5" y="4.5" width="7" height="7" rx="1.5" />
                          <rect x="8.5" y="13.5" width="7" height="7" rx="1.5" />
                          <path d="M10.5 8h3" />
                          <path d="M12 11.5v2" />
                        </svg>
                      </button>
                    )}

                    {!isRawInkMode && showTextIcon && (
                      <button
                        type="button"
                        className="px-2 py-1 text-slate-700 transition-colors hover:text-slate-900 disabled:opacity-50"
                        title="Text"
                        onClick={() => {
                          if (canUseKeyboardTextRecallMode) {
                            if (topPanelEditingMode) {
                              if (textIconTapTimeoutRef.current) {
                                clearTimeout(textIconTapTimeoutRef.current)
                                textIconTapTimeoutRef.current = null
                              }

                              textIconLastTapRef.current = null
                              setTopPanelEditingMode(false)
                              clearTopPanelSelection()
                              setMobileTopPanelActionStepIndex(null)

                              if (useAdminStepComposer) {
                                setKeyboardEditIndex(null)
                              }
                              if (useStudentStepComposer) {
                                setStudentEditIndex(null)
                              }
                              return
                            }

                            const keyboardRecallSteps = useAdminStepComposer
                              ? keyboardSteps
                              : (studentSteps.length ? studentSteps : derivedStudentCommittedSteps)
                            const fallbackIndex = keyboardRecallSteps.length > 0 ? keyboardRecallSteps.length - 1 : null
                            const preferredIndex = activeComposerEditIndex ?? topPanelSelectedStep ?? fallbackIndex

                            if (textIconTapTimeoutRef.current) {
                              clearTimeout(textIconTapTimeoutRef.current)
                              textIconTapTimeoutRef.current = null
                            }

                            textIconLastTapRef.current = null
                            setTopPanelEditingMode(true)
                            if (preferredIndex !== null && preferredIndex >= 0) {
                              setTopPanelSelectedStep(preferredIndex)
                            } else {
                              clearTopPanelSelection()
                            }
                            return
                          }

                          const canOpenTray = canOrchestrateLesson || allowStudentTextTray
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
                              if (canOrchestrateLesson) {
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
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-slate-700"
                          aria-hidden="true"
                        >
                          <path d="M5 6.5h14" />
                          <path d="M12 6.5v11" />
                          <path d="M8.5 17.5h7" />
                        </svg>
                      </button>
                    )}

                    {isOverlayMode && canUsePresenterMiddleStripTools && (
                      <button
                        type="button"
                        className={`px-2 py-1 transition-colors hover:text-slate-900 ${isEraserMode ? 'text-slate-900' : 'text-slate-700'} ${(!canUseTeacherKeyboardLocalToolbarActions && isViewOnly) ? 'opacity-50' : ''}`}
                        title={isEraserMode ? (eraserShimReady ? 'Eraser (on)' : 'Eraser (on, initializing)') : (eraserShimReady ? 'Eraser' : 'Eraser (initializing)')}
                        aria-pressed={isEraserMode}
                        onClick={(e) => {
                          if (eraserLongPressTriggeredRef.current) {
                            eraserLongPressTriggeredRef.current = false
                            e.preventDefault()
                            e.stopPropagation()
                            return
                          }
                          if (!canUseTeacherKeyboardLocalToolbarActions && isViewOnly) return
                          setIsEraserMode(prev => !prev)
                        }}
                          disabled={!areMiddleStripEditorActionsReady || Boolean(fatalError) || (!canUseTeacherKeyboardLocalToolbarActions && isViewOnly)}
                        onPointerDown={(e) => {
                            if (!areMiddleStripEditorActionsReady || Boolean(fatalError) || (!canUseTeacherKeyboardLocalToolbarActions && isViewOnly)) return
                          eraserLongPressTriggeredRef.current = false
                          if (eraserLongPressTimeoutRef.current) {
                            clearTimeout(eraserLongPressTimeoutRef.current)
                            eraserLongPressTimeoutRef.current = null
                          }
                          if (canOrchestrateLesson) {
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
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={isEraserMode ? 'text-slate-900' : 'text-slate-700'}
                          aria-hidden="true"
                        >
                          <path d="m14.5 4.5 5 5" />
                          <path d="m4.5 14.5 8.5-8.5a2.12 2.12 0 0 1 3 0l2 2a2.12 2.12 0 0 1 0 3l-5.5 5.5a2 2 0 0 1-1.41.59H7.1a2 2 0 0 1-1.41-.59l-1.19-1.19a1.95 1.95 0 0 1 0-2.76Z" />
                          <path d="M13 17.5 18.5 12" />
                          <path d="M4 20h8" />
                        </svg>
                      </button>
                    )}



                    {!isRawInkMode && (
                    <div className="flex items-center gap-2">
                      {isEditingExistingTopPanelStep && !isAssignmentSolutionAuthoring ? (
                        <>
                          <button
                            type="button"
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            title="Start a new step"
                            onClick={() => {
                              void startNewTopPanelStepDraft()
                            }}
                            disabled={!areMiddleStripEditorActionsReady || Boolean(fatalError)}
                          >
                            New step
                          </button>
                        </>
                      ) : null}

                      <button
                        type="button"
                        className="px-2 py-1 text-slate-700 transition-colors hover:text-slate-900 disabled:opacity-50"
                        title={isAssignmentSolutionAuthoring ? 'Commit / Save' : (isEditingExistingTopPanelStep ? 'Update step' : 'Send step')}
                        onClick={handleSendStepClick}
                        disabled={
                          !areMiddleStripEditorActionsReady
                          || Boolean(fatalError)
                          || (
                            isStudentSendContext
                              ? quizSubmitting
                                : (canUseAdminSend
                                ? (adminSendingStep || !canUseKeyboardSendAction)
                                : true)
                          )
                        }
                      >
                        <span className="sr-only">{isEditingExistingTopPanelStep ? 'Update step' : 'Send step'}</span>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          width="18"
                          height="18"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-slate-700"
                          aria-hidden="true"
                        >
                          <path d="M21 3 10 14" />
                          <path d="m21 3-7 18-4-7-7-4 18-7Z" />
                        </svg>
                      </button>
                    </div>
                    )}

                    {isCompactViewport && mobileLatexTrayOpen && (
                      <BottomSheet
                        open
                        title={isLessonAuthoring ? 'LaTeX for this point' : 'LaTeX'}
                        onClose={() => setMobileLatexTrayOpen(false)}
                        style={{ bottom: viewportBottomOffsetPx + STACKED_BOTTOM_OVERLAY_RESERVE_PX + 8 }}
                        className="rounded-lg"
                      >
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
                      </BottomSheet>
                    )}

                    {isCompactViewport && mobileModulePicker && (
                      <BottomSheet
                        open
                        backdrop
                        title={`${mobileModulePicker.type === 'diagram' ? 'Diagrams' : mobileModulePicker.type === 'text' ? 'Text' : 'LaTeX'} for this point`}
                        onClose={closeMobileModulePicker}
                        style={{ bottom: viewportBottomOffsetPx + STACKED_BOTTOM_OVERLAY_RESERVE_PX + 88 }}
                        className="rounded-lg"
                      >
                        <div className="max-h-[40vh] overflow-auto">
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
                      </BottomSheet>
                    )}
                  </div>
                ) : null}
              </div>

              {recognitionEngine === 'keyboard' ? (
                <div className={`${useCompactEdgeToEdge ? 'rounded-none' : 'rounded'} bg-white relative overflow-hidden flex flex-col flex-1 min-h-0`}>
                  {renderKeyboardCanvasSurface()}
                </div>
              ) : (
              <div className="rounded bg-white relative overflow-hidden flex flex-col flex-1 min-h-0">
                <div
                  ref={studentViewportRef}
                  className="relative flex-1 min-h-0 overflow-auto"
                  style={{
                    touchAction: 'pan-x pan-y',
                    WebkitOverflowScrolling: 'touch',
                    paddingBottom: showBottomHorizontalScrollbar
                      ? `calc(env(safe-area-inset-bottom) + ${viewportBottomOffsetPx}px + ${STACKED_BOTTOM_OVERLAY_RESERVE_PX}px)`
                      : undefined,
                  }}
                >
                  <div
                    ref={stackedZoomContentRef}
                    className="flex min-w-full flex-col w-max items-center gap-6 px-4 py-4 sm:px-6 sm:py-6"
                    style={{
                      zoom: stackedLiveScale,
                      paddingTop: 'calc(max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px)) + 14px)',
                      willChange: stackedPinchStateRef.current.active ? 'transform' : undefined,
                    }}
                  >
                    <div className="w-full flex items-start justify-center">
                      <div
                        style={{
                          position: 'relative',
                          backgroundColor: '#ffffff',
                          width: `${Math.max(320, Math.round(stackedSurfaceBaseSize.width * inkSurfaceWidthFactor))}px`,
                          height: `${Math.max(320, stackedSurfaceBaseSize.height)}px`,
                        }}
                      >
                        <div
                          ref={editorHostRef}
                          className={editorHostClass}
                          style={{
                            ...editorHostStyle,
                            height: '100%',
                            opacity: 1,
                            pointerEvents: editorHostStyle.pointerEvents,
                          }}
                          data-orientation={canvasOrientation}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {!isRawInkMode && !editorReconnecting && (status === 'loading' || status === 'idle') && (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500 bg-white/70">
                    Preparing collaborative canvas…
                  </div>
                )}
                {isViewOnly && !forceEditableForAssignment && !(isSessionQuizMode && quizActive && !canOrchestrateLesson) && !(!canOrchestrateLesson && !useStackedStudentLayout && latexDisplayState.enabled) && (
                  <div className="absolute inset-0 flex items-center justify-center text-xs sm:text-sm text-white text-center px-4 bg-slate-900/40 pointer-events-none">
                    {controlOwnerLabel || 'Teacher'} locked the board. You're in view-only mode.
                  </div>
                )}
                {useStackedStudentLayout && !shouldCollapseStackedView && stackedZoomHudMounted && (
                  <div
                    className={`absolute left-3 bottom-3 z-20 pointer-events-none rounded-full border border-slate-200/80 bg-white/88 px-3 py-1 text-[11px] font-medium tracking-[0.08em] text-slate-700 shadow-sm backdrop-blur-sm transition-opacity duration-700 ease-out ${stackedZoomHudActive ? 'opacity-100' : 'opacity-0'}`}
                    style={{ bottom: `calc(env(safe-area-inset-bottom, 0px) + ${showBottomHorizontalScrollbar ? (viewportBottomOffsetPx + STACKED_BOTTOM_OVERLAY_RESERVE_PX + 8) : 12}px)` }}
                    aria-hidden="true"
                  >
                    {`${Math.round(stackedEffectiveZoom * 100)}%`}
                  </div>
                )}
                {useStackedStudentLayout && !shouldCollapseStackedView && canUseScrollDebugPanel && (
                  <div
                    className="absolute right-3 bottom-3 z-20 pointer-events-none rounded-2xl border border-slate-200/80 bg-white/90 px-3 py-2 font-mono text-[10px] leading-4 text-slate-700 shadow-sm backdrop-blur-sm"
                    style={{ bottom: `calc(env(safe-area-inset-bottom, 0px) + ${showBottomHorizontalScrollbar ? (viewportBottomOffsetPx + STACKED_BOTTOM_OVERLAY_RESERVE_PX + 8) : 12}px)` }}
                    aria-hidden="true"
                  >
                    <div>{stackedScrollDebugLabel.horizontal}</div>
                    <div>{stackedScrollDebugLabel.vertical}</div>
                  </div>
                )}
                {!canOrchestrateLesson && !useStackedStudentLayout && latexDisplayState.enabled && (
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
              )}
            </div>
          </div>
        )}

        {hasMounted && horizontalScrollbar}
        {hasMounted && leftVerticalScrollbar}
        {hasMounted && rightMasterGainSlider}

        {!useStackedStudentLayout && (
          <div className={`${recognitionEngine === 'keyboard' ? '' : 'border rounded'} bg-white relative overflow-hidden ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
          <div
            ref={editorHostRef}
            className={editorHostClass}
            style={{
              ...editorHostStyle,
              opacity: recognitionEngine === 'keyboard' ? 0 : 1,
              pointerEvents: recognitionEngine === 'keyboard' ? 'none' : editorHostStyle.pointerEvents,
            }}
            data-orientation={canvasOrientation}
          />

          {recognitionEngine === 'keyboard' && renderKeyboardCanvasSurface()}

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
                            body: JSON.stringify({
                              sessionKey: channelName,
                              imageUrl: url,
                              title: diagramTitleInput || toDisplayFileName(file.name) || file.name,
                            }),
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

                    {canOrchestrateLesson && diagramContextMenu && diagramContextMenu.diagramId === activeDiagram.id && (
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

          {recognitionEngine !== 'keyboard' && !editorReconnecting && (status === 'loading' || status === 'idle') && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500 bg-white/70">
              Preparing collaborative canvas…
            </div>
          )}
          {status === 'error' && fatalError && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-red-600 bg-white/80 text-center px-4">
              {fatalError}
            </div>
          )}
          {editorReconnecting && (
            <div className="absolute inset-0 z-20 pointer-events-none bg-transparent" aria-hidden="true" />
          )}
          {recognitionEngine !== 'keyboard' && isViewOnly && !(isSessionQuizMode && quizActive && !canOrchestrateLesson) && !(!canOrchestrateLesson && !useStackedStudentLayout && latexDisplayState.enabled) && (
            <div className="absolute inset-0 flex items-center justify-center text-xs sm:text-sm text-white text-center px-4 bg-slate-900/40 pointer-events-none">
              {controlOwnerLabel || 'Teacher'} locked the board. You're in view-only mode.
            </div>
          )}
          {recognitionEngine !== 'keyboard' && !canOrchestrateLesson && !useStackedStudentLayout && latexDisplayState.enabled && (
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
              {canOrchestrateLesson
                ? orientationLockedToLandscape
                  ? 'Fullscreen keeps you in landscape for the widest writing surface.'
                  : 'Switch layouts when not projecting fullscreen.'
                : 'Choose the layout that fits your device—this only affects your view.'}
            </p>
          </div>
        )}

        {canOrchestrateLesson && !isOverlayMode && (
          <div className="canvas-settings-panel">
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Recognition engine</span>
              <select
                className="canvas-settings-panel__select"
                value={recognitionEngine}
                onChange={e => {
                  const next = e.target.value as RecognitionEngine
                  setRecognitionEngine(next)
                  setMathpixError(null)
                  if (next === 'keyboard') {
                    const seed = getLatexFromEditorModel() || latexOutputRef.current || ''
                    setLatexOutput(seed)
                    if (useAdminStepComposerRef.current && hasControllerRights()) {
                      setAdminDraftLatex(normalizeStepLatex(seed))
                    }
                  }
                }}
                disabled={status !== 'ready' || Boolean(fatalError)}
                aria-label="Choose recognition engine"
              >
                <option value="keyboard">Keyboard (default)</option>
                <option value="myscript">MyScript (handwriting)</option>
                <option value="mathpix">Mathpix (backup)</option>
              </select>
            </label>
            {recognitionEngine === 'mathpix' && mathpixError && (
              <span className="text-[11px] text-red-600">{mathpixError}</span>
            )}
            {recognitionEngine === 'keyboard' && (
              <label className="flex flex-col gap-1">
                <span className="font-semibold">Keyboard input (LaTeX)</span>
                <textarea
                  className="canvas-settings-panel__select min-h-[110px]"
                  value={latexOutput}
                  onChange={e => {
                    const next = e.target.value
                    setLatexOutput(next)
                    if (useAdminStepComposerRef.current && hasControllerRights()) {
                      setAdminDraftLatex(normalizeStepLatex(next))
                    }
                  }}
                  placeholder="Type LaTeX here, e.g. \\frac{x+1}{2}=y"
                  aria-label="Keyboard latex input"
                />
                <div className="flex flex-wrap gap-1">
                  {KEYBOARD_ENGINE_TEMPLATES.map((token) => (
                    <button
                      key={token}
                      type="button"
                      className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px]"
                      onClick={() => {
                        const next = `${latexOutput}${token}`
                        setLatexOutput(next)
                        if (useAdminStepComposerRef.current && hasControllerRights()) {
                          setAdminDraftLatex(normalizeStepLatex(next))
                        }
                      }}
                    >
                      {token}
                    </button>
                  ))}
                </div>
              </label>
            )}
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
            {canUseDebugPanel && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={debugPanelVisible}
                  onChange={e => setDebugPanelVisible(e.target.checked)}
                />
                <span className="font-semibold">Show debug panel</span>
              </label>
            )}
          </div>
        )}

        {canOrchestrateLesson && !isOverlayMode && (
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

        {!isOverlayMode && canOrchestrateLesson && (
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
        {canUseDebugPanel && (
          <RecognitionDebugPanel
            visible={debugPanelVisible}
            title="Recognition Debug"
            sections={debugSections}
            onClose={() => setDebugPanelVisible(false)}
            storageKey={`${DEBUG_PANEL_STORAGE_KEY}:pos`}
          />
        )}
        {canUseDebugPanel && !debugPanelVisible && (
          <button
            type="button"
            onClick={() => setDebugPanelVisible(true)}
            style={{
              position: 'fixed',
              right: 16,
              bottom: 16,
              zIndex: 10000,
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(15,23,42,0.88)',
              color: '#fff',
              padding: '10px 14px',
              fontSize: 12,
              fontWeight: 600,
              boxShadow: '0 12px 30px rgba(15,23,42,0.35)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}
          >
            Open recognition debug
          </button>
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
                  const isPresenter = (activePresenterUserKeyRef.current && userKey === activePresenterUserKeyRef.current)
                    || activePresenterClientIdsRef.current.has(c.clientId)
                  return !isPresenter
                })
                .map(c => (
                  <option key={c.clientId} value={c.clientId}>
                    {(() => {
                      const displayName = normalizeName((c as any)?.name || '') || String(c.clientId)
                      const cUserId = typeof (c as any)?.userId === 'string' ? String((c as any).userId) : undefined
                      const userKey = getUserKey(cUserId, displayName) || `name:${normalizeName(displayName).toLowerCase()}`
                      const isPresenter = (activePresenterUserKeyRef.current && userKey === activePresenterUserKeyRef.current)
                        || activePresenterClientIdsRef.current.has(c.clientId)
                      return displayName + (presenterStateVersion >= 0 && isPresenter ? ' (presenter)' : '')
                    })()}
                  </option>
                ))}
            </select>
          )}
          {canOrchestrateLesson && selectedClientId !== 'all' && (
            <button
              type="button"
              onClick={() => {
                const resolved = connectedClientsRef.current.find(c => c.clientId === selectedClientId)
                const resolvedName = normalizeName((resolved as any)?.name || '') || String(selectedClientId)
                const resolvedUserId = typeof (resolved as any)?.userId === 'string' ? String((resolved as any).userId) : undefined
                const userKey = getUserKey(resolvedUserId, resolvedName) || `name:${normalizeName(resolvedName).toLowerCase()}`
                const isPresenter = (activePresenterUserKeyRef.current && userKey === activePresenterUserKeyRef.current)
                  || activePresenterClientIdsRef.current.has(selectedClientId)
                void setPresenterForClient(selectedClientId, !isPresenter)
              }}
              className="canvas-admin-controls__button"
              disabled={Boolean(fatalError) || status !== 'ready'}
            >
              {(() => {
                const resolved = connectedClientsRef.current.find(c => c.clientId === selectedClientId)
                const resolvedName = normalizeName((resolved as any)?.name || '') || String(selectedClientId)
                const resolvedUserId = typeof (resolved as any)?.userId === 'string' ? String((resolved as any).userId) : undefined
                const userKey = getUserKey(resolvedUserId, resolvedName) || `name:${normalizeName(resolvedName).toLowerCase()}`
                const isPresenter = (activePresenterUserKeyRef.current && userKey === activePresenterUserKeyRef.current)
                  || activePresenterClientIdsRef.current.has(selectedClientId)
                return isPresenter ? 'Clear Presenter' : 'Make Presenter'
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
        <FullScreenGlassOverlay
          title="Save As"
          subtitle="Saves the full question (all top steps) into Notes."
          variant="light"
          panelSize="auto"
          zIndexClassName="z-[9999]"
          onClose={() => setFinishQuestionModalOpen(false)}
          onBackdropClick={() => setFinishQuestionModalOpen(false)}
          closeDisabled={isSavingLatex}
          frameClassName="absolute inset-0 flex items-center justify-center p-3"
          panelClassName="w-[min(720px,calc(100vw-24px))] overflow-hidden rounded-[28px] border border-white/60 bg-white/90 shadow-[0_30px_90px_rgba(15,23,42,0.22)] backdrop-blur-xl"
          contentClassName="overflow-hidden p-0"
        >
          <form
            className="relative overflow-hidden"
            onSubmit={(e) => {
              e.preventDefault()
              void confirmFinishQuestionSave()
            }}
          >
            <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-cyan-200/45 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-12 -left-10 h-36 w-36 rounded-full bg-amber-200/50 blur-3xl" />
            <div className="relative p-4 sm:p-6">
              <div className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(248,250,252,0.93))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Question Preview</div>
                    <div className="mt-1 text-sm text-slate-600">Readable title, typeset math, and clearer save choices.</div>
                  </div>
                  <div className="inline-flex items-center rounded-full border border-slate-200 bg-white/85 px-3 py-1 text-[11px] font-medium text-slate-600 shadow-sm">
                    {(recognitionEngine === 'keyboard' ? keyboardSteps.length : adminSteps.length)} step{(recognitionEngine === 'keyboard' ? keyboardSteps.length : adminSteps.length) === 1 ? '' : 's'}
                  </div>
                </div>

                <div className="mt-4 rounded-[20px] border border-slate-200/80 bg-[radial-gradient(circle_at_top_left,rgba(240,249,255,0.95),rgba(255,255,255,0.92)_55%,rgba(248,250,252,0.96))] px-4 py-3 shadow-sm">
                  {finishQuestionSourcePreviewHtml ? (
                    <div
                      className="min-h-[52px] text-base leading-relaxed text-slate-900 [&_.katex]:text-base [&_.katex-display]:my-0 [&_.katex-display]:text-left"
                      dangerouslySetInnerHTML={{ __html: finishQuestionSourcePreviewHtml }}
                    />
                  ) : (
                    <div className="min-h-[52px] text-sm text-slate-500">No rendered preview available yet.</div>
                  )}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Title</label>
                    <input
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-200/70"
                      value={finishQuestionTitle}
                      onChange={(e) => setFinishQuestionTitle(e.target.value)}
                      autoFocus
                      placeholder="e.g. Solve for x"
                    />
                    <div className="mt-2 text-[11px] text-slate-500">The title is plain language. The math is preserved in the saved steps and preview.</div>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-[50px] items-center justify-center rounded-2xl border border-slate-200 bg-white/92 px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => setFinishQuestionTitle(finishQuestionSuggestedTitle || 'Untitled question')}
                    disabled={isSavingLatex || !finishQuestionSuggestedTitle || finishQuestionTitle.trim() === (finishQuestionSuggestedTitle || '').trim()}
                  >
                    Use Suggestion
                  </button>
                </div>

                {finishQuestionNoteId && (
                  <div className="mt-3 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500">
                    Internal ID: <span className="ml-1 font-mono text-slate-700">{finishQuestionNoteId}</span>
                  </div>
                )}

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <button
                    type="button"
                    className="rounded-[22px] border border-slate-200 bg-white/84 p-4 text-left shadow-sm transition hover:-translate-y-[1px] hover:border-slate-300 hover:shadow-md disabled:transform-none disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => { void confirmFinishQuestionDraftSave() }}
                    disabled={isSavingLatex || !finishQuestionNoteId}
                  >
                    <div className="text-sm font-semibold text-slate-900">{isSavingLatex ? 'Saving…' : 'Save Draft'}</div>
                    <div className="mt-1 text-xs leading-relaxed text-slate-500">Update this solution and keep working on the same board state.</div>
                  </button>
                  <button
                    type="button"
                    className="rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(241,245,249,0.96))] p-4 text-left shadow-sm transition hover:-translate-y-[1px] hover:border-slate-300 hover:shadow-md disabled:transform-none disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => { void confirmFinishQuestionForkSave() }}
                    disabled={isSavingLatex || !finishQuestionNoteId}
                  >
                    <div className="text-sm font-semibold text-slate-900">{isSavingLatex ? 'Saving…' : 'Save As New'}</div>
                    <div className="mt-1 text-xs leading-relaxed text-slate-500">Fork a new solution lineage from the work currently on the board.</div>
                  </button>
                  <button
                    type="submit"
                    className="rounded-[22px] border border-slate-900/10 bg-[linear-gradient(135deg,#0f172a,#1e293b)] p-4 text-left text-white shadow-[0_12px_30px_rgba(15,23,42,0.22)] transition hover:-translate-y-[1px] hover:shadow-[0_16px_36px_rgba(15,23,42,0.28)] disabled:transform-none disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSavingLatex || !finishQuestionNoteId}
                  >
                    <div className="text-sm font-semibold">{isSavingLatex ? 'Saving…' : 'Save Final'}</div>
                    <div className="mt-1 text-xs leading-relaxed text-slate-300">Finish this question, save it cleanly, and clear the board for the next one.</div>
                  </button>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-200/80 pt-4">
                  <div className="text-[11px] leading-relaxed text-slate-500">
                    Draft keeps continuity. New branches. Final closes the question.
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => setFinishQuestionModalOpen(false)}
                    disabled={isSavingLatex}
                  >
                    Cancel
                  </button>
                </div>
              </div>
              {latexSaveError && (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50/90 px-4 py-3 text-xs text-red-700 shadow-sm">{latexSaveError}</div>
              )}
            </div>
          </form>
        </FullScreenGlassOverlay>
      )}

      {notesLibraryOpen && (
        <FullScreenGlassOverlay
          title="Notes"
          subtitle="Saved questions for this session"
          variant="light"
          panelSize="auto"
          zIndexClassName="z-[10000]"
          onClose={() => setNotesLibraryOpen(false)}
          onBackdropClick={() => setNotesLibraryOpen(false)}
          frameClassName="absolute inset-0 flex items-center justify-center p-3"
          panelClassName="w-[min(980px,calc(100vw-24px))] max-h-[min(82vh,760px)] rounded-lg"
          contentClassName="p-0 overflow-hidden flex flex-col"
          rightActions={
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { void openNotesLibrary() }}
              disabled={notesLibraryLoading}
            >
              Refresh
            </button>
          }
        >
          <div className="flex-1 overflow-auto p-4">
            {notesLibraryLoading ? (
              <div className="text-sm text-slate-600">Loading…</div>
            ) : notesLibraryError ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {notesLibraryError}
              </div>
            ) : notesLibraryItems.length === 0 ? (
              <div className="text-sm text-slate-600">No saved questions yet.</div>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
                <div className="space-y-3">
                  {notesLibraryGroups.map((group) => {
                    const isActiveGroup = Boolean(activeNotebookSolutionId && group.solutionId === activeNotebookSolutionId)
                    const isSelectedGroup = selectedNotesLibraryGroup?.solutionId === group.solutionId
                    const isCollapsed = notesLibraryCollapsedSolutionIds.includes(group.solutionId)
                    const showItems = !isCollapsed || isSelectedGroup
                    const isLoadedGroup = Boolean(loadedNotebookRevision?.solutionId && group.solutionId === loadedNotebookRevision.solutionId)
                    return (
                      <div
                        key={group.solutionId}
                        className={`rounded-lg border bg-white ${isActiveGroup ? 'border-slate-400 shadow-sm' : 'border-slate-200'}`}
                      >
                        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2">
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => setNotesLibrarySelectedSolutionId(group.solutionId)}
                          >
                            <div className="truncate text-sm font-semibold text-slate-800">{group.title}</div>
                            <div className="text-[11px] text-slate-500">
                              {group.items.length === 1 ? '1 revision' : `${group.items.length} revisions`}
                            </div>
                          </button>
                          <div className="flex items-center gap-2">
                            {isActiveGroup && (
                              <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-sky-700">
                                Current
                              </span>
                            )}
                            {isLoadedGroup && (
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-700">
                                Loaded
                              </span>
                            )}
                            <button
                              type="button"
                              className="rounded-md border border-slate-200 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-600 hover:bg-slate-50"
                              onClick={() => {
                                setNotesLibrarySelectedSolutionId(group.solutionId)
                                setNotesLibraryCollapsedSolutionIds(curr => (
                                  curr.includes(group.solutionId)
                                    ? curr.filter(id => id !== group.solutionId)
                                    : [...curr, group.solutionId]
                                ))
                              }}
                            >
                              {isCollapsed && !isSelectedGroup ? 'Expand' : 'Collapse'}
                            </button>
                          </div>
                        </div>
                        {showItems && (
                          <div className="p-2 space-y-2">
                            {group.items.map((item, index) => {
                              const updatedAt = (item as any)?.updatedAt
                              const when = updatedAt ? new Date(updatedAt).toLocaleString() : ''
                              const revisionKind = getNotebookRevisionKind((item as any)?.payload)
                              const isLoadedRevision = loadedNotebookRevision?.saveId === String(item.id || '')
                              const revisionLabel = revisionKind === 'draft-save'
                                ? 'Draft'
                                : revisionKind === 'checkpoint'
                                  ? 'Checkpoint'
                                  : 'Final'
                              const revisionBadgeClass = revisionKind === 'draft-save'
                                ? 'border-amber-200 bg-amber-50 text-amber-700'
                                : revisionKind === 'checkpoint'
                                  ? 'border-slate-200 bg-slate-100 text-slate-600'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  className={`w-full text-left rounded-md border px-3 py-2 ${index === 0 ? 'border-slate-300 bg-white hover:bg-slate-50' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'}`}
                                  onClick={() => {
                                    setNotesLibrarySelectedSolutionId(group.solutionId)
                                    applySavedNotesRecord(item)
                                    setNotesLibraryOpen(false)
                                  }}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 text-sm font-medium text-slate-800 truncate">{item.title || 'Untitled'}</div>
                                    <div className="flex shrink-0 items-center gap-1">
                                      {isLoadedRevision ? (
                                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-700">
                                          Loaded
                                        </span>
                                      ) : null}
                                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${revisionBadgeClass}`}>
                                        {revisionLabel}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-slate-500 flex items-center justify-between gap-2">
                                    <span className="truncate">{when || (index === 0 ? 'Latest revision' : 'Saved revision')}</span>
                                    <span className="font-mono text-[10px] text-slate-400">{String((item as any)?.noteId || (item as any)?.payload?.noteId || '').slice(0, 14)}</span>
                                  </div>
                                  {isLoadedRevision ? (
                                    <div className="mt-1 text-[11px] text-amber-700">
                                      {loadedNotebookRevision?.editingStepIndex !== null
                                        ? `Restored editing step ${Number(loadedNotebookRevision?.editingStepIndex) + 1}.`
                                        : loadedNotebookRevision?.selectedStepIndex !== null
                                          ? `Restored step ${Number(loadedNotebookRevision?.selectedStepIndex) + 1} selection.`
                                          : 'Loaded without a step focus.'}
                                    </div>
                                  ) : null}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-3 lg:sticky lg:top-0 h-fit">
                  {!selectedNotesLibraryGroup ? (
                    <div className="text-sm text-slate-600">Select a saved solution to inspect its revision timeline.</div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-800">{selectedNotesLibraryGroup.title}</div>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {selectedNotesLibraryGroup.items.length === 1 ? '1 revision in this solution' : `${selectedNotesLibraryGroup.items.length} revisions in this solution`}
                          </div>
                        </div>
                        <span className="font-mono text-[10px] text-slate-400">{selectedNotesLibraryGroup.solutionId.slice(0, 14)}</span>
                      </div>
                      <div className="mt-3 space-y-3">
                        {selectedNotesLibraryGroup.items.map((item, index) => {
                          const updatedAt = (item as any)?.updatedAt
                          const when = updatedAt ? new Date(updatedAt).toLocaleString() : 'Unknown time'
                          const revisionKind = getNotebookRevisionKind((item as any)?.payload)
                          const isLoadedRevision = loadedNotebookRevision?.saveId === String(item.id || '')
                          const revisionLabel = revisionKind === 'draft-save'
                            ? 'Draft'
                            : revisionKind === 'checkpoint'
                              ? 'Checkpoint'
                              : 'Final'
                          const revisionBadgeClass = revisionKind === 'draft-save'
                            ? 'border-amber-200 bg-amber-50 text-amber-700'
                            : revisionKind === 'checkpoint'
                              ? 'border-slate-200 bg-slate-100 text-slate-600'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          return (
                            <div key={item.id} className="relative pl-5">
                              <div className="absolute left-[6px] top-2 bottom-[-14px] w-px bg-slate-200 last:hidden" />
                              <div className="absolute left-0 top-2 h-3 w-3 rounded-full border border-slate-300 bg-white" />
                              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium text-slate-800">{index === 0 ? 'Latest revision' : `Revision ${selectedNotesLibraryGroup.items.length - index}`}</div>
                                    <div className="mt-0.5 text-[11px] text-slate-500 truncate">{when}</div>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-1">
                                    {isLoadedRevision ? (
                                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-700">
                                        Loaded
                                      </span>
                                    ) : null}
                                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${revisionBadgeClass}`}>
                                      {revisionLabel}
                                    </span>
                                  </div>
                                </div>
                                {isLoadedRevision ? (
                                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                                    {loadedNotebookRevision?.editingStepIndex !== null
                                      ? `This revision restored editing step ${Number(loadedNotebookRevision?.editingStepIndex) + 1} into the composer.`
                                      : loadedNotebookRevision?.selectedStepIndex !== null
                                        ? `This revision restored step ${Number(loadedNotebookRevision?.selectedStepIndex) + 1} as the selected step.`
                                        : 'This revision loaded without restoring a specific step focus.'}
                                  </div>
                                ) : null}
                                <div className="mt-2 flex items-center justify-between gap-2">
                                  <div className="text-[11px] text-slate-500 truncate">{item.title || 'Untitled'}</div>
                                  <button
                                    type="button"
                                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                                    onClick={() => {
                                      applySavedNotesRecord(item)
                                      setNotesLibraryOpen(false)
                                    }}
                                  >
                                    Load Revision
                                  </button>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="px-4 py-3 border-t border-slate-200 bg-white flex items-center justify-between">
            <div className="text-[11px] text-slate-500">
              Selecting a question overwrites your current notes view.
            </div>
          </div>
        </FullScreenGlassOverlay>
      )}

      {quizSetupOpen && typeof document !== 'undefined' && createPortal(
        <FullScreenGlassOverlay
          title="Start Quiz"
          subtitle="Edit the prompt, choose a timer, and start."
          onClose={() => setQuizSetupOpen(false)}
          onBackdropClick={() => setQuizSetupOpen(false)}
          zIndexClassName="z-[10050]"
          rightActions={
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { void openQuizSetupOverlay() }}
              disabled={quizSetupLoading}
              title="Ask Gemini for a fresh quiz suggestion"
            >
              {quizSetupLoading ? 'Suggesting…' : 'Re-suggest'}
            </button>
          }
          contentClassName="p-0 overflow-hidden flex flex-col"
        >
          <div className="flex-1 overflow-auto">
            {quizSetupError && (
              <div className="mx-4 mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {quizSetupError}
              </div>
            )}

            <div className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="h-full flex flex-col overflow-hidden">
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <label className="block text-xs font-medium opacity-80">Quiz label (optional)</label>
                    <input
                      className="mt-1 w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/20"
                      value={quizSetupLabel}
                      onChange={(e) => setQuizSetupLabel(e.target.value)}
                      placeholder="e.g. Quick Check"
                      disabled={quizSetupLoading}
                    />

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium opacity-80">Minutes</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="mt-1 w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/20"
                          value={quizSetupMinutes}
                          onChange={(e) => setQuizSetupMinutes(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
                          disabled={quizSetupLoading}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium opacity-80">Seconds</label>
                        <input
                          type="number"
                          min={0}
                          max={59}
                          step={1}
                          className="mt-1 w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/20"
                          value={quizSetupSeconds}
                          onChange={(e) => {
                            const v = Math.trunc(Number(e.target.value) || 0)
                            setQuizSetupSeconds(Math.max(0, Math.min(59, v)))
                          }}
                          disabled={quizSetupLoading}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex-1 overflow-hidden rounded-lg border border-white/10 bg-white/5 p-3 flex flex-col">
                    <div className="flex items-center justify-between gap-3">
                      <label className="block text-xs font-medium opacity-80">Quiz prompt</label>
                      <div className="text-[11px] opacity-70">Use $...$ / $$...$$ for math</div>
                    </div>
                    <textarea
                      className="mt-2 flex-1 w-full resize-none rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/20"
                      value={quizSetupPrompt}
                      onChange={(e) => setQuizSetupPrompt(e.target.value)}
                      placeholder="Type quiz instructions/question here…"
                      autoFocus
                      disabled={quizSetupLoading}
                    />
                  </div>
                </div>

                <div className="h-full overflow-hidden rounded-lg border border-white/10 bg-white/5 p-3 flex flex-col">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium opacity-80">Preview</div>
                    <div className="text-[11px] opacity-70">Rendered with KaTeX</div>
                  </div>
                  <div className="mt-2 flex-1 overflow-auto rounded-md border border-white/10 bg-black/10 p-3">
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">
                      {renderTextWithInlineKatex(quizSetupPrompt || '').map((node, idx) => {
                        if (typeof node === 'string') {
                          return <span key={idx}>{node}</span>
                        }
                        const html = (() => {
                          try {
                            return renderToString(node.expr, { displayMode: node.display, throwOnError: false })
                          } catch {
                            return ''
                          }
                        })()
                        if (!html) return <span key={idx}>{node.display ? `\n$$${node.expr}$$\n` : `$${node.expr}$`}</span>
                        return (
                          <span
                            key={idx}
                            className={node.display ? 'block my-2' : 'inline'}
                            dangerouslySetInnerHTML={{ __html: html }}
                          />
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between gap-3">
            <div className="text-[11px] opacity-70">
              Duration: {Math.max(0, Math.trunc(Number(quizSetupMinutes) || 0))}:{String(Math.max(0, Math.min(59, Math.trunc(Number(quizSetupSeconds) || 0)))).padStart(2, '0')}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setQuizSetupOpen(false)}
                disabled={quizSetupLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => { void startQuizFromOverlay() }}
                disabled={quizSetupLoading || !(quizSetupPrompt || '').trim()}
              >
                Start Quiz
              </button>
            </div>
          </div>
        </FullScreenGlassOverlay>,
        document.body,
      )}



    </div>
  )
}

(MyScriptMathCanvas as any).displayName = 'MyScriptMathCanvas'

export default MyScriptMathCanvas
export { MyScriptMathCanvas }


