import { useCallback, useRef, useState } from 'react'
import FullScreenGlassOverlay from './FullScreenGlassOverlay'

type MathKeyboardOverlayProps = {
  open: boolean
  onClose: () => void
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export default function MathKeyboardOverlay({ open, onClose }: MathKeyboardOverlayProps) {
  const [topRatio, setTopRatio] = useState(0.62)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const updateFromClientY = useCallback((clientY: number) => {
    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    if (rect.height <= 0) return

    const MIN_RATIO = 0.2
    const MAX_RATIO = 0.8

    const nextRatio = (clientY - rect.top) / rect.height
    setTopRatio(clamp(nextRatio, MIN_RATIO, MAX_RATIO))
  }, [])

  const handleSeparatorPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const pointerId = event.pointerId

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      updateFromClientY(moveEvent.clientY)
    }

    const onPointerEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerEnd)
      window.removeEventListener('pointercancel', onPointerEnd)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerEnd)
    window.addEventListener('pointercancel', onPointerEnd)
  }, [updateFromClientY])

  if (!open) return null

  return (
    <FullScreenGlassOverlay
      title=""
      onClose={onClose}
      onBackdropClick={onClose}
      hideHeader
      panelSize="full"
      zIndexClassName="z-[68]"
      frameClassName="absolute inset-0 flex items-stretch justify-center p-0"
      panelClassName="!h-full !max-h-none !max-w-none !rounded-none border-none bg-[#020617]"
      contentClassName="p-0"
    >
      <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-[radial-gradient(circle_at_14%_10%,rgba(56,189,248,0.18),transparent_48%),radial-gradient(circle_at_84%_86%,rgba(14,116,144,0.24),transparent_54%),linear-gradient(180deg,#020617_0%,#0b1325_45%,#0f172a_100%)]">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/30 text-white transition hover:bg-black/45"
          aria-label="Close keyboard overlay"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <div className="absolute inset-3 overflow-hidden rounded-[24px] border border-white/12 bg-white/5 shadow-[0_24px_60px_rgba(2,6,23,0.45)] backdrop-blur-[2px]">
          <div className="flex h-full min-h-0 flex-col">
            <div
              className="min-h-[160px] border-b border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.78),rgba(15,23,42,0.44))]"
              style={{ height: `${topRatio * 100}%` }}
            />

            <div
              role="separator"
              aria-label="Resize top and bottom panels"
              aria-orientation="horizontal"
              onPointerDown={handleSeparatorPointerDown}
              className="relative h-7 shrink-0 cursor-row-resize touch-none border-y border-white/15 bg-[linear-gradient(180deg,rgba(15,23,42,0.95),rgba(2,6,23,0.9))]"
            >
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-1.5 w-20 rounded-full bg-white/50" />
              </div>
            </div>

            <div className="min-h-[160px] flex-1 bg-[linear-gradient(180deg,rgba(15,23,42,0.4),rgba(2,6,23,0.88))]" />
          </div>
        </div>
      </div>
    </FullScreenGlassOverlay>
  )
}
