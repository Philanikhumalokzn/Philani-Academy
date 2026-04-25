import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserGrade, getUserIdFromReq, getUserRole } from '../../../lib/auth'
import { enrichFeedPosts, FEED_POST_SELECT } from '../../../lib/feedContract'
import { normalizeGradeInput } from '../../../lib/grades'
import { getSocialPostInteractionState } from '../../../lib/socialPostInteractions'

function buildCanonicalQbQuestionMmd(question: {
  questionNumber?: string | null
  questionText?: string | null
  latex?: string | null
  tableMarkdown?: string | null
  imageUrl?: string | null
}) {
  const lines: string[] = []
  const questionNumber = String(question?.questionNumber || '').trim()
  const questionText = String(question?.questionText || '').trim()
  const latex = String(question?.latex || '').trim()
  const tableMarkdown = String(question?.tableMarkdown || '').trim()
  const imageUrl = String(question?.imageUrl || '').trim()

  if (questionNumber) lines.push(`QUESTION ${questionNumber}`)
  if (questionText) lines.push(questionText)
  if (latex) lines.push(`$$\n${latex}\n$$`)
  if (tableMarkdown) lines.push(tableMarkdown)
  if (imageUrl && /^https?:\/\//i.test(imageUrl)) lines.push(`![Diagram 1](${imageUrl})`)

  return lines.join('\n\n').trim()
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isMissingSocialPostsTableError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err || '')
  return /socialpost/i.test(message) && /(does not exist|not exist|no such table|relation)/i.test(message)
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requesterId = await getUserIdFromReq(req)
  if (!requesterId) return res.status(401).json({ message: 'Unauthorized' })
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end('Method not allowed')
  }

  const role = (await getUserRole(req)) || 'student'
  const isPrivileged = role === 'admin' || role === 'teacher'
  const requesterGrade = normalizeGradeInput(await getUserGrade(req))
  const onlyFollowing = asString(req.query.onlyFollowing) === '1'

  const userFollow = (prisma as any).userFollow as any
  const followingIds: string[] = userFollow
    ? (await userFollow.findMany({ where: { followerId: requesterId }, select: { followingId: true }, take: 400 }).catch(() => []))
        .map((r: any) => String(r.followingId || ''))
        .filter(Boolean)
    : []

  const learningGroupMember = (prisma as any).learningGroupMember as any
  const groupIds: string[] = learningGroupMember
    ? (await learningGroupMember.findMany({ where: { userId: requesterId }, select: { groupId: true }, take: 200 }).catch(() => []))
        .map((r: any) => String(r.groupId || ''))
        .filter(Boolean)
    : []

  const groupmateIds: string[] = (learningGroupMember && groupIds.length)
    ? (await learningGroupMember.findMany({ where: { groupId: { in: groupIds } }, select: { userId: true }, take: 800 }).catch(() => []))
        .map((r: any) => String(r.userId || ''))
        .filter((id: string) => Boolean(id) && id !== requesterId)
    : []

  const privilegedIds: string[] = (await prisma.user.findMany({
    where: { role: { in: ['admin', 'teacher'] } },
    select: { id: true },
    take: 800,
  }).catch(() => [] as any[])).map((u: any) => String(u?.id || '')).filter(Boolean)

  const publicCircleIds = Array.from(new Set([...followingIds, ...groupmateIds, ...privilegedIds])).filter((id) => id && id !== requesterId)
  const followingAndSelfIds = Array.from(new Set([...followingIds, requesterId])).filter(Boolean)
  if (onlyFollowing && followingAndSelfIds.length === 0) return res.status(200).json({ posts: [] })

  const socialPost = (prisma as any).socialPost as typeof prisma extends { socialPost: infer T } ? T : any
  const where: any = {
    ...(onlyFollowing ? { createdById: { in: followingAndSelfIds } } : {}),
    audience: { in: ['public', 'grade'] },
  }

  if (!isPrivileged && !onlyFollowing) {
    where.OR = [
      ...(requesterGrade ? [{ audience: 'grade', grade: requesterGrade, createdBy: { grade: requesterGrade } }] : []),
      { audience: 'public', createdBy: { role: { in: ['admin', 'teacher'] } } },
    ]
  } else if (!isPrivileged && onlyFollowing) {
    where.OR = [
      { audience: 'public', createdBy: { role: { in: ['admin', 'teacher'] } } },
      ...(requesterGrade ? [{ audience: 'grade', grade: requesterGrade, createdBy: { grade: requesterGrade } }] : []),
    ]
  }

  let items: any[] = []
  try {
    items = await socialPost.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: FEED_POST_SELECT,
    })
  } catch (err) {
    if (isMissingSocialPostsTableError(err)) {
      return res.status(200).json({ posts: [] })
    }
    throw err
  }

  const learnerResponse = (prisma as any).learnerResponse as typeof prisma extends { learnerResponse: infer T } ? T : any
  const postKeys = items.map((item) => `post:${item.id}`)
  const userResponses = postKeys.length ? await learnerResponse.findMany({
    where: { sessionKey: { in: postKeys }, userId: requesterId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, sessionKey: true, latex: true, studentText: true, excalidrawScene: true, updatedAt: true, createdAt: true },
  }).catch(() => []) : []

  const userAttemptCounts = postKeys.length ? await learnerResponse.groupBy({
    by: ['sessionKey'],
    where: { sessionKey: { in: postKeys }, userId: requesterId },
    _count: { id: true },
  }).catch(() => []) : []

  const solutionCounts = new Map<string, number>()
  const groupedSolutions = postKeys.length ? await learnerResponse.groupBy({
    by: ['sessionKey', 'userId'],
    where: { sessionKey: { in: postKeys } },
  }).catch(() => []) : []

  for (const row of groupedSolutions as any[]) {
    const key = String(row?.sessionKey || '')
    if (!key) continue
    solutionCounts.set(key, (solutionCounts.get(key) || 0) + 1)
  }

  const ownResponseByKey = new Map<string, any>()
  for (const response of userResponses as any[]) {
    const key = String(response?.sessionKey || '')
    if (!key || ownResponseByKey.has(key)) continue
    ownResponseByKey.set(key, response)
  }

  const attemptCountByKey = new Map<string, number>()
  for (const row of userAttemptCounts as any[]) {
    const key = String(row?.sessionKey || '')
    if (!key) continue
    attemptCountByKey.set(key, Number(row?._count?.id || 0))
  }

  const interactionStateByPostId = await getSocialPostInteractionState(items.map((item: any) => String(item?.id || '')), requesterId)
  const hydratedPosts = enrichFeedPosts(items, ownResponseByKey, attemptCountByKey, solutionCounts, interactionStateByPostId)

  const qbQuestionIds = Array.from(new Set(
    hydratedPosts
      .map((post) => {
        const origin = String(post?.composerMeta?.origin || '').trim()
        if (origin !== 'qb-question-post') return ''
        return String(post?.composerMeta?.questionId || '').trim()
      })
      .filter(Boolean),
  ))

  if (qbQuestionIds.length > 0) {
    const questionRows = await prisma.examQuestion.findMany({
      where: { id: { in: qbQuestionIds } },
      select: {
        id: true,
        questionNumber: true,
        questionText: true,
        latex: true,
        tableMarkdown: true,
        imageUrl: true,
      },
    }).catch(() => [])

    const canonicalMmdByQuestionId = new Map<string, string>()
    for (const row of questionRows) {
      const mmd = buildCanonicalQbQuestionMmd(row)
      if (mmd) canonicalMmdByQuestionId.set(String(row.id), mmd)
    }

    for (const post of hydratedPosts) {
      const origin = String(post?.composerMeta?.origin || '').trim()
      if (origin !== 'qb-question-post') continue
      const questionId = String(post?.composerMeta?.questionId || '').trim()
      if (!questionId) continue
      const canonicalMmd = canonicalMmdByQuestionId.get(questionId)
      if (!canonicalMmd) continue
      post.composerMeta = {
        ...(post.composerMeta || {}),
        remixMmd: canonicalMmd,
        remixSelectedQuestionNumber:
          String(post?.composerMeta?.remixSelectedQuestionNumber || '').trim()
          || String(post?.composerMeta?.questionNumber || '').trim()
          || String(questionRows.find((row) => String(row.id) === questionId)?.questionNumber || '').trim()
          || null,
      }
    }
  }

  return res.status(200).json({ posts: hydratedPosts })
}