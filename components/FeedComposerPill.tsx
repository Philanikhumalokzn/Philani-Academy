import type { ReactNode } from 'react'

type FeedComposerPillProps = {
  avatarUrl?: string | null
  avatarAlt: string
  avatarFallback: ReactNode
  message: string
  onMessageClick?: () => void
  messageAriaLabel?: string
  rightActionIcon: 'menu' | 'photo'
  onRightActionClick?: () => void
  rightActionLabel: string
  rightActionTitle?: string
  size?: 'compact' | 'profile'
}

const photoIcon = (
  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden="true">
    <path d="M6.5 5A3.5 3.5 0 0 0 3 8.5v7A3.5 3.5 0 0 0 6.5 19h11a3.5 3.5 0 0 0 3.5-3.5v-7A3.5 3.5 0 0 0 17.5 5h-2.59l-.7-1.05A2 2 0 0 0 12.54 3h-1.08a2 2 0 0 0-1.67.95L9.09 5H6.5Zm5.5 3.25A4.25 4.25 0 1 1 7.75 12 4.25 4.25 0 0 1 12 8.25Zm0 1.5A2.75 2.75 0 1 0 14.75 12 2.75 2.75 0 0 0 12 9.75Z" />
  </svg>
)

const menuIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 8H18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M9 12H18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M12 16H18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
)

export default function FeedComposerPill({
  avatarUrl,
  avatarAlt,
  avatarFallback,
  message,
  onMessageClick,
  messageAriaLabel,
  rightActionIcon,
  onRightActionClick,
  rightActionLabel,
  rightActionTitle,
  size = 'profile',
}: FeedComposerPillProps) {
  const isCompact = size === 'compact'
  const rowClassName = isCompact
    ? 'flex items-center gap-3 bg-transparent'
    : 'flex items-center gap-4 px-5 py-5'
  const avatarClassName = isCompact
    ? 'inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-black/10 bg-[#f0f2f5] text-sm font-semibold text-[#1c1e21]'
    : 'flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-sm font-semibold text-slate-700'
  const pillClassName = isCompact
    ? 'flex min-w-0 flex-1 items-center rounded-full border border-black/10 bg-[#f8fafc] px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]'
    : 'min-w-0 flex-1 rounded-full bg-slate-50 px-4 py-3 text-[16px] font-medium tracking-[-0.02em] text-slate-800'
  const messageClassName = isCompact
    ? 'min-w-0 flex-1 py-2 text-left text-[14px] text-[#65676b]'
    : 'min-w-0 flex-1 text-left'
  const rightButtonClassName = isCompact
    ? 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 bg-[#f8fafc] text-[#1c1e21]'
    : 'inline-flex h-11 w-11 items-center justify-center rounded-full text-[#2fb344] transition hover:bg-[#effaf2]'

  return (
    <div className={rowClassName}>
      <span className={avatarClassName}>
        {avatarUrl ? (
          <img src={avatarUrl} alt={avatarAlt} className="h-full w-full object-cover" />
        ) : (
          avatarFallback
        )}
      </span>
      <div className={pillClassName}>
        {onMessageClick ? (
          <button
            type="button"
            className={messageClassName}
            onClick={onMessageClick}
            aria-label={messageAriaLabel || message}
          >
            {message}
          </button>
        ) : (
          <div className={messageClassName}>{message}</div>
        )}
      </div>
      <button
        type="button"
        className={rightButtonClassName}
        onClick={onRightActionClick}
        aria-label={rightActionLabel}
        title={rightActionTitle || rightActionLabel}
      >
        {rightActionIcon === 'menu' ? menuIcon : photoIcon}
      </button>
    </div>
  )
}