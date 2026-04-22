import type { NextApiRequest, NextApiResponse } from 'next'
import { getUserIdFromReq } from '../../../lib/auth'

// In-memory store for now (will migrate to Prisma if needed)
const mathPosts: Array<{
  id: string
  latex: string
  createdById: string
  createdByName?: string
  createdAt: string
}> = []

function generateId() {
  return `mp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const userId = await getUserIdFromReq(req)
    if (!userId) return res.status(401).json({ message: 'Unauthorized' })

    if (req.method === 'POST') {
      const { latex } = req.body || {}
      const latexStr = typeof latex === 'string' ? latex.trim() : ''

      if (!latexStr) {
        return res.status(400).json({ message: 'LaTeX is required' })
      }

      const post = {
        id: generateId(),
        latex: latexStr,
        createdById: userId,
        createdByName: 'Anonymous',
        createdAt: new Date().toISOString(),
      }

      mathPosts.unshift(post)
      return res.status(200).json(post)
    }

    if (req.method === 'GET') {
      const parsedLimit = parseInt(String(req.query.limit || '50'), 10)
      const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50
      const posts = mathPosts.slice(0, limit)
      return res.status(200).json({ posts })
    }

    res.setHeader('Allow', ['GET', 'POST'])
    return res.status(405).end('Method Not Allowed')
  } catch (error) {
    console.error('math-posts API error:', error)
    return res.status(500).json({ message: 'Internal server error' })
  }
}
