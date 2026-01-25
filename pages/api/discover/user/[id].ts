import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../lib/prisma'
import { getUserIdFromReq, getUserRole } from '../../../../lib/auth'
import { canViewOrDiscoverTarget } from '../../../../lib/discover'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requesterId = await getUserIdFromReq(req)
  if (!requesterId) return res.status(401).json({ message: 'Unauthorized' })

  const targetId = String(req.query.id || '')
  if (!targetId) return res.status(400).json({ message: 'Missing user id' })

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end()
  }

  const role = (await getUserRole(req)) || 'student'
  const isPrivileged = role === 'admin' || role === 'teacher'

  const requester = await prisma.user.findUnique({
    where: { id: requesterId },
    select: { id: true, role: true, grade: true, schoolName: true, province: true },
  })

  if (!requester) return res.status(401).json({ message: 'Unauthorized' })

  const requesterInfo = {
    id: requester.id,
    role: requester.role,
    grade: requester.grade ? String(requester.grade) : null,
    schoolName: String((requester as any).schoolName || ''),
    province: String((requester as any).province || ''),
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

  const sharedGroupsCount = await prisma.learningGroupMember.count({
    where: {
      userId: requesterId,
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

  const userFollow = (prisma as any).userFollow as any
  const isFollowing = requesterId !== targetId
    ? Boolean(await userFollow?.findUnique?.({ where: { followerId_followingId: { followerId: requesterId, followingId: targetId } } }).catch(() => null))
    : false

  const followerCount = await userFollow?.count?.({ where: { followingId: targetId } }).catch(() => 0)
  const followingCount = await userFollow?.count?.({ where: { followerId: targetId } }).catch(() => 0)

  return res.status(200).json({
    id: user.id,
    name: user.name || user.email,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    middleNames: user.middleNames,
    dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString() : null,
    idNumber: (user as any).idNumber ?? null,
    role: user.role,
    grade: user.grade,
    avatar: user.avatar,
    profileCoverUrl: (user as any).profileCoverUrl ?? null,
    profileThemeBgUrl: (user as any).profileThemeBgUrl ?? null,
    statusBio: user.statusBio,
    schoolName: user.schoolName,
    phoneNumber: (user as any).phoneNumber ?? null,
    alternatePhone: (user as any).alternatePhone ?? null,
    recoveryEmail: (user as any).recoveryEmail ?? null,
    emergencyContactName: (user as any).emergencyContactName ?? null,
    emergencyContactRelationship: (user as any).emergencyContactRelationship ?? null,
    emergencyContactPhone: (user as any).emergencyContactPhone ?? null,
    addressLine1: (user as any).addressLine1 ?? null,
    addressLine2: (user as any).addressLine2 ?? null,
    city: (user as any).city ?? null,
    province: (user as any).province ?? null,
    postalCode: (user as any).postalCode ?? null,
    country: (user as any).country ?? null,
    uiHandedness: (user as any).uiHandedness ?? null,
    consentToPolicies: Boolean((user as any).consentToPolicies),
    consentTimestamp: (user as any).consentTimestamp ? new Date((user as any).consentTimestamp).toISOString() : null,
    verified: user.role === 'admin' || user.role === 'teacher',
    followerCount: typeof followerCount === 'number' ? followerCount : 0,
    followingCount: typeof followingCount === 'number' ? followingCount : 0,
    isFollowing,
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
