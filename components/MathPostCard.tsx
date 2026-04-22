import { renderKatexDisplayHtml } from '../lib/latexRender'

interface MathPostCardProps {
  id: string
  latex: string
  authorName?: string
  createdAt: string
}

export default function MathPostCard({ id, latex, authorName, createdAt }: MathPostCardProps) {
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

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="mb-4">
        <div
          className="katex-display-container overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
      </div>
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{authorName || 'Anonymous'}</span>
          <span>{formatted}</span>
      </div>
    </div>
  )
}
