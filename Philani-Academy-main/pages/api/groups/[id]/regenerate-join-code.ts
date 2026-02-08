import type { NextApiRequest, NextApiResponse } from 'next'
import crypto from 'crypto'
import prisma from '../../../../lib/prisma'
import { getUserIdFromReq, getUserRole } from '../../../../lib/auth'

function generateJoinCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(8)
  let out = ''
  for (let i = 0; i < 8; i += 1) out += alphabet[bytes[i] % alphabet.length]
  return out
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
    select: { id: true, createdById: true }
  })
  if (!group) return res.status(404).json({ message: 'Group not found' })

  if (!isPrivileged && group.createdById !== userId) {
    const membership = await prisma.learningGroupMember.findFirst({ where: { groupId, userId } })
    if (!membership || (membership.memberRole !== 'owner' && membership.memberRole !== 'instructor')) {
      return res.status(403).json({ message: 'Forbidden' })
    }
  }

  let joinCode = generateJoinCode()
  for (let i = 0; i < 5; i += 1) {
    const exists = await prisma.learningGroup.findUnique({ where: { joinCode } })
    if (!exists) break
    joinCode = generateJoinCode()
  }

  const updated = await prisma.learningGroup.update({
    where: { id: groupId },
    data: { joinCode, joinCodeActive: true }
  })

  return res.status(200).json({ joinCode: updated.joinCode, joinCodeActive: updated.joinCodeActive })
}
