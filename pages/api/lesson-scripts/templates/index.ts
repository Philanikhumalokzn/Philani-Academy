import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../lib/prisma'
import { normalizeGradeInput } from '../../../../lib/grades'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any).role as string | undefined
  const tokenGrade = normalizeGradeInput((token as any).grade as string | undefined)
  const queryGradeRaw = Array.isArray(req.query.grade) ? req.query.grade[0] : req.query.grade
  const requestedGrade = normalizeGradeInput(typeof queryGradeRaw === 'string' ? queryGradeRaw : undefined)

  // For now: only admins/teachers can see templates (students will consume resolved scripts via sessions endpoint).
  if (!role || (role !== 'admin' && role !== 'teacher')) {
    return res.status(403).json({ message: 'Forbidden' })
  }

  let gradeFilter: any = undefined
  if (role === 'teacher') {
    if (!tokenGrade) return res.status(403).json({ message: 'Teacher grade not configured' })
    gradeFilter = tokenGrade
  }
  if (role === 'admin') {
    gradeFilter = requestedGrade || undefined
  }

  if (req.method === 'GET') {
    const templates = await prisma.lessonScriptTemplate.findMany({
      where: gradeFilter ? { grade: gradeFilter } : {},
      orderBy: [{ updatedAt: 'desc' }],
      include: { currentVersion: true },
    })
    return res.status(200).json({ templates })
  }

  if (req.method === 'POST') {
    const { title, grade, subject, topic, content } = req.body || {}
    const safeTitle = String(title || '').trim()
    if (!safeTitle) return res.status(400).json({ message: 'Title is required' })

    const normalizedGrade = normalizeGradeInput(typeof grade === 'string' ? grade : undefined)
    if (role === 'teacher') {
      if (!tokenGrade) return res.status(403).json({ message: 'Teacher grade not configured' })
      if (normalizedGrade && normalizedGrade !== tokenGrade) {
        return res.status(403).json({ message: 'Teachers may only create templates for their assigned grade' })
      }
    }

    const template = await prisma.lessonScriptTemplate.create({
      data: {
        title: safeTitle,
        grade: normalizedGrade ?? null,
        subject: typeof subject === 'string' ? subject : null,
        topic: typeof topic === 'string' ? topic : null,
        createdBy: (token as any)?.email || null,
      },
    })

    // Create version 1.
    const version = await prisma.lessonScriptVersion.create({
      data: {
        templateId: template.id,
        version: 1,
        content: content && typeof content === 'object' && !Array.isArray(content) ? content : {},
        createdBy: (token as any)?.email || null,
      },
    })

    const updatedTemplate = await prisma.lessonScriptTemplate.update({
      where: { id: template.id },
      data: { currentVersionId: version.id },
      include: { currentVersion: true },
    })

    return res.status(201).json({ template: updatedTemplate, version })
  }

  return res.status(405).end()
}
