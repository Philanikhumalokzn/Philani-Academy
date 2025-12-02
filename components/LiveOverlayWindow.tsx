import React, { ReactNode, useCallback, useEffect, useRef } from 'react'

type Point = { x: number; y: number }

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

type LiveOverlayWindowProps = {
  id: string
  title: string
  subtitle?: string
  position: Point
  size: { width: number; height: number }
  minimized: boolean
  zIndex: number
  bounds: { width: number; height: number }
  minSize?: { width: number; height: number }
  isResizable?: boolean
  onFocus: (id: string) => void
  onClose: (id: string) => void
  onToggleMinimize: (id: string) => void
  onPositionChange: (id: string, position: Point) => void
  onResize?: (id: string, payload: { width: number; height: number; position: Point }) => void
  children: ReactNode
}

export default function LiveOverlayWindow({
  id,
  title,
  subtitle,
  position,
  size,
  minimized,
  zIndex,
  bounds,
  minSize,
  isResizable = true,
  onFocus,
  onClose,
  onToggleMinimize,
  onPositionChange,
  onResize,
  children
}: LiveOverlayWindowProps) {
  const dragStateRef = useRef<{ offsetX: number; offsetY: number } | null>(null)
  const resizeStateRef = useRef<{
    direction: ResizeDirection
    startX: number
    startY: number
    startWidth: number
    startHeight: number
    startLeft: number
    startTop: number
  } | null>(null)

  const clampPosition = useCallback(
    (candidate: Point): Point => {
      const padding = 12
      const widthBase = Math.max(bounds.width, size.width + padding * 2)
      const heightBase = Math.max(bounds.height, (minimized ? 64 : size.height) + padding * 2)
      const maxX = Math.max(padding, widthBase - size.width - padding)
      const maxY = Math.max(padding, heightBase - (minimized ? 64 : size.height) - padding)
      return {
        x: Math.min(Math.max(candidate.x, padding), maxX),
        y: Math.min(Math.max(candidate.y, padding), maxY)
      }
    },
    [bounds.height, bounds.width, minimized, size.height, size.width]
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const state = dragStateRef.current
      if (!state) return
      event.preventDefault()
      const next = clampPosition({
        x: event.clientX - state.offsetX,
        y: event.clientY - state.offsetY
      })
      onPositionChange(id, next)
    },
    [clampPosition, id, onPositionChange]
  )

  const stopDragging = useCallback(() => {
    dragStateRef.current = null
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopDragging)
    }
  }, [handlePointerMove])

  const handleDragStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      onFocus(id)
      dragStateRef.current = {
        offsetX: event.clientX - position.x,
        offsetY: event.clientY - position.y
      }
      if (typeof window !== 'undefined') {
        window.addEventListener('pointermove', handlePointerMove)
        window.addEventListener('pointerup', stopDragging)
      }
    },
    [handlePointerMove, id, onFocus, position.x, position.y, stopDragging]
  )

  const clampRect = useCallback(
    (rect: { left: number; top: number; width: number; height: number }) => {
      const padding = 12
      const minWidth = minSize?.width ?? 360
      const minHeight = minSize?.height ?? 300
      const widthBase = Math.max(bounds.width, minWidth + padding * 2)
      const heightBase = Math.max(bounds.height, minHeight + padding * 2)
      let nextWidth = Math.max(minWidth, rect.width)
      let nextHeight = Math.max(minHeight, rect.height)
      let nextLeft = rect.left
      let nextTop = rect.top

      nextLeft = Math.min(Math.max(nextLeft, padding), widthBase - nextWidth - padding)
      nextTop = Math.min(Math.max(nextTop, padding), heightBase - nextHeight - padding)
      nextWidth = Math.min(nextWidth, widthBase - nextLeft - padding)
      nextHeight = Math.min(nextHeight, heightBase - nextTop - padding)

      return { left: nextLeft, top: nextTop, width: nextWidth, height: nextHeight }
    },
    [bounds.height, bounds.width, minSize?.height, minSize?.width]
  )

  const handleResizeMove = useCallback(
    (event: PointerEvent) => {
      const state = resizeStateRef.current
      if (!state || !onResize) return
      event.preventDefault()
      const dx = event.clientX - state.startX
      const dy = event.clientY - state.startY
      let nextWidth = state.startWidth
      let nextHeight = state.startHeight
      let nextLeft = state.startLeft
      let nextTop = state.startTop

      const dir = state.direction
      if (dir.includes('e')) {
        nextWidth = state.startWidth + dx
      }
      if (dir.includes('s')) {
        nextHeight = state.startHeight + dy
      }
      if (dir.includes('w')) {
        nextWidth = state.startWidth - dx
        nextLeft = state.startLeft + dx
      }
      if (dir.includes('n')) {
        nextHeight = state.startHeight - dy
        nextTop = state.startTop + dy
      }

      const clamped = clampRect({ left: nextLeft, top: nextTop, width: nextWidth, height: nextHeight })
      onResize(id, {
        width: clamped.width,
        height: clamped.height,
        position: { x: clamped.left, y: clamped.top }
      })
    },
    [clampRect, id, onResize]
  )

  const stopResize = useCallback(() => {
    resizeStateRef.current = null
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', handleResizeMove)
      window.removeEventListener('pointerup', stopResize)
    }
  }, [handleResizeMove])

  const handleResizeStart = useCallback(
    (direction: ResizeDirection, event: React.PointerEvent<HTMLButtonElement | HTMLDivElement>) => {
      if (!isResizable || minimized) return
      if (!onResize) return
      event.preventDefault()
      event.stopPropagation()
      onFocus(id)
      resizeStateRef.current = {
        direction,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: size.width,
        startHeight: size.height,
        startLeft: position.x,
        startTop: position.y
      }
      if (typeof window !== 'undefined') {
        window.addEventListener('pointermove', handleResizeMove)
        window.addEventListener('pointerup', stopResize)
      }
    },
    [handleResizeMove, id, isResizable, minimized, onFocus, onResize, position.x, position.y, size.height, size.width, stopResize]
  )

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', stopDragging)
        window.removeEventListener('pointermove', handleResizeMove)
        window.removeEventListener('pointerup', stopResize)
      }
    }
  }, [handlePointerMove, stopDragging, handleResizeMove, stopResize])

  return (
    <div
      className={`live-window${minimized ? ' live-window--minimized' : ''}`}
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: minimized ? 64 : size.height,
        zIndex
      }}
      onPointerDown={() => onFocus(id)}
    >
      <div className="live-window__header" onPointerDown={handleDragStart}>
        <div>
          {subtitle && <p className="live-window__eyebrow">{subtitle}</p>}
          <p className="live-window__title">{title}</p>
        </div>
        <div className="live-window__header-controls">
          <button
            type="button"
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation()
              onToggleMinimize(id)
            }}
            aria-label={minimized ? 'Restore window' : 'Minimize window'}
          >
            {minimized ? '▢' : '—'}
          </button>
          <button
            type="button"
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation()
              onClose(id)
            }}
            aria-label="Close window"
          >
            ×
          </button>
        </div>
      </div>
      <div
        className="live-window__body"
        style={{
          height: minimized ? 0 : size.height - 56,
          visibility: minimized ? 'hidden' : 'visible',
          pointerEvents: minimized ? 'none' : 'auto'
        }}
      >
        {children}
      </div>
      {isResizable && !minimized && onResize && (
        <>
          {['n','s','e','w','ne','nw','se','sw'].map(direction => (
            <button
              key={direction}
              type="button"
              className={`live-window__resize-handle live-window__resize-handle--${direction}`}
              aria-label={`Resize window ${direction}`}
              onPointerDown={event => handleResizeStart(direction as ResizeDirection, event)}
            />
          ))}
        </>
      )}
    </div>
  )
}
