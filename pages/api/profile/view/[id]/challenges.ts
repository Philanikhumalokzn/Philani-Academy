import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../../lib/prisma'
import { getUserGrade, getUserIdFromReq, getUserRole } from '../../../../../lib/auth'
import { normalizeGradeInput } from '../../../../../lib/grades'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end()
  }

  const requesterId = await getUserIdFromReq(req)

  const targetId = String(req.query.id || '')
  if (!targetId) return res.status(400).json({ message: 'Missing user id' })

  const role = (await getUserRole(req)) || 'student'
  const isPrivileged = role === 'admin' || role === 'teacher'

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, profileVisibility: true, grade: true },
  })
  if (!target) return res.status(404).json({ message: 'User not found' })

  const isSelf = Boolean(requesterId && requesterId === targetId)

  if (!isPrivileged && !isSelf) {
    const visibility = String(target.profileVisibility || 'shared')
    if (visibility === 'private') {
      return res.status(403).json({ message: 'This profile is private' })
    }
  }

  const requesterGrade = requesterId ? normalizeGradeInput(await getUserGrade(req)) : null

  // Schema contains UserChallenge but TS may not see prisma.userChallenge yet.
  const userChallenge = (prisma as any).userChallenge as typeof prisma extends { userChallenge: infer T } ? T : any

  const where: any = { createdById: targetId }
  if (!isPrivileged && !isSelf) {
    const or: any[] = [{ audience: 'public' }]
    if (requesterGrade) {
      or.push({ audience: 'grade', grade: requesterGrade })
    }
    where.OR = or
  }

  const items = await userChallenge.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: {
      id: true,
      title: true,
      prompt: true,
      imageUrl: true,
      grade: true,
      audience: true,
      attemptsOpen: true,
      maxAttempts: true,
      createdAt: true,
      createdById: true,
    },
  })

  // Attach requester attempt counts (for non-owner viewers and response button logic)
  const attemptCounts = new Map<string, number>()
  if (requesterId) {
    const learnerResponse = (prisma as any).learnerResponse as typeof prisma extends { learnerResponse: infer T } ? T : any
    const challengeIds = items.map(i => `challenge:${i.id}`)
    const userResponses = await learnerResponse.groupBy({
      by: ['sessionKey'],
      where: {
        sessionKey: { in: challengeIds },
        userId: requesterId,
      },
      _count: {
        id: true,
      },
    })

    for (const r of userResponses) {
      attemptCounts.set(String(r.sessionKey), r._count.id)
    }
  }

  const out = items.map(item => ({
    ...item,
    myAttemptCount: attemptCounts.get(`challenge:${item.id}`) || 0,
  }))

  return res.status(200).json({ challenges: out })
}
