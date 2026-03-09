import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../lib/prisma'
import { getUserIdFromReq, getUserRole, requireRole } from '../../../../lib/auth'

const normalizeName = (value: unknown) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > 120) return null
  return trimmed
}

const normalizeDiagramId = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  return trimmed || null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  const diagramId = normalizeDiagramId(req.query.id)
  if (!diagramId) return res.status(400).json({ message: 'Missing diagram id' })

  const diagram = await prisma.diagram.findUnique({ where: { id: diagramId } })
  if (!diagram) return res.status(404).json({ message: 'Diagram not found' })

  if (req.method === 'GET') {
    const snapshots = await prisma.diagramSceneSnapshot.findMany({
      where: { diagramId },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    })

    return res.status(200).json({
      snapshots: snapshots.map((snapshot) => ({
        id: snapshot.id,
        diagramId: snapshot.diagramId,
        sessionKey: snapshot.sessionKey,
        name: snapshot.name,
        scene: snapshot.scene,
        createdBy: snapshot.createdBy ?? null,
        createdAt: snapshot.createdAt.toISOString(),
        updatedAt: snapshot.updatedAt.toISOString(),
      })),
    })
  }

  const role = await getUserRole(req)
  if (!(requireRole('admin', role) || requireRole('teacher', role))) return res.status(403).json({ message: 'Forbidden' })

  if (req.method === 'POST') {
    const name = normalizeName(req.body?.name)
    if (!name) return res.status(400).json({ message: 'Missing snapshot name' })
    if (!req.body?.scene || typeof req.body.scene !== 'object') return res.status(400).json({ message: 'Missing scene payload' })

    const replaceExistingByName = Boolean(req.body?.replaceExistingByName)

    if (replaceExistingByName) {
      const existing = await prisma.diagramSceneSnapshot.findFirst({
        where: { diagramId, name },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      })

      if (existing) {
        const updated = await prisma.diagramSceneSnapshot.update({
          where: { id: existing.id },
          data: {
            scene: req.body.scene,
            createdBy: userId,
          },
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
    }

    const created = await prisma.diagramSceneSnapshot.create({
      data: {
        diagramId,
        sessionKey: diagram.sessionKey,
        name,
        scene: req.body.scene,
        createdBy: userId,
      },
    })

    return res.status(201).json({
      snapshot: {
        id: created.id,
        diagramId: created.diagramId,
        sessionKey: created.sessionKey,
        name: created.name,
        scene: created.scene,
        createdBy: created.createdBy ?? null,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      },
    })
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end('Method not allowed')
}