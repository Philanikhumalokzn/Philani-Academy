import { PointerEvent as ReactPointerEvent, RefObject, useCallback, useEffect, useRef, useState } from 'react'
import JitsiRoom, { JitsiControls, JitsiMuteState } from './JitsiRoom'

const MIN_WIDTH = 280
const MIN_HEIGHT = 180
const MAX_WIDTH = 640
const MAX_HEIGHT = 520
const MINIMIZED_WIDTH = 220
const MINIMIZED_HEIGHT = 56
const EDGE_PADDING = 12

const clamp = (value: number, min: number, max: number) => {
  if (Number.isNaN(value)) return min
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

type FloatingJitsiWindowProps = {
  roomName: string
  displayName?: string
  tokenEndpoint?: string | null
  isOwner?: boolean
  gradeLabel?: string
  boundsRef: RefObject<HTMLElement>
  visible?: boolean
  silentJoin?: boolean
  onControlsChange?: (controls: JitsiControls | null) => void
  onMuteStateChange?: (state: JitsiMuteState) => void
  toolbarButtons?: string[]
  startWithAudioMuted?: boolean
  startWithVideoMuted?: boolean
}

export default function FloatingJitsiWindow({ roomName, displayName, tokenEndpoint, isOwner, gradeLabel, boundsRef, visible = true, silentJoin = false, onControlsChange, onMuteStateChange, toolbarButtons, startWithAudioMuted, startWithVideoMuted }: FloatingJitsiWindowProps) {
  const [position, setPosition] = useState({ x: 24, y: 24 })
  const [size, setSize] = useState({ width: 360, height: 240 })
  const [isMinimized, setIsMinimized] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const dragStateRef = useRef<{ offsetX: number; offsetY: number } | null>(null)
  const resizeStateRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null)
  const hasSnappedRef = useRef(false)

  const getBounds = useCallback(() => {
    const bounds = boundsRef.current?.getBoundingClientRect()
    if (bounds) return bounds
    if (typeof window === 'undefined') return null
    return {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
      right: window.innerWidth,
      bottom: window.innerHeight,
      x: 0,
      y: 0,
      toJSON: () => null,
    } as DOMRect
  }, [boundsRef])

  const getCurrentDimensions = useCallback(() => ({
    width: isMinimized ? MINIMIZED_WIDTH : size.width,
    height: isMinimized ? MINIMIZED_HEIGHT : size.height,
  }), [isMinimized, size.height, size.width])

  const ensureWithinBounds = useCallback(() => {
    const bounds = getBounds()
    if (!bounds) return
    const { width, height } = getCurrentDimensions()
    const maxX = Math.max(EDGE_PADDING, bounds.width - width - EDGE_PADDING)
    const maxY = Math.max(EDGE_PADDING, bounds.height - height - EDGE_PADDING)
    setPosition(prev => ({
      x: clamp(prev.x, EDGE_PADDING, maxX),
      y: clamp(prev.y, EDGE_PADDING, maxY),
    }))
  }, [getBounds, getCurrentDimensions])

  useEffect(() => {
    ensureWithinBounds()
    if (typeof window === 'undefined') return
    const handleResize = () => ensureWithinBounds()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [ensureWithinBounds])

  useEffect(() => {
    if (hasSnappedRef.current) return
    const bounds = getBounds()
    if (!bounds) return
    const { width } = getCurrentDimensions()
    const x = Math.max(EDGE_PADDING, bounds.width - width - EDGE_PADDING)
    setPosition({ x, y: EDGE_PADDING })
    hasSnappedRef.current = true
  }, [getBounds, getCurrentDimensions])

  const handleDragMove = useCallback((event: PointerEvent) => {
    if (!dragStateRef.current) return
    const bounds = getBounds()
    if (!bounds) return
    const { width, height } = getCurrentDimensions()
    const rawX = event.clientX - bounds.left - dragStateRef.current.offsetX
    const rawY = event.clientY - bounds.top - dragStateRef.current.offsetY
    const maxX = Math.max(EDGE_PADDING, bounds.width - width - EDGE_PADDING)
    const maxY = Math.max(EDGE_PADDING, bounds.height - height - EDGE_PADDING)
    setPosition({
      x: clamp(rawX, EDGE_PADDING, maxX),
      y: clamp(rawY, EDGE_PADDING, maxY),
    })
  }, [getBounds, getCurrentDimensions])

  const stopDragging = useCallback(function stopDraggingInternal() {
    dragStateRef.current = null
    setIsDragging(false)
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', handleDragMove)
      window.removeEventListener('pointerup', stopDraggingInternal)
    }
  }, [handleDragMove])

  const handleDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const bounds = getBounds()
    if (!bounds) return
    const offsetX = event.clientX - bounds.left - position.x
    const offsetY = event.clientY - bounds.top - position.y
    dragStateRef.current = { offsetX, offsetY }
    setIsDragging(true)
    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', handleDragMove)
      window.addEventListener('pointerup', stopDragging)
    }
  }

  const handleResizeMove = useCallback((event: PointerEvent) => {
    if (!resizeStateRef.current) return
    const bounds = getBounds()
    if (!bounds) return
    const deltaX = event.clientX - resizeStateRef.current.startX
    const deltaY = event.clientY - resizeStateRef.current.startY
    let nextWidth = clamp(resizeStateRef.current.width + deltaX, MIN_WIDTH, MAX_WIDTH)
    let nextHeight = clamp(resizeStateRef.current.height + deltaY, MIN_HEIGHT, MAX_HEIGHT)
    const maxWidth = Math.max(MIN_WIDTH, bounds.width - position.x - EDGE_PADDING)
    const maxHeight = Math.max(MIN_HEIGHT, bounds.height - position.y - EDGE_PADDING)
    nextWidth = clamp(nextWidth, MIN_WIDTH, maxWidth)
    nextHeight = clamp(nextHeight, MIN_HEIGHT, maxHeight)
    setSize({ width: nextWidth, height: nextHeight })
  }, [getBounds, position.x, position.y])

  const stopResize = useCallback(function stopResizeInternal() {
    resizeStateRef.current = null
    setIsResizing(false)
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', handleResizeMove)
      window.removeEventListener('pointerup', stopResizeInternal)
    }
  }, [handleResizeMove])

  const handleResizeStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const bounds = getBounds()
    if (!bounds) return
    resizeStateRef.current = { startX: event.clientX, startY: event.clientY, width: size.width, height: size.height }
    setIsResizing(true)
    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', handleResizeMove)
      window.addEventListener('pointerup', stopResize)
    }
  }

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointermove', handleDragMove)
        window.removeEventListener('pointerup', stopDragging)
        window.removeEventListener('pointermove', handleResizeMove)
        window.removeEventListener('pointerup', stopResize)
      }
    }
  }, [handleDragMove, stopDragging, handleResizeMove, stopResize])

  const toggleMinimize = () => setIsMinimized(prev => !prev)

  if (!roomName) return null

  // Hidden mode: keep the JaaS meeting connected (audio/mic) without showing any overlay.
  // We intentionally do NOT use `display:none` so the iframe can keep streaming audio.
  if (!visible) {
    return (
      <div
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', top: '-9999px', width: 1, height: 1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}
      >
        <JitsiRoom
          roomName={roomName}
          displayName={displayName}
          tokenEndpoint={tokenEndpoint}
          isOwner={isOwner}
          silentJoin={silentJoin}
          showControls={false}
          height={1}
          toolbarButtons={toolbarButtons}
          startWithAudioMuted={startWithAudioMuted}
          startWithVideoMuted={startWithVideoMuted}
          onControlsChange={onControlsChange}
          onMuteStateChange={onMuteStateChange}
        />
      </div>
    )
  }

  const currentWidth = isMinimized ? MINIMIZED_WIDTH : size.width
  const currentHeight = isMinimized ? MINIMIZED_HEIGHT : size.height

  return (
    <div
      className={`floating-video-window${isMinimized ? ' floating-video-window--minimized' : ''}${isDragging ? ' is-dragging' : ''}${isResizing ? ' is-resizing' : ''}`}
      style={{ width: currentWidth, height: currentHeight, left: position.x, top: position.y }}
    >
      <div className="floating-video-window__header" onPointerDown={handleDragStart} role="presentation">
        <div className="floating-video-window__heading">
          <p className="floating-video-window__eyebrow">Live JaaS</p>
          <p className="floating-video-window__title">{gradeLabel || 'Shared room'}</p>
        </div>
        <div className="floating-video-window__header-controls">
          <button type="button" className="floating-video-window__icon" onClick={toggleMinimize} aria-label={isMinimized ? 'Expand video call' : 'Minimize video call'}>
            {isMinimized ? '■' : '—'}
          </button>
        </div>
      </div>
      {!isMinimized && (
        <div className="floating-video-window__body">
          <JitsiRoom
            roomName={roomName}
            displayName={displayName}
            tokenEndpoint={tokenEndpoint}
            isOwner={isOwner}
            silentJoin={silentJoin}
            showControls={false}
            height="100%"
            className="floating-video-window__jitsi"
            toolbarButtons={toolbarButtons}
            startWithAudioMuted={startWithAudioMuted}
            startWithVideoMuted={startWithVideoMuted}
            onControlsChange={onControlsChange}
            onMuteStateChange={onMuteStateChange}
          />
        </div>
      )}
      {!isMinimized && (
        <button
          type="button"
          className="floating-video-window__resize-handle"
          aria-label="Resize video call"
          onPointerDown={handleResizeStart}
        />
      )}
    </div>
  )
}
