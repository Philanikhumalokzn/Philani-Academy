import type { NextApiRequest, NextApiResponse } from 'next'
import formidable, { File } from 'formidable'
import crypto from 'crypto'
import path from 'path'
import { createReadStream } from 'fs'
import { put } from '@vercel/blob'
import { getToken } from 'next-auth/jwt'

export const config = {
  api: { bodyParser: false },
}

const MAX_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
const EXT_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

function parseForm(req: NextApiRequest): Promise<{ files: formidable.Files }> {
  const form = formidable({ multiples: false, maxFileSize: MAX_SIZE })
  return new Promise((resolve, reject) => {
    form.parse(req, (err, _fields, files) => (err ? reject(err) : resolve({ files })))
  })
}

function pickFile(entry: File | File[] | undefined): File | null {
  if (!entry) return null
  return Array.isArray(entry) ? entry[0] || null : entry
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end('Method not allowed')
  }

  const token = await getToken({ req })
  if (!token) return res.status(401).json({ message: 'Unauthenticated' })
  const role = ((token as any)?.role as string | undefined) || 'student'
  if (role !== 'admin') return res.status(403).json({ message: 'Admin only' })

  try {
    const { files } = await parseForm(req)
    const upload = pickFile(files.file as File | File[] | undefined)
    if (!upload) return res.status(400).json({ message: 'Image file is required (field: file)' })
    if (!upload.mimetype || !ALLOWED.includes(upload.mimetype)) {
      return res.status(400).json({ message: 'Only JPEG, PNG, or WEBP images are allowed' })
    }
    if (!upload.size || upload.size > MAX_SIZE) {
      return res.status(400).json({ message: 'Image must be under 10 MB' })
    }

    const ext = EXT_MAP[upload.mimetype] || path.extname(upload.originalFilename || '') || '.png'
    const filename = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`
    const blobPath = `uploads/preamble-images/${filename}`

    const blobToken = process.env.BLOB_READ_WRITE_TOKEN
    let publicUrl: string

    if (blobToken) {
      const stream = createReadStream(upload.filepath)
      const blob = await put(blobPath, stream, {
        access: 'public',
        token: blobToken,
        contentType: upload.mimetype,
        addRandomSuffix: false,
      })
      publicUrl = blob.url
    } else {
      // Local fallback: return a placeholder (dev only)
      publicUrl = `/api/placeholder-image/${filename}`
    }

    return res.status(200).json({ url: publicUrl })
  } catch (err: any) {
    return res.status(500).json({ message: err?.message || 'Upload failed' })
  }
}
