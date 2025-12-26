import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../../lib/prisma'

const safeId = (value: unknown) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any).role as string | undefined
  const templateId = safeId(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id)
  if (!templateId) return res.status(400).json({ message: 'Missing template id' })

  if (req.method === 'GET') {
    const versions = await prisma.lessonScriptVersion.findMany({
      where: { templateId },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, createdAt: true, createdBy: true },
    })
    return res.status(200).json({ templateId, versions })
  }

  if (req.method === 'POST') {
    if (role !== 'admin' && role !== 'teacher') return res.status(403).json({ message: 'Forbidden' })

    const content = req.body?.content
    if (!content || typeof content !== 'object') return res.status(400).json({ message: 'Missing content' })

    const makeCurrent = typeof req.body?.makeCurrent === 'boolean' ? req.body.makeCurrent : true

    const createdBy = ((token as any)?.email as string | undefined) || ((token as any)?.sub as string | undefined) || 'unknown'

    const result = await prisma.$transaction(async tx => {
      const template = await tx.lessonScriptTemplate.findUnique({ where: { id: templateId }, select: { id: true } })
      if (!template) throw new Error('TEMPLATE_NOT_FOUND')

      const latest = await tx.lessonScriptVersion.findFirst({
        where: { templateId },
        orderBy: { version: 'desc' },
        select: { version: true },
      })
      const nextVersion = (latest?.version ?? 0) + 1

      const version = await tx.lessonScriptVersion.create({
        data: { templateId, version: nextVersion, content: content as any, createdBy },
        select: { id: true, version: true, createdAt: true, createdBy: true },
      })

      const updatedTemplate = makeCurrent
        ? await tx.lessonScriptTemplate.update({
            where: { id: templateId },
            data: { currentVersionId: version.id },
            select: { id: true, currentVersionId: true },
          })
        : null

      return { version, updatedTemplate }
    }).catch(err => {
      if (String(err?.message || '').includes('TEMPLATE_NOT_FOUND')) return null
      throw err
    })

    if (!result) return res.status(404).json({ message: 'Template not found' })
    return res.status(201).json(result)
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end('Method not allowed')
}
