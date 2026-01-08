import type { NextApiRequest, NextApiResponse } from 'next'
import formidable, { File } from 'formidable'
import crypto from 'crypto'
import path from 'path'
import { createReadStream } from 'fs'
import { promises as fs } from 'fs'
import { put } from '@vercel/blob'
import { getUserIdFromReq } from '../../../lib/auth'
import { getUserGrade, getUserRole } from '../../../lib/auth'
import { normalizeGradeInput } from '../../../lib/grades'
import { computeFileSha256Hex, upsertResourceBankItem } from '../../../lib/resourceBank'
import { extractQuestionsWithGemini, tryParseJsonLoose } from '../../../lib/geminiAssignmentExtract'

export const config = {
  api: {
    bodyParser: false,
  },
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

type ParsedForm = {
  fields: formidable.Fields
  files: formidable.Files
}

function parseForm(req: NextApiRequest): Promise<ParsedForm> {
  const form = formidable({
    multiples: false,
    maxFileSize: MAX_IMAGE_SIZE,
  })

  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err)
      resolve({ fields, files })
    })
  })
}

function pickFile(entry: File | File[] | undefined): File | null {
  if (!entry) return null
  if (Array.isArray(entry)) return entry[0] || null
  return entry
}

function extensionFor(file: File) {
  const fromMime = file.mimetype ? EXTENSION_MAP[file.mimetype] : ''
  const fromName = file.originalFilename ? path.extname(file.originalFilename) : ''
  return (fromMime || fromName || '.png').toLowerCase()
}

function buildFilename(file: File) {
  const random = crypto.randomBytes(6).toString('hex')
  const ext = extensionFor(file)
  return `${Date.now()}_${random}${ext}`
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end('Method not allowed')
  }

  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  const role = (await getUserRole(req)) || 'student'
  const grade = normalizeGradeInput(await getUserGrade(req))
  if (role !== 'admin' && !grade) {
    return res.status(403).json({ message: 'Grade not configured for this account' })
  }

  try {
    const { fields, files } = await parseForm(req)
    const upload = pickFile(files.file as File | File[] | undefined)
    if (!upload) {
      return res.status(400).json({ message: 'Image file is required' })
    }

    const parseField = (fields as any)?.parse
    const parseRequestedRaw = Array.isArray(parseField) ? parseField[0] : parseField
    const parseRequested = ['1', 'true', 'yes', 'on'].includes(String(parseRequestedRaw || '').trim().toLowerCase())

    if (!upload.mimetype || !ALLOWED_TYPES.includes(upload.mimetype)) {
      return res.status(400).json({ message: 'Only JPEG, PNG, or WEBP images are allowed' })
    }

    const fileSize = typeof upload.size === 'number' ? upload.size : 0
    if (!fileSize || fileSize > MAX_IMAGE_SIZE) {
      return res.status(400).json({ message: 'Image must be under 10 MB' })
    }

    const filename = buildFilename(upload)
    const relativePath = path.posix.join('uploads', 'challenges', userId, filename).replace(/\\/g, '/')

    const checksum = await computeFileSha256Hex(upload.filepath)

    const blobToken = process.env.BLOB_READ_WRITE_TOKEN

    let publicUrl = `/${relativePath}`
    let storedPath = relativePath

    if (blobToken) {
      const stream = createReadStream(upload.filepath)
      const blob = await put(relativePath, stream, {
        access: 'public',
        token: blobToken,
        contentType: upload.mimetype,
        addRandomSuffix: false,
      })
      publicUrl = blob.url
      storedPath = blob.pathname || relativePath
    } else {
      const absoluteDestination = path.join(process.cwd(), 'public', relativePath)
      await fs.mkdir(path.dirname(absoluteDestination), { recursive: true })
      await fs.copyFile(upload.filepath, absoluteDestination)
    }

    if (grade) {
      try {
        await upsertResourceBankItem({
          grade,
          title: upload.originalFilename || 'Challenge image',
          tag: 'Challenge image',
          url: publicUrl,
          filename: storedPath,
          contentType: upload.mimetype || null,
          size: fileSize || null,
          checksum,
          source: 'challenge-upload',
          createdById: userId || null,
        })
      } catch (rbErr) {
        // Do not block challenge image uploads if resource bank insertion fails.
        console.error('Resource bank upsert failed (challenge upload)', rbErr)
      }
    }

    let parsed: any | null = null
    let parsedPrompt: string | null = null
    let parseError: string | null = null

    if (parseRequested) {
      try {
        const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim()
        if (!geminiApiKey) throw new Error('Gemini is not configured (missing GEMINI_API_KEY)')

        const rawBytes = await fs.readFile(upload.filepath)
        const base64Data = rawBytes.toString('base64')
        const gradeLabel = grade ? `Grade ${String(grade).replace('GRADE_', '')}` : 'your grade'
        const model = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'

        const geminiText = await extractQuestionsWithGemini({
          apiKey: geminiApiKey,
          model,
          gradeLabel,
          mimeType: upload.mimetype || 'image/png',
          base64Data,
          filename: upload.originalFilename || filename,
          titleHint: upload.originalFilename || 'Quiz screenshot',
        })

        const obj = tryParseJsonLoose(geminiText)
        const questionsRaw = Array.isArray(obj?.questions) ? obj.questions : []
        const questions = questionsRaw
          .map((q: any) => ({ latex: typeof q?.latex === 'string' ? q.latex.trim() : '' }))
          .filter((q: any) => q.latex)
          .slice(0, 50)

        if (!questions.length) {
          throw new Error('Gemini returned no questions/text')
        }

        parsed = {
          title: typeof obj?.title === 'string' ? obj.title.trim() : '',
          displayTitle: typeof (obj as any)?.displayTitle === 'string' ? String((obj as any).displayTitle).trim() : '',
          sectionLabel: typeof (obj as any)?.sectionLabel === 'string' ? String((obj as any).sectionLabel).trim() : '',
          questions,
        }
        parsedPrompt = questions[0]?.latex || null
      } catch (err: any) {
        parseError = err?.message || 'Parse failed'
      }
    }

    return res.status(200).json({ url: publicUrl, pathname: storedPath, parsed, parsedPrompt, parseError })
  } catch (error: any) {
    console.error('Challenge upload error', error)
    const message = error?.message?.includes('maxFileSize')
      ? 'Image must be under 10 MB'
      : error?.message || 'Failed to upload image'
    return res.status(500).json({ message })
  }
}
