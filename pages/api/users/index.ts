import type { NextApiRequest, NextApiResponse } from 'next'
import bcrypt from 'bcryptjs'
import prisma from '../../../lib/prisma'
import { getUserRole } from '../../../lib/auth'
import { GRADE_VALUES, normalizeGradeInput } from '../../../lib/grades'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const role = await getUserRole(req)
  if (!role || role !== 'admin') return res.status(403).json({ message: 'Forbidden' })

  const allowedGrades = GRADE_VALUES as readonly string[]

  if (req.method === 'GET') {
    const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, grade: true, createdAt: true } })
    return res.status(200).json(users)
  }

  if (req.method === 'POST') {
    const { name, email, password, role: newRole, grade } = req.body || {}
    if (!email || !password) return res.status(400).json({ message: 'Missing fields: email and password are required' })

    const allowed = ['admin', 'teacher', 'student']
    const roleToSet = allowed.includes(newRole) ? newRole : 'student'
    const normalizedGrade = normalizeGradeInput(typeof grade === 'string' ? grade : undefined)

    if ((roleToSet === 'student' || roleToSet === 'teacher') && (!normalizedGrade || !allowedGrades.includes(normalizedGrade))) {
      return res.status(400).json({ message: 'Grade is required for students and teachers' })
    }
    if (normalizedGrade && !allowedGrades.includes(normalizedGrade)) {
      return res.status(400).json({ message: 'Invalid grade' })
    }

    try {
      const existing = await prisma.user.findUnique({ where: { email } })
      if (existing) return res.status(409).json({ message: 'User exists' })

      const hashed = await bcrypt.hash(password, 10)
      const user = await prisma.user.create({ data: { name, email, password: hashed, role: roleToSet, grade: normalizedGrade } })
      return res.status(201).json({ id: user.id, email: user.email, role: user.role, grade: user.grade })
    } catch (err) {
      console.error('POST /api/users error', err)
      return res.status(500).json({ message: 'Server error' })
    }
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end()
}
