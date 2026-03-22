import { useCallback, useRef, useState, useEffect } from 'react'
import katex from 'katex'
import FullScreenGlassOverlay from './FullScreenGlassOverlay'
import 'katex/dist/katex.min.css'

type MathKeyboardOverlayProps = {
  open: boolean
  onClose: () => void
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

// Direction compass types
type Direction = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | null

interface DirectionalOperation {
  direction: Direction
  latex: string
  template: string
  label: string
  description: string
}

type CanvasTransform = {
  scale: number
  offsetX: number
  offsetY: number
}

type TouchPointLike = {
  clientX: number
  clientY: number
}

// Compass direction operations around the central "x"
const DIRECTIONAL_OPERATIONS: Record<Exclude<Direction, null>, DirectionalOperation> = {
  N: { direction: 'N', latex: '\\frac{x}{\\phantom{a}}', template: 'fraction-num', label: 'Fraction', description: 'x as numerator' },
  NE: { direction: 'NE', latex: 'x^{2}', template: 'power', label: 'Power', description: 'x squared' },
  E: { direction: 'E', latex: '+', template: 'add', label: 'Add', description: 'addition' },
  SE: { direction: 'SE', latex: 'x_{i}', template: 'subscript', label: 'Subscript', description: 'subscript' },
  S: { direction: 'S', latex: '\\frac{\\phantom{a}}{x}', template: 'fraction-denom', label: 'Fraction Denom', description: 'x as denominator' },
  SW: { direction: 'SW', latex: '\\sqrt{x}', template: 'radical', label: 'Radical', description: 'square root' },
  W: { direction: 'W', latex: '-', template: 'subtract', label: 'Subtract', description: 'subtraction' },
  NW: { direction: 'NW', latex: '\\left(x\\right)', template: 'enclosure', label: 'Parentheses', description: 'enclosure' },
}

const MIN_CANVAS_SCALE = 0.65
const MAX_CANVAS_SCALE = 3.2
const DOUBLE_TAP_MS = 260

const clampScale = (scale: number) => clamp(scale, MIN_CANVAS_SCALE, MAX_CANVAS_SCALE)

const getTouchDistance = (first: TouchPointLike, second: TouchPointLike) => Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)

const getTouchMidpoint = (first: TouchPointLike, second: TouchPointLike) => ({
  x: (first.clientX + second.clientX) / 2,
  y: (first.clientY + second.clientY) / 2,
})

const renderKatexToString = (latex: string, displayMode: boolean) => {
  try {
    return katex.renderToString(latex, {
      throwOnError: true,
      displayMode,
    })
  } catch (error) {
    console.error('KaTeX rendering error:', error)
    return displayMode
      ? '<div style="color: red; font-size: 14px;">Invalid LaTeX</div>'
      : latex
  }
}

// Calculate angle from center to point (in degrees, 0 = East, 90 = South)
const getAngleFromCenter = (centerX: number, centerY: number, pointX: number, pointY: number): number => {
  const dx = pointX - centerX
  const dy = pointY - centerY
  let angle = Math.atan2(dy, dx) * (180 / Math.PI)
  // Normalize to 0-360
  angle = (angle + 360) % 360
  return angle
}

// Get direction from angle (NE is 45°, E is 0°, SE is -45°, etc.)
const getDirectionFromAngle = (angle: number): Direction => {
  // Adjust so that 0° is East, 90° is South, etc.
  // 22.5° bands for each direction
  if (angle >= 337.5 || angle < 22.5) return 'E'
  if (angle >= 22.5 && angle < 67.5) return 'SE'
  if (angle >= 67.5 && angle < 112.5) return 'S'
  if (angle >= 112.5 && angle < 157.5) return 'SW'
  if (angle >= 157.5 && angle < 202.5) return 'W'
  if (angle >= 202.5 && angle < 247.5) return 'NW'
  if (angle >= 247.5 && angle < 292.5) return 'N'
  if (angle >= 292.5 && angle < 337.5) return 'NE'
  return null
}

// KaTeX Preview component with professional rendering
function MathPreview({ latex }: { latex: string }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || !latex) return

    containerRef.current.innerHTML = renderKatexToString(latex, true)
  }, [latex])

  return (
    <div
      ref={containerRef}
      className="h-full w-full flex items-center justify-center bg-white p-4 text-slate-800"
      style={{ minHeight: '100px' }}
    />
  )
}

function ZoomableMathCanvas({ latex }: { latex: string }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState<CanvasTransform>({ scale: 1, offsetX: 0, offsetY: 0 })
  const panStateRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const touchStateRef = useRef<
    | {
        mode: 'pan'
        startX: number
        startY: number
        originX: number
        originY: number
      }
    | {
        mode: 'pinch'
        startDistance: number
        startScale: number
        startMidX: number
        startMidY: number
        originX: number
        originY: number
      }
    | null
  >(null)
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!contentRef.current || !latex) return
    contentRef.current.innerHTML = renderKatexToString(latex, true)
  }, [latex])

  const zoomAroundPoint = useCallback((nextScale: number, clientX: number, clientY: number) => {
    const viewport = viewportRef.current
    if (!viewport) return

    const rect = viewport.getBoundingClientRect()
    const localX = clientX - rect.left
    const localY = clientY - rect.top

    setTransform((current) => {
      const clampedScale = clampScale(nextScale)
      const ratio = clampedScale / current.scale
      return {
        scale: clampedScale,
        offsetX: localX - (localX - current.offsetX) * ratio,
        offsetY: localY - (localY - current.offsetY) * ratio,
      }
    })
  }, [])

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    event.preventDefault()
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.setPointerCapture(event.pointerId)
    panStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.offsetX,
      originY: transform.offsetY,
    }
  }, [transform.offsetX, transform.offsetY])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const panState = panStateRef.current
    if (!panState || event.pointerType === 'touch') return
    setTransform((current) => ({
      ...current,
      offsetX: panState.originX + (event.clientX - panState.startX),
      offsetY: panState.originY + (event.clientY - panState.startY),
    }))
  }, [])

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') {
      panStateRef.current = null
      if (viewportRef.current?.hasPointerCapture(event.pointerId)) {
        viewportRef.current.releasePointerCapture(event.pointerId)
      }
    }
  }, [])

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const delta = event.deltaY < 0 ? 1.12 : 0.9
    zoomAroundPoint(transform.scale * delta, event.clientX, event.clientY)
  }, [transform.scale, zoomAroundPoint])

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const touches = event.touches
    if (!touches.length) return

    if (touches.length === 1) {
      const touch = touches[0]
      const now = Date.now()
      const lastTap = lastTapRef.current
      if (lastTap && now - lastTap.time <= DOUBLE_TAP_MS) {
        const delta = Math.hypot(touch.clientX - lastTap.x, touch.clientY - lastTap.y)
        if (delta <= 28) {
          event.preventDefault()
          const zoomTarget = transform.scale > 1.4 ? 1 : Math.min(2.2, transform.scale * 1.45)
          zoomAroundPoint(zoomTarget, touch.clientX, touch.clientY)
          lastTapRef.current = null
          touchStateRef.current = null
          return
        }
      }

      lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY }
      touchStateRef.current = {
        mode: 'pan',
        startX: touch.clientX,
        startY: touch.clientY,
        originX: transform.offsetX,
        originY: transform.offsetY,
      }
      return
    }

    if (touches.length >= 2) {
      event.preventDefault()
      const first = touches[0]
      const second = touches[1]
      const midpoint = getTouchMidpoint(first, second)
      touchStateRef.current = {
        mode: 'pinch',
        startDistance: getTouchDistance(first, second),
        startScale: transform.scale,
        startMidX: midpoint.x,
        startMidY: midpoint.y,
        originX: transform.offsetX,
        originY: transform.offsetY,
      }
    }
  }, [transform.offsetX, transform.offsetY, transform.scale, zoomAroundPoint])

  const handleTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const state = touchStateRef.current
    if (!state) return

    if (state.mode === 'pan' && event.touches.length === 1) {
      const touch = event.touches[0]
      setTransform((current) => ({
        ...current,
        offsetX: state.originX + (touch.clientX - state.startX),
        offsetY: state.originY + (touch.clientY - state.startY),
      }))
      return
    }

    if (event.touches.length >= 2) {
      event.preventDefault()
      const first = event.touches[0]
      const second = event.touches[1]
      const midpoint = getTouchMidpoint(first, second)

      if (state.mode !== 'pinch') {
        touchStateRef.current = {
          mode: 'pinch',
          startDistance: getTouchDistance(first, second),
          startScale: transform.scale,
          startMidX: midpoint.x,
          startMidY: midpoint.y,
          originX: transform.offsetX,
          originY: transform.offsetY,
        }
        return
      }

      const nextScale = clampScale(state.startScale * (getTouchDistance(first, second) / Math.max(state.startDistance, 1)))
      const scaleRatio = nextScale / state.startScale
      setTransform({
        scale: nextScale,
        offsetX: state.originX + (midpoint.x - state.startMidX) - ((midpoint.x - state.originX) * (scaleRatio - 1)),
        offsetY: state.originY + (midpoint.y - state.startMidY) - ((midpoint.y - state.originY) * (scaleRatio - 1)),
      })
    }
  }, [transform.offsetX, transform.offsetY, transform.scale])

  const handleTouchEnd = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length >= 2) {
      const first = event.touches[0]
      const second = event.touches[1]
      const midpoint = getTouchMidpoint(first, second)
      touchStateRef.current = {
        mode: 'pinch',
        startDistance: getTouchDistance(first, second),
        startScale: transform.scale,
        startMidX: midpoint.x,
        startMidY: midpoint.y,
        originX: transform.offsetX,
        originY: transform.offsetY,
      }
      return
    }

    if (event.touches.length === 1) {
      const touch = event.touches[0]
      touchStateRef.current = {
        mode: 'pan',
        startX: touch.clientX,
        startY: touch.clientY,
        originX: transform.offsetX,
        originY: transform.offsetY,
      }
      return
    }

    touchStateRef.current = null
  }, [transform.offsetX, transform.offsetY, transform.scale])

  return (
    <div
      ref={viewportRef}
      className="absolute inset-0 overflow-hidden rounded-[28px] bg-[radial-gradient(circle_at_top,_rgba(219,234,254,0.55),_transparent_50%),linear-gradient(180deg,_rgba(248,250,252,0.96),_rgba(255,255,255,1))]"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      style={{ touchAction: 'none' }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(transparent_31px,rgba(148,163,184,0.12)_32px),linear-gradient(90deg,transparent_31px,rgba(148,163,184,0.12)_32px)] bg-[length:32px_32px] opacity-70" />
      <div className="absolute left-3 top-3 z-[1] rounded-full border border-slate-200/90 bg-white/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 shadow-sm backdrop-blur-sm">
        Pan 1 finger • Pan/zoom 2 fingers • Double tap to zoom
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="will-change-transform"
          style={{
            transform: `translate(${transform.offsetX}px, ${transform.offsetY}px) scale(${transform.scale})`,
            transformOrigin: 'center center',
          }}
        >
          <div
            ref={contentRef}
            className="min-w-[280px] max-w-[min(76vw,880px)] rounded-[24px] border border-slate-200/90 bg-white/88 px-8 py-7 text-slate-900 shadow-[0_24px_60px_rgba(15,23,42,0.12)] backdrop-blur-sm"
          />
        </div>
      </div>
    </div>
  )
}

// Professional mathematical operation buttons
function OperationButton({
  direction,
  isSelected,
  onClick,
}: {
  direction: Exclude<Direction, null>
  isSelected: boolean
  onClick: () => void
}) {
  const op = DIRECTIONAL_OPERATIONS[direction]

  // Render each operation with professional LaTeX notation
  const renderMathButton = () => {
    const rendered = renderKatexToString(op.latex, false)
    return rendered === op.latex ? op.label : rendered
  }

  const positionClasses: Record<Exclude<Direction, null>, string> = {
    N: 'top-6 left-1/2 -translate-x-1/2',
    NE: 'top-12 right-12',
    E: 'top-1/2 right-6 -translate-y-1/2',
    SE: 'bottom-12 right-12',
    S: 'bottom-6 left-1/2 -translate-x-1/2',
    SW: 'bottom-12 left-12',
    W: 'top-1/2 left-6 -translate-y-1/2',
    NW: 'top-12 left-12',
  }

  const highlightColor = {
    N: 'blue',
    NE: 'blue',
    E: 'green',
    SE: 'blue',
    S: 'blue',
    SW: 'purple',
    W: 'green',
    NW: 'blue',
  }[direction]

  return (
    <button
      type="button"
      onClick={onClick}
      className={`absolute flex items-center justify-center rounded-lg border shadow-sm hover:shadow-md transition-all w-auto px-3 py-2 h-auto min-w-[60px] ${
        isSelected
          ? highlightColor === 'blue'
            ? 'bg-blue-100 border-blue-400'
            : highlightColor === 'green'
              ? 'bg-green-100 border-green-400'
              : 'bg-purple-100 border-purple-400'
          : 'border-slate-300 bg-white text-slate-700'
      } hover:bg-slate-50 transition-colors ${positionClasses[direction]}`}
      title={op.description}
      style={{ fontSize: '18px' }}
      dangerouslySetInnerHTML={{ __html: renderMathButton() }}
    />
  )
}

// Radial keyboard with 8 directional buttons
function RadialKeyboard({
  onOperationSelect,
  centerButtonRef,
  selectedDirection,
  latexExpression,
}: {
  onOperationSelect: (direction: Direction) => void
  centerButtonRef: React.RefObject<HTMLButtonElement>
  selectedDirection: Direction
  latexExpression: string
}) {
  const keyboardRef = useRef<HTMLDivElement>(null)
  const [isGestureActive, setIsGestureActive] = useState(false)
  const gestureStartRef = useRef<{ x: number; y: number } | null>(null)
  const [gestureDir, setGestureDir] = useState<Direction>(null)

  // Handle center button press (start gesture)
  const handleCenterMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    setIsGestureActive(true)
    const rect = centerButtonRef.current?.getBoundingClientRect()
    if (rect) {
      gestureStartRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }
  }

  // Handle gesture movement
  useEffect(() => {
    if (!isGestureActive || !gestureStartRef.current || !centerButtonRef.current) return

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0]?.clientX : (e as MouseEvent).clientX
      const clientY = 'touches' in e ? e.touches[0]?.clientY : (e as MouseEvent).clientY

      if (!clientX || !clientY) return

      const centerX = gestureStartRef.current!.x
      const centerY = gestureStartRef.current!.y
      const angle = getAngleFromCenter(centerX, centerY, clientX, clientY)
      const direction = getDirectionFromAngle(angle)

      // Only activate if gesture distance is significant (at least 40px)
      const distance = Math.hypot(clientX - centerX, clientY - centerY)
      if (distance > 40) {
        setGestureDir(direction)
      } else {
        setGestureDir(null)
      }
    }

    const handleEnd = () => {
      if (gestureDir) {
        onOperationSelect(gestureDir)
      }
      setIsGestureActive(false)
      setGestureDir(null)
      gestureStartRef.current = null
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('touchmove', handleMove)
    window.addEventListener('mouseup', handleEnd)
    window.addEventListener('touchend', handleEnd)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('touchmove', handleMove)
      window.removeEventListener('mouseup', handleEnd)
      window.removeEventListener('touchend', handleEnd)
    }
  }, [isGestureActive, gestureDir, onOperationSelect])

  return (
    <div ref={keyboardRef} className="h-full w-full relative overflow-hidden rounded-[28px] bg-white p-4">
      <ZoomableMathCanvas latex={latexExpression} />
      <div className="absolute inset-0 z-[2] rounded-[28px] bg-[radial-gradient(circle_at_center,_transparent_0,_transparent_88px,rgba(255,255,255,0.18)_89px,rgba(255,255,255,0.18)_160px,transparent_161px)]" />
      {/* Center button (x) */}
      <button
        ref={centerButtonRef}
        type="button"
        onMouseDown={handleCenterMouseDown}
        onTouchStart={handleCenterMouseDown}
        className="absolute left-1/2 top-1/2 z-10 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-4xl font-bold text-white shadow-lg transition-shadow hover:shadow-xl cursor-grab active:cursor-grabbing"
        aria-label="Center button - hold and swipe to apply operations"
      >
        ◉
      </button>

      {/* Directional buttons with professional math notation */}
      <OperationButton direction="N" isSelected={gestureDir === 'N' || selectedDirection === 'N'} onClick={() => onOperationSelect('N')} />
      <OperationButton direction="NE" isSelected={gestureDir === 'NE' || selectedDirection === 'NE'} onClick={() => onOperationSelect('NE')} />
      <OperationButton direction="E" isSelected={gestureDir === 'E' || selectedDirection === 'E'} onClick={() => onOperationSelect('E')} />
      <OperationButton direction="SE" isSelected={gestureDir === 'SE' || selectedDirection === 'SE'} onClick={() => onOperationSelect('SE')} />
      <OperationButton direction="S" isSelected={gestureDir === 'S' || selectedDirection === 'S'} onClick={() => onOperationSelect('S')} />
      <OperationButton direction="SW" isSelected={gestureDir === 'SW' || selectedDirection === 'SW'} onClick={() => onOperationSelect('SW')} />
      <OperationButton direction="W" isSelected={gestureDir === 'W' || selectedDirection === 'W'} onClick={() => onOperationSelect('W')} />
      <OperationButton direction="NW" isSelected={gestureDir === 'NW' || selectedDirection === 'NW'} onClick={() => onOperationSelect('NW')} />

      {/* Gesture indicator */}
      {isGestureActive && gestureDir && (
        <div className="absolute right-4 top-4 z-10 rounded-full bg-blue-500 px-3 py-1 text-xs font-semibold text-white">
          {DIRECTIONAL_OPERATIONS[gestureDir]?.label}
        </div>
      )}
    </div>
  )
}

// Main keyboard component
export default function MathKeyboardOverlay({ open, onClose }: MathKeyboardOverlayProps) {
  const [topRatio, setTopRatio] = useState(0.2)
  const [latexExpression, setLatexExpression] = useState<string>('x')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const centerButtonRef = useRef<HTMLButtonElement>(null)
  const [selectedDirection, setSelectedDirection] = useState<Direction>(null)

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

  const handleOperationSelect = useCallback((direction: Direction) => {
    if (!direction) return

    const op = DIRECTIONAL_OPERATIONS[direction]
    setSelectedDirection(direction)

    // Build LaTeX expression
    setLatexExpression((prev) => {
      let newExpr = prev

      switch (direction) {
        case 'N': // x as numerator
          newExpr = `\\frac{${prev}}{\\phantom{a}}`
          break
        case 'NE': // power
          newExpr = `${prev}^{2}`
          break
        case 'E': // addition
          newExpr = `${prev} + \\phantom{a}`
          break
        case 'SE': // subscript
          newExpr = `${prev}_{i}`
          break
        case 'S': // x as denominator
          newExpr = `\\frac{\\phantom{a}}{${prev}}`
          break
        case 'SW': // radical
          newExpr = `\\sqrt{${prev}}`
          break
        case 'W': // subtraction
          newExpr = `${prev} - \\phantom{a}`
          break
        case 'NW': // enclosure
          newExpr = `\\left(${prev}\\right)`
          break
        default:
          break
      }

      return newExpr
    })

    // Clear selection after a delay
    setTimeout(() => setSelectedDirection(null), 300)
  }, [])

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
            {/* Top Preview Panel with KaTeX rendering */}
            <div
              className="flex flex-col"
              style={{ flex: Math.max(topRatio, 0.2), minHeight: '200px' }}
            >
              <div className="px-3 py-3 flex-1 min-h-[140px]">
                <div className="h-full bg-white rounded-lg p-3 overflow-auto">
                  <MathPreview latex={latexExpression} />
                </div>
              </div>
            </div>

            {/* Separator */}
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

            {/* Bottom Keyboard Panel */}
            <div
              className="px-4 pb-3 flex flex-col min-h-0"
              style={{
                flex: Math.max(1 - topRatio, 0.2),
                minHeight: '220px',
              }}
            >
              <RadialKeyboard
                onOperationSelect={handleOperationSelect}
                centerButtonRef={centerButtonRef}
                selectedDirection={selectedDirection}
                latexExpression={latexExpression}
              />
            </div>
          </div>
        </div>
      </div>
    </FullScreenGlassOverlay>
  )
}
