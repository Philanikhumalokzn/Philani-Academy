import type { ReactNode } from 'react'
import UserLink from './UserLink'

type PublicFeedPostAction = {
  label: string
  statusLabel?: string
  active?: boolean
  onClick: () => void
  icon: ReactNode
  disabled?: boolean
}

export type PublicFeedPostCardProps = {
  authorId?: string | null
  authorName: string
  authorAvatar?: string | null
  authorVerified?: boolean
  createdAt?: string | null
  title: string
  prompt?: string | null
  imageUrl?: string | null
  expanded?: boolean
  onOpen?: () => void
  onOpenImage?: (url: string, title: string) => void
  sideActions?: ReactNode
  actions?: PublicFeedPostAction[]
  children?: ReactNode
}

export default function PublicFeedPostCard({
  authorId,
  authorName,
  authorAvatar,
  authorVerified = false,
  createdAt,
  title,
  prompt,
  imageUrl,
  expanded = false,
  onOpen,
  onOpenImage,
  sideActions,
  actions = [],
  children,
}: PublicFeedPostCardProps) {
  const safeAuthorName = String(authorName || '').trim() || 'Learner'
  const safeTitle = String(title || '').trim() || 'Post'
  const safePrompt = String(prompt || '').trim()
  const safeImageUrl = String(imageUrl || '').trim()
  const safeCreatedAt = String(createdAt || '').trim()
  const safeAuthorAvatar = String(authorAvatar || '').trim()
  const hasAvatar = Boolean(safeAuthorAvatar)
  const showAuthorAvatarTick = authorVerified && hasAvatar
  const showAuthorNameTick = authorVerified && !hasAvatar

  const renderSocialActionButton = (opts: PublicFeedPostAction) => (
    <button
      key={opts.label}
      type="button"
      className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold tracking-[-0.01em] transition ${opts.active ? 'bg-[#e7f3ff] text-[#1877f2]' : 'text-[#65676b] hover:bg-[#f0f2f5]'} ${opts.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
      onClick={opts.onClick}
      disabled={opts.disabled}
    >
      <span className="shrink-0">{opts.icon}</span>
      <span className="truncate whitespace-nowrap">{opts.statusLabel || opts.label}</span>
    </button>
  )

  const body = (
    <div
      className={onOpen ? 'mt-3 block w-full cursor-pointer text-left' : 'mt-3 block w-full text-left'}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={onOpen ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      } : undefined}
      aria-expanded={onOpen ? expanded : undefined}
    >
      <div className="text-[15px] font-semibold leading-6 tracking-[-0.02em] text-[#1c1e21] break-words">{safeTitle}</div>
      {safePrompt ? <div className="mt-1.5 text-[14px] leading-6 text-[#334155] break-words">{safePrompt.slice(0, 220)}{safePrompt.length > 220 ? '...' : ''}</div> : null}
      {safeImageUrl ? (
        <button
          type="button"
          className="mt-3 block w-full overflow-hidden rounded-2xl border border-black/10 bg-[#f8fafc]"
          onClick={(event) => {
            event.stopPropagation()
            if (onOpenImage) onOpenImage(safeImageUrl, `${safeTitle} image`)
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={safeImageUrl} alt="Post screenshot" className="max-h-[420px] w-full object-cover" />
        </button>
      ) : null}
    </div>
  )

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <UserLink userId={authorId} className="shrink-0" title="View profile">
              <div className="relative overflow-visible">
                <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-black/10 bg-[#f0f2f5]">
                  {safeAuthorAvatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={safeAuthorAvatar} alt={safeAuthorName} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs font-semibold text-[#1c1e21]">{safeAuthorName.slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
                {showAuthorAvatarTick ? (
                  <span className="pointer-events-none absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-white/50 bg-blue-500 text-white shadow-md" aria-label="Verified" title="Verified">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M9.00016 16.2L4.80016 12L3.40016 13.4L9.00016 19L21.0002 7.00001L19.6002 5.60001L9.00016 16.2Z" fill="currentColor" />
                    </svg>
                  </span>
                ) : null}
              </div>
            </UserLink>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <UserLink userId={authorId} className="truncate text-[15px] font-semibold tracking-[-0.015em] text-[#1c1e21] hover:underline" title="View profile">
                  {safeAuthorName}
                </UserLink>
                {showAuthorNameTick ? (
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-white" aria-label="Verified" title="Verified">
                    <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" aria-hidden="true">
                      <path d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.12 7.18a1 1 0 0 1-1.42.006L3.29 9.01a1 1 0 1 1 1.414-1.414l3.17 3.17 6.412-6.47a1 1 0 0 1 1.418-.006z" fill="currentColor" />
                    </svg>
                  </span>
                ) : null}
              </div>
              {safeCreatedAt ? <div className="mt-0.5 text-[12px] font-medium tracking-[0.01em] text-[#65676b]">{safeCreatedAt}</div> : null}
            </div>
          </div>

          {body}
        </div>

        {sideActions ? <div className="shrink-0">{sideActions}</div> : null}
      </div>

      {actions.length > 0 ? (
        <div className="mt-2 pt-1 text-[#65676b]">
          <div className="flex items-center gap-1">
            {actions.map(renderSocialActionButton)}
          </div>
          {children ? children : null}
        </div>
      ) : children ? <div className="mt-2 pt-1 text-[#65676b]">{children}</div> : null}
    </div>
  )
}
