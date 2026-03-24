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

// KaTeX Preview component with professional rendering
function MathPreview({
  latex,
  cursorPosition,
  onDisplayClick,
}: {
  latex: string
  cursorPosition: number
  onDisplayClick: (clientX: number, clientY: number) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || !latex) return

    containerRef.current.innerHTML = renderKatexToString(latex, true)
  }, [latex])

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    onDisplayClick(event.clientX, event.clientY)
  }

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      className="h-full w-full flex items-center justify-center bg-white p-4 text-slate-800 cursor-text"
      style={{ minHeight: '100px' }}
    />
  )
}

function ZoomableMathCanvas({ latex }: { latex: string }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState<CanvasTransform>({ scale: 1, offsetX: 0, offsetY: 0 })
  const transformRef = useRef<CanvasTransform>({ scale: 1, offsetX: 0, offsetY: 0 })
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
    transformRef.current = transform
  }, [transform])

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

    const current = transformRef.current
    const clampedScale = clampScale(nextScale)
    const ratio = clampedScale / Math.max(current.scale, 0.0001)
    const nextTransform = {
      scale: clampedScale,
      offsetX: localX - (localX - current.offsetX) * ratio,
      offsetY: localY - (localY - current.offsetY) * ratio,
    }
    transformRef.current = nextTransform
    setTransform(nextTransform)
  }, [])

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    event.preventDefault()
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.setPointerCapture(event.pointerId)
    const current = transformRef.current
    panStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: current.offsetX,
      originY: current.offsetY,
    }
  }, [])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const panState = panStateRef.current
    if (!panState || event.pointerType === 'touch') return
    const nextTransform = {
      ...transformRef.current,
      offsetX: panState.originX + (event.clientX - panState.startX),
      offsetY: panState.originY + (event.clientY - panState.startY),
    }
    transformRef.current = nextTransform
    setTransform(nextTransform)
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
    zoomAroundPoint(transformRef.current.scale * delta, event.clientX, event.clientY)
  }, [zoomAroundPoint])

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
          const zoomTarget = transformRef.current.scale > 1.4 ? 1 : Math.min(2.2, transformRef.current.scale * 1.45)
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
        originX: transformRef.current.offsetX,
        originY: transformRef.current.offsetY,
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
        startScale: transformRef.current.scale,
        startMidX: midpoint.x,
        startMidY: midpoint.y,
        originX: transformRef.current.offsetX,
        originY: transformRef.current.offsetY,
      }
    }
  }, [zoomAroundPoint])

  const handleTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const state = touchStateRef.current
    if (!state) return

    if (state.mode === 'pan' && event.touches.length === 1) {
      const touch = event.touches[0]
      const nextTransform = {
        ...transformRef.current,
        offsetX: state.originX + (touch.clientX - state.startX),
        offsetY: state.originY + (touch.clientY - state.startY),
      }
      transformRef.current = nextTransform
      setTransform(nextTransform)
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
          startScale: transformRef.current.scale,
          startMidX: midpoint.x,
          startMidY: midpoint.y,
          originX: transformRef.current.offsetX,
          originY: transformRef.current.offsetY,
        }
        return
      }

      const TWO_FINGER_PAN_GAIN = 0.4
      const nextScale = clampScale(state.startScale * (getTouchDistance(first, second) / Math.max(state.startDistance, 1)))
      const prev = transformRef.current
      const ratioDelta = nextScale / Math.max(prev.scale, 0.0001)
      const midpointStepDx = midpoint.x - state.startMidX
      const midpointStepDy = midpoint.y - state.startMidY
      const zoomOffsetX = midpoint.x - ratioDelta * (midpoint.x - prev.offsetX)
      const zoomOffsetY = midpoint.y - ratioDelta * (midpoint.y - prev.offsetY)
      const nextTransform = {
        scale: nextScale,
        offsetX: zoomOffsetX + (midpointStepDx * TWO_FINGER_PAN_GAIN),
        offsetY: zoomOffsetY + (midpointStepDy * TWO_FINGER_PAN_GAIN),
      }
      transformRef.current = nextTransform
      setTransform(nextTransform)

      touchStateRef.current = {
        ...state,
        startMidX: midpoint.x,
        startMidY: midpoint.y,
      }
    }
  }, [])

  const handleTouchEnd = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length >= 2) {
      const first = event.touches[0]
      const second = event.touches[1]
      const midpoint = getTouchMidpoint(first, second)
      touchStateRef.current = {
        mode: 'pinch',
        startDistance: getTouchDistance(first, second),
        startScale: transformRef.current.scale,
        startMidX: midpoint.x,
        startMidY: midpoint.y,
        originX: transformRef.current.offsetX,
        originY: transformRef.current.offsetY,
      }
      return
    }

    if (event.touches.length === 1) {
      const touch = event.touches[0]
      touchStateRef.current = {
        mode: 'pan',
        startX: touch.clientX,
        startY: touch.clientY,
        originX: transformRef.current.offsetX,
        originY: transformRef.current.offsetY,
      }
      return
    }

    touchStateRef.current = null
  }, [])

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

// Bare symbol buttons — no borders or backgrounds; only KaTeX on an absolute position
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

  const positionClasses: Record<Exclude<Direction, null>, string> = {
    N: 'top-6 left-1/2 -translate-x-1/2',
    NE: 'top-10 right-10',
    E: 'top-1/2 right-5 -translate-y-1/2',
    SE: 'bottom-10 right-10',
    S: 'bottom-6 left-1/2 -translate-x-1/2',
    SW: 'bottom-10 left-10',
    W: 'top-1/2 left-5 -translate-y-1/2',
    NW: 'top-10 left-10',
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`absolute z-[3] flex items-center justify-center bg-transparent p-1 transition-transform duration-150 ${positionClasses[direction]} ${
        isSelected
          ? 'scale-125 text-blue-600 drop-shadow-[0_0_6px_rgba(37,99,235,0.6)]'
          : 'text-slate-700 hover:scale-110 hover:text-blue-500'
      }`}
      title={op.description}
      style={{ fontSize: '26px' }}
      dangerouslySetInnerHTML={{ __html: renderKatexToString(op.latex, false) }}
    />
  )
}

// Radial keyboard: expression canvas behind 8 tap-only math buttons
function RadialKeyboard({
  onOperationSelect,
  selectedDirection,
  latexExpression,
}: {
  onOperationSelect: (direction: Direction) => void
  selectedDirection: Direction
  latexExpression: string
}) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-[28px]">
      <ZoomableMathCanvas latex={latexExpression} />
      <OperationButton direction="N" isSelected={selectedDirection === 'N'} onClick={() => onOperationSelect('N')} />
      <OperationButton direction="NE" isSelected={selectedDirection === 'NE'} onClick={() => onOperationSelect('NE')} />
      <OperationButton direction="E" isSelected={selectedDirection === 'E'} onClick={() => onOperationSelect('E')} />
      <OperationButton direction="SE" isSelected={selectedDirection === 'SE'} onClick={() => onOperationSelect('SE')} />
      <OperationButton direction="S" isSelected={selectedDirection === 'S'} onClick={() => onOperationSelect('S')} />
      <OperationButton direction="SW" isSelected={selectedDirection === 'SW'} onClick={() => onOperationSelect('SW')} />
      <OperationButton direction="W" isSelected={selectedDirection === 'W'} onClick={() => onOperationSelect('W')} />
      <OperationButton direction="NW" isSelected={selectedDirection === 'NW'} onClick={() => onOperationSelect('NW')} />
    </div>
  )
}

// Main keyboard component
export default function MathKeyboardOverlay({ open, onClose }: MathKeyboardOverlayProps) {
  const [topRatio, setTopRatio] = useState(0.2)
  const [latexExpression, setLatexExpression] = useState<string>('x')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [selectedDirection, setSelectedDirection] = useState<Direction>(null)
  const [cursorPosition, setCursorPosition] = useState<number>(1) // Start at end of 'x'
  const displayPanelRef = useRef<HTMLDivElement | null>(null)

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

  const handleDisplayClick = useCallback(
    (clientX: number, clientY: number) => {
      if (!displayPanelRef.current) return

      const rect = displayPanelRef.current.getBoundingClientRect()
      
      // Get the rendered content container
      const contentDiv = displayPanelRef.current.querySelector('div')
      if (!contentDiv) return

      const contentRect = contentDiv.getBoundingClientRect()
      
      // Calculate relative position within the content
      const relativeX = clientX - contentRect.left
      
      // Estimate character position based on width
      // This is a heuristic: we assume roughly equal character widths
      const contentWidth = contentRect.width
      const estimatedCharWidth = contentWidth / Math.max(latexExpression.length * 0.6, 1)
      
      let estimatedPosition = Math.round(relativeX / estimatedCharWidth)
      estimatedPosition = clamp(estimatedPosition, 0, latexExpression.length)
      
      setCursorPosition(estimatedPosition)
    },
    [latexExpression]
  )

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

    setSelectedDirection(direction)

    // Build LaTeX expression, inserting at cursor position
    setLatexExpression((prev) => {
      let newExpr = prev
      const pos = cursorPosition

      switch (direction) {
        case 'N': // x as numerator
          newExpr = `${prev.slice(0, pos)}\\frac{${prev.slice(pos)}}{\\phantom{a}}`
          setCursorPosition(pos + 6) // Position after \frac{
          break
        case 'NE': // power
          newExpr = `${prev.slice(0, pos)}${prev.slice(pos)}^{2}`
          setCursorPosition(pos + prev.slice(pos).length + 4) // After ^{2}
          break
        case 'E': // addition
          newExpr = `${prev.slice(0, pos)} + \\phantom{a}${prev.slice(pos)}`
          setCursorPosition(pos + 3) // After ' + '
          break
        case 'SE': // subscript
          newExpr = `${prev.slice(0, pos)}${prev.slice(pos)}_{i}`
          setCursorPosition(pos + prev.slice(pos).length + 3) // After _{i}
          break
        case 'S': // x as denominator
          newExpr = `${prev.slice(0, pos)}\\frac{\\phantom{a}}{${prev.slice(pos)}}`
          setCursorPosition(pos + 20) // Position after \frac{\phantom{a}}{
          break
        case 'SW': // radical
          newExpr = `${prev.slice(0, pos)}\\sqrt{${prev.slice(pos)}}`
          setCursorPosition(pos + 6) // Position after \sqrt{
          break
        case 'W': // subtraction
          newExpr = `${prev.slice(0, pos)} - \\phantom{a}${prev.slice(pos)}`
          setCursorPosition(pos + 3) // After ' - '
          break
        case 'NW': // enclosure
          newExpr = `${prev.slice(0, pos)}\\left(${prev.slice(pos)}\\right)`
          setCursorPosition(pos + 6) // Position after \left(
          break
        default:
          break
      }

      return newExpr
    })

    // Clear selection after a delay
    setTimeout(() => setSelectedDirection(null), 300)
  }, [cursorPosition])

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
              ref={displayPanelRef}
              className="flex flex-col"
              style={{ flex: Math.max(topRatio, 0.2), minHeight: '200px' }}
            >
              <div className="px-3 py-3 flex-1 min-h-[140px]">
                <div className="h-full bg-white rounded-lg p-3 overflow-auto">
                  <MathPreview
                    latex={latexExpression}
                    cursorPosition={cursorPosition}
                    onDisplayClick={handleDisplayClick}
                  />
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
