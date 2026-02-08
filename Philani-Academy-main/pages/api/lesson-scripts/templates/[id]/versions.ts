import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../../lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any).role as string | undefined
  if (!role || (role !== 'admin' && role !== 'teacher')) {
    return res.status(403).json({ message: 'Forbidden' })
  }

  const templateId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  const safeTemplateId = String(templateId || '').trim()
  if (!safeTemplateId) return res.status(400).json({ message: 'Missing template id' })

  if (req.method === 'GET') {
    const versions = await prisma.lessonScriptVersion.findMany({
      where: { templateId: safeTemplateId },
      orderBy: [{ version: 'desc' }],
    })
    return res.status(200).json({ versions })
  }

  if (req.method === 'POST') {
    const { content } = req.body || {}
    const contentObj = content && typeof content === 'object' && !Array.isArray(content) ? content : null
    if (!contentObj) return res.status(400).json({ message: 'content must be a JSON object' })

    const last = await prisma.lessonScriptVersion.findFirst({
      where: { templateId: safeTemplateId },
      orderBy: { version: 'desc' },
    })
    const nextVersionNumber = (last?.version ?? 0) + 1

    const version = await prisma.lessonScriptVersion.create({
      data: {
        templateId: safeTemplateId,
        version: nextVersionNumber,
        content: contentObj,
        createdBy: (token as any)?.email || null,
      },
    })

    const template = await prisma.lessonScriptTemplate.update({
      where: { id: safeTemplateId },
      data: { currentVersionId: version.id },
      include: { currentVersion: true },
    })

    return res.status(201).json({ version, template })
  }

  return res.status(405).end()
}
