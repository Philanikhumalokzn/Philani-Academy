import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  const scrollRafRef = useRef<number | null>(null)
  const lastWheelTsRef = useRef(0)
  const { visible: chromeVisible, peek: kickChromeAutoHide, clearTimer: clearChromeTimer } = useTapToPeek({
    autoHideMs: 2500,
    defaultVisible: true,
    disabled: !open,
  })
  const [postBusy, setPostBusy] = useState(false)
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 })
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
    lastDist: number
    lastCenterX: number
    lastCenterY: number
    pendingZoom: number | null
  }>({ active: false, startDist: 0, startZoom: 110, lastDist: 0, lastCenterX: 0, lastCenterY: 0, pendingZoom: null })
  const liveZoomRef = useRef(110)
  const lastTouchZoomApplyTsRef = useRef(0)
  const isMobile = useMemo(() => {
    if (typeof navigator === 'undefined') return false
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  }, [])
  const canUseWorker = useMemo(() => {
    if (typeof window === 'undefined') return false
    return typeof (window as any).Worker !== 'undefined' && !isMobile
  }, [isMobile])

  const effectiveZoom = clamp(zoom, 50, 220)
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

  const scrollToPage = useCallback((pageNum: number) => {
    const canvas = pageCanvasRefs.current.get(pageNum)
    if (!canvas) return
    canvas.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const updatePageFromScroll = useCallback(() => {
    const scrollEl = scrollContainerRef.current
    if (!scrollEl) return
    const viewportRect = scrollEl.getBoundingClientRect()
    const viewportCenter = viewportRect.top + viewportRect.height / 2
    let bestPage = safePage
    let bestDist = Number.POSITIVE_INFINITY

    pageCanvasRefs.current.forEach((canvas, pageNum) => {
      const rect = canvas.getBoundingClientRect()
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
        pinchStateRef.current.active = true
        pinchStateRef.current.startDist = startDist
        pinchStateRef.current.startZoom = effectiveZoom
        pinchStateRef.current.lastDist = startDist
        pinchStateRef.current.lastCenterX = getTouchCenterX(e.touches)
        pinchStateRef.current.lastCenterY = getTouchCenterY(e.touches)
        pinchStateRef.current.pendingZoom = null
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
        const distDelta = Math.abs(dist - pinchStateRef.current.lastDist)
        const centerDeltaX = centerX - pinchStateRef.current.lastCenterX
        const centerDeltaY = centerY - pinchStateRef.current.lastCenterY

        if (distDelta > 6) {
          const scale = dist / pinchStateRef.current.startDist
          const nextZoom = clamp(Math.round(pinchStateRef.current.startZoom * scale), 50, 220)
          pinchStateRef.current.pendingZoom = nextZoom
          const now = Date.now()
          if (now - lastTouchZoomApplyTsRef.current >= 80 && Math.abs(nextZoom - liveZoomRef.current) >= 2) {
            setZoom(nextZoom)
            liveZoomRef.current = nextZoom
            lastTouchZoomApplyTsRef.current = now
            pinchStateRef.current.pendingZoom = null
          }
        }

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
        pinchStateRef.current.active = true
        pinchStateRef.current.startDist = startDist
        pinchStateRef.current.startZoom = effectiveZoom
        pinchStateRef.current.lastDist = startDist
        pinchStateRef.current.lastCenterX = getTouchCenterX(e.touches)
        pinchStateRef.current.lastCenterY = getTouchCenterY(e.touches)
        pinchStateRef.current.pendingZoom = null
        touchState.active = false
        return
      }
      if (pinchStateRef.current.active) {
        const pendingZoom = pinchStateRef.current.pendingZoom
        if (typeof pendingZoom === 'number' && pendingZoom !== liveZoomRef.current) {
          setZoom(pendingZoom)
          liveZoomRef.current = pendingZoom
        }
        pinchStateRef.current.active = false
        pinchStateRef.current.startDist = 0
        pinchStateRef.current.lastDist = 0
        pinchStateRef.current.pendingZoom = null
        return
      }
      if (!touchState.active) return
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
    }
  }, [effectiveZoom, kickChromeAutoHide, open, scrollToPage, totalPages])

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
  }, [open, url, initialState?.page, initialState?.zoom])

  useEffect(() => {
    if (open) return
    cancelRenderTasks()
    if (pdfDoc?.destroy) {
      pdfDoc.destroy()
    }
    setPdfDoc(null)
  }, [open, pdfDoc, cancelRenderTasks])

  const renderPageToCanvas = useCallback(async (pageNum: number, canvas: HTMLCanvasElement) => {
    if (!pdfDoc || !open) return
    const context = canvas.getContext('2d')
    if (!context) return

    try {
      const pageObj = await pdfDoc.getPage(pageNum)
      const baseScale = effectiveZoom / 100
      const naturalViewport = pageObj.getViewport({ scale: 1 })
      const availableWidth = contentSize.width || contentRef.current?.clientWidth || 0
      const fitScale = availableWidth
        ? clamp(availableWidth / naturalViewport.width, 0.5, 2)
        : 1
      const finalScale = baseScale * fitScale
      const viewport = pageObj.getViewport({ scale: finalScale })
      const outputScale = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      context.setTransform(outputScale, 0, 0, outputScale, 0, 0)

      const existing = renderTasksRef.current.get(pageNum)
      if (existing?.cancel) existing.cancel()
      const task = pageObj.render({ canvasContext: context, viewport })
      renderTasksRef.current.set(pageNum, task)
      await task.promise
    } catch (err: any) {
      const message = String(err?.message || '')
      const name = String(err?.name || '')
      if (name === 'RenderingCancelledException' || /rendering cancelled|canceled|cancelled/i.test(message)) {
        return
      }
      setError(err?.message || 'Failed to render PDF page')
    }
  }, [pdfDoc, open, effectiveZoom, contentSize.width])

  const renderAllPages = useCallback(async () => {
    if (!pdfDoc || !open) return
    const pages = Array.from({ length: totalPages }, (_, idx) => idx + 1)
    for (const pageNum of pages) {
      const canvas = pageCanvasRefs.current.get(pageNum)
      if (!canvas) continue
      await renderPageToCanvas(pageNum, canvas)
    }
  }, [pdfDoc, open, renderPageToCanvas, totalPages])

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
    const scrollEl = scrollContainerRef.current
    if (!scrollEl) return

    const onScroll = () => {
      if (scrollRafRef.current) return
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null
        updatePageFromScroll()
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
  }, [open, updatePageFromScroll])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (cancelled) return
      await renderAllPages()
      if (cancelled || !open) return
      if (!initialState) return
      if (restoredScrollRef.current) return
      const scrollEl = scrollContainerRef.current
      if (!scrollEl) return
      if (typeof initialState.scrollTop === 'number') {
        scrollEl.scrollTop = initialState.scrollTop
      } else if (typeof initialState.page === 'number') {
        scrollToPage(initialState.page)
      }
      restoredScrollRef.current = true
    })()
    return () => {
      cancelled = true
      cancelRenderTasks()
    }
  }, [renderAllPages, cancelRenderTasks, initialState, open, scrollToPage])

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
            style={{ touchAction: 'pan-y pinch-zoom', WebkitOverflowScrolling: 'touch' }}
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
                Array.from({ length: totalPages }, (_, idx) => {
                  const pageNum = idx + 1
                  return (
                    <canvas
                      key={`pdf-page-${pageNum}`}
                      ref={setPageCanvasRef(pageNum)}
                      className="block bg-white shadow-sm"
                      data-page={pageNum}
                    />
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
