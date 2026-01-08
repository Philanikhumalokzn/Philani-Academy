import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = ((token as any)?.role as string | undefined) || 'student'
  const authUserId = String((token as any)?.id || (token as any)?.sub || '')
  const tokenGrade = normalizeGradeInput((token as any)?.grade as string | undefined)

  const idParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  if (!idParam) return res.status(400).json({ message: 'Resource id required' })

  if (req.method !== 'GET' && req.method !== 'DELETE') {
    res.setHeader('Allow', ['GET', 'DELETE'])
    return res.status(405).end('Method not allowed')
  }

  const item = await prisma.resourceBankItem.findUnique({ where: { id: String(idParam) } })
  if (!item) return res.status(404).json({ message: 'Resource not found' })

  if (req.method === 'GET') {
    // Admin can view anything.
    if (role !== 'admin') {
      // Teachers/students can view resources only within their grade.
      if (!tokenGrade) return res.status(403).json({ message: 'Grade not configured for this account' })
      if (String(item.grade) !== String(tokenGrade)) return res.status(403).json({ message: 'Forbidden' })
    }

    return res.status(200).json(item)
  }

  // Admin can delete anything.
  if (role === 'admin') {
    await prisma.resourceBankItem.delete({ where: { id: item.id } })
    return res.status(204).end()
  }

  // Teachers/students can only delete their own uploads, and only within their grade.
  if (!tokenGrade) return res.status(403).json({ message: 'Grade not configured for this account' })
  if (String(item.grade) !== String(tokenGrade)) return res.status(403).json({ message: 'Forbidden' })
  if (!item.createdById || String(item.createdById) !== String(authUserId)) return res.status(403).json({ message: 'Forbidden' })

  await prisma.resourceBankItem.delete({ where: { id: item.id } })
  return res.status(204).end()
}
