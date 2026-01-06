import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../../lib/prisma'
import { getUserGrade, getUserIdFromReq, getUserRole } from '../../../../../lib/auth'
import { normalizeGradeInput } from '../../../../../lib/grades'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requesterId = await getUserIdFromReq(req)
  if (!requesterId) return res.status(401).json({ message: 'Unauthorized' })

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end()
  }

  const targetId = String(req.query.id || '')
  if (!targetId) return res.status(400).json({ message: 'Missing user id' })

  const role = (await getUserRole(req)) || 'student'
  const isPrivileged = role === 'admin' || role === 'teacher'

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, profileVisibility: true, grade: true },
  })
  if (!target) return res.status(404).json({ message: 'User not found' })

  const isSelf = requesterId === targetId

  if (!isPrivileged && !isSelf) {
    const visibility = String(target.profileVisibility || 'shared')
    if (visibility === 'private') {
      return res.status(403).json({ message: 'This profile is private' })
    }

    // If profile is discoverable, allow access without shared membership.
    if (visibility !== 'discoverable') {
      const shared = await prisma.learningGroupMember.findFirst({
        where: {
          userId: requesterId,
          group: {
            members: {
              some: { userId: targetId },
            },
          },
        },
        select: { id: true },
      })

      if (!shared) return res.status(403).json({ message: 'Forbidden' })
    }
  }

  const requesterGrade = normalizeGradeInput(await getUserGrade(req))

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
      createdAt: true,
    },
  })

  return res.status(200).json({ challenges: items })
}
