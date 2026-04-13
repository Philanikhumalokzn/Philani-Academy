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
  viewerViewportPersisted: boolean
  viewerViewportCenterX: number | null
  viewerViewportCenterY: number | null
  viewerViewportZoom: number | null
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
const PUBLIC_SOLVE_CANVAS_CHROME_IDLE_MS = 1500

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
  chromeVisible = true,
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
  chromeVisible?: boolean
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
        }, PUBLIC_SOLVE_CANVAS_CHROME_IDLE_MS)
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
  const resolvedSliderVisible = sliderVisible && chromeVisible

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
            className={`pointer-events-auto flex h-[232px] w-11 flex-col items-center justify-center gap-2 rounded-full border border-slate-200/90 bg-white/92 px-1 py-3 shadow-[0_18px_40px_rgba(15,23,42,0.12)] backdrop-blur-xl transition-[opacity,transform] duration-200 ${resolvedSliderVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2 pointer-events-none'}`}
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

const normalizeSceneCoordinateValue = (value: unknown) => {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return null
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
  viewerViewportPersisted: false,
  viewerViewportCenterX: null,
  viewerViewportCenterY: null,
  viewerViewportZoom: null,
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
  viewerViewportPersisted: Boolean(sceneMeta?.viewerViewportPersisted),
  viewerViewportCenterX: normalizeSceneCoordinateValue(sceneMeta?.viewerViewportCenterX),
  viewerViewportCenterY: normalizeSceneCoordinateValue(sceneMeta?.viewerViewportCenterY),
  viewerViewportZoom: normalizeZoomValue(sceneMeta?.viewerViewportZoom),
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

const buildPublicSolveViewerKey = (scene: PublicSolveScene | null | undefined) => {
  if (!scene) return 'empty'
  const elements = Array.isArray(scene.elements) ? scene.elements : []
  const elementIds = elements.map((element: any) => String(element?.id || '')).join(',')
  return [elements.length, elementIds].join('|')
}

const getGuideViewportState = (appState: Record<string, any> | undefined) => ({
  zoom: getAppStateZoomValue(appState) || 1,
  scrollY: Number(appState?.scrollY || 0),
})

const resolveViewportPixelSize = (
  appState: any,
  fallback?: { widthPx?: number | null; heightPx?: number | null },
) => {
  const widthPx = normalizeZoomValue(appState?.width) || normalizeZoomValue(fallback?.widthPx)
  const heightPx = normalizeZoomValue(appState?.height) || normalizeZoomValue(fallback?.heightPx)
  if (widthPx == null || heightPx == null) return null
  return { widthPx, heightPx }
}

const buildPortableViewerSnapshot = (
  appState: any,
  fallback?: { widthPx?: number | null; heightPx?: number | null },
) => {
  const zoom = getAppStateZoomValue(appState) || 1
  const viewportSize = resolveViewportPixelSize(appState, fallback)
  if (!viewportSize) return null
  const scrollX = Number(appState?.scrollX || 0)
  const scrollY = Number(appState?.scrollY || 0)
  const centerX = (viewportSize.widthPx / 2 - scrollX) / zoom
  const centerY = (viewportSize.heightPx / 2 - scrollY) / zoom
  return {
    centerX: Number(centerX.toFixed(3)),
    centerY: Number(centerY.toFixed(3)),
    zoom: Number(zoom.toFixed(4)),
  }
}

const buildViewportAppStateFromPortableSnapshot = (
  snapshot: { centerX: number; centerY: number; zoom: number },
  viewportSize: { widthPx: number; heightPx: number },
  currentAppState?: Record<string, any>,
) => ({
  ...(currentAppState || {}),
  scrollX: (viewportSize.widthPx / 2) - (snapshot.centerX * snapshot.zoom),
  scrollY: (viewportSize.heightPx / 2) - (snapshot.centerY * snapshot.zoom),
  zoom: snapshot.zoom,
})

const getPortableViewerSnapshotFromSceneMeta = (sceneMeta: PublicSolveSceneMeta) => {
  const centerX = normalizeSceneCoordinateValue(sceneMeta.viewerViewportCenterX)
  const centerY = normalizeSceneCoordinateValue(sceneMeta.viewerViewportCenterY)
  const zoom = normalizeZoomValue(sceneMeta.viewerViewportZoom)
  if (centerX == null || centerY == null || zoom == null) return null
  return { centerX, centerY, zoom }
}

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

  const sceneMeta = normalizePublicSolveSceneMeta(normalized.sceneMeta)
  const currentAppState = normalized.appState || {}
  const portableSnapshot = getPortableViewerSnapshotFromSceneMeta(sceneMeta)
  if (sceneMeta.viewerViewportPersisted && portableSnapshot) {
    return {
      scene: {
        ...normalized,
        appState: buildViewportAppStateFromPortableSnapshot(portableSnapshot, { widthPx: nextWidthPx, heightPx: nextHeightPx }, currentAppState),
        sceneMeta,
      },
      widthPx: nextWidthPx,
      heightPx: nextHeightPx,
    }
  }

  if (sceneMeta.viewerViewportPersisted && getAppStateZoomValue(normalized.appState)) {
    return {
      scene: {
        ...normalized,
        sceneMeta,
      },
      widthPx: nextWidthPx,
      heightPx: nextHeightPx,
    }
  }

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
  fallbackViewportSize?: { widthPx?: number | null; heightPx?: number | null },
): PublicSolveScene => {
  const normalized = normalizePublicSolveScene(scene) || { elements: [], sceneMeta: createEmptyPublicSolveSceneMeta() }
  const nextViewport = getPublicSolveViewportSnapshot(appState)
  const nextSceneMeta = cloneSceneMeta(normalizePublicSolveSceneMeta(normalized.sceneMeta))
  const portableSnapshot = buildPortableViewerSnapshot(appState, fallbackViewportSize)
  nextSceneMeta.viewerViewportPersisted = true
  if (portableSnapshot) {
    nextSceneMeta.viewerViewportCenterX = portableSnapshot.centerX
    nextSceneMeta.viewerViewportCenterY = portableSnapshot.centerY
    nextSceneMeta.viewerViewportZoom = portableSnapshot.zoom
  }
  const nextAppState = {
    ...(normalized.appState || {}),
    scrollX: nextViewport.scrollX,
    scrollY: nextViewport.scrollY,
    zoom: nextViewport.zoom,
  }
  return {
    ...normalized,
    appState: nextAppState,
    sceneMeta: nextSceneMeta,
  }
}

const finalizeViewerSnapshotScene = (
  scene: PublicSolveScene | null | undefined,
  fallbackViewportSize?: { widthPx?: number | null; heightPx?: number | null },
): PublicSolveScene => {
  const normalized = normalizePublicSolveScene(scene) || { elements: [], sceneMeta: createEmptyPublicSolveSceneMeta() }
  const nextScene = mergeViewportAppStateIntoScene(normalized, normalized.appState || {}, fallbackViewportSize)
  return {
    ...nextScene,
    updatedAt: new Date().toISOString(),
  }
}

export const preparePublicSolveSceneForPlainPreview = (
  scene: PublicSolveScene | null | undefined,
  existingPreviewScene?: PublicSolveScene | null | undefined,
): PublicSolveScene | null => {
  const normalized = normalizePublicSolveScene(scene)
  if (!normalized) return null

  const previousPreview = normalizePublicSolveScene(existingPreviewScene)
  const previousPreviewMeta = normalizePublicSolveSceneMeta(previousPreview?.sceneMeta)

  if (previousPreview && getAppStateZoomValue(previousPreview.appState)) {
    return {
      ...normalized,
      appState: pickPersistedPublicSolveAppState(previousPreview.appState),
      sceneMeta: {
        ...normalizePublicSolveSceneMeta(normalized.sceneMeta),
        viewerViewportPersisted: previousPreviewMeta.viewerViewportPersisted,
        viewerViewportCenterX: previousPreviewMeta.viewerViewportCenterX,
        viewerViewportCenterY: previousPreviewMeta.viewerViewportCenterY,
        viewerViewportZoom: previousPreviewMeta.viewerViewportZoom,
      },
    }
  }

  const nextAppState = { ...(normalized.appState || {}) }
  delete nextAppState.scrollX
  delete nextAppState.scrollY
  delete nextAppState.zoom

  return {
    ...normalized,
    appState: Object.keys(nextAppState).length ? nextAppState : undefined,
    sceneMeta: {
      ...normalizePublicSolveSceneMeta(normalized.sceneMeta),
      viewerViewportPersisted: false,
      viewerViewportCenterX: null,
      viewerViewportCenterY: null,
      viewerViewportZoom: null,
    },
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

export function PublicSolvePlainExcalidrawViewer({
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
  const seededScene = useMemo(() => {
    if (!normalizedScene) return null
    if (getAppStateZoomValue(normalizedScene.appState)) return normalizedScene
    return buildSceneViewportFromStrokeBounds(normalizedScene, { maxHeightPx: viewerHeightPx, maxWidthPx }).scene
  }, [maxWidthPx, normalizedScene, viewerHeightPx])
  const [viewerScene, setViewerScene] = useState<PublicSolveScene | null>(seededScene)
  const viewerSceneRef = useRef<PublicSolveScene | null>(seededScene)
  const excalidrawApiRef = useRef<any>(null)
  const lastViewportSignatureRef = useRef<string | null>(serializePublicSolveViewportSnapshot(seededScene?.appState))
  const viewerInstanceKey = useMemo(() => buildPublicSolveViewerKey(viewerScene), [viewerScene])

  useEffect(() => {
    viewerSceneRef.current = seededScene
    setViewerScene(seededScene)
    lastViewportSignatureRef.current = serializePublicSolveViewportSnapshot(seededScene?.appState)
  }, [seededScene])

  useEffect(() => {
    viewerSceneRef.current = viewerScene
    if (viewerScene && excalidrawApiRef.current?.updateScene) {
      const nextInitialData = buildInitialData(viewerScene)
      excalidrawApiRef.current.updateScene({
        elements: nextInitialData.elements,
        appState: nextInitialData.appState || {},
        files: nextInitialData.files || {},
        captureUpdate: 'IMMEDIATELY',
      })
    }
  }, [viewerScene])

  const handleViewerChange = useCallback((elements: any[], appState: any, files: any) => {
    if (!onViewportChange) return
    const baseScene = viewerSceneRef.current
    if (!baseScene) return
    const nextScene: PublicSolveScene = {
      ...baseScene,
      elements: cloneScenePart(Array.isArray(elements) ? elements : baseScene.elements || []),
      appState: pickPersistedPublicSolveAppState(appState),
      files: files && typeof files === 'object' ? cloneScenePart(files) : baseScene.files,
    }
    const nextSignature = serializePublicSolveViewportSnapshot(nextScene.appState)
    if (lastViewportSignatureRef.current === nextSignature) return
    lastViewportSignatureRef.current = nextSignature
    viewerSceneRef.current = nextScene
    setViewerScene(nextScene)
    onViewportChange(nextScene)
  }, [onViewportChange])

  if (!publicSolveSceneHasContent(viewerScene)) {
    return (
      <div className={`rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 ${className}`.trim()}>
        {emptyLabel}
      </div>
    )
  }

  const resolvedWidthStyle = Number.isFinite(maxWidthPx) && Number(maxWidthPx) > 0
    ? `min(100%, ${Number(maxWidthPx)}px)`
    : '100%'

  return (
    <div className={`philani-solution-viewer ${className}`.trim()}>
      <div
        className="relative overflow-hidden bg-white"
        style={{
          width: resolvedWidthStyle,
          height: `${Math.max(1, viewerHeightPx)}px`,
          touchAction: onViewportChange ? 'none' : undefined,
        }}
      >
        <div className={`absolute inset-0 ${heightClassName || ''}`.trim()}>
          <LessonStyledExcalidraw
            key={viewerInstanceKey}
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
  const [interactiveScene, setInteractiveScene] = useState<PublicSolveScene | null>(normalizedScene)

  useEffect(() => {
    setInteractiveScene(normalizedScene)
  }, [normalizedScene])

  const activeScene = interactiveScene || normalizedScene
  const viewerLayout = useMemo(
    () => buildSceneViewportFromStrokeBounds(activeScene, { maxHeightPx: viewerHeightPx, maxWidthPx }),
    [activeScene, maxWidthPx, viewerHeightPx]
  )
  const viewerScene = viewerLayout.scene
  const viewerInstanceKey = useMemo(() => buildPublicSolveViewerKey(viewerScene), [viewerScene])
  const viewerViewportSize = useMemo(() => ({ widthPx: viewerLayout.widthPx, heightPx: viewerLayout.heightPx }), [viewerLayout.heightPx, viewerLayout.widthPx])
  const viewerSurfaceRef = useRef<HTMLDivElement | null>(null)
  const excalidrawApiRef = useRef<any>(null)
  const viewerSceneRef = useRef<PublicSolveScene | null>(viewerScene)
  const interactiveAppStateRef = useRef<Record<string, any> | undefined>(viewerScene?.appState)
  const panGestureRef = useRef<{ pointerId: number | 'mouse'; lastX: number; lastY: number } | null>(null)
  const lastViewportSignatureRef = useRef<string | null>(null)
  const [isViewportDragging, setIsViewportDragging] = useState(false)

  useEffect(() => {
    lastViewportSignatureRef.current = serializePublicSolveViewportSnapshot(viewerScene?.appState)
  }, [viewerScene])

  useEffect(() => {
    viewerSceneRef.current = viewerScene
    interactiveAppStateRef.current = viewerScene?.appState
    if (viewerScene && excalidrawApiRef.current?.updateScene) {
      const nextInitialData = buildInitialData(viewerScene)
      excalidrawApiRef.current.updateScene({
        elements: nextInitialData.elements,
        appState: nextInitialData.appState || {},
        files: nextInitialData.files || {},
        captureUpdate: 'IMMEDIATELY',
      })
    }
  }, [viewerScene])

  const commitInteractiveViewport = useCallback((nextAppState: Record<string, any>) => {
    if (!onViewportChange) return
    const baseScene = viewerSceneRef.current
    const nextScene = mergeViewportAppStateIntoScene(baseScene, nextAppState, viewerViewportSize)
    const nextSignature = serializePublicSolveViewportSnapshot(nextScene.appState)
    if (lastViewportSignatureRef.current === nextSignature) return
    lastViewportSignatureRef.current = nextSignature
    viewerSceneRef.current = nextScene
    interactiveAppStateRef.current = nextScene.appState
    setInteractiveScene(nextScene)
    const nextInitialData = buildInitialData(nextScene)
    excalidrawApiRef.current?.updateScene?.({
      elements: nextInitialData.elements,
      appState: nextInitialData.appState || {},
      files: nextInitialData.files || {},
      captureUpdate: 'IMMEDIATELY',
    })
    onViewportChange(nextScene)
  }, [onViewportChange, viewerViewportSize])

  const handleViewerChange = useCallback((_elements: any[], appState: any) => {
    if (!onViewportChange) return
    commitInteractiveViewport({ ...(appState || {}) })
  }, [commitInteractiveViewport, onViewportChange])

  const handleViewportPointerDown = useCallback((event: any) => {
    if (!onViewportChange) return
    if (typeof event.button === 'number' && event.button !== 0) return
    panGestureRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    }
    setIsViewportDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }, [onViewportChange])

  const handleViewportPointerMove = useCallback((event: any) => {
    const gesture = panGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const dx = Number(event.clientX || 0) - gesture.lastX
    const dy = Number(event.clientY || 0) - gesture.lastY
    if (!dx && !dy) return
    gesture.lastX = Number(event.clientX || 0)
    gesture.lastY = Number(event.clientY || 0)

    const currentAppState = interactiveAppStateRef.current || viewerSceneRef.current?.appState || {}
    commitInteractiveViewport({
      ...(currentAppState || {}),
      scrollX: Number(currentAppState?.scrollX || 0) + dx,
      scrollY: Number(currentAppState?.scrollY || 0) + dy,
      zoom: getAppStateZoomValue(currentAppState) || 1,
    })
    event.preventDefault()
    event.stopPropagation()
  }, [commitInteractiveViewport])

  const handleViewportPointerEnd = useCallback((event: any) => {
    const gesture = panGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    panGestureRef.current = null
    setIsViewportDragging(false)
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const handleViewportMouseDown = useCallback((event: any) => {
    if (!onViewportChange) return
    if (typeof event.button === 'number' && event.button !== 0) return
    panGestureRef.current = {
      pointerId: 'mouse',
      lastX: event.clientX,
      lastY: event.clientY,
    }
    setIsViewportDragging(true)
    event.preventDefault()
    event.stopPropagation()
  }, [onViewportChange])

  const handleViewportMouseMove = useCallback((event: any) => {
    const gesture = panGestureRef.current
    if (!gesture || gesture.pointerId !== 'mouse') return
    const dx = Number(event.clientX || 0) - gesture.lastX
    const dy = Number(event.clientY || 0) - gesture.lastY
    if (!dx && !dy) return
    gesture.lastX = Number(event.clientX || 0)
    gesture.lastY = Number(event.clientY || 0)

    const currentAppState = interactiveAppStateRef.current || viewerSceneRef.current?.appState || {}
    commitInteractiveViewport({
      ...(currentAppState || {}),
      scrollX: Number(currentAppState?.scrollX || 0) + dx,
      scrollY: Number(currentAppState?.scrollY || 0) + dy,
      zoom: getAppStateZoomValue(currentAppState) || 1,
    })
    event.preventDefault()
    event.stopPropagation()
  }, [commitInteractiveViewport])

  const handleViewportMouseEnd = useCallback((event: any) => {
    const gesture = panGestureRef.current
    if (!gesture || gesture.pointerId !== 'mouse') return
    panGestureRef.current = null
    setIsViewportDragging(false)
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const handleViewportWheel = useCallback((event: any) => {
    if (!onViewportChange) return
    const surface = viewerSurfaceRef.current
    if (!surface) return
    const currentAppState = interactiveAppStateRef.current || viewerSceneRef.current?.appState || {}
    const currentZoom = getAppStateZoomValue(currentAppState) || 1
    const rect = surface.getBoundingClientRect()
    const localX = Number(event.clientX || 0) - rect.left
    const localY = Number(event.clientY || 0) - rect.top
    const nextZoom = clampNumber(
      Number((currentZoom * (Number(event.deltaY || 0) < 0 ? 1.08 : (1 / 1.08))).toFixed(4)),
      0.2,
      6,
    )
    if (Math.abs(nextZoom - currentZoom) < 0.0005) return

    const scrollX = Number(currentAppState?.scrollX || 0)
    const scrollY = Number(currentAppState?.scrollY || 0)
    const sceneX = (localX - scrollX) / currentZoom
    const sceneY = (localY - scrollY) / currentZoom

    commitInteractiveViewport({
      ...(currentAppState || {}),
      zoom: nextZoom,
      scrollX: localX - (sceneX * nextZoom),
      scrollY: localY - (sceneY * nextZoom),
    })
    event.preventDefault()
    event.stopPropagation()
  }, [commitInteractiveViewport, onViewportChange])

  if (!publicSolveSceneHasContent(viewerScene)) {
    return (
      <div className={`rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 ${className}`.trim()}>
        {emptyLabel}
      </div>
    )
  }

  return (
    <div
      className={`philani-solution-viewer ${className}`.trim()}
      onPointerDown={onViewportChange ? handleViewportPointerDown : undefined}
      onPointerMove={onViewportChange ? handleViewportPointerMove : undefined}
      onPointerUp={onViewportChange ? handleViewportPointerEnd : undefined}
      onPointerCancel={onViewportChange ? handleViewportPointerEnd : undefined}
      onMouseDown={onViewportChange ? handleViewportMouseDown : undefined}
      onMouseMove={onViewportChange ? handleViewportMouseMove : undefined}
      onMouseUp={onViewportChange ? handleViewportMouseEnd : undefined}
      onMouseLeave={onViewportChange ? handleViewportMouseEnd : undefined}
      onWheel={onViewportChange ? handleViewportWheel : undefined}
      style={onViewportChange ? { touchAction: 'none' } : undefined}
    >
      <div
        className="relative overflow-hidden bg-white"
        style={{
          width: `min(100%, ${Math.max(1, viewerLayout.widthPx)}px)`,
          aspectRatio: `${Math.max(1, viewerLayout.widthPx)} / ${Math.max(1, viewerLayout.heightPx)}`,
          maxHeight: `${viewerHeightPx}px`,
        }}
      >
        <div ref={viewerSurfaceRef} className={`absolute inset-0 ${heightClassName || ''}`.trim()}>
          <LessonStyledExcalidraw
            key={viewerInstanceKey}
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
  persistViewerViewportOnSubmit = false,
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
  persistViewerViewportOnSubmit?: boolean
  referencePresentation?: PublicSolveReferencePresentation
  onCancel?: () => void
  onPreviewSubmit?: (scene: PublicSolveScene) => void | Promise<void>
  onSubmit: (scene: PublicSolveScene) => void | Promise<void>
}) {
  const canvasShellRef = useRef<HTMLDivElement | null>(null)
  const excalidrawApiRef = useRef<any>(null)
  const canvasChromeRevealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  const [historyActionState, setHistoryActionState] = useState({ canUndo: false, canRedo: false })
  const [canvasChromeVisible, setCanvasChromeVisible] = useState(true)
  const [isEraserActive, setIsEraserActive] = useState(false)
  const showFullscreenClose = Boolean(fullscreenCanvas && onCancel)
  const showFooterCancel = Boolean(onCancel) && !showFullscreenClose

  const clearCanvasChromeRevealTimeout = useCallback(() => {
    if (canvasChromeRevealTimeoutRef.current) {
      clearTimeout(canvasChromeRevealTimeoutRef.current)
      canvasChromeRevealTimeoutRef.current = null
    }
  }, [])

  const scheduleCanvasChromeReveal = useCallback(() => {
    clearCanvasChromeRevealTimeout()
    canvasChromeRevealTimeoutRef.current = setTimeout(() => {
      setCanvasChromeVisible(true)
      canvasChromeRevealTimeoutRef.current = null
    }, PUBLIC_SOLVE_CANVAS_CHROME_IDLE_MS)
  }, [clearCanvasChromeRevealTimeout])

  const eventMatchesCanvasInteraction = useCallback((event: Event) => {
    if (!fullscreenCanvas) return false

    const path = typeof event.composedPath === 'function' ? event.composedPath() : []
    const nodes = path.length ? path : [event.target]

    const isCanvasInteractionNode = (node: EventTarget | null) => {
      if (node instanceof HTMLCanvasElement) return true
      if (!(node instanceof Element)) return false
      if (node.closest('[data-public-solve-opacity-slider="true"]')) return false
      if (node.closest('[data-public-solve-canvas-close="true"]')) return false
      if (node.closest('.App-bottom-bar')) return false
      if (node.closest('.App-top-bar')) return false
      if (node.closest('.mobile-misc-tools-container')) return false
      if (node.closest('.dropdown-menu')) return false
      if (node.closest('[data-testid="public-solve-reference-card"]')) return false
      if (node.closest('[data-testid="public-solve-reference-dismiss"]')) return false
      return Boolean(node.closest('.excalidraw'))
    }

    return nodes.some(isCanvasInteractionNode)
  }, [fullscreenCanvas])

  const getHistoryActionButtons = useCallback(() => {
    const root = canvasShellRef.current
    if (!root) return { undoButton: null as HTMLButtonElement | null, redoButton: null as HTMLButtonElement | null }

    return {
      undoButton: root.querySelector('[data-testid="button-undo"]') as HTMLButtonElement | null,
      redoButton: root.querySelector('[data-testid="button-redo"]') as HTMLButtonElement | null,
    }
  }, [])

  const syncHistoryActionState = useCallback(() => {
    const { undoButton, redoButton } = getHistoryActionButtons()
    setHistoryActionState((previous) => {
      const next = {
        canUndo: Boolean(undoButton && !undoButton.disabled),
        canRedo: Boolean(redoButton && !redoButton.disabled),
      }
      return previous.canUndo === next.canUndo && previous.canRedo === next.canRedo ? previous : next
    })
  }, [getHistoryActionButtons])

  const triggerHistoryAction = useCallback((action: 'undo' | 'redo') => {
    const { undoButton, redoButton } = getHistoryActionButtons()
    const targetButton = action === 'undo' ? undoButton : redoButton
    if (!targetButton || targetButton.disabled) return
    targetButton.click()
  }, [getHistoryActionButtons])

  const handleClearCanvas = useCallback(() => {
    const api = excalidrawApiRef.current
    if (!api?.updateScene) return

    const currentElements = typeof api.getSceneElementsIncludingDeleted === 'function'
      ? api.getSceneElementsIncludingDeleted()
      : sceneRef.current.elements

    if (!Array.isArray(currentElements) || !currentElements.some((element: any) => !element?.isDeleted)) return

    const clearedElements = cloneScenePart(currentElements).map((element: any) => ({
      ...element,
      isDeleted: true,
    }))

    api.updateScene({
      elements: clearedElements,
      appState: {
        selectedElementIds: {},
        selectedGroupIds: {},
        activeEmbeddable: null,
        editingLinearElement: null,
        selectedLinearElement: null,
      },
      captureUpdate: 'IMMEDIATELY',
    })
  }, [])

  const handleToggleEraser = useCallback(() => {
    const api = excalidrawApiRef.current
    if (!api?.setActiveTool) return

    const nextTool = isEraserActive ? { type: 'freedraw' } : { type: 'eraser' }
    api.setActiveTool(nextTool)
    api.updateScene?.({
      appState: {
        activeTool: nextTool,
      },
    })
  }, [isEraserActive])

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

  useEffect(() => {
    const api = excalidrawApiRef.current
    if (!api?.onChange) return

    const unsubscribe = api.onChange((_elements: any[], appState: any) => {
      setIsEraserActive(appState?.activeTool?.type === 'eraser')
    })

    setIsEraserActive(api.getAppState?.()?.activeTool?.type === 'eraser')
    return unsubscribe
  }, [composerInstanceKey, isReady])

  useEffect(() => {
    if (!fullscreenCanvas) {
      clearCanvasChromeRevealTimeout()
      setCanvasChromeVisible(true)
      return
    }

    const root = canvasShellRef.current
    if (!root) return

    const hideCanvasChrome = (event: Event) => {
      if (!eventMatchesCanvasInteraction(event)) return
      setCanvasChromeVisible(false)
      scheduleCanvasChromeReveal()
    }

    root.addEventListener('pointerdown', hideCanvasChrome, true)
    root.addEventListener('pointermove', hideCanvasChrome, true)
    root.addEventListener('wheel', hideCanvasChrome, true)
    root.addEventListener('keydown', hideCanvasChrome, true)

    return () => {
      clearCanvasChromeRevealTimeout()
      root.removeEventListener('pointerdown', hideCanvasChrome, true)
      root.removeEventListener('pointermove', hideCanvasChrome, true)
      root.removeEventListener('wheel', hideCanvasChrome, true)
      root.removeEventListener('keydown', hideCanvasChrome, true)
    }
  }, [clearCanvasChromeRevealTimeout, eventMatchesCanvasInteraction, fullscreenCanvas, scheduleCanvasChromeReveal])

  useEffect(() => {
    if (!fullscreenCanvas) return
    if (typeof MutationObserver === 'undefined') return

    const root = canvasShellRef.current
    if (!root) return

    syncHistoryActionState()

    const observer = new MutationObserver(() => {
      syncHistoryActionState()
    })

    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['disabled'],
    })

    return () => observer.disconnect()
  }, [composerInstanceKey, fullscreenCanvas, isReady, syncHistoryActionState])

  return (
    <div className={`relative flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_32%),linear-gradient(180deg,#eef4ff_0%,#f8fbff_28%,#ffffff_100%)] text-slate-900 ${fullscreenCanvas ? 'overflow-hidden' : ''}`.trim()}>
      {showFullscreenClose ? (
        <button
          type="button"
          onClick={onCancel}
          data-public-solve-canvas-close="true"
          className={`absolute right-3 top-[calc(var(--app-safe-top)+0.75rem)] z-20 inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 shadow-sm transition-[opacity,transform,background-color] duration-200 hover:bg-slate-100 ${canvasChromeVisible ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 -translate-y-1'}`.trim()}
          aria-label={cancelLabel}
          title={cancelLabel}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
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
        chromeVisible={canvasChromeVisible}
      >
        <div ref={canvasShellRef} className="relative min-h-0 flex-1 bg-white" style={{ touchAction: 'none' }}>
          <LessonStyledExcalidraw
            key={`public-solve-composer-${composerInstanceKey}`}
            className={`h-full ${fullscreenCanvas ? 'philani-excalidraw-safe-fullscreen' : ''} ${fullscreenCanvas && !canvasChromeVisible ? 'philani-excalidraw-chrome-hidden' : ''}`.trim()}
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
        <div className={fullscreenCanvas ? 'grid grid-cols-[1fr_auto_1fr] items-center gap-3' : 'flex items-center justify-between gap-3'}>
          {fullscreenCanvas ? (
            <div className="inline-flex items-center overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm justify-self-start">
              <button
                type="button"
                className="inline-flex h-10 w-11 items-center justify-center border-r border-slate-200 text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => triggerHistoryAction('undo')}
                aria-label="Undo"
                title="Undo"
                disabled={!historyActionState.canUndo}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M15 6 9 12l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                className="inline-flex h-10 w-11 items-center justify-center text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => triggerHistoryAction('redo')}
                aria-label="Redo"
                title="Redo"
                disabled={!historyActionState.canRedo}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          ) : showFooterCancel ? (
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
          ) : <div />}
          {fullscreenCanvas ? (
            <div className="justify-self-center inline-flex items-center overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm">
              <button
                type="button"
                className={`inline-flex h-11 w-11 items-center justify-center border-r border-slate-200 text-slate-600 transition disabled:cursor-not-allowed disabled:opacity-40 ${isEraserActive ? 'bg-slate-900 text-white hover:bg-slate-800' : 'bg-white hover:bg-slate-50'}`.trim()}
                onClick={handleToggleEraser}
                aria-label={isEraserActive ? 'Switch to pen' : 'Use eraser'}
                title={isEraserActive ? 'Switch to pen' : 'Use eraser'}
                disabled={submitting}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m7 16 8.5-8.5a2.12 2.12 0 1 1 3 3L10 19H7z" />
                  <path d="M16 8 6.5 17.5" />
                </svg>
              </button>
              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-r-full bg-white text-slate-600 shadow-sm transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={handleClearCanvas}
                aria-label="Clear canvas"
                title="Clear canvas"
                disabled={!hasContent || submitting}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M7 6l1 14h8l1-14" />
                </svg>
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className={`inline-flex h-11 items-center justify-center rounded-full bg-[#1877f2] px-5 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(24,119,242,0.28)] transition hover:bg-[#176ad8] disabled:cursor-not-allowed disabled:opacity-55 ${fullscreenCanvas ? 'justify-self-end' : ''}`.trim()}
            onClick={() => {
              const action = onPreviewSubmit || onSubmit
              const shellBounds = canvasShellRef.current?.getBoundingClientRect()
              const nextScene = persistViewerViewportOnSubmit
                ? finalizeViewerSnapshotScene(sceneRef.current, {
                  widthPx: shellBounds?.width ?? null,
                  heightPx: shellBounds?.height ?? null,
                })
                : sceneRef.current
              if (persistViewerViewportOnSubmit) {
                applySceneSnapshot(nextScene)
              }
              void action(nextScene)
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