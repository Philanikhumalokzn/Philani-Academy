import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTapToPeek } from '../lib/useTapToPeek'

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

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export default function PdfViewerOverlay({ open, url, title, subtitle, initialState, onClose, onPostImage }: PdfViewerOverlayProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [frameLoaded, setFrameLoaded] = useState(false)
  const [postBusy, setPostBusy] = useState(false)
  const { visible: chromeVisible, peek: kickChromeAutoHide, clearTimer: clearChromeTimer } = useTapToPeek({
    autoHideMs: 2500,
    defaultVisible: true,
    disabled: !open,
  })

  const viewerSrc = useMemo(() => {
    if (!url) return ''
    const params = new URLSearchParams({ file: url })
    const page = clamp(initialState?.page ?? 1, 1, 100000)
    const zoom = clamp(initialState?.zoom ?? 110, 50, 400)
    const hash = `#page=${page}&zoom=${zoom}`
    return `/pdfjs/web/viewer.html?${params.toString()}${hash}`
  }, [url, initialState?.page, initialState?.zoom])

  const getViewerApplication = useCallback(() => {
    const viewerWindow = iframeRef.current?.contentWindow as any
    return viewerWindow?.PDFViewerApplication || null
  }, [])

  const readViewerSnapshot = useCallback(() => {
    const app = getViewerApplication()
    const pageNumber = Number(app?.pdfViewer?.currentPageNumber ?? app?.page ?? 1)
    const currentScaleValue = app?.pdfViewer?.currentScaleValue ?? app?.pdfViewer?.currentScale

    let zoom = 110
    if (typeof currentScaleValue === 'number' && Number.isFinite(currentScaleValue)) {
      zoom = Math.round(currentScaleValue * 100)
    } else if (typeof currentScaleValue === 'string') {
      const match = currentScaleValue.match(/(\d+(?:\.\d+)?)/)
      if (match) zoom = Math.round(Number(match[1]))
    }

    const scrollTop = Number(app?.pdfViewer?.container?.scrollTop ?? 0)
    return {
      page: clamp(Number.isFinite(pageNumber) ? pageNumber : 1, 1, 100000),
      zoom: clamp(Number.isFinite(zoom) ? zoom : 110, 50, 400),
      scrollTop: Number.isFinite(scrollTop) ? scrollTop : 0,
    }
  }, [getViewerApplication])

  const captureCurrentViewerPage = useCallback(async () => {
    const app = getViewerApplication()
    const snapshot = readViewerSnapshot()
    const pageView = app?.pdfViewer?._pages?.[snapshot.page - 1]
    const sourceCanvas = pageView?.canvas || pageView?.div?.querySelector?.('canvas')
    if (!sourceCanvas) return null

    const outCanvas = document.createElement('canvas')
    outCanvas.width = sourceCanvas.width
    outCanvas.height = sourceCanvas.height

    const ctx = outCanvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(sourceCanvas, 0, 0)

    const blob = await new Promise<Blob | null>((resolve) => {
      outCanvas.toBlob(resolve, 'image/png', 0.92)
    })

    if (!blob) return null
    return {
      file: new File([blob], `pdf-capture-${Date.now()}.png`, { type: 'image/png' }),
      snapshot,
    }
  }, [getViewerApplication, readViewerSnapshot])

  const handlePostCapture = useCallback(async () => {
    if (!onPostImage || postBusy) return
    setPostBusy(true)
    try {
      kickChromeAutoHide()
      const result = await captureCurrentViewerPage()
      if (!result) {
        alert('Unable to capture the current PDF page.')
        return
      }
      await onPostImage(result.file, result.snapshot)
    } catch (err: any) {
      alert(err?.message || 'Failed to capture PDF view')
    } finally {
      setPostBusy(false)
    }
  }, [captureCurrentViewerPage, kickChromeAutoHide, onPostImage, postBusy])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
      kickChromeAutoHide()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose, kickChromeAutoHide])

  useEffect(() => {
    if (!open) return
    kickChromeAutoHide()
    return () => clearChromeTimer()
  }, [open, kickChromeAutoHide, clearChromeTimer])

  useEffect(() => {
    if (!open) return
    setFrameLoaded(false)
  }, [open, viewerSrc])

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
                <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div
            className={`absolute left-2 right-2 sm:left-4 sm:right-4 z-20 flex items-center justify-center gap-3 text-xs sm:text-sm text-slate-900 transition-opacity duration-200 ${chromeClassName}`}
            style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}
            aria-hidden={!chromeVisible}
          >
            <div className="flex items-center justify-center gap-2 sm:gap-3 flex-nowrap">
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
              {onPostImage ? (
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center rounded-full border border-slate-200/70 bg-white/90 px-3 py-1.5 hover:bg-white shadow-sm disabled:opacity-50"
                  onClick={handlePostCapture}
                  disabled={!frameLoaded || postBusy}
                  aria-label={postBusy ? 'Capturing PDF page' : 'Post PDF page'}
                >
                  {postBusy ? 'Capturing…' : 'Post'}
                </button>
              ) : null}
            </div>
          </div>

          {!frameLoaded ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
              <div className="text-sm muted">Loading PDF…</div>
            </div>
          ) : null}

          <iframe
            ref={iframeRef}
            title={title || 'PDF Viewer'}
            src={viewerSrc}
            className="absolute inset-0 z-0 h-full w-full border-0 bg-white"
            onLoad={() => setFrameLoaded(true)}
          />
        </div>
      </div>
    </div>
  )
}

(PdfViewerOverlay as any).displayName = 'PdfViewerOverlay'
