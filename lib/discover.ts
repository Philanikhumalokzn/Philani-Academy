import prisma from './prisma'
import { cacheGet, cacheSet } from './simpleCache'

export type DiscoverUserCard = {
  id: string
  name: string
  role?: string | null
  grade?: string | null
  avatar?: string | null
  statusBio?: string | null
  schoolName?: string | null
  verified?: boolean
  profileCoverUrl?: string | null
  profileThemeBgUrl?: string | null
  score?: number
  sharedGroupsCount?: number
}

type RequesterInfo = {
  id: string
  role: string
  grade: string | null
  schoolName: string
  province: string
}

type TargetInfo = {
  id: string
  name: string | null
  email: string
  role: string
  grade: any
  avatar: string | null
  statusBio: string | null
  schoolName: string
  province: string
  profileVisibility: string
  discoverabilityScope: string
  profileCoverUrl: string | null
  profileThemeBgUrl: string | null
  createdAt?: Date
}

function normalizeScope(raw: unknown) {
  const v = String(raw || 'grade').toLowerCase()
  if (v === 'school' || v === 'province' || v === 'global') return v
  return 'grade'
}

function normalizeVisibility(raw: unknown) {
  const v = String(raw || 'shared').toLowerCase()
  if (v === 'private' || v === 'discoverable' || v === 'shared') return v
  return 'shared'
}

export function canViewOrDiscoverTarget(params: {
  requester: RequesterInfo
  target: TargetInfo
  sharedGroupsCount: number
  isPrivileged: boolean
}) {
  const { requester, target, sharedGroupsCount, isPrivileged } = params
  if (isPrivileged) return true
  if (requester.id === target.id) return true
  if (target.role === 'admin') return true

  const visibility = normalizeVisibility(target.profileVisibility)
  if (visibility === 'private') return false

  const requesterGrade = requester.grade
  const targetGrade = (target.grade ? String(target.grade) : null)

  const groupmate = sharedGroupsCount > 0
  const sameGrade = Boolean(requesterGrade && targetGrade && requesterGrade === targetGrade)
  const sameSchool = Boolean(requester.schoolName && target.schoolName && requester.schoolName === target.schoolName)
  const sameProvince = Boolean(requester.province && target.province && requester.province === target.province)

  if (visibility === 'shared') {
    // Default: classmates + groupmates.
    return groupmate || sameGrade
  }

  const scope = normalizeScope(target.discoverabilityScope)
  if (scope === 'grade') return groupmate || sameGrade
  if (scope === 'school') return groupmate || sameSchool
  if (scope === 'province') return groupmate || sameProvince
  if (scope === 'global') return true

  return groupmate || sameGrade
}

export async function getDiscoverRecommendations(params: {
  requesterId: string
  role: string
  limit?: number
  recentQueryHint?: string | null
}) {
  const { requesterId, role, limit = 24, recentQueryHint } = params
  const isPrivileged = role === 'admin' || role === 'teacher'

  const cacheKey = `discover:recs:v1:${requesterId}:${isPrivileged ? 'p' : 's'}:${String(recentQueryHint || '').slice(0, 30)}`
  const cached = cacheGet<DiscoverUserCard[]>(cacheKey)
  if (cached) return cached.slice(0, limit)

  const requester = await prisma.user.findUnique({
    where: { id: requesterId },
    select: { id: true, role: true, grade: true, schoolName: true, province: true },
  })

  if (!requester) return []

  const requesterInfo: RequesterInfo = {
    id: requester.id,
    role: requester.role,
    grade: requester.grade ? String(requester.grade) : null,
    schoolName: String((requester as any).schoolName || ''),
    province: String((requester as any).province || ''),
  }

  const myMemberships = await prisma.learningGroupMember.findMany({
    where: { userId: requesterId },
    select: { groupId: true },
  })
  const groupIds = Array.from(new Set(myMemberships.map(m => m.groupId))).filter(Boolean)

  // Shared-group counts per candidate.
  const sharedCounts = new Map<string, number>()
  if (groupIds.length > 0) {
    const memberships = await prisma.learningGroupMember.findMany({
      where: { groupId: { in: groupIds } },
      select: { userId: true, groupId: true },
    })
    for (const m of memberships) {
      if (!m.userId || m.userId === requesterId) continue
      sharedCounts.set(m.userId, (sharedCounts.get(m.userId) || 0) + 1)
    }
  }

  const classmateWhere: any = requester.grade ? { grade: requester.grade } : undefined
  const baseWhere: any = {
    id: { not: requesterId },
  }

  // For non-privileged, include admins even if private, otherwise exclude private profiles.
  if (!isPrivileged) {
    baseWhere.OR = [
      { profileVisibility: { not: 'private' } },
      { role: 'admin' },
    ]
  }

  const candidateOr = [
    ...(classmateWhere ? [classmateWhere] : []),
    ...(groupIds.length > 0
      ? [
          {
            groupMemberships: {
              some: { groupId: { in: groupIds } },
            },
          },
        ]
      : []),
    // Privileged users may see wider results.
    ...(isPrivileged ? [{}] : []),
  ]

  const candidates = await prisma.user.findMany({
    where: {
      ...baseWhere,
      ...(candidateOr.length > 0 ? { OR: candidateOr } : {}),
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
    take: Math.max(60, limit * 3),
    orderBy: { createdAt: 'desc' },
  })

  const hint = String(recentQueryHint || '').trim().toLowerCase()

  const scored: DiscoverUserCard[] = []
  for (const u of candidates as any as TargetInfo[]) {
    const sharedGroupsCount = sharedCounts.get(u.id) || 0

    const allowed = canViewOrDiscoverTarget({
      requester: requesterInfo,
      target: u,
      sharedGroupsCount,
      isPrivileged,
    })
    if (!allowed) continue

    let score = 0
    if (sharedGroupsCount > 0) score += 50 + Math.min(20, sharedGroupsCount * 3)

    const requesterGrade = requesterInfo.grade
    const targetGrade = u.grade ? String(u.grade) : null
    if (requesterGrade && targetGrade && requesterGrade === targetGrade) score += 25

    if (requesterInfo.schoolName && u.schoolName && requesterInfo.schoolName === u.schoolName) score += 10
    if (requesterInfo.province && u.province && requesterInfo.province === u.province) score += 5
    if (u.role === 'admin') score += 40

    // Lightweight "interaction" heuristic using group invites (if any).
    // Keep it cheap: only if we have a small candidate set.

    // Recent query hint match
    if (hint && hint.length >= 2) {
      const n = String(u.name || u.email || '').toLowerCase()
      const e = String(u.email || '').toLowerCase()
      if (n.includes(hint) || e.includes(hint)) score += 8
    }

    scored.push({
      id: u.id,
      name: u.name || u.email,
      role: u.role,
      grade: u.grade ? String(u.grade) : null,
      avatar: u.avatar,
      statusBio: u.statusBio,
      schoolName: u.schoolName,
      verified: u.role === 'admin' || u.role === 'teacher',
      profileCoverUrl: u.profileCoverUrl,
      profileThemeBgUrl: u.profileThemeBgUrl,
      score,
      sharedGroupsCount,
    })
  }

  // Add invite-based bonus (optional) without exploding query costs.
  const topForInvite = scored.slice(0, 80)
  if (topForInvite.length > 0) {
    const ids = topForInvite.map(u => u.id)
    try {
      const invites = await prisma.groupInvite.findMany({
        where: {
          OR: [
            { invitedUserId: { in: ids }, invitedById: requesterId },
            { invitedUserId: requesterId, invitedById: { in: ids } },
          ],
        },
        select: { invitedUserId: true, invitedById: true },
        take: 200,
      })

      const bonus = new Set<string>()
      for (const inv of invites) {
        if (inv.invitedById === requesterId && ids.includes(inv.invitedUserId)) bonus.add(inv.invitedUserId)
        if (inv.invitedUserId === requesterId && inv.invitedById && ids.includes(inv.invitedById)) bonus.add(inv.invitedById)
      }

      if (bonus.size > 0) {
        for (const u of scored) {
          if (bonus.has(u.id)) u.score = (u.score || 0) + 3
        }
      }
    } catch {
      // ignore
    }
  }

  scored.sort((a, b) => {
    const s = (b.score || 0) - (a.score || 0)
    if (s) return s
    const g = (b.sharedGroupsCount || 0) - (a.sharedGroupsCount || 0)
    if (g) return g
    return String(a.name || '').localeCompare(String(b.name || ''))
  })

  if (scored.length === 0) {
    const adminFallback = await prisma.user.findMany({
      where: { id: { not: requesterId }, role: 'admin' },
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
      },
      take: Math.max(5, limit),
    })

    for (const u of adminFallback as any as TargetInfo[]) {
      scored.push({
        id: u.id,
        name: u.name || u.email,
        role: u.role,
        grade: u.grade ? String(u.grade) : null,
        avatar: u.avatar,
        statusBio: u.statusBio,
        schoolName: u.schoolName,
        verified: true,
        profileCoverUrl: u.profileCoverUrl,
        profileThemeBgUrl: u.profileThemeBgUrl,
        score: 100,
        sharedGroupsCount: 0,
      })
    }
  }

  if (scored.length === 0) {
    const self = await prisma.user.findUnique({
      where: { id: requesterId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        grade: true,
        avatar: true,
        statusBio: true,
        schoolName: true,
        profileCoverUrl: true,
        profileThemeBgUrl: true,
      },
    })
    if (self) {
      scored.push({
        id: self.id,
        name: self.name || self.email,
        role: self.role,
        grade: self.grade ? String(self.grade) : null,
        avatar: self.avatar,
        statusBio: self.statusBio,
        schoolName: self.schoolName,
        verified: self.role === 'admin' || self.role === 'teacher',
        profileCoverUrl: self.profileCoverUrl,
        profileThemeBgUrl: self.profileThemeBgUrl,
        score: 1,
        sharedGroupsCount: 0,
      })
    }
  }

  const out = scored.slice(0, limit)
  cacheSet(cacheKey, out, 2 * 60 * 1000)
  return out
}
