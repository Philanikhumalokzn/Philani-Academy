import { PublicSolveCanvasViewer } from './PublicSolveCanvas'
import { renderKatexDisplayHtml } from '../lib/latexRender'
import type { PostReplyBlock } from '../lib/postReplyComposer'
import { normalizePostReplyBlocks } from '../lib/postReplyComposer'
import { renderTextWithKatex } from '../lib/renderTextWithKatex'

type Props = {
  blocks?: PostReplyBlock[] | null
  prompt?: string | null
  imageUrl?: string | null
  onOpenImage?: (url: string, title: string) => void
  imageTitle?: string
  compact?: boolean
  textClassName?: string
  wrapperClassName?: string
  fullBleedImages?: boolean
}

export default function PostComposerBlocksPreview({
  blocks,
  prompt,
  imageUrl,
  onOpenImage,
  imageTitle = 'Post image',
  compact = false,
  textClassName,
  wrapperClassName,
  fullBleedImages = true,
}: Props) {
  const normalizedBlocks = normalizePostReplyBlocks(Array.isArray(blocks) && blocks.length > 0 ? blocks : { studentText: prompt, imageUrl })
  if (normalizedBlocks.length === 0) return null

  const resolvedTextClassName = textClassName || (compact
    ? 'text-[14px] leading-6 text-[#334155] break-words whitespace-pre-wrap'
    : 'text-[14px] leading-6 text-[#334155] break-words whitespace-pre-wrap')

  return (
    <div className={wrapperClassName || 'space-y-3'}>
      {normalizedBlocks.map((block, index) => {
        const blockKey = `${block.id}-${index}`
        if (block.type === 'text') {
          const safeText = String(block.text || '')
          const displayText = compact && safeText.length > 280 ? `${safeText.slice(0, 280)}...` : safeText
          return <div key={blockKey} className={resolvedTextClassName}>{displayText}</div>
        }

        if (block.type === 'latex') {
          const latexHtml = renderKatexDisplayHtml(block.latex)
          if (latexHtml) {
            return <div key={blockKey} className="overflow-x-auto text-[#1c1e21]" dangerouslySetInnerHTML={{ __html: latexHtml }} />
          }
          return <div key={blockKey} className={resolvedTextClassName}>{renderTextWithKatex(block.latex)}</div>
        }

        if (block.type === 'canvas') {
          return (
            <div key={blockKey} className="overflow-hidden rounded-2xl border border-[#1d4f91]/25 bg-white shadow-sm">
              <PublicSolveCanvasViewer scene={block.scene} className="pointer-events-none" viewerHeightPx={compact ? 180 : 240} />
            </div>
          )
        }

        const imageElement = <img src={block.imageUrl} alt={imageTitle} className={fullBleedImages ? 'block h-auto w-full' : `w-full ${compact ? 'max-h-[320px] object-cover' : 'max-h-[520px] object-contain'}`} />
        const imageContainerClassName = fullBleedImages
          ? 'relative left-1/2 block w-screen max-w-none -translate-x-1/2'
          : 'overflow-hidden rounded-2xl border border-black/10 bg-[#f8fafc]'
        if (!onOpenImage) {
          return <div key={blockKey} className={imageContainerClassName}>{imageElement}</div>
        }
        return (
          <button
            key={blockKey}
            type="button"
            className={fullBleedImages ? `${imageContainerClassName} text-left` : `block w-full ${imageContainerClassName} text-left`}
            onClick={() => onOpenImage(block.imageUrl, imageTitle)}
          >
            {imageElement}
          </button>
        )
      })}
    </div>
  )
}