import { createReadStream } from 'fs'
import crypto from 'crypto'
import prisma from './prisma'

function isMissingColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '')
  return /does not exist in the current database|column .* does not exist|unknown column/i.test(message)
}

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
  sourceName?: string | null
  authorityScope?: string | null
  province?: string | null
  examCycle?: string | null
  assessmentType?: string | null
  assessmentFormality?: string | null
  year?: number | null
  sessionMonth?: string | null
  paper?: number | null
  paperMode?: string | null
  paperLabelRaw?: string | null
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
    let existing: any = null
    try {
      existing = await prisma.resourceBankItem.findFirst({
        where: { grade: input.grade, checksum },
      })
    } catch (error) {
      if (!isMissingColumnError(error)) throw error
      // Database is behind current Prisma schema; skip checksum dedupe and continue safely.
      existing = null
    }
    if (existing) {
      const shouldAttachParsed =
        (input.parsedJson != null || input.parsedAt != null || input.parseError != null) &&
        ((existing as any).parsedJson == null && (existing as any).parsedAt == null && (existing as any).parseError == null)

      if (!shouldAttachParsed) return existing

      const fullUpdateData = {
        sourceName: input.sourceName != null ? (String(input.sourceName).trim() || null) : undefined,
        authorityScope: input.authorityScope != null ? (input.authorityScope as any) : undefined,
        province: input.province != null ? (String(input.province).trim() || null) : undefined,
        examCycle: input.examCycle != null ? (input.examCycle as any) : undefined,
        assessmentType: input.assessmentType != null ? (input.assessmentType as any) : undefined,
        assessmentFormality: input.assessmentFormality != null ? (input.assessmentFormality as any) : undefined,
        year: typeof input.year === 'number' ? input.year : input.year === null ? null : undefined,
        sessionMonth: input.sessionMonth != null ? (String(input.sessionMonth).trim() || null) : undefined,
        paper: typeof input.paper === 'number' ? input.paper : input.paper === null ? null : undefined,
        paperMode: input.paperMode != null ? (input.paperMode as any) : undefined,
        paperLabelRaw: input.paperLabelRaw != null ? (String(input.paperLabelRaw).trim() || null) : undefined,
        parsedJson: input.parsedJson ?? undefined,
        parsedAt: input.parsedAt ?? undefined,
        parseError: typeof input.parseError === 'string' ? input.parseError : input.parseError === null ? null : undefined,
      }

      try {
        return await prisma.resourceBankItem.update({
          where: { id: existing.id },
          data: fullUpdateData,
        })
      } catch (error) {
        if (!isMissingColumnError(error)) throw error
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
  }

  const fullCreateData = {
    grade: input.grade,
    title,
    tag: (input.tag || '').trim() || null,
    sourceName: (input.sourceName || '').trim() || null,
    authorityScope: input.authorityScope ? (input.authorityScope as any) : null,
    province: (input.province || '').trim() || null,
    examCycle: input.examCycle ? (input.examCycle as any) : null,
    assessmentType: input.assessmentType ? (input.assessmentType as any) : null,
    assessmentFormality: input.assessmentFormality ? (input.assessmentFormality as any) : null,
    year: typeof input.year === 'number' ? input.year : null,
    sessionMonth: (input.sessionMonth || '').trim() || null,
    paper: typeof input.paper === 'number' ? input.paper : null,
    paperMode: input.paperMode ? (input.paperMode as any) : null,
    paperLabelRaw: (input.paperLabelRaw || '').trim() || null,
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
  }

  try {
    return await prisma.resourceBankItem.create({
      data: fullCreateData,
    })
  } catch (error) {
    if (!isMissingColumnError(error)) throw error
    return await prisma.resourceBankItem.create({
      data: {
        grade: input.grade,
        title,
        url,
        source: (input.source || '').trim() || 'user',
      },
    })
  }
}
