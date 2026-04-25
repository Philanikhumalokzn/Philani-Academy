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
  } | null
  errorMessage?: string
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
