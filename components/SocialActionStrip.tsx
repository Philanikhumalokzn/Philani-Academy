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

const getActionCountText = (action: SocialActionStripAction) => {
  if (typeof action.count === 'number' && Number.isFinite(action.count)) {
    return String(action.count)
  }

  const rawLabel = String(action.countLabel || '').trim()
  if (!rawLabel) return ''

  const firstToken = rawLabel.match(/^\S+/)?.[0] || ''
  return /\d/.test(firstToken) ? firstToken : ''
}

export default function SocialActionStrip({ actions, className }: SocialActionStripProps) {
  if (!Array.isArray(actions) || actions.length === 0) return null

  return (
    <div className={className}>
      <div className="flex items-center gap-1">
        {actions.map((action, index) => {
          const countText = getActionCountText(action)
          const edgeAlignmentClassName = index === 0
            ? 'justify-start'
            : index === actions.length - 1
              ? 'justify-end'
              : 'justify-center'

          return (
          <div key={action.key || action.label || String(index)} className={`flex min-w-0 flex-1 items-center gap-1.5 ${edgeAlignmentClassName}`}>
            {countText ? (
              <button
                type="button"
                className="shrink-0 text-[11px] font-semibold leading-none whitespace-nowrap text-[#65676b] hover:text-[#1877f2]"
                onClick={(event) => {
                  event.stopPropagation()
                  action.onCountClick?.()
                }}
              >
                {countText}
              </button>
            ) : null}
            <button
              type="button"
              className={`flex min-w-0 items-center justify-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold tracking-[-0.01em] transition ${action.active ? 'text-[#1877f2]' : 'text-[#65676b] hover:bg-[#f0f2f5]'} ${action.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
              onClick={action.onClick}
              disabled={action.disabled}
            >
              <span className="shrink-0">{action.icon}</span>
              <span className="truncate whitespace-nowrap">{action.statusLabel || action.label}</span>
            </button>
          </div>
        )})}
      </div>
    </div>
  )
}