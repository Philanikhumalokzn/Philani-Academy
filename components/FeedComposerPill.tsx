import { useId, type ReactNode } from 'react'

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
  const cameraGradientId = useId()
  const rowClassName = isCompact
    ? 'flex items-center gap-3 bg-transparent'
    : 'flex items-center gap-4 px-5 py-5'
  const avatarClassName = isCompact
    ? 'inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-black/10 bg-[#f0f2f5] text-sm font-semibold text-[#1c1e21]'
    : 'flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-sm font-semibold text-slate-700'
  const pillClassName = isCompact
    ? 'philani-gradient-outline-soft [--philani-outline-fill:#f8fafc] flex min-w-0 flex-1 items-center rounded-full px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]'
    : 'min-w-0 flex-1 rounded-full bg-slate-50 px-4 py-3 text-[16px] font-medium tracking-[-0.02em] text-slate-800'
  const messageClassName = isCompact
    ? 'min-w-0 flex-1 py-2 text-left text-[14px] text-[#65676b]'
    : 'min-w-0 flex-1 text-left'
  const rightButtonClassName = rightActionIcon === 'camera'
    ? isCompact
      ? 'inline-flex h-10 w-10 shrink-0 items-center justify-center bg-transparent drop-shadow-[0_6px_10px_rgba(14,165,233,0.22)] transition hover:-translate-y-[1px] hover:brightness-110 active:translate-y-0'
      : 'inline-flex h-12 w-12 items-center justify-center bg-transparent drop-shadow-[0_8px_14px_rgba(14,165,233,0.18)] transition hover:-translate-y-[1px] hover:brightness-110 active:translate-y-0'
    : isCompact
      ? 'philani-gradient-outline-soft [--philani-outline-fill:#f8fafc] inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#1c1e21]'
      : 'inline-flex h-11 w-11 items-center justify-center rounded-full text-[#2fb344] transition hover:bg-[#effaf2]'
  const cameraIcon = (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="21" height="21" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <defs>
        <linearGradient id={cameraGradientId} x1="4" y1="6" x2="20" y2="18" gradientUnits="userSpaceOnUse">
          <stop stopColor="#22c55e" />
          <stop offset="0.52" stopColor="#06b6d4" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.3-1.7A2 2 0 0 1 10.9 3.5h2.2a2 2 0 0 1 1.6.8L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z" stroke={`url(#${cameraGradientId})`} />
      <circle cx="12" cy="12.5" r="3.5" stroke={`url(#${cameraGradientId})`} />
    </svg>
  )

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