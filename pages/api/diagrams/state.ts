import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserIdFromReq, getUserRole, requireRole } from '../../../lib/auth'

const normalizeSessionKey = (value: unknown) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > 120) return null
  return trimmed
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  if (req.method !== 'PUT') {
    res.setHeader('Allow', ['PUT'])
    return res.status(405).end('Method not allowed')
  }

  const role = await getUserRole(req)
  if (!(requireRole('admin', role) || requireRole('teacher', role))) return res.status(403).json({ message: 'Forbidden' })

  const sessionKey = normalizeSessionKey(req.body?.sessionKey)
  if (!sessionKey) return res.status(400).json({ message: 'Missing sessionKey' })

  const activeDiagramId = typeof req.body?.activeDiagramId === 'string' ? req.body.activeDiagramId : null
  const isOpen = typeof req.body?.isOpen === 'boolean' ? req.body.isOpen : undefined

  const updated = await prisma.diagramSessionState.upsert({
    where: { sessionKey },
    create: {
      sessionKey,
      activeDiagramId,
      isOpen: typeof isOpen === 'boolean' ? isOpen : true,
    },
    update: {
      activeDiagramId,
      ...(typeof isOpen === 'boolean' ? { isOpen } : {}),
    },
  })

  return res.status(200).json({
    sessionKey: updated.sessionKey,
    activeDiagramId: updated.activeDiagramId ?? null,
    isOpen: updated.isOpen,
    updatedAt: updated.updatedAt.toISOString(),
  })
}
