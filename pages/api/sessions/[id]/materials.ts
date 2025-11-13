import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import formidable, { File } from 'formidable'
import path from 'path'
import { promises as fs } from 'fs'
import prisma from '../../../../lib/prisma'
import { normalizeGradeInput } from '../../../../lib/grades'

export const config = {
  api: {
    bodyParser: false
  }
}

type ParsedForm = {
  fields: formidable.Fields
  files: formidable.Files
}

async function parseForm(req: NextApiRequest): Promise<ParsedForm> {
  const form = formidable({
    multiples: false,
    maxFileSize: 50 * 1024 * 1024 // 50 MB upload cap for lesson materials
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
  if (Array.isArray(fileEntry) && fileEntry.length > 0) {
    return fileEntry[0]
  }
  if (!Array.isArray(fileEntry)) return fileEntry
  return null
}

function sanitizeFilename(original: string | undefined): string {
  const fallback = 'material'
  const parsed = path.parse(original || fallback)
  const safeName = (parsed.name || fallback).replace(/[^a-z0-9_-]+/gi, '_')
  const timestamp = Date.now()
  const extension = parsed.ext || ''
  return `${timestamp}_${safeName}${extension}`
}

function ensureLeadingSlash(urlPath: string): string {
  return urlPath.startsWith('/') ? urlPath : `/${urlPath}`
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sessionIdParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  if (!sessionIdParam) {
    return res.status(400).json({ message: 'Session id required' })
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any)?.role as string | undefined
  const tokenGrade = normalizeGradeInput((token as any)?.grade as string | undefined)
  const sessionRecord = await prisma.sessionRecord.findUnique({ where: { id: sessionIdParam }, select: { grade: true, id: true } })
  if (!sessionRecord) return res.status(404).json({ message: 'Session not found' })

  const sessionGrade = sessionRecord.grade
  if (role === 'teacher' || role === 'student') {
    if (!tokenGrade) return res.status(403).json({ message: 'Grade not configured for this account' })
    if (tokenGrade !== sessionGrade) return res.status(403).json({ message: 'Access to this session is restricted to its grade' })
  } else if (role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden' })
  }

  if (req.method === 'GET') {
    const materials = await prisma.lessonMaterial.findMany({
      where: { sessionId: sessionRecord.id },
      orderBy: { createdAt: 'desc' }
    })
    return res.status(200).json(materials)
  }

  if (req.method === 'POST') {
    if (role !== 'admin' && role !== 'teacher') {
      return res.status(403).json({ message: 'Only instructors may upload materials' })
    }

    try {
      const { fields, files } = await parseForm(req)
      const uploadedFile = pickFirstFile(files.file as File | File[] | undefined)
      if (!uploadedFile) {
        return res.status(400).json({ message: 'File upload required' })
      }

      const titleField = fields.title
      const providedTitle = Array.isArray(titleField) ? titleField[0] : titleField
      const finalTitle = (providedTitle || uploadedFile.originalFilename || 'Lesson material').toString().trim()

      const safeFilename = sanitizeFilename(uploadedFile.originalFilename)
      const materialsDir = path.join(process.cwd(), 'public', 'materials', sessionRecord.id)
      await fs.mkdir(materialsDir, { recursive: true })
      const destinationPath = path.join(materialsDir, safeFilename)
      await fs.copyFile(uploadedFile.filepath, destinationPath)

      const relativePath = path.posix.join('materials', sessionRecord.id, safeFilename).replace(/\\/g, '/')
      const publicUrl = ensureLeadingSlash(relativePath)

      const material = await prisma.lessonMaterial.create({
        data: {
          sessionId: sessionRecord.id,
          title: finalTitle,
          filename: safeFilename,
          url: publicUrl,
          contentType: uploadedFile.mimetype || null,
          size: typeof uploadedFile.size === 'number' ? uploadedFile.size : null,
          createdBy: (token as any)?.email ? String((token as any).email) : null
        }
      })

      return res.status(201).json(material)
    } catch (err: any) {
      console.error('Upload material error', err)
      return res.status(500).json({ message: err?.message || 'Failed to upload material' })
    }
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end(`Method ${req.method} Not Allowed`)
}
