import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useOverlayRestore } from '../lib/overlayRestore'

let bodyScrollLockCount = 0
let bodyPrevOverflow: string | null = null

export type FullScreenGlassOverlayProps = {
  title: string
  subtitle?: string

  onClose: () => void
  onBackdropClick?: () => void

  closeDisabled?: boolean
  restoreOnClose?: boolean

  panelClassName?: string
  frameClassName?: string
  mobileChromeIgnore?: boolean

  panelSize?: 'full' | 'auto'

  variant?: 'dark' | 'light'
  position?: 'fixed' | 'absolute'
  showCloseButton?: boolean
  hideHeader?: boolean

  leftActions?: React.ReactNode
  rightActions?: React.ReactNode

  className?: string
  zIndexClassName?: string
  contentClassName?: string
  children: React.ReactNode
}

export default function FullScreenGlassOverlay(props: FullScreenGlassOverlayProps) {
  const {
    title,
    subtitle,
    onClose,
    onBackdropClick,
    closeDisabled,
    restoreOnClose,
    panelClassName,
    frameClassName,
    mobileChromeIgnore,
    variant,
    position,
    panelSize,
    showCloseButton: _showCloseButton,
    hideHeader = false,
    leftActions,
    rightActions,
    className,
    zIndexClassName,
    contentClassName,
    children
  } = props

  const [dragOffsetY, setDragOffsetY] = useState(0)
  const [isSettling, setIsSettling] = useState(false)
  const dragStateRef = useRef<null | {
    pointerId: number
    startY: number
    lastY: number
    lastAt: number
    velocityY: number
  }>(null)
  const { popRestore } = useOverlayRestore()

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (bodyScrollLockCount === 0) {
      bodyPrevOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    bodyScrollLockCount += 1
    return () => {
      if (typeof document === 'undefined') return
      bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1)
      if (bodyScrollLockCount === 0) {
        document.body.style.overflow = bodyPrevOverflow ?? ''
        bodyPrevOverflow = null
      }
    }
  }, [])

  const runRestore = useCallback(() => {
    if (restoreOnClose === false) return
    const restore = popRestore()
    if (!restore) return
    window.setTimeout(() => {
      try {
        restore()
      } catch {
        // ignore
      }
    }, 0)
  }, [popRestore, restoreOnClose])

  const handleRequestClose = useCallback(() => {
    if (closeDisabled) return
    onClose()
    runRestore()
  }, [closeDisabled, onClose, runRestore])

  const handleBackdropClick = closeDisabled ? undefined : () => {
    if (onBackdropClick) {
      onBackdropClick()
    } else {
      onClose()
    }
    runRestore()
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (closeDisabled) return
        e.preventDefault()
        handleRequestClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeDisabled, handleRequestClose])

  const overlayVariant = variant || 'dark'
  const rootPosition = position || 'fixed'
  const panelSizing = panelSize || 'auto'
  const canSwipeDownClose = rootPosition === 'fixed' && panelSizing !== 'full' && !closeDisabled

  const headerClassName = overlayVariant === 'light'
    ? 'p-3 sm:p-4 border-b border-slate-200/60 flex items-start justify-between gap-3 bg-white/70'
    : 'p-3 sm:p-4 border-b border-white/10 flex items-start justify-between gap-3'

  const headerSafeTopClassName = panelSizing === 'full' && rootPosition === 'fixed'
    ? 'pt-[calc(0.75rem+var(--app-safe-top))] sm:pt-[calc(1rem+var(--app-safe-top))]'
    : ''

  const titleClassName = overlayVariant === 'light'
    ? 'font-semibold text-slate-900 whitespace-normal break-words'
    : 'font-semibold text-white whitespace-normal break-words'

  const subtitleClassName = overlayVariant === 'light'
    ? 'text-xs text-slate-500 whitespace-normal break-words'
    : 'text-xs text-white/70 whitespace-normal break-words'

  const actionSlotClassName = overlayVariant === 'light'
    ? 'shrink-0 flex items-center gap-2 text-slate-700'
    : 'shrink-0 flex items-center gap-2'

  const defaultPanelClassName = overlayVariant === 'light'
    ? 'border border-slate-200/60 bg-white/95 shadow-2xl'
    : 'border border-white/10 bg-white/10 backdrop-blur-xl shadow-2xl'

  const panelSizeClassName = panelSizing === 'full'
    ? 'w-full h-[100dvh] max-h-[100dvh]'
    : 'w-full max-h-[92vh]'

  const panelTopSafeClassName = panelSizing !== 'full' && rootPosition === 'fixed'
    ? 'mt-[calc(var(--app-safe-top)+0.5rem)]'
    : ''

  const showDragThumb = panelSizing !== 'full'

  const contentClassBase = panelSizing === 'full'
    ? 'flex-1 min-h-0 overflow-y-auto pt-3 px-3 pb-[calc(0.35rem+var(--app-safe-bottom))] sm:pt-5 sm:px-5 sm:pb-[calc(0.85rem+var(--app-safe-bottom))]'
    : 'overflow-y-auto pt-3 px-3 pb-[calc(0.35rem+var(--app-safe-bottom))] sm:pt-5 sm:px-5 sm:pb-[calc(0.85rem+var(--app-safe-bottom))]'

  const frameSafeAreaStyle = rootPosition === 'fixed'
    ? { paddingBottom: 'var(--app-safe-bottom)' }
    : undefined

  const stopDrag = useCallback(() => {
    if (typeof window === 'undefined') return
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragEnd)
    window.removeEventListener('pointercancel', onDragEnd)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const settleTo = useCallback((nextOffset: number, after?: () => void) => {
    setIsSettling(true)
    setDragOffsetY(nextOffset)
    window.setTimeout(() => {
      setIsSettling(false)
      if (after) after()
    }, 170)
  }, [])

  const onDragMove = useCallback((event: PointerEvent) => {
    const drag = dragStateRef.current
    if (!drag) return
    if (event.pointerId !== drag.pointerId) return
    const now = performance.now()
    const dyFromStart = Math.max(0, event.clientY - drag.startY)
    const dyStep = event.clientY - drag.lastY
    const dt = Math.max(1, now - drag.lastAt)
    drag.velocityY = dyStep / dt
    drag.lastY = event.clientY
    drag.lastAt = now
    setDragOffsetY(dyFromStart)
  }, [])

  const onDragEnd = useCallback((event: PointerEvent) => {
    const drag = dragStateRef.current
    if (!drag) return
    if (event.pointerId !== drag.pointerId) return
    dragStateRef.current = null
    stopDrag()

    const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800
    const closeDistance = Math.min(180, Math.max(84, viewportH * 0.18))
    const fastSwipe = drag.velocityY > 0.8
    const shouldClose = dragOffsetY >= closeDistance || fastSwipe

    if (shouldClose) {
      settleTo(viewportH, handleRequestClose)
      return
    }
    settleTo(0)
  }, [dragOffsetY, handleRequestClose, settleTo, stopDrag])

  const onThumbPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!canSwipeDownClose) return
    if (event.button !== 0) return
    event.preventDefault()
    dragStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastAt: performance.now(),
      velocityY: 0,
    }
    setIsSettling(false)
    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', onDragMove, { passive: true })
      window.addEventListener('pointerup', onDragEnd)
      window.addEventListener('pointercancel', onDragEnd)
    }
  }, [canSwipeDownClose, onDragEnd, onDragMove])

  useEffect(() => () => stopDrag(), [stopDrag])

  return (
    <div
      className={`${rootPosition} inset-0 ${zIndexClassName || 'z-[80]'} ${className || ''}`}
      role="dialog"
      aria-modal="true"
      data-mobile-chrome-ignore={mobileChromeIgnore ? true : undefined}
    >
      <div
        className="absolute inset-0 philani-overlay-backdrop philani-overlay-backdrop-enter"
        onClick={handleBackdropClick}
      />

      <div
        className={frameClassName || 'absolute inset-0 flex items-end justify-center p-0 sm:p-4'}
        onClick={handleBackdropClick}
        style={frameSafeAreaStyle}
      >
        <div
          className={`overflow-hidden rounded-t-3xl sm:rounded-2xl flex flex-col max-w-5xl ${panelSizeClassName} ${panelTopSafeClassName} ${defaultPanelClassName} ${panelClassName || ''}`}
          onClick={(e) => e.stopPropagation()}
          style={canSwipeDownClose
            ? {
                transform: `translateY(${dragOffsetY}px)`,
                transition: isSettling ? 'transform 170ms ease-out' : 'none',
                willChange: 'transform',
              }
            : undefined}
        >
          {showDragThumb ? (
            <div
              className="pt-2 pb-1 flex items-center justify-center touch-none"
              onPointerDown={onThumbPointerDown}
              aria-label="Drag down to close"
            >
              <div className={overlayVariant === 'light' ? 'h-1.5 w-12 rounded-full bg-slate-300/90' : 'h-1.5 w-12 rounded-full bg-white/35'} />
            </div>
          ) : null}

          {hideHeader ? null : (
            <div className={`${headerClassName} ${headerSafeTopClassName}`}>
              <div className={actionSlotClassName}>
                {leftActions}
              </div>

              <div className="min-w-0 flex-1">
                <div className={titleClassName}>{title}</div>
                {subtitle ? <div className={subtitleClassName}>{subtitle}</div> : null}
              </div>

              <div className={actionSlotClassName}>
                {rightActions}
              </div>
            </div>
          )}

          <div className={`${contentClassBase} ${contentClassName || ''}`}>{children}</div>
        </div>
      </div>
    </div>
  )
}
