import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../lib/prisma'

const safeId = (value: unknown) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const idParam = safeId(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id)
  if (!idParam) return res.status(400).json({ message: 'Missing version id' })

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end('Method not allowed')
  }

  const version = await prisma.lessonScriptVersion.findUnique({
    where: { id: idParam },
    select: {
      id: true,
      version: true,
      templateId: true,
      createdAt: true,
      createdBy: true,
      content: true,
    },
  })

  if (!version) return res.status(404).json({ message: 'Not found' })
  return res.status(200).json({ version })
}
