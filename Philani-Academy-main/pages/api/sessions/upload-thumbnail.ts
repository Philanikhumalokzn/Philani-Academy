import type { NextApiRequest, NextApiResponse } from 'next'
import formidable, { File } from 'formidable'
import crypto from 'crypto'
import path from 'path'
import { createReadStream } from 'fs'
import { promises as fs } from 'fs'
import { put } from '@vercel/blob'
import { getUserIdFromReq, getUserRole } from '../../../lib/auth'

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
  if (role !== 'admin' && role !== 'teacher') return res.status(403).json({ message: 'Forbidden' })

  try {
    const { files } = await parseForm(req)
    const upload = pickFile(files.file as File | File[] | undefined)
    if (!upload) return res.status(400).json({ message: 'Image file is required' })

    if (!upload.mimetype || !ALLOWED_TYPES.includes(upload.mimetype)) {
      return res.status(400).json({ message: 'Only JPEG, PNG, or WEBP images are allowed' })
    }

    const fileSize = typeof upload.size === 'number' ? upload.size : 0
    if (!fileSize || fileSize > MAX_IMAGE_SIZE) {
      return res.status(400).json({ message: 'Image must be under 10 MB' })
    }

    const filename = buildFilename(upload)
    const relativePath = path.posix.join('uploads', 'sessions', 'thumbnails', userId, filename).replace(/\\/g, '/')

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

    return res.status(200).json({ url: publicUrl, pathname: storedPath })
  } catch (error: any) {
    console.error('Session thumbnail upload error', error)
    const message = error?.message?.includes('maxFileSize')
      ? 'Image must be under 10 MB'
      : error?.message || 'Failed to upload image'
    return res.status(500).json({ message })
  }
}
