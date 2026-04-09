import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FullScreenGlassOverlay from './FullScreenGlassOverlay'

type ZoomableImageOverlayProps = {
  open: boolean
  imageUrl: string
  title?: string
  onClose: () => void
}

type ViewState = {
  scale: number
  x: number
  y: number
}

const MIN_SCALE = 1
const MAX_SCALE = 5

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export default function ZoomableImageOverlay({ open, imageUrl, title, onClose }: ZoomableImageOverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)

  const [view, setView] = useState<ViewState>({ scale: 1, x: 0, y: 0 })
  const viewRef = useRef<ViewState>({ scale: 1, x: 0, y: 0 })

  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 })
  const naturalSizeRef = useRef({ width: 0, height: 0 })

  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const containerSizeRef = useRef({ width: 0, height: 0 })

  const dragRef = useRef<{ active: boolean; startClientX: number; startClientY: number; startX: number; startY: number }>({
    active: false,
    startClientX: 0,
    startClientY: 0,
    startX: 0,
    startY: 0,
  })

  const touchPanRef = useRef<{ active: boolean; lastX: number; lastY: number }>({ active: false, lastX: 0, lastY: 0 })
  const pinchRef = useRef<{ active: boolean; lastDistance: number; lastMidX: number; lastMidY: number }>({
    active: false,
    lastDistance: 0,
    lastMidX: 0,
    lastMidY: 0,
  })

  const syncView = useCallback((next: ViewState | ((prev: ViewState) => ViewState)) => {
    setView((prev) => {
      const resolved = typeof next === 'function' ? (next as (value: ViewState) => ViewState)(prev) : next
      viewRef.current = resolved
      return resolved
    })
  }, [])

  const measureContainer = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const nextSize = {
      width: Math.max(0, rect.width),
      height: Math.max(0, rect.height),
    }
    setContainerSize(nextSize)
    containerSizeRef.current = nextSize
  }, [])

  const getBoundsForScale = useCallback((scale: number) => {
    const frame = containerSizeRef.current
    const natural = naturalSizeRef.current
    if (!frame.width || !frame.height || !natural.width || !natural.height) {
      return { maxX: 0, maxY: 0 }
    }

    const fitScale = Math.min(frame.width / natural.width, frame.height / natural.height)
    const renderedWidth = natural.width * fitScale * scale
    const renderedHeight = natural.height * fitScale * scale

    return {
      maxX: Math.max(0, (renderedWidth - frame.width) / 2),
      maxY: Math.max(0, (renderedHeight - frame.height) / 2),
    }
  }, [])

  const clampView = useCallback((next: ViewState): ViewState => {
    const boundedScale = clamp(next.scale, MIN_SCALE, MAX_SCALE)
    const bounds = getBoundsForScale(boundedScale)
    return {
      scale: boundedScale,
      x: clamp(next.x, -bounds.maxX, bounds.maxX),
      y: clamp(next.y, -bounds.maxY, bounds.maxY),
    }
  }, [getBoundsForScale])

  const zoomAround = useCallback((targetScale: number, anchorX: number, anchorY: number) => {
    const current = viewRef.current
    const boundedScale = clamp(targetScale, MIN_SCALE, MAX_SCALE)
    const frame = containerSizeRef.current

    if (!frame.width || !frame.height) {
      syncView(clampView({ ...current, scale: boundedScale }))
      return
    }

    const centerX = frame.width / 2
    const centerY = frame.height / 2

    const contentX = (anchorX - centerX - current.x) / Math.max(current.scale, 0.0001)
    const contentY = (anchorY - centerY - current.y) / Math.max(current.scale, 0.0001)

    const nextX = anchorX - centerX - contentX * boundedScale
    const nextY = anchorY - centerY - contentY * boundedScale

    syncView(clampView({ scale: boundedScale, x: nextX, y: nextY }))
  }, [clampView, syncView])

  useEffect(() => {
    if (!open) return
    syncView({ scale: 1, x: 0, y: 0 })
    touchPanRef.current = { active: false, lastX: 0, lastY: 0 }
    pinchRef.current = { active: false, lastDistance: 0, lastMidX: 0, lastMidY: 0 }
    measureContainer()
  }, [measureContainer, open, imageUrl, syncView])

  useEffect(() => {
    if (!open) return
    const el = containerRef.current
    if (!el) return

    measureContainer()

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => measureContainer())
      : null

    if (observer) observer.observe(el)

    const onWindowResize = () => measureContainer()
    window.addEventListener('resize', onWindowResize)

    return () => {
      if (observer) observer.disconnect()
      window.removeEventListener('resize', onWindowResize)
    }
  }, [measureContainer, open])

  useEffect(() => {
    if (!open) return
    syncView((prev) => clampView(prev))
  }, [open, containerSize, naturalSize, clampView, syncView])

  const canPan = view.scale > 1.01

  const uiScaleLabel = useMemo(() => `${Math.round(view.scale * 100)}%`, [view.scale])

  const handleImageLoad = useCallback(() => {
    const image = imageRef.current
    if (!image) return
    const next = {
      width: image.naturalWidth || 0,
      height: image.naturalHeight || 0,
    }
    setNaturalSize(next)
    naturalSizeRef.current = next
  }, [])

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    const anchorX = event.clientX - rect.left
    const anchorY = event.clientY - rect.top
    const step = event.deltaY < 0 ? 1.12 : 0.9

    zoomAround(viewRef.current.scale * step, anchorX, anchorY)
  }, [zoomAround])

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    if (!canPan) return

    event.preventDefault()
    dragRef.current = {
      active: true,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: viewRef.current.x,
      startY: viewRef.current.y,
    }

    event.currentTarget.setPointerCapture(event.pointerId)
  }, [canPan])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return

    const dx = event.clientX - dragRef.current.startClientX
    const dy = event.clientY - dragRef.current.startClientY

    syncView(clampView({
      scale: viewRef.current.scale,
      x: dragRef.current.startX + dx,
      y: dragRef.current.startY + dy,
    }))
  }, [clampView, syncView])

  const endPointerDrag = useCallback(() => {
    dragRef.current.active = false
  }, [])

  const getTouchDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return 0
    const a = touches[0]
    const b = touches[1]
    const dx = a.clientX - b.clientX
    const dy = a.clientY - b.clientY
    return Math.hypot(dx, dy)
  }

  const getTouchMidpoint = (touches: React.TouchList) => {
    if (touches.length < 2) return { x: 0, y: 0 }
    const a = touches[0]
    const b = touches[1]
    const rect = containerRef.current?.getBoundingClientRect()
    const left = rect?.left ?? 0
    const top = rect?.top ?? 0
    return {
      x: ((a.clientX + b.clientX) / 2) - left,
      y: ((a.clientY + b.clientY) / 2) - top,
    }
  }

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2) {
      const midpoint = getTouchMidpoint(event.touches)
      pinchRef.current = {
        active: true,
        lastDistance: getTouchDistance(event.touches),
        lastMidX: midpoint.x,
        lastMidY: midpoint.y,
      }
      touchPanRef.current.active = false
      return
    }

    if (event.touches.length === 1 && canPan) {
      const first = event.touches[0]
      touchPanRef.current = {
        active: true,
        lastX: first.clientX,
        lastY: first.clientY,
      }
    }
  }, [canPan])

  const handleTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (pinchRef.current.active && event.touches.length === 2) {
      event.preventDefault()
      const nextDistance = getTouchDistance(event.touches)
      if (!nextDistance || !pinchRef.current.lastDistance) return

      const midpoint = getTouchMidpoint(event.touches)
      const scaleFactor = nextDistance / pinchRef.current.lastDistance
      const targetScale = viewRef.current.scale * scaleFactor

      zoomAround(targetScale, midpoint.x, midpoint.y)

      const panDx = midpoint.x - pinchRef.current.lastMidX
      const panDy = midpoint.y - pinchRef.current.lastMidY

      syncView((prev) => clampView({
        scale: prev.scale,
        x: prev.x + panDx,
        y: prev.y + panDy,
      }))

      pinchRef.current.lastDistance = nextDistance
      pinchRef.current.lastMidX = midpoint.x
      pinchRef.current.lastMidY = midpoint.y
      return
    }

    if (touchPanRef.current.active && event.touches.length === 1) {
      event.preventDefault()
      const first = event.touches[0]
      const dx = first.clientX - touchPanRef.current.lastX
      const dy = first.clientY - touchPanRef.current.lastY

      syncView((prev) => clampView({
        scale: prev.scale,
        x: prev.x + dx,
        y: prev.y + dy,
      }))

      touchPanRef.current.lastX = first.clientX
      touchPanRef.current.lastY = first.clientY
    }
  }, [clampView, syncView, zoomAround])

  const handleTouchEnd = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length < 2) {
      pinchRef.current.active = false
    }

    if (event.touches.length === 0) {
      touchPanRef.current.active = false
    }
  }, [])

  const zoomIn = useCallback(() => {
    const frame = containerSizeRef.current
    zoomAround(viewRef.current.scale * 1.2, frame.width / 2, frame.height / 2)
  }, [zoomAround])

  const zoomOut = useCallback(() => {
    const frame = containerSizeRef.current
    zoomAround(viewRef.current.scale * 0.84, frame.width / 2, frame.height / 2)
  }, [zoomAround])

  const resetView = useCallback(() => {
    syncView({ scale: 1, x: 0, y: 0 })
  }, [syncView])

  const safeTitle = String(title || '').trim() || 'Image viewer'

  if (!open) return null

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
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 px-4 pb-6 pt-[calc(0.9rem+var(--app-safe-top))] sm:px-5">
          <div className="min-w-0 max-w-[65vw]">
            <div className="truncate text-sm font-semibold text-white/88 sm:text-base">{safeTitle}</div>
          </div>
          <button
            type="button"
            className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-black/48 text-white shadow-[0_16px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl transition hover:bg-black/62"
            onClick={onClose}
            aria-label="Close image viewer"
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
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPointerDrag}
          onPointerCancel={endPointerDrag}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          style={{ touchAction: canPan ? 'none' : 'pan-y' }}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-32 bg-gradient-to-b from-black/55 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-32 bg-gradient-to-t from-black/72 to-transparent" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={imageUrl}
            alt={safeTitle}
            onLoad={handleImageLoad}
            draggable={false}
            className="absolute left-1/2 top-1/2 max-h-full max-w-full select-none"
            style={{
              transform: `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px)) scale(${view.scale})`,
              transformOrigin: 'center center',
              transition: dragRef.current.active || pinchRef.current.active ? 'none' : 'transform 120ms ease-out',
              cursor: canPan ? (dragRef.current.active ? 'grabbing' : 'grab') : 'zoom-in',
            }}
          />
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-[calc(1rem+var(--app-safe-bottom))] sm:px-5">
          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/52 px-2 py-2 text-white shadow-[0_16px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl">
            <button
              type="button"
              className="inline-flex h-10 min-w-10 items-center justify-center rounded-full bg-white/10 px-3 text-sm font-semibold transition hover:bg-white/16"
              onClick={zoomOut}
              aria-label="Zoom out"
            >
              -
            </button>
            <button
              type="button"
              className="inline-flex h-10 min-w-[4.5rem] items-center justify-center rounded-full bg-white/10 px-3 text-xs font-semibold tracking-[0.03em] transition hover:bg-white/16"
              onClick={resetView}
              aria-label="Reset zoom"
            >
              {uiScaleLabel}
            </button>
            <button
              type="button"
              className="inline-flex h-10 min-w-10 items-center justify-center rounded-full bg-white/10 px-3 text-sm font-semibold transition hover:bg-white/16"
              onClick={zoomIn}
              aria-label="Zoom in"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </FullScreenGlassOverlay>
  )
}
