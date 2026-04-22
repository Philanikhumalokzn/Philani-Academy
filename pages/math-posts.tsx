import React, { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import MathPostCard from '../components/MathPostCard'

interface MathPost {
  id: string
  latex: string
  createdById: string
  createdAt: string
  createdByName?: string
}

export default function MathPostsFeed() {
  const { data: session } = useSession()
  const [posts, setPosts] = useState<MathPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchMathPosts()
  }, [])

  const fetchMathPosts = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch('/api/math-posts?limit=100')
      if (!response.ok) {
        throw new Error('Failed to fetch math posts')
      }
      const data = await response.json()
      setPosts(data.posts || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      console.error('Failed to fetch math posts:', err)
    } finally {
      setLoading(false)
    }
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Math Posts</h1>
          <p className="text-gray-600">Please sign in to view math posts</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Math Posts Feed</h1>
          <p className="text-gray-600">Community math solutions and explanations</p>
        </div>

        {loading && (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-700">Error: {error}</p>
            <button
              onClick={fetchMathPosts}
              className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && posts.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg">No math posts yet</p>
            <p className="text-gray-400 text-sm mt-1">Be the first to share a math solution!</p>
          </div>
        )}

        <div className="space-y-4">
          {posts.map((post) => (
            <MathPostCard
              key={post.id}
              id={post.id}
              latex={post.latex}
              authorName={post.createdByName || 'Anonymous'}
              createdAt={post.createdAt}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
