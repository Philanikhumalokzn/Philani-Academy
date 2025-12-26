import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'

const safeString = (value: unknown, max = 180) => {
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

  if (req.method === 'GET') {
    const queryGradeRaw = Array.isArray(req.query.grade) ? req.query.grade[0] : req.query.grade
    const requestedGrade = normalizeGradeInput(typeof queryGradeRaw === 'string' ? queryGradeRaw : undefined)

    const templates = await prisma.lessonScriptTemplate.findMany({
      where: requestedGrade ? { grade: requestedGrade as any } : undefined,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        grade: true,
        subject: true,
        topic: true,
        createdAt: true,
        updatedAt: true,
        currentVersionId: true,
        currentVersion: { select: { id: true, version: true, createdAt: true } },
      },
    })

    return res.status(200).json({ templates })
  }

  if (req.method === 'POST') {
    if (role !== 'admin' && role !== 'teacher') return res.status(403).json({ message: 'Forbidden' })

    const title = safeString(req.body?.title, 200)
    if (!title) return res.status(400).json({ message: 'Missing title' })

    const grade = normalizeGradeInput(typeof req.body?.grade === 'string' ? req.body.grade : undefined)
    const subject = safeString(req.body?.subject, 120)
    const topic = safeString(req.body?.topic, 160)

    const content = req.body?.content
    if (!content || typeof content !== 'object') return res.status(400).json({ message: 'Missing content' })

    const createdBy = ((token as any)?.email as string | undefined) || ((token as any)?.sub as string | undefined) || 'unknown'

    const result = await prisma.$transaction(async tx => {
      const template = await tx.lessonScriptTemplate.create({
        data: {
          title,
          grade: grade as any,
          subject: subject ?? undefined,
          topic: topic ?? undefined,
          createdBy,
        },
      })

      const version = await tx.lessonScriptVersion.create({
        data: {
          templateId: template.id,
          version: 1,
          content: content as any,
          createdBy,
        },
      })

      const updated = await tx.lessonScriptTemplate.update({
        where: { id: template.id },
        data: { currentVersionId: version.id },
        select: {
          id: true,
          title: true,
          grade: true,
          subject: true,
          topic: true,
          currentVersionId: true,
          currentVersion: { select: { id: true, version: true, createdAt: true } },
        },
      })

      return { template: updated, version }
    })

    return res.status(201).json(result)
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end('Method not allowed')
}
