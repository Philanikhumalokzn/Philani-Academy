import { useEffect, useRef, useState } from 'react'

export type TaskManageAction = {
  label: string
  onClick: () => void
  disabled?: boolean
  variant?: 'default' | 'danger'
}

export default function TaskManageMenu({
  actions,
  label = 'Manage',
  className,
  align = 'right',
}: {
  actions: TaskManageAction[]
  label?: string
  className?: string
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (rootRef.current && rootRef.current.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  if (!actions.length) return null

  return (
    <div ref={rootRef} className={`relative inline-flex ${className || ''}`}>
      <button
        type="button"
        className="btn btn-ghost text-xs"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        {label}
      </button>
      {open && (
        <div
          className={`absolute z-50 mt-2 min-w-[160px] rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur shadow-lg ${
            align === 'left' ? 'left-0' : 'right-0'
          }`}
        >
          <div className="py-1">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className={`w-full text-left px-3 py-2 text-xs hover:bg-white/10 ${
                  action.variant === 'danger' ? 'text-red-300' : 'text-white'
                }`}
                disabled={action.disabled}
                onClick={() => {
                  if (action.disabled) return
                  action.onClick()
                  setOpen(false)
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
