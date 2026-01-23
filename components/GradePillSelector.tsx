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
  autoCloseMs?: number
  /**
   * If provided, forces a fixed width. Prefer leaving undefined so the pill fits the label width.
   */
  widthPx?: number
  /** Vertical offset from the click Y. Default 0 to keep the top aligned with the click. */
  offsetYPx?: number
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
    autoCloseMs = 2500,
    widthPx,
    offsetYPx = 0,
    handedness = 'right',
    centerBiasStrength = 0.7,
  } = props

  const canRender = open && anchorRect && typeof document !== 'undefined'

  const pillRef = useRef<HTMLDivElement | null>(null)
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    if (!pillRef.current) return
    const rect = pillRef.current.getBoundingClientRect()
    if (!rect.width) return
    setMeasuredWidth(rect.width)
  }, [open, values.length, selected, widthPx])

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

    const clickCenterX = anchorRect.left + anchorRect.width / 2
    const preferredCenterX = viewportWidth * (handedness === 'left' ? 0.4 : 0.6)
    const strength = clamp(centerBiasStrength, 0, 1)
    const targetCenterX = clickCenterX * (1 - strength) + preferredCenterX * strength

    const left = clamp(targetCenterX - effectiveWidth / 2, 8, Math.max(8, viewportWidth - effectiveWidth - 8))
    const top = clamp(anchorRect.top + offsetYPx, 8, Math.max(8, viewportHeight - 8))

    return {
      position: 'fixed' as const,
      left,
      top,
      zIndex: 9999,
    }
  }, [anchorRect, widthPx, measuredWidth, offsetYPx, handedness, centerBiasStrength])

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
      >
        <div
          role="radiogroup"
          aria-label="Grade workspace"
          className="overflow-hidden rounded-[999px] border border-white/10 bg-white/10 backdrop-blur-xl shadow-2xl"
        >
          {values.map((g, idx) => {
            const isSelected = selected === g
            const label = labelForValue(g)
            const isLast = idx === values.length - 1

            return (
              <button
                key={String(g)}
                type="button"
                role="radio"
                aria-checked={isSelected}
                className={
                  `min-w-[52px] px-3 h-11 flex items-center justify-center text-base font-semibold tabular-nums transition focus:outline-none focus:ring-2 focus:ring-white/25 ` +
                  (isSelected ? 'bg-white/20 text-white' : 'bg-transparent text-white/85 hover:bg-white/10') +
                  (!isLast ? ' border-b border-white/10' : '')
                }
                onClick={() => {
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
