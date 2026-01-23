import React, { useEffect, useRef } from 'react'

type BottomSheetProps = {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void

  backdrop?: boolean
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  lockBodyScroll?: boolean

  rightActions?: React.ReactNode

  className?: string
  zIndexClassName?: string
  style?: React.CSSProperties
  children: React.ReactNode
}

export default function BottomSheet(props: BottomSheetProps) {
  const {
    open,
    title,
    subtitle,
    onClose,

    backdrop = false,
    closeOnBackdrop = true,
    closeOnEscape = true,
    lockBodyScroll = backdrop,

    rightActions,
    className,
    zIndexClassName,
    style,
    children,
  } = props

  const previousBodyOverflowRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open || !closeOnEscape) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (e.defaultPrevented) return
      e.preventDefault()
      onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, closeOnEscape, onClose])

  useEffect(() => {
    if (!open || !lockBodyScroll) return
    if (typeof document === 'undefined') return

    if (previousBodyOverflowRef.current === null) {
      previousBodyOverflowRef.current = document.body.style.overflow || ''
    }
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousBodyOverflowRef.current || ''
      previousBodyOverflowRef.current = null
    }
  }, [open, lockBodyScroll])

  if (!open) return null

  const sheetInner = (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-3 py-2 border-b border-slate-200">
        <div className="min-w-0">
          <div className="text-sm text-slate-800 font-medium truncate">{title}</div>
          {subtitle ? <div className="text-[11px] text-slate-500 truncate">{subtitle}</div> : null}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {rightActions}
          <button
            type="button"
            className="px-2 py-1 text-slate-700"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>

      <div className="p-2">{children}</div>
    </div>
  )

  if (backdrop) {
    return (
      <div
        className={`fixed inset-0 ${zIndexClassName || 'z-50'}`}
        aria-hidden={false}
      >
        <div
          className="absolute inset-0 bg-black/40"
          onPointerDown={closeOnBackdrop ? onClose : undefined}
        />
        <div
          className={`absolute left-2 right-2 ${className || ''}`}
          style={style}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onPointerDown={e => e.stopPropagation()}
        >
          {sheetInner}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`fixed left-2 right-2 ${zIndexClassName || 'z-50'} ${className || ''}`}
      style={style}
      role="dialog"
      aria-label={title}
    >
      {sheetInner}
    </div>
  )
}
