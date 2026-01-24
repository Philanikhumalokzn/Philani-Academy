import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserGrade, getUserIdFromReq, getUserRole } from '../../../lib/auth'
import { normalizeGradeInput } from '../../../lib/grades'

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
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

  const publicCircleIds = Array.from(new Set([...followingIds, ...groupmateIds, ...privilegedIds]))
    .filter((id) => id && id !== requesterId)

  if (onlyFollowing && followingIds.length === 0) {
    return res.status(200).json({ posts: [] })
  }

  const userChallenge = (prisma as any).userChallenge as typeof prisma extends { userChallenge: infer T } ? T : any

  const where: any = {
    createdById: onlyFollowing ? { in: followingIds, not: requesterId } : { not: requesterId },
    audience: { in: ['public', 'grade'] },
  }

  if (!isPrivileged && !onlyFollowing) {
    // Students: allow grade posts for their grade (classmates).
    // For public posts, restrict to a reasonable “circle” (following, groupmates, staff).
    where.OR = [
      ...(requesterGrade ? [{ audience: 'grade', grade: requesterGrade }] : []),
      ...(publicCircleIds.length ? [{ audience: 'public', createdById: { in: publicCircleIds } }] : []),
    ]
  } else if (!isPrivileged && onlyFollowing) {
    // Follow-only mode: already restricted by createdById above; keep the grade rule for safety.
    where.OR = [
      { audience: 'public' },
      ...(requesterGrade ? [{ audience: 'grade', grade: requesterGrade }] : []),
    ]
  }

  const items = await userChallenge.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: {
      id: true,
      title: true,
      prompt: true,
      imageUrl: true,
      grade: true,
      audience: true,
      attemptsOpen: true,
      maxAttempts: true,
      createdAt: true,
      createdById: true,
      createdBy: {
        select: {
          id: true,
          name: true,
          avatar: true,
          grade: true,
        },
      },
    },
  })

  // Fetch user's attempt counts for all challenges
  const learnerResponse = (prisma as any).learnerResponse as typeof prisma extends { learnerResponse: infer T } ? T : any
  const challengeIds = items.map(i => `challenge:${i.id}`)
  
  const userResponses = await learnerResponse.groupBy({
    by: ['sessionKey'],
    where: {
      sessionKey: { in: challengeIds },
      userId: requesterId,
    },
    _count: {
      id: true,
    },
  })

  const attemptCounts = new Map<string, number>()
  for (const r of userResponses) {
    attemptCounts.set(String(r.sessionKey), r._count.id)
  }

  const postsWithAttempts = items.map(item => ({
    ...item,
    myAttemptCount: attemptCounts.get(`challenge:${item.id}`) || 0,
  }))

  const followingSet = new Set(followingIds)
  postsWithAttempts.sort((a: any, b: any) => {
    if (onlyFollowing) return 0
    const af = followingSet.has(String(a?.createdById || a?.createdBy?.id || '')) ? 1 : 0
    const bf = followingSet.has(String(b?.createdById || b?.createdBy?.id || '')) ? 1 : 0
    if (bf !== af) return bf - af
    const at = new Date(String(a?.createdAt || 0)).getTime()
    const bt = new Date(String(b?.createdAt || 0)).getTime()
    return (bt || 0) - (at || 0)
  })

  return res.status(200).json({ posts: postsWithAttempts })
}
