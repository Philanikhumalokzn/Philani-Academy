import React, { ReactNode, useCallback, useEffect, useRef } from 'react'

type Point = { x: number; y: number }

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const HORIZONTAL_PADDING = 0
const VERTICAL_PADDING = 4

type LiveOverlayWindowProps = {
  id: string
  title: string
  subtitle?: string
  className?: string
  onRequestVideoOverlay?: () => void
  onToggleTeacherAudio?: () => void
  teacherAudioEnabled?: boolean
  onToggleStudentMic?: () => void
  studentMicMuted?: boolean
  position: Point
  size: { width: number; height: number }
  minimized: boolean
  zIndex: number
  bounds: { width: number; height: number }
  minSize?: { width: number; height: number }
  isResizable?: boolean
  isFullscreen?: boolean
  onFocus: (id: string) => void
  onClose: (id: string) => void
  onToggleMinimize: (id: string) => void
  onRequestFullscreen?: (id: string) => void
  onPositionChange: (id: string, position: Point) => void
  onResize?: (id: string, payload: { width: number; height: number; position: Point }) => void
  onCloseOverlay?: () => void
  children: ReactNode
}

export default function LiveOverlayWindow({
  id,
  title,
  subtitle,
  className,
  onRequestVideoOverlay,
  onToggleTeacherAudio,
  teacherAudioEnabled,
  onToggleStudentMic,
  studentMicMuted,
  position,
  size,
  minimized,
  zIndex,
  bounds,
  minSize,
  isResizable = true,
  isFullscreen = false,
  onFocus,
  onClose,
  onToggleMinimize,
  onRequestFullscreen,
  onPositionChange,
  onResize,
  onCloseOverlay,
  children
}: LiveOverlayWindowProps) {
  const isCanvasWindow = Boolean(className?.includes('live-window--canvas'))
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
      const widthBase = Math.max(bounds.width, size.width + HORIZONTAL_PADDING * 2)
      const heightBase = Math.max(bounds.height, (minimized ? 48 : size.height) + VERTICAL_PADDING * 2)
      const maxX = Math.max(HORIZONTAL_PADDING, widthBase - size.width - HORIZONTAL_PADDING)
      const maxY = Math.max(VERTICAL_PADDING, heightBase - (minimized ? 64 : size.height) - VERTICAL_PADDING)
      return {
        x: Math.min(Math.max(candidate.x, HORIZONTAL_PADDING), maxX),
        y: Math.min(Math.max(candidate.y, VERTICAL_PADDING), maxY)
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
      if (isFullscreen) return
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
    [handlePointerMove, id, isFullscreen, onFocus, position.x, position.y, stopDragging]
  )

  const clampRect = useCallback(
    (rect: { left: number; top: number; width: number; height: number }) => {
      const minWidth = minSize?.width ?? 720
      const minHeight = minSize?.height ?? 640
      const widthBase = Math.max(bounds.width, minWidth + HORIZONTAL_PADDING * 2)
      const heightBase = Math.max(bounds.height, minHeight + VERTICAL_PADDING * 2)
      let nextWidth = Math.max(minWidth, rect.width)
      let nextHeight = Math.max(minHeight, rect.height)
      let nextLeft = rect.left
      let nextTop = rect.top

      nextLeft = Math.min(Math.max(nextLeft, HORIZONTAL_PADDING), widthBase - nextWidth - HORIZONTAL_PADDING)
      nextTop = Math.min(Math.max(nextTop, VERTICAL_PADDING), heightBase - nextHeight - VERTICAL_PADDING)
      nextWidth = Math.min(nextWidth, widthBase - nextLeft - HORIZONTAL_PADDING)
      nextHeight = Math.min(nextHeight, heightBase - nextTop - VERTICAL_PADDING)

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
      if (!isResizable || minimized || isFullscreen) return
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
      className={`live-window${minimized ? ' live-window--minimized' : ''}${isFullscreen ? ' live-window--fullscreen' : ''}${className ? ` ${className}` : ''}`}
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: minimized ? 64 : size.height,
        zIndex
      }}
      onPointerDown={() => onFocus(id)}
    >
      <div
        className="live-window__header"
        style={{ cursor: isFullscreen ? 'default' : 'grab' }}
        onPointerDown={event => {
          if (isFullscreen) {
            onFocus(id)
            return
          }
          handleDragStart(event)
        }}
      >
        <div>
          {subtitle && <p className="live-window__eyebrow">{subtitle}</p>}
          <p className="live-window__title">{title}</p>
        </div>

        {isCanvasWindow && (
          <div className="live-window__header-controls" onPointerDown={e => e.stopPropagation()}>
            {typeof onToggleTeacherAudio === 'function' && (
              <button
                type="button"
                title={teacherAudioEnabled ? 'Mute teacher audio' : 'Unmute teacher audio'}
                aria-label={teacherAudioEnabled ? 'Stop listening to teacher audio' : 'Listen to teacher audio'}
                onPointerDown={e => e.stopPropagation()}
                onClick={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  try {
                    onToggleTeacherAudio()
                  } catch {}
                }}
              >
                <span className="sr-only">Teacher audio</span>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                  <path d="M3 10v4a2 2 0 0 0 2 2h2.1l4.4 3.3A1 1 0 0 0 13 18.8V5.2a1 1 0 0 0-1.6-.8L7.1 8H5a2 2 0 0 0-2 2z" />
                  <path d="M16.5 8.2a1 1 0 0 1 1.4 0A6 6 0 0 1 20 12a6 6 0 0 1-2.1 3.8 1 1 0 1 1-1.3-1.5A4 4 0 0 0 18 12a4 4 0 0 0-1.5-2.3 1 1 0 0 1 0-1.5z" opacity="0.65" />
                  {teacherAudioEnabled === false && (
                    <path d="M4 3.3a1 1 0 0 1 1.4 0l15.3 15.3a1 1 0 1 1-1.4 1.4L4 4.7a1 1 0 0 1 0-1.4z" />
                  )}
                </svg>
              </button>
            )}

            {typeof onToggleStudentMic === 'function' && (
              <button
                type="button"
                title={studentMicMuted ? 'Unmute your microphone' : 'Mute your microphone'}
                aria-label={studentMicMuted ? 'Unmute your microphone' : 'Mute your microphone'}
                onPointerDown={e => e.stopPropagation()}
                onClick={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  try {
                    onToggleStudentMic()
                  } catch {}
                }}
              >
                <span className="sr-only">Your microphone</span>
                {studentMicMuted ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                    <path d="M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0V6z" opacity="0.65" />
                    <path d="M5 11a1 1 0 1 1 2 0 5 5 0 0 0 8.5 3.5 1 1 0 1 1 1.4 1.4A7 7 0 0 1 13 17.92V20h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.08A7 7 0 0 1 5 11z" />
                    <path d="M4 3.3a1 1 0 0 1 1.4 0l15.3 15.3a1 1 0 1 1-1.4 1.4L4 4.7a1 1 0 0 1 0-1.4z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                    <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
                    <path d="M7 11a1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.08A7 7 0 0 0 19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0z" opacity="0.65" />
                  </svg>
                )}
              </button>
            )}

            {typeof onRequestVideoOverlay === 'function' && (
              <button
                type="button"
                title="Video"
                aria-label="Open live video"
                onPointerDown={e => e.stopPropagation()}
                onClick={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  try {
                    onRequestVideoOverlay()
                  } catch {}
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M4 7a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7z" />
                  <path d="M16 10.5 21 7v10l-5-3.5v-3z" opacity="0.65" />
                </svg>
              </button>
            )}

            <button
              type="button"
              title="Close canvas"
              aria-label="Close canvas"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                try {
                  onClose(id)
                } catch {}
              }}
            >
              ×
            </button>
          </div>
        )}
      </div>
      <div
        className="live-window__body"
        style={{
          height: minimized
            ? 0
            : className?.includes('live-window--canvas')
            ? size.height
            : size.height - 56,
          visibility: minimized ? 'hidden' : 'visible',
          pointerEvents: minimized ? 'none' : 'auto',
          padding: className?.includes('live-window--canvas') ? 0 : undefined,
        }}
      >
        {children}
      </div>
      {isResizable && !minimized && !isFullscreen && onResize && (
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
