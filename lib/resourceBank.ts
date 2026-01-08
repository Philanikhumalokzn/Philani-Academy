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

  parsedJson?: any | null
  parsedAt?: Date | null
  parseError?: string | null
}) {
  const title = (input.title || '').trim() || 'Resource'
  const url = (input.url || '').trim()
  if (!url) throw new Error('Resource URL is required')

  const checksum = (input.checksum || '').trim() || null
  if (checksum) {
    const existing = await prisma.resourceBankItem.findFirst({
      where: { grade: input.grade, checksum },
    })
    if (existing) {
      const shouldAttachParsed =
        (input.parsedJson != null || input.parsedAt != null || input.parseError != null) &&
        ((existing as any).parsedJson == null && (existing as any).parsedAt == null && (existing as any).parseError == null)

      if (!shouldAttachParsed) return existing

      return await prisma.resourceBankItem.update({
        where: { id: existing.id },
        data: {
          parsedJson: input.parsedJson ?? undefined,
          parsedAt: input.parsedAt ?? undefined,
          parseError: typeof input.parseError === 'string' ? input.parseError : input.parseError === null ? null : undefined,
        },
      })
    }
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

      parsedJson: input.parsedJson ?? undefined,
      parsedAt: input.parsedAt ?? undefined,
      parseError: typeof input.parseError === 'string' ? input.parseError : input.parseError === null ? null : undefined,
    },
  })
}
