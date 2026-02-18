import React, { useEffect, useMemo, useRef, useState } from 'react'

type BottomSheetProps = {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void

  backdrop?: boolean
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  lockBodyScroll?: boolean

  animate?: boolean

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

    animate = true,

    rightActions,
    className,
    zIndexClassName,
    style,
    children,
  } = props

  const previousBodyOverflowRef = useRef<string | null>(null)

  const [shouldRender, setShouldRender] = useState(open)
  const [animPhase, setAnimPhase] = useState<'enter' | 'entered' | 'exit'>(open ? 'entered' : 'enter')

  const motion = useMemo(() => {
    if (!animate) {
      return {
        backdrop: '',
        sheet: '',
      }
    }

    const common = 'motion-reduce:transition-none motion-reduce:transform-none'
    return {
      backdrop:
        `${common} transition-opacity duration-150 ` +
        (animPhase === 'entered' ? 'opacity-100' : 'opacity-0'),
      sheet:
        `${common} transition-[transform,opacity] duration-150 ease-out ` +
        (animPhase === 'entered' ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'),
    }
  }, [animate, animPhase])

  useEffect(() => {
    if (open) {
      setShouldRender(true)
      setAnimPhase('enter')
      const raf = requestAnimationFrame(() => setAnimPhase('entered'))
      return () => cancelAnimationFrame(raf)
    }

    if (!shouldRender) return
    if (!animate) {
      setShouldRender(false)
      return
    }

    setAnimPhase('exit')
    const t = window.setTimeout(() => setShouldRender(false), 150)
    return () => window.clearTimeout(t)
  }, [open, shouldRender, animate])

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
    if (!shouldRender || !lockBodyScroll) return
    if (typeof document === 'undefined') return

    if (previousBodyOverflowRef.current === null) {
      previousBodyOverflowRef.current = document.body.style.overflow || ''
    }
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousBodyOverflowRef.current || ''
      previousBodyOverflowRef.current = null
    }
  }, [shouldRender, lockBodyScroll])

  if (!shouldRender) return null

  const safeAreaFrameStyle: React.CSSProperties = {
    paddingTop: 'max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px))',
    paddingRight: 'max(var(--app-safe-right, 0px), env(safe-area-inset-right, 0px))',
    paddingBottom: 'max(var(--app-safe-bottom, 0px), env(safe-area-inset-bottom, 0px))',
    paddingLeft: 'max(var(--app-safe-left, 0px), env(safe-area-inset-left, 0px))',
  }

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
        style={safeAreaFrameStyle}
        aria-hidden={false}
      >
        <div
          className={`absolute inset-0 bg-black/40 ${motion.backdrop}`}
          onPointerDown={closeOnBackdrop ? onClose : undefined}
        />
        <div
          className={`absolute left-2 right-2 ${className || ''} ${motion.sheet}`}
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
      className={`fixed inset-0 ${zIndexClassName || 'z-50'} pointer-events-none`}
      style={safeAreaFrameStyle}
    >
      <div
        className={`absolute left-2 right-2 pointer-events-auto ${className || ''} ${motion.sheet}`}
        style={style}
        role="dialog"
        aria-label={title}
      >
        {sheetInner}
      </div>
    </div>
  )
}

(BottomSheet as any).displayName = 'BottomSheet'
