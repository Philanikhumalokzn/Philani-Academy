import type { SocialActionStripAction } from '../components/SocialActionStrip'

export type BuildFeedPostCardActionsOptions = {
  /** Whether the current user has liked this post */
  liked: boolean
  likeCount?: number | null
  likeCountLabel: string
  solveCount?: number | null
  solveCountLabel: string
  shareCount?: number | null
  shareCountLabel: string
  shareStatusLabel?: string
  disabled?: boolean
  onLike: () => void
  onSolve: () => void
  onShare: () => void
}

/**
 * Returns the standard Like / Solve / Share actions array for a feed post card.
 * Shared between the dashboard feed and the profile timeline so that any change
 * to icons, labels or ordering is reflected everywhere automatically.
 */
export function buildFeedPostCardActions({
  liked,
  likeCount,
  likeCountLabel,
  solveCount,
  solveCountLabel,
  shareCount,
  shareCountLabel,
  shareStatusLabel,
  disabled,
  onLike,
  onSolve,
  onShare,
}: BuildFeedPostCardActionsOptions): SocialActionStripAction[] {
  return [
    {
      label: 'Like',
      active: liked,
      count: likeCount ?? null,
      countLabel: likeCountLabel,
      onClick: onLike,
      icon: liked ? (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
          <path d="M14 9V5.5C14 4.11929 12.8807 3 11.5 3C10.714 3 9.97327 3.36856 9.5 4L6 9V21H17.18C18.1402 21 18.9724 20.3161 19.1604 19.3744L20.7604 11.3744C21.0098 10.1275 20.0557 9 18.7841 9H14Z" />
          <path d="M6 21H4C3.44772 21 3 20.5523 3 20V10C3 9.44772 3.44772 9 4 9H6" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
          <path d="M14 9V5.5C14 4.11929 12.8807 3 11.5 3C10.714 3 9.97327 3.36856 9.5 4L6 9V21H17.18C18.1402 21 18.9724 20.3161 19.1604 19.3744L20.7604 11.3744C21.0098 10.1275 20.0557 9 18.7841 9H14Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6 21H4C3.44772 21 3 20.5523 3 20V10C3 9.44772 3.44772 9 4 9H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      label: 'Solve',
      count: solveCount ?? null,
      countLabel: solveCountLabel,
      onClick: onSolve,
      onCountClick: onSolve,
      disabled,
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
          <path d="M4 20H8L18.5 9.5C19.3284 8.67157 19.3284 7.32843 18.5 6.5C17.6716 5.67157 16.3284 5.67157 15.5 6.5L5 17V20Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14.5 7.5L17.5 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      label: 'Share',
      count: shareCount ?? null,
      countLabel: shareCountLabel,
      statusLabel: shareStatusLabel,
      onClick: onShare,
      disabled,
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
          <path d="M14 5L20 11L14 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 19V17C4 13.6863 6.68629 11 10 11H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
  ]
}
