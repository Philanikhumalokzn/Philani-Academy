import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../../lib/prisma'
import { getUserGrade, getUserIdFromReq, getUserRole } from '../../../../../lib/auth'
import { enrichFeedPosts, FEED_POST_SELECT } from '../../../../../lib/feedContract'
import { normalizeGradeInput } from '../../../../../lib/grades'

function isMissingSocialPostsTableError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err || '')
  return /socialpost/i.test(message) && /(does not exist|not exist|no such table|relation)/i.test(message)
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end()
  }

  try {
    const requesterId = await getUserIdFromReq(req)
    const targetId = String(req.query.id || '')
    if (!targetId) return res.status(400).json({ message: 'Missing user id' })

    const role = (await getUserRole(req)) || 'student'
    const isPrivileged = role === 'admin' || role === 'teacher'

    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, grade: true, role: true },
    }).catch(() => null)
    if (!target) return res.status(404).json({ message: 'User not found' })

    const isSelf = Boolean(requesterId && requesterId === targetId)

    const requesterGrade = requesterId ? normalizeGradeInput(await getUserGrade(req)) : null
    const socialPost = (prisma as any).socialPost as typeof prisma extends { socialPost: infer T } ? T : any

    const where: any = { createdById: targetId }
    if (!isPrivileged && !isSelf) {
      const or: any[] = []
      if (String(target.role || '').toLowerCase() === 'admin' || String(target.role || '').toLowerCase() === 'teacher') {
        or.push({ audience: 'public' })
      }
      if (requesterGrade) {
        or.push({ audience: 'grade', grade: requesterGrade, createdBy: { grade: requesterGrade } })
      }
      where.OR = or.length > 0 ? or : [{ id: '__never__' }]
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

    const ownResponseByKey = new Map<string, any>()
    if (requesterId && items.length > 0) {
      const learnerResponse = (prisma as any).learnerResponse as typeof prisma extends { learnerResponse: infer T } ? T : any
      const responses = await learnerResponse.findMany({
        where: { sessionKey: { in: items.map((item: any) => `post:${item.id}`) }, userId: requesterId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, sessionKey: true, excalidrawScene: true, updatedAt: true },
      }).catch(() => [])

      for (const response of responses as any[]) {
        const key = String(response?.sessionKey || '')
        if (!key || ownResponseByKey.has(key)) continue
        ownResponseByKey.set(key, response)
      }
    }

    const learnerResponse = (prisma as any).learnerResponse as typeof prisma extends { learnerResponse: infer T } ? T : any
    const postKeys = items.map((item: any) => `post:${item.id}`)
    const userAttemptCounts = requesterId && postKeys.length ? await learnerResponse.groupBy({
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

    const attemptCountByKey = new Map<string, number>()
    for (const row of userAttemptCounts as any[]) {
      const key = String(row?.sessionKey || '')
      if (!key) continue
      attemptCountByKey.set(key, Number(row?._count?.id || 0))
    }

    return res.status(200).json({
      posts: enrichFeedPosts(items, ownResponseByKey, attemptCountByKey, solutionCounts),
    })
  } catch (err: any) {
    console.error('[/api/profile/view/[id]/posts]', err)
    return res.status(500).json({ message: err?.message || 'Internal server error' })
  }
}