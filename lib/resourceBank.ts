import { createReadStream } from 'fs'
import crypto from 'crypto'
import prisma from './prisma'

export async function computeFileSha256Hex(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export async function upsertResourceBankItem(input: {
  grade: any
  title: string
  url: string
  filename?: string | null
  contentType?: string | null
  size?: number | null
  checksum?: string | null
  tag?: string | null
  source?: string | null
  createdById?: string | null
}) {
  const title = (input.title || '').trim() || 'Resource'
  const url = (input.url || '').trim()
  if (!url) throw new Error('Resource URL is required')

  const checksum = (input.checksum || '').trim() || null
  if (checksum) {
    const existing = await prisma.resourceBankItem.findFirst({
      where: { grade: input.grade, checksum },
    })
    if (existing) return existing
  }

  return await prisma.resourceBankItem.create({
    data: {
      grade: input.grade,
      title,
      tag: (input.tag || '').trim() || null,
      url,
      filename: (input.filename || '').trim() || null,
      contentType: (input.contentType || '').trim() || null,
      size: typeof input.size === 'number' ? input.size : null,
      checksum,
      source: (input.source || '').trim() || 'user',
      createdById: (input.createdById || '').trim() || null,
    },
  })
}
