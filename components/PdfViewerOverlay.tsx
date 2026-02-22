import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTapToPeek } from '../lib/useTapToPeek'

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

type PdfViewerOverlayProps = {
  open: boolean
  url: string
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

export default function PdfViewerOverlay({ open, url, title, subtitle, initialState, onClose, onPostImage }: PdfViewerOverlayProps) {
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(110)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [pdfDoc, setPdfDoc] = useState<any | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const pageCanvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map())
  const renderTasksRef = useRef<Map<number, any>>(new Map())
  const renderedSignatureRef = useRef<Map<number, string>>(new Map())
  const pageAspectRatiosRef = useRef<Map<number, number>>(new Map())
  const defaultPageAspectRef = useRef(1.4142)
  const scrollRafRef = useRef<number | null>(null)
  const renderRafRef = useRef<number | null>(null)
  const renderPumpRunningRef = useRef(false)
  const renderPumpPendingRef = useRef(false)
  const initialRenderedPagesRef = useRef(0)
  const lastScrollTopRef = useRef(0)
  const scrollDirectionRef = useRef<1 | -1>(1)
  const lastWheelTsRef = useRef(0)
  const { visible: chromeVisible, peek: kickChromeAutoHide, clearTimer: clearChromeTimer } = useTapToPeek({
    autoHideMs: 2500,
    defaultVisible: true,
    disabled: !open,
  })
  const [postBusy, setPostBusy] = useState(false)
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 })
  const [initialRenderReady, setInitialRenderReady] = useState(false)
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
    startScale: number
    startContentUx: number
    startContentUy: number
    lastDist: number
    lastCenterX: number
    lastCenterY: number
    pendingZoom: number | null
  }>({
    active: false,
    startDist: 0,
    startZoom: 110,
    startScale: 1.1,
    startContentUx: 0,
    startContentUy: 0,
    lastDist: 0,
    lastCenterX: 0,
    lastCenterY: 0,
    pendingZoom: null,
  })
  const liveZoomRef = useRef(110)
  const pinchPreviewScaleRef = useRef(1)
  const pinchPreviewOriginRef = useRef({ x: 0, y: 0 })
  const pinchPreviewRafRef = useRef<number | null>(null)
  const pinchCommitAnchorRef = useRef<{
    active: boolean
    toZoom: number
    relX: number
    relY: number
    contentUx: number
    contentUy: number
  }>({ active: false, toZoom: 110, relX: 0, relY: 0, contentUx: 0, contentUy: 0 })
  const recentPinchTsRef = useRef(0)
  const isMobile = useMemo(() => {
    if (typeof navigator === 'undefined') return false
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  }, [])
  const isAndroid = useMemo(() => {
    if (typeof navigator === 'undefined') return false
    return /Android/i.test(navigator.userAgent)
  }, [])
  const isCapacitor = useMemo(() => {
    if (typeof window === 'undefined') return false
    return Boolean((window as any).Capacitor)
  }, [])
  const isCapacitorAndroidWebView = useMemo(() => isCapacitor && isAndroid, [isCapacitor, isAndroid])
  const forceWorkerOnCapacitorAndroid = useMemo(() => isCapacitor && isAndroid, [isCapacitor, isAndroid])
  const canUseWorker = useMemo(() => {
    if (typeof window === 'undefined') return false
    return typeof (window as any).Worker !== 'undefined' && (!isMobile || forceWorkerOnCapacitorAndroid)
  }, [isMobile, forceWorkerOnCapacitorAndroid])

  const effectiveZoom = clamp(zoom, 50, 220)
  const renderOutputScale = useMemo(() => {
    if (typeof window === 'undefined') return 1
    const dpr = window.devicePixelRatio || 1
    return Math.min(dpr, 2)
  }, [])
  const prefetchDistance = useMemo(() => (isCapacitorAndroidWebView ? 4 : 6), [isCapacitorAndroidWebView])
  const bitmapKeepDistance = useMemo(() => (isCapacitorAndroidWebView ? 2 : 4), [isCapacitorAndroidWebView])
  const maxRendersPerPass = useMemo(() => (isCapacitorAndroidWebView ? 1 : 2), [isCapacitorAndroidWebView])
  useEffect(() => {
    liveZoomRef.current = effectiveZoom
  }, [effectiveZoom])
  const effectivePage = Math.max(1, page)

  const totalPages = Math.max(1, numPages || 1)
  const safePage = clamp(effectivePage, 1, totalPages)

  const setPageCanvasRef = useCallback((pageNum: number) => (el: HTMLCanvasElement | null) => {
    if (el) {
      pageCanvasRefs.current.set(pageNum, el)
    } else {
      pageCanvasRefs.current.delete(pageNum)
    }
  }, [])

  const cancelRenderTasks = useCallback(() => {
    renderTasksRef.current.forEach((task) => {
      if (task?.cancel) task.cancel()
    })
    renderTasksRef.current.clear()
  }, [])

  const applyPlaceholderCanvasSize = useCallback((canvas: HTMLCanvasElement, pageNum: number) => {
    const availableWidth = contentSize.width || contentRef.current?.clientWidth || 0
    if (!availableWidth) return
    const baseScale = effectiveZoom / 100
    const aspect = pageAspectRatiosRef.current.get(pageNum) || defaultPageAspectRef.current || 1.4142
    const nextWidth = Math.max(1, Math.floor(availableWidth * baseScale))
    const nextHeight = Math.max(1, Math.floor(nextWidth * aspect))
    canvas.style.width = `${nextWidth}px`
    canvas.style.height = `${nextHeight}px`
    canvas.style.minHeight = `${nextHeight}px`
  }, [contentSize.width, effectiveZoom])

  const scrollToPage = useCallback((pageNum: number) => {
    const canvas = pageCanvasRefs.current.get(pageNum)
    if (!canvas) return
    canvas.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const updatePageFromScroll = useCallback(() => {
    const scrollEl = scrollContainerRef.current
    if (!scrollEl) return
    const viewportCenter = scrollEl.scrollTop + scrollEl.clientHeight / 2
    let bestPage = safePage
    let bestDist = Number.POSITIVE_INFINITY

    pageCanvasRefs.current.forEach((canvas, pageNum) => {
      const center = canvas.offsetTop + canvas.offsetHeight / 2
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
    if (!onPostImage || loading || error || postBusy) return
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
  }, [captureVisibleCanvas, error, kickChromeAutoHide, loading, onPostImage, postBusy, safePage, effectiveZoom])

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

  const applyPinchPreviewScale = useCallback((scale: number, originX?: number, originY?: number) => {
    pinchPreviewScaleRef.current = scale
    if (typeof originX === 'number' && Number.isFinite(originX) && typeof originY === 'number' && Number.isFinite(originY)) {
      pinchPreviewOriginRef.current = { x: originX, y: originY }
    }
    if (typeof window === 'undefined') return
    if (pinchPreviewRafRef.current) return
    pinchPreviewRafRef.current = window.requestAnimationFrame(() => {
      pinchPreviewRafRef.current = null
      const content = contentRef.current
      if (!content) return
      const nextScale = pinchPreviewScaleRef.current
      if (Math.abs(nextScale - 1) < 0.001) {
        content.style.transform = ''
        content.style.transformOrigin = ''
        content.style.willChange = ''
        return
      }
      const origin = pinchPreviewOriginRef.current
      content.style.transform = `scale(${nextScale})`
      content.style.transformOrigin = `${origin.x}px ${origin.y}px`
      content.style.willChange = 'transform'
    })
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

    const getTouchCenterX = (touches: TouchList) => {
      const a = touches[0]
      const b = touches[1]
      if (!a || !b) return 0
      return (a.clientX + b.clientX) / 2
    }

    const getTouchCenterY = (touches: TouchList) => {
      const a = touches[0]
      const b = touches[1]
      if (!a || !b) return 0
      return (a.clientY + b.clientY) / 2
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const startDist = getPinchDistance(e.touches)
        const centerX = getTouchCenterX(e.touches)
        const centerY = getTouchCenterY(e.touches)
        const containerRect = el.getBoundingClientRect()
        const relX = clamp(centerX - containerRect.left, 0, containerRect.width)
        const relY = clamp(centerY - containerRect.top, 0, containerRect.height)
        const startScale = Math.max(0.01, effectiveZoom / 100)
        pinchStateRef.current.active = true
        pinchStateRef.current.startDist = startDist
        pinchStateRef.current.startZoom = effectiveZoom
        pinchStateRef.current.startScale = startScale
        pinchStateRef.current.startContentUx = (el.scrollLeft + relX) / startScale
        pinchStateRef.current.startContentUy = (el.scrollTop + relY) / startScale
        pinchStateRef.current.lastDist = startDist
        pinchStateRef.current.lastCenterX = centerX
        pinchStateRef.current.lastCenterY = centerY
        pinchStateRef.current.pendingZoom = null
        applyPinchPreviewScale(1, el.scrollLeft + relX, el.scrollTop + relY)
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
      if (pinchStateRef.current.active && e.touches.length === 2) {
        e.preventDefault()
        const dist = getPinchDistance(e.touches)
        const centerX = getTouchCenterX(e.touches)
        const centerY = getTouchCenterY(e.touches)
        if (!dist || !pinchStateRef.current.startDist) return
        const centerDeltaX = centerX - pinchStateRef.current.lastCenterX
        const centerDeltaY = centerY - pinchStateRef.current.lastCenterY

        const scale = dist / pinchStateRef.current.startDist
        const nextZoom = clamp(pinchStateRef.current.startZoom * scale, 50, 220)
        pinchStateRef.current.pendingZoom = nextZoom
        const previewScale = clamp(nextZoom / Math.max(1, pinchStateRef.current.startZoom), 0.5, 3)
        const containerRect = el.getBoundingClientRect()
        const relX = clamp(centerX - containerRect.left, 0, containerRect.width)
        const relY = clamp(centerY - containerRect.top, 0, containerRect.height)
        applyPinchPreviewScale(previewScale, el.scrollLeft + relX, el.scrollTop + relY)

        if (Math.abs(centerDeltaX) > 0.25) {
          el.scrollLeft -= centerDeltaX
        }
        if (Math.abs(centerDeltaY) > 0.25) {
          el.scrollTop -= centerDeltaY
        }

        pinchStateRef.current.lastDist = dist
        pinchStateRef.current.lastCenterX = centerX
        pinchStateRef.current.lastCenterY = centerY
        kickChromeAutoHide()
        return
      }
      if (!touchState.active || e.touches.length !== 1) return
      const t = e.touches[0]
      touchState.lastX = t.clientX
      touchState.lastY = t.clientY
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const startDist = getPinchDistance(e.touches)
        const centerX = getTouchCenterX(e.touches)
        const centerY = getTouchCenterY(e.touches)
        const containerRect = el.getBoundingClientRect()
        const relX = clamp(centerX - containerRect.left, 0, containerRect.width)
        const relY = clamp(centerY - containerRect.top, 0, containerRect.height)
        const startScale = Math.max(0.01, effectiveZoom / 100)
        pinchStateRef.current.active = true
        pinchStateRef.current.startDist = startDist
        pinchStateRef.current.startZoom = effectiveZoom
        pinchStateRef.current.startScale = startScale
        pinchStateRef.current.startContentUx = (el.scrollLeft + relX) / startScale
        pinchStateRef.current.startContentUy = (el.scrollTop + relY) / startScale
        pinchStateRef.current.lastDist = startDist
        pinchStateRef.current.lastCenterX = centerX
        pinchStateRef.current.lastCenterY = centerY
        pinchStateRef.current.pendingZoom = null
        touchState.active = false
        return
      }
      if (pinchStateRef.current.active) {
        const pendingZoom = pinchStateRef.current.pendingZoom
        const centerX = pinchStateRef.current.lastCenterX
        const centerY = pinchStateRef.current.lastCenterY
        const containerRect = el.getBoundingClientRect()
        const relX = clamp(centerX - containerRect.left, 0, containerRect.width)
        const relY = clamp(centerY - containerRect.top, 0, containerRect.height)
        const previewCommittedZoom = clamp(
          pinchStateRef.current.startZoom * pinchPreviewScaleRef.current,
          50,
          220
        )
        const targetZoom = typeof pendingZoom === 'number' ? pendingZoom : previewCommittedZoom
        applyPinchPreviewScale(1)
        if (Math.abs(targetZoom - liveZoomRef.current) > 0.01) {
          const committedZoom = clamp(targetZoom, 50, 220)
          pinchCommitAnchorRef.current = {
            active: true,
            toZoom: committedZoom,
            relX,
            relY,
            contentUx: pinchStateRef.current.startContentUx,
            contentUy: pinchStateRef.current.startContentUy,
          }
          setZoom(committedZoom)
          liveZoomRef.current = committedZoom
        }
        recentPinchTsRef.current = Date.now()
        pinchStateRef.current.active = false
        pinchStateRef.current.startDist = 0
        pinchStateRef.current.lastDist = 0
        pinchStateRef.current.pendingZoom = null
        return
      }
      if (!touchState.active) return
      if (Date.now() - recentPinchTsRef.current < 300) {
        touchState.active = false
        return
      }
      touchState.active = false
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
      applyPinchPreviewScale(1)
      if (typeof window !== 'undefined' && pinchPreviewRafRef.current) {
        window.cancelAnimationFrame(pinchPreviewRafRef.current)
        pinchPreviewRafRef.current = null
      }
    }
  }, [applyPinchPreviewScale, effectiveZoom, kickChromeAutoHide, open, scrollToPage, totalPages])

  useLayoutEffect(() => {
    if (!open) return
    const anchor = pinchCommitAnchorRef.current
    if (!anchor.active) return
    const scrollEl = scrollContainerRef.current
    if (!scrollEl) {
      pinchCommitAnchorRef.current.active = false
      return
    }
    const toScale = Math.max(0.01, anchor.toZoom / 100)

    const applyAnchoredScroll = () => {
      const maxLeft = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth)
      const maxTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight)
      const nextLeft = anchor.contentUx * toScale - anchor.relX
      const nextTop = anchor.contentUy * toScale - anchor.relY
      scrollEl.scrollLeft = clamp(nextLeft, 0, maxLeft)
      scrollEl.scrollTop = clamp(nextTop, 0, maxTop)
      pinchCommitAnchorRef.current.active = false
    }

    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(applyAnchoredScroll)
      })
    } else {
      applyAnchoredScroll()
    }
  }, [open, effectiveZoom, contentSize.width])

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

    setLoading(true)
    setError(null)
    setPdfDoc(null)
    setNumPages(0)
    setPage(initialState?.page ?? 1)
    setZoom(initialState?.zoom ?? 110)
    setInitialRenderReady(false)
    initialRenderedPagesRef.current = 0
    renderedSignatureRef.current.clear()
    pageAspectRatiosRef.current.clear()
    defaultPageAspectRef.current = 1.4142
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

        try {
          const firstPage = await doc.getPage(1)
          const firstViewport = firstPage.getViewport({ scale: 1 })
          if (firstViewport?.width && firstViewport?.height) {
            defaultPageAspectRef.current = clamp(firstViewport.height / firstViewport.width, 0.5, 3)
            pageAspectRatiosRef.current.set(1, defaultPageAspectRef.current)
          }
        } catch {
          // ignore ratio bootstrap errors
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
  }, [open, url, initialState?.page, initialState?.zoom, canUseWorker])

  useEffect(() => {
    if (open) return
    cancelRenderTasks()
    setInitialRenderReady(false)
    initialRenderedPagesRef.current = 0
    renderedSignatureRef.current.clear()
    pageAspectRatiosRef.current.clear()
    defaultPageAspectRef.current = 1.4142
    if (pdfDoc?.destroy) {
      pdfDoc.destroy()
    }
    setPdfDoc(null)
  }, [open, pdfDoc, cancelRenderTasks])

  const renderPageToCanvas = useCallback(async (pageNum: number, canvas: HTMLCanvasElement) => {
    if (!pdfDoc || !open) return
    const context = canvas.getContext('2d')
    if (!context) return

    const renderSignature = `${effectiveZoom}:${contentSize.width || 0}`
    const lastSignature = renderedSignatureRef.current.get(pageNum)
    if (lastSignature === renderSignature && canvas.width > 0 && canvas.height > 0) {
      return
    }

    try {
      const pageObj = await pdfDoc.getPage(pageNum)
      const baseScale = effectiveZoom / 100
      const naturalViewport = pageObj.getViewport({ scale: 1 })
      if (naturalViewport?.width && naturalViewport?.height) {
        const ratio = clamp(naturalViewport.height / naturalViewport.width, 0.5, 3)
        pageAspectRatiosRef.current.set(pageNum, ratio)
        if (!defaultPageAspectRef.current || !Number.isFinite(defaultPageAspectRef.current)) {
          defaultPageAspectRef.current = ratio
        }
      }
      const availableWidth = contentSize.width || contentRef.current?.clientWidth || 0
      const fitScale = availableWidth
        ? clamp(availableWidth / naturalViewport.width, 0.5, 2)
        : 1
      const finalScale = baseScale * fitScale
      const viewport = pageObj.getViewport({ scale: finalScale })
      const outputScale = renderOutputScale
      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      canvas.style.minHeight = `${Math.floor(viewport.height)}px`
      context.setTransform(outputScale, 0, 0, outputScale, 0, 0)

      const existing = renderTasksRef.current.get(pageNum)
      if (existing?.cancel) existing.cancel()
      const task = pageObj.render({ canvasContext: context, viewport })
      renderTasksRef.current.set(pageNum, task)
      await task.promise
      renderedSignatureRef.current.set(pageNum, renderSignature)

      if (!initialRenderReady) {
        initialRenderedPagesRef.current += 1
        if (pageNum === safePage || initialRenderedPagesRef.current >= 2) {
          setInitialRenderReady(true)
        }
      }
    } catch (err: any) {
      const message = String(err?.message || '')
      const name = String(err?.name || '')
      if (name === 'RenderingCancelledException' || /rendering cancelled|canceled|cancelled/i.test(message)) {
        return
      }
      setError(err?.message || 'Failed to render PDF page')
    }
  }, [pdfDoc, open, effectiveZoom, contentSize.width, initialRenderReady, safePage, renderOutputScale])

  const getCurrentRenderSignature = useCallback(() => `${effectiveZoom}:${contentSize.width || 0}`, [effectiveZoom, contentSize.width])

  const evictFarPageBitmaps = useCallback(() => {
    if (!open) return
    pageCanvasRefs.current.forEach((canvas, pageNum) => {
      if (Math.abs(pageNum - safePage) <= bitmapKeepDistance) return
      if (canvas.width === 0 && canvas.height === 0) return

      const existing = renderTasksRef.current.get(pageNum)
      if (existing?.cancel) {
        try {
          existing.cancel()
        } catch {
          // ignore
        }
      }
      renderTasksRef.current.delete(pageNum)
      renderedSignatureRef.current.delete(pageNum)

      canvas.width = 0
      canvas.height = 0
      applyPlaceholderCanvasSize(canvas, pageNum)
    })
  }, [applyPlaceholderCanvasSize, bitmapKeepDistance, open, safePage])

  const getRenderCandidates = useCallback(() => {
    const candidates: Array<{ pageNum: number; priority: number }> = []
    const seen = new Set<number>()

    const pushCandidate = (pageNum: number, priority: number) => {
      if (pageNum < 1 || pageNum > totalPages) return
      if (seen.has(pageNum)) return
      seen.add(pageNum)
      candidates.push({ pageNum, priority })
    }

    const scrollEl = scrollContainerRef.current
    if (scrollEl) {
      const top = scrollEl.scrollTop
      const bottom = top + scrollEl.clientHeight
      const viewportCenter = top + scrollEl.clientHeight / 2
      const viewportPaddingPx = isCapacitorAndroidWebView ? 120 : 200
      pageCanvasRefs.current.forEach((canvas, pageNum) => {
        const pageTop = canvas.offsetTop
        const pageBottom = pageTop + canvas.offsetHeight
        if (pageBottom >= top - viewportPaddingPx && pageTop <= bottom + viewportPaddingPx) {
          const pageCenter = pageTop + canvas.offsetHeight / 2
          const dist = Math.abs(pageCenter - viewportCenter)
          pushCandidate(pageNum, dist)
        }
      })
    }

    for (let p = Math.max(1, safePage - 3); p <= Math.min(totalPages, safePage + 3); p += 1) {
      pushCandidate(p, 10_000 + Math.abs(p - safePage) * 100)
    }

    const lookAheadStart = scrollDirectionRef.current > 0 ? safePage + 1 : safePage - 1
    const lookAheadEnd = scrollDirectionRef.current > 0 ? safePage + prefetchDistance : safePage - prefetchDistance
    const step = scrollDirectionRef.current > 0 ? 1 : -1
    for (let p = lookAheadStart; step > 0 ? p <= lookAheadEnd : p >= lookAheadEnd; p += step) {
      pushCandidate(p, 20_000 + Math.abs(p - safePage) * 150)
    }

    if (!seen.has(safePage)) {
      pushCandidate(safePage, 0)
    }

    candidates.sort((a, b) => a.priority - b.priority)
    return candidates.map(item => item.pageNum)
  }, [safePage, totalPages, prefetchDistance, isCapacitorAndroidWebView])

  const getNextPageToRender = useCallback(() => {
    const signature = getCurrentRenderSignature()
    const candidates = getRenderCandidates()
    for (const pageNum of candidates) {
      const canvas = pageCanvasRefs.current.get(pageNum)
      if (!canvas) continue
      const lastSignature = renderedSignatureRef.current.get(pageNum)
      if (lastSignature !== signature || canvas.width === 0 || canvas.height === 0) {
        return pageNum
      }
    }
    return null
  }, [getCurrentRenderSignature, getRenderCandidates])

  const runRenderPump = useCallback(async () => {
    if (renderPumpRunningRef.current) return
    if (!open || !pdfDoc) return

    renderPumpRunningRef.current = true
    try {
      let renderedThisPass = 0
      while (renderedThisPass < maxRendersPerPass) {
        const pageNum = getNextPageToRender()
        if (!pageNum) {
          renderPumpPendingRef.current = false
          break
        }

        renderPumpPendingRef.current = false
        const canvas = pageCanvasRefs.current.get(pageNum)
        if (!canvas) break

        await renderPageToCanvas(pageNum, canvas)
        renderedThisPass += 1
      }
    } finally {
      renderPumpRunningRef.current = false
      if (!open || !pdfDoc) return
      if (renderPumpPendingRef.current || getNextPageToRender() !== null) {
        if (typeof window !== 'undefined' && !renderRafRef.current) {
          renderRafRef.current = window.requestAnimationFrame(() => {
            renderRafRef.current = null
            void runRenderPump()
          })
        }
      }
    }
  }, [getNextPageToRender, open, pdfDoc, renderPageToCanvas, maxRendersPerPass])

  const queueVisibleRender = useCallback(() => {
    if (typeof window === 'undefined') return
    renderPumpPendingRef.current = true
    if (renderRafRef.current) return
    renderRafRef.current = window.requestAnimationFrame(() => {
      renderRafRef.current = null
      void runRenderPump()
    })
  }, [runRenderPump])

  useEffect(() => {
    if (!open) return
    const el = contentRef.current
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
    pageCanvasRefs.current.forEach((canvas, pageNum) => {
      applyPlaceholderCanvasSize(canvas, pageNum)
    })
  }, [open, totalPages, effectiveZoom, contentSize.width, applyPlaceholderCanvasSize])

  useEffect(() => {
    if (!open) return
    evictFarPageBitmaps()
  }, [open, safePage, effectiveZoom, evictFarPageBitmaps])

  useEffect(() => {
    if (!open) return
    const scrollEl = scrollContainerRef.current
    if (!scrollEl) return

    const onScroll = () => {
      if (scrollRafRef.current) return
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null
        const nextTop = scrollEl.scrollTop
        if (nextTop > lastScrollTopRef.current) scrollDirectionRef.current = 1
        if (nextTop < lastScrollTopRef.current) scrollDirectionRef.current = -1
        lastScrollTopRef.current = nextTop
        updatePageFromScroll()
        evictFarPageBitmaps()
        queueVisibleRender()
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
      if (renderRafRef.current) {
        window.cancelAnimationFrame(renderRafRef.current)
        renderRafRef.current = null
      }
    }
  }, [open, updatePageFromScroll, queueVisibleRender, evictFarPageBitmaps])

  useEffect(() => {
    queueVisibleRender()
    if (!open) return
    if (!initialState) return
    if (restoredScrollRef.current) return
    const scrollEl = scrollContainerRef.current
    if (!scrollEl) return
    if (typeof initialState.scrollTop === 'number') {
      scrollEl.scrollTop = initialState.scrollTop
      lastScrollTopRef.current = initialState.scrollTop
    } else if (typeof initialState.page === 'number') {
      scrollToPage(initialState.page)
    }
    restoredScrollRef.current = true

    return () => {
      renderPumpPendingRef.current = false
      renderPumpRunningRef.current = false
      cancelRenderTasks()
    }
  }, [queueVisibleRender, cancelRenderTasks, initialState, open, scrollToPage])

  useEffect(() => {
    if (!open) return
    queueVisibleRender()
  }, [open, queueVisibleRender, effectiveZoom, contentSize.width, safePage])

  if (!open) return null

  const chromeClassName = chromeVisible
    ? 'opacity-100 pointer-events-auto'
    : 'opacity-0 pointer-events-none'

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      onPointerMove={kickChromeAutoHide}
      onPointerDown={kickChromeAutoHide}
      onTouchStart={kickChromeAutoHide}
      onWheel={kickChromeAutoHide}
    >
      <div className="absolute inset-0 philani-overlay-backdrop philani-overlay-backdrop-enter" onClick={onClose} />

      <div className="relative z-10 h-[100dvh] w-full" onClick={onClose}>
        <div
          className="relative h-full w-full overflow-hidden border border-white/10 bg-white/10 backdrop-blur-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className={`absolute left-3 right-3 sm:left-4 sm:right-4 z-20 flex items-center justify-center transition-opacity duration-200 ${chromeClassName} pointer-events-none`}
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
            aria-hidden={!chromeVisible}
          >
            <div className="max-w-[82vw] text-center">
              <div className="text-sm sm:text-base font-semibold text-slate-900 truncate drop-shadow-sm">{title}</div>
              {subtitle ? <div className="text-[11px] sm:text-xs text-slate-600 truncate drop-shadow-sm">{subtitle}</div> : null}
            </div>
          </div>

          <div
            className={`absolute z-20 transition-opacity duration-200 ${chromeClassName}`}
            style={{
              top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
              right: 'calc(env(safe-area-inset-right, 0px) + 8px)',
            }}
            aria-hidden={!chromeVisible}
          >
            <button
              type="button"
              className="w-10 h-10 sm:w-11 sm:h-11 inline-flex items-center justify-center rounded-full border border-slate-200/70 bg-white/90 hover:bg-white text-slate-900 shadow-sm"
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

          <div
            className={`absolute left-2 right-2 sm:left-4 sm:right-4 z-20 flex items-center justify-center gap-3 text-xs sm:text-sm text-slate-900 transition-opacity duration-200 ${chromeClassName}`}
            style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}
            aria-hidden={!chromeVisible}
          >
            <div className="flex items-center justify-center gap-2 sm:gap-3 flex-nowrap">
              <div className="flex items-center gap-2 sm:gap-3 rounded-full border border-slate-200/70 bg-white/90 px-2 py-1.5 sm:px-3 shadow-sm">
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center justify-center rounded-full px-2.5 py-1.5 hover:bg-slate-100"
                  onClick={() => {
                    kickChromeAutoHide()
                    setPage((p) => {
                      const next = Math.max(1, p - 1)
                      scrollToPage(next)
                      return next
                    })
                  }}
                  disabled={loading}
                >
                  <span className="hidden sm:inline">Prev</span>
                  <span className="sm:hidden" aria-hidden="true">◀</span>
                </button>
                <input
                  type="number"
                  className="w-12 sm:w-16 bg-transparent text-center text-xs sm:text-sm text-slate-900 outline-none"
                  min={1}
                  max={totalPages}
                  value={safePage}
                  onChange={(e) => {
                    kickChromeAutoHide()
                    const next = clamp(Number(e.target.value || 1), 1, totalPages)
                    setPage(next)
                    scrollToPage(next)
                  }}
                  disabled={loading}
                />
                <span className="text-xs text-slate-500">/ {totalPages}</span>
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center justify-center rounded-full px-2.5 py-1.5 hover:bg-slate-100"
                  onClick={() => {
                    kickChromeAutoHide()
                    setPage((p) => {
                      const next = Math.min(totalPages, p + 1)
                      scrollToPage(next)
                      return next
                    })
                  }}
                  disabled={loading}
                >
                  <span className="hidden sm:inline">Next</span>
                  <span className="sm:hidden" aria-hidden="true">▶</span>
                </button>
              </div>

              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-10 items-center rounded-full border border-slate-200/70 bg-white/90 px-3 py-1.5 hover:bg-white shadow-sm"
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
                className="inline-flex min-h-10 items-center rounded-full border border-slate-200/70 bg-white/90 px-3 py-1.5 hover:bg-white shadow-sm"
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
                disabled={loading || postBusy || Boolean(error)}
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
              const absX = Math.abs(e.deltaX)
              const absY = Math.abs(e.deltaY)
              if (absX < 30 || absX < absY * 1.2) return
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
            onPointerDown={handleSwipeStart}
            onPointerMove={handleSwipeMove}
            onPointerUp={handleSwipeEnd}
            onPointerCancel={handleSwipeEnd}
            onPointerLeave={handleSwipeEnd}
          >
            <div ref={contentRef} className="w-full flex flex-col items-center gap-6 p-4 sm:p-6">
              {error ? (
                <div className="text-sm text-red-200 px-4">{error}</div>
              ) : loading ? (
                <div className="text-sm muted">Loading PDF…</div>
              ) : (
                <>
                  {!initialRenderReady ? <div className="text-sm muted">Preparing PDF…</div> : null}
                  {Array.from({ length: totalPages }, (_, idx) => {
                    const pageNum = idx + 1
                    return (
                      <canvas
                        key={`pdf-page-${pageNum}`}
                        ref={setPageCanvasRef(pageNum)}
                        className="block bg-white shadow-sm"
                        data-page={pageNum}
                      />
                    )
                  })}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

(PdfViewerOverlay as any).displayName = 'PdfViewerOverlay'
