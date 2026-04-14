import React, { useCallback, useEffect, useRef, useState } from 'react'
import FullScreenGlassOverlay from './FullScreenGlassOverlay'
import { PublicSolveCanvasViewer, type PublicSolveScene } from './PublicSolveCanvas'

type ZoomableCanvasOverlayProps = {
  open: boolean
  scene: PublicSolveScene | null | undefined
  title?: string
  onClose: () => void
  onViewportChange?: (scene: PublicSolveScene) => void
}

export default function ZoomableCanvasOverlay({
  open,
  scene,
  title,
  onClose,
  onViewportChange,
}: ZoomableCanvasOverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [viewerScene, setViewerScene] = useState<PublicSolveScene | null>(scene || null)

  const measureContainer = useCallback(() => {
    const element = containerRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    setContainerSize({
      width: Math.max(0, rect.width),
      height: Math.max(0, rect.height),
    })
  }, [])

  useEffect(() => {
    if (!open) return
    setViewerScene(scene || null)
    measureContainer()
  }, [measureContainer, open, scene])

  useEffect(() => {
    if (!open) return
    const element = containerRef.current
    if (!element) return

    measureContainer()

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => measureContainer())
      : null

    if (observer) observer.observe(element)

    const handleWindowResize = () => measureContainer()
    window.addEventListener('resize', handleWindowResize)

    return () => {
      if (observer) observer.disconnect()
      window.removeEventListener('resize', handleWindowResize)
    }
  }, [measureContainer, open])

  const handleViewportChange = useCallback((nextScene: PublicSolveScene) => {
    setViewerScene(nextScene)
    onViewportChange?.(nextScene)
  }, [onViewportChange])

  if (!open || !viewerScene) return null

  const safeTitle = String(title || '').trim() || 'Canvas viewer'
  const viewerHeightPx = Math.max(240, containerSize.height - 32)
  const maxWidthPx = Math.max(240, containerSize.width - 32)

  return (
    <FullScreenGlassOverlay
      title={safeTitle}
      onClose={onClose}
      onBackdropClick={onClose}
      zIndexClassName="z-[95]"
      panelSize="full"
      variant="light"
      hideHeader
      showCloseButton={false}
      panelClassName="!rounded-none !max-w-none !border-0 !bg-black"
      frameClassName="absolute inset-0 flex items-stretch justify-center p-0"
      contentClassName="!p-0 !overflow-hidden"
      forceHeaderSafeTop
      respectBottomSafeArea={false}
    >
      <div className="relative flex h-full min-h-0 flex-col bg-black text-white">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-32 bg-gradient-to-b from-black/55 to-transparent" />

        <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-end px-4 pb-6 pt-[calc(0.9rem+var(--app-safe-top))] sm:px-5">
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center bg-transparent text-white/92 transition hover:text-white"
            onClick={(event) => {
              event.stopPropagation()
              onClose()
            }}
            aria-label="Close canvas viewer"
            title="Close"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
              <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div
          ref={containerRef}
          className="relative min-h-0 flex-1 overflow-hidden"
          style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
          onWheel={(event) => event.preventDefault()}
        >
          <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6">
            <PublicSolveCanvasViewer
              scene={viewerScene}
              viewerHeightPx={viewerHeightPx}
              maxWidthPx={maxWidthPx}
              onViewportChange={handleViewportChange}
            />
          </div>
        </div>
      </div>
    </FullScreenGlassOverlay>
  )
}