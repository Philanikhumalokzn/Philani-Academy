import type { NextApiRequest, NextApiResponse } from 'next'

import prisma from '../../../../../../lib/prisma'
import { getUserIdFromReq } from '../../../../../../lib/auth'
import {
  consumeGrantedRemixSolutionAccess,
  createRemixSolutionAccessRequest,
  declineRemixSolutionAccessRequest,
  getLatestActiveRemixSolutionAccess,
  getRemixSolutionAccessRequestById,
  grantRemixSolutionAccessRequest,
  updateRemixSolutionAccessNotificationIds,
} from '../../../../../../lib/remixSolutionAccess'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const threadKey = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  const responseId = Array.isArray(req.query.responseId) ? req.query.responseId[0] : req.query.responseId
  const userId = await getUserIdFromReq(req)

  if (!userId) return res.status(401).json({ message: 'Unauthorized' })
  if (!threadKey || !String(threadKey).startsWith('qb:')) {
    return res.status(400).json({ message: 'This access contract is only supported for Remix question solutions' })
  }
  if (!responseId) return res.status(400).json({ message: 'Response id is required' })

  const learnerResponse = (prisma as any).learnerResponse as typeof prisma extends { learnerResponse: infer T } ? T : any
  const responseRecord = await learnerResponse.findUnique({
    where: { id: String(responseId) },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
        },
      },
    },
  })

  if (!responseRecord || String(responseRecord?.sessionKey || '') !== String(threadKey)) {
    return res.status(404).json({ message: 'Solution not found in this Remix thread' })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end()
  }

  const action = String((req.body as any)?.action || '').trim().toLowerCase()
  if (!action) return res.status(400).json({ message: 'Action is required' })

  if (action === 'request') {
    const ownerId = String(responseRecord?.userId || responseRecord?.user?.id || '')
    if (!ownerId) return res.status(400).json({ message: 'Solution owner is missing' })
    if (ownerId === String(userId)) {
      return res.status(400).json({ message: 'You already own this solution' })
    }

    const existing = await getLatestActiveRemixSolutionAccess(String(responseId), String(userId))
    if (existing?.status === 'requested') {
      return res.status(200).json({ ok: true, state: 'requested', requestId: String(existing.id) })
    }
    if (existing?.status === 'granted') {
      return res.status(200).json({ ok: true, state: 'granted', requestId: String(existing.id) })
    }

    const requestId = await createRemixSolutionAccessRequest({
      sessionKey: String(threadKey),
      responseId: String(responseId),
      ownerId,
      viewerId: String(userId),
    })

    const requester = await prisma.user.findUnique({
      where: { id: String(userId) },
      select: { id: true, name: true, email: true },
    }).catch(() => null)
    const requesterName = String(requester?.name || requester?.email || 'A learner')

    try {
      const notification = await prisma.notification.create({
        data: {
          userId: ownerId,
          type: 'qb_solution_view_request',
          title: 'Solution view request',
          body: `${requesterName} wants one-time access to your Remix solution.`,
          data: {
            threadKey: String(threadKey),
            responseId: String(responseId),
            requestId,
            viewerId: String(userId),
            ownerId,
          },
        },
      })
      await updateRemixSolutionAccessNotificationIds(requestId, { requestNotificationId: String(notification.id) })
    } catch (notifyErr) {
      if (process.env.DEBUG === '1') console.error('Failed to create qb solution request notification', notifyErr)
    }

    return res.status(200).json({ ok: true, state: 'requested', requestId })
  }

  const requestId = String((req.body as any)?.requestId || '').trim()
  if (!requestId) return res.status(400).json({ message: 'Request id is required' })

  const accessRequest = await getRemixSolutionAccessRequestById(requestId)
  if (!accessRequest || String(accessRequest.response_id || '') !== String(responseId)) {
    return res.status(404).json({ message: 'Access request not found' })
  }

  if (action === 'grant' || action === 'decline') {
    if (String(accessRequest.owner_id || '') !== String(userId)) {
      return res.status(403).json({ message: 'Only the solution owner can respond to this request' })
    }
    if (String(accessRequest.status || '') !== 'requested') {
      return res.status(400).json({ message: 'This request is no longer pending' })
    }

    if (action === 'grant') {
      await grantRemixSolutionAccessRequest(requestId)
      try {
        const owner = await prisma.user.findUnique({
          where: { id: String(userId) },
          select: { id: true, name: true, email: true },
        }).catch(() => null)
        const ownerName = String(owner?.name || owner?.email || 'The solution owner')
        const notification = await prisma.notification.create({
          data: {
            userId: String(accessRequest.viewer_id),
            type: 'qb_solution_view_granted',
            title: 'Solution access granted',
            body: `${ownerName} granted you one-time access to a Remix solution.`,
            data: {
              threadKey: String(threadKey),
              responseId: String(responseId),
              requestId,
              ownerId: String(userId),
              viewerId: String(accessRequest.viewer_id),
            },
          },
        })
        await updateRemixSolutionAccessNotificationIds(requestId, { grantNotificationId: String(notification.id) })
      } catch (notifyErr) {
        if (process.env.DEBUG === '1') console.error('Failed to create qb solution grant notification', notifyErr)
      }
      return res.status(200).json({ ok: true, state: 'granted', requestId })
    }

    await declineRemixSolutionAccessRequest(requestId)
    try {
      await prisma.notification.create({
        data: {
          userId: String(accessRequest.viewer_id),
          type: 'qb_solution_view_declined',
          title: 'Solution access declined',
          body: 'Your one-time access request for a Remix solution was declined.',
          data: {
            threadKey: String(threadKey),
            responseId: String(responseId),
            requestId,
            ownerId: String(userId),
            viewerId: String(accessRequest.viewer_id),
          },
        },
      })
    } catch (notifyErr) {
      if (process.env.DEBUG === '1') console.error('Failed to create qb solution decline notification', notifyErr)
    }
    return res.status(200).json({ ok: true, state: 'requestable', requestId })
  }

  if (action === 'view') {
    if (String(accessRequest.viewer_id || '') !== String(userId)) {
      return res.status(403).json({ message: 'This one-time grant belongs to a different viewer' })
    }
    if (String(accessRequest.status || '') !== 'granted' || accessRequest.consumed_at) {
      return res.status(403).json({ message: 'No active one-time viewing permission is available' })
    }

    await consumeGrantedRemixSolutionAccess(requestId)

    return res.status(200).json({
      ok: true,
      response: {
        ...responseRecord,
        userName: String(responseRecord?.user?.name || responseRecord?.user?.email || 'Learner'),
        userAvatar: responseRecord?.user?.avatar || null,
        accessControl: {
          locked: false,
          state: 'visible',
          consumedRequestId: requestId,
        },
      },
    })
  }

  return res.status(400).json({ message: 'Unsupported action' })
}