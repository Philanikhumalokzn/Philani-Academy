import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../../lib/prisma'
import { getUserIdFromReq, getUserRole } from '../../../../../lib/auth'

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

  const isSelf = Boolean(requesterId && requesterId === targetId)
  if (!isPrivileged && !isSelf) {
    if ((target.profileVisibility || 'shared') === 'private') {
      return res.status(403).json({ message: 'This profile is private' })
    }
  }

  const canViewSensitive = isPrivileged || isSelf

  const userFollow = (prisma as any).userFollow as any
  const isFollowing = requesterId && requesterId !== targetId
    ? Boolean(await userFollow?.findUnique?.({ where: { followerId_followingId: { followerId: requesterId, followingId: targetId } } }).catch(() => null))
    : false
  const followerCount = await userFollow?.count?.({ where: { followingId: targetId } }).catch(() => 0)
  const followingCount = await userFollow?.count?.({ where: { followerId: targetId } }).catch(() => 0)

  const displayName = target.name || (canViewSensitive ? target.email : 'User')

  return res.status(200).json({
    id: target.id,
    name: displayName,
    email: canViewSensitive ? target.email : null,
    firstName: canViewSensitive ? target.firstName : null,
    lastName: canViewSensitive ? target.lastName : null,
    middleNames: canViewSensitive ? target.middleNames : null,
    dateOfBirth: canViewSensitive && target.dateOfBirth ? target.dateOfBirth.toISOString() : null,
    idNumber: canViewSensitive ? (target as any).idNumber ?? null : null,
    role: target.role,
    grade: target.grade,
    avatar: target.avatar,
    profileCoverUrl: (target as any).profileCoverUrl ?? null,
    profileThemeBgUrl: (target as any).profileThemeBgUrl ?? null,
    statusBio: target.statusBio,
    schoolName: target.schoolName,
    phoneNumber: canViewSensitive ? (target as any).phoneNumber ?? null : null,
    alternatePhone: canViewSensitive ? (target as any).alternatePhone ?? null : null,
    recoveryEmail: canViewSensitive ? (target as any).recoveryEmail ?? null : null,
    emergencyContactName: canViewSensitive ? (target as any).emergencyContactName ?? null : null,
    emergencyContactRelationship: canViewSensitive ? (target as any).emergencyContactRelationship ?? null : null,
    emergencyContactPhone: canViewSensitive ? (target as any).emergencyContactPhone ?? null : null,
    addressLine1: canViewSensitive ? (target as any).addressLine1 ?? null : null,
    addressLine2: canViewSensitive ? (target as any).addressLine2 ?? null : null,
    city: canViewSensitive ? (target as any).city ?? null : null,
    province: canViewSensitive ? (target as any).province ?? null : null,
    postalCode: canViewSensitive ? (target as any).postalCode ?? null : null,
    country: canViewSensitive ? (target as any).country ?? null : null,
    uiHandedness: canViewSensitive ? (target as any).uiHandedness ?? null : null,
    consentToPolicies: canViewSensitive ? Boolean((target as any).consentToPolicies) : false,
    consentTimestamp: canViewSensitive && (target as any).consentTimestamp ? new Date((target as any).consentTimestamp).toISOString() : null,
    verified: target.role === 'admin' || target.role === 'teacher',
    followerCount: typeof followerCount === 'number' ? followerCount : 0,
    followingCount: typeof followingCount === 'number' ? followingCount : 0,
    isFollowing: Boolean(isFollowing),
  })
}
