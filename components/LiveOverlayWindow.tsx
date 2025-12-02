import React, { ReactNode, useCallback, useEffect, useRef } from 'react'

type Point = { x: number; y: number }

type LiveOverlayWindowProps = {
  id: string
  title: string
  subtitle?: string
  position: Point
  size: { width: number; height: number }
  minimized: boolean
  zIndex: number
  bounds: { width: number; height: number }
  onFocus: (id: string) => void
  onClose: (id: string) => void
  onToggleMinimize: (id: string) => void
  onPositionChange: (id: string, position: Point) => void
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
  onFocus,
  onClose,
  onToggleMinimize,
  onPositionChange,
  children
}: LiveOverlayWindowProps) {
  const dragStateRef = useRef<{ offsetX: number; offsetY: number } | null>(null)

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

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', stopDragging)
      }
    }
  }, [handlePointerMove, stopDragging])

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
          <button type="button" onClick={() => onToggleMinimize(id)} aria-label={minimized ? 'Restore window' : 'Minimize window'}>
            {minimized ? '▢' : '—'}
          </button>
          <button type="button" onClick={() => onClose(id)} aria-label="Close window">
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
    </div>
  )
}
