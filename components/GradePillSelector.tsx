import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type PillAnchorRect = {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

export type GradePillSelectorProps<T extends string> = {
  open: boolean
  anchorRect: PillAnchorRect | null
  values: readonly T[]
  selected: T | null
  labelForValue: (value: T) => string
  onSelect: (value: T) => void
  onClose: () => void
  /**
   * Optional: start a drag interaction from an external element (e.g. the grade display pill).
   * When provided, the selector will track pointermove/pointerup globally for that pointer.
   */
  externalDrag?: { pointerId: number; startClientY: number } | null
  /** Called when the external drag session ends (pointerup/cancel). */
  onExternalDragEnd?: () => void
  autoCloseMs?: number
  /**
   * If provided, forces a fixed width. Prefer leaving undefined so the pill fits the label width.
   */
  widthPx?: number
  /** Vertical offset from the click Y. Default 0 to keep the top aligned with the click. */
  offsetYPx?: number
  /** Horizontal offset applied after anchoring. */
  offsetXPx?: number
  /** Anchor the pill relative to the click target. */
  anchorX?: 'left' | 'center'
  anchorY?: 'top' | 'bottom'
  /** Bias placement for one-handed use. */
  handedness?: 'left' | 'right'
  /** 0..1: 0 = stick to click X; 1 = stick to preferred center-ish X. */
  centerBiasStrength?: number
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export default function GradePillSelector<T extends string>(props: GradePillSelectorProps<T>) {
  const {
    open,
    anchorRect,
    values,
    selected,
    labelForValue,
    onSelect,
    onClose,
    externalDrag,
    onExternalDragEnd,
    autoCloseMs = 2500,
    widthPx,
    offsetYPx = 0,
    offsetXPx = 0,
    anchorX,
    anchorY,
    handedness = 'right',
    centerBiasStrength = 0.7,
  } = props

  const canRender = open && anchorRect && typeof document !== 'undefined'

  const pillRef = useRef<HTMLDivElement | null>(null)
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null)
  const [optionHeight, setOptionHeight] = useState<number | null>(null)

  const pointerIdRef = useRef<number | null>(null)
  const startYRef = useRef<number>(0)
  const isDraggingRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)
  const suppressClickRef = useRef(false)
  const [dragValue, setDragValue] = useState<T | null>(null)
  const dragValueRef = useRef<T | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    if (!pillRef.current) return
    const rect = pillRef.current.getBoundingClientRect()
    if (!rect.width) return
    setMeasuredWidth(rect.width)

    const firstButton = pillRef.current.querySelector('button[data-pill-option="1"]') as HTMLButtonElement | null
    if (firstButton) {
      const h = firstButton.getBoundingClientRect().height
      if (h) setOptionHeight(h)
    }
  }, [open, values.length, selected, widthPx])

  useEffect(() => {
    if (!open) {
      isDraggingRef.current = false
      setIsDragging(false)
      pointerIdRef.current = null
      suppressClickRef.current = false
      setDragValue(null)
      dragValueRef.current = null
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    if (!externalDrag) return
    if (typeof window === 'undefined') return

    pointerIdRef.current = externalDrag.pointerId
    startYRef.current = externalDrag.startClientY
    isDraggingRef.current = false
    setIsDragging(false)
    suppressClickRef.current = false
    setDragValue(null)
    dragValueRef.current = null

    const move = (ev: PointerEvent) => {
      if (pointerIdRef.current !== ev.pointerId) return
      const dy = Math.abs(ev.clientY - startYRef.current)
      if (!isDraggingRef.current && dy < 6) return

      if (!isDraggingRef.current) {
        isDraggingRef.current = true
        setIsDragging(true)
        suppressClickRef.current = true
      }

      const v = valueAtClientY(ev.clientY)
      if (v) {
        dragValueRef.current = v
        setDragValue(v)
      }
    }

    const end = (ev: PointerEvent) => {
      if (pointerIdRef.current !== ev.pointerId) return
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', end, true)

      pointerIdRef.current = null

      // If the user didn't actually drag, leave the selector open for a normal tap.
      if (!isDraggingRef.current) {
        onExternalDragEnd?.()
        return
      }

      const v = dragValueRef.current ?? valueAtClientY(ev.clientY)
      if (v) onSelect(v)
      onClose()
      onExternalDragEnd?.()

      window.setTimeout(() => {
        suppressClickRef.current = false
        isDraggingRef.current = false
        setIsDragging(false)
        setDragValue(null)
        dragValueRef.current = null
      }, 0)
    }

    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', end, true)

    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', end, true)
    }
  }, [open, externalDrag, onSelect, onClose, onExternalDragEnd, optionHeight, values])

  const valueAtClientY = (clientY: number): T | null => {
    const el = pillRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const h = optionHeight || 44
    const idx = Math.floor((clientY - rect.top) / h)
    const clamped = Math.max(0, Math.min(values.length - 1, idx))
    return values[clamped] ?? null
  }

  const style = useMemo(() => {
    if (!anchorRect || typeof window === 'undefined') return null

    const viewportWidth = window.innerWidth || 360
    const viewportHeight = window.innerHeight || 640

    const effectiveWidth = typeof widthPx === 'number' ? widthPx : measuredWidth
    if (!effectiveWidth) {
      return {
        position: 'fixed' as const,
        left: 0,
        top: 0,
        zIndex: 9999,
        visibility: 'hidden' as const,
      }
    }

    const resolvedAnchorX = anchorX
    const resolvedAnchorY = anchorY

    const clickCenterX = anchorRect.left + anchorRect.width / 2
    const clickLeftX = anchorRect.left

    // If explicit anchor positioning is provided, use it.
    // Otherwise fall back to the handedness bias behavior.
    let leftRaw: number
    if (resolvedAnchorX === 'left') {
      leftRaw = clickLeftX + offsetXPx
    } else if (resolvedAnchorX === 'center') {
      leftRaw = clickCenterX - effectiveWidth / 2 + offsetXPx
    } else {
      const preferredCenterX = viewportWidth * (handedness === 'left' ? 0.4 : 0.6)
      const strength = clamp(centerBiasStrength, 0, 1)
      const targetCenterX = clickCenterX * (1 - strength) + preferredCenterX * strength
      leftRaw = targetCenterX - effectiveWidth / 2
    }

    const baseY = (resolvedAnchorY === 'top') ? anchorRect.top : anchorRect.bottom
    const topRaw = baseY + offsetYPx

    const left = clamp(leftRaw, 8, Math.max(8, viewportWidth - effectiveWidth - 8))
    const top = clamp(topRaw, 8, Math.max(8, viewportHeight - 8))

    return {
      position: 'fixed' as const,
      left,
      top,
      zIndex: 9999,
      touchAction: 'none' as const,
    }
  }, [anchorRect, widthPx, measuredWidth, offsetYPx, offsetXPx, anchorX, anchorY, handedness, centerBiasStrength])

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => onClose(), autoCloseMs)
    return () => window.clearTimeout(t)
  }, [open, autoCloseMs, onClose])

  if (!canRender || !style) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9998]"
      role="presentation"
      onMouseDown={(e) => {
        // Click-away closes. If the click is inside the pill, we stopPropagation in the pill.
        e.preventDefault()
        onClose()
      }}
      onTouchStart={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div
        style={style}
        className="philani-grade-pill-selector inline-block"
        ref={pillRef}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          // Enable drag-to-select: press + slide, select on lift.
          if (e.pointerType === 'mouse' && e.button !== 0) return

          pointerIdRef.current = e.pointerId
          startYRef.current = e.clientY
          isDraggingRef.current = false
          setIsDragging(false)
          setDragValue(null)
          dragValueRef.current = null

          // Prevent the browser from converting this into a scroll.
          e.preventDefault()
          e.stopPropagation()

          const move = (ev: PointerEvent) => {
            if (pointerIdRef.current !== ev.pointerId) return
            const dy = Math.abs(ev.clientY - startYRef.current)
            if (!isDraggingRef.current && dy < 6) return

            if (!isDraggingRef.current) {
              isDraggingRef.current = true
              setIsDragging(true)
              suppressClickRef.current = true
            }
            const v = valueAtClientY(ev.clientY)
            if (v) {
              dragValueRef.current = v
              setDragValue(v)
            }
          }

          const end = (ev: PointerEvent) => {
            if (pointerIdRef.current !== ev.pointerId) return
            window.removeEventListener('pointermove', move, true)
            window.removeEventListener('pointerup', end, true)
            window.removeEventListener('pointercancel', end, true)

            pointerIdRef.current = null

            if (!isDraggingRef.current) {
              // Let the normal click handler handle simple taps.
              return
            }

            const v = dragValueRef.current ?? valueAtClientY(ev.clientY)
            if (v) onSelect(v)
            onClose()

            // Allow the click event triggered after pointerup to be ignored once.
            window.setTimeout(() => {
              suppressClickRef.current = false
              isDraggingRef.current = false
              setIsDragging(false)
              setDragValue(null)
              dragValueRef.current = null
            }, 0)
          }

          window.addEventListener('pointermove', move, true)
          window.addEventListener('pointerup', end, true)
          window.addEventListener('pointercancel', end, true)
        }}
      >
        <div
          role="radiogroup"
          aria-label="Grade workspace"
          className="overflow-hidden rounded-[999px] border border-white/10 bg-white/10 backdrop-blur-xl shadow-2xl"
        >
          {values.map((g, idx) => {
            const effectiveSelected = isDragging ? dragValue : selected
            const isSelected = effectiveSelected === g
            const label = labelForValue(g)
            const isLast = idx === values.length - 1

            return (
              <button
                key={String(g)}
                type="button"
                role="radio"
                aria-checked={isSelected}
                data-pill-option="1"
                className={
                  `min-w-[52px] px-3 h-11 flex items-center justify-center text-base font-semibold tabular-nums transition focus:outline-none focus:ring-2 focus:ring-white/25 ` +
                  (isSelected ? 'bg-white/20 text-white' : 'bg-transparent text-white/85 hover:bg-white/10') +
                  (!isLast ? ' border-b border-white/10' : '')
                }
                onClick={() => {
                  if (suppressClickRef.current) return
                  onSelect(g)
                  onClose()
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>
    </div>,
    document.body
  )
}
