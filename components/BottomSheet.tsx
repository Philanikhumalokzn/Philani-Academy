import React from 'react'

type BottomSheetProps = {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void

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
    rightActions,
    className,
    zIndexClassName,
    style,
    children,
  } = props

  if (!open) return null

  return (
    <div
      className={`fixed left-2 right-2 ${zIndexClassName || 'z-50'} ${className || ''}`}
      style={style}
      role="dialog"
      aria-label={title}
    >
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
    </div>
  )
}
