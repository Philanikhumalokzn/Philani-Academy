import React, { useEffect, useRef } from 'react'

export type FullScreenGlassOverlayProps = {
  title: string
  subtitle?: string

  onClose: () => void
  onBackdropClick?: () => void

  closeDisabled?: boolean

  panelClassName?: string
  frameClassName?: string
  mobileChromeIgnore?: boolean

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
    panelClassName,
    frameClassName,
    mobileChromeIgnore,
    variant,
    position,
    showCloseButton,
    leftActions,
    rightActions,
    className,
    zIndexClassName,
    contentClassName,
    children
  } = props

  const closeBtnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (closeDisabled) return
        e.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeDisabled, onClose])

  useEffect(() => {
    // Focus the close button for accessibility.
    // Use rAF to ensure it exists after render.
    const raf = requestAnimationFrame(() => closeBtnRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [])

  const handleBackdropClick = closeDisabled ? undefined : (onBackdropClick || onClose)

  const overlayVariant = variant || 'dark'
  const rootPosition = position || 'fixed'
  const shouldShowCloseButton = showCloseButton !== undefined ? showCloseButton : true

  const headerClassName = overlayVariant === 'light'
    ? 'p-3 sm:p-4 border-b border-slate-200/60 flex items-center justify-between gap-3 bg-white/70'
    : 'p-3 sm:p-4 border-b border-white/10 flex items-center justify-between gap-3'

  const titleClassName = overlayVariant === 'light'
    ? 'font-semibold text-slate-900 truncate'
    : 'font-semibold text-white truncate'

  const subtitleClassName = overlayVariant === 'light'
    ? 'text-xs text-slate-500 truncate'
    : 'text-xs text-white/70 truncate'

  const closeBtnClassName = overlayVariant === 'light'
    ? 'w-9 h-9 inline-flex items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
    : 'w-9 h-9 inline-flex items-center justify-center rounded-full border border-white/10 bg-white/10 hover:bg-white/15 text-white'

  const defaultPanelClassName = overlayVariant === 'light'
    ? 'border border-slate-200/60 bg-white/95 shadow-2xl'
    : 'border border-white/10 bg-white/10 backdrop-blur-xl shadow-2xl'

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
        className={frameClassName || 'absolute inset-0 p-2 sm:p-6'}
        onClick={handleBackdropClick}
      >
        <div
          className={`h-full w-full overflow-hidden rounded-2xl flex flex-col ${defaultPanelClassName} ${panelClassName || ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={headerClassName}>
            <div className="shrink-0 flex items-center gap-2">
              {leftActions}
            </div>

            <div className="min-w-0 flex-1">
              <div className={titleClassName}>{title}</div>
              {subtitle ? <div className={subtitleClassName}>{subtitle}</div> : null}
            </div>

            <div className="shrink-0 flex items-center gap-2">
              {rightActions}
              {shouldShowCloseButton ? (
                <button
                  ref={closeBtnRef}
                  type="button"
                  className={closeBtnClassName}
                  onClick={onClose}
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

          <div className={`flex-1 overflow-y-auto p-3 sm:p-5 ${contentClassName || ''}`}>{children}</div>
        </div>
      </div>
    </div>
  )
}
