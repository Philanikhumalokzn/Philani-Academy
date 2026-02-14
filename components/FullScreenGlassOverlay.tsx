import React, { useCallback, useEffect, useRef } from 'react'
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
    showCloseButton,
    leftActions,
    rightActions,
    className,
    zIndexClassName,
    contentClassName,
    children
  } = props

  const closeBtnRef = useRef<HTMLButtonElement | null>(null)
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

  useEffect(() => {
    // Focus the close button for accessibility.
    // Use rAF to ensure it exists after render.
    const raf = requestAnimationFrame(() => closeBtnRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [])

  const overlayVariant = variant || 'dark'
  const rootPosition = position || 'fixed'
  const shouldShowCloseButton = showCloseButton !== undefined ? showCloseButton : true
  const panelSizing = panelSize || 'auto'

  const headerClassName = overlayVariant === 'light'
    ? 'p-3 sm:p-4 border-b border-slate-200/60 flex items-start justify-between gap-3 bg-white/70'
    : 'p-3 sm:p-4 border-b border-white/10 flex items-start justify-between gap-3'

  const titleClassName = overlayVariant === 'light'
    ? 'font-semibold text-slate-900 whitespace-normal break-words'
    : 'font-semibold text-white whitespace-normal break-words'

  const subtitleClassName = overlayVariant === 'light'
    ? 'text-xs text-slate-500 whitespace-normal break-words'
    : 'text-xs text-white/70 whitespace-normal break-words'

  const actionSlotClassName = overlayVariant === 'light'
    ? 'shrink-0 flex items-center gap-2 text-slate-700'
    : 'shrink-0 flex items-center gap-2'

  const closeBtnClassName = overlayVariant === 'light'
    ? 'w-9 h-9 inline-flex items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
    : 'w-9 h-9 inline-flex items-center justify-center rounded-full border border-white/10 bg-white/10 hover:bg-white/15 text-white'

  const defaultPanelClassName = overlayVariant === 'light'
    ? 'border border-slate-200/60 bg-white/95 shadow-2xl'
    : 'border border-white/10 bg-white/10 backdrop-blur-xl shadow-2xl'

  const panelSizeClassName = panelSizing === 'full'
    ? 'w-full h-[92vh]'
    : 'w-full max-h-[92vh]'

  const contentClassBase = panelSizing === 'full'
    ? 'flex-1 min-h-0 overflow-y-auto p-3 sm:p-5'
    : 'overflow-y-auto p-3 sm:p-5'

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
      >
        <div
          className={`overflow-hidden rounded-t-3xl sm:rounded-2xl flex flex-col max-w-5xl ${panelSizeClassName} ${defaultPanelClassName} ${panelClassName || ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="pt-2 pb-1 flex items-center justify-center">
            <div className={overlayVariant === 'light' ? 'h-1.5 w-12 rounded-full bg-slate-300/90' : 'h-1.5 w-12 rounded-full bg-white/35'} />
          </div>

          <div className={headerClassName}>
            <div className={actionSlotClassName}>
              {leftActions}
            </div>

            <div className="min-w-0 flex-1">
              <div className={titleClassName}>{title}</div>
              {subtitle ? <div className={subtitleClassName}>{subtitle}</div> : null}
            </div>

            <div className={actionSlotClassName}>
              {rightActions}
              {shouldShowCloseButton ? (
                <button
                  ref={closeBtnRef}
                  type="button"
                  className={closeBtnClassName}
                  onClick={handleRequestClose}
                  disabled={closeDisabled}
                  aria-label="Close"
                  title="Close"
                >
                  <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
                    <path
                      d="M6 6l8 8M14 6l-8 8"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              ) : null}
            </div>
          </div>

          <div className={`${contentClassBase} ${contentClassName || ''}`}>{children}</div>
        </div>
      </div>
    </div>
  )
}
