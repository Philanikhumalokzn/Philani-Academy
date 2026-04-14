import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FullScreenGlassOverlay from './FullScreenGlassOverlay'
import { PublicSolvePlainExcalidrawViewer, resolvePublicSolveSceneForViewport, type PublicSolveScene } from './PublicSolveCanvas'

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
    measureContainer()
  }, [measureContainer, open])

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

  useEffect(() => {
    if (!open) return
    const element = containerRef.current
    if (!element) return

    const preventDefault = (event: Event) => {
      event.preventDefault()
    }

    element.addEventListener('wheel', preventDefault, { passive: false })
    element.addEventListener('touchmove', preventDefault, { passive: false })

    return () => {
      element.removeEventListener('wheel', preventDefault)
      element.removeEventListener('touchmove', preventDefault)
    }
  }, [open])

  useEffect(() => {
    if (!open || typeof document === 'undefined') return

    const html = document.documentElement
    const body = document.body
    const previousHtmlOverflow = html.style.overflow
    const previousHtmlOverscrollBehavior = html.style.overscrollBehavior
    const previousBodyOverscrollBehavior = body.style.overscrollBehavior

    html.style.overflow = 'hidden'
    html.style.overscrollBehavior = 'none'
    body.style.overscrollBehavior = 'none'

    return () => {
      html.style.overflow = previousHtmlOverflow
      html.style.overscrollBehavior = previousHtmlOverscrollBehavior
      body.style.overscrollBehavior = previousBodyOverscrollBehavior
    }
  }, [open])

  const handleViewportChange = useCallback((nextScene: PublicSolveScene) => {
    onViewportChange?.(nextScene)
  }, [onViewportChange])

  const safeTitle = String(title || '').trim() || 'Canvas viewer'
  const resolvedViewerHeightPx = Math.max(1, containerSize.height || 0)
  const resolvedViewerWidthPx = Math.max(1, containerSize.width || 0)
  const displayScene = useMemo(() => {
    if (!open || !scene) return null
    return resolvePublicSolveSceneForViewport(scene, {
      widthPx: resolvedViewerWidthPx,
      heightPx: resolvedViewerHeightPx,
    })
  }, [open, resolvedViewerHeightPx, resolvedViewerWidthPx, scene])

  if (!open || !scene || !displayScene) return null

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
      panelClassName="!rounded-none !max-w-none !border-0 !bg-white"
      frameClassName="absolute inset-0 flex items-stretch justify-center p-0"
      contentClassName="!p-0 !overflow-hidden"
      forceHeaderSafeTop
      respectBottomSafeArea={false}
    >
      <div data-testid="zoomable-canvas-overlay" className="relative flex h-full min-h-0 flex-col bg-white text-slate-900">
        <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-end px-4 pb-6 pt-[calc(0.9rem+var(--app-safe-top))] sm:px-5">
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/92 text-slate-700 shadow-[0_10px_30px_rgba(15,23,42,0.16)] backdrop-blur transition hover:bg-white hover:text-slate-900"
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
          data-testid="zoomable-canvas-surface"
          className="relative min-h-0 flex-1 overflow-hidden"
          style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
          onWheelCapture={(event) => event.preventDefault()}
          onTouchMoveCapture={(event) => event.preventDefault()}
        >
          <div data-testid="zoomable-canvas-viewer" className="absolute inset-0 bg-white">
              <PublicSolvePlainExcalidrawViewer
                scene={displayScene}
                viewerHeightPx={resolvedViewerHeightPx}
                viewerHeightMode="fixed"
                onViewportChange={handleViewportChange}
              />
          </div>
        </div>
      </div>
    </FullScreenGlassOverlay>
  )
}