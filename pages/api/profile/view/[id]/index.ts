import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../../lib/prisma'
import { getUserIdFromReq, getUserRole } from '../../../../../lib/auth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requesterId = await getUserIdFromReq(req)
  if (!requesterId) return res.status(401).json({ message: 'Unauthorized' })

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end()
  }

  const targetId = String(req.query.id || '')
  if (!targetId) return res.status(400).json({ message: 'Missing user id' })

  const role = (await getUserRole(req)) || 'student'
  const isPrivileged = role === 'admin' || role === 'teacher'

  const target = await prisma.user.findUnique({
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
      phoneNumber: true,
      alternatePhone: true,
      recoveryEmail: true,
      emergencyContactName: true,
      emergencyContactRelationship: true,
      emergencyContactPhone: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      province: true,
      postalCode: true,
      country: true,
      uiHandedness: true,
      consentToPolicies: true,
      consentTimestamp: true,
      profileVisibility: true,
      discoverabilityScope: true,
    },
  })

  if (!target) return res.status(404).json({ message: 'User not found' })

  if (!isPrivileged && requesterId !== targetId) {
    // Require shared group membership
    const shared = await prisma.learningGroupMember.findFirst({
      where: {
        userId: requesterId,
        group: {
          members: {
            some: { userId: targetId },
          },
        },
      },
      select: { id: true },
    })

    if (!shared) return res.status(403).json({ message: 'Forbidden' })

    if ((target.profileVisibility || 'shared') === 'private') {
      return res.status(403).json({ message: 'This profile is private' })
    }
  }

  const userFollow = (prisma as any).userFollow as any
  const isFollowing = requesterId !== targetId
    ? Boolean(await userFollow?.findUnique?.({ where: { followerId_followingId: { followerId: requesterId, followingId: targetId } } }).catch(() => null))
    : false
  const followerCount = await userFollow?.count?.({ where: { followingId: targetId } }).catch(() => 0)
  const followingCount = await userFollow?.count?.({ where: { followerId: targetId } }).catch(() => 0)

  return res.status(200).json({
    id: target.id,
    name: target.name || target.email,
    email: target.email,
    firstName: target.firstName,
    lastName: target.lastName,
    middleNames: target.middleNames,
    dateOfBirth: target.dateOfBirth ? target.dateOfBirth.toISOString() : null,
    idNumber: (target as any).idNumber ?? null,
    role: target.role,
    grade: target.grade,
    avatar: target.avatar,
    profileCoverUrl: (target as any).profileCoverUrl ?? null,
    profileThemeBgUrl: (target as any).profileThemeBgUrl ?? null,
    statusBio: target.statusBio,
    schoolName: target.schoolName,
    phoneNumber: (target as any).phoneNumber ?? null,
    alternatePhone: (target as any).alternatePhone ?? null,
    recoveryEmail: (target as any).recoveryEmail ?? null,
    emergencyContactName: (target as any).emergencyContactName ?? null,
    emergencyContactRelationship: (target as any).emergencyContactRelationship ?? null,
    emergencyContactPhone: (target as any).emergencyContactPhone ?? null,
    addressLine1: (target as any).addressLine1 ?? null,
    addressLine2: (target as any).addressLine2 ?? null,
    city: (target as any).city ?? null,
    province: (target as any).province ?? null,
    postalCode: (target as any).postalCode ?? null,
    country: (target as any).country ?? null,
    uiHandedness: (target as any).uiHandedness ?? null,
    consentToPolicies: Boolean((target as any).consentToPolicies),
    consentTimestamp: (target as any).consentTimestamp ? new Date((target as any).consentTimestamp).toISOString() : null,
    verified: target.role === 'admin' || target.role === 'teacher',
    followerCount: typeof followerCount === 'number' ? followerCount : 0,
    followingCount: typeof followingCount === 'number' ? followingCount : 0,
    isFollowing,
  })
}
