import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserIdFromReq, getUserRole } from '../../../lib/auth'
import { canViewOrDiscoverTarget, getDiscoverRecommendations } from '../../../lib/discover'

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown) {
  const n = typeof value === 'number' ? value : Number(String(value || ''))
  return Number.isFinite(n) ? n : null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end()
  }

  const role = (await getUserRole(req)) || 'student'
  const isPrivileged = role === 'admin' || role === 'teacher'

  const q = asString(req.query.q)
  const hint = asString(req.query.hint)
  const limit = (() => {
    const raw = asNumber(req.query.limit)
    if (!raw) return 24
    return Math.max(5, Math.min(60, Math.trunc(raw)))
  })()

  const hasQuery = Boolean(q && q.length >= 1)

  // Default experience: always return recommendations when there's no query.
  if (!hasQuery) {
    const recs = await getDiscoverRecommendations({ requesterId: userId, role, limit, recentQueryHint: hint || null })
    return res.status(200).json(recs)
  }

  const requester = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, grade: true, schoolName: true, province: true },
  })

  if (!requester) return res.status(200).json([])

  const requesterInfo = {
    id: requester.id,
    role: requester.role,
    grade: requester.grade ? String(requester.grade) : null,
    schoolName: String((requester as any).schoolName || ''),
    province: String((requester as any).province || ''),
  }

  const myMemberships = await prisma.learningGroupMember.findMany({
    where: { userId },
    select: { groupId: true },
  })
  const groupIds = Array.from(new Set(myMemberships.map(m => m.groupId))).filter(Boolean)

  const sharedCounts = new Map<string, number>()
  if (groupIds.length > 0) {
    const memberships = await prisma.learningGroupMember.findMany({
      where: { groupId: { in: groupIds } },
      select: { userId: true },
    })
    for (const m of memberships) {
      if (!m.userId || m.userId === userId) continue
      sharedCounts.set(m.userId, (sharedCounts.get(m.userId) || 0) + 1)
    }
  }

  const users = await prisma.user.findMany({
    where: {
      id: { not: userId },
      ...(isPrivileged ? {} : { profileVisibility: { not: 'private' } }),
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { schoolName: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      grade: true,
      avatar: true,
      statusBio: true,
      schoolName: true,
      province: true,
      profileVisibility: true,
      discoverabilityScope: true,
      profileCoverUrl: true,
      profileThemeBgUrl: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: Math.max(40, limit * 3),
  })

  const qLower = q.toLowerCase()
  const scored = (users as any[])
    .map((u) => {
      const sharedGroupsCount = sharedCounts.get(u.id) || 0

      const allowed = canViewOrDiscoverTarget({
        requester: requesterInfo,
        target: {
          ...u,
          grade: u.grade,
          avatar: u.avatar,
          statusBio: u.statusBio,
          schoolName: u.schoolName,
          province: u.province,
          profileVisibility: u.profileVisibility,
          discoverabilityScope: u.discoverabilityScope,
          profileCoverUrl: u.profileCoverUrl,
          profileThemeBgUrl: u.profileThemeBgUrl,
        },
        sharedGroupsCount,
        isPrivileged,
      })
      if (!allowed) return null

      let score = 0
      if (sharedGroupsCount > 0) score += 50 + Math.min(20, sharedGroupsCount * 3)
      const requesterGrade = requesterInfo.grade
      const targetGrade = u.grade ? String(u.grade) : null
      if (requesterGrade && targetGrade && requesterGrade === targetGrade) score += 25
      if (requesterInfo.schoolName && u.schoolName && requesterInfo.schoolName === u.schoolName) score += 10
      if (requesterInfo.province && u.province && requesterInfo.province === u.province) score += 5

      const n = String(u.name || u.email || '').toLowerCase()
      const e = String(u.email || '').toLowerCase()
      const s = String(u.schoolName || '').toLowerCase()
      if (n.includes(qLower)) score += 10
      if (e.includes(qLower)) score += 8
      if (s.includes(qLower)) score += 5

      return {
        id: u.id,
        name: u.name || u.email,
        role: u.role,
        grade: u.grade,
        avatar: u.avatar,
        statusBio: u.statusBio,
        schoolName: u.schoolName,
        verified: u.role === 'admin' || u.role === 'teacher',
        profileCoverUrl: u.profileCoverUrl,
        profileThemeBgUrl: u.profileThemeBgUrl,
        sharedGroupsCount,
        score,
      }
    })
    .filter(Boolean)

  scored.sort((a: any, b: any) => (b.score || 0) - (a.score || 0))

  return res.status(200).json(scored.slice(0, limit))
}
