import { useCallback, useRef, useState } from 'react'
import FullScreenGlassOverlay from './FullScreenGlassOverlay'

type MathKeyboardOverlayProps = {
  open: boolean
  onClose: () => void
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export default function MathKeyboardOverlay({ open, onClose }: MathKeyboardOverlayProps) {
  const [topRatio, setTopRatio] = useState(0.2)
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
      panelClassName="!h-full !max-h-none !max-w-none !rounded-none border-none bg-white"
      className="[&>.philani-overlay-backdrop]:!bg-white [&>.philani-overlay-backdrop]:!backdrop-blur-none"
      contentClassName="p-0"
    >
      <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-white">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-[calc(var(--app-safe-top)+0.75rem)] z-20 inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 shadow-sm transition hover:bg-slate-100"
          aria-label="Close keyboard overlay"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <div className="h-full w-full">
          <div
            className="border rounded bg-white p-0 shadow-sm flex flex-col relative"
            style={{
              flex: 1,
              minHeight: '100%',
              height: '100%',
              maxHeight: '100%',
              overflow: 'hidden',
            }}
          >
            <div
              className="flex flex-col"
              style={{ flex: Math.max(topRatio, 0.2), minHeight: '200px' }}
            >
              <div className="px-3 py-3 flex-1 min-h-[140px]">
                <div className="h-full bg-white rounded-lg p-3 overflow-visible relative" />
              </div>
            </div>

            <div
              role="separator"
              aria-label="Resize top and bottom panels"
              aria-orientation="horizontal"
              onPointerDown={handleSeparatorPointerDown}
              className="relative z-20 flex items-center justify-center px-4 py-2 bg-white cursor-row-resize select-none"
              style={{ touchAction: 'none' }}
            >
              <div className="w-10 h-1.5 bg-slate-400 rounded-full" />
            </div>

            <div
              className="px-4 pb-3 flex flex-col min-h-0"
              style={{
                flex: Math.max(1 - topRatio, 0.2),
                minHeight: '220px',
              }}
            >
              <div className="h-full min-h-0 bg-white" />
            </div>
          </div>
        </div>
      </div>
    </FullScreenGlassOverlay>
  )
}
