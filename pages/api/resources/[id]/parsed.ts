import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import { getUserGrade } from '../../../../lib/auth'
import prisma from '../../../../lib/prisma'
import { normalizeGradeInput } from '../../../../lib/grades'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const idParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  const id = String(idParam || '').trim()
  if (!id) return res.status(400).json({ message: 'Resource id required' })

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = ((token as any)?.role as string | undefined) || 'student'
  const tokenGrade = await getUserGrade(req)
  const requestedGrade = normalizeGradeInput(typeof req.query.grade === 'string' ? req.query.grade : undefined)
  const scopeGrade = role === 'admin' ? (requestedGrade || tokenGrade) : tokenGrade
  if (!scopeGrade) return res.status(400).json({ message: 'Grade is required' })

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end('Method not allowed')
  }

  const item = await prisma.resourceBankItem.findUnique({
    where: { id },
    select: {
      id: true,
      grade: true,
      title: true,
      parsedJson: true,
      parsedAt: true,
      parseError: true,
      createdAt: true,
    },
  })

  if (!item) return res.status(404).json({ message: 'Not found' })

  if (scopeGrade !== item.grade) {
    return res.status(403).json({ message: 'Forbidden' })
  }

  return res.status(200).json(item)
}
