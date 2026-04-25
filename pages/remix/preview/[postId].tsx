import { GetServerSideProps } from 'next'
import Head from 'next/head'
import dynamic from 'next/dynamic'
import prisma from '../../../lib/prisma'
import { decodeSocialPostContent } from '../../../lib/postComposerContent'

const MmdPaperViewer = dynamic(() => import('../../../components/MmdPaperViewer'), {
  ssr: false,
  loading: () => <div className="text-center py-8 text-gray-600">Loading question...</div>,
})

type RemixPreviewPageProps = {
  post: {
    id: string
    title: string
    remixMmd: string
    remixSelectedQuestionNumber?: string
    remixYear?: number
    remixMonth?: string
    remixPaper?: number
    remixTopic?: string
    remixCognitiveLevel?: number
    remixMarks?: number
  } | null
  errorMessage?: string
}

function formatMonthBadgeLabel(month: unknown): string {
  const value = String(month || '').trim()
  if (!value) return ''
  const normalized = value.toLowerCase()
  if (normalized.startsWith('sep')) return 'Sept'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatPaperBadgeLabel(paper: unknown): string {
  const n = Number(paper)
  if (!Number.isFinite(n)) return ''
  return `P${Math.max(1, Math.trunc(n))}`
}

function formatLevelBadgeLabel(level: unknown): string {
  const n = Number(level)
  if (!Number.isFinite(n)) return ''
  return `Lv${Math.max(1, Math.trunc(n))}`
}

function formatMarksBadgeLabel(marks: unknown): string {
  const n = Number(marks)
  if (!Number.isFinite(n)) return ''
  const safe = Math.max(0, Math.trunc(n))
  return `${safe} mark${safe === 1 ? '' : 's'}`
}

function toMainQuestionNumber(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return raw.split('.').map((part) => part.trim()).filter(Boolean)[0] || raw
}

export default function RemixPreviewPage({ post, errorMessage }: RemixPreviewPageProps) {
  if (errorMessage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-4">
        <div className="text-center">
          <p className="text-lg font-semibold text-red-600">{errorMessage}</p>
        </div>
      </div>
    )
  }

  if (!post) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-4">
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-600">Post not found</p>
        </div>
      </div>
    )
  }

  const mainQuestionNumber = toMainQuestionNumber(post.remixSelectedQuestionNumber)

  return (
    <>
      <Head>
        <title>{post.title} - Remix Question</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
      </Head>
      
      <div id="remix-preview-root" className="bg-white">
        {post.remixMmd && (
          <div className="remix-preview-gutter">
            <div className="remix-preview-question-header">
              <span className="remix-preview-question-label">QUESTION {mainQuestionNumber || post.remixSelectedQuestionNumber || ''}</span>
              <div className="remix-preview-badges" aria-label="Question metadata badges">
                {post.remixYear ? <span className="remix-preview-badge remix-preview-badge-neutral">{post.remixYear}</span> : null}
                {post.remixMonth ? <span className="remix-preview-badge remix-preview-badge-neutral">{formatMonthBadgeLabel(post.remixMonth)}</span> : null}
                {post.remixPaper ? <span className="remix-preview-badge remix-preview-badge-neutral">{formatPaperBadgeLabel(post.remixPaper)}</span> : null}
                {post.remixTopic ? <span className="remix-preview-badge remix-preview-badge-topic">{post.remixTopic}</span> : null}
                {post.remixCognitiveLevel ? <span className="remix-preview-badge remix-preview-badge-level">{formatLevelBadgeLabel(post.remixCognitiveLevel)}</span> : null}
                {post.remixMarks ? <span className="remix-preview-badge remix-preview-badge-neutral">{formatMarksBadgeLabel(post.remixMarks)}</span> : null}
              </div>
            </div>
            <MmdPaperViewer
              mmd={post.remixMmd}
              compact
              centerInlineMath
              autoScrollToSelectedQuestion={false}
              fullBleedMedia
              selectedQuestionNumber={post.remixSelectedQuestionNumber || undefined}
            />
          </div>
        )}
      </div>

      <style jsx global>{`
        html, body {
          margin: 0;
          padding: 0;
          background-color: white;
        }

        #remix-preview-root {
          --remix-preview-gutter: 16px;
        }

        @media (min-width: 640px) {
          #remix-preview-root {
            --remix-preview-gutter: 24px;
          }
        }

        #remix-preview-root .remix-preview-gutter {
          padding-left: var(--remix-preview-gutter);
          padding-right: var(--remix-preview-gutter);
        }

        #remix-preview-root .remix-preview-question-header {
          padding-top: 10px;
          margin-bottom: 8px;
        }

        #remix-preview-root .remix-preview-question-label {
          display: inline-block;
          font-size: 12px;
          font-weight: 700;
          color: #1c1e21;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          margin-bottom: 6px;
        }

        #remix-preview-root .remix-preview-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 8px;
        }

        #remix-preview-root .remix-preview-badge {
          display: inline-flex;
          align-items: center;
          font-size: 12px;
          border-radius: 999px;
          padding: 2px 8px;
          line-height: 1.2;
        }

        #remix-preview-root .remix-preview-badge-neutral {
          background: #f0f2f5;
          color: #4b5563;
        }

        #remix-preview-root .remix-preview-badge-topic {
          background: #e8f4fd;
          color: #1877f2;
        }

        #remix-preview-root .remix-preview-badge-level {
          background: #fff3cd;
          color: #856404;
        }

        #remix-preview-root .mmd-fullbleed-media .preview img,
        #remix-preview-root .mmd-fullbleed-media .preview-content img,
        #remix-preview-root .mmd-fullbleed-media .mmd-table-wrap img {
          display: block;
          width: calc(100% + (var(--remix-preview-gutter) * 2));
          max-width: none;
          margin-left: calc(var(--remix-preview-gutter) * -1);
          margin-right: calc(var(--remix-preview-gutter) * -1);
        }
      `}</style>
    </>
  )
}

export const getServerSideProps: GetServerSideProps<RemixPreviewPageProps> = async (context) => {
  try {
    const { postId } = context.params as { postId: string }

    if (!postId) {
      console.warn('[remix/preview] Missing postId')
      return {
        props: { post: null, errorMessage: 'Invalid post ID' },
      }
    }

    let post
    try {
      post = await prisma.socialPost.findUnique({
        where: { id: postId },
        select: {
          id: true,
          title: true,
          prompt: true,
          imageUrl: true,
        },
      })
    } catch (dbError) {
      console.error('[remix/preview] Database error:', dbError)
      return {
        props: { post: null, errorMessage: 'Database error loading post' },
      }
    }

    if (!post) {
      console.warn('[remix/preview] Post not found:', postId)
      return {
        props: { post: null, errorMessage: 'Post not found' },
      }
    }

    // Decode the stored prompt to extract composer metadata
    let decodedContent
    try {
      decodedContent = decodeSocialPostContent(post.prompt, post.imageUrl)
    } catch (decodeError) {
      console.error('[remix/preview] Decode error:', decodeError)
      return {
        props: { post: null, errorMessage: 'Error decoding post content' },
      }
    }

    const composerMeta = decodedContent?.composerMeta

    // Only render if this is a qb-question-post with remixMmd
    if (!composerMeta || composerMeta.origin !== 'qb-question-post' || !composerMeta.remixMmd) {
      console.warn('[remix/preview] Invalid post type or missing remixMmd:', { origin: composerMeta?.origin, hasRemixMmd: !!composerMeta?.remixMmd })
      return {
        props: {
          post: null,
          errorMessage: 'This post cannot be previewed as a Remix question',
        },
      }
    }

    return {
      props: {
        post: {
          id: post.id,
          title: post.title || 'Question',
          remixMmd: composerMeta.remixMmd,
          remixSelectedQuestionNumber: composerMeta.remixSelectedQuestionNumber,
          remixYear: typeof composerMeta.remixYear === 'number' ? composerMeta.remixYear : undefined,
          remixMonth: typeof composerMeta.remixMonth === 'string' ? composerMeta.remixMonth : undefined,
          remixPaper: typeof composerMeta.remixPaper === 'number' ? composerMeta.remixPaper : undefined,
          remixTopic: typeof composerMeta.remixTopic === 'string' ? composerMeta.remixTopic : undefined,
          remixCognitiveLevel: typeof composerMeta.remixCognitiveLevel === 'number' ? composerMeta.remixCognitiveLevel : undefined,
          remixMarks: typeof composerMeta.remixMarks === 'number' ? composerMeta.remixMarks : undefined,
        },
      },
    }
  } catch (error) {
    console.error('[remix/preview] Unexpected error:', error)
    return {
      props: { post: null, errorMessage: 'Error loading preview' },
    }
  }
}
