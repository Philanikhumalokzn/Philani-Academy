import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
}

const VALID_TOPICS = [
  'Algebra', 'Functions', 'Number Patterns', 'Finance', 'Trigonometry',
  'Euclidean Geometry', 'Analytical Geometry', 'Statistics', 'Probability',
  'Calculus', 'Sequences and Series', 'Polynomials', 'Other',
]

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req })
  const role = ((token as any)?.role as string | undefined) || 'student'
  if (!token) return res.status(401).json({ message: 'Unauthenticated' })

  const id = String(req.query.id || '')
  if (!id) return res.status(400).json({ message: 'id is required' })

  if (req.method === 'PATCH') {
    if (role !== 'admin') return res.status(403).json({ message: 'Admin only' })

    const { topic, cognitiveLevel, marks, approved, questionText, latex, questionNumber } = req.body as {
      topic?: string | null
      cognitiveLevel?: number | null
      marks?: number | null
      approved?: boolean
      questionText?: string
      latex?: string | null
      questionNumber?: string
    }

    const data: any = {}
    if (topic !== undefined) data.topic = topic && VALID_TOPICS.includes(topic) ? topic : null
    if (cognitiveLevel !== undefined) {
      data.cognitiveLevel =
        typeof cognitiveLevel === 'number' && cognitiveLevel >= 1 && cognitiveLevel <= 4
          ? Math.round(cognitiveLevel)
          : null
    }
    if (marks !== undefined) {
      data.marks = typeof marks === 'number' && marks >= 0 ? Math.round(marks) : null
    }
    if (approved !== undefined) data.approved = Boolean(approved)
    if (questionText !== undefined) {
      const t = (questionText || '').trim()
      if (!t) return res.status(400).json({ message: 'questionText cannot be empty' })
      data.questionText = t
    }
    if (latex !== undefined) data.latex = latex ? String(latex).trim() || null : null
    if (questionNumber !== undefined) {
      const n = (questionNumber || '').trim()
      if (!n) return res.status(400).json({ message: 'questionNumber cannot be empty' })
      data.questionNumber = n
      // Recompute depth
      data.questionDepth = Math.max(0, n.split('.').length - 1)
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: 'No updatable fields provided' })
    }

    try {
      const updated = await prisma.examQuestion.update({
        where: { id },
        data,
        select: {
          id: true, topic: true, cognitiveLevel: true, marks: true,
          approved: true, questionText: true, latex: true, questionNumber: true, questionDepth: true,
        },
      })
      return res.status(200).json(updated)
    } catch {
      return res.status(404).json({ message: 'Question not found' })
    }
  }

  if (req.method === 'DELETE') {
    if (role !== 'admin') return res.status(403).json({ message: 'Admin only' })
    try {
      await prisma.examQuestion.delete({ where: { id } })
      return res.status(200).json({ message: 'Deleted' })
    } catch {
      return res.status(404).json({ message: 'Question not found' })
    }
  }

  res.setHeader('Allow', ['PATCH', 'DELETE'])
  return res.status(405).end('Method not allowed')
}
