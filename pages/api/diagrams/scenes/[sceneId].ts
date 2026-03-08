import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../lib/prisma'
import { getUserIdFromReq, getUserRole, requireRole } from '../../../../lib/auth'

const normalizeSceneId = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  return trimmed || null
}

const normalizeName = (value: unknown) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > 120) return null
  return trimmed
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  const sceneId = normalizeSceneId(req.query.sceneId)
  if (!sceneId) return res.status(400).json({ message: 'Missing scene id' })

  const snapshot = await prisma.diagramSceneSnapshot.findUnique({ where: { id: sceneId } })
  if (!snapshot) return res.status(404).json({ message: 'Snapshot not found' })

  if (req.method === 'GET') {
    return res.status(200).json({
      snapshot: {
        id: snapshot.id,
        diagramId: snapshot.diagramId,
        sessionKey: snapshot.sessionKey,
        name: snapshot.name,
        scene: snapshot.scene,
        createdBy: snapshot.createdBy ?? null,
        createdAt: snapshot.createdAt.toISOString(),
        updatedAt: snapshot.updatedAt.toISOString(),
      },
    })
  }

  const role = await getUserRole(req)
  if (!(requireRole('admin', role) || requireRole('teacher', role))) return res.status(403).json({ message: 'Forbidden' })

  if (req.method === 'PATCH') {
    const updates: Record<string, unknown> = {}
    const name = typeof req.body?.name !== 'undefined' ? normalizeName(req.body.name) : null
    if (typeof req.body?.name !== 'undefined') {
      if (!name) return res.status(400).json({ message: 'Invalid snapshot name' })
      updates.name = name
    }
    if (typeof req.body?.scene !== 'undefined') {
      if (!req.body.scene || typeof req.body.scene !== 'object') return res.status(400).json({ message: 'Invalid scene payload' })
      updates.scene = req.body.scene
    }

    const updated = await prisma.diagramSceneSnapshot.update({
      where: { id: sceneId },
      data: updates,
    })

    return res.status(200).json({
      snapshot: {
        id: updated.id,
        diagramId: updated.diagramId,
        sessionKey: updated.sessionKey,
        name: updated.name,
        scene: updated.scene,
        createdBy: updated.createdBy ?? null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    })
  }

  if (req.method === 'DELETE') {
    await prisma.diagramSceneSnapshot.delete({ where: { id: sceneId } })
    return res.status(200).json({ ok: true })
  }

  res.setHeader('Allow', ['GET', 'PATCH', 'DELETE'])
  return res.status(405).end('Method not allowed')
}