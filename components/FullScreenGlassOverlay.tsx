import React, { useEffect, useRef } from 'react'

export type FullScreenGlassOverlayProps = {
  title: string
  subtitle?: string

  onClose: () => void
  onBackdropClick?: () => void

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
        e.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    // Focus the close button for accessibility.
    // Use rAF to ensure it exists after render.
    const raf = requestAnimationFrame(() => closeBtnRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [])

  const handleBackdropClick = onBackdropClick || onClose

  return (
    <div className={`fixed inset-0 ${zIndexClassName || 'z-[80]'} ${className || ''}`} role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 philani-overlay-backdrop philani-overlay-backdrop-enter"
        onClick={handleBackdropClick}
      />

      <div className="absolute inset-0 p-2 sm:p-6" onClick={handleBackdropClick}>
        <div
          className="h-full w-full overflow-hidden rounded-2xl border border-white/10 bg-white/10 backdrop-blur-xl shadow-2xl flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-3 sm:p-4 border-b border-white/10 flex items-center justify-between gap-3">
            <div className="shrink-0 flex items-center gap-2">
              {leftActions}
            </div>

            <div className="min-w-0 flex-1">
              <div className="font-semibold text-white truncate">{title}</div>
              {subtitle ? <div className="text-xs text-white/70 truncate">{subtitle}</div> : null}
            </div>

            <div className="shrink-0 flex items-center gap-2">
              {rightActions}
              <button
                ref={closeBtnRef}
                type="button"
                className="w-9 h-9 inline-flex items-center justify-center rounded-full border border-white/10 bg-white/10 hover:bg-white/15 text-white"
                onClick={onClose}
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
            </div>
          </div>

          <div className={`flex-1 overflow-y-auto p-3 sm:p-5 ${contentClassName || ''}`}>{children}</div>
        </div>
      </div>
    </div>
  )
}
