import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../lib/prisma'
import { getUserIdFromReq } from '../../../../lib/auth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  const groupId = String(req.query.id || '')
  if (!groupId) return res.status(400).json({ message: 'Missing group id' })

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end()
  }

  const group = await prisma.learningGroup.findUnique({
    where: { id: groupId },
    select: { id: true, name: true, createdById: true, allowJoinRequests: true }
  })
  if (!group) return res.status(404).json({ message: 'Group not found' })
  if (!group.allowJoinRequests) return res.status(403).json({ message: 'This group is not accepting join requests' })

  const existingMembership = await prisma.learningGroupMember.findUnique({
    where: { groupId_userId: { groupId, userId } }
  })
  if (existingMembership) return res.status(200).json({ message: 'Already a member' })

  const existing = await prisma.groupJoinRequest.findFirst({
    where: { groupId, requestedById: userId, status: 'pending' },
    select: { id: true }
  })

  const request = existing
    ? await prisma.groupJoinRequest.update({ where: { id: existing.id }, data: { createdAt: new Date() } })
    : await prisma.groupJoinRequest.create({
        data: {
          groupId,
          requestedById: userId,
          status: 'pending'
        }
      })

  const adminUsers = await prisma.user.findMany({ where: { role: 'admin' }, select: { id: true } })
  const notifyUserIds = new Set<string>()
  if (group.createdById) notifyUserIds.add(group.createdById)
  for (const a of adminUsers) notifyUserIds.add(a.id)

  await prisma.notification.createMany({
    data: Array.from(notifyUserIds)
      .filter((id) => id && id !== userId)
      .map((id) => ({
        userId: id,
        type: 'group_join_request',
        title: 'Join request',
        body: `A learner requested to join ${group.name}`,
        data: { requestId: request.id, groupId: group.id, groupName: group.name, requestedById: userId }
      }))
  })

  return res.status(200).json({ id: request.id, status: request.status })
}
