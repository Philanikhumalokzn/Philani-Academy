import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserIdFromReq } from '../../../lib/auth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  const targetId = String(req.query.id || '')
  if (!targetId) return res.status(400).json({ message: 'Missing user id' })

  const userFollow = (prisma as any).userFollow as any
  if (!userFollow) return res.status(500).json({ message: 'UserFollow model not available (run prisma generate)' })

  if (req.method === 'GET') {
    if (targetId === userId) {
      const followerCount = await userFollow.count({ where: { followingId: targetId } }).catch(() => 0)
      const followingCount = await userFollow.count({ where: { followerId: targetId } }).catch(() => 0)
      return res.status(200).json({ isFollowing: false, followerCount, followingCount })
    }

    const existing = await userFollow
      .findUnique({ where: { followerId_followingId: { followerId: userId, followingId: targetId } } })
      .catch(() => null)

    const followerCount = await userFollow.count({ where: { followingId: targetId } }).catch(() => 0)
    const followingCount = await userFollow.count({ where: { followerId: targetId } }).catch(() => 0)

    return res.status(200).json({ isFollowing: Boolean(existing), followerCount, followingCount })
  }

  if (req.method === 'POST') {
    if (targetId === userId) return res.status(400).json({ message: 'You cannot follow yourself' })

    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } })
    if (!target) return res.status(404).json({ message: 'User not found' })

    try {
      await userFollow.create({ data: { followerId: userId, followingId: targetId } })
    } catch {
      // ignore duplicates
    }

    try {
      const follower = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } })
      const followerLabel = follower?.name || follower?.email || 'A user'
      await prisma.notification.create({
        data: {
          userId: targetId,
          type: 'new_follower',
          title: 'New follower',
          body: `${followerLabel} started following you`,
          data: { followerId: userId },
        },
      })
    } catch (notifyErr) {
      if (process.env.DEBUG === '1') console.error('Failed to create follow notification', notifyErr)
    }

    const followerCount = await userFollow.count({ where: { followingId: targetId } }).catch(() => 0)
    const followingCount = await userFollow.count({ where: { followerId: targetId } }).catch(() => 0)

    return res.status(200).json({ isFollowing: true, followerCount, followingCount })
  }

  if (req.method === 'DELETE') {
    if (targetId === userId) return res.status(400).json({ message: 'You cannot unfollow yourself' })

    await userFollow.deleteMany({ where: { followerId: userId, followingId: targetId } }).catch(() => null)

    const followerCount = await userFollow.count({ where: { followingId: targetId } }).catch(() => 0)
    const followingCount = await userFollow.count({ where: { followerId: targetId } }).catch(() => 0)

    return res.status(200).json({ isFollowing: false, followerCount, followingCount })
  }

  res.setHeader('Allow', ['GET', 'POST', 'DELETE'])
  return res.status(405).end()
}
