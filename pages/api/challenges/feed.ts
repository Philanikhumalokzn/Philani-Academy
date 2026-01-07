import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserGrade, getUserIdFromReq, getUserRole } from '../../../lib/auth'
import { normalizeGradeInput } from '../../../lib/grades'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requesterId = await getUserIdFromReq(req)
  if (!requesterId) return res.status(401).json({ message: 'Unauthorized' })

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end('Method not allowed')
  }

  const role = (await getUserRole(req)) || 'student'
  const isPrivileged = role === 'admin' || role === 'teacher'
  const requesterGrade = normalizeGradeInput(await getUserGrade(req))

  const userChallenge = (prisma as any).userChallenge as typeof prisma extends { userChallenge: infer T } ? T : any

  const where: any = {
    createdById: { not: requesterId },
    audience: { in: ['public', 'grade'] },
  }

  if (!isPrivileged) {
    // Students: only allow grade posts that match their grade.
    where.OR = [
      { audience: 'public' },
      ...(requesterGrade ? [{ audience: 'grade', grade: requesterGrade }] : []),
    ]
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
      createdById: true,
      createdBy: {
        select: {
          id: true,
          name: true,
          avatar: true,
          grade: true,
        },
      },
    },
  })

  return res.status(200).json({ posts: items })
}
