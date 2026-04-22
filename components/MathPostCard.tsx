import { renderKatexDisplayHtml } from '../lib/latexRender'
import PublicFeedPostCard from './PublicFeedPostCard'

interface MathPostCardProps {
  id: string
  latex: string
  authorId?: string | null
  authorName?: string
  createdAt: string
}

export default function MathPostCard({ id, latex, authorId, authorName, createdAt }: MathPostCardProps) {
  let htmlContent = ''
  try {
    htmlContent = renderKatexDisplayHtml(latex)
  } catch (error) {
    console.error('Failed to render LaTeX:', error)
    htmlContent = `<div class="text-red-600 text-sm">Failed to render: ${latex}</div>`
  }

  const date = new Date(createdAt)
  const formatted = date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  const safeAuthorName = String(authorName || '').trim() || 'Anonymous'

  return (
    <PublicFeedPostCard
      authorId={authorId}
      authorName={safeAuthorName}
      createdAt={formatted}
      title="Math Post"
      customBody={(
        <div className="mt-3 block w-full text-left" data-testid={`math-post-${id}`}>
          <div className="px-4">
            <div className="text-[15px] font-semibold leading-6 tracking-[-0.02em] text-[#1c1e21] break-words">Math Post</div>
          </div>
          <div className="mt-3 px-4">
            <div
              className="overflow-x-auto text-[#1c1e21]"
              dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
          </div>
        </div>
      )}
      actions={[
        {
          label: 'Like',
          onClick: () => {},
          icon: (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
              <path d="M14 9V5.5C14 4.11929 12.8807 3 11.5 3C10.714 3 9.97327 3.36856 9.5 4L6 9V21H17.18C18.1402 21 18.9724 20.3161 19.1604 19.3744L20.7604 11.3744C21.0098 10.1275 20.0557 9 18.7841 9H14Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M6 21H4C3.44772 21 3 20.5523 3 20V10C3 9.44772 3.44772 9 4 9H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ),
        },
        {
          label: 'Reply',
          onClick: () => {},
          icon: (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
              <path d="M4 20H8L18.5 9.5C19.3284 8.67157 19.3284 7.32843 18.5 6.5C17.6716 5.67157 16.3284 5.67157 15.5 6.5L5 17V20Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M14.5 7.5L17.5 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ),
        },
        {
          label: 'Share',
          onClick: () => {},
          icon: (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
              <path d="M14 5L20 11L14 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 19V17C4 13.6863 6.68629 11 10 11H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ),
        },
      ]}
    />
  )
}
