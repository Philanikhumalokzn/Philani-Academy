import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../lib/prisma'
import { getUserIdFromReq, getUserRole } from '../../../../lib/auth'

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  const groupId = String(req.query.id || '')
  if (!groupId) return res.status(400).json({ message: 'Missing group id' })

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end()
  }

  const role = (await getUserRole(req)) || 'student'
  const isPrivileged = role === 'admin' || role === 'teacher'

  const group = await prisma.learningGroup.findUnique({
    where: { id: groupId },
    select: { id: true, name: true, createdById: true }
  })
  if (!group) return res.status(404).json({ message: 'Group not found' })

  if (!isPrivileged && group.createdById !== userId) {
    const membership = await prisma.learningGroupMember.findFirst({ where: { groupId, userId } })
    if (!membership || (membership.memberRole !== 'owner' && membership.memberRole !== 'instructor')) {
      return res.status(403).json({ message: 'Forbidden' })
    }
  }

  const email = asString(req.body?.email).toLowerCase()
  const targetUserId = asString(req.body?.userId)

  const target = await prisma.user.findFirst({
    where: targetUserId ? { id: targetUserId } : email ? { email } : undefined,
    select: { id: true, email: true, name: true }
  })

  if (!target) return res.status(404).json({ message: 'User not found' })
  if (target.id === userId) return res.status(400).json({ message: 'You are already in this account' })

  const existingMembership = await prisma.learningGroupMember.findUnique({
    where: { groupId_userId: { groupId, userId: target.id } }
  })
  if (existingMembership) return res.status(200).json({ message: 'User is already a member' })

  const existingInvite = await prisma.groupInvite.findFirst({
    where: { groupId, invitedUserId: target.id, status: 'pending' },
    select: { id: true }
  })

  const invite = existingInvite
    ? await prisma.groupInvite.update({
        where: { id: existingInvite.id },
        data: { createdAt: new Date(), invitedById: userId }
      })
    : await prisma.groupInvite.create({
        data: {
          groupId,
          invitedUserId: target.id,
          invitedById: userId,
          status: 'pending'
        }
      })

  await prisma.notification.create({
    data: {
      userId: target.id,
      type: 'group_invite',
      title: 'Group invitation',
      body: `${group.name} invited you to join`,
      data: { inviteId: invite.id, groupId: group.id, groupName: group.name, invitedById: userId }
    }
  })

  return res.status(200).json({ id: invite.id, groupId, invitedUserId: target.id, status: invite.status })
}
