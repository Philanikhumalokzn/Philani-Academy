import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

type PublicSolvePromptMode = 'passive' | 'active'

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

const getAppStateZoomValue = (appState: any) => {
  if (!appState || typeof appState !== 'object') return null
  const raw = appState.zoom
  if (typeof raw === 'number') return normalizeZoomValue(raw)
  if (raw && typeof raw === 'object') return normalizeZoomValue((raw as any).value)
  return null
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
}: {
  scene: PublicSolveScene | null | undefined
  className?: string
  emptyLabel?: string
}) {
  const normalizedScene = useMemo(() => normalizePublicSolveScene(scene), [scene])

  if (!publicSolveSceneHasContent(normalizedScene)) {
    return (
      <div className={`rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 ${className}`.trim()}>
        {emptyLabel}
      </div>
    )
  }

  return (
    <div className={`overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.08)] ${className}`.trim()}>
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        Submitted canvas
      </div>
      <div className="h-[420px] bg-white">
        <LessonStyledExcalidraw
          key={normalizedScene?.updatedAt || 'viewer'}
          className="h-full"
          initialData={buildInitialData(normalizedScene)}
          viewModeEnabled
          zenModeEnabled
          gridModeEnabled={false}
          UIOptions={viewerUiOptions}
          renderTopRightUI={() => null}
        />
      </div>
    </div>
  )
}

export function PublicSolveComposer({
  title,
  prompt,
  imageUrl,
  initialScene,
  submitLabel = 'Submit solve',
  cancelLabel = 'Back',
  submitting = false,
  onCancel,
  onSubmit,
}: {
  title: string
  prompt?: string | null
  imageUrl?: string | null
  initialScene?: PublicSolveScene | null
  submitLabel?: string
  cancelLabel?: string
  submitting?: boolean
  onCancel?: () => void
  onSubmit: (scene: PublicSolveScene) => void | Promise<void>
}) {
  const excalidrawApiRef = useRef<any>(null)
  const sceneRef = useRef<PublicSolveScene>(normalizePublicSolveScene(initialScene) || { elements: [], sceneMeta: createEmptyPublicSolveSceneMeta() })
  const lastAppliedInitialSceneKeyRef = useRef(buildPublicSolveSceneResetKey(sceneRef.current))
  const promptDismissDragRef = useRef<{ pointerId: number | null; startY: number; dragOffsetY: number }>({
    pointerId: null,
    startY: 0,
    dragOffsetY: 0,
  })
  const [composerInstanceKey, setComposerInstanceKey] = useState(0)
  const [composerInitialData, setComposerInitialData] = useState(() => buildInitialData(sceneRef.current))
  const [isReady, setIsReady] = useState(false)
  const [hasContent, setHasContent] = useState(publicSolveSceneHasContent(sceneRef.current))
  const [guideViewportState, setGuideViewportState] = useState(() => getGuideViewportState(sceneRef.current.appState))
  const [guideSpacing, setGuideSpacing] = useState(() => {
    const sceneMeta = normalizePublicSolveSceneMeta(sceneRef.current.sceneMeta)
    return resolveSceneGuideSpacing(sceneRef.current.elements, sceneMeta, getAppStateZoomValue(sceneRef.current.appState))
  })
  const [promptMode, setPromptMode] = useState<PublicSolvePromptMode>('passive')
  const [canvasOpacityPercent, setCanvasOpacityPercent] = useState(100)
  const [promptZoom, setPromptZoom] = useState(1)
  const [promptDismissDragOffset, setPromptDismissDragOffset] = useState(0)

  const canvasOpacity = canvasOpacityPercent / 100

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
    setPromptMode('passive')
    setCanvasOpacityPercent(100)
    setPromptZoom(1)
    setPromptDismissDragOffset(0)
    promptDismissDragRef.current = { pointerId: null, startY: 0, dragOffsetY: 0 }
  }, [title, prompt, imageUrl])

  useEffect(() => {
    const api = excalidrawApiRef.current
    if (!api?.setActiveTool || !api?.updateScene) return

    api.setActiveTool({ type: 'freedraw' })
    api.updateScene({
      appState: {
        activeTool: { type: 'freedraw' },
        currentItemStrokeWidth: 2,
      },
    })

    if (typeof window === 'undefined') return
    const settle = window.setTimeout(() => {
      const latestApi = excalidrawApiRef.current
      latestApi?.setActiveTool?.({ type: 'freedraw' })
      latestApi?.updateScene?.({
        appState: {
          activeTool: { type: 'freedraw' },
          currentItemStrokeWidth: 2,
        },
      })
    }, 0)

    return () => window.clearTimeout(settle)
  }, [isReady])

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

  const promptViewportStyle = useMemo(() => {
    const transition = promptMode === 'active' && promptDismissDragRef.current.pointerId != null
      ? 'none'
      : 'transform 180ms ease, opacity 180ms ease'
    return {
      transform: `translateY(${promptDismissDragOffset}px)`,
      transition,
      touchAction: promptMode === 'active' ? 'pan-x pan-y pinch-zoom' : 'none',
      opacity: promptMode === 'active' ? 1 : 0.98,
      pointerEvents: promptMode === 'active' ? 'auto' : 'none',
    } as any
  }, [promptDismissDragOffset, promptMode])

  const promptDocumentStyle = useMemo(() => {
    const safeZoom = Math.min(PUBLIC_SOLVE_MAX_PROMPT_ZOOM, Math.max(PUBLIC_SOLVE_MIN_PROMPT_ZOOM, promptZoom))
    return {
      zoom: safeZoom,
    } as any
  }, [promptZoom])

  return (
    <div className="flex h-full flex-col bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_32%),linear-gradient(180deg,#eef4ff_0%,#f8fbff_28%,#ffffff_100%)] text-slate-900">
      <div className="relative flex-1 min-h-0 px-3 py-2 sm:px-6 sm:py-4">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-[7] flex items-center pl-2 sm:pl-3">
          <div className="pointer-events-auto flex h-[232px] w-11 flex-col items-center justify-center gap-2 rounded-full border border-slate-200/90 bg-white/92 px-1 py-3 shadow-[0_18px_40px_rgba(15,23,42,0.12)] backdrop-blur-xl">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 [writing-mode:vertical-rl] rotate-180">
              Canvas
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={canvasOpacityPercent}
              onChange={(event) => setCanvasOpacityPercent(Number(event.target.value || 0))}
              aria-label="Canvas opacity"
              className="h-36 w-5 cursor-pointer bg-transparent [-webkit-appearance:slider-vertical] [appearance:slider-vertical]"
            />
            <div className="text-[10px] font-semibold text-slate-500">{canvasOpacityPercent}%</div>
          </div>
        </div>

        <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_22px_60px_rgba(15,23,42,0.10)]">
          <div className="relative min-h-0 flex-1 overflow-hidden bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.96))]">
            <div
              className={`absolute inset-0 overflow-auto ${promptMode === 'active' ? 'z-[6]' : 'z-[1]'}`}
              onWheel={handlePromptWheel}
              style={promptViewportStyle}
            >
              <div className="mx-auto min-h-full w-full max-w-3xl px-5 py-6 pb-28 sm:px-8" style={promptDocumentStyle}>
                <div className="space-y-5">
                  <button
                    type="button"
                    className="block w-full rounded-[24px] border border-slate-200/80 bg-white/94 px-4 py-3 text-left shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:px-5"
                    onClick={enterActivePromptMode}
                    style={{ minHeight: `${PUBLIC_SOLVE_PASSIVE_PROMPT_HEADER_HEIGHT}px` }}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#1877f2]">Problem prompt</div>
                        <h2 className="mt-1 text-base font-semibold tracking-[-0.02em] text-slate-950">{title}</h2>
                      </div>
                      <div className="shrink-0 rounded-full border border-[#1877f2]/15 bg-[#1877f2]/8 px-2.5 py-1 text-[10px] font-semibold text-[#176ad8]">
                        Open
                      </div>
                    </div>
                  </button>

                  <section className="rounded-[28px] border border-slate-200/80 bg-white/94 px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:px-6">
                    {prompt ? (
                      <div className="whitespace-pre-wrap text-[15px] leading-7 text-slate-700">{prompt}</div>
                    ) : (
                      <div className="text-sm leading-6 text-slate-500">No prompt text was attached to this solve.</div>
                    )}
                  </section>

                  {imageUrl ? (
                    <section className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/94 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl">
                      <div className="border-b border-slate-200 bg-slate-50/90 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Attached image
                      </div>
                      <div className="bg-slate-50 p-4 sm:p-5">
                        <img src={imageUrl} alt={title} className="max-h-[720px] w-full rounded-[22px] object-contain" />
                      </div>
                    </section>
                  ) : null}
                </div>
              </div>

              {promptMode === 'active' ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[7] flex justify-center pb-4">
                  <div className="pointer-events-auto flex flex-col items-center gap-2 rounded-[24px] border border-slate-200 bg-white/94 px-4 py-3 shadow-[0_16px_34px_rgba(15,23,42,0.12)] backdrop-blur-xl">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Drag up to return</div>
                    <div
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
              ) : null}
            </div>

            <div
              className={`absolute inset-0 ${promptMode === 'active' ? 'z-[2]' : 'z-[4]'}`}
              style={{
                opacity: canvasOpacity,
                transition: 'opacity 160ms ease',
                pointerEvents: promptMode === 'active' ? 'none' : 'auto',
                top: promptMode === 'active' ? 0 : `${PUBLIC_SOLVE_PASSIVE_PROMPT_HEADER_HEIGHT}px`,
              }}
            >
              <div className="flex h-full min-h-0 flex-col bg-white/96">
                <div className="relative min-h-0 flex-1 bg-white" style={{ touchAction: 'none' }}>
                  <LessonStyledExcalidraw
                    key={`public-solve-composer-${composerInstanceKey}`}
                    className="h-full"
                    initialData={composerInitialData}
                    UIOptions={editorUiOptions}
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
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white/92 px-4 py-3 backdrop-blur-xl sm:px-6">
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
            onClick={() => onSubmit(sceneRef.current)}
            disabled={!isReady || !hasContent || submitting}
          >
            {submitting ? 'Submitting...' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}