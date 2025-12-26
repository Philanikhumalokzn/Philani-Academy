import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../lib/prisma'

const safeId = (value: unknown) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const safeString = (value: unknown, max = 200) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > max) return null
  return trimmed
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any).role as string | undefined
  const idParam = safeId(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id)
  if (!idParam) return res.status(400).json({ message: 'Missing template id' })

  if (req.method === 'GET') {
    const template = await prisma.lessonScriptTemplate.findUnique({
      where: { id: idParam },
      select: {
        id: true,
        title: true,
        grade: true,
        subject: true,
        topic: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
        currentVersionId: true,
        currentVersion: { select: { id: true, version: true, createdAt: true, createdBy: true } },
        versions: { select: { id: true, version: true, createdAt: true, createdBy: true }, orderBy: { version: 'desc' } },
      },
    })

    if (!template) return res.status(404).json({ message: 'Not found' })
    return res.status(200).json({ template })
  }

  if (req.method === 'PUT') {
    if (role !== 'admin' && role !== 'teacher') return res.status(403).json({ message: 'Forbidden' })

    const title = safeString(req.body?.title, 200)
    const subject = safeString(req.body?.subject, 120)
    const topic = safeString(req.body?.topic, 160)

    const currentVersionId = safeId(req.body?.currentVersionId)

    // If a currentVersionId is provided, ensure it belongs to this template.
    if (currentVersionId) {
      const version = await prisma.lessonScriptVersion.findUnique({ where: { id: currentVersionId }, select: { templateId: true } })
      if (!version) return res.status(400).json({ message: 'Invalid currentVersionId' })
      if (version.templateId !== idParam) return res.status(400).json({ message: 'currentVersionId does not belong to this template' })
    }

    const updated = await prisma.lessonScriptTemplate.update({
      where: { id: idParam },
      data: {
        ...(title ? { title } : {}),
        ...(subject ? { subject } : {}),
        ...(topic ? { topic } : {}),
        ...(currentVersionId ? { currentVersionId } : {}),
      },
      select: {
        id: true,
        title: true,
        grade: true,
        subject: true,
        topic: true,
        updatedAt: true,
        currentVersionId: true,
        currentVersion: { select: { id: true, version: true, createdAt: true } },
      },
    })

    return res.status(200).json({ template: updated })
  }

  if (req.method === 'DELETE') {
    if (role !== 'admin') return res.status(403).json({ message: 'Forbidden' })
    await prisma.lessonScriptTemplate.delete({ where: { id: idParam } })
    return res.status(200).json({ ok: true })
  }

  res.setHeader('Allow', ['GET', 'PUT', 'DELETE'])
  return res.status(405).end('Method not allowed')
}
