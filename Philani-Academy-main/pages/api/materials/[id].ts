import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import path from 'path'
import { promises as fs } from 'fs'
import { del } from '@vercel/blob'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', ['DELETE'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any)?.role as string | undefined
  if (role !== 'admin' && role !== 'teacher') {
    return res.status(403).json({ message: 'Only instructors may delete materials' })
  }

  const idParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  if (!idParam) return res.status(400).json({ message: 'Material id required' })

  const material = await prisma.lessonMaterial.findUnique({
    where: { id: idParam },
    include: {
      session: {
        select: { grade: true, id: true }
      }
    }
  })
  if (!material) return res.status(404).json({ message: 'Material not found' })

  const tokenGrade = normalizeGradeInput((token as any)?.grade as string | undefined)
  if (role === 'teacher') {
    if (!tokenGrade) return res.status(403).json({ message: 'Teacher grade not configured' })
    if (tokenGrade !== material.session.grade) {
      return res.status(403).json({ message: 'Teachers may only manage materials for their grade' })
    }
  }

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN
  const storedFilename = (material.filename || '').trim()
  const fallbackKeyFromUrl = material.url.replace(/^https?:\/\//, '').replace(/^[^/]+\//, '').replace(/^\//, '')
  const baseKey = storedFilename || fallbackKeyFromUrl
  const normalizedKey = baseKey.includes('/') ? baseKey : path.posix.join('materials', material.session.id, baseKey)

  if (blobToken) {
    try {
      await del(normalizedKey, { token: blobToken })
    } catch (err: any) {
      if (err?.statusCode !== 404 && err?.code !== 'not_found') {
        console.warn('Failed to delete blob material', err)
      }
    }
  } else {
    const absolutePath = path.join(process.cwd(), 'public', normalizedKey.replace(/^\//, ''))
    try {
      await fs.unlink(absolutePath)
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        console.warn('Failed to remove lesson material file', err)
      }
    }
  }

  await prisma.lessonMaterial.delete({ where: { id: idParam } })
  return res.status(204).end()
}
