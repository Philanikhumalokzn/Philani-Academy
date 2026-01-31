import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FullScreenGlassOverlay from './FullScreenGlassOverlay'

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

  const effectiveZoom = clamp(zoom, 50, 220)
  const effectivePage = Math.max(1, page)

  const totalPages = Math.max(1, numPages || 1)
  const safePage = clamp(effectivePage, 1, totalPages)

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
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf')
        if (!pdfjs?.GlobalWorkerOptions?.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`
        }
        loadingTask = pdfjs.getDocument({ url })
        const doc = await loadingTask.promise
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

  return (
    <FullScreenGlassOverlay
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      zIndexClassName="z-50"
      contentClassName="p-4 sm:p-6"
      rightActions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-2 py-1 text-xs text-white/90">
            <button
              type="button"
              className="px-2 py-1 rounded-full hover:bg-white/15"
              onClick={() => setZoom((z) => clamp(z - 10, 50, 220))}
            >
              −
            </button>
            <span className="min-w-[48px] text-center">{effectiveZoom}%</span>
            <button
              type="button"
              className="px-2 py-1 rounded-full hover:bg-white/15"
              onClick={() => setZoom((z) => clamp(z + 10, 50, 220))}
            >
              +
            </button>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-2 py-1 text-xs text-white/90">
            <button
              type="button"
              className="px-2 py-1 rounded-full hover:bg-white/15"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
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
              onChange={(e) => setPage(clamp(Number(e.target.value || 1), 1, totalPages))}
              disabled={loading}
            />
            <span className="text-[10px] text-white/70">/ {totalPages}</span>
            <button
              type="button"
              className="px-2 py-1 rounded-full hover:bg-white/15"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={loading}
            >
              Next
            </button>
          </div>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1 rounded-full border border-white/10 bg-white/10 text-xs text-white/90 hover:bg-white/15"
          >
            Open
          </a>
          <a
            href={url}
            download
            className="px-3 py-1 rounded-full border border-white/10 bg-white/10 text-xs text-white/90 hover:bg-white/15"
          >
            Download
          </a>
        </div>
      }
    >
      <div className="rounded-2xl border border-white/10 bg-white/5 p-2">
        <div className="h-[70vh] w-full rounded-xl bg-white/5 flex items-center justify-center overflow-auto">
          {error ? (
            <div className="text-sm text-red-200 px-4">{error}</div>
          ) : loading ? (
            <div className="text-sm muted">Loading PDF…</div>
          ) : (
            <canvas ref={canvasRef} className="rounded-lg bg-white shadow-sm" />
          )}
        </div>
      </div>
    </FullScreenGlassOverlay>
  )
}

(PdfViewerOverlay as any).displayName = 'PdfViewerOverlay'
