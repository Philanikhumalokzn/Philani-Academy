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
      
      <div className="flex min-h-screen flex-col bg-white p-4 sm:p-6">
        {/* Question container styled like Remix search result */}
        <div className="w-full max-w-4xl mx-auto">
          {/* Question title */}
          {post.title && (
            <div className="mb-4 border-b border-gray-200 pb-4">
              <h1 className="text-xl font-semibold text-gray-900">{post.title}</h1>
            </div>
          )}

          {/* Question viewer */}
          {post.remixMmd && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 sm:p-6">
              <MmdPaperViewer
                mmd={post.remixMmd}
                compact={false}
                centerInlineMath
                autoScrollToSelectedQuestion={false}
                selectedQuestionNumber={post.remixSelectedQuestionNumber || undefined}
              />
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        html, body {
          margin: 0;
          padding: 0;
          background-color: white;
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
        revalidate: 10,
      }
    }

    if (!post) {
      console.warn('[remix/preview] Post not found:', postId)
      return {
        props: { post: null, errorMessage: 'Post not found' },
        revalidate: 60,
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
        revalidate: 10,
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
        revalidate: 60,
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
      revalidate: 3600, // ISR: revalidate every hour
    }
  } catch (error) {
    console.error('[remix/preview] Unexpected error:', error)
    return {
      props: { post: null, errorMessage: 'Error loading preview' },
      revalidate: 10,
    }
  }
}
