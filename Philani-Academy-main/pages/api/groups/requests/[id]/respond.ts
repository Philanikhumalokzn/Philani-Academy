import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../../lib/prisma'
import { getUserIdFromReq, getUserRole } from '../../../../../lib/auth'

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  const requestId = String(req.query.id || '')
  if (!requestId) return res.status(400).json({ message: 'Missing request id' })

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end()
  }

  const action = asString(req.body?.action).toLowerCase()
  if (!['accept', 'decline'].includes(action)) return res.status(400).json({ message: 'Invalid action' })

  const role = (await getUserRole(req)) || 'student'
  const isPrivileged = role === 'admin' || role === 'teacher'

  const joinRequest = await prisma.groupJoinRequest.findUnique({
    where: { id: requestId },
    include: { group: { select: { id: true, name: true, createdById: true } } }
  })
  if (!joinRequest) return res.status(404).json({ message: 'Request not found' })

  if (!isPrivileged && joinRequest.group.createdById !== userId) {
    const membership = await prisma.learningGroupMember.findFirst({ where: { groupId: joinRequest.groupId, userId } })
    if (!membership || (membership.memberRole !== 'owner' && membership.memberRole !== 'instructor')) {
      return res.status(403).json({ message: 'Forbidden' })
    }
  }

  if (joinRequest.status !== 'pending') return res.status(200).json({ status: joinRequest.status })

  const nextStatus = action === 'accept' ? 'accepted' : 'declined'

  const updated = await prisma.groupJoinRequest.update({
    where: { id: requestId },
    data: { status: nextStatus, respondedAt: new Date() }
  })

  if (action === 'accept') {
    const existing = await prisma.learningGroupMember.findUnique({
      where: { groupId_userId: { groupId: joinRequest.groupId, userId: joinRequest.requestedById } }
    })
    if (!existing) {
      await prisma.learningGroupMember.create({
        data: { groupId: joinRequest.groupId, userId: joinRequest.requestedById, memberRole: 'member' }
      })
    }
  }

  const adminUsers = await prisma.user.findMany({ where: { role: 'admin' }, select: { id: true } })
  const notifyUserIds = new Set<string>()
  notifyUserIds.add(joinRequest.requestedById)
  if (joinRequest.group.createdById) notifyUserIds.add(joinRequest.group.createdById)
  for (const a of adminUsers) notifyUserIds.add(a.id)

  await prisma.notification.createMany({
    data: Array.from(notifyUserIds)
      .filter((id) => id)
      .map((id) => ({
        userId: id,
        type: 'group_join_request_response',
        title: 'Join request response',
        body: `Join request was ${nextStatus} for ${joinRequest.group.name}`,
        data: { requestId: updated.id, groupId: joinRequest.groupId, status: nextStatus, requestedById: joinRequest.requestedById, respondedById: userId }
      }))
  })

  return res.status(200).json({ status: updated.status })
}
