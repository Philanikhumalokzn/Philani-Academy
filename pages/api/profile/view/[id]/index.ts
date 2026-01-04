import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../../lib/prisma'
import { getUserIdFromReq, getUserRole } from '../../../../../lib/auth'

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
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      grade: true,
      avatar: true,
      statusBio: true,
      schoolName: true,
      profileVisibility: true,
    },
  })

  if (!target) return res.status(404).json({ message: 'User not found' })

  if (!isPrivileged && requesterId !== targetId) {
    // Require shared group membership
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

    if ((target.profileVisibility || 'shared') === 'private') {
      return res.status(403).json({ message: 'This profile is private' })
    }
  }

  return res.status(200).json({
    id: target.id,
    name: target.name || target.email,
    role: target.role,
    grade: target.grade,
    avatar: target.avatar,
    statusBio: target.statusBio,
    schoolName: target.schoolName,
    verified: target.role === 'admin' || target.role === 'teacher',
  })
}
