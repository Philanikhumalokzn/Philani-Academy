import { useMemo, useState } from 'react'
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

  const effectiveZoom = clamp(zoom, 50, 220)
  const effectivePage = Math.max(1, page)

  const iframeSrc = useMemo(() => {
    if (!url) return ''
    const [base] = url.split('#')
    const hash = `page=${effectivePage}&zoom=${effectiveZoom}&toolbar=0&navpanes=0`
    return `${base}#${hash}`
  }, [url, effectivePage, effectiveZoom])

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
            >
              Prev
            </button>
            <input
              type="number"
              className="w-16 bg-transparent text-center text-xs text-white outline-none"
              min={1}
              value={effectivePage}
              onChange={(e) => setPage(Math.max(1, Number(e.target.value || 1)))}
            />
            <button
              type="button"
              className="px-2 py-1 rounded-full hover:bg-white/15"
              onClick={() => setPage((p) => p + 1)}
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
        <iframe
          title={title}
          src={iframeSrc}
          className="h-[70vh] w-full rounded-xl bg-white"
        />
      </div>
    </FullScreenGlassOverlay>
  )
}

(PdfViewerOverlay as any).displayName = 'PdfViewerOverlay'
