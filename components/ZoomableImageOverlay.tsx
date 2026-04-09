import React, { useCallback, useEffect, useRef, useState } from 'react'
import BottomSheet from './BottomSheet'
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
  const touchStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const pinchRef = useRef<{ active: boolean; lastDistance: number; lastMidX: number; lastMidY: number }>({
    active: false,
    lastDistance: 0,
    lastMidX: 0,
    lastMidY: 0,
  })
  const interactionMovedRef = useRef(false)

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
    touchStartRef.current = { x: 0, y: 0 }
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
  const [chromeVisible, setChromeVisible] = useState(true)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)

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
    interactionMovedRef.current = false
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
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) interactionMovedRef.current = true

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
    interactionMovedRef.current = false
    if (event.touches.length === 2) {
      const midpoint = getTouchMidpoint(event.touches)
      interactionMovedRef.current = true
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
      touchStartRef.current = { x: first.clientX, y: first.clientY }
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
      interactionMovedRef.current = true
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
      if (Math.abs(first.clientX - touchStartRef.current.x) > 6 || Math.abs(first.clientY - touchStartRef.current.y) > 6) {
        interactionMovedRef.current = true
      }

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

  const resetView = useCallback(() => {
    syncView({ scale: 1, x: 0, y: 0 })
  }, [syncView])

  const safeTitle = String(title || '').trim() || 'Image viewer'

  useEffect(() => {
    if (!open) return
    setChromeVisible(true)
    setOptionsOpen(false)
    setSaveBusy(false)
    interactionMovedRef.current = false
  }, [open, imageUrl])

  const triggerBrowserDownload = useCallback((href: string, filename: string) => {
    if (typeof document === 'undefined') return
    const link = document.createElement('a')
    link.href = href
    link.download = filename
    link.rel = 'noopener'
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }, [])

  const deriveDownloadName = useCallback(() => {
    if (typeof window === 'undefined') return 'philani-image'
    try {
      const parsed = new URL(imageUrl, window.location.href)
      const lastSegment = parsed.pathname.split('/').filter(Boolean).pop() || 'philani-image'
      const decoded = decodeURIComponent(lastSegment)
      return decoded.includes('.') ? decoded : `${decoded}.jpg`
    } catch {
      return 'philani-image.jpg'
    }
  }, [imageUrl])

  const handleSaveToPhone = useCallback(async () => {
    if (saveBusy) return
    setSaveBusy(true)
    setOptionsOpen(false)
    try {
      const filename = deriveDownloadName()
      const response = await fetch(imageUrl)
      if (!response.ok) throw new Error(`Unable to save image (${response.status})`)
      const blob = await response.blob()
      const objectUrl = window.URL.createObjectURL(blob)
      triggerBrowserDownload(objectUrl, filename)
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1200)
    } catch {
      try {
        triggerBrowserDownload(imageUrl, deriveDownloadName())
      } catch (error: any) {
        alert(error?.message || 'Unable to save this image right now.')
      }
    } finally {
      setSaveBusy(false)
    }
  }, [deriveDownloadName, imageUrl, saveBusy, triggerBrowserDownload])

  const handleCopyImageLink = useCallback(async () => {
    setOptionsOpen(false)
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(imageUrl)
        alert('Image link copied')
        return
      }
      if (typeof window !== 'undefined') {
        window.prompt('Copy this image link', imageUrl)
      }
    } catch (error: any) {
      alert(error?.message || 'Unable to copy image link.')
    }
  }, [imageUrl])

  const handleShareImage = useCallback(async () => {
    setOptionsOpen(false)
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title: safeTitle, url: imageUrl })
        return
      }
      await handleCopyImageLink()
    } catch (error: any) {
      if (error?.name === 'AbortError') return
      alert(error?.message || 'Unable to share this image.')
    }
  }, [handleCopyImageLink, imageUrl, safeTitle])

  const handleResetZoom = useCallback(() => {
    setOptionsOpen(false)
    resetView()
  }, [resetView])

  const handleViewportClick = useCallback(() => {
    if (optionsOpen) return
    if (interactionMovedRef.current) {
      interactionMovedRef.current = false
      return
    }
    setChromeVisible((prev) => !prev)
  }, [optionsOpen])

  if (!open) return null

  return (
    <>
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
          <div className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-32 bg-gradient-to-b from-black/55 to-transparent transition-opacity duration-200 ${chromeVisible ? 'opacity-100' : 'opacity-0'}`} />

          <div className={`absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 px-4 pb-6 pt-[calc(0.9rem+var(--app-safe-top))] transition-opacity duration-200 sm:px-5 ${chromeVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center bg-transparent text-white/92 transition hover:text-white"
              onClick={(event) => {
                event.stopPropagation()
                setChromeVisible(true)
                setOptionsOpen(true)
              }}
              aria-label="Image options"
              title="Image options"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
                <circle cx="10" cy="4.5" r="1.6" />
                <circle cx="10" cy="10" r="1.6" />
                <circle cx="10" cy="15.5" r="1.6" />
              </svg>
            </button>

            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center bg-transparent text-white/92 transition hover:text-white"
              onClick={(event) => {
                event.stopPropagation()
                onClose()
              }}
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
            onClick={handleViewportClick}
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
        </div>
      </FullScreenGlassOverlay>

      <BottomSheet
        open={optionsOpen}
        backdrop
        title="Image options"
        subtitle="Save or manage this image"
        onClose={() => setOptionsOpen(false)}
        zIndexClassName="z-[96]"
        className="bottom-0"
        sheetClassName="rounded-t-[28px] rounded-b-none border-x-0 border-b-0 border-t border-slate-200 bg-white shadow-[0_-18px_40px_rgba(15,23,42,0.14)]"
        contentClassName="px-4 pb-[calc(var(--app-safe-bottom)+1rem)] pt-2 sm:px-5 sm:pb-5"
      >
        <div className="space-y-2">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left text-slate-800 transition hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void handleSaveToPhone()}
            disabled={saveBusy}
          >
            <span>
              <span className="block text-sm font-semibold">{saveBusy ? 'Saving…' : 'Save to phone'}</span>
              <span className="block text-xs text-slate-500">Download this image to your device.</span>
            </span>
            <span className="text-slate-400">{'>'}</span>
          </button>

          {typeof navigator !== 'undefined' && typeof navigator.share === 'function' ? (
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left text-slate-800 transition hover:border-slate-300 hover:bg-slate-100"
              onClick={() => void handleShareImage()}
            >
              <span>
                <span className="block text-sm font-semibold">Share image</span>
                <span className="block text-xs text-slate-500">Send this image link to another app.</span>
              </span>
              <span className="text-slate-400">{'>'}</span>
            </button>
          ) : null}

          <button
            type="button"
            className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left text-slate-800 transition hover:border-slate-300 hover:bg-slate-100"
            onClick={() => void handleCopyImageLink()}
          >
            <span>
              <span className="block text-sm font-semibold">Copy image link</span>
              <span className="block text-xs text-slate-500">Keep a link to this image on your clipboard.</span>
            </span>
            <span className="text-slate-400">{'>'}</span>
          </button>

          <button
            type="button"
            className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left text-slate-800 transition hover:border-slate-300 hover:bg-slate-100"
            onClick={handleResetZoom}
          >
            <span>
              <span className="block text-sm font-semibold">Reset zoom</span>
              <span className="block text-xs text-slate-500">Return the image to its centered default view.</span>
            </span>
            <span className="text-slate-400">{'>'}</span>
          </button>
        </div>
      </BottomSheet>
    </>
  )
}
