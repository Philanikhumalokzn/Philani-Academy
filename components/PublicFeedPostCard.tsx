import { useCallback, useState, type HTMLAttributes, type ReactNode } from 'react'
import type { PublicSolveScene } from './PublicSolveCanvas'
import type { PostReplyBlock } from '../lib/postReplyComposer'
import { normalizePostReplyBlocks } from '../lib/postReplyComposer'
import OverlayPortal from './OverlayPortal'
import PostComposerBlocksPreview from './PostComposerBlocksPreview'
import SocialActionStrip, { type SocialActionStripAction } from './SocialActionStrip'
import UserLink from './UserLink'
import ZoomableImageOverlay from './ZoomableImageOverlay'

export type PublicFeedPostCardProps = {
  postId?: string | null
  authorId?: string | null
  authorName: string
  authorAvatar?: string | null
  authorVerified?: boolean
  createdAt?: string | null
  title: string
  prompt?: string | null
  imageUrl?: string | null
  contentBlocks?: PostReplyBlock[] | null
  composerMeta?: {
    origin?: string
    sourceId?: string | null
    questionId?: string | null
    questionNumber?: string | null
    remixMmd?: string | null
    remixSelectedQuestionNumber?: string | null
  } | null
  expanded?: boolean
  onOpen?: () => void
  onOpenImage?: (url: string, title: string) => void
  onOpenCanvas?: (scene: PublicSolveScene, title: string) => void
  consumeLongPressOpen?: () => boolean
  bodyPointerProps?: Pick<HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onPointerLeave' | 'onContextMenu'>
  customBody?: ReactNode
  sideActions?: ReactNode
  actions?: SocialActionStripAction[]
  children?: ReactNode
}

export default function PublicFeedPostCard({
  postId,
  authorId,
  authorName,
  authorAvatar,
  authorVerified = false,
  createdAt,
  title,
  prompt,
  imageUrl,
  contentBlocks,
  composerMeta,
  expanded = false,
  onOpen,
  onOpenImage,
  onOpenCanvas,
  consumeLongPressOpen,
  bodyPointerProps,
  customBody,
  sideActions,
  actions = [],
  children,
}: PublicFeedPostCardProps) {
  const [fallbackImageViewer, setFallbackImageViewer] = useState<{ url: string; title: string } | null>(null)
  const safeAuthorName = String(authorName || '').trim() || 'Learner'
  const safeTitle = String(title || '').trim() || 'Post'
  const safePrompt = String(prompt || '').trim()
  const safeImageUrl = String(imageUrl || '').trim()
  const safeCreatedAt = String(createdAt || '').trim()
  const safeAuthorAvatar = String(authorAvatar || '').trim()
  const hasAvatar = Boolean(safeAuthorAvatar)
  const showAuthorAvatarTick = authorVerified && hasAvatar
  const showAuthorNameTick = authorVerified && !hasAvatar
  const normalizedBlocks = Array.isArray(contentBlocks) && contentBlocks.length > 0 ? normalizePostReplyBlocks(contentBlocks) : []
  const remixOrigin = String(composerMeta?.origin || '') === 'qb-question-post'
  const remixMmd = remixOrigin ? String(composerMeta?.remixMmd || '').trim() : ''
  const enableMmdBodyViewer = remixOrigin && Boolean(remixMmd)
  const remixSelectedQuestionNumber = enableMmdBodyViewer ? String(composerMeta?.remixSelectedQuestionNumber || composerMeta?.questionNumber || '').trim() : ''
  const contentRows = normalizedBlocks.length > 0
    ? normalizedBlocks
    : [
        ...(safePrompt ? [{ id: '__legacy_text__', type: 'text', text: safePrompt } as PostReplyBlock] : []),
        ...(safeImageUrl ? [{ id: '__legacy_image__', type: 'image', imageUrl: safeImageUrl } as PostReplyBlock] : []),
      ]
  const mmdBodyContent = enableMmdBodyViewer ? remixMmd : ''
  const isLatexOnlyBody = !enableMmdBodyViewer && contentRows.length > 0 && contentRows.every((block) => block.type === 'latex')

  const openResolvedImageViewer = useCallback((url: string, titleText: string) => {
    if (onOpenImage) {
      onOpenImage(url, titleText)
      return
    }
    setFallbackImageViewer({ url, title: titleText })
  }, [onOpenImage])

  const closeFallbackImageViewer = useCallback(() => {
    setFallbackImageViewer(null)
  }, [])

  const handleBodyClick = onOpen ? (event: any) => {
    if (consumeLongPressOpen?.()) return
    onOpen()
  } : undefined

  const handleBodyPointerDown = bodyPointerProps?.onPointerDown

  const handleBodyPointerMove = bodyPointerProps?.onPointerMove

  const handleBodyPointerUp = bodyPointerProps?.onPointerUp

  const handleBodyPointerCancel = bodyPointerProps?.onPointerCancel

  const handleBodyPointerLeave = bodyPointerProps?.onPointerLeave

  const handleBodyContextMenu = bodyPointerProps?.onContextMenu
  const latexOnlyDisableButtonSemantics = !customBody && isLatexOnlyBody

  const body = customBody ?? (
    <div
      className={onOpen ? 'mt-3 block w-full cursor-pointer text-left' : 'mt-3 block w-full text-left'}
      role={onOpen && !latexOnlyDisableButtonSemantics ? 'button' : undefined}
      tabIndex={onOpen && !latexOnlyDisableButtonSemantics ? 0 : undefined}
      onClick={handleBodyClick}
      onKeyDown={onOpen && !latexOnlyDisableButtonSemantics ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      } : undefined}
      aria-expanded={onOpen && !latexOnlyDisableButtonSemantics ? expanded : undefined}
      data-testid="public-feed-post-body"
      onPointerDown={handleBodyPointerDown}
      onPointerMove={handleBodyPointerMove}
      onPointerUp={handleBodyPointerUp}
      onPointerCancel={handleBodyPointerCancel}
      onPointerLeave={handleBodyPointerLeave}
      onContextMenu={handleBodyContextMenu}
    >
      {!enableMmdBodyViewer ? (
        <div className="px-4">
          <div className="text-[15px] font-semibold leading-6 tracking-[-0.02em] text-[#1c1e21] break-words">{safeTitle}</div>
        </div>
      ) : null}
      {enableMmdBodyViewer && mmdBodyContent && postId ? (
        <div className="mt-2">
          <iframe
            src={`/remix/preview/${postId}`}
            title={`${safeTitle} preview`}
            className="block w-full bg-white"
            style={{
              minHeight: '400px',
              maxHeight: '800px',
            }}
            sandbox="allow-same-origin allow-scripts"
            loading="lazy"
          />
        </div>
      ) : contentRows.map((block, index) => {
        const spacingClassName = index === 0 ? 'mt-1.5' : 'mt-3'
        if (block.type === 'image') {
          const imageNode = <img src={block.imageUrl} alt={`${safeTitle} image`} className="block h-auto w-full" />
          return (
            <button
              key={block.id}
              type="button"
              className={`${spacingClassName} block w-full appearance-none border-0 bg-transparent p-0 text-left`}
              data-testid="public-feed-post-image-row"
              onClick={(event) => {
                if (consumeLongPressOpen?.()) {
                  event.preventDefault()
                  event.stopPropagation()
                  return
                }
                event.stopPropagation()
                openResolvedImageViewer(block.imageUrl, `${safeTitle} image`)
              }}
            >
              {imageNode}
            </button>
          )
        }

        return (
          <div key={block.id} className={`${spacingClassName} px-4`}>
            <PostComposerBlocksPreview
              blocks={[block]}
              compact
              fullBleedImages={false}
              imageTitle={`${safeTitle} image`}
              onOpenImage={openResolvedImageViewer}
              onOpenCanvas={onOpenCanvas ? (scene) => onOpenCanvas(scene, safeTitle) : undefined}
              consumeLongPressOpen={consumeLongPressOpen}
            />
          </div>
        )
      })}
    </div>
  )

  return (
    <div>
      <div className="flex items-start justify-between gap-3 px-4 sm:px-6">
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
        </div>

        {sideActions ? <div className="shrink-0">{sideActions}</div> : null}
      </div>

      {body}

      {actions.length > 0 ? (
        <div className="mt-1 px-4 pt-0.5 sm:px-6">
          <SocialActionStrip actions={actions} className="text-[#65676b]" />
          {children ? children : null}
        </div>
      ) : children ? <div className="mt-1 px-4 pt-0.5 text-[#65676b] sm:px-6">{children}</div> : null}

      {fallbackImageViewer ? (
        <OverlayPortal>
          <ZoomableImageOverlay
            open={Boolean(fallbackImageViewer)}
            imageUrl={fallbackImageViewer.url}
            title={fallbackImageViewer.title}
            onClose={closeFallbackImageViewer}
          />
        </OverlayPortal>
      ) : null}
    </div>
  )
}
