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

    try {
      const html = katex.renderToString(latex, {
        throwOnError: true,
        displayMode: true,
      })
      containerRef.current.innerHTML = html
    } catch (error) {
      containerRef.current.innerHTML = '<div style="color: red; font-size: 14px;">Invalid LaTeX</div>'
      console.error('KaTeX rendering error:', error)
    }
  }, [latex])

  return (
    <div
      ref={containerRef}
      className="h-full w-full flex items-center justify-center bg-white p-4 text-slate-800"
      style={{ minHeight: '100px' }}
    />
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
    try {
      return katex.renderToString(op.latex, {
        throwOnError: true,
        displayMode: false,
      })
    } catch (error) {
      console.error('KaTeX button rendering error:', error)
      return op.label
    }
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
}: {
  onOperationSelect: (direction: Direction) => void
  centerButtonRef: React.RefObject<HTMLButtonElement>
  selectedDirection: Direction
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
    <div ref={keyboardRef} className="h-full w-full flex items-center justify-center bg-white relative overflow-hidden p-4">
      {/* Center button (x) */}
      <button
        ref={centerButtonRef}
        type="button"
        onMouseDown={handleCenterMouseDown}
        onTouchStart={handleCenterMouseDown}
        className="absolute w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg flex items-center justify-center font-bold text-4xl hover:shadow-xl transition-shadow cursor-grab active:cursor-grabbing z-10"
        aria-label="Center button - hold and swipe to apply operations"
      >
        x
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
        <div className="absolute top-4 right-4 bg-blue-500 text-white px-3 py-1 rounded-full text-xs font-semibold">
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
              />
            </div>
          </div>
        </div>
      </div>
    </FullScreenGlassOverlay>
  )
}
