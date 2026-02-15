import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../lib/prisma'
import { getUserIdFromReq, getUserRole } from '../../../../lib/auth'
import { canViewOrDiscoverTarget } from '../../../../lib/discover'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requesterId = await getUserIdFromReq(req)

  const targetId = String(req.query.id || '')
  if (!targetId) return res.status(400).json({ message: 'Missing user id' })

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end()
  }

  let isPrivileged = false
  let requesterInfo: {
    id: string
    role: string
    grade: string | null
    schoolName: string
    province: string
  } | null = null

  if (requesterId) {
    const role = (await getUserRole(req)) || 'student'
    isPrivileged = role === 'admin' || role === 'teacher'

    const requester = await prisma.user.findUnique({
      where: { id: requesterId },
      select: { id: true, role: true, grade: true, schoolName: true, province: true },
    })

    if (requester) {
      requesterInfo = {
        id: requester.id,
        role: requester.role,
        grade: requester.grade ? String(requester.grade) : null,
        schoolName: String((requester as any).schoolName || ''),
        province: String((requester as any).province || ''),
      }
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      name: true,
      email: true,
      firstName: true,
      lastName: true,
      middleNames: true,
      dateOfBirth: true,
      idNumber: true,
      role: true,
      grade: true,
      avatar: true,
      profileCoverUrl: true,
      profileThemeBgUrl: true,
      statusBio: true,
      schoolName: true,
      province: true,
      phoneNumber: true,
      alternatePhone: true,
      recoveryEmail: true,
      emergencyContactName: true,
      emergencyContactRelationship: true,
      emergencyContactPhone: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      postalCode: true,
      country: true,
      uiHandedness: true,
      consentToPolicies: true,
      consentTimestamp: true,
      profileVisibility: true,
      discoverabilityScope: true,
      groupsCreated: {
        where: { allowJoinRequests: true },
        select: { id: true, name: true, type: true, grade: true, joinCodeActive: true, createdAt: true, _count: { select: { members: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10
      }
    }
  })

  if (!user) return res.status(404).json({ message: 'User not found' })

  const isSelf = Boolean(requesterInfo && requesterInfo.id === targetId)
  const visibility = String((user as any).profileVisibility || 'shared')

  if (!requesterInfo) {
    if (visibility === 'private') {
      return res.status(403).json({ message: 'This profile is private' })
    }
  } else {
    const sharedGroupsCount = await prisma.learningGroupMember.count({
      where: {
        userId: requesterInfo.id,
        group: {
          members: {
            some: { userId: targetId },
          },
        },
      },
    })

    if (!canViewOrDiscoverTarget({ requester: requesterInfo, target: user as any, sharedGroupsCount, isPrivileged })) {
      return res.status(403).json({ message: 'This profile is not discoverable to you' })
    }
  }

  const canViewSensitive = isPrivileged || isSelf

  const userFollow = (prisma as any).userFollow as any
  const isFollowing = requesterInfo && requesterInfo.id !== targetId
    ? Boolean(await userFollow?.findUnique?.({ where: { followerId_followingId: { followerId: requesterInfo.id, followingId: targetId } } }).catch(() => null))
    : false

  const followerCount = await userFollow?.count?.({ where: { followingId: targetId } }).catch(() => 0)
  const followingCount = await userFollow?.count?.({ where: { followerId: targetId } }).catch(() => 0)
  const displayName = user.name || (canViewSensitive ? user.email : 'User')

  return res.status(200).json({
    id: user.id,
    name: displayName,
    email: canViewSensitive ? user.email : null,
    firstName: canViewSensitive ? user.firstName : null,
    lastName: canViewSensitive ? user.lastName : null,
    middleNames: canViewSensitive ? user.middleNames : null,
    dateOfBirth: canViewSensitive && user.dateOfBirth ? user.dateOfBirth.toISOString() : null,
    idNumber: canViewSensitive ? (user as any).idNumber ?? null : null,
    role: user.role,
    grade: user.grade,
    avatar: user.avatar,
    profileCoverUrl: (user as any).profileCoverUrl ?? null,
    profileThemeBgUrl: (user as any).profileThemeBgUrl ?? null,
    statusBio: user.statusBio,
    schoolName: user.schoolName,
    phoneNumber: canViewSensitive ? (user as any).phoneNumber ?? null : null,
    alternatePhone: canViewSensitive ? (user as any).alternatePhone ?? null : null,
    recoveryEmail: canViewSensitive ? (user as any).recoveryEmail ?? null : null,
    emergencyContactName: canViewSensitive ? (user as any).emergencyContactName ?? null : null,
    emergencyContactRelationship: canViewSensitive ? (user as any).emergencyContactRelationship ?? null : null,
    emergencyContactPhone: canViewSensitive ? (user as any).emergencyContactPhone ?? null : null,
    addressLine1: canViewSensitive ? (user as any).addressLine1 ?? null : null,
    addressLine2: canViewSensitive ? (user as any).addressLine2 ?? null : null,
    city: canViewSensitive ? (user as any).city ?? null : null,
    province: canViewSensitive ? (user as any).province ?? null : null,
    postalCode: canViewSensitive ? (user as any).postalCode ?? null : null,
    country: canViewSensitive ? (user as any).country ?? null : null,
    uiHandedness: canViewSensitive ? (user as any).uiHandedness ?? null : null,
    consentToPolicies: canViewSensitive ? Boolean((user as any).consentToPolicies) : false,
    consentTimestamp: canViewSensitive && (user as any).consentTimestamp ? new Date((user as any).consentTimestamp).toISOString() : null,
    verified: user.role === 'admin' || user.role === 'teacher',
    followerCount: typeof followerCount === 'number' ? followerCount : 0,
    followingCount: typeof followingCount === 'number' ? followingCount : 0,
    isFollowing: Boolean(isFollowing),
    groups: (user.groupsCreated || []).map((g: any) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      grade: g.grade,
      joinCodeActive: g.joinCodeActive,
      membersCount: g._count?.members ?? 0
    }))
  })
}
