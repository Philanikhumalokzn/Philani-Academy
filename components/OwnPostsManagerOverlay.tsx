import type { FeedPost } from '../lib/feedContract'
import FullScreenGlassOverlay from './FullScreenGlassOverlay'
import OverlayPortal from './OverlayPortal'
import PostComposerBlocksPreview from './PostComposerBlocksPreview'

type Props = {
  open: boolean
  posts: FeedPost[]
  onClose: () => void
  onEdit: (post: FeedPost) => void
  onDelete: (postId: string) => void | Promise<void>
}

export default function OwnPostsManagerOverlay({ open, posts, onClose, onEdit, onDelete }: Props) {
  if (!open) return null

  return (
    <OverlayPortal>
      <FullScreenGlassOverlay
        title="My posts"
        onClose={onClose}
        onBackdropClick={onClose}
        zIndexClassName="z-[55]"
      >
        <div className="space-y-3">
          {posts.length === 0 ? (
            <div className="text-sm text-white/70">No posts yet.</div>
          ) : (
            <ul className="space-y-2">
              {posts.map((post) => {
                const title = String(post?.title || '').trim() || 'Post'
                const prompt = String(post?.prompt || '').trim()
                const imageUrl = typeof post?.imageUrl === 'string' ? post.imageUrl.trim() : ''
                const createdAt = post?.createdAt ? new Date(post.createdAt).toLocaleString() : ''
                return (
                  <li key={String(post.id)} className="rounded-xl border border-white/10 bg-white p-3 text-[#1c1e21]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium break-words text-[#1c1e21]">{title}</div>
                        {createdAt ? <div className="text-xs text-[#65676b]">{createdAt}</div> : null}
                        <div className="mt-2">
                          <PostComposerBlocksPreview
                            blocks={Array.isArray(post?.contentBlocks) ? post.contentBlocks : null}
                            prompt={prompt}
                            imageUrl={imageUrl}
                            compact
                          />
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <button
                          type="button"
                          className="btn btn-primary shrink-0"
                          onClick={() => onEdit(post)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost shrink-0 text-xs"
                          onClick={() => void onDelete(String(post.id))}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </FullScreenGlassOverlay>
    </OverlayPortal>
  )
}