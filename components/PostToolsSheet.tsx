import BottomSheet from './BottomSheet'

type Props = {
  open: boolean
  hasDraft: boolean
  onClose: () => void
  onOpenManager: () => void
  onCreatePost: () => void
  onPostFromScreenshot: () => void
  onContinueDraft: () => void
}

export default function PostToolsSheet({
  open,
  hasDraft,
  onClose,
  onOpenManager,
  onCreatePost,
  onPostFromScreenshot,
  onContinueDraft,
}: Props) {
  if (!open) return null

  return (
    <BottomSheet
      open
      backdrop
      title="Your posts"
      subtitle="Create and manage your challenge posts"
      onClose={onClose}
      className="rounded-2xl"
      style={{ bottom: 80 }}
    >
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50"
          onClick={onOpenManager}
        >
          <span>
            <span className="block text-sm font-semibold text-slate-900">My posts</span>
            <span className="block text-xs text-slate-500">Open your full post manager, including edit and delete tools.</span>
          </span>
          <span className="text-slate-400">{'>'}</span>
        </button>

        <button
          type="button"
          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50"
          onClick={onCreatePost}
        >
          <span>
            <span className="block text-sm font-semibold text-slate-900">Create post</span>
            <span className="block text-xs text-slate-500">Start a new text or image post for the public feed.</span>
          </span>
          <span className="text-slate-400">{'>'}</span>
        </button>

        <button
          type="button"
          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50"
          onClick={onPostFromScreenshot}
        >
          <span>
            <span className="block text-sm font-semibold text-slate-900">Post from screenshot</span>
            <span className="block text-xs text-slate-500">Upload a screenshot and turn it into a post or a quiz.</span>
          </span>
          <span className="text-slate-400">{'>'}</span>
        </button>

        {hasDraft ? (
          <button
            type="button"
            className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50"
            onClick={onContinueDraft}
          >
            <span>
              <span className="block text-sm font-semibold text-slate-900">Continue draft</span>
              <span className="block text-xs text-slate-500">Resume the composer with your current content.</span>
            </span>
            <span className="text-slate-400">{'>'}</span>
          </button>
        ) : null}
      </div>
    </BottomSheet>
  )
}