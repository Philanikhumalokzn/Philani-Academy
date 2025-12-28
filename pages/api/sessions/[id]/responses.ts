import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../lib/prisma'
import { getUserSubscriptionStatus, isSubscriptionGatingEnabled, subscriptionRequiredResponse } from '../../../../lib/subscription'

const MAX_LATEX_LENGTH = 50000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sessionKeyParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  if (!sessionKeyParam) {
    return res.status(400).json({ message: 'Session key is required' })
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any)?.role as string | undefined
  const userId = ((token as any)?.id || (token as any)?.sub || '').toString()
  const userEmail = ((token as any)?.email || '').toString()
  const sessionKey = sessionKeyParam.toString()

  // Subscription gating: learners must be subscribed to access session content.
  if (role === 'student') {
    const gatingEnabled = await isSubscriptionGatingEnabled()
    if (gatingEnabled) {
      const status = await getUserSubscriptionStatus(userId)
      if (!status.active) {
        const denied = subscriptionRequiredResponse()
        return res.status(denied.status).json(denied.body)
      }
    }
  }

  const session = await prisma.sessionRecord.findUnique({ where: { id: sessionKey } })
  if (!session) {
    return res.status(404).json({ message: 'Session not found' })
  }

  const isAdmin = role === 'admin'
  const isLearner = role === 'student'

  if (req.method === 'GET') {
    if (isLearner) {
      if (!userId) return res.status(400).json({ message: 'Missing user id' })
      const responses = await prisma.learnerResponse.findMany({
        where: { sessionKey, userId },
        orderBy: { updatedAt: 'desc' },
        take: 25,
      })
      return res.status(200).json({ responses })
    }

    // Admin/teacher: only the session creator may view responses.
    if (!isAdmin) {
      return res.status(403).json({ message: 'Forbidden' })
    }
    if (!userEmail || session.createdBy !== userEmail) {
      return res.status(403).json({ message: 'Forbidden' })
    }

    const responses = await prisma.learnerResponse.findMany({
      where: { sessionKey },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, name: true, email: true },
        },
      },
    })

    return res.status(200).json({ responses })
  }

  if (req.method === 'POST') {
    if (!isLearner) return res.status(403).json({ message: 'Forbidden' })
    if (!userId) return res.status(400).json({ message: 'Missing user id' })

    const { latex } = req.body || {}
    if (!latex || typeof latex !== 'string') {
      return res.status(400).json({ message: 'Latex content is required' })
    }
    const trimmed = latex.trim()
    if (!trimmed) {
      return res.status(400).json({ message: 'Latex content is required' })
    }
    if (trimmed.length > MAX_LATEX_LENGTH) {
      return res.status(400).json({ message: 'Latex content is too large' })
    }

    const record = await prisma.learnerResponse.upsert({
      where: { sessionKey_userId: { sessionKey, userId } },
      create: { sessionKey, userId, userEmail: userEmail || null, latex: trimmed },
      update: { userEmail: userEmail || null, latex: trimmed },
    })

    return res.status(200).json(record)
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end(`Method ${req.method} Not Allowed`)
}
