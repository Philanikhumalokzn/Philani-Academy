import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any)?.role as string | undefined
  const tokenGrade = normalizeGradeInput((token as any)?.grade as string | undefined)

  if (req.method === 'GET') {
    const queryGradeRaw = Array.isArray(req.query.grade) ? req.query.grade[0] : req.query.grade
    const requestedGrade = normalizeGradeInput(typeof queryGradeRaw === 'string' ? queryGradeRaw : undefined)

    let gradeToUse = tokenGrade
    if (role === 'admin') {
      gradeToUse = requestedGrade || tokenGrade
      if (!gradeToUse) {
        return res.status(400).json({ message: 'Grade query parameter required for admins' })
      }
    }

    if (role === 'teacher') {
      if (!tokenGrade) return res.status(403).json({ message: 'Teacher grade not configured' })
      if (requestedGrade && requestedGrade !== tokenGrade) {
        return res.status(403).json({ message: 'Teachers are restricted to their assigned grade' })
      }
      gradeToUse = tokenGrade
    }

    if (role === 'student') {
      if (!tokenGrade) return res.status(403).json({ message: 'Student grade not configured' })
      if (requestedGrade && requestedGrade !== tokenGrade) {
        return res.status(403).json({ message: 'Students cannot switch grade views' })
      }
      gradeToUse = tokenGrade
    }

    if (!gradeToUse) {
      return res.status(400).json({ message: 'Grade not determined' })
    }

    const announcements = await prisma.announcement.findMany({
      where: { grade: gradeToUse },
      orderBy: { createdAt: 'desc' }
    })
    return res.status(200).json(announcements)
  }

  if (req.method === 'POST') {
    if (!role || (role !== 'admin' && role !== 'teacher')) {
      return res.status(403).json({ message: 'Forbidden' })
    }

    const { title, content, grade } = req.body as { title?: string; content?: string; grade?: string }
    if (!title || !content) {
      return res.status(400).json({ message: 'Title and content are required' })
    }

    const normalizedGrade = normalizeGradeInput(typeof grade === 'string' ? grade : undefined) || tokenGrade
    if (!normalizedGrade) {
      return res.status(400).json({ message: 'Grade is required' })
    }

    if (role === 'teacher') {
      if (!tokenGrade) return res.status(403).json({ message: 'Teacher grade not configured' })
      if (normalizedGrade !== tokenGrade) {
        return res.status(403).json({ message: 'Teachers may only post announcements for their assigned grade' })
      }
    }

    const announcement = await prisma.announcement.create({
      data: {
        title,
        content,
        grade: normalizedGrade,
        createdBy: (token?.email as string) || null
      }
    })

    return res.status(201).json(announcement)
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end(`Method ${req.method} Not Allowed`)
}
