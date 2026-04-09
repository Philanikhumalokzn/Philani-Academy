import type { ReactNode } from 'react'

type FeedComposerPillProps = {
  avatarUrl?: string | null
  avatarAlt: string
  avatarFallback: ReactNode
  message: string
  onMessageClick?: () => void
  messageAriaLabel?: string
  rightActionIcon: 'menu' | 'camera'
  onRightActionClick?: () => void
  rightActionLabel: string
  rightActionTitle?: string
  size?: 'compact' | 'profile'
}

const cameraIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.3-1.7A2 2 0 0 1 10.9 3.5h2.2a2 2 0 0 1 1.6.8L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z" />
    <circle cx="12" cy="12.5" r="3.5" />
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
  const rightButtonClassName = rightActionIcon === 'camera'
    ? isCompact
      ? 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/70 bg-[linear-gradient(135deg,#22c55e_0%,#06b6d4_52%,#2563eb_100%)] text-white shadow-[0_10px_22px_rgba(14,165,233,0.26)] transition hover:-translate-y-[1px] hover:brightness-105 active:translate-y-0'
      : 'inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-[linear-gradient(135deg,#22c55e_0%,#06b6d4_52%,#2563eb_100%)] text-white shadow-[0_12px_26px_rgba(14,165,233,0.22)] transition hover:-translate-y-[1px] hover:brightness-105 active:translate-y-0'
    : isCompact
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
        {rightActionIcon === 'menu' ? menuIcon : cameraIcon}
      </button>
    </div>
  )
}