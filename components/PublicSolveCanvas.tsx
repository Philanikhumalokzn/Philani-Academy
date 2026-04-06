import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import LessonStyledExcalidraw from './LessonStyledExcalidraw'

export type PublicSolveSegmentStatus = 'active' | 'closed' | 'normalized'

export type PublicSolveSegmentMeta = {
  id: string
  startedAt: string
  zoomAtStart: number
  elementIds: string[]
  normalizedAt?: string | null
  status: PublicSolveSegmentStatus
}

export type PublicSolveSceneMeta = {
  version: number
  baselineSegmentId: string | null
  activeSegmentId: string | null
  guideSpacing: number | null
  lastObservedZoom: number | null
  segments: PublicSolveSegmentMeta[]
}

export type PublicSolveScene = {
  elements: any[]
  appState?: Record<string, any>
  files?: Record<string, any>
  updatedAt?: string | null
  sceneMeta?: PublicSolveSceneMeta
}

const PUBLIC_SOLVE_SCENE_META_VERSION = 1
const PUBLIC_SOLVE_TRACKED_ELEMENT_TYPE = 'freedraw'
const PUBLIC_SOLVE_DEFAULT_GUIDE_SPACING = 48
const PUBLIC_SOLVE_MIN_GUIDE_SPACING = 20
const PUBLIC_SOLVE_MAX_GUIDE_SPACING = 96
const PUBLIC_SOLVE_MIN_PROMPT_ZOOM = 1
const PUBLIC_SOLVE_MAX_PROMPT_ZOOM = 2.4
const PUBLIC_SOLVE_PASSIVE_PROMPT_HEADER_HEIGHT = 64
const PUBLIC_SOLVE_VIEWER_HEIGHT_PX = 420

type PublicSolvePromptMode = 'passive' | 'active'
type PublicSolveReferencePresentation = 'interactive' | 'background'

export function PublicSolvePromptReferenceLayer({
  title,
  prompt,
  imageUrl,
  authorName,
  authorAvatarUrl,
  presentation = 'interactive',
  referenceBody,
  children,
}: {
  title: string
  prompt?: string | null
  imageUrl?: string | null
  authorName?: string | null
  authorAvatarUrl?: string | null
  presentation?: PublicSolveReferencePresentation
  referenceBody?: ReactNode
  children: React.ReactNode
}) {
  const promptDismissDragRef = useRef<{ pointerId: number | null; startY: number; dragOffsetY: number }>({
    pointerId: null,
    startY: 0,
    dragOffsetY: 0,
  })
  const [promptMode, setPromptMode] = useState<PublicSolvePromptMode>('passive')
  const [promptZoom, setPromptZoom] = useState(1)
  const [promptDismissDragOffset, setPromptDismissDragOffset] = useState(0)

  const resolvedAuthorName = useMemo(() => {
    const normalized = String(authorName || '').trim()
    return normalized || 'Original post'
  }, [authorName])

  const resolvedAuthorAvatarUrl = useMemo(() => {
    const normalized = String(authorAvatarUrl || '').trim()
    return normalized || ''
  }, [authorAvatarUrl])

  const resolvedAuthorInitial = useMemo(() => {
    const parts = resolvedAuthorName
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean)
    if (parts.length === 0) return 'P'
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase() || 'P'
    }
    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase() || 'P'
  }, [resolvedAuthorName])

  useEffect(() => {
    setPromptMode('passive')
    setPromptZoom(1)
    setPromptDismissDragOffset(0)
    promptDismissDragRef.current = { pointerId: null, startY: 0, dragOffsetY: 0 }
  }, [title, prompt, imageUrl, referenceBody])

  const enterActivePromptMode = useCallback(() => {
    setPromptDismissDragOffset(0)
    promptDismissDragRef.current = { pointerId: null, startY: 0, dragOffsetY: 0 }
    setPromptMode('active')
  }, [])

  const handlePromptWheel = useCallback((event: any) => {
    if (promptMode !== 'active') return
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const delta = Number(event.deltaY || 0)
    const nextZoom = Math.min(
      PUBLIC_SOLVE_MAX_PROMPT_ZOOM,
      Math.max(PUBLIC_SOLVE_MIN_PROMPT_ZOOM, promptZoom + (delta < 0 ? 0.08 : -0.08))
    )
    setPromptZoom(Number(nextZoom.toFixed(2)))
  }, [promptMode, promptZoom])

  const handlePromptDismissPointerDown = useCallback((event: any) => {
    if (promptMode !== 'active') return
    promptDismissDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      dragOffsetY: 0,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [promptMode])

  const handlePromptDismissPointerMove = useCallback((event: any) => {
    const state = promptDismissDragRef.current
    if (promptMode !== 'active') return
    if (state.pointerId !== event.pointerId) return
    const rawDelta = Number(event.clientY || 0) - state.startY
    const nextOffset = Math.min(0, rawDelta)
    state.dragOffsetY = nextOffset
    setPromptDismissDragOffset(nextOffset)
  }, [promptMode])

  const handlePromptDismissPointerEnd = useCallback((event: any) => {
    const state = promptDismissDragRef.current
    if (state.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const shouldDismiss = state.dragOffsetY <= -72
    promptDismissDragRef.current = { pointerId: null, startY: 0, dragOffsetY: 0 }
    setPromptDismissDragOffset(0)
    if (shouldDismiss) {
      setPromptMode('passive')
    }
  }, [])

  const activePromptViewportStyle = useMemo(() => {
    const transition = promptDismissDragRef.current.pointerId != null
      ? 'none'
      : 'transform 180ms ease, opacity 180ms ease'
    return {
      transform: `translateY(${promptDismissDragOffset}px)`,
      transition,
      touchAction: 'pan-x pan-y pinch-zoom',
      opacity: 1,
      pointerEvents: 'auto',
    } as any
  }, [promptDismissDragOffset])

  const promptDocumentStyle = useMemo(() => {
    const safeZoom = Math.min(PUBLIC_SOLVE_MAX_PROMPT_ZOOM, Math.max(PUBLIC_SOLVE_MIN_PROMPT_ZOOM, promptZoom))
    return {
      zoom: safeZoom,
    } as any
  }, [promptZoom])

  const promptCardInner = (
    <>
      <div className="px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <div className="relative shrink-0 overflow-visible">
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-black/10 bg-[#f0f2f5] text-xs font-semibold text-[#1c1e21]">
              {resolvedAuthorAvatarUrl ? (
                <img src={resolvedAuthorAvatarUrl} alt={resolvedAuthorName} className="h-full w-full object-cover" />
              ) : (
                <span>{resolvedAuthorInitial}</span>
              )}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-[-0.015em] text-[#1c1e21]">{resolvedAuthorName}</div>
          </div>
        </div>

        {referenceBody ? referenceBody : (prompt ? (
          <div className="mt-3 whitespace-pre-wrap text-[14px] leading-6 text-[#334155] break-words">{prompt}</div>
        ) : null)}
      </div>

      {!referenceBody && imageUrl ? (
        <div className="overflow-hidden border-t border-black/10 bg-[#f8fafc]">
          <img src={imageUrl} alt={title} className="max-h-[720px] w-full object-contain" />
        </div>
      ) : null}
    </>
  )

  const promptPassivePreview = (prompt || title || 'Open original post').trim()

  if (presentation === 'background') {
    return (
      <div className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.96))]" data-testid="public-solve-reference-layer">
        <div
          data-testid="public-solve-reference-viewport"
          className="absolute inset-0 z-[1] overflow-auto"
          style={{ pointerEvents: 'none' }}
        >
          <div className="mx-auto min-h-full w-full max-w-3xl px-5 py-6 pb-28 sm:px-8" style={promptDocumentStyle}>
            <article
              data-testid="public-solve-reference-card"
              className="overflow-hidden rounded-[24px] border border-black/10 bg-white text-left shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
            >
              {promptCardInner}
            </article>
          </div>
        </div>

        <div
          data-testid="public-solve-reference-workspace"
          className="relative z-[2] min-h-0 flex-1"
          style={{ pointerEvents: 'auto' }}
        >
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.96))]" data-testid="public-solve-reference-layer">
      {promptMode === 'passive' ? (
        <div className="pointer-events-none relative z-[20] flex h-[112px] flex-none justify-center px-5 py-6 sm:px-8" data-testid="public-solve-reference-viewport">
          <div className="mx-auto w-full max-w-3xl">
            <article
              data-testid="public-solve-reference-card"
              className="pointer-events-auto relative z-[21] overflow-hidden rounded-[24px] border border-black/10 bg-white text-left shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
              onClick={enterActivePromptMode}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  enterActivePromptMode()
                }
              }}
              role="button"
              tabIndex={0}
              style={{
                minHeight: `${PUBLIC_SOLVE_PASSIVE_PROMPT_HEADER_HEIGHT}px`,
                height: `${PUBLIC_SOLVE_PASSIVE_PROMPT_HEADER_HEIGHT}px`,
              }}
            >
              <div className="flex h-full items-center gap-3 px-4 py-3 sm:px-5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-black/10 bg-[#f0f2f5] text-xs font-semibold text-[#1c1e21]">
                  {resolvedAuthorAvatarUrl ? (
                    <img src={resolvedAuthorAvatarUrl} alt={resolvedAuthorName} className="h-full w-full object-cover" />
                  ) : (
                    <span>{resolvedAuthorInitial}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold tracking-[-0.015em] text-[#1c1e21]">{resolvedAuthorName}</div>
                  <div className="truncate text-[13px] leading-5 text-[#475569]">{promptPassivePreview}</div>
                </div>
                <div className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Open
                </div>
              </div>
            </article>
          </div>
        </div>
      ) : (
        <div
          data-testid="public-solve-reference-viewport"
          className="absolute inset-0 z-[20] overflow-auto"
          onWheel={handlePromptWheel}
          style={activePromptViewportStyle}
        >
          <div className="mx-auto min-h-full w-full max-w-3xl px-5 py-6 pb-28 sm:px-8" style={promptDocumentStyle}>
            <article
              data-testid="public-solve-reference-card"
              className="overflow-hidden rounded-[24px] border border-black/10 bg-white text-left shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
            >
              {promptCardInner}
            </article>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[21] flex justify-center pb-4">
            <div className="pointer-events-auto flex flex-col items-center gap-2 rounded-[24px] border border-slate-200 bg-white/94 px-4 py-3 shadow-[0_16px_34px_rgba(15,23,42,0.12)] backdrop-blur-xl">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Drag up to return</div>
              <div
                data-testid="public-solve-reference-dismiss"
                role="button"
                tabIndex={0}
                className="flex h-9 w-24 items-center justify-center rounded-full border border-slate-200 bg-slate-100/90"
                onPointerDown={handlePromptDismissPointerDown}
                onPointerMove={handlePromptDismissPointerMove}
                onPointerUp={handlePromptDismissPointerEnd}
                onPointerCancel={handlePromptDismissPointerEnd}
              >
                <span className="h-1.5 w-10 rounded-full bg-slate-400" />
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        data-testid="public-solve-reference-workspace"
        className={promptMode === 'active' ? 'absolute inset-0 z-[1]' : 'relative z-[1] min-h-0 flex-1'}
        style={{
          pointerEvents: promptMode === 'active' ? 'none' : 'auto',
        }}
      >
        {children}
      </div>
    </div>
  )
}

export function PublicSolveOpacityWorkspace({
  title,
  prompt,
  imageUrl,
  authorName,
  authorAvatarUrl,
  referenceBody,
  children,
  canvasLabel = 'Adjust to see post',
  outerClassName = '',
  contentPaddingClassName = 'relative flex-1 min-h-0 px-3 py-2 sm:px-6 sm:py-4',
  frameClassName = 'relative flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_22px_60px_rgba(15,23,42,0.10)]',
  canvasSurfaceClassName = 'flex h-full min-h-0 flex-col bg-white/96',
  referencePresentation = 'interactive',
  resetKey,
}: {
  title: string
  prompt?: string | null
  imageUrl?: string | null
  authorName?: string | null
  authorAvatarUrl?: string | null
  referenceBody?: ReactNode
  children: React.ReactNode
  canvasLabel?: string
  outerClassName?: string
  contentPaddingClassName?: string
  frameClassName?: string
  canvasSurfaceClassName?: string
  referencePresentation?: PublicSolveReferencePresentation
  resetKey?: string | number | null
}) {
  const [canvasOpacityPercent, setCanvasOpacityPercent] = useState(100)
  const [sliderVisible, setSliderVisible] = useState(true)
  const interactionScopeRef = useRef<HTMLDivElement | null>(null)
  const sliderRevealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setCanvasOpacityPercent(100)
    setSliderVisible(true)
  }, [imageUrl, prompt, referenceBody, resetKey, title])

  useEffect(() => {
    const scopeNode = interactionScopeRef.current
    if (!scopeNode || typeof window === 'undefined') return

    const clearSliderRevealTimeout = () => {
      if (sliderRevealTimeoutRef.current) {
        clearTimeout(sliderRevealTimeoutRef.current)
        sliderRevealTimeoutRef.current = null
      }
    }

    const nodeMatchesInteractionSurface = (node: EventTarget | null) => {
      if (!(node instanceof Element)) return false
      if (node.closest('[data-public-solve-opacity-slider="true"]')) return false
      if (node.closest('[data-keyboard-panel="true"]')) return true
      if (node.closest('[data-keyboard-mathlive-panel="true"]')) return true
      if (node.closest('math-field')) return true
      return false
    }

    const eventMatchesInteractionSurface = (event: Event) => {
      if (nodeMatchesInteractionSurface(event.target)) return true
      const path = typeof event.composedPath === 'function' ? event.composedPath() : []
      return path.some(nodeMatchesInteractionSurface)
    }

    const hideThenScheduleReveal = (event: Event) => {
      if (!eventMatchesInteractionSurface(event)) return
      setSliderVisible(false)
      clearSliderRevealTimeout()
      sliderRevealTimeoutRef.current = setTimeout(() => {
        setSliderVisible(true)
        sliderRevealTimeoutRef.current = null
      }, 2000)
    }

    scopeNode.addEventListener('pointerdown', hideThenScheduleReveal, true)
    scopeNode.addEventListener('focusin', hideThenScheduleReveal, true)
    scopeNode.addEventListener('input', hideThenScheduleReveal, true)
    scopeNode.addEventListener('keydown', hideThenScheduleReveal, true)

    return () => {
      clearSliderRevealTimeout()
      scopeNode.removeEventListener('pointerdown', hideThenScheduleReveal, true)
      scopeNode.removeEventListener('focusin', hideThenScheduleReveal, true)
      scopeNode.removeEventListener('input', hideThenScheduleReveal, true)
      scopeNode.removeEventListener('keydown', hideThenScheduleReveal, true)
    }
  }, [])

  const canvasOpacity = canvasOpacityPercent / 100

  return (
    <div className={`flex h-full flex-col ${outerClassName}`.trim()}>
      <div ref={interactionScopeRef} className={contentPaddingClassName}>
        <div
          className="pointer-events-none absolute inset-y-0 right-0 z-[7] flex items-center pr-2 sm:pr-3"
          style={{
            paddingRight: 'calc(max(var(--app-safe-right, 0px), env(safe-area-inset-right, 0px)) + 8px)',
          }}
        >
          <div
            data-public-solve-opacity-slider="true"
            className={`pointer-events-auto flex h-[232px] w-11 flex-col items-center justify-center gap-2 rounded-full border border-slate-200/90 bg-white/92 px-1 py-3 shadow-[0_18px_40px_rgba(15,23,42,0.12)] backdrop-blur-xl transition-[opacity,transform] duration-200 ${sliderVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2 pointer-events-none'}`}
          >
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
              <div className="text-center text-[8px] font-semibold uppercase leading-[1.05] tracking-[0.08em] text-slate-500 [writing-mode:vertical-rl] rotate-180">
                {canvasLabel}
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={canvasOpacityPercent}
              onChange={(event) => setCanvasOpacityPercent(Number(event.target.value || 0))}
              aria-label="Prompt blend"
              className="h-32 w-5 cursor-pointer bg-transparent [-webkit-appearance:slider-vertical] [appearance:slider-vertical]"
            />
            <div className="text-[10px] font-semibold text-slate-500">{canvasOpacityPercent}%</div>
          </div>
        </div>

        <div className={frameClassName}>
          <PublicSolvePromptReferenceLayer
            title={title}
            prompt={prompt}
            imageUrl={imageUrl}
            authorName={authorName}
            authorAvatarUrl={authorAvatarUrl}
            presentation={referencePresentation}
            referenceBody={referenceBody}
          >
            <div
              className={canvasSurfaceClassName}
              style={{
                opacity: canvasOpacity,
                transition: 'opacity 160ms ease',
              }}
            >
              {children}
            </div>
          </PublicSolvePromptReferenceLayer>
        </div>
      </div>
    </div>
  )
}

const PUBLIC_SOLVE_PERSISTED_APP_STATE_KEYS = [
  'scrollX',
  'scrollY',
  'zoom',
  'viewBackgroundColor',
  'currentItemStrokeColor',
  'currentItemBackgroundColor',
  'currentItemStrokeWidth',
  'currentItemStrokeStyle',
  'currentItemFillStyle',
  'currentItemRoughness',
  'currentItemOpacity',
  'currentItemRoundness',
  'currentItemFontFamily',
  'currentItemFontSize',
  'currentItemTextAlign',
  'currentItemStartArrowhead',
  'currentItemEndArrowhead',
  'activeTool',
] as const

const cloneScenePart = <T,>(value: T): T => {
  try {
    if (typeof structuredClone === 'function') return structuredClone(value)
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}

const normalizeZoomValue = (value: unknown) => {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num <= 0) return null
  return num
}

const clampNumber = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

const getAppStateZoomValue = (appState: any) => {
  if (!appState || typeof appState !== 'object') return null
  const raw = appState.zoom
  if (typeof raw === 'number') return normalizeZoomValue(raw)
  if (raw && typeof raw === 'object') return normalizeZoomValue((raw as any).value)
  return null
}

const getPublicSolveViewportSnapshot = (appState: any) => ({
  scrollX: Number(appState?.scrollX || 0),
  scrollY: Number(appState?.scrollY || 0),
  zoom: getAppStateZoomValue(appState) || 1,
})

const serializePublicSolveViewportSnapshot = (appState: any) => {
  const snapshot = getPublicSolveViewportSnapshot(appState)
  return JSON.stringify([
    Number(snapshot.scrollX.toFixed(3)),
    Number(snapshot.scrollY.toFixed(3)),
    Number(snapshot.zoom.toFixed(4)),
  ])
}

const createEmptyPublicSolveSceneMeta = (): PublicSolveSceneMeta => ({
  version: PUBLIC_SOLVE_SCENE_META_VERSION,
  baselineSegmentId: null,
  activeSegmentId: null,
  guideSpacing: null,
  lastObservedZoom: null,
  segments: [],
})

const makePublicSolveSegmentId = () => `segment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const isTrackableFreedrawElement = (element: any) => Boolean(
  element
  && !element.isDeleted
  && typeof element.id === 'string'
  && element.type === PUBLIC_SOLVE_TRACKED_ELEMENT_TYPE
)

const pickPersistedPublicSolveAppState = (appState: any) => {
  if (!appState || typeof appState !== 'object') return undefined
  const next: Record<string, any> = {}
  for (const key of PUBLIC_SOLVE_PERSISTED_APP_STATE_KEYS) {
    if (typeof appState[key] === 'undefined') continue
    next[key] = cloneScenePart(appState[key])
  }
  return Object.keys(next).length ? next : undefined
}

const cloneSceneMeta = (sceneMeta: PublicSolveSceneMeta): PublicSolveSceneMeta => ({
  version: PUBLIC_SOLVE_SCENE_META_VERSION,
  baselineSegmentId: typeof sceneMeta?.baselineSegmentId === 'string' ? sceneMeta.baselineSegmentId : null,
  activeSegmentId: typeof sceneMeta?.activeSegmentId === 'string' ? sceneMeta.activeSegmentId : null,
  guideSpacing: clampGuideSpacing(sceneMeta?.guideSpacing),
  lastObservedZoom: normalizeZoomValue(sceneMeta?.lastObservedZoom),
  segments: Array.isArray(sceneMeta?.segments)
    ? sceneMeta.segments.map((segment) => ({
        id: String(segment?.id || makePublicSolveSegmentId()),
        startedAt: typeof segment?.startedAt === 'string' ? segment.startedAt : new Date().toISOString(),
        zoomAtStart: normalizeZoomValue(segment?.zoomAtStart) || 1,
        elementIds: Array.isArray(segment?.elementIds)
          ? Array.from(new Set(segment.elementIds.map((id: unknown) => String(id || '')).filter(Boolean)))
          : [],
        normalizedAt: typeof segment?.normalizedAt === 'string' ? segment.normalizedAt : null,
        status: segment?.status === 'normalized' ? 'normalized' : segment?.status === 'closed' ? 'closed' : 'active',
      }))
    : [],
})

const clampGuideSpacing = (value: unknown) => {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num <= 0) return null
  return Math.min(PUBLIC_SOLVE_MAX_GUIDE_SPACING, Math.max(PUBLIC_SOLVE_MIN_GUIDE_SPACING, num))
}

const normalizePublicSolveSceneMeta = (value: any): PublicSolveSceneMeta => {
  if (!value || typeof value !== 'object') return createEmptyPublicSolveSceneMeta()
  const next = cloneSceneMeta(value as PublicSolveSceneMeta)
  const ids = new Set(next.segments.map((segment) => segment.id))
  if (!next.baselineSegmentId || !ids.has(next.baselineSegmentId)) {
    next.baselineSegmentId = next.segments[0]?.id || null
  }
  if (!next.activeSegmentId || !ids.has(next.activeSegmentId)) {
    next.activeSegmentId = null
  }
  return next
}

const getElementNumericBounds = (element: any) => {
  const x = Number(element?.x || 0)
  const y = Number(element?.y || 0)
  const width = Number(element?.width || 0)
  const height = Number(element?.height || 0)
  const x2 = x + width
  const y2 = y + height
  return {
    minX: Math.min(x, x2),
    minY: Math.min(y, y2),
    maxX: Math.max(x, x2),
    maxY: Math.max(y, y2),
    width: Math.abs(width),
    height: Math.abs(height),
    centerX: (Math.min(x, x2) + Math.max(x, x2)) / 2,
    centerY: (Math.min(y, y2) + Math.max(y, y2)) / 2,
  }
}

const getElementsBoundingBox = (elements: any[]) => {
  const visible = (Array.isArray(elements) ? elements : []).filter((element) => element && !element.isDeleted)
  if (!visible.length) return null

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const element of visible) {
    const bounds = getElementNumericBounds(element)
    minX = Math.min(minX, bounds.minX)
    minY = Math.min(minY, bounds.minY)
    maxX = Math.max(maxX, bounds.maxX)
    maxY = Math.max(maxY, bounds.maxY)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  }
}

const buildFreedrawGlyphClusters = (elements: any[], guideSpacing: number) => {
  const safeSpacing = clampGuideSpacing(guideSpacing) || PUBLIC_SOLVE_DEFAULT_GUIDE_SPACING
  const sorted = (Array.isArray(elements) ? elements : [])
    .filter(isTrackableFreedrawElement)
    .map((element: any) => ({ element, bounds: getElementNumericBounds(element) }))
    .sort((left, right) => (
      left.bounds.minX - right.bounds.minX
      || left.bounds.minY - right.bounds.minY
    ))

  const gapThreshold = Math.max(safeSpacing * 0.28, 10)
  const verticalThreshold = Math.max(safeSpacing * 0.45, 12)
  const clusters: Array<{ elements: any[]; elementIds: string[]; bounds: ReturnType<typeof getElementsBoundingBox> }> = []

  for (const item of sorted) {
    const lastCluster = clusters[clusters.length - 1]
    if (!lastCluster?.bounds) {
      clusters.push({
        elements: [item.element],
        elementIds: [String(item.element.id)],
        bounds: getElementsBoundingBox([item.element]),
      })
      continue
    }

    const lastBounds = lastCluster.bounds
    const overlapsX = item.bounds.minX <= lastBounds.maxX + 2
    const gapX = item.bounds.minX - lastBounds.maxX
    const sameBand = Math.abs(item.bounds.centerY - lastBounds.centerY) <= verticalThreshold

    if (overlapsX || (gapX <= gapThreshold && sameBand)) {
      const nextElements = [...lastCluster.elements, item.element]
      lastCluster.elements = nextElements
      lastCluster.elementIds = [...lastCluster.elementIds, String(item.element.id)]
      lastCluster.bounds = getElementsBoundingBox(nextElements)
      continue
    }

    clusters.push({
      elements: [item.element],
      elementIds: [String(item.element.id)],
      bounds: getElementsBoundingBox([item.element]),
    })
  }

  return clusters.filter((cluster) => cluster.bounds)
}

const estimateGuideSpacingFromElements = (elements: any[], preferredSpacing?: number | null) => {
  const seedSpacing = clampGuideSpacing(preferredSpacing) || PUBLIC_SOLVE_DEFAULT_GUIDE_SPACING
  const clusters = buildFreedrawGlyphClusters(elements, seedSpacing)
  const heights = clusters
    .map((cluster) => Number(cluster.bounds?.height || 0))
    .filter((value) => Number.isFinite(value) && value > 4)
    .sort((left, right) => left - right)

  if (!heights.length) return null
  const percentileIndex = Math.min(heights.length - 1, Math.max(0, Math.round((heights.length - 1) * 0.7)))
  return clampGuideSpacing(heights[percentileIndex])
}

const resolveDefaultGuideSpacingForZoom = (zoom: unknown) => {
  const safeZoom = normalizeZoomValue(zoom) || 1
  return clampGuideSpacing(PUBLIC_SOLVE_DEFAULT_GUIDE_SPACING / safeZoom) || PUBLIC_SOLVE_DEFAULT_GUIDE_SPACING
}

const resolveSceneGuideSpacing = (elements: any[], sceneMeta: PublicSolveSceneMeta, viewportZoom?: number | null) => {
  const explicit = clampGuideSpacing(sceneMeta.guideSpacing)
  if (explicit) return explicit
  return estimateGuideSpacingFromElements(elements, explicit) || resolveDefaultGuideSpacingForZoom(viewportZoom ?? sceneMeta.lastObservedZoom)
}

function NotebookGuidesOverlay({
  zoom,
  scrollY,
  guideSpacing,
}: {
  zoom: number
  scrollY: number
  guideSpacing: number
}) {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const safeSpacing = Math.max(guideSpacing * safeZoom, 12)
  const quarter = safeSpacing / 4
  const half = safeSpacing / 2
  const offset = scrollY * safeZoom

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[1]"
      style={{
        backgroundImage: [
          'linear-gradient(to bottom, rgba(14,116,144,0.14) 0, rgba(14,116,144,0.14) 1px, transparent 1px, transparent 100%)',
          'linear-gradient(to bottom, rgba(14,116,144,0.08) 0, rgba(14,116,144,0.08) 1px, transparent 1px, transparent 100%)',
          'linear-gradient(to bottom, rgba(14,116,144,0.05) 0, rgba(14,116,144,0.05) 1px, transparent 1px, transparent 100%)',
          'linear-gradient(to bottom, rgba(14,116,144,0.05) 0, rgba(14,116,144,0.05) 1px, transparent 1px, transparent 100%)',
        ].join(','),
        backgroundSize: `100% ${safeSpacing}px, 100% ${safeSpacing}px, 100% ${safeSpacing}px, 100% ${safeSpacing}px`,
        backgroundPosition: `0 ${offset}px, 0 ${offset + half}px, 0 ${offset + quarter}px, 0 ${offset + (quarter * 3)}px`,
      }}
    />
  )
}

export const normalizePublicSolveScene = (value: any): PublicSolveScene | null => {
  if (!value || typeof value !== 'object') return null
  const elements = Array.isArray(value.elements) ? cloneScenePart(value.elements) : []
  const appState = pickPersistedPublicSolveAppState(value.appState)
  const files = value.files && typeof value.files === 'object' ? cloneScenePart(value.files) : undefined
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : null
  const sceneMeta = normalizePublicSolveSceneMeta(value.sceneMeta)
  return { elements, appState, files, updatedAt, sceneMeta }
}

export const publicSolveSceneHasContent = (scene: PublicSolveScene | null | undefined) => {
  return Boolean(scene && Array.isArray(scene.elements) && scene.elements.some((element: any) => !element?.isDeleted))
}

const buildPublicSolveSceneResetKey = (scene: PublicSolveScene | null | undefined) => {
  if (!scene) return 'empty'
  const updatedAt = typeof scene.updatedAt === 'string' ? scene.updatedAt : ''
  const elements = Array.isArray(scene.elements) ? scene.elements : []
  const elementIds = elements.map((element: any) => String(element?.id || '')).join(',')
  const sceneMeta = scene.sceneMeta && typeof scene.sceneMeta === 'object' ? scene.sceneMeta : undefined
  const baselineSegmentId = typeof sceneMeta?.baselineSegmentId === 'string' ? sceneMeta.baselineSegmentId : ''
  const activeSegmentId = typeof sceneMeta?.activeSegmentId === 'string' ? sceneMeta.activeSegmentId : ''
  const segmentsCount = Array.isArray(sceneMeta?.segments) ? sceneMeta.segments.length : 0
  return [updatedAt, elements.length, elementIds, baselineSegmentId, activeSegmentId, segmentsCount].join('|')
}

const getGuideViewportState = (appState: Record<string, any> | undefined) => ({
  zoom: getAppStateZoomValue(appState) || 1,
  scrollY: Number(appState?.scrollY || 0),
})

const buildInitialData = (scene: PublicSolveScene | null | undefined) => {
  const normalized = normalizePublicSolveScene(scene) || { elements: [] }
  return {
    elements: Array.isArray(normalized.elements) ? normalized.elements : [],
    appState: {
      viewBackgroundColor: '#ffffff',
      currentItemStrokeColor: '#1f2937',
      currentItemBackgroundColor: 'transparent',
      ...(normalized.appState || {}),
    },
    files: normalized.files || {},
  }
}

const buildSceneViewportFromStrokeBounds = (
  scene: PublicSolveScene | null | undefined,
  options?: { maxHeightPx?: number; maxWidthPx?: number | null },
): { scene: PublicSolveScene | null; widthPx: number; heightPx: number } => {
  const normalized = normalizePublicSolveScene(scene)
  if (!normalized) {
    return {
      scene: null,
      widthPx: 0,
      heightPx: 0,
    }
  }

  const bounds = getElementsBoundingBox(normalized.elements)
  if (!bounds) {
    return {
      scene: normalized,
      widthPx: 0,
      heightPx: 0,
    }
  }

  const maxHeightPx = Number.isFinite(options?.maxHeightPx) && Number(options?.maxHeightPx) > 0
    ? Number(options?.maxHeightPx)
    : PUBLIC_SOLVE_VIEWER_HEIGHT_PX
  const maxWidthPx = Number.isFinite(options?.maxWidthPx) && Number(options?.maxWidthPx) > 0
    ? Number(options?.maxWidthPx)
    : Number.POSITIVE_INFINITY
  const rawWidth = Math.max(1, bounds.width)
  const rawHeight = Math.max(1, bounds.height)
  const widthScale = Number.isFinite(maxWidthPx) ? (maxWidthPx / rawWidth) : Number.POSITIVE_INFINITY
  const heightScale = maxHeightPx / rawHeight
  const scale = Math.min(1, widthScale, heightScale)
  const nextWidthPx = Math.max(1, Math.ceil(rawWidth * scale))
  const nextHeightPx = Math.max(1, Math.ceil(rawHeight * scale))

  const currentAppState = normalized.appState || {}
  const nextZoom = scale
  const nextScrollX = -bounds.minX * nextZoom
  const nextScrollY = -bounds.minY * nextZoom

  const nextAppState = {
    ...currentAppState,
    scrollX: nextScrollX,
    scrollY: nextScrollY,
    zoom: nextZoom,
  }

  return {
    scene: {
      ...normalized,
      appState: nextAppState,
    },
    widthPx: nextWidthPx,
    heightPx: nextHeightPx,
  }
}

const mergeViewportAppStateIntoScene = (
  scene: PublicSolveScene | null | undefined,
  appState: any,
): PublicSolveScene => {
  const normalized = normalizePublicSolveScene(scene) || { elements: [], sceneMeta: createEmptyPublicSolveSceneMeta() }
  const nextViewport = getPublicSolveViewportSnapshot(appState)
  const nextAppState = {
    ...(normalized.appState || {}),
    scrollX: nextViewport.scrollX,
    scrollY: nextViewport.scrollY,
    zoom: nextViewport.zoom,
  }
  return {
    ...normalized,
    appState: nextAppState,
  }
}

const editorUiOptions = {
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    export: false,
    clearCanvas: true,
    changeViewBackgroundColor: false,
    toggleTheme: false,
  },
} as const

const viewerUiOptions = {
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    export: false,
    clearCanvas: false,
    changeViewBackgroundColor: false,
    toggleTheme: false,
  },
} as const

export function PublicSolveCanvasViewer({
  scene,
  className = '',
  emptyLabel = 'No canvas submitted yet.',
  heightClassName,
  viewerHeightPx = PUBLIC_SOLVE_VIEWER_HEIGHT_PX,
  maxWidthPx,
  onViewportChange,
}: {
  scene: PublicSolveScene | null | undefined
  className?: string
  emptyLabel?: string
  heightClassName?: string
  viewerHeightPx?: number
  maxWidthPx?: number | null
  onViewportChange?: (scene: PublicSolveScene) => void
}) {
  const normalizedScene = useMemo(() => normalizePublicSolveScene(scene), [scene])
  const viewerLayout = useMemo(
    () => buildSceneViewportFromStrokeBounds(normalizedScene, { maxHeightPx: viewerHeightPx, maxWidthPx }),
    [maxWidthPx, normalizedScene, viewerHeightPx]
  )
  const viewerScene = viewerLayout.scene
  const excalidrawApiRef = useRef<any>(null)
  const lastViewportSignatureRef = useRef<string | null>(null)

  useEffect(() => {
    lastViewportSignatureRef.current = serializePublicSolveViewportSnapshot(viewerScene?.appState)
  }, [viewerScene])

  const handleViewerChange = useCallback((_elements: any[], appState: any) => {
    if (!onViewportChange) return
    const nextScene = mergeViewportAppStateIntoScene(viewerScene, appState)
    const nextSignature = serializePublicSolveViewportSnapshot(nextScene.appState)
    if (lastViewportSignatureRef.current === nextSignature) return
    lastViewportSignatureRef.current = nextSignature
    onViewportChange(nextScene)
  }, [onViewportChange, viewerScene])

  if (!publicSolveSceneHasContent(viewerScene)) {
    return (
      <div className={`rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 ${className}`.trim()}>
        {emptyLabel}
      </div>
    )
  }

  return (
    <div className={`philani-solution-viewer ${className}`.trim()}>
      <div
        className="relative overflow-hidden bg-white"
        style={{
          width: `min(100%, ${Math.max(1, viewerLayout.widthPx)}px)`,
          aspectRatio: `${Math.max(1, viewerLayout.widthPx)} / ${Math.max(1, viewerLayout.heightPx)}`,
          maxHeight: `${viewerHeightPx}px`,
        }}
      >
        <div className={`absolute inset-0 ${heightClassName || ''}`.trim()}>
          <LessonStyledExcalidraw
            key={viewerScene?.updatedAt || 'viewer'}
            className="h-full"
            initialData={buildInitialData(viewerScene)}
            onChange={onViewportChange ? handleViewerChange : undefined}
            excalidrawAPI={(api: any) => {
              excalidrawApiRef.current = api
            }}
            viewModeEnabled
            zenModeEnabled
            gridModeEnabled={false}
            UIOptions={viewerUiOptions}
            renderTopRightUI={() => null}
          />
        </div>
      </div>
    </div>
  )
}

export function PublicSolveComposer({
  title,
  prompt,
  imageUrl,
  authorName,
  authorAvatarUrl,
  referenceBody,
  initialScene,
  submitLabel = 'Submit solve',
  cancelLabel = 'Back',
  submitting = false,
  fullscreenCanvas = false,
  hideMainMenu = false,
  referencePresentation = 'interactive',
  onCancel,
  onPreviewSubmit,
  onSubmit,
}: {
  title: string
  prompt?: string | null
  imageUrl?: string | null
  authorName?: string | null
  authorAvatarUrl?: string | null
  referenceBody?: ReactNode
  initialScene?: PublicSolveScene | null
  submitLabel?: string
  cancelLabel?: string
  submitting?: boolean
  fullscreenCanvas?: boolean
  hideMainMenu?: boolean
  referencePresentation?: PublicSolveReferencePresentation
  onCancel?: () => void
  onPreviewSubmit?: (scene: PublicSolveScene) => void | Promise<void>
  onSubmit: (scene: PublicSolveScene) => void | Promise<void>
}) {
  const excalidrawApiRef = useRef<any>(null)
  const sceneRef = useRef<PublicSolveScene>(normalizePublicSolveScene(initialScene) || { elements: [], sceneMeta: createEmptyPublicSolveSceneMeta() })
  const lastAppliedInitialSceneKeyRef = useRef(buildPublicSolveSceneResetKey(sceneRef.current))
  const [composerInstanceKey, setComposerInstanceKey] = useState(0)
  const [composerInitialData, setComposerInitialData] = useState(() => buildInitialData(sceneRef.current))
  const [isReady, setIsReady] = useState(false)
  const [hasContent, setHasContent] = useState(publicSolveSceneHasContent(sceneRef.current))
  const [guideViewportState, setGuideViewportState] = useState(() => getGuideViewportState(sceneRef.current.appState))
  const [guideSpacing, setGuideSpacing] = useState(() => {
    const sceneMeta = normalizePublicSolveSceneMeta(sceneRef.current.sceneMeta)
    return resolveSceneGuideSpacing(sceneRef.current.elements, sceneMeta, getAppStateZoomValue(sceneRef.current.appState))
  })

  const applySceneSnapshot = useCallback((nextScene: PublicSolveScene, options?: { syncApi?: boolean }) => {
    const normalized = normalizePublicSolveScene(nextScene) || { elements: [], sceneMeta: createEmptyPublicSolveSceneMeta() }
    sceneRef.current = normalized
    setHasContent(publicSolveSceneHasContent(normalized))
    const nextViewport = getGuideViewportState(normalized.appState)
    setGuideViewportState((prev) => (
      prev.zoom === nextViewport.zoom && prev.scrollY === nextViewport.scrollY ? prev : nextViewport
    ))
    const nextGuideSpacing = resolveSceneGuideSpacing(
      normalized.elements,
      normalizePublicSolveSceneMeta(normalized.sceneMeta),
      getAppStateZoomValue(normalized.appState),
    )
    setGuideSpacing((prev) => (prev === nextGuideSpacing ? prev : nextGuideSpacing))
    if (options?.syncApi && excalidrawApiRef.current?.updateScene) {
      excalidrawApiRef.current.updateScene(buildInitialData(normalized))
    }
  }, [])

  useEffect(() => {
    const normalized = normalizePublicSolveScene(initialScene) || { elements: [], sceneMeta: createEmptyPublicSolveSceneMeta() }
    const resetKey = buildPublicSolveSceneResetKey(normalized)
    if (lastAppliedInitialSceneKeyRef.current === resetKey) return
    lastAppliedInitialSceneKeyRef.current = resetKey
    setIsReady(false)
    setComposerInitialData(buildInitialData(normalized))
    setComposerInstanceKey((prev) => prev + 1)
    applySceneSnapshot(normalized)
  }, [applySceneSnapshot, initialScene])

  useEffect(() => {
    const api = excalidrawApiRef.current
    if (!api?.setActiveTool || !api?.updateScene) return

    api.setActiveTool({ type: 'freedraw' })
    api.updateScene({
      appState: {
        activeTool: { type: 'freedraw' },
        currentItemStrokeWidth: 1,
      },
    })

    if (typeof window === 'undefined') return
    const settle = window.setTimeout(() => {
      const latestApi = excalidrawApiRef.current
      latestApi?.setActiveTool?.({ type: 'freedraw' })
      latestApi?.updateScene?.({
        appState: {
          activeTool: { type: 'freedraw' },
          currentItemStrokeWidth: 1,
        },
      })
    }, 0)

    return () => window.clearTimeout(settle)
  }, [isReady])

  return (
    <div className={`flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_32%),linear-gradient(180deg,#eef4ff_0%,#f8fbff_28%,#ffffff_100%)] text-slate-900 ${fullscreenCanvas ? 'overflow-hidden' : ''}`.trim()}>
      <PublicSolveOpacityWorkspace
        title={title}
        prompt={prompt}
        imageUrl={imageUrl}
        authorName={authorName}
        authorAvatarUrl={authorAvatarUrl}
        referenceBody={referenceBody}
        resetKey={composerInstanceKey}
        outerClassName="bg-transparent"
        contentPaddingClassName={fullscreenCanvas ? 'relative flex-1 min-h-0 px-0 py-0' : undefined}
        frameClassName={fullscreenCanvas ? 'relative flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0 bg-white shadow-none' : undefined}
        canvasSurfaceClassName={fullscreenCanvas ? 'flex h-full min-h-0 flex-col bg-white' : undefined}
        referencePresentation={referencePresentation}
      >
        <div className="relative min-h-0 flex-1 bg-white" style={{ touchAction: 'none' }}>
          <LessonStyledExcalidraw
            key={`public-solve-composer-${composerInstanceKey}`}
            className={`h-full ${fullscreenCanvas ? 'philani-excalidraw-safe-fullscreen' : ''}`.trim()}
            initialData={composerInitialData}
            UIOptions={editorUiOptions}
            hideMainMenu={hideMainMenu}
            zenModeEnabled={false}
            gridModeEnabled={false}
            onChange={(elements: any[], appState: any, files: any) => {
              const previousScene = normalizePublicSolveScene(sceneRef.current) || { elements: [], sceneMeta: createEmptyPublicSolveSceneMeta() }
              const previousMeta = normalizePublicSolveSceneMeta(previousScene.sceneMeta)
              const nextElements = cloneScenePart(Array.isArray(elements) ? elements : [])
              let nextMeta = cloneSceneMeta(previousMeta)
              const currentZoom = getAppStateZoomValue(appState)

              if (currentZoom != null) {
                nextMeta.lastObservedZoom = currentZoom
              }
              nextMeta.guideSpacing = resolveSceneGuideSpacing(nextElements, nextMeta, currentZoom ?? nextMeta.lastObservedZoom)
              const nextScene: PublicSolveScene = {
                elements: nextElements,
                appState: pickPersistedPublicSolveAppState(appState),
                files: files && typeof files === 'object' ? cloneScenePart(files) : undefined,
                updatedAt: new Date().toISOString(),
                sceneMeta: nextMeta,
              }
              applySceneSnapshot(nextScene)
            }}
            excalidrawAPI={(api: any) => {
              excalidrawApiRef.current = api
              if (!isReady) setIsReady(true)
            }}
            renderTopRightUI={() => null}
          />
          <NotebookGuidesOverlay zoom={guideViewportState.zoom} scrollY={guideViewportState.scrollY} guideSpacing={guideSpacing} />
        </div>
      </PublicSolveOpacityWorkspace>

      <div className={`border-t border-slate-200 bg-white/92 px-4 py-3 backdrop-blur-xl sm:px-6 ${fullscreenCanvas ? 'pb-[calc(var(--app-safe-bottom)+0.9rem)] pt-3' : ''}`.trim()}>
        <div className="flex items-center justify-between gap-3">
          {onCancel ? (
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
          ) : <div />}
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center rounded-full bg-[#1877f2] px-5 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(24,119,242,0.28)] transition hover:bg-[#176ad8] disabled:cursor-not-allowed disabled:opacity-55"
            onClick={() => {
              const action = onPreviewSubmit || onSubmit
              void action(sceneRef.current)
            }}
            disabled={!isReady || !hasContent || submitting}
          >
            {submitting ? 'Submitting...' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}