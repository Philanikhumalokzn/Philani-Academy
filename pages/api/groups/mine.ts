import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserIdFromReq } from '../../../lib/auth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end()
  }

  const memberships = await prisma.learningGroupMember.findMany({
    where: { userId },
    include: {
      group: {
        include: {
          _count: { select: { members: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const out = memberships.map((m) => ({
    membershipId: m.id,
    memberRole: m.memberRole,
    joinedAt: m.createdAt,
    group: {
      id: m.group.id,
      name: m.group.name,
      type: m.group.type,
      grade: m.group.grade,
      joinCodeActive: m.group.joinCodeActive,
      membersCount: (m.group as any)?._count?.members ?? 0,
      createdAt: m.group.createdAt,
      updatedAt: m.group.updatedAt,
    },
  }))

  return res.status(200).json(out)
}
