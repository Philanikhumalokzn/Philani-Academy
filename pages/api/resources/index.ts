import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import formidable, { File } from 'formidable'
import path from 'path'
import { createReadStream } from 'fs'
import { promises as fs } from 'fs'
import { put } from '@vercel/blob'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'
import { computeFileSha256Hex, upsertResourceBankItem } from '../../../lib/resourceBank'

export const config = {
  api: {
    bodyParser: false,
  },
}

type ParsedForm = {
  fields: formidable.Fields
  files: formidable.Files
}

async function parseForm(req: NextApiRequest): Promise<ParsedForm> {
  const form = formidable({
    multiples: false,
    maxFileSize: 50 * 1024 * 1024,
  })
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err)
      resolve({ fields, files })
    })
  })
}

function pickFirstFile(fileEntry: File | File[] | undefined): File | null {
  if (!fileEntry) return null
  if (Array.isArray(fileEntry) && fileEntry.length > 0) return fileEntry[0]
  if (!Array.isArray(fileEntry)) return fileEntry
  return null
}

function sanitizeFilename(original: string | undefined): string {
  const fallback = 'resource'
  const parsed = path.parse(original || fallback)
  const safeName = (parsed.name || fallback).replace(/[^a-z0-9_-]+/gi, '_')
  const timestamp = Date.now()
  const extension = parsed.ext || ''
  return `${timestamp}_${safeName}${extension}`
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = ((token as any)?.role as string | undefined) || 'student'
  const authUserId = String((token as any)?.id || (token as any)?.sub || '')
  const tokenGrade = normalizeGradeInput((token as any)?.grade as string | undefined)

  if (req.method === 'GET') {
    const q = typeof req.query.grade === 'string' ? req.query.grade : ''
    const wants = normalizeGradeInput(q)

    const grade = role === 'admin' ? (wants || tokenGrade) : tokenGrade
    if (!grade) return res.status(400).json({ message: 'Grade not configured for this account' })

    const items = await prisma.resourceBankItem.findMany({
      where: { grade },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        createdBy: { select: { id: true, name: true, email: true, avatar: true } },
      },
    })

    return res.status(200).json({ grade, items })
  }

  if (req.method === 'POST') {
    if (role !== 'admin' && role !== 'teacher' && role !== 'student') {
      return res.status(403).json({ message: 'Forbidden' })
    }

    if (role !== 'admin') {
      if (!tokenGrade) return res.status(403).json({ message: 'Grade not configured for this account' })
    }

    try {
      const { fields, files } = await parseForm(req)
      const uploadedFile = pickFirstFile(files.file as File | File[] | undefined)
      if (!uploadedFile) return res.status(400).json({ message: 'File upload required' })

      const titleField = fields.title
      const providedTitle = Array.isArray(titleField) ? titleField[0] : titleField
      const title = (providedTitle || uploadedFile.originalFilename || 'Resource').toString().trim()

      const tagField = fields.tag
      const providedTag = Array.isArray(tagField) ? tagField[0] : tagField
      const tag = (providedTag || '').toString().trim()

      const gradeField = fields.grade
      const providedGrade = Array.isArray(gradeField) ? gradeField[0] : gradeField
      const wantsGrade = normalizeGradeInput((providedGrade || '').toString())

      const grade = role === 'admin' ? (wantsGrade || tokenGrade) : tokenGrade
      if (!grade) return res.status(400).json({ message: 'Grade is required' })

      // Strict: users (teacher/student) can only upload for their own grade.
      if (role !== 'admin' && tokenGrade && grade !== tokenGrade) {
        return res.status(403).json({ message: 'You may only upload resources for your own grade' })
      }

      const checksum = await computeFileSha256Hex(uploadedFile.filepath)

      const safeFilename = sanitizeFilename(uploadedFile.originalFilename)
      const relativePath = path.posix.join('resource-bank', String(grade), safeFilename).replace(/\\/g, '/')

      const blobToken = process.env.BLOB_READ_WRITE_TOKEN

      let storedFilename = relativePath
      let publicUrl = `/${relativePath}`
      const storedSize = typeof uploadedFile.size === 'number' ? uploadedFile.size : null

      if (blobToken) {
        const stream = createReadStream(uploadedFile.filepath)
        const blob = await put(relativePath, stream, {
          access: 'public',
          token: blobToken,
          contentType: uploadedFile.mimetype || undefined,
          addRandomSuffix: false,
        })
        storedFilename = blob.pathname || relativePath
        publicUrl = blob.url
      } else {
        const targetDir = path.join(process.cwd(), 'public', 'resource-bank', String(grade))
        await fs.mkdir(targetDir, { recursive: true })
        const destinationPath = path.join(targetDir, safeFilename)
        await fs.copyFile(uploadedFile.filepath, destinationPath)
      }

      const item = await upsertResourceBankItem({
        grade,
        title,
        tag: tag || null,
        url: publicUrl,
        filename: storedFilename,
        contentType: uploadedFile.mimetype || null,
        size: storedSize,
        checksum,
        source: role === 'admin' ? 'admin' : role,
        createdById: authUserId || null,
      })

      return res.status(201).json(item)
    } catch (err: any) {
      const message = err?.message?.includes('maxFileSize')
        ? 'File must be under 50 MB'
        : err?.message || 'Failed to upload resource'
      return res.status(500).json({ message })
    }
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end('Method not allowed')
}
