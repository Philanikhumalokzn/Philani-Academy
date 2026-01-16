import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import formidable, { File } from 'formidable'
import path from 'path'
import { createReadStream } from 'fs'
import { promises as fs } from 'fs'
import { put } from '@vercel/blob'
import prisma from '../../../../../../../lib/prisma'
import { normalizeGradeInput } from '../../../../../../../lib/grades'

export const config = {
  api: {
    bodyParser: false,
  },
}

const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25 MB
const MAX_QUESTION_ID_LENGTH = 80
const MAX_ASSIGNMENT_ID_LENGTH = 80

type ParsedForm = {
  fields: formidable.Fields
  files: formidable.Files
}

async function parseForm(req: NextApiRequest): Promise<ParsedForm> {
  const form = formidable({ multiples: false, maxFileSize: MAX_FILE_SIZE })
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
  const fallback = 'solution'
  if (!original) return fallback
  const base = path.basename(original)
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_')
  return cleaned.length ? cleaned.slice(0, 120) : fallback
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sessionIdParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  const assignmentIdParam = Array.isArray((req.query as any).assignmentId) ? (req.query as any).assignmentId[0] : (req.query as any).assignmentId

  if (!sessionIdParam) return res.status(400).json({ message: 'Session id required' })
  if (!assignmentIdParam) return res.status(400).json({ message: 'Assignment id required' })

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any)?.role as string | undefined
  const tokenGrade = normalizeGradeInput((token as any)?.grade as string | undefined)

  const sessionRecord = await prisma.sessionRecord.findUnique({
    where: { id: String(sessionIdParam) },
    select: { grade: true, id: true },
  })
  if (!sessionRecord) return res.status(404).json({ message: 'Session not found' })

  if (role === 'teacher') {
    if (!tokenGrade) return res.status(403).json({ message: 'Grade not configured for this account' })
    if (tokenGrade !== sessionRecord.grade) return res.status(403).json({ message: 'Access to this session is restricted to its grade' })
  } else if (role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden' })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const assignmentId = String(assignmentIdParam).trim().slice(0, MAX_ASSIGNMENT_ID_LENGTH)

  const assignment = await (prisma as any).assignment.findFirst({
    where: { id: assignmentId, sessionId: sessionRecord.id },
    select: { id: true },
  })
  if (!assignment) return res.status(404).json({ message: 'Assignment not found' })

  try {
    const { fields, files } = await parseForm(req)
    const uploadedFile = pickFirstFile(files.file as File | File[] | undefined)
    if (!uploadedFile) {
      return res.status(400).json({ message: 'File upload required' })
    }

    const questionIdField = fields.questionId
    const rawQuestionId = Array.isArray(questionIdField) ? questionIdField[0] : questionIdField
    const safeQuestionId = (typeof rawQuestionId === 'string' && rawQuestionId.trim())
      ? rawQuestionId.trim().slice(0, MAX_QUESTION_ID_LENGTH)
      : ''
    if (!safeQuestionId) {
      return res.status(400).json({ message: 'questionId is required' })
    }

    const question = await (prisma as any).assignmentQuestion.findFirst({
      where: { id: safeQuestionId, assignmentId },
      select: { id: true },
    })
    if (!question) {
      return res.status(404).json({ message: 'Question not found' })
    }

    const safeFilename = sanitizeFilename(uploadedFile.originalFilename)
    const relativePath = path.posix
      .join('sessions', sessionRecord.id, 'assignments', assignmentId, 'solutions', `${safeQuestionId}-${safeFilename}`)
      .replace(/\\/g, '/')

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
      const targetDir = path.join(process.cwd(), 'public', 'sessions', sessionRecord.id, 'assignments', assignmentId, 'solutions')
      await fs.mkdir(targetDir, { recursive: true })
      const destinationPath = path.join(targetDir, `${safeQuestionId}-${safeFilename}`)
      await fs.copyFile(uploadedFile.filepath, destinationPath)
    }

    const assignmentSolution = (prisma as any).assignmentSolution as any

    const record = await assignmentSolution.upsert({
      where: { questionId: safeQuestionId },
      update: {
        sessionId: sessionRecord.id,
        assignmentId,
        questionId: safeQuestionId,
        fileUrl: publicUrl,
        fileName: storedFilename,
        contentType: uploadedFile.mimetype || null,
        size: storedSize,
        createdBy: (token as any)?.email ? String((token as any).email) : null,
      },
      create: {
        sessionId: sessionRecord.id,
        assignmentId,
        questionId: safeQuestionId,
        fileUrl: publicUrl,
        fileName: storedFilename,
        contentType: uploadedFile.mimetype || null,
        size: storedSize,
        createdBy: (token as any)?.email ? String((token as any).email) : null,
      },
    })

    return res.status(200).json({ url: publicUrl, record })
  } catch (err: any) {
    console.error('Upload solution error', err)
    const message = err?.message?.includes('maxFileSize') ? 'Solution file must be under 25 MB' : (err?.message || 'Failed to upload solution')
    return res.status(500).json({ message })
  }
}
