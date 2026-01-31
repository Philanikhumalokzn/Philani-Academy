import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

type PdfViewerOverlayProps = {
  open: boolean
  url: string
  title: string
  subtitle?: string
  onClose: () => void
}

export default function PdfViewerOverlay({ open, url, title, subtitle, onClose }: PdfViewerOverlayProps) {
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(110)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [pdfDoc, setPdfDoc] = useState<any | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const renderTaskRef = useRef<any | null>(null)
  const hideChromeTimerRef = useRef<number | null>(null)
  const [chromeVisible, setChromeVisible] = useState(true)
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
            className={`absolute left-2 right-2 top-2 sm:left-4 sm:right-4 sm:top-4 z-20 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/10 px-2 py-2 text-xs text-white/90 transition-opacity duration-200 ${chromeClassName}`}
            aria-hidden={!chromeVisible}
          >
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-white truncate">{title}</div>
              {subtitle ? <div className="text-[11px] text-white/70 truncate">{subtitle}</div> : null}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-2 py-1">
                <button
                  type="button"
                  className="px-2 py-1 rounded-full hover:bg-white/15"
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
                  className="px-2 py-1 rounded-full hover:bg-white/15"
                  onClick={() => {
                    kickChromeAutoHide()
                    setZoom((z) => clamp(z + 10, 50, 220))
                  }}
                >
                  +
                </button>
              </div>

              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-2 py-1">
                <button
                  type="button"
                  className="px-2 py-1 rounded-full hover:bg-white/15"
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
                  className="w-16 bg-transparent text-center text-xs text-white outline-none"
                  min={1}
                  max={totalPages}
                  value={safePage}
                  onChange={(e) => {
                    kickChromeAutoHide()
                    setPage(clamp(Number(e.target.value || 1), 1, totalPages))
                  }}
                  disabled={loading}
                />
                <span className="text-[10px] text-white/70">/ {totalPages}</span>
                <button
                  type="button"
                  className="px-2 py-1 rounded-full hover:bg-white/15"
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
                className="px-3 py-1 rounded-full border border-white/10 bg-white/10 hover:bg-white/15"
                onClick={kickChromeAutoHide}
              >
                Open
              </a>
              <a
                href={url}
                download
                className="px-3 py-1 rounded-full border border-white/10 bg-white/10 hover:bg-white/15"
                onClick={kickChromeAutoHide}
              >
                Download
              </a>
              <button
                type="button"
                className="w-9 h-9 inline-flex items-center justify-center rounded-full border border-white/10 bg-white/10 hover:bg-white/15 text-white"
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

          <div className="absolute inset-0 z-0 overflow-auto">
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
