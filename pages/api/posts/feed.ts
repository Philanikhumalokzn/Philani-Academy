import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserGrade, getUserIdFromReq, getUserRole } from '../../../lib/auth'
import { enrichFeedPosts, FEED_POST_SELECT } from '../../../lib/feedContract'
import { normalizeGradeInput } from '../../../lib/grades'

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
  if (onlyFollowing && followingIds.length === 0) return res.status(200).json({ posts: [] })

  const socialPost = (prisma as any).socialPost as typeof prisma extends { socialPost: infer T } ? T : any
  const where: any = {
    createdById: onlyFollowing ? { in: followingIds, not: requesterId } : { not: requesterId },
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

  return res.status(200).json({
    posts: enrichFeedPosts(items, ownResponseByKey, attemptCountByKey, solutionCounts),
  })
}