import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../lib/prisma'
import { getUserRole } from '../../lib/auth'
import { getSession } from 'next-auth/react'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const session = await getSession({ req })
  if (!session) return res.status(401).json({ message: 'Unauthorized' })

  const role = await getUserRole(req)
  if (!role || (role !== 'admin' && role !== 'teacher')) return res.status(403).json({ message: 'Forbidden' })

  const { title, joinUrl, startsAt } = req.body
  if (!title || !joinUrl || !startsAt) return res.status(400).json({ message: 'Missing fields' })

  const rec = await prisma.sessionRecord.create({ data: {
    title,
    description: '',
    joinUrl,
    startsAt: new Date(startsAt),
    createdBy: session.user?.email || 'unknown'
  }})

  res.status(201).json(rec)
}
