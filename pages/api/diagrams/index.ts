import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserIdFromReq, getUserRole, requireRole } from '../../../lib/auth'

type DiagramsResponse = {
  diagrams: Array<{
    id: string
    sessionKey: string
    title: string
    imageUrl: string
    order: number
    annotations: any
    createdBy: string | null
    createdAt: string
    updatedAt: string
  }>
  state: {
    sessionKey: string
    activeDiagramId: string | null
    isOpen: boolean
    updatedAt: string
  } | null
}

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

  if (req.method === 'GET') {
    const sessionKey = normalizeSessionKey(Array.isArray(req.query.sessionKey) ? req.query.sessionKey[0] : req.query.sessionKey)
    if (!sessionKey) return res.status(400).json({ message: 'Missing sessionKey' })

    const [diagrams, state] = await Promise.all([
      prisma.diagram.findMany({
        where: { sessionKey },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.diagramSessionState.findUnique({ where: { sessionKey } }),
    ])

    const payload: DiagramsResponse = {
      diagrams: diagrams.map(d => ({
        id: d.id,
        sessionKey: d.sessionKey,
        title: d.title,
        imageUrl: d.imageUrl,
        order: d.order,
        annotations: d.annotations ?? null,
        createdBy: d.createdBy ?? null,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      })),
      state: state
        ? {
            sessionKey: state.sessionKey,
            activeDiagramId: state.activeDiagramId ?? null,
            isOpen: state.isOpen,
            updatedAt: state.updatedAt.toISOString(),
          }
        : null,
    }

    return res.status(200).json(payload)
  }

  if (req.method === 'POST') {
    const role = await getUserRole(req)
    if (!requireRole('admin', role)) return res.status(403).json({ message: 'Forbidden' })

    const sessionKey = normalizeSessionKey(req.body?.sessionKey)
    const imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim() : ''
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''

    if (!sessionKey) return res.status(400).json({ message: 'Missing sessionKey' })
    if (!imageUrl) return res.status(400).json({ message: 'Missing imageUrl' })

    const maxOrder = await prisma.diagram.aggregate({
      where: { sessionKey },
      _max: { order: true },
    })
    const nextOrder = typeof maxOrder._max.order === 'number' ? maxOrder._max.order + 1 : 0

    const created = await prisma.diagram.create({
      data: {
        sessionKey,
        imageUrl,
        title,
        order: nextOrder,
        createdBy: userId,
      },
    })

    const state = await prisma.diagramSessionState.upsert({
      where: { sessionKey },
      create: {
        sessionKey,
        activeDiagramId: created.id,
        isOpen: true,
      },
      update: {
        activeDiagramId: created.id,
      },
    })

    return res.status(201).json({
      diagram: {
        id: created.id,
        sessionKey: created.sessionKey,
        title: created.title,
        imageUrl: created.imageUrl,
        order: created.order,
        annotations: created.annotations ?? null,
        createdBy: created.createdBy ?? null,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      },
      state: {
        sessionKey: state.sessionKey,
        activeDiagramId: state.activeDiagramId ?? null,
        isOpen: state.isOpen,
        updatedAt: state.updatedAt.toISOString(),
      },
    })
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end('Method not allowed')
}
