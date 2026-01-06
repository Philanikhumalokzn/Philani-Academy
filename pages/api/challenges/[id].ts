import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserGrade, getUserIdFromReq, getUserRole } from '../../../lib/auth'
import { normalizeGradeInput } from '../../../lib/grades'

function clampAudience(audience: unknown) {
  const v = typeof audience === 'string' ? audience.trim().toLowerCase() : ''
  if (v === 'public' || v === 'grade' || v === 'private') return v
  return 'public'
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requesterId = await getUserIdFromReq(req)
  if (!requesterId) return res.status(401).json({ message: 'Unauthorized' })

  const id = String(req.query.id || '')
  if (!id) return res.status(400).json({ message: 'Missing challenge id' })

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end()
  }

  const role = (await getUserRole(req)) || 'student'
  const isPrivileged = role === 'admin' || role === 'teacher'

  // Schema contains UserChallenge but TS may not see prisma.userChallenge yet.
  const userChallenge = (prisma as any).userChallenge as typeof prisma extends { userChallenge: infer T } ? T : any

  const challenge = await userChallenge.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      prompt: true,
      imageUrl: true,
      grade: true,
      audience: true,
      createdAt: true,
      updatedAt: true,
      createdById: true,
      createdBy: {
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
      },
    },
  })

  if (!challenge) return res.status(404).json({ message: 'Challenge not found' })

  const isOwner = requesterId === String(challenge.createdById)
  if (!isOwner && !isPrivileged) {
    // Enforce profile view rules (shared-group membership unless privileged).
    const creatorVisibility = String(challenge.createdBy?.profileVisibility || 'shared')
    if (creatorVisibility === 'private') return res.status(403).json({ message: 'This profile is private' })

    if (creatorVisibility !== 'discoverable') {
      const shared = await prisma.learningGroupMember.findFirst({
        where: {
          userId: requesterId,
          group: {
            members: {
              some: { userId: String(challenge.createdById) },
            },
          },
        },
        select: { id: true },
      })

      if (!shared) return res.status(403).json({ message: 'Forbidden' })
    }

    const audience = clampAudience(challenge.audience)
    if (audience === 'private') {
      return res.status(403).json({ message: 'Forbidden' })
    }

    if (audience === 'grade') {
      const requesterGrade = normalizeGradeInput(await getUserGrade(req))
      const challengeGrade = normalizeGradeInput(challenge.grade)
      if (!requesterGrade || !challengeGrade || requesterGrade !== challengeGrade) {
        return res.status(403).json({ message: 'Forbidden' })
      }
    }
  }

  return res.status(200).json({
    id: challenge.id,
    title: challenge.title,
    prompt: challenge.prompt,
    imageUrl: challenge.imageUrl,
    grade: challenge.grade,
    audience: challenge.audience,
    createdAt: challenge.createdAt,
    updatedAt: challenge.updatedAt,
    createdBy: {
      id: challenge.createdBy?.id,
      name: challenge.createdBy?.name || challenge.createdBy?.email || 'User',
      avatar: challenge.createdBy?.avatar || null,
    },
    isOwner,
    isPrivileged,
  })
}
