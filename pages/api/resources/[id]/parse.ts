import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import path from 'path'
import { promises as fs } from 'fs'
import prisma from '../../../../lib/prisma'
import { normalizeGradeInput } from '../../../../lib/grades'
import { parsePdfResource } from '../../../../lib/pdfResourceParser'

async function readBufferFromResourceUrl(url: string): Promise<Buffer> {
  const trimmed = (url || '').trim()
  if (!trimmed) throw new Error('Resource url is empty')

  if (trimmed.startsWith('/')) {
    const localPath = path.join(process.cwd(), 'public', trimmed.replace(/^\/+/, ''))
    return await fs.readFile(localPath)
  }

  const resp = await fetch(trimmed)
  if (!resp.ok) {
    throw new Error(`Failed to fetch resource (${resp.status})`)
  }

  const arr = await resp.arrayBuffer()
  return Buffer.from(arr)
}

async function safeUpdateResource(id: string, data: any) {
  try {
    await prisma.resourceBankItem.update({ where: { id }, data })
  } catch {
    // Best-effort only. This can fail if the DB migration hasn't been applied yet.
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = ((token as any)?.role as string | undefined) || 'student'
  const tokenGrade = normalizeGradeInput((token as any)?.grade as string | undefined)

  const idParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  if (!idParam) return res.status(400).json({ message: 'Resource id required' })

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end('Method not allowed')
  }

  const item = await prisma.resourceBankItem.findUnique({
    where: { id: String(idParam) },
    select: {
      id: true,
      grade: true,
      url: true,
      title: true,
      filename: true,
      contentType: true,
      parsedAt: true,
    },
  })

  if (!item) return res.status(404).json({ message: 'Resource not found' })

  // Access control: admin can parse any grade; others can only parse within their grade.
  if (role !== 'admin') {
    if (!tokenGrade) return res.status(403).json({ message: 'Grade not configured for this account' })
    if (String(item.grade) !== String(tokenGrade)) return res.status(403).json({ message: 'Forbidden' })
  }

  const looksLikePdf =
    (item.contentType || '').toLowerCase().includes('pdf') ||
    (item.filename || '').toLowerCase().endsWith('.pdf') ||
    (item.url || '').toLowerCase().includes('.pdf')

  if (!looksLikePdf) {
    return res.status(400).json({ message: 'Only PDF resources can be parsed' })
  }

  try {
    const pdfBuffer = await readBufferFromResourceUrl(item.url)

    const parsed = await parsePdfResource({
      resourceId: item.id,
      grade: String(item.grade),
      pdfBuffer,
    })

    await safeUpdateResource(item.id, {
      parsedJson: parsed as any,
      parsedAt: new Date(),
      parseError: null,
    })

    return res.status(200).json({
      id: item.id,
      parsedAt: new Date().toISOString(),
      pages: parsed.pages.length,
      questions: parsed.questions.length,
    })
  } catch (err: any) {
    const rawMessage = err?.message || 'Failed to parse PDF'
    const message =
      /does not exist|unknown.*field|unknown.*column/i.test(rawMessage)
        ? `${rawMessage} (Database migration may not be applied yet.)`
        : rawMessage

    await safeUpdateResource(item.id, {
      parsedAt: null,
      parseError: message,
    })

    return res.status(500).json({ message })
  }
}
