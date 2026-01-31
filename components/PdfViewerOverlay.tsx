import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

type PdfViewerOverlayProps = {
  open: boolean
  url: string
  title: string
  subtitle?: string
  onClose: () => void
  onPostImage?: (file: File) => void | Promise<void>
}

export default function PdfViewerOverlay({ open, url, title, subtitle, onClose, onPostImage }: PdfViewerOverlayProps) {
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(110)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [pdfDoc, setPdfDoc] = useState<any | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const renderTaskRef = useRef<any | null>(null)
  const hideChromeTimerRef = useRef<number | null>(null)
  const [chromeVisible, setChromeVisible] = useState(true)
  const [postBusy, setPostBusy] = useState(false)
  const isMobile = useMemo(() => {
    if (typeof navigator === 'undefined') return false
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  }, [])
  const canUseWorker = useMemo(() => {
    if (typeof window === 'undefined') return false
    return typeof (window as any).Worker !== 'undefined' && !isMobile
  }, [isMobile])

  const effectiveZoom = clamp(zoom, 50, 220)
  const effectivePage = Math.max(1, page)

  const totalPages = Math.max(1, numPages || 1)
  const safePage = clamp(effectivePage, 1, totalPages)

  const clearChromeTimer = useCallback(() => {
    if (hideChromeTimerRef.current) {
      window.clearTimeout(hideChromeTimerRef.current)
      hideChromeTimerRef.current = null
    }
  }, [])

  const kickChromeAutoHide = useCallback(() => {
    if (!open) return
    setChromeVisible(true)
    clearChromeTimer()
    hideChromeTimerRef.current = window.setTimeout(() => {
      setChromeVisible(false)
      hideChromeTimerRef.current = null
    }, 2500)
  }, [clearChromeTimer, open])

  const captureVisibleCanvas = useCallback(async () => {
    const canvas = canvasRef.current
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
  }, [])

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
      await onPostImage(file)
    } catch (err: any) {
      alert(err?.message || 'Failed to capture PDF view')
    } finally {
      setPostBusy(false)
    }
  }, [captureVisibleCanvas, error, kickChromeAutoHide, loading, onPostImage, postBusy])

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
      kickChromeAutoHide()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose, kickChromeAutoHide])

  useEffect(() => {
    if (!open || !url) return
    let cancelled = false
    let activeDoc: any | null = null
    let loadingTask: any | null = null

    setLoading(true)
    setError(null)
    setPdfDoc(null)
    setNumPages(0)
    setPage(1)

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
  }, [open, url])

  useEffect(() => {
    if (open) return
    if (renderTaskRef.current?.cancel) {
      renderTaskRef.current.cancel()
    }
    if (pdfDoc?.destroy) {
      pdfDoc.destroy()
    }
    setPdfDoc(null)
  }, [open, pdfDoc])

  const renderPage = useCallback(async () => {
    if (!pdfDoc || !open) return
    const currentPage = clamp(safePage, 1, totalPages)
    if (currentPage !== safePage) {
      setPage(currentPage)
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    try {
      const pageObj = await pdfDoc.getPage(currentPage)
      const viewport = pageObj.getViewport({ scale: effectiveZoom / 100 })
      const outputScale = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      context.setTransform(outputScale, 0, 0, outputScale, 0, 0)

      if (renderTaskRef.current?.cancel) {
        renderTaskRef.current.cancel()
      }
      const task = pageObj.render({ canvasContext: context, viewport })
      renderTaskRef.current = task
      await task.promise
    } catch (err: any) {
      setError(err?.message || 'Failed to render PDF page')
    }
  }, [pdfDoc, open, safePage, totalPages, effectiveZoom])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (cancelled) return
      await renderPage()
    })()
    return () => {
      cancelled = true
      if (renderTaskRef.current?.cancel) {
        renderTaskRef.current.cancel()
      }
    }
  }, [renderPage])

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

      <div className="absolute inset-0" onClick={onClose}>
        <div
          className="relative h-full w-full overflow-hidden border border-white/10 bg-white/10 backdrop-blur-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className={`absolute left-2 right-2 top-2 sm:left-4 sm:right-4 sm:top-4 z-20 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200/60 bg-white/90 px-2 py-2 text-xs text-slate-900 transition-opacity duration-200 ${chromeClassName}`}
            aria-hidden={!chromeVisible}
          >
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-slate-900 truncate">{title}</div>
              {subtitle ? <div className="text-[11px] text-slate-600 truncate">{subtitle}</div> : null}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
              <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1">
                <button
                  type="button"
                  className="px-2 py-1 rounded-full hover:bg-slate-100"
                  onClick={() => {
                    kickChromeAutoHide()
                    setZoom((z) => clamp(z - 10, 50, 220))
                  }}
                >
                  −
                </button>
                <span className="min-w-[48px] text-center">{effectiveZoom}%</span>
                <button
                  type="button"
                  className="px-2 py-1 rounded-full hover:bg-slate-100"
                  onClick={() => {
                    kickChromeAutoHide()
                    setZoom((z) => clamp(z + 10, 50, 220))
                  }}
                >
                  +
                </button>
              </div>

              <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1">
                <button
                  type="button"
                  className="px-2 py-1 rounded-full hover:bg-slate-100"
                  onClick={() => {
                    kickChromeAutoHide()
                    setPage((p) => Math.max(1, p - 1))
                  }}
                  disabled={loading}
                >
                  Prev
                </button>
                <input
                  type="number"
                  className="w-16 bg-transparent text-center text-xs text-slate-900 outline-none"
                  min={1}
                  max={totalPages}
                  value={safePage}
                  onChange={(e) => {
                    kickChromeAutoHide()
                    setPage(clamp(Number(e.target.value || 1), 1, totalPages))
                  }}
                  disabled={loading}
                />
                <span className="text-[10px] text-slate-500">/ {totalPages}</span>
                <button
                  type="button"
                  className="px-2 py-1 rounded-full hover:bg-slate-100"
                  onClick={() => {
                    kickChromeAutoHide()
                    setPage((p) => Math.min(totalPages, p + 1))
                  }}
                  disabled={loading}
                >
                  Next
                </button>
              </div>

              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1 rounded-full border border-slate-200 bg-white hover:bg-slate-50"
                onClick={kickChromeAutoHide}
              >
                Open
              </a>
              <a
                href={url}
                download
                className="px-3 py-1 rounded-full border border-slate-200 bg-white hover:bg-slate-50"
                onClick={kickChromeAutoHide}
              >
                Download
              </a>
              <button
                type="button"
                className="w-9 h-9 inline-flex items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-slate-900"
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
              className={`absolute left-3 top-1/2 -translate-y-1/2 z-20 transition-opacity duration-200 ${chromeClassName}`}
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

          <div ref={scrollContainerRef} className="absolute inset-0 z-0 overflow-auto">
            <div className="min-h-full w-full flex items-center justify-center">
              {error ? (
                <div className="text-sm text-red-200 px-4">{error}</div>
              ) : loading ? (
                <div className="text-sm muted">Loading PDF…</div>
              ) : (
                <canvas ref={canvasRef} className="block bg-white shadow-sm" />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

(PdfViewerOverlay as any).displayName = 'PdfViewerOverlay'
