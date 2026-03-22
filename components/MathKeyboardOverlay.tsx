import { useCallback, useRef, useState, useEffect } from 'react'
import FullScreenGlassOverlay from './FullScreenGlassOverlay'

type MathKeyboardOverlayProps = {
  open: boolean
  onClose: () => void
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

// Direction compass types
type Direction = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | null

interface DirectionalOperation {
  direction: Direction
  symbol: string
  template: string
  label: string
  description: string
}

// Compass direction operations around the central "x"
const DIRECTIONAL_OPERATIONS: Record<Exclude<Direction, null>, DirectionalOperation> = {
  N: { direction: 'N', symbol: 'x/', template: 'fraction-num', label: 'Fraction', description: 'x as numerator' },
  NE: { direction: 'NE', symbol: 'x²', template: 'power', label: 'Power', description: 'x squared' },
  E: { direction: 'E', symbol: '+', template: 'add', label: 'Add', description: 'addition' },
  SE: { direction: 'SE', symbol: 'x_i', template: 'subscript', label: 'Subscript', description: 'subscript' },
  S: { direction: 'S', symbol: '/x', template: 'fraction-denom', label: 'Fraction Denom', description: 'x as denominator' },
  SW: { direction: 'SW', symbol: '²√x', template: 'radical', label: 'Radical', description: 'square root' },
  W: { direction: 'W', symbol: '−', template: 'subtract', label: 'Subtract', description: 'subtraction' },
  NW: { direction: 'NW', symbol: '()', template: 'enclosure', label: 'Parentheses', description: 'enclosure' },
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

// Render LaTeX-like expression preview
function LaTeXPreview({ expression }: { expression: string }) {
  return (
    <div className="h-full w-full flex items-center justify-center bg-white p-4">
      <div className="text-4xl font-light text-slate-800 flex items-center justify-center min-h-[100px]">
        <code className="font-mono text-2xl tracking-wide">{expression || 'x'}</code>
      </div>
    </div>
  )
}

// Radial keyboard with 8 directional buttons
function RadialKeyboard({
  onOperationSelect,
  centerButtonRef,
}: {
  onOperationSelect: (direction: Direction) => void
  centerButtonRef: React.RefObject<HTMLButtonElement>
}) {
  const keyboardRef = useRef<HTMLDivElement>(null)
  const [isGestureActive, setIsGestureActive] = useState(false)
  const [selectedDirection, setSelectedDirection] = useState<Direction>(null)
  const gestureStartRef = useRef<{ x: number; y: number } | null>(null)

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
        setSelectedDirection(direction)
      } else {
        setSelectedDirection(null)
      }
    }

    const handleEnd = (e: MouseEvent | TouchEvent) => {
      if (selectedDirection) {
        onOperationSelect(selectedDirection)
      }
      setIsGestureActive(false)
      setSelectedDirection(null)
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
  }, [isGestureActive, selectedDirection, onOperationSelect])

  const baseButtonClass = 'absolute flex items-center justify-center rounded-lg border border-slate-300 bg-white shadow-sm hover:bg-slate-50 transition-colors font-semibold text-sm w-16 h-16 cursor-pointer'

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

      {/* N - Numerator (above) */}
      <button
        type="button"
        onClick={() => onOperationSelect('N')}
        className={`${baseButtonClass} top-6 left-1/2 -translate-x-1/2 ${selectedDirection === 'N' ? 'bg-blue-100 border-blue-400' : ''}`}
        title="Fraction - x as numerator"
      >
        <span className="text-center text-xs flex flex-col gap-0.5">
          <div className="font-bold text-lg">x/</div>
        </span>
      </button>

      {/* NE - Power (top-right) */}
      <button
        type="button"
        onClick={() => onOperationSelect('NE')}
        className={`${baseButtonClass} top-12 right-12 ${selectedDirection === 'NE' ? 'bg-blue-100 border-blue-400' : ''}`}
        title="Power - x squared"
      >
        <span className="text-center text-xs flex flex-col gap-0.5">
          <div>x<sup className="text-sm">2</sup></div>
        </span>
      </button>

      {/* E - Addition (right) */}
      <button
        type="button"
        onClick={() => onOperationSelect('E')}
        className={`${baseButtonClass} top-1/2 right-6 -translate-y-1/2 ${selectedDirection === 'E' ? 'bg-green-100 border-green-400' : ''}`}
        title="Addition"
      >
        <span className="text-2xl font-light">+</span>
      </button>

      {/* SE - Subscript (bottom-right) */}
      <button
        type="button"
        onClick={() => onOperationSelect('SE')}
        className={`${baseButtonClass} bottom-12 right-12 ${selectedDirection === 'SE' ? 'bg-blue-100 border-blue-400' : ''}`}
        title="Subscript"
      >
        <span className="text-center text-xs flex flex-col gap-0.5">
          <div>x<sub className="text-sm">i</sub></div>
        </span>
      </button>

      {/* S - Denominator (below) */}
      <button
        type="button"
        onClick={() => onOperationSelect('S')}
        className={`${baseButtonClass} bottom-6 left-1/2 -translate-x-1/2 ${selectedDirection === 'S' ? 'bg-blue-100 border-blue-400' : ''}`}
        title="Fraction - x as denominator"
      >
        <span className="text-center text-xs flex flex-col gap-0.5">
          <div className="font-bold text-lg">/x</div>
        </span>
      </button>

      {/* SW - Radical (bottom-left) */}
      <button
        type="button"
        onClick={() => onOperationSelect('SW')}
        className={`${baseButtonClass} bottom-12 left-12 ${selectedDirection === 'SW' ? 'bg-purple-100 border-purple-400' : ''}`}
        title="Radical - square root"
      >
        <span className="text-center text-xs flex flex-col gap-0.5">
          <div className="text-lg"><sup className="text-xs">2</sup>√x</div>
        </span>
      </button>

      {/* W - Subtraction (left) */}
      <button
        type="button"
        onClick={() => onOperationSelect('W')}
        className={`${baseButtonClass} top-1/2 left-6 -translate-y-1/2 ${selectedDirection === 'W' ? 'bg-green-100 border-green-400' : ''}`}
        title="Subtraction"
      >
        <span className="text-2xl font-light">−</span>
      </button>

      {/* NW - Enclosure (top-left) */}
      <button
        type="button"
        onClick={() => onOperationSelect('NW')}
        className={`${baseButtonClass} top-12 left-12 ${selectedDirection === 'NW' ? 'bg-blue-100 border-blue-400' : ''}`}
        title="Enclosure - parentheses"
      >
        <span className="text-2xl font-light">( )</span>
      </button>

      {/* Gesture indicator */}
      {isGestureActive && selectedDirection && (
        <div className="absolute top-4 right-4 bg-blue-500 text-white px-3 py-1 rounded-full text-xs font-semibold">
          {DIRECTIONAL_OPERATIONS[selectedDirection]?.label}
        </div>
      )}
    </div>
  )
}

// Expression builder and state management
export default function MathKeyboardOverlay({ open, onClose }: MathKeyboardOverlayProps) {
  const [topRatio, setTopRatio] = useState(0.2)
  const [expression, setExpression] = useState<string[]>(['x'])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const centerButtonRef = useRef<HTMLButtonElement>(null)

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
    
    // Build expression as LaTeX-like string
    setExpression((prev) => {
      const current = prev[prev.length - 1]
      let newExpr = [...prev]

      switch (direction) {
        case 'N': // x/y (x as numerator)
          newExpr.push(`${current}/`)
          break
        case 'NE': // x^n (power)
          newExpr.push(`${current}^`)
          break
        case 'E': // + (addition)
          newExpr.push('+')
          break
        case 'SE': // x_i (subscript)
          newExpr.push(`${current}_`)
          break
        case 'S': // y/x (x as denominator)
          newExpr.push(`/${current}`)
          break
        case 'SW': // ^n√x (radical)
          newExpr.push(`√${current}`)
          break
        case 'W': // - (subtraction)
          newExpr.push('-')
          break
        case 'NW': // (x) (enclosure)
          newExpr = [newExpr.map((e) => `(${e})`).join('')]
          break
        default:
          break
      }

      return newExpr
    })
  }, [])

  const expressionString = expression.join(' ')

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
            {/* Top Preview Panel */}
            <div
              className="flex flex-col"
              style={{ flex: Math.max(topRatio, 0.2), minHeight: '200px' }}
            >
              <div className="px-3 py-3 flex-1 min-h-[140px]">
                <div className="h-full bg-white rounded-lg p-3 overflow-hidden relative">
                  <LaTeXPreview expression={expressionString} />
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
              />
            </div>
          </div>
        </div>
      </div>
    </FullScreenGlassOverlay>
  )
}
