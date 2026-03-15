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
const PUBLIC_SOLVE_ZOOM_EPSILON = 0.01
const PUBLIC_SOLVE_DEFAULT_GUIDE_SPACING = 48
const PUBLIC_SOLVE_MIN_GUIDE_SPACING = 20
const PUBLIC_SOLVE_MAX_GUIDE_SPACING = 96

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

const getTrackableElementIdSet = (elements: any[]) => new Set(
  (Array.isArray(elements) ? elements : [])
    .filter(isTrackableFreedrawElement)
    .map((element: any) => String(element.id))
)

const getSegmentById = (sceneMeta: PublicSolveSceneMeta, segmentId: string | null) => {
  if (!segmentId) return null
  return sceneMeta.segments.find((segment) => segment.id === segmentId) || null
}

const prunePublicSolveSceneMeta = (sceneMeta: PublicSolveSceneMeta, elements: any[]) => {
  const aliveIds = getTrackableElementIdSet(elements)
  const segments = sceneMeta.segments
    .map((segment) => ({
      ...segment,
      elementIds: segment.elementIds.filter((id) => aliveIds.has(id)),
    }))
    .filter((segment) => segment.elementIds.length > 0)

  const next: PublicSolveSceneMeta = {
    ...sceneMeta,
    segments,
    baselineSegmentId: sceneMeta.baselineSegmentId,
    activeSegmentId: sceneMeta.activeSegmentId,
  }

  const ids = new Set(segments.map((segment) => segment.id))
  if (!next.baselineSegmentId || !ids.has(next.baselineSegmentId)) {
    next.baselineSegmentId = segments[0]?.id || null
  }
  if (!next.activeSegmentId || !ids.has(next.activeSegmentId)) {
    next.activeSegmentId = null
  }
  return next
}

const computePublicSolveNormalizationState = (scene: PublicSolveScene | null | undefined) => {
  const normalized = normalizePublicSolveScene(scene)
  const sceneMeta = normalizePublicSolveSceneMeta(normalized?.sceneMeta)
  const activeSegment = getSegmentById(sceneMeta, sceneMeta.activeSegmentId)
  const baselineSegment = getSegmentById(sceneMeta, sceneMeta.baselineSegmentId)
  if (!normalized || !activeSegment || !baselineSegment) return false
  if (activeSegment.id === baselineSegment.id) return false
  if (activeSegment.status === 'normalized') return false
  const activeZoom = normalizeZoomValue(activeSegment.zoomAtStart)
  const baselineZoom = normalizeZoomValue(baselineSegment.zoomAtStart)
  if (!activeZoom || !baselineZoom) return false
  return Math.abs(activeZoom - baselineZoom) > PUBLIC_SOLVE_ZOOM_EPSILON
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

const getElementsGroupBounds = (elements: any[]) => {
  const bounds = getElementsBoundingBox(elements)
  if (!bounds) return null

  return {
    centerX: bounds.centerX,
    centerY: bounds.centerY,
  }
}

const getSegmentElements = (elements: any[], segment: PublicSolveSegmentMeta | null) => {
  if (!segment) return []
  const ids = new Set(segment.elementIds.map((id) => String(id || '')))
  return (Array.isArray(elements) ? elements : []).filter((element: any) => ids.has(String(element?.id || '')) && isTrackableFreedrawElement(element))
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
  const baselineSegment = getSegmentById(sceneMeta, sceneMeta.baselineSegmentId)
  const baselineSpacing = estimateGuideSpacingFromElements(getSegmentElements(elements, baselineSegment), explicit)
  if (baselineSpacing) return baselineSpacing
  return estimateGuideSpacingFromElements(elements, explicit) || resolveDefaultGuideSpacingForZoom(viewportZoom ?? sceneMeta.lastObservedZoom)
}

const scaleExcalidrawFreedrawPoint = (point: any, factor: number) => {
  if (!Array.isArray(point)) return point
  return [Number(point[0] || 0) * factor, Number(point[1] || 0) * factor, ...point.slice(2)]
}

const scaleFreedrawElementAroundPoint = (element: any, factor: number, anchorX: number, anchorY: number) => {
  const version = Number(element?.version || 1)
  return {
    ...element,
    x: anchorX + (Number(element?.x || 0) - anchorX) * factor,
    y: anchorY + (Number(element?.y || 0) - anchorY) * factor,
    width: Number(element?.width || 0) * factor,
    height: Number(element?.height || 0) * factor,
    points: Array.isArray(element?.points)
      ? element.points.map((point: any) => scaleExcalidrawFreedrawPoint(point, factor))
      : element?.points,
    lastCommittedPoint: Array.isArray(element?.lastCommittedPoint)
      ? scaleExcalidrawFreedrawPoint(element.lastCommittedPoint, factor)
      : element?.lastCommittedPoint,
    version: Number.isFinite(version) ? version + 1 : 2,
    versionNonce: Math.floor(Math.random() * 2_147_483_647),
  }
}

const translateFreedrawElement = (element: any, deltaX: number, deltaY: number) => {
  const version = Number(element?.version || 1)
  return {
    ...element,
    x: Number(element?.x || 0) + deltaX,
    y: Number(element?.y || 0) + deltaY,
    version: Number.isFinite(version) ? version + 1 : 2,
    versionNonce: Math.floor(Math.random() * 2_147_483_647),
  }
}

const quantizeClusterToNotebookGuides = (
  clusterBounds: NonNullable<ReturnType<typeof getElementsBoundingBox>>,
  guideSpacing: number,
) => {
  const bottom = clusterBounds.maxY
  const height = Math.max(clusterBounds.height, 1)
  const nearestLineIndex = Math.round(bottom / guideSpacing)
  const sizes = [guideSpacing, guideSpacing / 2, guideSpacing / 4]
  const candidates: Array<{ targetHeight: number; targetBottom: number; score: number }> = []

  for (let lineOffset = -1; lineOffset <= 1; lineOffset += 1) {
    const lineY = (nearestLineIndex + lineOffset) * guideSpacing
    for (const targetHeight of sizes) {
      const laneBottoms = new Set<number>([lineY])
      if (targetHeight <= guideSpacing / 2 + 0.001) {
        laneBottoms.add(lineY - guideSpacing / 2)
      }
      if (targetHeight <= guideSpacing / 4 + 0.001) {
        laneBottoms.add(lineY + guideSpacing / 4)
      }

      for (const targetBottom of laneBottoms) {
        const scaleCost = Math.abs(Math.log(targetHeight / height))
        const verticalCost = Math.abs(targetBottom - bottom) / guideSpacing
        const targetCenterY = targetBottom - (targetHeight / 2)
        const centerCost = Math.abs(targetCenterY - clusterBounds.centerY) / guideSpacing
        candidates.push({
          targetHeight,
          targetBottom,
          score: (scaleCost * 1.35) + verticalCost + (centerCost * 0.35),
        })
      }
    }
  }

  candidates.sort((left, right) => left.score - right.score)
  return candidates[0] || { targetHeight: guideSpacing, targetBottom: bottom, score: 0 }
}

const quantizeSegmentToNotebookGuides = (
  elements: any[],
  segment: PublicSolveSegmentMeta,
  guideSpacing: number,
) => {
  const segmentElements = getSegmentElements(elements, segment)
  const clusters = buildFreedrawGlyphClusters(segmentElements, guideSpacing)
  if (!clusters.length) return elements

  const replacements = new Map<string, any>()
  for (const cluster of clusters) {
    if (!cluster.bounds) continue
    const choice = quantizeClusterToNotebookGuides(cluster.bounds, guideSpacing)
    const factor = choice.targetHeight / Math.max(cluster.bounds.height, 1)
    const shiftY = choice.targetBottom - cluster.bounds.maxY

    for (const element of cluster.elements) {
      const scaled = scaleFreedrawElementAroundPoint(element, factor, cluster.bounds.centerX, cluster.bounds.maxY)
      replacements.set(String(element.id), translateFreedrawElement(scaled, 0, shiftY))
    }
  }

  return elements.map((element: any) => replacements.get(String(element?.id || '')) || element)
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
  const pendingSegmentStartRef = useRef(false)
  const [composerInstanceKey, setComposerInstanceKey] = useState(0)
  const [composerInitialData, setComposerInitialData] = useState(() => buildInitialData(sceneRef.current))
  const [isReady, setIsReady] = useState(false)
  const [hasContent, setHasContent] = useState(publicSolveSceneHasContent(sceneRef.current))
  const [canNormalizeCurrentSegment, setCanNormalizeCurrentSegment] = useState(computePublicSolveNormalizationState(sceneRef.current))
  const [guideViewportState, setGuideViewportState] = useState(() => getGuideViewportState(sceneRef.current.appState))
  const [guideSpacing, setGuideSpacing] = useState(() => {
    const sceneMeta = normalizePublicSolveSceneMeta(sceneRef.current.sceneMeta)
    return resolveSceneGuideSpacing(sceneRef.current.elements, sceneMeta, getAppStateZoomValue(sceneRef.current.appState))
  })

  const applySceneSnapshot = useCallback((nextScene: PublicSolveScene, options?: { syncApi?: boolean }) => {
    const normalized = normalizePublicSolveScene(nextScene) || { elements: [], sceneMeta: createEmptyPublicSolveSceneMeta() }
    sceneRef.current = normalized
    setHasContent(publicSolveSceneHasContent(normalized))
    setCanNormalizeCurrentSegment(computePublicSolveNormalizationState(normalized))
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
    pendingSegmentStartRef.current = false
    setIsReady(false)
    setComposerInitialData(buildInitialData(normalized))
    setComposerInstanceKey((prev) => prev + 1)
    applySceneSnapshot(normalized)
  }, [applySceneSnapshot, initialScene])

  const normalizeCurrentSegment = useCallback(() => {
    const normalized = normalizePublicSolveScene(sceneRef.current)
    const api = excalidrawApiRef.current
    if (!normalized || !api?.updateScene) return

    const sceneMeta = normalizePublicSolveSceneMeta(normalized.sceneMeta)
    const activeSegment = getSegmentById(sceneMeta, sceneMeta.activeSegmentId)
    const baselineSegment = getSegmentById(sceneMeta, sceneMeta.baselineSegmentId)
    if (!activeSegment || !baselineSegment) return
    if (activeSegment.id === baselineSegment.id) return

    const activeZoom = normalizeZoomValue(activeSegment.zoomAtStart)
    const baselineZoom = normalizeZoomValue(baselineSegment.zoomAtStart)
    if (!activeZoom || !baselineZoom) return
    if (Math.abs(activeZoom - baselineZoom) <= PUBLIC_SOLVE_ZOOM_EPSILON) return

    const factor = activeZoom / baselineZoom
    if (!Number.isFinite(factor) || factor <= 0) return

    const targetIds = new Set(activeSegment.elementIds)
    const targetElements = normalized.elements.filter((element: any) => targetIds.has(String(element?.id || '')) && isTrackableFreedrawElement(element))
    const bounds = getElementsGroupBounds(targetElements)
    if (!targetElements.length || !bounds) return

    const scaledElements = normalized.elements.map((element: any) => {
      if (!targetIds.has(String(element?.id || '')) || !isTrackableFreedrawElement(element)) return element
      return scaleFreedrawElementAroundPoint(element, factor, bounds.centerX, bounds.centerY)
    })
    const resolvedGuideSpacing = resolveSceneGuideSpacing(
      scaledElements,
      sceneMeta,
      getAppStateZoomValue(normalized.appState) ?? sceneMeta.lastObservedZoom,
    )
    const nextElements = quantizeSegmentToNotebookGuides(scaledElements, activeSegment, resolvedGuideSpacing)

    const nowIso = new Date().toISOString()
    const nextMeta = prunePublicSolveSceneMeta({
      ...sceneMeta,
      guideSpacing: resolvedGuideSpacing,
      activeSegmentId: null,
      segments: sceneMeta.segments.map((segment) => (
        segment.id === activeSegment.id
          ? { ...segment, normalizedAt: nowIso, status: 'normalized' }
          : segment
      )),
    }, nextElements)

    pendingSegmentStartRef.current = false
    applySceneSnapshot({
      ...normalized,
      elements: nextElements,
      sceneMeta: nextMeta,
      updatedAt: nowIso,
    }, { syncApi: true })
  }, [applySceneSnapshot])

  const renderComposerTopRightUi = useCallback(() => {
    if (!canNormalizeCurrentSegment) return null
    return (
      <div className="pointer-events-auto flex items-center gap-2 pr-3 pt-3">
        <button
          type="button"
          className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 bg-white/95 px-4 text-sm font-semibold text-slate-700 shadow-[0_12px_28px_rgba(15,23,42,0.12)] backdrop-blur transition hover:border-slate-300 hover:bg-white"
          onClick={normalizeCurrentSegment}
          title="Resize and snap your latest handwriting to the notebook guide lines."
        >
          Match writing size
        </button>
      </div>
    )
  }, [canNormalizeCurrentSegment, normalizeCurrentSegment])

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

  return (
    <div className="flex h-full flex-col bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_32%),linear-gradient(180deg,#eef4ff_0%,#f8fbff_28%,#ffffff_100%)] text-slate-900">
      <div className="border-b border-slate-200/80 bg-white/85 px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#1877f2]">Solve</div>
            <h1 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-slate-950">{title}</h1>
            {prompt ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{prompt}</p> : null}
          </div>
          {onCancel ? (
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
          ) : null}
        </div>

        {imageUrl ? (
          <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
            <img src={imageUrl} alt={title} className="max-h-[180px] w-full object-contain" />
          </div>
        ) : null}
      </div>

      <div className="flex-1 min-h-0 px-3 py-3 sm:px-6 sm:py-5">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_22px_60px_rgba(15,23,42,0.10)]">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/90 px-4 py-3 text-xs text-slate-500">
            <span>Draw on the notebook guides, then use Match writing size to snap handwriting to full, half, or quarter spacing.</span>
            <span className="hidden sm:inline">Submitted canvases are view-only for everyone else.</span>
          </div>
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
                const previousIds = getTrackableElementIdSet(previousScene.elements)
                const nextElements = cloneScenePart(Array.isArray(elements) ? elements : [])
                let nextMeta = cloneSceneMeta(previousMeta)
                const currentZoom = getAppStateZoomValue(appState)

                if (currentZoom != null) {
                  const previousZoom = normalizeZoomValue(nextMeta.lastObservedZoom)
                  if (previousZoom != null && Math.abs(currentZoom - previousZoom) > PUBLIC_SOLVE_ZOOM_EPSILON) {
                    pendingSegmentStartRef.current = true
                    if (nextMeta.activeSegmentId) {
                      nextMeta.segments = nextMeta.segments.map((segment) => (
                        segment.id === nextMeta.activeSegmentId && segment.status === 'active'
                          ? { ...segment, status: 'closed' }
                          : segment
                      ))
                      nextMeta.activeSegmentId = null
                    }
                  }
                  nextMeta.lastObservedZoom = currentZoom
                }

                const newFreedrawElements = nextElements.filter((element: any) => (
                  isTrackableFreedrawElement(element) && !previousIds.has(String(element.id))
                ))

                if (newFreedrawElements.length > 0) {
                  let activeSegment = getSegmentById(nextMeta, nextMeta.activeSegmentId)
                  if (!activeSegment || pendingSegmentStartRef.current) {
                    const segmentId = makePublicSolveSegmentId()
                    activeSegment = {
                      id: segmentId,
                      startedAt: new Date().toISOString(),
                      zoomAtStart: currentZoom || nextMeta.lastObservedZoom || 1,
                      elementIds: [],
                      normalizedAt: null,
                      status: 'active',
                    }
                    nextMeta.segments = [...nextMeta.segments, activeSegment]
                    nextMeta.activeSegmentId = segmentId
                    if (!nextMeta.baselineSegmentId) {
                      nextMeta.baselineSegmentId = segmentId
                    }
                    pendingSegmentStartRef.current = false
                  }

                  const newIds = newFreedrawElements.map((element: any) => String(element.id))
                  nextMeta.segments = nextMeta.segments.map((segment) => (
                    segment.id === activeSegment?.id
                      ? { ...segment, status: 'active', elementIds: Array.from(new Set([...segment.elementIds, ...newIds])) }
                      : segment
                  ))
                }

                nextMeta = prunePublicSolveSceneMeta(nextMeta, nextElements)
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
              renderTopRightUI={renderComposerTopRightUi}
            />
            <NotebookGuidesOverlay zoom={guideViewportState.zoom} scrollY={guideViewportState.scrollY} guideSpacing={guideSpacing} />
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white/92 px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-slate-500">
            {hasContent ? 'Ready to submit your solve.' : 'Add something to the canvas before submitting.'}
          </div>
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