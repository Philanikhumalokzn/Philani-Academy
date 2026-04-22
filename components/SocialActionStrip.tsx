import type { ReactNode } from 'react'

export type SocialActionStripAction = {
  key?: string
  label: string
  statusLabel?: string
  active?: boolean
  onClick: () => void
  icon: ReactNode
  disabled?: boolean
  count?: number | null
  countLabel?: string
  onCountClick?: () => void
}

type SocialActionStripProps = {
  actions: SocialActionStripAction[]
  className?: string
}

export default function SocialActionStrip({ actions, className }: SocialActionStripProps) {
  if (!Array.isArray(actions) || actions.length === 0) return null

  return (
    <div className={className}>
      <div className="flex items-center gap-1">
        {actions.map((action, index) => (
          <div key={action.key || action.label || String(index)} className="flex min-w-0 flex-1 flex-col items-center justify-center">
            <div className="mb-1 flex h-[14px] items-center">
              <button
                type="button"
                className={`text-[11px] font-semibold leading-none whitespace-nowrap ${
                  action.countLabel ? 'text-[#65676b] hover:text-[#1877f2]' : 'invisible pointer-events-none'
                }`}
                onClick={(event) => {
                  event.stopPropagation()
                  action.onCountClick?.()
                }}
              >
                {action.countLabel || '0'}
              </button>
            </div>
            <button
              type="button"
              className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold tracking-[-0.01em] transition ${action.active ? 'bg-[#e7f3ff] text-[#1877f2]' : 'text-[#65676b] hover:bg-[#f0f2f5]'} ${action.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
              onClick={action.onClick}
              disabled={action.disabled}
            >
              <span className="shrink-0">{action.icon}</span>
              <span className="truncate whitespace-nowrap">{action.statusLabel || action.label}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}