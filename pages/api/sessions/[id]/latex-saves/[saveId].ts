import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import path from 'path'
import { promises as fs } from 'fs'
import { del } from '@vercel/blob'
import prisma from '../../../../../lib/prisma'
import { getUserSubscriptionStatus, isSubscriptionGatingEnabled, subscriptionRequiredResponse } from '../../../../../lib/subscription'

const sanitizeTitle = (value: string | undefined) => {
  const base = (value || '').toString().trim()
  const cleaned = base.replace(/\s+/g, ' ').slice(0, 80)
  return cleaned
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sessionKeyParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  const saveIdParam = Array.isArray(req.query.saveId) ? req.query.saveId[0] : req.query.saveId

  if (!sessionKeyParam) return res.status(400).json({ message: 'Session key is required' })
  if (!saveIdParam) return res.status(400).json({ message: 'Save id is required' })

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any)?.role as string | undefined
  const isAdmin = role === 'admin'
  const userId = (token as any)?.id || (token as any)?.sub || null

  // Subscription gating for learners.
  if (role === 'student') {
    const gatingEnabled = await isSubscriptionGatingEnabled()
    if (gatingEnabled) {
      const authUserId = (userId || '').toString()
      const status = await getUserSubscriptionStatus(authUserId)
      if (!status.active) {
        const denied = subscriptionRequiredResponse()
        return res.status(denied.status).json(denied.body)
      }
    }
  }

  const sessionKey = sessionKeyParam.toString()
  const saveId = saveIdParam.toString()

  const record = await prisma.latexSave.findUnique({ where: { id: saveId } })
  if (!record) return res.status(404).json({ message: 'Save not found' })
  if (record.sessionKey !== sessionKey) return res.status(404).json({ message: 'Save not found' })

  // Permissions:
  // - Shared saves: admin only
  // - Personal saves: owner only
  if (record.shared) {
    if (!isAdmin) return res.status(403).json({ message: 'Only admins may manage class saves' })
  } else {
    if (!userId || record.userId !== userId) return res.status(403).json({ message: 'Only the owner may manage this save' })
  }

  if (req.method === 'PATCH') {
    const { title } = req.body || {}
    const nextTitle = sanitizeTitle(title)
    if (!nextTitle) return res.status(400).json({ message: 'Title is required' })

    const updated = await prisma.latexSave.update({
      where: { id: saveId },
      data: { title: nextTitle },
    })
    return res.status(200).json(updated)
  }

  if (req.method === 'DELETE') {
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN

    const storedFilename = (record.filename || '').trim()
    const fallbackKeyFromUrl = (record.url || '').replace(/^https?:\/\//, '').replace(/^[^/]+\//, '').replace(/^\//, '')
    const baseKey = storedFilename || fallbackKeyFromUrl

    // Best-effort: remove stored blob/file. Even if it fails, we still delete the DB record.
    if (baseKey) {
      const normalizedKey = baseKey.includes('/') ? baseKey : path.posix.join('sessions', sessionKey, 'latex', baseKey)

      if (blobToken) {
        try {
          await del(normalizedKey, { token: blobToken })
        } catch (err: any) {
          if (err?.statusCode !== 404 && err?.code !== 'not_found') {
            console.warn('Failed to delete latex blob', err)
          }
        }
      } else {
        const absolutePath = path.join(process.cwd(), 'public', normalizedKey.replace(/^\//, ''))
        try {
          await fs.unlink(absolutePath)
        } catch (err: any) {
          if (err?.code !== 'ENOENT') {
            console.warn('Failed to remove latex save file', err)
          }
        }
      }
    }

    await prisma.latexSave.delete({ where: { id: saveId } })
    return res.status(204).end()
  }

  res.setHeader('Allow', ['PATCH', 'DELETE'])
  return res.status(405).end(`Method ${req.method} Not Allowed`)
}
