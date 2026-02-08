import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../../lib/prisma'
import { getUserIdFromReq } from '../../../../../lib/auth'

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  const inviteId = String(req.query.id || '')
  if (!inviteId) return res.status(400).json({ message: 'Missing invite id' })

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end()
  }

  const action = asString(req.body?.action).toLowerCase()
  if (!['accept', 'decline'].includes(action)) return res.status(400).json({ message: 'Invalid action' })

  const invite = await prisma.groupInvite.findUnique({
    where: { id: inviteId },
    include: { group: { select: { id: true, name: true, createdById: true } } }
  })
  if (!invite) return res.status(404).json({ message: 'Invite not found' })
  if (invite.invitedUserId !== userId) return res.status(403).json({ message: 'Forbidden' })
  if (invite.status !== 'pending') return res.status(200).json({ status: invite.status })

  const nextStatus = action === 'accept' ? 'accepted' : 'declined'

  const updated = await prisma.groupInvite.update({
    where: { id: inviteId },
    data: { status: nextStatus, respondedAt: new Date() }
  })

  if (action === 'accept') {
    const existing = await prisma.learningGroupMember.findUnique({
      where: { groupId_userId: { groupId: invite.groupId, userId } }
    })
    if (!existing) {
      await prisma.learningGroupMember.create({
        data: { groupId: invite.groupId, userId, memberRole: 'member' }
      })
    }
  }

  const adminUsers = await prisma.user.findMany({ where: { role: 'admin' }, select: { id: true } })
  const notifyUserIds = new Set<string>()
  if (invite.invitedById) notifyUserIds.add(invite.invitedById)
  if (invite.group.createdById) notifyUserIds.add(invite.group.createdById)
  for (const a of adminUsers) notifyUserIds.add(a.id)

  await prisma.notification.createMany({
    data: Array.from(notifyUserIds)
      .filter((id) => id && id !== userId)
      .map((id) => ({
        userId: id,
        type: 'group_invite_response',
        title: 'Group invite response',
        body: `Invite was ${nextStatus} for ${invite.group.name}`,
        data: { inviteId: updated.id, groupId: invite.groupId, status: nextStatus, invitedUserId: userId }
      }))
  })

  return res.status(200).json({ status: updated.status })
}
