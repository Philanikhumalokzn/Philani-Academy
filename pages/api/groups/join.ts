import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserIdFromReq } from '../../../lib/auth'

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end()
  }

  const codeRaw = asString(req.body?.code).toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!codeRaw || codeRaw.length < 4) return res.status(400).json({ message: 'Join code required' })

  const group = await prisma.learningGroup.findUnique({ where: { joinCode: codeRaw } })
  if (!group || !group.joinCodeActive) return res.status(404).json({ message: 'Group not found' })

  const existing = await prisma.learningGroupMember.findUnique({
    where: { groupId_userId: { groupId: group.id, userId } },
  })

  if (!existing) {
    await prisma.learningGroupMember.create({
      data: {
        groupId: group.id,
        userId,
        memberRole: 'member',
      },
    })
  }

  try {
    const adminUsers = await prisma.user.findMany({ where: { role: 'admin' }, select: { id: true } })
    const notifyUserIds = new Set<string>()
    if (group.createdById) notifyUserIds.add(String(group.createdById))
    for (const a of adminUsers) notifyUserIds.add(a.id)

    await prisma.notification.createMany({
      data: Array.from(notifyUserIds)
        .filter((id) => id && id !== userId)
        .map((id) => ({
          userId: id,
          type: 'group_joined',
          title: 'Group joined',
          body: `Joined ${group.name}`,
          data: { groupId: group.id, groupName: group.name, userId },
        })),
    })
  } catch (notifyErr) {
    if (process.env.DEBUG === '1') console.error('Failed to create group join notification', notifyErr)
  }

  return res.status(200).json({ id: group.id, name: group.name, type: group.type, grade: group.grade })
}
