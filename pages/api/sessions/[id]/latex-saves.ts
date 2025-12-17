import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import path from 'path'
import { promises as fs } from 'fs'
import { put } from '@vercel/blob'
import prisma from '../../../../lib/prisma'
import { getUserSubscriptionStatus, subscriptionRequiredResponse } from '../../../../lib/subscription'

const MAX_LATEX_LENGTH = 50000

const sanitizeSegment = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'session'
const sanitizeTitle = (value: string | undefined) => {
  const base = (value || 'Latex save').toString().trim()
  const cleaned = base.replace(/\s+/g, ' ').slice(0, 80)
  return cleaned || 'Latex save'
}

async function saveToStorage(relativePath: string, content: string) {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN
  const normalizedPath = relativePath.replace(/\\/g, '/').replace(/\/+/, '/').replace(/^\/+/, '')
  const publicUrl = `/${normalizedPath}`

  if (blobToken) {
    const blob = await put(normalizedPath, content, {
      access: 'public',
      token: blobToken,
      contentType: 'text/plain; charset=utf-8',
      addRandomSuffix: false,
    })
    return { storedPath: blob.pathname || normalizedPath, url: blob.url || publicUrl }
  }

  const destination = path.join(process.cwd(), 'public', normalizedPath)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.writeFile(destination, content, 'utf8')
  return { storedPath: normalizedPath, url: publicUrl }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sessionKeyParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  if (!sessionKeyParam) {
    return res.status(400).json({ message: 'Session key is required' })
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const userId = (token as any)?.id || (token as any)?.sub || null
  const userEmail = (token as any)?.email || null
  const role = (token as any)?.role as string | undefined
  const isAdmin = role === 'admin'
  const sessionKey = sessionKeyParam.toString()

  if (role === 'student') {
    const authUserId = (userId || '').toString()
    const status = await getUserSubscriptionStatus(authUserId)
    if (!status.active) {
      const denied = subscriptionRequiredResponse()
      return res.status(denied.status).json(denied.body)
    }
  }

  if (req.method === 'GET') {
    const records = await prisma.latexSave.findMany({
      where: {
        sessionKey,
        OR: [{ shared: true }, { userId: userId ?? '__none__' }],
      },
      orderBy: { updatedAt: 'desc' },
      take: 25,
    })
    const shared = records.filter(r => r.shared)
    const mine = userId ? records.filter(r => !r.shared && r.userId === userId) : []
    return res.status(200).json({ shared, mine })
  }

  if (req.method === 'POST') {
    const { latex, title, shared } = req.body || {}
    if (!latex || typeof latex !== 'string') {
      return res.status(400).json({ message: 'Latex content is required' })
    }
    if (latex.length > MAX_LATEX_LENGTH) {
      return res.status(400).json({ message: 'Latex content is too large' })
    }

    // Only admins may create session-wide class saves.
    // Everyone else saves privately (visible only to themselves).
    const willShare = isAdmin && shared !== false
    const saveTitle = sanitizeTitle(title)
    const safeSession = sanitizeSegment(sessionKey)
    const scopeFolder = willShare ? 'shared' : sanitizeSegment(userId || 'participant')
    const filename = `${Date.now()}_${sanitizeSegment(saveTitle)}.tex`
    const relativePath = path.posix.join('sessions', safeSession, 'latex', scopeFolder, filename)

    try {
      const stored = await saveToStorage(relativePath, latex)
      const record = await prisma.latexSave.create({
        data: {
          sessionKey,
          userId: willShare ? null : userId,
          userEmail,
          title: saveTitle,
          latex,
          shared: willShare,
          filename: stored.storedPath,
          url: stored.url,
        },
      })
      return res.status(201).json(record)
    } catch (err: any) {
      console.error('Failed to save latex', err)
      return res.status(500).json({ message: err?.message || 'Failed to save latex' })
    }
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end(`Method ${req.method} Not Allowed`)
}
