import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../lib/prisma'
import { getUserSubscriptionStatus, isSubscriptionGatingEnabled, subscriptionRequiredResponse } from '../../../../lib/subscription'

const MAX_LATEX_LENGTH = 50000

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

  if (req.method === 'GET') {
    // Learners only fetch their own responses.
    const records = await prisma.learnerResponse.findMany({
      where: { sessionKey, userId },
      orderBy: { updatedAt: 'desc' },
      take: 25,
    })
    return res.status(200).json({ responses: records })
  }

  if (req.method === 'POST') {
    const { latex } = req.body || {}
    if (!latex || typeof latex !== 'string') {
      return res.status(400).json({ message: 'Latex is required' })
    }
    if (latex.length > MAX_LATEX_LENGTH) {
      return res.status(400).json({ message: 'Latex is too large' })
    }

    try {
      const record = await prisma.learnerResponse.upsert({
        where: {
          sessionKey_userId: {
            sessionKey,
            userId,
          },
        },
        update: {
          latex,
          userEmail,
        },
        create: {
          sessionKey,
          userId,
          userEmail,
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
