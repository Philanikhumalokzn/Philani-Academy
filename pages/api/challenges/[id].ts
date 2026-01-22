import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserGrade, getUserIdFromReq, getUserRole } from '../../../lib/auth'
import { normalizeGradeInput } from '../../../lib/grades'

const MAX_TITLE_LENGTH = 120
const MAX_PROMPT_LENGTH = 5000
const MAX_IMAGE_URL_LENGTH = 2000

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

  if (req.method !== 'GET' && req.method !== 'PATCH' && req.method !== 'DELETE') {
    res.setHeader('Allow', ['GET', 'PATCH', 'DELETE'])
    return res.status(405).end()
  }

  const role = (await getUserRole(req)) || 'student'
  const isPrivileged = role === 'admin' || role === 'teacher'

  // Schema contains UserChallenge but TS may not see prisma.userChallenge yet.
  const userChallenge = (prisma as any).userChallenge as typeof prisma extends { userChallenge: infer T } ? T : any

  let challenge = await userChallenge.findUnique({
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
      maxAttempts: true,
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

  if (req.method === 'DELETE') {
    if (!isOwner && !isPrivileged) return res.status(403).json({ message: 'Forbidden' })

    try {
      const learnerResponse = (prisma as any).learnerResponse as typeof prisma extends { learnerResponse: infer T } ? T : any
      const sessionKey = `challenge:${id}`

      await prisma.$transaction([
        learnerResponse.deleteMany({ where: { sessionKey } }),
        userChallenge.delete({ where: { id } }),
      ])

      return res.status(200).json({ ok: true })
    } catch (err: any) {
      console.error('Failed to delete challenge', err)
      return res.status(500).json({ message: err?.message || 'Failed to delete challenge' })
    }
  }

  if (req.method === 'PATCH') {
    if (!isOwner && !isPrivileged) return res.status(403).json({ message: 'Forbidden' })

    const body = (req.body || {}) as any

    const { attemptsOpen, solutionsVisible } = body as { attemptsOpen?: unknown; solutionsVisible?: unknown }
    const wantsAttemptsOpen = typeof attemptsOpen === 'boolean' ? attemptsOpen : undefined
    const wantsSolutionsVisible = typeof solutionsVisible === 'boolean' ? solutionsVisible : undefined

    const updateData: any = {}

    // Core editable fields (mirrors create options)
    const hasTitle = Object.prototype.hasOwnProperty.call(body, 'title')
    const hasPrompt = Object.prototype.hasOwnProperty.call(body, 'prompt')
    const hasImageUrl = Object.prototype.hasOwnProperty.call(body, 'imageUrl')
    const hasAudience = Object.prototype.hasOwnProperty.call(body, 'audience')
    const hasMaxAttempts = Object.prototype.hasOwnProperty.call(body, 'maxAttempts')

    if (hasTitle) {
      const nextTitle = (typeof body.title === 'string' ? body.title.trim() : '').slice(0, MAX_TITLE_LENGTH)
      updateData.title = nextTitle
    }

    // We validate prompt/image together using the final merged values.
    let nextPrompt = challenge.prompt
    if (hasPrompt) {
      const requested = typeof body.prompt === 'string' ? body.prompt.trim() : ''
      nextPrompt = requested.slice(0, MAX_PROMPT_LENGTH)
    }

    let nextImageUrl: string | null = challenge.imageUrl ?? null
    if (hasImageUrl) {
      const raw = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : ''
      const clipped = raw.slice(0, MAX_IMAGE_URL_LENGTH)
      nextImageUrl = clipped ? clipped : null
    }

    if (hasAudience) {
      updateData.audience = clampAudience(body.audience)
    }

    if (hasMaxAttempts) {
      const raw = body.maxAttempts
      if (raw === null) {
        updateData.maxAttempts = null
      } else {
        const n = typeof raw === 'number' ? raw : Number(raw)
        if (!Number.isFinite(n)) {
          return res.status(400).json({ message: 'Invalid maxAttempts' })
        }
        const v = Math.trunc(n)
        if (v <= 0) {
          updateData.maxAttempts = null
        } else {
          updateData.maxAttempts = Math.min(100, Math.max(1, v))
        }
      }
    }

    const hasMeaningfulPrompt = Boolean(nextPrompt)
    const hasImage = Boolean(nextImageUrl)
    if (!hasMeaningfulPrompt && !hasImage) {
      return res.status(400).json({ message: 'Either a prompt or an image is required' })
    }

    const effectivePrompt = hasMeaningfulPrompt ? nextPrompt : 'See attached image.'
    if (hasPrompt || hasImageUrl) {
      updateData.prompt = effectivePrompt
      updateData.imageUrl = nextImageUrl
    }

    // If the challenge is grade-scoped and we don't have a grade, set it.
    const nextAudience = (typeof updateData.audience === 'string') ? updateData.audience : clampAudience(challenge.audience)
    if (nextAudience === 'grade') {
      const currentGrade = normalizeGradeInput(challenge.grade)
      if (!currentGrade) {
        const requesterGrade = normalizeGradeInput(await getUserGrade(req))
        if (requesterGrade) updateData.grade = requesterGrade
      }
    }

    // Owner-controlled attempt visibility.
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

    if (Object.keys(updateData).length > 0) {
      challenge = await userChallenge.update({ where: { id }, data: updateData, select: {
        id: true,
        title: true,
        prompt: true,
        imageUrl: true,
        grade: true,
        audience: true,
        attemptsOpen: true,
        solutionsVisible: true,
        maxAttempts: true,
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
      } })
    } else {
      return res.status(200).json({ ok: true })
    }
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
  let myAttemptCount = 0
  
  const learnerResponse = (prisma as any).learnerResponse as typeof prisma extends { learnerResponse: infer T } ? T : any
  const sessionKey = `challenge:${id}`

  // Count current user's attempts
  myAttemptCount = await learnerResponse.count({
    where: {
      sessionKey,
      userId: requesterId,
    },
  })

  const canViewAttempts = isOwner || isPrivileged || Boolean(challenge.solutionsVisible)

  if (canViewAttempts) {
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
        gradingJson: true,
        feedback: true,
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
        gradingJson: r.gradingJson,
        feedback: r.feedback,
        prompt: r.prompt,
        quizLabel: r.quizLabel,
      }))
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
    maxAttempts: challenge.maxAttempts,
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
    myAttemptCount,
    takers,
    attempts,
  })
}
