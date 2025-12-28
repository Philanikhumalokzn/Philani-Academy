import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../lib/prisma'
import { getUserSubscriptionStatus, isSubscriptionGatingEnabled, subscriptionRequiredResponse } from '../../../../lib/subscription'

const MAX_LATEX_LENGTH = 50000
const MAX_PROMPT_LENGTH = 5000
const MAX_QUIZ_ID_LENGTH = 80

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sessionKeyParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  if (!sessionKeyParam) {
    return res.status(400).json({ message: 'Session id is required' })
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const sessionKey = sessionKeyParam.toString()
  const userId = ((token as any)?.id || (token as any)?.sub || '')?.toString()
  const userEmail = ((token as any)?.email || null) as string | null
  const role = (token as any)?.role as string | undefined
  const isAdmin = role === 'admin'

  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  // Subscription gating: learners must be subscribed to access session content.
  if (!isAdmin && role === 'student') {
    const gatingEnabled = await isSubscriptionGatingEnabled()
    if (gatingEnabled) {
      const status = await getUserSubscriptionStatus(userId)
      if (!status.active) {
        const denied = subscriptionRequiredResponse()
        return res.status(denied.status).json(denied.body)
      }
    }
  }

  // Some environments may have a stale/generated Prisma client type surface.
  // The schema contains `LearnerResponse`, but TS may not see `prisma.learnerResponse` yet.
  const learnerResponse = (prisma as any).learnerResponse as typeof prisma extends { learnerResponse: infer T } ? T : any

  if (req.method === 'GET') {
    // Learners only fetch their own responses.
    const records = await learnerResponse.findMany({
      where: { sessionKey, userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    })
    return res.status(200).json({ responses: records })
  }

  if (req.method === 'POST') {
    const { latex, quizId, prompt } = req.body || {}
    if (!latex || typeof latex !== 'string') {
      return res.status(400).json({ message: 'Latex is required' })
    }
    if (latex.length > MAX_LATEX_LENGTH) {
      return res.status(400).json({ message: 'Latex is too large' })
    }

    const safeQuizId = (typeof quizId === 'string' && quizId.trim().length > 0)
      ? quizId.trim().slice(0, MAX_QUIZ_ID_LENGTH)
      : 'default'
    const safePrompt = (typeof prompt === 'string' && prompt.trim().length > 0)
      ? prompt.trim().slice(0, MAX_PROMPT_LENGTH)
      : null

    try {
      const record = await learnerResponse.upsert({
        where: {
          sessionKey_userId_quizId: {
            sessionKey,
            userId,
            quizId: safeQuizId,
          },
        },
        update: {
          latex,
          userEmail,
          quizId: safeQuizId,
          prompt: safePrompt,
        },
        create: {
          sessionKey,
          userId,
          userEmail,
          quizId: safeQuizId,
          prompt: safePrompt,
          latex,
        },
      })

      return res.status(200).json(record)
    } catch (err: any) {
      console.error('Failed to save response', err)
      return res.status(500).json({ message: err?.message || 'Failed to save response' })
    }
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end(`Method ${req.method} Not Allowed`)
}
