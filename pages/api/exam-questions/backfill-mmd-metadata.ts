import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'

type MetaRow = {
  questionNumber: string
  topic: string | null
  cognitiveLevel: number | null
  marks: number | null
}

type PreviewItem = {
  sourceId: string
  questionNumber: string
  metadataLabel: string
}

type SourceResult = {
  sourceId: string
  scanned: number
  patchedLines: number
  changed: boolean
}

function normalizeQNum(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const cleaned = raw.replace(/^q\s*/i, '').trim().replace(/[\s:;.,)\]]+$/g, '').trim()
  const numericPrefix = cleaned.match(/^(\d+(?:\.\d+){0,6})/)?.[1] || ''
  return numericPrefix.trim()
}

function buildMetaMap(rows: MetaRow[]): Map<string, { topic?: string; level?: string; marks?: string }> {
  const map = new Map<string, { topic?: string; level?: string; marks?: string }>()
  for (const row of rows) {
    const qNum = normalizeQNum(row.questionNumber)
    if (!qNum) continue
    const topic = String(row.topic || '').trim()
    const levelValue = row.cognitiveLevel
    const marksValue = row.marks
    const next = {
      ...(topic ? { topic } : {}),
      ...(levelValue !== null && levelValue !== undefined && Number.isFinite(levelValue) ? { level: String(levelValue) } : {}),
      ...(marksValue !== null && marksValue !== undefined && Number.isFinite(marksValue) ? { marks: String(Math.max(0, Math.round(marksValue))) } : {}),
    }
    if (!next.topic && !next.level && !next.marks) continue
    map.set(qNum, next)
  }
  return map
}

function buildMetaLabel(meta: { topic?: string; level?: string; marks?: string }) {
  const parts: string[] = []
  if (meta.topic) parts.push(`Topic=${meta.topic}`)
  if (meta.level) parts.push(`Level=${meta.level}`)
  if (meta.marks) parts.push(`Marks=${meta.marks}`)
  return parts.join('; ')
}

function stripExistingMetaSuffix(line: string): string {
  return line.replace(/\s*\[Meta:\s*[^\]]*\]\s*$/i, '')
}

function patchMmdWithMetadata(mmd: string, metaMap: Map<string, { topic?: string; level?: string; marks?: string }>) {
  const lines = String(mmd || '').split(/\r?\n/)
  let patchedLines = 0
  const previews: Array<{ questionNumber: string; metadataLabel: string }> = []

  const out = lines.map((rawLine) => {
    const line = String(rawLine || '')
    const trimmed = line.trim()

    let qNum = ''
    const headingMatch = trimmed.match(/(?:\\section\*\{\s*QUESTION\s+(\d+)\s*\}|^QUESTION\s+(\d+)\b)/i)
    if (headingMatch?.[1] || headingMatch?.[2]) {
      qNum = normalizeQNum(headingMatch[1] || headingMatch[2])
    } else {
      const numberLineMatch = trimmed.match(/^Q?(\d+(?:\.\d+){0,6})\b/i)
      if (numberLineMatch?.[1]) qNum = normalizeQNum(numberLineMatch[1])
    }

    if (!qNum) return line

    const meta = metaMap.get(qNum)
    if (!meta) return line

    const label = buildMetaLabel(meta)
    if (!label) return line

    const withoutSuffix = stripExistingMetaSuffix(line)
    const patched = `${withoutSuffix} [Meta: ${label}]`
    if (patched !== line) {
      patchedLines += 1
      if (previews.length < 40) previews.push({ questionNumber: qNum, metadataLabel: label })
    }
    return patched
  })

  return {
    mmd: out.join('\n'),
    patchedLines,
    previews,
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req })
  if ((token as any)?.role !== 'admin') {
    return res.status(403).json({ message: 'Admin only' })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const {
    sourceId,
    grade,
    year,
    month,
    paper,
    dryRun,
    processAll,
    sourceCursor,
    paperBatchSize,
  } = (req.body || {}) as {
    sourceId?: string
    grade?: string
    year?: number
    month?: string
    paper?: number
    dryRun?: boolean
    processAll?: boolean
    sourceCursor?: string
    paperBatchSize?: number
  }

  const where: any = { sourceId: { not: null } }
  const normalizedGrade = normalizeGradeInput(typeof grade === 'string' ? grade : undefined)
  if (normalizedGrade) where.grade = normalizedGrade
  if (Number.isFinite(year)) where.year = Number(year)
  if (typeof month === 'string' && month.trim()) where.month = month.trim()
  if (Number.isFinite(paper)) where.paper = Number(paper)

  const normalizedSourceId = typeof sourceId === 'string' ? sourceId.trim() : ''
  const useProcessAll = Boolean(processAll && !normalizedSourceId)
  const normalizedCursor = typeof sourceCursor === 'string' && sourceCursor.trim() ? sourceCursor.trim() : null
  const effectivePaperBatchSize = Number.isFinite(paperBatchSize)
    ? Math.max(1, Math.min(50, Number(paperBatchSize)))
    : 5

  let selectedSourceIds: string[] = []
  let nextSourceCursor: string | null = null
  let hasMoreSourceBatches = false

  if (normalizedSourceId) {
    selectedSourceIds = [normalizedSourceId]
  } else if (useProcessAll) {
    const sourceRows = await prisma.examQuestion.findMany({
      where: {
        ...where,
        sourceId: normalizedCursor ? { gt: normalizedCursor } : { not: null },
      },
      distinct: ['sourceId'],
      select: { sourceId: true },
      orderBy: { sourceId: 'asc' },
      take: effectivePaperBatchSize,
    })

    selectedSourceIds = sourceRows
      .map((row) => (typeof row.sourceId === 'string' ? row.sourceId : ''))
      .filter(Boolean)

    if (selectedSourceIds.length > 0) {
      nextSourceCursor = selectedSourceIds[selectedSourceIds.length - 1] || null
      if (nextSourceCursor) {
        const nextRows = await prisma.examQuestion.findMany({
          where: {
            ...where,
            sourceId: { gt: nextSourceCursor },
          },
          distinct: ['sourceId'],
          select: { sourceId: true },
          orderBy: { sourceId: 'asc' },
          take: 1,
        })
        hasMoreSourceBatches = nextRows.length > 0
      }
    }
  } else {
    const firstRow = await prisma.examQuestion.findFirst({
      where,
      select: { sourceId: true },
      orderBy: [{ year: 'desc' }, { month: 'asc' }, { paper: 'asc' }],
    })
    if (firstRow?.sourceId) selectedSourceIds = [firstRow.sourceId]
  }

  if (selectedSourceIds.length === 0) {
    return res.status(200).json({
      message: 'No sources matched MMD metadata backfill criteria.',
      dryRun: Boolean(dryRun),
      processAll: useProcessAll,
      scanned: 0,
      updated: 0,
      patchedLines: 0,
      sourceBatchSize: useProcessAll ? effectivePaperBatchSize : null,
      nextSourceCursor,
      hasMoreSourceBatches,
      scannedSourceIds: [] as string[],
      previews: [] as PreviewItem[],
      results: [] as SourceResult[],
    })
  }

  const results: SourceResult[] = []
  const previews: PreviewItem[] = []
  let updated = 0
  let scanned = 0
  let patchedLines = 0

  for (const sid of selectedSourceIds) {
    const source = await prisma.resourceBankItem.findUnique({
      where: { id: sid },
      select: { id: true, parsedJson: true },
    })
    if (!source) continue

    const parsed = (source.parsedJson && typeof source.parsedJson === 'object') ? (source.parsedJson as any) : {}
    const raw = (parsed?.raw && typeof parsed.raw === 'object') ? parsed.raw : {}
    const rawMmd = typeof raw?.mmd === 'string' ? raw.mmd : ''
    if (!rawMmd.trim()) continue

    const questionRows = await prisma.examQuestion.findMany({
      where: { sourceId: sid },
      select: {
        questionNumber: true,
        topic: true,
        cognitiveLevel: true,
        marks: true,
      },
      orderBy: [{ questionNumber: 'asc' }],
    }) as MetaRow[]

    scanned += questionRows.length
    const metaMap = buildMetaMap(questionRows)
    const patchResult = patchMmdWithMetadata(rawMmd, metaMap)
    patchedLines += patchResult.patchedLines

    for (const item of patchResult.previews) {
      if (previews.length >= 80) break
      previews.push({ sourceId: sid, questionNumber: item.questionNumber, metadataLabel: item.metadataLabel })
    }

    const changed = patchResult.patchedLines > 0 && patchResult.mmd !== rawMmd
    if (changed && !dryRun) {
      const nextParsed = {
        ...parsed,
        raw: {
          ...raw,
          mmd: patchResult.mmd,
        },
      }
      await prisma.resourceBankItem.update({
        where: { id: sid },
        data: { parsedJson: nextParsed as any },
      })
      updated += 1
    }

    results.push({
      sourceId: sid,
      scanned: questionRows.length,
      patchedLines: patchResult.patchedLines,
      changed,
    })
  }

  return res.status(200).json({
    message: dryRun
      ? `MMD metadata preview ready for ${results.length} source(s).`
      : `MMD metadata backfill applied to ${updated} source(s) from ${results.length} processed source(s).`,
    dryRun: Boolean(dryRun),
    processAll: useProcessAll,
    scanned,
    updated,
    patchedLines,
    sourceBatchSize: useProcessAll ? effectivePaperBatchSize : null,
    nextSourceCursor,
    hasMoreSourceBatches,
    scannedSourceIds: selectedSourceIds,
    previews,
    results,
  })
}
