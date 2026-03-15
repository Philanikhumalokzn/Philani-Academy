import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../../lib/prisma'
import { getUserGrade, getUserIdFromReq, getUserRole } from '../../../../../lib/auth'
import { normalizeGradeInput } from '../../../../../lib/grades'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end()
  }

  const requesterId = await getUserIdFromReq(req)
  const targetId = String(req.query.id || '')
  if (!targetId) return res.status(400).json({ message: 'Missing user id' })

  const role = (await getUserRole(req)) || 'student'
  const isPrivileged = role === 'admin' || role === 'teacher'

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, profileVisibility: true, grade: true },
  })
  if (!target) return res.status(404).json({ message: 'User not found' })

  const isSelf = Boolean(requesterId && requesterId === targetId)
  if (!isPrivileged && !isSelf) {
    const visibility = String(target.profileVisibility || 'shared')
    if (visibility === 'private') {
      return res.status(403).json({ message: 'This profile is private' })
    }
  }

  const requesterGrade = requesterId ? normalizeGradeInput(await getUserGrade(req)) : null
  const socialPost = (prisma as any).socialPost as typeof prisma extends { socialPost: infer T } ? T : any

  const where: any = { createdById: targetId }
  if (!isPrivileged && !isSelf) {
    const or: any[] = [{ audience: 'public' }]
    if (requesterGrade) or.push({ audience: 'grade', grade: requesterGrade })
    where.OR = or
  }

  const items = await socialPost.findMany({
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
      createdAt: true,
      createdById: true,
    },
  })

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

  return res.status(200).json({
    posts: items.map((item: any) => ({
      ...item,
      kind: 'post',
      threadKey: `post:${item.id}`,
      ownResponse: ownResponseByKey.get(`post:${item.id}`) || null,
      hasOwnResponse: ownResponseByKey.has(`post:${item.id}`),
      solutionCount: solutionCounts.get(`post:${item.id}`) || 0,
    })),
  })
}