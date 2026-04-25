import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../lib/prisma'
import { getUserIdFromReq } from '../../../../lib/auth'
import { getSocialPostInteractionState } from '../../../../lib/socialPostInteractions'

function parseKind(value: unknown): 'LIKE' | 'SHARE' | null {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (raw === 'LIKE' || raw === 'SHARE') return raw
  return null
}

function parseAction(value: unknown): 'set' | 'toggle' | null {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (raw === 'set' || raw === 'toggle') return raw
  return null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  const postId = String(req.query.id || '').trim()
  if (!postId) return res.status(400).json({ message: 'Missing post id' })

  const socialPost = (prisma as any).socialPost as any
  const socialPostInteraction = (prisma as any).socialPostInteraction as any
  if (!socialPost || !socialPostInteraction) {
    return res.status(503).json({ message: 'Post interactions are unavailable' })
  }

  const post = await socialPost.findUnique({ where: { id: postId }, select: { id: true } }).catch(() => null)
  if (!post) return res.status(404).json({ message: 'Post not found' })

  if (req.method === 'PATCH') {
    const kind = parseKind((req.body || {}).kind)
    const action = parseAction((req.body || {}).action)
    const requestedValue = (req.body || {}).value

    if (!kind || !action) return res.status(400).json({ message: 'Invalid interaction payload' })

    const existing = await socialPostInteraction.findUnique({
      where: {
        postId_userId_kind: {
          postId,
          userId,
          kind,
        },
      },
      select: { id: true },
    }).catch(() => null)

    let shouldExist = false
    if (action === 'toggle') {
      shouldExist = !Boolean(existing?.id)
    } else {
      shouldExist = Boolean(requestedValue)
    }

    if (shouldExist && !existing?.id) {
      await socialPostInteraction.create({
        data: {
          postId,
          userId,
          kind,
        },
      }).catch(() => null)
    }

    if (!shouldExist && existing?.id) {
      await socialPostInteraction.delete({ where: { id: existing.id } }).catch(() => null)
    }

    const stateMap = await getSocialPostInteractionState([postId], userId)
    const state = stateMap.get(postId) || { likeCount: 0, shareCount: 0, likedByMe: false }
    return res.status(200).json({ postId, ...state })
  }

  if (req.method === 'GET') {
    const stateMap = await getSocialPostInteractionState([postId], userId)
    const state = stateMap.get(postId) || { likeCount: 0, shareCount: 0, likedByMe: false }
    return res.status(200).json({ postId, ...state })
  }

  res.setHeader('Allow', ['GET', 'PATCH'])
  return res.status(405).end('Method Not Allowed')
}
