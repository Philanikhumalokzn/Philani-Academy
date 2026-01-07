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

  if (req.method !== 'GET' && req.method !== 'PATCH') {
    res.setHeader('Allow', ['GET', 'PATCH'])
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
      attemptsOpen: true,
      solutionsVisible: true,
      closedAt: true,
      revealedAt: true,
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

  if (req.method === 'PATCH') {
    if (!isOwner && !isPrivileged) return res.status(403).json({ message: 'Forbidden' })

    const { attemptsOpen, solutionsVisible } = (req.body || {}) as { attemptsOpen?: unknown; solutionsVisible?: unknown }
    const wantsAttemptsOpen = typeof attemptsOpen === 'boolean' ? attemptsOpen : undefined
    const wantsSolutionsVisible = typeof solutionsVisible === 'boolean' ? solutionsVisible : undefined

    const updateData: any = {}

    if (wantsAttemptsOpen === false && challenge.attemptsOpen) {
      updateData.attemptsOpen = false
      updateData.closedAt = new Date()
    }

    // Only allow revealing solutions once attempts are closed.
    const attemptsWillBeOpen = (typeof updateData.attemptsOpen === 'boolean') ? updateData.attemptsOpen : challenge.attemptsOpen
    if (wantsSolutionsVisible === true && !challenge.solutionsVisible) {
      if (attemptsWillBeOpen) {
        return res.status(400).json({ message: 'Close attempts before revealing solutions' })
      }
      updateData.solutionsVisible = true
      updateData.revealedAt = new Date()
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(200).json({ ok: true })
    }

    await userChallenge.update({ where: { id }, data: updateData })
  }

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

  // Owner/privileged: compute takers + (optionally) revealed attempts.
  let takers: any[] | undefined
  let attempts: any[] | undefined
  if (isOwner || isPrivileged) {
    const learnerResponse = (prisma as any).learnerResponse as typeof prisma extends { learnerResponse: infer T } ? T : any
    const sessionKey = `challenge:${id}`

    const records = await learnerResponse.findMany({
      where: {
        sessionKey,
        OR: [
          { ownerId: String(challenge.createdById) },
          { ownerId: null },
        ],
      },
      select: {
        id: true,
        userId: true,
        latex: true,
        studentText: true,
        createdAt: true,
        prompt: true,
        quizLabel: true,
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })

    const byUser = new Map<string, { userId: string; name: string; avatar: string | null; lastSubmittedAt: Date; submissions: number }>()
    for (const r of records) {
      const uid = String(r.userId)
      const existing = byUser.get(uid)
      const displayName = String(r.user?.name || r.user?.email || 'User')
      const avatar = (r.user?.avatar as string | null) || null
      const submittedAt = new Date(r.createdAt)
      if (!existing) {
        byUser.set(uid, { userId: uid, name: displayName, avatar, lastSubmittedAt: submittedAt, submissions: 1 })
      } else {
        existing.submissions += 1
        if (submittedAt > existing.lastSubmittedAt) existing.lastSubmittedAt = submittedAt
      }
    }

    takers = Array.from(byUser.values())
      .sort((a, b) => b.lastSubmittedAt.getTime() - a.lastSubmittedAt.getTime())
      .map(t => ({
        userId: t.userId,
        name: t.name,
        avatar: t.avatar,
        lastSubmittedAt: t.lastSubmittedAt.toISOString(),
        submissions: t.submissions,
      }))

    if (challenge.solutionsVisible) {
      attempts = records
        .slice()
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map(r => ({
          id: r.id,
          userId: r.userId,
          name: String(r.user?.name || r.user?.email || 'User'),
          avatar: (r.user?.avatar as string | null) || null,
          createdAt: new Date(r.createdAt).toISOString(),
          latex: r.latex,
          studentText: r.studentText,
          prompt: r.prompt,
          quizLabel: r.quizLabel,
        }))
    }
  }

  return res.status(200).json({
    id: challenge.id,
    title: challenge.title,
    prompt: challenge.prompt,
    imageUrl: challenge.imageUrl,
    grade: challenge.grade,
    audience: challenge.audience,
    attemptsOpen: challenge.attemptsOpen,
    solutionsVisible: challenge.solutionsVisible,
    closedAt: challenge.closedAt,
    revealedAt: challenge.revealedAt,
    createdAt: challenge.createdAt,
    updatedAt: challenge.updatedAt,
    createdBy: {
      id: challenge.createdBy?.id,
      name: challenge.createdBy?.name || challenge.createdBy?.email || 'User',
      avatar: challenge.createdBy?.avatar || null,
    },
    isOwner,
    isPrivileged,
    takers,
    attempts,
  })
}
