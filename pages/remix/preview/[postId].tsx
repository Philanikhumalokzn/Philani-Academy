import { GetServerSideProps } from 'next'
import Head from 'next/head'
import prisma from '../../../lib/prisma'
import { decodeSocialPostContent } from '../../../lib/postComposerContent'
import MmdPaperViewer from '../../../components/MmdPaperViewer'

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
      return {
        props: { post: null, errorMessage: 'Invalid post ID' },
      }
    }

    const post = await prisma.socialPost.findUnique({
      where: { id: postId },
      select: {
        id: true,
        title: true,
        prompt: true,
        imageUrl: true,
      },
    })

    if (!post) {
      return {
        props: { post: null, errorMessage: 'Post not found' },
      }
    }

    // Decode the stored prompt to extract composer metadata
    const decodedContent = decodeSocialPostContent(post.prompt, post.imageUrl)
    const composerMeta = decodedContent.composerMeta || {}

    // Only render if this is a qb-question-post with remixMmd
    if (composerMeta.origin !== 'qb-question-post' || !composerMeta.remixMmd) {
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
      revalidate: 3600, // ISR: revalidate every hour
    }
  } catch (error) {
    console.error('[remix/preview] Error:', error)
    return {
      props: { post: null, errorMessage: 'Error loading preview' },
      revalidate: 10,
    }
  }
}
