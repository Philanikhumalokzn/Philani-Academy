import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FullScreenGlassOverlay from './FullScreenGlassOverlay'

type InkPoint = { x: number; y: number }

type InkStroke = {
  id: string
  color: string
  width: number
  points: InkPoint[]
}

type NonRecognitionCanvasOverlayProps = {
  open: boolean
  onClose: () => void
  isCompactViewport: boolean
}

type StrokeTrackState = {
  active: boolean
  lastX: number
  minX: number
  maxX: number
  leftPanArmed: boolean
}

const DEFAULT_INK_COLOR = '#0f172a'
const DEFAULT_INK_WIDTH = 2.6

export default function NonRecognitionCanvasOverlay({ open, onClose, isCompactViewport }: NonRecognitionCanvasOverlayProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const strokesRef = useRef<InkStroke[]>([])
  const currentStrokeRef = useRef<InkStroke | null>(null)
  const drawingRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)
  const strokeTrackRef = useRef<StrokeTrackState>({ active: false, lastX: 0, minX: 0, maxX: 0, leftPanArmed: false })
  const leftPanPendingDxRef = useRef(0)
  const leftPanRafRef = useRef<number | null>(null)
  const autoPanAnimRef = useRef<number | null>(null)
  const redrawRafRef = useRef<number | null>(null)
  const surfaceSizeRef = useRef({ width: 1, height: 1 })
  const dprRef = useRef(1)
  const [surfaceSize, setSurfaceSize] = useState({ width: 1, height: 1 })

  const surfaceStyle = useMemo(() => {
    return {
      width: `${surfaceSize.width}px`,
      height: `${surfaceSize.height}px`,
      backgroundColor: '#ffffff',
      backgroundImage: 'linear-gradient(#e2e8f0 1px, transparent 1px), linear-gradient(90deg, #e2e8f0 1px, transparent 1px)',
      backgroundSize: '24px 24px',
    }
  }, [surfaceSize.height, surfaceSize.width])

  const getCanvasContext = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    return ctx
  }, [])

  const toCanvasPx = useCallback((point: InkPoint) => {
    const { width, height } = surfaceSizeRef.current
    return {
      x: point.x * width,
      y: point.y * height,
    }
  }, [])

  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = getCanvasContext()
    if (!canvas || !ctx) return

    const dpr = dprRef.current || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const drawStroke = (stroke: InkStroke) => {
      if (stroke.points.length === 0) return
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = stroke.width
      ctx.beginPath()
      const first = toCanvasPx(stroke.points[0])
      ctx.moveTo(first.x, first.y)
      for (let i = 1; i < stroke.points.length; i += 1) {
        const next = toCanvasPx(stroke.points[i])
        ctx.lineTo(next.x, next.y)
      }
      ctx.stroke()
    }

    strokesRef.current.forEach(drawStroke)
    if (currentStrokeRef.current) {
      drawStroke(currentStrokeRef.current)
    }
  }, [getCanvasContext, toCanvasPx])

  const requestRedraw = useCallback(() => {
    if (typeof window === 'undefined') {
      redrawAll()
      return
    }
    if (redrawRafRef.current) return
    redrawRafRef.current = window.requestAnimationFrame(() => {
      redrawRafRef.current = null
      redrawAll()
    })
  }, [redrawAll])

  const resizeSurface = useCallback(() => {
    const viewport = viewportRef.current
    const canvas = canvasRef.current
    if (!viewport || !canvas) return

    const width = Math.max(1, viewport.clientWidth)
    const height = Math.max(1, viewport.clientHeight)
    const horizontalFactor = isCompactViewport ? 12 : 3
    const verticalFactor = 2

    const nextWidth = Math.max(1, Math.round(width * horizontalFactor))
    const nextHeight = Math.max(1, Math.round(height * verticalFactor))

    surfaceSizeRef.current = { width: nextWidth, height: nextHeight }
    setSurfaceSize({ width: nextWidth, height: nextHeight })

    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1
    dprRef.current = dpr
    canvas.width = Math.round(nextWidth * dpr)
    canvas.height = Math.round(nextHeight * dpr)
    canvas.style.width = `${nextWidth}px`
    canvas.style.height = `${nextHeight}px`

    requestRedraw()
  }, [isCompactViewport, requestRedraw])

  useEffect(() => {
    if (!open) return
    resizeSurface()
  }, [open, resizeSurface])

  useEffect(() => {
    if (!open) return
    const viewport = viewportRef.current
    if (!viewport || typeof window === 'undefined') return

    const observer = new ResizeObserver(() => resizeSurface())
    observer.observe(viewport)

    return () => {
      try {
        observer.disconnect()
      } catch {}
    }
  }, [open, resizeSurface])

  const getStrokePoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const { width, height } = surfaceSizeRef.current
    const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width))
    const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height))
    return {
      x: width > 0 ? x / width : 0,
      y: height > 0 ? y / height : 0,
    }
  }, [])

  const smoothScrollViewportBy = useCallback((delta: number) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    if (max <= 0) return

    const startLeft = viewport.scrollLeft
    const targetLeft = Math.max(0, Math.min(startLeft + delta, max))
    const total = targetLeft - startLeft
    if (Math.abs(total) < 1) return

    if (typeof window === 'undefined') {
      viewport.scrollLeft = targetLeft
      return
    }

    if (autoPanAnimRef.current) {
      try {
        window.cancelAnimationFrame(autoPanAnimRef.current)
      } catch {}
      autoPanAnimRef.current = null
    }

    const durationMs = 220
    const startTs = window.performance?.now?.() ?? Date.now()
    const ease = (t: number) => 1 - Math.pow(1 - t, 3)

    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - startTs) / durationMs))
      viewport.scrollLeft = startLeft + total * ease(t)
      if (t < 1) {
        autoPanAnimRef.current = window.requestAnimationFrame(step)
      } else {
        autoPanAnimRef.current = null
      }
    }

    autoPanAnimRef.current = window.requestAnimationFrame(step)
  }, [])

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return
    const point = getStrokePoint(event)
    if (!point) return

    drawingRef.current = true
    pointerIdRef.current = event.pointerId

    const stroke: InkStroke = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      color: DEFAULT_INK_COLOR,
      width: DEFAULT_INK_WIDTH,
      points: [point],
    }

    strokesRef.current.push(stroke)
    currentStrokeRef.current = stroke

    const ctx = getCanvasContext()
    if (ctx) {
      const pos = toCanvasPx(point)
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = stroke.width
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, stroke.width / 2, 0, Math.PI * 2)
      ctx.fillStyle = stroke.color
      ctx.fill()
    }

    strokeTrackRef.current = {
      active: true,
      lastX: event.clientX,
      minX: event.clientX,
      maxX: event.clientX,
      leftPanArmed: false,
    }

    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {}
  }, [getCanvasContext, getStrokePoint, toCanvasPx])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    if (pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return
    const point = getStrokePoint(event)
    if (!point) return

    const stroke = currentStrokeRef.current
    if (!stroke) return

    const prevPoint = stroke.points[stroke.points.length - 1]
    stroke.points.push(point)

    const ctx = getCanvasContext()
    if (ctx) {
      const prev = toCanvasPx(prevPoint)
      const next = toCanvasPx(point)
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = stroke.width
      ctx.beginPath()
      ctx.moveTo(prev.x, prev.y)
      ctx.lineTo(next.x, next.y)
      ctx.stroke()
    }

    const viewport = viewportRef.current
    if (!viewport) return

    const track = strokeTrackRef.current
    const nextX = event.clientX
    const dx = nextX - track.lastX
    track.lastX = nextX
    track.minX = Math.min(track.minX, nextX)
    track.maxX = Math.max(track.maxX, nextX)

    const rect = viewport.getBoundingClientRect()
    const leftEdgeTrigger = rect.left + rect.width * 0.1
    if (nextX <= leftEdgeTrigger) {
      track.leftPanArmed = true
    }

    if (!track.leftPanArmed) return
    if (dx >= 0) return

    const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    if (maxScroll <= 0) return

    leftPanPendingDxRef.current += dx
    if (typeof window === 'undefined') {
      viewport.scrollLeft = Math.max(0, Math.min(viewport.scrollLeft + leftPanPendingDxRef.current, maxScroll))
      leftPanPendingDxRef.current = 0
      return
    }

    if (leftPanRafRef.current) return
    leftPanRafRef.current = window.requestAnimationFrame(() => {
      leftPanRafRef.current = null
      const pending = leftPanPendingDxRef.current
      leftPanPendingDxRef.current = 0
      if (!pending) return
      viewport.scrollLeft = Math.max(0, Math.min(viewport.scrollLeft + pending, maxScroll))
    })
  }, [getCanvasContext, getStrokePoint, toCanvasPx])

  const handlePointerUp = useCallback(() => {
    if (!drawingRef.current) return
    drawingRef.current = false
    pointerIdRef.current = null
    currentStrokeRef.current = null

    const viewport = viewportRef.current
    if (!viewport) return
    if (strokeTrackRef.current.active) {
      strokeTrackRef.current.active = false
    }

    leftPanPendingDxRef.current = 0

    const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    if (maxScroll <= 0) return

    const rect = viewport.getBoundingClientRect()
    const midX = rect.left + rect.width * 0.5
    const gain = 0.9

    if (strokeTrackRef.current.leftPanArmed) {
      const targetX = rect.left + rect.width * 0.5
      const delta = strokeTrackRef.current.lastX - targetX
      if (delta < -1) {
        smoothScrollViewportBy(delta)
      }
      return
    }

    const excessRight = strokeTrackRef.current.maxX - midX
    if (excessRight > 0) {
      smoothScrollViewportBy(excessRight * gain)
    }
  }, [smoothScrollViewportBy])

  const handlePointerCancel = useCallback(() => {
    drawingRef.current = false
    pointerIdRef.current = null
    currentStrokeRef.current = null
  }, [])

  const handleClear = useCallback(() => {
    strokesRef.current = []
    currentStrokeRef.current = null
    requestRedraw()
  }, [requestRedraw])

  useEffect(() => {
    return () => {
      if (autoPanAnimRef.current && typeof window !== 'undefined') {
        try {
          window.cancelAnimationFrame(autoPanAnimRef.current)
        } catch {}
      }
      if (leftPanRafRef.current && typeof window !== 'undefined') {
        try {
          window.cancelAnimationFrame(leftPanRafRef.current)
        } catch {}
      }
      if (redrawRafRef.current && typeof window !== 'undefined') {
        try {
          window.cancelAnimationFrame(redrawRafRef.current)
        } catch {}
      }
    }
  }, [])

  if (!open) return null

  return (
    <FullScreenGlassOverlay
      title="Freehand canvas"
      subtitle="Write freely without recognition"
      variant="light"
      panelSize="full"
      panelClassName="rounded-none"
      frameClassName="absolute inset-0"
      contentClassName="p-0 overflow-hidden"
      onClose={onClose}
      onBackdropClick={onClose}
      rightActions={
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={handleClear}
        >
          Clear
        </button>
      }
    >
      <div className="relative h-full w-full overflow-hidden">
        <div
          ref={viewportRef}
          className="absolute inset-0 overflow-auto"
          style={{ overscrollBehavior: 'contain' }}
        >
          <div className="relative" style={surfaceStyle}>
            <canvas
              ref={canvasRef}
              className="absolute inset-0"
              style={{ width: surfaceSize.width, height: surfaceSize.height, touchAction: 'none' }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
            />
          </div>
        </div>
      </div>
    </FullScreenGlassOverlay>
  )
}
