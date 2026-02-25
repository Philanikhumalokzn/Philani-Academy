import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTapToPeek } from '../lib/useTapToPeek'

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const VIRTUAL_WINDOW_RADIUS = 8
const INITIAL_WARM_PAGE_COUNT = 20
const PAGE_BITMAP_CACHE_LIMIT = 36
const WARM_BITMAP_CACHE_LIMIT = 48
const PHASE2_WARM_BATCH_SIZE = 3
const PHASE2_WARM_FALLBACK_DELAY_MS = 40
const PHASE2_PROGRESS_THRESHOLD = 10
const WARM_RENDER_QUALITY_SCALE = 1
const RENDER_DISK_CACHE_NAME = 'pa-pdf-render-v1'
const RENDER_DISK_CACHE_BASE_URL = 'https://cache.philani.local/pdf-render'
const FAST_SCROLL_VELOCITY_PX_PER_SEC = 2800
const FAST_SCROLL_OVERLAP_MS = 320
const FAST_SCROLL_RESET_VELOCITY_PX_PER_SEC = 220
const PRIORITY_RENDER_RADIUS = 10
const SKIP_RADIUS_STEP = 10
const MAX_SKIP_RADIUS = 30
const PINCH_VERTICAL_ACTIVATION_PX = 3
const PINCH_MAX_VERTICAL_DELTA_PER_FRAME_PX = 28

const buildDiskRenderCacheKey = (cacheIdentity: string, cacheTier: 'display' | 'warm', pageNum: number) => {
  const safeIdentity = encodeURIComponent(cacheIdentity)
  return `${RENDER_DISK_CACHE_BASE_URL}/${safeIdentity}/${cacheTier}/page-${pageNum}.webp`
}

const buildDiskWarmCompleteMarkerKey = (cacheIdentity: string) => {
  const safeIdentity = encodeURIComponent(cacheIdentity)
  return `${RENDER_DISK_CACHE_BASE_URL}/${safeIdentity}/warm-complete.marker`
}

type BitmapCacheEntry = {
  bitmap: ImageBitmap
  width: number
  height: number
  cssWidth: number
  cssHeight: number
  signature: string
}

type PdfViewerOverlayProps = {
  open: boolean
  url: string
  cacheKey?: string
  title: string
  subtitle?: string
  initialState?: {
    page?: number
    zoom?: number
    scrollTop?: number
  }
  onClose: () => void
  onPostImage?: (
    file: File,
    snapshot?: {
      page: number
      zoom: number
      scrollTop: number
    }
  ) => void | Promise<void>
}

export default function PdfViewerOverlay({ open, url, cacheKey, title, subtitle, initialState, onClose, onPostImage }: PdfViewerOverlayProps) {
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(110)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [pdfDoc, setPdfDoc] = useState<any | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const pageContainerRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const pageCanvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map())
  const renderTasksRef = useRef<Map<string, any>>(new Map())
  const displayBitmapCacheRef = useRef<Map<number, BitmapCacheEntry>>(new Map())
  const warmBitmapCacheRef = useRef<Map<number, BitmapCacheEntry>>(new Map())
  const displayRenderSignatureRef = useRef('')
  const warmRenderSignatureRef = useRef('')
  const renderZoomRef = useRef(110)
  const zoomRef = useRef(110)
  const pinchRafRef = useRef<number | null>(null)
  const pendingPinchFrameRef = useRef<{ zoom: number; left: number; top: number } | null>(null)
  const scrollRafRef = useRef<number | null>(null)
  const interactionMotionRafRef = useRef<number | null>(null)
  const interactionStableFramesRef = useRef(0)
  const interactionLastSnapshotRef = useRef<{ left: number; top: number; zoom: number } | null>(null)
  const isInteractingRef = useRef(false)
  const phase2IdleHandleRef = useRef<number | null>(null)
  const phase2TimeoutHandleRef = useRef<number | null>(null)
  const phase2NextPageRef = useRef<number>(INITIAL_WARM_PAGE_COUNT + 1)
  const phase2CompletedCountRef = useRef(0)
  const [phase2ResumeSignal, setPhase2ResumeSignal] = useState(0)
  const lastWheelTsRef = useRef(0)
  const { visible: chromeVisible, peek: kickChromeAutoHide, clearTimer: clearChromeTimer } = useTapToPeek({
    autoHideMs: 2500,
    defaultVisible: true,
    disabled: !open,
  })
  const [postBusy, setPostBusy] = useState(false)
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 })
  const [pageHeights, setPageHeights] = useState<Record<number, number>>({})
  const [estimatedPageHeight, setEstimatedPageHeight] = useState(1100)
  const [priorityFocusPage, setPriorityFocusPage] = useState<number | null>(null)
  const [skipRadius, setSkipRadius] = useState(0)
  const [initialWarmComplete, setInitialWarmComplete] = useState(false)
  const [warmPhase2Progress, setWarmPhase2Progress] = useState({ visible: false, done: 0, total: 0 })
  const warmCompletedIdentitySetRef = useRef<Set<string>>(new Set())
  const cacheIdentityRef = useRef('')
  const cacheUrlRef = useRef<string | null>(null)
  const warmAllCompleteRef = useRef(false)
  const scrollMomentumRef = useRef({
    active: false,
    lastTop: 0,
    lastTs: 0,
    lastFastTs: 0,
    burstCount: 0,
  })
  const pinchActiveRef = useRef(false)
  const restoredScrollRef = useRef(false)
  const swipeStateRef = useRef<{
    pointerId: number | null
    startX: number
    startY: number
    lastX: number
    lastY: number
    handled: boolean
  }>({ pointerId: null, startX: 0, startY: 0, lastX: 0, lastY: 0, handled: false })
  const pinchStateRef = useRef<{
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
  }>({ active: false, startDist: 0, startZoom: 110, anchorX: 0, anchorY: 0, startScrollLeft: 0, startScrollTop: 0, lastDist: 0, lastMidpointX: 0, lastMidpointY: 0 })
  const isMobile = useMemo(() => {
    if (typeof navigator === 'undefined') return false
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  }, [])
  const canUseWorker = useMemo(() => {
    if (typeof window === 'undefined') return false
    return typeof (window as any).Worker !== 'undefined' && !isMobile
  }, [isMobile])

  const minZoom = Math.max(50, renderZoomRef.current)
  const effectiveZoom = clamp(zoom, minZoom, 220)
  const liveScale = clamp(effectiveZoom / Math.max(1, renderZoomRef.current), 0.5, 3)
  const isZoomedForPan = effectiveZoom > renderZoomRef.current + 0.5
  const effectivePage = Math.max(1, page)

  useEffect(() => {
    zoomRef.current = effectiveZoom
  }, [effectiveZoom])

  const applyLivePinchStyle = useCallback((zoomValue: number) => {
    const contentEl = contentRef.current
    if (!contentEl) return
    const scale = clamp(zoomValue / Math.max(1, renderZoomRef.current), 0.5, 3)
    contentEl.style.zoom = String(scale)
    contentEl.style.transform = ''
    contentEl.style.willChange = pinchActiveRef.current ? 'transform' : ''
  }, [])

  const flushPendingPinchFrame = useCallback(() => {
    if (pinchRafRef.current !== null) return
    pinchRafRef.current = window.requestAnimationFrame(() => {
      pinchRafRef.current = null
      const pending = pendingPinchFrameRef.current
      if (!pending) return
      const scrollEl = scrollContainerRef.current
      applyLivePinchStyle(pending.zoom)
      if (scrollEl) {
        const maxLeft = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth)
        const maxTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight)
        scrollEl.scrollLeft = clamp(pending.left, 0, maxLeft)
        scrollEl.scrollTop = clamp(pending.top, 0, maxTop)
      }
      zoomRef.current = pending.zoom
      setZoom(pending.zoom)
    })
  }, [applyLivePinchStyle])

  const totalPages = Math.max(1, numPages || 1)
  const safePage = clamp(effectivePage, 1, totalPages)
  const mountedPages = useMemo(() => {
    const focusPage = clamp(priorityFocusPage ?? safePage, 1, totalPages)
    const radius = priorityFocusPage ? PRIORITY_RENDER_RADIUS : VIRTUAL_WINDOW_RADIUS
    const start = Math.max(1, focusPage - radius)
    const end = Math.min(totalPages, focusPage + radius)
    const pages = Array.from({ length: end - start + 1 }, (_, idx) => start + idx)
    if (!skipRadius || !priorityFocusPage) return pages
    if (Math.abs(focusPage - safePage) <= 1) return pages
    return pages.filter((pageNum) => Math.abs(pageNum - safePage) > skipRadius)
  }, [priorityFocusPage, safePage, skipRadius, totalPages])
  const mountedPageSet = useMemo(() => new Set(mountedPages), [mountedPages])
  const isViewerLoading = loading || (Boolean(pdfDoc) && !initialWarmComplete)

  const setPageContainerRef = useCallback((pageNum: number) => (el: HTMLDivElement | null) => {
    if (el) {
      pageContainerRefs.current.set(pageNum, el)
    } else {
      pageContainerRefs.current.delete(pageNum)
    }
  }, [])

  const setPageCanvasRef = useCallback((pageNum: number) => (el: HTMLCanvasElement | null) => {
    if (el) {
      pageCanvasRefs.current.set(pageNum, el)
    } else {
      pageCanvasRefs.current.delete(pageNum)
    }
  }, [])

  const clearBitmapCache = useCallback((cacheRef: React.MutableRefObject<Map<number, BitmapCacheEntry>>) => {
    cacheRef.current.forEach((entry) => {
      try {
        entry.bitmap.close?.()
      } catch {
        // ignore
      }
    })
    cacheRef.current.clear()
  }, [])

  const clearPageBitmapCache = useCallback(() => {
    clearBitmapCache(displayBitmapCacheRef)
    clearBitmapCache(warmBitmapCacheRef)
    displayRenderSignatureRef.current = ''
    warmRenderSignatureRef.current = ''
  }, [clearBitmapCache])

  const touchBitmapCacheEntry = useCallback((cacheRef: React.MutableRefObject<Map<number, BitmapCacheEntry>>, pageNum: number) => {
    const cache = cacheRef.current
    const current = cache.get(pageNum)
    if (!current) return
    cache.delete(pageNum)
    cache.set(pageNum, current)
  }, [])

  const upsertBitmapCacheEntry = useCallback((
    cacheRef: React.MutableRefObject<Map<number, BitmapCacheEntry>>,
    pageNum: number,
    nextEntry: BitmapCacheEntry,
    cacheLimit: number
  ) => {
    const cache = cacheRef.current
    const existing = cache.get(pageNum)
    if (existing) {
      try {
        existing.bitmap.close?.()
      } catch {
        // ignore
      }
      cache.delete(pageNum)
    }
    cache.set(pageNum, nextEntry)
    while (cache.size > cacheLimit) {
      const oldestKey = cache.keys().next().value
      if (typeof oldestKey !== 'number') break
      const oldest = cache.get(oldestKey)
      if (oldest) {
        try {
          oldest.bitmap.close?.()
        } catch {
          // ignore
        }
      }
      cache.delete(oldestKey)
    }
  }, [])

  const hasAnyBitmapCacheEntry = useCallback((pageNum: number) => {
    return displayBitmapCacheRef.current.has(pageNum) || warmBitmapCacheRef.current.has(pageNum)
  }, [])

  const canUseDiskRenderCache = useCallback(() => {
    if (typeof window === 'undefined') return false
    return typeof window.caches !== 'undefined'
  }, [])

  const readDiskRenderBlob = useCallback(async (diskKey: string) => {
    if (!canUseDiskRenderCache()) return null
    try {
      const cache = await window.caches.open(RENDER_DISK_CACHE_NAME)
      const res = await cache.match(diskKey)
      if (!res || !res.ok) return null
      return await res.blob()
    } catch {
      return null
    }
  }, [canUseDiskRenderCache])

  const writeDiskRenderBlob = useCallback(async (diskKey: string, blob: Blob) => {
    if (!canUseDiskRenderCache()) return
    try {
      const cache = await window.caches.open(RENDER_DISK_CACHE_NAME)
      await cache.put(diskKey, new Response(blob, {
        headers: {
          'content-type': blob.type || 'image/webp',
          'cache-control': 'public, max-age=31536000, immutable',
        },
      }))
    } catch {
      // ignore cache write failures
    }
  }, [canUseDiskRenderCache])

  const hasDiskWarmCompleteMarker = useCallback(async (cacheIdentity: string) => {
    if (!cacheIdentity || !canUseDiskRenderCache()) return false
    try {
      const cache = await window.caches.open(RENDER_DISK_CACHE_NAME)
      const res = await cache.match(buildDiskWarmCompleteMarkerKey(cacheIdentity))
      return Boolean(res && res.ok)
    } catch {
      return false
    }
  }, [canUseDiskRenderCache])

  const persistDiskWarmCompleteMarker = useCallback(async (cacheIdentity: string) => {
    if (!cacheIdentity || !canUseDiskRenderCache()) return
    try {
      const cache = await window.caches.open(RENDER_DISK_CACHE_NAME)
      await cache.put(
        buildDiskWarmCompleteMarkerKey(cacheIdentity),
        new Response('1', {
          headers: {
            'content-type': 'text/plain',
            'cache-control': 'public, max-age=31536000, immutable',
          },
        })
      )
    } catch {
      // ignore marker write failures
    }
  }, [canUseDiskRenderCache])

  const cancelPhase2Schedule = useCallback(() => {
    const hasCancelIdle = typeof window !== 'undefined' && typeof (window as any).cancelIdleCallback === 'function'
    if (phase2IdleHandleRef.current !== null && hasCancelIdle) {
      ;(window as any).cancelIdleCallback(phase2IdleHandleRef.current)
    }
    if (phase2TimeoutHandleRef.current !== null) {
      window.clearTimeout(phase2TimeoutHandleRef.current)
    }
    phase2IdleHandleRef.current = null
    phase2TimeoutHandleRef.current = null
  }, [])

  const cancelWarmRenderTasks = useCallback(() => {
    renderTasksRef.current.forEach((task, key) => {
      if (!String(key).startsWith('warm:')) return
      if (task?.cancel) task.cancel()
      renderTasksRef.current.delete(key)
    })
  }, [])

  const stopInteractionMotionMonitor = useCallback(() => {
    if (interactionMotionRafRef.current !== null) {
      window.cancelAnimationFrame(interactionMotionRafRef.current)
      interactionMotionRafRef.current = null
    }
    interactionStableFramesRef.current = 0
    interactionLastSnapshotRef.current = null
  }, [])

  const markUserInteractionEnded = useCallback(() => {
    if (!isInteractingRef.current) return
    isInteractingRef.current = false
    setPhase2ResumeSignal((prev) => prev + 1)
  }, [])

  const startInteractionMotionMonitor = useCallback(() => {
    if (interactionMotionRafRef.current !== null) return
    const tick = () => {
      const scrollEl = scrollContainerRef.current
      const nextSnapshot = {
        left: scrollEl?.scrollLeft ?? 0,
        top: scrollEl?.scrollTop ?? 0,
        zoom: zoomRef.current,
      }
      const prevSnapshot = interactionLastSnapshotRef.current
      const moved = !prevSnapshot
        || Math.abs(nextSnapshot.left - prevSnapshot.left) > 0.5
        || Math.abs(nextSnapshot.top - prevSnapshot.top) > 0.5
        || Math.abs(nextSnapshot.zoom - prevSnapshot.zoom) > 0.02
      interactionLastSnapshotRef.current = nextSnapshot

      const pointerActive = swipeStateRef.current.pointerId !== null
      const activeMotion = moved || pinchActiveRef.current || pointerActive

      if (activeMotion) {
        interactionStableFramesRef.current = 0
        isInteractingRef.current = true
        interactionMotionRafRef.current = window.requestAnimationFrame(tick)
        return
      }

      interactionStableFramesRef.current += 1
      if (interactionStableFramesRef.current >= 2) {
        stopInteractionMotionMonitor()
        markUserInteractionEnded()
        return
      }
      interactionMotionRafRef.current = window.requestAnimationFrame(tick)
    }
    interactionMotionRafRef.current = window.requestAnimationFrame(tick)
  }, [markUserInteractionEnded, stopInteractionMotionMonitor])

  const markUserInteracting = useCallback(() => {
    isInteractingRef.current = true
    cancelPhase2Schedule()
    cancelWarmRenderTasks()
    interactionStableFramesRef.current = 0
    startInteractionMotionMonitor()
  }, [cancelPhase2Schedule, cancelWarmRenderTasks, startInteractionMotionMonitor])

  const cancelRenderTasks = useCallback(() => {
    renderTasksRef.current.forEach((task) => {
      if (task?.cancel) task.cancel()
    })
    renderTasksRef.current.clear()
  }, [])

  const scrollToPage = useCallback((pageNum: number) => {
    const container = pageContainerRefs.current.get(pageNum)
    if (!container) return
    container.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const updatePageFromScroll = useCallback(() => {
    const scrollEl = scrollContainerRef.current
    if (!scrollEl) return
    const viewportRect = scrollEl.getBoundingClientRect()
    const viewportCenter = viewportRect.top + viewportRect.height / 2
    let bestPage = safePage
    let bestDist = Number.POSITIVE_INFINITY

    pageContainerRefs.current.forEach((container, pageNum) => {
      const rect = container.getBoundingClientRect()
      const center = rect.top + rect.height / 2
      const dist = Math.abs(center - viewportCenter)
      if (dist < bestDist) {
        bestDist = dist
        bestPage = pageNum
      }
    })

    if (bestPage !== safePage) {
      setPage(bestPage)
    }
  }, [safePage])

  const estimatePageFromScrollTop = useCallback((scrollTop: number) => {
    const approxHeight = Math.max(320, Math.round(estimatedPageHeight || 1100))
    const approxPage = Math.floor(scrollTop / approxHeight) + 1
    return clamp(approxPage, 1, totalPages)
  }, [estimatedPageHeight, totalPages])

  const captureVisibleCanvas = useCallback(async () => {
    const canvas = pageCanvasRefs.current.get(safePage)
    const scrollEl = scrollContainerRef.current
    if (!canvas || !scrollEl) return null

    const canvasRect = canvas.getBoundingClientRect()
    const scrollRect = scrollEl.getBoundingClientRect()

    let left = Math.max(canvasRect.left, scrollRect.left)
    let right = Math.min(canvasRect.right, scrollRect.right)
    let top = Math.max(canvasRect.top, scrollRect.top)
    let bottom = Math.min(canvasRect.bottom, scrollRect.bottom)

    if (right <= left || bottom <= top) {
      left = canvasRect.left
      right = canvasRect.right
      top = canvasRect.top
      bottom = canvasRect.bottom
    }

    const scaleX = canvas.width / canvasRect.width
    const scaleY = canvas.height / canvasRect.height
    const sx = Math.max(0, Math.floor((left - canvasRect.left) * scaleX))
    const sy = Math.max(0, Math.floor((top - canvasRect.top) * scaleY))
    const sw = Math.max(1, Math.min(canvas.width - sx, Math.ceil((right - left) * scaleX)))
    const sh = Math.max(1, Math.min(canvas.height - sy, Math.ceil((bottom - top) * scaleY)))

    const outCanvas = document.createElement('canvas')
    outCanvas.width = sw
    outCanvas.height = sh
    const ctx = outCanvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh)

    const blob = await new Promise<Blob | null>((resolve) => {
      outCanvas.toBlob(resolve, 'image/png', 0.92)
    })

    if (!blob) return null
    return new File([blob], `pdf-capture-${Date.now()}.png`, { type: 'image/png' })
  }, [safePage])

  const handlePostCapture = useCallback(async () => {
    if (!onPostImage || isViewerLoading || error || postBusy) return
    setPostBusy(true)
    try {
      kickChromeAutoHide()
      const file = await captureVisibleCanvas()
      if (!file) {
        alert('Unable to capture the current PDF view.')
        return
      }
      const snapshot = {
        page: safePage,
        zoom: effectiveZoom,
        scrollTop: scrollContainerRef.current?.scrollTop ?? 0,
      }
      await onPostImage(file, snapshot)
    } catch (err: any) {
      alert(err?.message || 'Failed to capture PDF view')
    } finally {
      setPostBusy(false)
    }
  }, [captureVisibleCanvas, error, kickChromeAutoHide, isViewerLoading, onPostImage, postBusy, safePage, effectiveZoom])

  const handleSwipeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType && e.pointerType !== 'mouse') return
    swipeStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      handled: false,
    }
  }, [])

  const handleSwipeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType && e.pointerType !== 'mouse') return
    const state = swipeStateRef.current
    if (state.pointerId !== e.pointerId) return
    state.lastX = e.clientX
    state.lastY = e.clientY

    const dx = state.lastX - state.startX
    const dy = state.lastY - state.startY
    if (state.handled) return

    const absX = Math.abs(dx)
    const absY = Math.abs(dy)
    if (absX < 40) return
    if (absX < absY * 1.2) return

    state.handled = true
    kickChromeAutoHide()
    if (dx < 0) {
      setPage((p) => {
        const next = Math.min(totalPages, p + 1)
        scrollToPage(next)
        return next
      })
    } else {
      setPage((p) => {
        const next = Math.max(1, p - 1)
        scrollToPage(next)
        return next
      })
    }
  }, [kickChromeAutoHide, scrollToPage, totalPages])

  const handleSwipeEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType && e.pointerType !== 'mouse') return
    const state = swipeStateRef.current
    if (state.pointerId !== e.pointerId) return
    swipeStateRef.current = { pointerId: null, startX: 0, startY: 0, lastX: 0, lastY: 0, handled: false }
  }, [])

  useEffect(() => {
    if (!open) return
    const el = scrollContainerRef.current
    if (!el) return

    const touchState = { active: false, startX: 0, startY: 0, lastX: 0, lastY: 0 }

    const getPinchDistance = (touches: TouchList) => {
      const a = touches[0]
      const b = touches[1]
      if (!a || !b) return 0
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    }

    const onTouchStart = (e: TouchEvent) => {
      markUserInteracting()
      if (e.touches.length === 2) {
        const scrollEl = scrollContainerRef.current
        const rect = scrollEl?.getBoundingClientRect()
        const a = e.touches[0]
        const b = e.touches[1]
        const midpointX = rect ? ((a.clientX + b.clientX) / 2) - rect.left : (scrollEl?.clientWidth ?? 0) / 2
        const midpointY = rect ? ((a.clientY + b.clientY) / 2) - rect.top : (scrollEl?.clientHeight ?? 0) / 2
        pinchActiveRef.current = true
        pinchStateRef.current.active = true
        pinchStateRef.current.startDist = getPinchDistance(e.touches)
        pinchStateRef.current.startZoom = zoomRef.current
        pinchStateRef.current.startScrollLeft = scrollEl?.scrollLeft ?? 0
        pinchStateRef.current.startScrollTop = scrollEl?.scrollTop ?? 0
        pinchStateRef.current.anchorX = midpointX
        pinchStateRef.current.anchorY = midpointY
        pinchStateRef.current.lastDist = pinchStateRef.current.startDist
        pinchStateRef.current.lastMidpointX = midpointX
        pinchStateRef.current.lastMidpointY = midpointY
        applyLivePinchStyle(zoomRef.current)
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
      markUserInteracting()
      if (pinchStateRef.current.active && e.touches.length === 2) {
        const SCALE_DELTA_EPSILON = 0.002
        e.preventDefault()
        const dist = getPinchDistance(e.touches)
        if (!dist) return
        const scrollEl = scrollContainerRef.current
        const rect = scrollEl?.getBoundingClientRect()
        const a = e.touches[0]
        const b = e.touches[1]
        const midpointX = rect ? ((a.clientX + b.clientX) / 2) - rect.left : pinchStateRef.current.anchorX
        const midpointY = rect ? ((a.clientY + b.clientY) / 2) - rect.top : pinchStateRef.current.anchorY
        const prevDist = pinchStateRef.current.lastDist > 0 ? pinchStateRef.current.lastDist : dist
        const scaleDelta = prevDist > 0 ? dist / prevDist : 1
        const prevMidpointX = pinchStateRef.current.lastMidpointX || midpointX
        const prevMidpointY = pinchStateRef.current.lastMidpointY || midpointY
        const midpointStepY = midpointY - prevMidpointY
        const gestureMinZoom = Math.max(50, renderZoomRef.current)
        const prevZoom = Math.max(1, zoomRef.current)
        const nextZoom = clamp(prevZoom * scaleDelta, gestureMinZoom, 220)
        const isZooming = Math.abs(scaleDelta - 1) > SCALE_DELTA_EPSILON
        const isBaseZoom = nextZoom <= renderZoomRef.current + 0.5
        const allowHorizontalPan = isZooming || !isBaseZoom

        if (scrollEl && zoomRef.current > 0) {
          applyLivePinchStyle(nextZoom)

          const maxLeft = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth)
          const maxTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight)
          const currentLeft = scrollEl.scrollLeft
          const currentTop = scrollEl.scrollTop
          const zoomRatio = nextZoom / prevZoom
          const rawNextLeft = (zoomRatio * (currentLeft + prevMidpointX)) - midpointX
          const nextLeft = allowHorizontalPan ? rawNextLeft : scrollEl.scrollLeft
          const rawNextTop = (zoomRatio * (currentTop + prevMidpointY)) - midpointY
          const allowVerticalPan = isZooming || Math.abs(midpointStepY) >= PINCH_VERTICAL_ACTIVATION_PX
          const nextTopUnclamped = allowVerticalPan
            ? clamp(rawNextTop, currentTop - PINCH_MAX_VERTICAL_DELTA_PER_FRAME_PX, currentTop + PINCH_MAX_VERTICAL_DELTA_PER_FRAME_PX)
            : currentTop
          const nextTop = nextTopUnclamped

          const clampedLeft = clamp(nextLeft, 0, maxLeft)
          const clampedTop = clamp(nextTop, 0, maxTop)

          if (maxLeft > 1) {
            scrollEl.scrollLeft = clampedLeft
          }
          if (maxTop > 1) {
            scrollEl.scrollTop = clampedTop
          }

          pendingPinchFrameRef.current = {
            zoom: nextZoom,
            left: clampedLeft,
            top: clampedTop,
          }
          flushPendingPinchFrame()

          pinchStateRef.current.lastDist = dist
          pinchStateRef.current.lastMidpointX = midpointX
          pinchStateRef.current.lastMidpointY = midpointY
        }
        kickChromeAutoHide()
        return
      }
      if (!touchState.active || e.touches.length !== 1) return
      const t = e.touches[0]
      touchState.lastX = t.clientX
      touchState.lastY = t.clientY
    }

    const onTouchEnd = () => {
      startInteractionMotionMonitor()
      if (pinchRafRef.current !== null) {
        window.cancelAnimationFrame(pinchRafRef.current)
        pinchRafRef.current = null
      }
      const pending = pendingPinchFrameRef.current
      if (pending) {
        const scrollEl = scrollContainerRef.current
        applyLivePinchStyle(pending.zoom)
        if (scrollEl) {
          const maxLeft = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth)
          const maxTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight)
          scrollEl.scrollLeft = clamp(pending.left, 0, maxLeft)
          scrollEl.scrollTop = clamp(pending.top, 0, maxTop)
        }
        zoomRef.current = pending.zoom
        setZoom(pending.zoom)
        pendingPinchFrameRef.current = null
      }
      if (pinchStateRef.current.active) {
        pinchActiveRef.current = false
        pinchStateRef.current.active = false
        applyLivePinchStyle(zoomRef.current)
        return
      }
      if (!touchState.active) return
      touchState.active = false

      const scrollEl = scrollContainerRef.current
      const isBaseZoom = zoomRef.current <= renderZoomRef.current + 0.5
      const canUsePageSwipe = isBaseZoom
      if (!canUsePageSwipe) {
        return
      }

      const dx = touchState.lastX - touchState.startX
      const dy = touchState.lastY - touchState.startY
      const absX = Math.abs(dx)
      const absY = Math.abs(dy)
      if (absX < 40) return
      if (absX < absY * 1.2) return
      kickChromeAutoHide()
      if (dx < 0) {
        setPage((p) => {
          const next = Math.min(totalPages, p + 1)
          scrollToPage(next)
          return next
        })
      } else {
        setPage((p) => {
          const next = Math.max(1, p - 1)
          scrollToPage(next)
          return next
        })
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      if (pinchRafRef.current !== null) {
        window.cancelAnimationFrame(pinchRafRef.current)
        pinchRafRef.current = null
      }
      pendingPinchFrameRef.current = null
      pinchActiveRef.current = false
      applyLivePinchStyle(zoomRef.current)
    }
  }, [applyLivePinchStyle, flushPendingPinchFrame, kickChromeAutoHide, markUserInteracting, open, scrollToPage, startInteractionMotionMonitor, totalPages])

  useEffect(() => {
    if (!open) return
    kickChromeAutoHide()
    return () => {
      clearChromeTimer()
    }
  }, [open, kickChromeAutoHide, clearChromeTimer])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        setPage((p) => {
          const next = Math.max(1, p - 1)
          scrollToPage(next)
          return next
        })
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        setPage((p) => {
          const next = Math.min(totalPages, p + 1)
          scrollToPage(next)
          return next
        })
        return
      }
      kickChromeAutoHide()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose, kickChromeAutoHide, scrollToPage, totalPages])

  useEffect(() => {
    if (!open || !url) return
    let cancelled = false
    let activeDoc: any | null = null
    let loadingTask: any | null = null
    const cacheIdentity = String(cacheKey || url)
    cacheIdentityRef.current = cacheIdentity
    const canReuseWarmCache = cacheUrlRef.current === cacheIdentity
      && (displayBitmapCacheRef.current.size > 0 || warmBitmapCacheRef.current.size > 0)
    const hasInSessionWarmCompletion = warmCompletedIdentitySetRef.current.has(cacheIdentity)
    let shouldSkipWarmPhases = canReuseWarmCache && hasInSessionWarmCompletion

    setLoading(true)
    setError(null)
    setPdfDoc(null)
    setNumPages(0)
    scrollMomentumRef.current = { active: false, lastTop: 0, lastTs: 0, lastFastTs: 0, burstCount: 0 }
    setPriorityFocusPage(null)
    setSkipRadius(0)
    if (!canReuseWarmCache) {
      clearPageBitmapCache()
      setPageHeights({})
      setEstimatedPageHeight(1100)
      setInitialWarmComplete(false)
      warmAllCompleteRef.current = false
      phase2NextPageRef.current = INITIAL_WARM_PAGE_COUNT + 1
      phase2CompletedCountRef.current = 0
    }
    if (shouldSkipWarmPhases) {
      setInitialWarmComplete(true)
      warmAllCompleteRef.current = true
      setWarmPhase2Progress({ visible: false, done: 0, total: 0 })
    }
    setWarmPhase2Progress({ visible: false, done: 0, total: 0 })
    const initialZoom = clamp(initialState?.zoom ?? 110, 50, 220)
    renderZoomRef.current = initialZoom
    setPage(initialState?.page ?? 1)
    setZoom(initialZoom)
    restoredScrollRef.current = false

    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist/build/pdf.mjs')
        if (pdfjs?.GlobalWorkerOptions) {
          pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
        }

        const loadWithOptions = async (opts: Record<string, any>) => {
          loadingTask = pdfjs.getDocument({
            url,
            ...opts,
          })
          return await loadingTask.promise
        }

        let doc: any
        try {
          doc = await loadWithOptions({ disableWorker: !canUseWorker })
        } catch (innerErr: any) {
          const message = String(innerErr?.message || '')
          if (/fake worker|worker/i.test(message)) {
            doc = await loadWithOptions({ disableWorker: true })
          } else {
            throw innerErr
          }
        }
        activeDoc = doc
        if (cancelled) {
          if (doc?.destroy) await doc.destroy()
          return
        }
        if (!shouldSkipWarmPhases) {
          shouldSkipWarmPhases = await hasDiskWarmCompleteMarker(cacheIdentity)
          if (shouldSkipWarmPhases && !cancelled) {
            warmCompletedIdentitySetRef.current.add(cacheIdentity)
            setInitialWarmComplete(true)
            warmAllCompleteRef.current = true
            setWarmPhase2Progress({ visible: false, done: 0, total: 0 })
          }
        }
        cacheUrlRef.current = cacheIdentity
        if (shouldSkipWarmPhases) {
          const pageCount = Math.max(0, Number(doc?.numPages || 0))
          const startPage = Math.min(pageCount + 1, INITIAL_WARM_PAGE_COUNT + 1)
          phase2NextPageRef.current = pageCount + 1
          phase2CompletedCountRef.current = Math.max(0, pageCount - startPage + 1)
        }
        setPdfDoc(doc)
        setNumPages(doc?.numPages || 0)
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load PDF')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      try {
        if (loadingTask?.destroy) loadingTask.destroy()
      } catch {
        // ignore
      }
      try {
        if (activeDoc?.destroy) activeDoc.destroy()
      } catch {
        // ignore
      }
    }
  }, [open, url, cacheKey, initialState?.page, initialState?.zoom, clearPageBitmapCache, hasDiskWarmCompleteMarker])

  useEffect(() => {
    if (open) return
    cancelPhase2Schedule()
    cancelWarmRenderTasks()
    cancelRenderTasks()
    isInteractingRef.current = false
    stopInteractionMotionMonitor()
    setWarmPhase2Progress({ visible: false, done: 0, total: 0 })
    if (pdfDoc?.destroy) {
      pdfDoc.destroy()
    }
    setPdfDoc(null)
  }, [open, pdfDoc, cancelPhase2Schedule, cancelWarmRenderTasks, cancelRenderTasks, stopInteractionMotionMonitor])

  const renderPageToCanvas = useCallback(async (
    pageNum: number,
    canvas: HTMLCanvasElement,
    options?: { qualityScale?: number; cacheTier?: 'display' | 'warm' }
  ) => {
    if (!pdfDoc || !open) return
    const context = canvas.getContext('2d')
    if (!context) return

    try {
      const cacheTier = options?.cacheTier || 'display'
      const cacheRef = cacheTier === 'warm' ? warmBitmapCacheRef : displayBitmapCacheRef
      const cacheLimit = cacheTier === 'warm' ? WARM_BITMAP_CACHE_LIMIT : PAGE_BITMAP_CACHE_LIMIT
      const signatureRef = cacheTier === 'warm' ? warmRenderSignatureRef : displayRenderSignatureRef
      const requestedQuality = clamp(options?.qualityScale ?? 1, 0.1, 1)
      const outputScale = (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1) * requestedQuality
      const signature = `${Math.round(contentSize.width || 0)}:${Math.round(renderZoomRef.current)}:${Math.round(outputScale * 100)}`
      if (signatureRef.current && signatureRef.current !== signature) {
        clearBitmapCache(cacheRef)
      }
      if (!signatureRef.current) {
        signatureRef.current = signature
      }

      const cached = cacheRef.current.get(pageNum)
      if (cached && cached.signature === signature) {
        canvas.width = cached.width
        canvas.height = cached.height
        canvas.style.width = `${cached.cssWidth}px`
        canvas.style.height = `${cached.cssHeight}px`
        context.setTransform(1, 0, 0, 1, 0, 0)
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.drawImage(cached.bitmap, 0, 0)
        touchBitmapCacheEntry(cacheRef, pageNum)
        setPageHeights((prev) => (prev[pageNum] === cached.cssHeight ? prev : { ...prev, [pageNum]: cached.cssHeight }))
        setEstimatedPageHeight((prev) => Math.max(320, Math.round((prev * 0.85) + (cached.cssHeight * 0.15))))
        return
      }

      if (cacheTier === 'display') {
        const warmCached = warmBitmapCacheRef.current.get(pageNum)
        if (warmCached && warmCached.signature === warmRenderSignatureRef.current) {
          canvas.width = warmCached.width
          canvas.height = warmCached.height
          canvas.style.width = `${warmCached.cssWidth}px`
          canvas.style.height = `${warmCached.cssHeight}px`
          context.setTransform(1, 0, 0, 1, 0, 0)
          context.clearRect(0, 0, canvas.width, canvas.height)
          context.drawImage(warmCached.bitmap, 0, 0)
          touchBitmapCacheEntry(warmBitmapCacheRef, pageNum)
        }
      }

      const cacheIdentity = cacheIdentityRef.current
      if (cacheIdentity && typeof window !== 'undefined' && typeof window.createImageBitmap === 'function') {
        const tryHydrateFromDisk = async (diskTier: 'display' | 'warm') => {
          const diskKey = buildDiskRenderCacheKey(cacheIdentity, diskTier, pageNum)
          const blob = await readDiskRenderBlob(diskKey)
          if (!blob) return false
          try {
            const bitmap = await window.createImageBitmap(blob)
            const cssWidth = Math.max(1, Math.floor(bitmap.width / Math.max(outputScale, 0.0001)))
            const cssHeight = Math.max(1, Math.floor(bitmap.height / Math.max(outputScale, 0.0001)))
            canvas.width = bitmap.width
            canvas.height = bitmap.height
            canvas.style.width = `${cssWidth}px`
            canvas.style.height = `${cssHeight}px`
            context.setTransform(1, 0, 0, 1, 0, 0)
            context.clearRect(0, 0, canvas.width, canvas.height)
            context.drawImage(bitmap, 0, 0)
            upsertBitmapCacheEntry(cacheRef, pageNum, {
              bitmap,
              width: canvas.width,
              height: canvas.height,
              cssWidth,
              cssHeight,
              signature,
            }, cacheLimit)
            setPageHeights((prev) => (prev[pageNum] === cssHeight ? prev : { ...prev, [pageNum]: cssHeight }))
            setEstimatedPageHeight((prev) => Math.max(320, Math.round((prev * 0.85) + (cssHeight * 0.15))))
            return true
          } catch {
            return false
          }
        }

        const hydratedFromPrimaryTier = await tryHydrateFromDisk(cacheTier)
        if (hydratedFromPrimaryTier) return
        if (cacheTier === 'display') {
          const hydratedFromWarmTier = await tryHydrateFromDisk('warm')
          if (hydratedFromWarmTier) return
        }
      }

      const pageObj = await pdfDoc.getPage(pageNum)
      const baseScale = renderZoomRef.current / 100
      const baseViewport = pageObj.getViewport({ scale: baseScale })
      const availableWidth = contentSize.width || scrollContainerRef.current?.clientWidth || 0
      const fitScale = availableWidth
        ? clamp(availableWidth / baseViewport.width, 0.5, 2)
        : 1
      const finalScale = baseScale * fitScale
      const viewport = pageObj.getViewport({ scale: finalScale })
      const cssWidth = Math.floor(viewport.width)
      const cssHeight = Math.floor(viewport.height)
      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`
      context.setTransform(outputScale, 0, 0, outputScale, 0, 0)

      const taskKey = `${cacheTier}:${pageNum}`
      const existing = renderTasksRef.current.get(taskKey)
      if (existing?.cancel) existing.cancel()
      const task = pageObj.render({ canvasContext: context, viewport })
      renderTasksRef.current.set(taskKey, task)
      await task.promise
      if (renderTasksRef.current.get(taskKey) === task) {
        renderTasksRef.current.delete(taskKey)
      }

      setPageHeights((prev) => (prev[pageNum] === cssHeight ? prev : { ...prev, [pageNum]: cssHeight }))
      setEstimatedPageHeight((prev) => Math.max(320, Math.round((prev * 0.85) + (cssHeight * 0.15))))

      if (typeof window !== 'undefined' && typeof window.createImageBitmap === 'function') {
        try {
          const bitmap = await window.createImageBitmap(canvas)
          upsertBitmapCacheEntry(cacheRef, pageNum, {
            bitmap,
            width: canvas.width,
            height: canvas.height,
            cssWidth,
            cssHeight,
            signature,
          }, cacheLimit)

          if (cacheTier === 'warm' && cacheIdentityRef.current) {
            try {
              const diskKey = buildDiskRenderCacheKey(cacheIdentityRef.current, cacheTier, pageNum)
              const blob = await new Promise<Blob | null>((resolve) => {
                canvas.toBlob(resolve, 'image/webp', 0.72)
              })
              if (blob) {
                await writeDiskRenderBlob(diskKey, blob)
              }
            } catch {
              // ignore disk persistence failures
            }
          }
        } catch {
          // ignore bitmap cache failures
        }
      }
    } catch (err: any) {
      const message = String(err?.message || '')
      const name = String(err?.name || '')
      if (/cancel/i.test(message) || /rendering cancelled/i.test(message) || /RenderingCancelledException/i.test(name)) {
        return
      }
      setError(err?.message || 'Failed to render PDF page')
    }
  }, [pdfDoc, open, contentSize.width, clearBitmapCache, touchBitmapCacheEntry, upsertBitmapCacheEntry, readDiskRenderBlob, writeDiskRenderBlob])

  useEffect(() => {
    if (!open) return
    const el = scrollContainerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const nextWidth = Math.round(entry.contentRect.width)
      const nextHeight = Math.round(entry.contentRect.height)
      setContentSize((prev) =>
        (prev.width === nextWidth && prev.height === nextHeight)
          ? prev
          : { width: nextWidth, height: nextHeight }
      )
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [open])

  useEffect(() => {
    if (!open) return
    const scrollEl = scrollContainerRef.current
    if (!scrollEl) return

    const onScroll = () => {
      if (pinchActiveRef.current) return
      markUserInteracting()
      startInteractionMotionMonitor()
      if (scrollRafRef.current) return
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null
        updatePageFromScroll()

        const now = Date.now()
        const top = scrollEl.scrollTop
        const momentum = scrollMomentumRef.current
        const dt = Math.max(1, now - (momentum.lastTs || now))
        const dy = top - (momentum.lastTop || top)
        const velocityPxPerSec = Math.abs((dy / dt) * 1000)

        if (velocityPxPerSec >= FAST_SCROLL_VELOCITY_PX_PER_SEC) {
          const overlap = now - momentum.lastFastTs <= FAST_SCROLL_OVERLAP_MS
          momentum.burstCount = overlap ? Math.min(3, momentum.burstCount + 1) : 1
          momentum.lastFastTs = now
          momentum.active = true

          const skip = Math.min(MAX_SKIP_RADIUS, momentum.burstCount * SKIP_RADIUS_STEP)
          const maxTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight)
          const predictedStopTop = clamp(top + (dy * 6), 0, maxTop)
          const predictedPage = estimatePageFromScrollTop(predictedStopTop)
          setSkipRadius((prev) => (prev === skip ? prev : skip))
          setPriorityFocusPage((prev) => (prev === predictedPage ? prev : predictedPage))
        } else if (momentum.active && velocityPxPerSec <= FAST_SCROLL_RESET_VELOCITY_PX_PER_SEC) {
          momentum.active = false
          momentum.burstCount = 0
          setSkipRadius((prev) => (prev === 0 ? prev : 0))
          setPriorityFocusPage((prev) => (prev === null ? prev : null))
        }

        momentum.lastTop = top
        momentum.lastTs = now
      })
    }

    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    onScroll()

    return () => {
      scrollEl.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (scrollRafRef.current) {
        window.cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = null
      }
    }
  }, [open, updatePageFromScroll, markUserInteracting, startInteractionMotionMonitor, estimatePageFromScrollTop])

  useEffect(() => {
    if (!open || !pdfDoc) return
    if (initialWarmComplete) return
    let cancelled = false

    ;(async () => {
      const warmUntil = Math.min(totalPages, INITIAL_WARM_PAGE_COUNT)
      for (let pageNum = 1; pageNum <= warmUntil; pageNum += 1) {
        if (cancelled) return
        if (hasAnyBitmapCacheEntry(pageNum)) continue
        const scratchCanvas = document.createElement('canvas')
        await renderPageToCanvas(pageNum, scratchCanvas, { qualityScale: WARM_RENDER_QUALITY_SCALE, cacheTier: 'warm' })
      }
      if (!cancelled) {
        setInitialWarmComplete(true)
        if (totalPages <= INITIAL_WARM_PAGE_COUNT) {
          warmAllCompleteRef.current = true
          const cacheIdentity = cacheIdentityRef.current
          if (cacheIdentity) {
            warmCompletedIdentitySetRef.current.add(cacheIdentity)
            void persistDiskWarmCompleteMarker(cacheIdentity)
          }
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [initialWarmComplete, open, pdfDoc, renderPageToCanvas, totalPages, hasAnyBitmapCacheEntry])

  useEffect(() => {
    if (!open || !pdfDoc || !initialWarmComplete) return
    let cancelled = false
    ;(async () => {
      for (const pageNum of mountedPages) {
        if (cancelled) break
        const canvas = pageCanvasRefs.current.get(pageNum)
        if (!canvas) continue
        await renderPageToCanvas(pageNum, canvas)
      }
    })()
    return () => {
      cancelled = true
      cancelRenderTasks()
    }
  }, [mountedPages, renderPageToCanvas, cancelRenderTasks, open, pdfDoc, initialWarmComplete])

  useEffect(() => {
    if (!open || !pdfDoc || !initialWarmComplete) return
    if (restoredScrollRef.current) return
    const scrollEl = scrollContainerRef.current
    if (!scrollEl) return
    const restore = window.requestAnimationFrame(() => {
      if (typeof initialState?.scrollTop === 'number') {
        scrollEl.scrollTop = initialState.scrollTop
      } else if (typeof initialState?.page === 'number') {
        scrollToPage(initialState.page)
      }
      restoredScrollRef.current = true
    })
    return () => window.cancelAnimationFrame(restore)
  }, [initialState, open, pdfDoc, scrollToPage, initialWarmComplete])

  useEffect(() => {
    if (!open || !pdfDoc || !initialWarmComplete) return
    if (warmAllCompleteRef.current) return
    const startPage = Math.min(totalPages + 1, INITIAL_WARM_PAGE_COUNT + 1)
    const phase2EndPage = totalPages
    if (startPage > phase2EndPage) {
      warmAllCompleteRef.current = true
      setWarmPhase2Progress({ visible: false, done: 0, total: 0 })
      return
    }
    const totalWarmTargets = phase2EndPage - startPage + 1
    const showPhase2Progress = totalWarmTargets >= PHASE2_PROGRESS_THRESHOLD
    if (phase2NextPageRef.current < startPage || phase2NextPageRef.current > phase2EndPage + 1) {
      phase2NextPageRef.current = startPage
    }
    phase2CompletedCountRef.current = Math.max(0, Math.min(totalWarmTargets, phase2NextPageRef.current - startPage))
    setWarmPhase2Progress({
      visible: showPhase2Progress,
      done: Math.min(totalWarmTargets, phase2CompletedCountRef.current),
      total: totalWarmTargets,
    })

    if (isInteractingRef.current || pinchActiveRef.current) {
      return
    }

    let cancelled = false

    const hasRequestIdleCallback = typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function'

    const scheduleNext = () => {
      if (cancelled) return
      cancelPhase2Schedule()
      if (phase2NextPageRef.current > phase2EndPage) {
        warmAllCompleteRef.current = true
        const cacheIdentity = cacheIdentityRef.current
        if (cacheIdentity) {
          warmCompletedIdentitySetRef.current.add(cacheIdentity)
          void persistDiskWarmCompleteMarker(cacheIdentity)
        }
        setWarmPhase2Progress((prev) => ({ ...prev, visible: false, done: prev.total || phase2CompletedCountRef.current }))
        return
      }
      if (hasRequestIdleCallback) {
        phase2IdleHandleRef.current = (window as any).requestIdleCallback(runWarm, { timeout: 180 })
      } else {
        phase2TimeoutHandleRef.current = window.setTimeout(() => runWarm(), PHASE2_WARM_FALLBACK_DELAY_MS)
      }
    }

    const runWarm = async () => {
      if (cancelled) return
      if (isInteractingRef.current || pinchActiveRef.current) {
        return
      }
      let processedThisTick = 0
      while (phase2NextPageRef.current <= phase2EndPage && processedThisTick < PHASE2_WARM_BATCH_SIZE) {
        const nextPage = phase2NextPageRef.current
        phase2NextPageRef.current += 1
        processedThisTick += 1
        if (hasAnyBitmapCacheEntry(nextPage)) continue
        if (pageCanvasRefs.current.has(nextPage)) continue
        const scratchCanvas = document.createElement('canvas')
        await renderPageToCanvas(nextPage, scratchCanvas, { qualityScale: WARM_RENDER_QUALITY_SCALE, cacheTier: 'warm' })
        if (cancelled || isInteractingRef.current || pinchActiveRef.current) {
          break
        }
      }
      phase2CompletedCountRef.current += processedThisTick
      setWarmPhase2Progress((prev) => ({
        ...prev,
        done: Math.min(prev.total || phase2CompletedCountRef.current, phase2CompletedCountRef.current),
      }))
      scheduleNext()
    }

    scheduleNext()
    return () => {
      cancelled = true
      cancelPhase2Schedule()
    }
  }, [
    open,
    pdfDoc,
    renderPageToCanvas,
    totalPages,
    initialWarmComplete,
    hasAnyBitmapCacheEntry,
    cancelPhase2Schedule,
    phase2ResumeSignal,
    persistDiskWarmCompleteMarker,
  ])

  if (!open) return null

  const chromeClassName = chromeVisible
    ? 'opacity-100 pointer-events-auto'
    : 'opacity-0 pointer-events-none'
  const warmPhase2Percent = warmPhase2Progress.total > 0
    ? Math.min(100, Math.max(0, (warmPhase2Progress.done / warmPhase2Progress.total) * 100))
    : 0

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      onPointerMove={kickChromeAutoHide}
      onPointerDown={() => {
        markUserInteracting()
        kickChromeAutoHide()
      }}
      onTouchStart={() => {
        markUserInteracting()
        kickChromeAutoHide()
      }}
      onWheel={() => {
        markUserInteracting()
        startInteractionMotionMonitor()
        kickChromeAutoHide()
      }}
    >
      <div className="absolute inset-0 philani-overlay-backdrop philani-overlay-backdrop-enter" onClick={onClose} />

      <div className="absolute inset-0" onClick={onClose}>
        <div
          className="relative h-full w-full overflow-hidden border border-white/10 bg-white/10 backdrop-blur-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className={`absolute left-3 right-3 top-3 sm:left-4 sm:right-4 sm:top-4 z-20 flex items-center justify-center transition-opacity duration-200 ${chromeClassName} pointer-events-none`}
            aria-hidden={!chromeVisible}
            style={{
              top: 'calc(max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px)) + 12px)',
              left: 'calc(max(var(--app-safe-left, 0px), env(safe-area-inset-left, 0px)) + 12px)',
              right: 'calc(max(var(--app-safe-right, 0px), env(safe-area-inset-right, 0px)) + 12px)',
            }}
          >
            <div className="max-w-[82vw] text-center">
              <div className="text-sm sm:text-base font-semibold text-slate-900 truncate drop-shadow-sm">{title}</div>
              {subtitle ? <div className="text-[11px] sm:text-xs text-slate-600 truncate drop-shadow-sm">{subtitle}</div> : null}
            </div>
          </div>

          <div
            className={`absolute left-2 right-2 bottom-2 sm:left-4 sm:right-4 sm:bottom-4 z-20 flex items-center justify-center gap-2 text-[10px] sm:text-xs text-slate-900 transition-opacity duration-200 ${chromeClassName}`}
            aria-hidden={!chromeVisible}
            style={{
              bottom: 'calc(max(var(--app-safe-bottom, 0px), env(safe-area-inset-bottom, 0px)) + 8px)',
              left: 'calc(max(var(--app-safe-left, 0px), env(safe-area-inset-left, 0px)) + 8px)',
              right: 'calc(max(var(--app-safe-right, 0px), env(safe-area-inset-right, 0px)) + 8px)',
            }}
          >
            <div className="flex items-center justify-center gap-1 sm:gap-2 flex-nowrap">
              <div className="flex items-center gap-1 sm:gap-2 rounded-full border border-slate-200/70 bg-white/90 px-1.5 py-1 sm:px-2 shadow-sm">
                <button
                  type="button"
                  className="px-1.5 py-1 rounded-full hover:bg-slate-100"
                  onClick={() => {
                    kickChromeAutoHide()
                    setPage((p) => {
                      const next = Math.max(1, p - 1)
                      scrollToPage(next)
                      return next
                    })
                  }}
                  disabled={isViewerLoading}
                >
                  <span className="hidden sm:inline">Prev</span>
                  <span className="sm:hidden" aria-hidden="true">◀</span>
                </button>
                <input
                  type="number"
                  className="w-10 sm:w-16 bg-transparent text-center text-[10px] sm:text-xs text-slate-900 outline-none"
                  min={1}
                  max={totalPages}
                  value={safePage}
                  onChange={(e) => {
                    kickChromeAutoHide()
                    const next = clamp(Number(e.target.value || 1), 1, totalPages)
                    setPage(next)
                    scrollToPage(next)
                  }}
                  disabled={isViewerLoading}
                />
                <span className="text-[10px] text-slate-500">/ {totalPages}</span>
                <button
                  type="button"
                  className="px-1.5 py-1 rounded-full hover:bg-slate-100"
                  onClick={() => {
                    kickChromeAutoHide()
                    setPage((p) => {
                      const next = Math.min(totalPages, p + 1)
                      scrollToPage(next)
                      return next
                    })
                  }}
                  disabled={isViewerLoading}
                >
                  <span className="hidden sm:inline">Next</span>
                  <span className="sm:hidden" aria-hidden="true">▶</span>
                </button>
              </div>

              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="px-2 py-1 rounded-full border border-slate-200/70 bg-white/90 hover:bg-white shadow-sm"
                onClick={kickChromeAutoHide}
                aria-label="Open"
              >
                <span className="hidden sm:inline">Open</span>
                <svg viewBox="0 0 20 20" fill="none" className="w-3.5 h-3.5 sm:hidden" aria-hidden="true">
                  <path d="M7 7h6v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M7 13l6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M4 4h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </a>
              <a
                href={url}
                download
                className="px-2 py-1 rounded-full border border-slate-200/70 bg-white/90 hover:bg-white shadow-sm"
                onClick={kickChromeAutoHide}
                aria-label="Download"
              >
                <span className="hidden sm:inline">Download</span>
                <svg viewBox="0 0 20 20" fill="none" className="w-3.5 h-3.5 sm:hidden" aria-hidden="true">
                  <path d="M10 3v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M7 8l3 3 3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M4 14h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </a>
              <button
                type="button"
                className="w-8 h-8 sm:w-9 sm:h-9 inline-flex items-center justify-center rounded-full border border-slate-200/70 bg-white/90 hover:bg-white text-slate-900 shadow-sm"
                onClick={onClose}
                aria-label="Close"
                title="Close"
              >
                <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
                  <path
                    d="M6 6l8 8M14 6l-8 8"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          </div>

          {onPostImage ? (
            <div
              className={`absolute right-3 z-20 transition-opacity duration-200 ${chromeClassName}`}
              style={{ bottom: '33%' }}
              aria-hidden={!chromeVisible}
            >
              <button
                type="button"
                className="flex items-center gap-2 rounded-full border border-slate-200/60 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-900 shadow-sm hover:bg-white disabled:opacity-50"
                onClick={handlePostCapture}
                disabled={isViewerLoading || postBusy || Boolean(error)}
                aria-label={postBusy ? 'Capturing PDF view' : 'Post PDF view'}
                title={postBusy ? 'Capturing…' : 'Post'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M4 7a2 2 0 0 1 2-2h2l1-1h6l1 1h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="2" />
                </svg>
                <span>{postBusy ? 'Capturing…' : 'Post'}</span>
              </button>
            </div>
          ) : null}

          <div
            ref={scrollContainerRef}
            className="absolute inset-0 z-0 overflow-auto"
            style={{ touchAction: 'pan-x pan-y', WebkitOverflowScrolling: 'touch' }}
            onWheel={(e) => {
              markUserInteracting()
              startInteractionMotionMonitor()
              const absX = Math.abs(e.deltaX)
              const absY = Math.abs(e.deltaY)
              if (absX < 30 || absX < absY * 1.2) return

              const isBaseZoom = zoomRef.current <= renderZoomRef.current + 0.5
              if (!isBaseZoom) return

              const now = Date.now()
              if (now - lastWheelTsRef.current < 250) return
              lastWheelTsRef.current = now
              kickChromeAutoHide()
              if (e.deltaX > 0) {
                setPage((p) => {
                  const next = Math.min(totalPages, p + 1)
                  scrollToPage(next)
                  return next
                })
              } else {
                setPage((p) => {
                  const next = Math.max(1, p - 1)
                  scrollToPage(next)
                  return next
                })
              }
            }}
            onPointerDown={(e) => {
              markUserInteracting()
              startInteractionMotionMonitor()
              const momentum = scrollMomentumRef.current
              if (momentum.active) {
                momentum.active = false
                momentum.burstCount = 0
                const target = e.target as HTMLElement | null
                const pageHost = target?.closest?.('[data-page]') as HTMLElement | null
                const pinnedPage = clamp(Number(pageHost?.dataset?.page || safePage), 1, totalPages)
                setPage(pinnedPage)
                setPriorityFocusPage(pinnedPage)
                setSkipRadius(0)
              }
              handleSwipeStart(e)
            }}
            onPointerMove={handleSwipeMove}
            onPointerUp={(e) => {
              handleSwipeEnd(e)
              startInteractionMotionMonitor()
            }}
            onPointerCancel={(e) => {
              handleSwipeEnd(e)
              startInteractionMotionMonitor()
            }}
            onPointerLeave={(e) => {
              handleSwipeEnd(e)
              startInteractionMotionMonitor()
            }}
          >
            {isViewerLoading && !error ? (
              <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
                <div
                  className="h-10 w-10 rounded-full border-4 border-slate-300 border-t-slate-700 animate-spin"
                  aria-label="Loading"
                />
              </div>
            ) : null}

            {warmPhase2Progress.visible && !isViewerLoading && !error ? (
              <div
                className="fixed left-3 right-3 z-20 pointer-events-none"
                style={{ bottom: 'calc(max(var(--app-safe-bottom, 0px), env(safe-area-inset-bottom, 0px)) + 2px)' }}
                aria-hidden="true"
              >
                <div className="h-1.5 rounded-full bg-blue-300/25 overflow-hidden">
                  <div
                    className="h-full bg-blue-500/65 transition-[width] duration-200 ease-out"
                    style={{ width: `${warmPhase2Percent}%` }}
                  />
                </div>
              </div>
            ) : null}

            <div
              ref={contentRef}
              className={`${isZoomedForPan ? 'w-max min-w-full items-center px-0 sm:px-0' : 'w-full items-center px-4 sm:px-6'} flex flex-col gap-6 py-4 sm:py-6`}
              style={{
                zoom: liveScale,
                paddingTop: 'calc(max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px)) + 14px)',
                willChange: pinchStateRef.current.active ? 'transform' : undefined,
              }}
            >
              {error ? (
                <div className="text-sm text-red-200 px-4">{error}</div>
              ) : isViewerLoading ? (
                <div className="sr-only">Preparing PDF</div>
              ) : (
                Array.from({ length: totalPages }, (_, idx) => {
                  const pageNum = idx + 1
                  const isMounted = mountedPageSet.has(pageNum)
                  const minHeight = Math.max(320, Math.round(pageHeights[pageNum] ?? estimatedPageHeight))
                  return (
                    <div
                      key={`pdf-page-wrap-${pageNum}`}
                      ref={setPageContainerRef(pageNum)}
                      data-page={pageNum}
                      className="w-full flex items-start justify-center"
                      style={{ minHeight: `${minHeight}px` }}
                    >
                      {isMounted ? (
                        <canvas
                          ref={setPageCanvasRef(pageNum)}
                          className="block bg-white shadow-sm"
                          data-page-canvas={pageNum}
                        />
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

(PdfViewerOverlay as any).displayName = 'PdfViewerOverlay'
