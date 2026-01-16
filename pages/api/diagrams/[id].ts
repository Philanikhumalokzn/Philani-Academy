import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserIdFromReq, getUserRole, requireRole } from '../../../lib/auth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  const diagramId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  if (!diagramId) return res.status(400).json({ message: 'Missing diagram id' })

  if (req.method === 'GET') {
    const diagram = await prisma.diagram.findUnique({ where: { id: diagramId } })
    if (!diagram) return res.status(404).json({ message: 'Not found' })
    return res.status(200).json({
      id: diagram.id,
      sessionKey: diagram.sessionKey,
      title: diagram.title,
      imageUrl: diagram.imageUrl,
      order: diagram.order,
      annotations: diagram.annotations ?? null,
      createdBy: diagram.createdBy ?? null,
      createdAt: diagram.createdAt.toISOString(),
      updatedAt: diagram.updatedAt.toISOString(),
    })
  }

  if (req.method === 'PATCH') {
    const role = await getUserRole(req)
    if (!(requireRole('admin', role) || requireRole('teacher', role))) return res.status(403).json({ message: 'Forbidden' })

    const updates: any = {}
    if (typeof req.body?.title === 'string') updates.title = req.body.title
    if (typeof req.body?.order === 'number' && Number.isFinite(req.body.order)) updates.order = req.body.order
    if (typeof req.body?.annotations !== 'undefined') updates.annotations = req.body.annotations

    const updated = await prisma.diagram.update({
      where: { id: diagramId },
      data: updates,
    })

    return res.status(200).json({
      id: updated.id,
      sessionKey: updated.sessionKey,
      title: updated.title,
      imageUrl: updated.imageUrl,
      order: updated.order,
      annotations: updated.annotations ?? null,
      createdBy: updated.createdBy ?? null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    })
  }

  if (req.method === 'DELETE') {
    const role = await getUserRole(req)
    if (!(requireRole('admin', role) || requireRole('teacher', role))) return res.status(403).json({ message: 'Forbidden' })

    const diagram = await prisma.diagram.findUnique({ where: { id: diagramId } })
    if (!diagram) return res.status(404).json({ message: 'Not found' })

    await prisma.diagram.delete({ where: { id: diagramId } })

    // If this diagram was active, clear or pick the next available.
    const state = await prisma.diagramSessionState.findUnique({ where: { sessionKey: diagram.sessionKey } })
    if (state?.activeDiagramId === diagramId) {
      const next = await prisma.diagram.findFirst({
        where: { sessionKey: diagram.sessionKey },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      })
      await prisma.diagramSessionState.upsert({
        where: { sessionKey: diagram.sessionKey },
        create: {
          sessionKey: diagram.sessionKey,
          activeDiagramId: next?.id ?? null,
          isOpen: false,
        },
        update: {
          activeDiagramId: next?.id ?? null,
          isOpen: false,
        },
      })
    }

    return res.status(200).json({ ok: true })
  }

  res.setHeader('Allow', ['GET', 'PATCH', 'DELETE'])
  return res.status(405).end('Method not allowed')
}
