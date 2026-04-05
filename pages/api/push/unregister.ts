import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserIdFromReq } from '../../../lib/auth'

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end()
  }

  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  const token = asString(req.body?.token)
  if (!token) return res.status(400).json({ message: 'Push token is required' })

  try {
    await prisma.pushDevice.updateMany({
      where: { userId, token },
      data: {
        enabled: false,
        lastSeenAt: new Date(),
      },
    })

    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('Failed to unregister push token', err)
    return res.status(500).json({ message: 'Failed to unregister push token' })
  }
}