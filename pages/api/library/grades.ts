import type { NextApiRequest, NextApiResponse } from 'next'
import { getUserGrade, getUserIdFromReq, getUserRole } from '../../../lib/auth'
import { normalizeGradeInput } from '../../../lib/grades'
import prisma from '../../../lib/prisma'

type LibraryGradeItem = {
  id: string
  sourceType: 'assignment' | 'post_solution' | 'challenge_solution' | 'manual'
  assessmentTitle: string
  scoreLabel: string
  earnedMarks: number | null
  totalMarks: number | null
  percentage: number | null
  feedback: string | null
  screenshotUrl: string | null
  screenshotUrls: string[]
  graderSignature: string | null
  gradedAt: string
  sourceKey: string | null
  responseId: string | null
}

type GradeComment = {
  id: string
  authorId: string
  authorRole: 'teacher' | 'learner'
  text: string
  createdAt: string
  updatedAt: string
}

const clampText = (value: unknown, maxLength: number) => {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

const parsePercentage = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, value))
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, parsed))
  }
  return null
}

const toIsoString = (value: unknown, fallback = new Date().toISOString()) => {
  if (!value) return fallback
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return fallback
  return date.toISOString()
}

const toPostOrChallengeScoreLabel = (record: any) => {
  const grading = record?.gradingJson && typeof record.gradingJson === 'object' ? record.gradingJson : null

  const earnedMarks = Number((grading as any)?.earnedMarks)
  const totalMarks = Number((grading as any)?.totalMarks)
  if (Number.isFinite(earnedMarks) && Number.isFinite(totalMarks) && totalMarks > 0) {
    return `${Math.max(0, Math.trunc(earnedMarks))}/${Math.max(1, Math.trunc(totalMarks))}`
  }

  if (typeof record?.latex === 'string' && record.latex.trim()) {
    return record.latex.trim().slice(0, 64)
  }

  return 'Graded'
}

const buildManualItem = (record: any): LibraryGradeItem => {
  const grading = record?.gradingJson && typeof record.gradingJson === 'object' ? record.gradingJson : {}
  const assessmentTitle = clampText((grading as any)?.assessmentTitle || record?.quizLabel || record?.prompt || 'Manual assessment', 140) || 'Manual assessment'
  const scoreLabel = clampText((grading as any)?.scoreLabel || record?.latex || 'Graded', 64) || 'Graded'
  const earnedMarksRaw = Number((grading as any)?.earnedMarks)
  const totalMarksRaw = Number((grading as any)?.totalMarks)
  const earnedMarks = Number.isFinite(earnedMarksRaw) ? Math.max(0, earnedMarksRaw) : null
  const totalMarks = Number.isFinite(totalMarksRaw) && totalMarksRaw > 0 ? totalMarksRaw : null
  const screenshotUrl = clampText((grading as any)?.screenshotUrl || '', 1024) || null
  const screenshotUrlsRaw = (grading as any)?.screenshotUrls
  const screenshotUrls = Array.isArray(screenshotUrlsRaw)
    ? screenshotUrlsRaw.map((u: unknown) => (typeof u === 'string' ? u.trim() : '')).filter(Boolean)
    : (screenshotUrl ? [screenshotUrl] : [])

  return {
    id: String(record?.id || ''),
    sourceType: 'manual',
    assessmentTitle,
    scoreLabel,
    earnedMarks,
    totalMarks,
    percentage: parsePercentage((grading as any)?.percentage),
    feedback: clampText((grading as any)?.notes || record?.feedback || '', 1200) || null,
    screenshotUrl,
    screenshotUrls,
    graderSignature: clampText((grading as any)?.graderSignature || '', 120) || null,
    gradedAt: toIsoString((grading as any)?.gradedAt || record?.updatedAt || record?.createdAt),
    sourceKey: String(record?.sessionKey || '') || null,
    responseId: String(record?.id || '') || null,
  }
}

const sanitizeComments = (value: unknown): GradeComment[] => {
  if (!Array.isArray(value)) return []
  const out: GradeComment[] = []
  for (const row of value) {
    if (!row || typeof row !== 'object') continue
    const id = clampText((row as any)?.id, 64)
    const authorId = clampText((row as any)?.authorId, 128)
    const roleRaw = clampText((row as any)?.authorRole, 20)
    const authorRole: 'teacher' | 'learner' = roleRaw === 'teacher' ? 'teacher' : 'learner'
    const text = clampText((row as any)?.text, 100)
    if (!id || !authorId || !text) continue
    out.push({
      id,
      authorId,
      authorRole,
      text,
      createdAt: toIsoString((row as any)?.createdAt),
      updatedAt: toIsoString((row as any)?.updatedAt || (row as any)?.createdAt),
    })
  }
  return out
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const role = await getUserRole(req)
  const requesterId = await getUserIdFromReq(req)

  if (!requesterId) return res.status(401).json({ message: 'Unauthorized' })

  if (req.method === 'GET') {
    const detailResponseId = typeof req.query.detailResponseId === 'string' ? req.query.detailResponseId.trim() : ''
    const detailSourceType = typeof req.query.detailSourceType === 'string' ? req.query.detailSourceType.trim() : ''

    if (detailResponseId && detailSourceType) {
      const isPrivileged = role === 'admin' || role === 'teacher'
      const row = await (prisma as any).learnerResponse.findUnique({
        where: { id: detailResponseId },
        select: {
          id: true,
          userId: true,
          sessionKey: true,
          quizLabel: true,
          prompt: true,
          latex: true,
          gradingJson: true,
          feedback: true,
          updatedAt: true,
          createdAt: true,
        },
      }).catch(() => null)

      if (!row) return res.status(404).json({ message: 'Grade detail not found' })
      if (!isPrivileged && String(row.userId || '') !== requesterId) {
        return res.status(403).json({ message: 'Forbidden' })
      }

      const grading = row?.gradingJson && typeof row.gradingJson === 'object' ? row.gradingJson : {}
      const screenshotUrl = clampText((grading as any)?.screenshotUrl || '', 1024) || null
      const screenshotUrlsRaw = (grading as any)?.screenshotUrls
      const screenshotUrls = Array.isArray(screenshotUrlsRaw)
        ? screenshotUrlsRaw.map((u: unknown) => (typeof u === 'string' ? u.trim() : '')).filter(Boolean)
        : (screenshotUrl ? [screenshotUrl] : [])
      const comments = sanitizeComments((grading as any)?.comments)

      return res.status(200).json({
        detail: {
          id: String(row.id),
          sourceType: detailSourceType,
          assessmentTitle: clampText((grading as any)?.assessmentTitle || row?.quizLabel || row?.prompt || 'Grade details', 140) || 'Grade details',
          scoreLabel: clampText((grading as any)?.scoreLabel || row?.latex || 'Graded', 64) || 'Graded',
          earnedMarks: Number.isFinite(Number((grading as any)?.earnedMarks)) ? Math.max(0, Number((grading as any)?.earnedMarks)) : null,
          totalMarks: Number.isFinite(Number((grading as any)?.totalMarks)) && Number((grading as any)?.totalMarks) > 0
            ? Number((grading as any)?.totalMarks)
            : null,
          percentage: parsePercentage((grading as any)?.percentage),
          feedback: clampText((grading as any)?.notes || row?.feedback || '', 1200) || null,
          screenshotUrl,
          screenshotUrls,
          graderSignature: clampText((grading as any)?.graderSignature || '', 120) || null,
          gradedAt: toIsoString((grading as any)?.gradedAt || row?.updatedAt || row?.createdAt),
          comments,
          canComment: true,
        },
      })
    }

    const requestedLearnerId = typeof req.query.learnerId === 'string' ? req.query.learnerId.trim() : ''
    const isPrivileged = role === 'admin' || role === 'teacher'
    const learnerUserId = requestedLearnerId || requesterId

    if (requestedLearnerId && !isPrivileged) {
      return res.status(403).json({ message: 'Forbidden' })
    }

    const [assignmentGrades, learnerRows] = await Promise.all([
      prisma.assignmentGrade.findMany({
        where: { userId: learnerUserId },
        orderBy: { gradedAt: 'desc' },
        take: 120,
        include: {
          assignment: {
            select: {
              id: true,
              title: true,
              displayTitle: true,
              sectionLabel: true,
              session: {
                select: {
                  id: true,
                  title: true,
                },
              },
            },
          },
        },
      }).catch(() => []),
      (prisma as any).learnerResponse.findMany({
        where: {
          userId: learnerUserId,
          OR: [
            { sessionKey: { startsWith: 'manual-grade:' } },
            { sessionKey: { startsWith: 'post:' } },
            { sessionKey: { startsWith: 'challenge:' } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: 300,
        select: {
          id: true,
          sessionKey: true,
          quizLabel: true,
          prompt: true,
          latex: true,
          gradingJson: true,
          feedback: true,
          createdAt: true,
          updatedAt: true,
        },
      }).catch(() => []),
    ])

    const postIds = Array.from(new Set((learnerRows as any[])
      .map((row: any) => String(row?.sessionKey || ''))
      .filter((key) => key.startsWith('post:'))
      .map((key) => key.slice('post:'.length))
      .filter(Boolean)))

    const challengeIds = Array.from(new Set((learnerRows as any[])
      .map((row: any) => String(row?.sessionKey || ''))
      .filter((key) => key.startsWith('challenge:'))
      .map((key) => key.slice('challenge:'.length))
      .filter(Boolean)))

    const [posts, challenges] = await Promise.all([
      postIds.length
        ? (prisma as any).socialPost.findMany({
            where: { id: { in: postIds } },
            select: { id: true, title: true },
          }).catch(() => [])
        : [],
      challengeIds.length
        ? (prisma as any).userChallenge.findMany({
            where: { id: { in: challengeIds } },
            select: { id: true, title: true },
          }).catch(() => [])
        : [],
    ])

    const postTitleById = new Map<string, string>()
    for (const post of posts as any[]) {
      const key = String(post?.id || '')
      const title = clampText(post?.title || '', 140)
      if (key) postTitleById.set(key, title || 'Post solution')
    }

    const challengeTitleById = new Map<string, string>()
    for (const challenge of challenges as any[]) {
      const key = String(challenge?.id || '')
      const title = clampText(challenge?.title || '', 140)
      if (key) challengeTitleById.set(key, title || 'Challenge solution')
    }

    const items: LibraryGradeItem[] = []

    for (const grade of assignmentGrades as any[]) {
      const earnedPoints = Number(grade?.earnedPoints || 0)
      const totalPoints = Math.max(1, Number(grade?.totalPoints || 0) || 1)
      const percentage = Number(grade?.percentage)
      const assignmentTitle = clampText(grade?.assignment?.displayTitle || grade?.assignment?.title || 'Assignment', 140) || 'Assignment'
      const sessionTitle = clampText(grade?.assignment?.session?.title || '', 120)

      items.push({
        id: `assignment-grade:${String(grade?.id || '')}`,
        sourceType: 'assignment',
        assessmentTitle: assignmentTitle,
        scoreLabel: `${Math.max(0, Math.trunc(earnedPoints))}/${Math.max(1, Math.trunc(totalPoints))}`,
        earnedMarks: Math.max(0, Math.trunc(earnedPoints)),
        totalMarks: Math.max(1, Math.trunc(totalPoints)),
        percentage: Number.isFinite(percentage) ? Math.max(0, Math.min(100, percentage)) : null,
        feedback: sessionTitle ? `Session: ${sessionTitle}` : null,
        screenshotUrl: null,
        screenshotUrls: [],
        graderSignature: null,
        gradedAt: toIsoString(grade?.gradedAt || grade?.createdAt),
        sourceKey: String(grade?.assignmentId || '') || null,
        responseId: null,
      })
    }

    for (const row of learnerRows as any[]) {
      const sessionKey = String(row?.sessionKey || '')
      const hasGradeContent = Boolean(row?.gradingJson) || Boolean((row?.feedback || '').trim())
      if (!sessionKey || !hasGradeContent) continue

      if (sessionKey.startsWith('manual-grade:')) {
        items.push(buildManualItem(row))
        continue
      }

      if (sessionKey.startsWith('post:')) {
        const postId = sessionKey.slice('post:'.length)
        const grading = row?.gradingJson && typeof row.gradingJson === 'object' ? row.gradingJson : {}
        items.push({
          id: `post-grade:${String(row?.id || '')}`,
          sourceType: 'post_solution',
          assessmentTitle: postTitleById.get(postId) || 'Post solution',
          scoreLabel: toPostOrChallengeScoreLabel(row),
          earnedMarks: Number.isFinite(Number((grading as any)?.earnedMarks)) ? Math.max(0, Number((grading as any)?.earnedMarks)) : null,
          totalMarks: Number.isFinite(Number((grading as any)?.totalMarks)) && Number((grading as any)?.totalMarks) > 0
            ? Number((grading as any)?.totalMarks)
            : null,
          percentage: parsePercentage((grading as any)?.percentage),
          feedback: clampText((row?.feedback || '').trim(), 1200) || null,
          screenshotUrl: clampText((grading as any)?.screenshotUrl || '', 1024) || null,
          screenshotUrls: [],
          graderSignature: clampText((grading as any)?.graderSignature || '', 120) || null,
          gradedAt: toIsoString((grading as any)?.gradedAt || row?.updatedAt || row?.createdAt),
          sourceKey: sessionKey,
          responseId: String(row?.id || '') || null,
        })
        continue
      }

      if (sessionKey.startsWith('challenge:')) {
        const challengeId = sessionKey.slice('challenge:'.length)
        const grading = row?.gradingJson && typeof row.gradingJson === 'object' ? row.gradingJson : {}
        items.push({
          id: `challenge-grade:${String(row?.id || '')}`,
          sourceType: 'challenge_solution',
          assessmentTitle: challengeTitleById.get(challengeId) || 'Challenge solution',
          scoreLabel: toPostOrChallengeScoreLabel(row),
          earnedMarks: Number.isFinite(Number((grading as any)?.earnedMarks)) ? Math.max(0, Number((grading as any)?.earnedMarks)) : null,
          totalMarks: Number.isFinite(Number((grading as any)?.totalMarks)) && Number((grading as any)?.totalMarks) > 0
            ? Number((grading as any)?.totalMarks)
            : null,
          percentage: parsePercentage((grading as any)?.percentage),
          feedback: clampText((row?.feedback || '').trim(), 1200) || null,
          screenshotUrl: clampText((grading as any)?.screenshotUrl || '', 1024) || null,
          screenshotUrls: [],
          graderSignature: clampText((grading as any)?.graderSignature || '', 120) || null,
          gradedAt: toIsoString((grading as any)?.gradedAt || row?.updatedAt || row?.createdAt),
          sourceKey: sessionKey,
          responseId: String(row?.id || '') || null,
        })
      }
    }

    items.sort((left, right) => new Date(right.gradedAt).getTime() - new Date(left.gradedAt).getTime())

    return res.status(200).json({ items })
  }

  if (req.method === 'POST') {
    const action = clampText(req.body?.action, 60)
    if (action === 'commentCreate' || action === 'commentUpdate' || action === 'commentDelete') {
      const responseId = clampText(req.body?.responseId, 128)
      if (!responseId) return res.status(400).json({ message: 'Response id is required' })

      const row = await (prisma as any).learnerResponse.findUnique({
        where: { id: responseId },
        select: { id: true, userId: true, gradingJson: true, sessionKey: true },
      }).catch(() => null)
      if (!row) return res.status(404).json({ message: 'Grade record not found' })

      const isPrivileged = role === 'admin' || role === 'teacher'
      if (!isPrivileged && String(row.userId || '') !== requesterId) {
        return res.status(403).json({ message: 'Forbidden' })
      }

      const grading = row?.gradingJson && typeof row.gradingJson === 'object' ? row.gradingJson : {}
      const comments = sanitizeComments((grading as any)?.comments)
      const now = new Date().toISOString()

      if (action === 'commentCreate') {
        const text = clampText(req.body?.text, 100)
        if (!text) return res.status(400).json({ message: 'Comment text is required (max 100 chars)' })
        const comment: GradeComment = {
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
          authorId: requesterId,
          authorRole: isPrivileged ? 'teacher' : 'learner',
          text,
          createdAt: now,
          updatedAt: now,
        }
        const nextComments = [...comments, comment]
        await (prisma as any).learnerResponse.update({
          where: { id: row.id },
          data: {
            gradingJson: { ...(grading as any), comments: nextComments },
          },
        })
        return res.status(200).json({ comments: nextComments })
      }

      if (action === 'commentUpdate') {
        const commentId = clampText(req.body?.commentId, 64)
        const text = clampText(req.body?.text, 100)
        if (!commentId) return res.status(400).json({ message: 'Comment id is required' })
        if (!text) return res.status(400).json({ message: 'Comment text is required (max 100 chars)' })

        const nextComments = comments.map((comment) => {
          if (comment.id !== commentId) return comment
          if (!isPrivileged && comment.authorId !== requesterId) return comment
          return { ...comment, text, updatedAt: now }
        })

        await (prisma as any).learnerResponse.update({
          where: { id: row.id },
          data: {
            gradingJson: { ...(grading as any), comments: nextComments },
          },
        })
        return res.status(200).json({ comments: nextComments })
      }

      if (action === 'commentDelete') {
        const commentId = clampText(req.body?.commentId, 64)
        if (!commentId) return res.status(400).json({ message: 'Comment id is required' })
        const nextComments = comments.filter((comment) => {
          if (comment.id !== commentId) return true
          return isPrivileged ? false : comment.authorId !== requesterId
        })
        await (prisma as any).learnerResponse.update({
          where: { id: row.id },
          data: {
            gradingJson: { ...(grading as any), comments: nextComments },
          },
        })
        return res.status(200).json({ comments: nextComments })
      }
    }

    const isPrivileged = role === 'admin' || role === 'teacher'
    if (!isPrivileged) {
      return res.status(403).json({ message: 'Only teachers/admins can create manual grades' })
    }

    const actorGrade = normalizeGradeInput(await getUserGrade(req))
    const learnerUserIdRaw = clampText(req.body?.learnerUserId, 128)
    const learnerEmailRaw = clampText(req.body?.learnerEmail, 320).toLowerCase()
    const assessmentTitle = clampText(req.body?.assessmentTitle, 140)
    const scoreLabel = clampText(req.body?.scoreLabel, 64)
    const notes = clampText(req.body?.notes, 1200)
    const screenshotUrl = clampText(req.body?.screenshotUrl, 1024)
    const percentage = parsePercentage(req.body?.percentage)

    if (!assessmentTitle) return res.status(400).json({ message: 'Assessment title is required' })
    if (!learnerUserIdRaw && !learnerEmailRaw) {
      return res.status(400).json({ message: 'Learner is required (user id or email)' })
    }

    const learner = learnerUserIdRaw
      ? await prisma.user.findUnique({ where: { id: learnerUserIdRaw }, select: { id: true, email: true, grade: true, name: true } })
      : await prisma.user.findUnique({ where: { email: learnerEmailRaw }, select: { id: true, email: true, grade: true, name: true } })

    if (!learner) return res.status(404).json({ message: 'Learner not found' })

    if (role === 'teacher' && actorGrade && learner.grade && learner.grade !== actorGrade) {
      return res.status(403).json({ message: 'You can only add manual grades for learners in your grade' })
    }

    const sessionKey = `manual-grade:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
    const gradingPayload = {
      type: 'manual-library-grade',
      assessmentTitle,
      scoreLabel,
      percentage,
      screenshotUrl,
      screenshotUrls: screenshotUrl ? [screenshotUrl] : [],
      notes,
      gradedAt: new Date().toISOString(),
      gradedById: requesterId,
      comments: [],
    }

    const created = await (prisma as any).learnerResponse.create({
      data: {
        sessionKey,
        userId: learner.id,
        ownerId: requesterId,
        userEmail: learner.email || null,
        quizId: 'manual',
        quizLabel: assessmentTitle,
        prompt: assessmentTitle,
        latex: scoreLabel || 'Graded',
        studentText: notes || null,
        gradingJson: gradingPayload,
        feedback: notes || null,
      },
      select: {
        id: true,
        sessionKey: true,
        quizLabel: true,
        prompt: true,
        latex: true,
        gradingJson: true,
        feedback: true,
        updatedAt: true,
        createdAt: true,
      },
    })

    const item = buildManualItem(created)

    try {
      await prisma.notification.create({
        data: {
          userId: learner.id,
          type: 'assignment_graded',
          title: 'New grade available',
          body: `${assessmentTitle}${scoreLabel ? ` (${scoreLabel})` : ''}`,
          data: {
            source: 'library-manual-grade',
            responseId: created.id,
            gradedById: requesterId,
          },
        },
      })
    } catch {
      // Non-blocking.
    }

    return res.status(201).json({ item })
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end('Method not allowed')
}
