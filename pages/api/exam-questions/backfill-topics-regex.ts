import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'
import {
  pickTopTopicCandidates,
  scoreTopicMap,
  TopicCandidate,
} from '../../../lib/examTopicRegex'
import { getAllowedTopicsForGrade, normalizeTopicLabel } from '../resources/extract-questions'

type SourceRow = {
  id: string
  grade: string
  year: number | null
  sessionMonth: string | null
  paper: number | null
  parsedJson: unknown
}

type ClassificationPreview = {
  id: string
  questionNumber: string
  existingTopic: string | null
  primaryTopic: string
  secondaryTopic: string | null
  primaryShare: number
  secondaryShare: number | null
}

function extractQuestionSectionsFromMmd(mmd: string): Map<string, string> {
  const sections = new Map<string, string>()
  const lines = String(mmd || '').split(/\r?\n/)
  let currentRoot = ''
  let bucket: string[] = []

  const flush = () => {
    if (!currentRoot) return
    const block = bucket.join('\n').trim()
    if (block) sections.set(currentRoot, block)
  }

  for (const rawLine of lines) {
    const line = String(rawLine || '')
    const trimmed = line.trim()
    const headingMatch = trimmed.match(/(?:\\section\*\{\s*QUESTION\s+(\d+)\s*\}|^QUESTION\s+(\d+)\b)/i)

    if (headingMatch?.[1] || headingMatch?.[2]) {
      flush()
      currentRoot = String(headingMatch[1] || headingMatch[2] || '').trim()
      bucket = [line]
      continue
    }

    if (!currentRoot) continue
    bucket.push(line)
  }

  flush()
  return sections
}

function normalizeQuestionNumber(value: unknown): string {
  const text = String(value || '').trim()
  if (!text) return ''
  const match = text.match(/\d+(?:\.\d+)*/)
  return match?.[0] || ''
}

function compareQuestionNumbers(a: string, b: string): number {
  const aParts = normalizeQuestionNumber(a).split('.').map((part) => Number(part))
  const bParts = normalizeQuestionNumber(b).split('.').map((part) => Number(part))
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i += 1) {
    const av = aParts[i] ?? 0
    const bv = bParts[i] ?? 0
    if (av !== bv) return av - bv
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

function extractQuestionNumbersFromSection(sectionMmd: string, rootQuestionNumber: string): string[] {
  const values = new Set<string>()
  const root = normalizeQuestionNumber(rootQuestionNumber)
  if (root) values.add(root)

  const lines = String(sectionMmd || '').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = String(rawLine || '').trim()
    if (!line) continue
    const m = line.match(/^Q?((?:\d+)(?:\.\d+){0,6})\b/)
    const qNum = normalizeQuestionNumber(m?.[1] || '')
    if (!qNum) continue
    if (root && !(qNum === root || qNum.startsWith(`${root}.`))) continue
    values.add(qNum)
  }

  return Array.from(values).sort((a, b) => compareQuestionNumbers(a, b))
}

function buildPreviewMessageSample(previews: ClassificationPreview[]): string {
  const lines = previews.slice(0, 6).map((item) => {
    const secondary = item.secondaryTopic ? ` | ${item.secondaryTopic} ${(item.secondaryShare || 0) * 100}%` : ''
    return `Q${item.questionNumber}: ${item.primaryTopic} ${(item.primaryShare * 100).toFixed(0)}%${secondary}`
  })
  return lines.join('\n')
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
    limit,
    processAll,
    onlyMissing,
    dryRun,
    sourceCursor,
    paperBatchSize,
    secondTopicThreshold,
    minSecondScore,
  } = (req.body || {}) as {
    sourceId?: string
    grade?: string
    year?: number
    month?: string
    paper?: number
    limit?: number
    processAll?: boolean
    onlyMissing?: boolean
    dryRun?: boolean
    sourceCursor?: string
    paperBatchSize?: number
    secondTopicThreshold?: number
    minSecondScore?: number
  }

  const effectiveLimit = Number.isFinite(limit) ? Math.max(1, Math.min(5000, Number(limit))) : 1000
  const useProcessAll = Boolean(processAll)
  const useOnlyMissing = onlyMissing !== false
  const effectivePaperBatchSize = Number.isFinite(paperBatchSize)
    ? Math.max(1, Math.min(100, Number(paperBatchSize)))
    : 10
  const normalizedSourceCursor = typeof sourceCursor === 'string' && sourceCursor.trim() ? sourceCursor.trim() : null
  const effectiveSecondTopicThreshold = Number.isFinite(secondTopicThreshold) ? Number(secondTopicThreshold) : 0.8
  const effectiveMinSecondScore = Number.isFinite(minSecondScore) ? Number(minSecondScore) : 2.4

  const where: any = { parsedJson: { not: null } }
  if (typeof sourceId === 'string' && sourceId.trim()) where.id = sourceId.trim()
  const normalizedGrade = normalizeGradeInput(typeof grade === 'string' ? grade : undefined)
  if (normalizedGrade) where.grade = normalizedGrade
  if (useProcessAll && !where.id && !normalizedGrade) {
    return res.status(400).json({ message: 'grade is required when processAll=true (unless sourceId is provided).' })
  }
  if (Number.isFinite(year)) where.year = Number(year)
  if (typeof month === 'string' && month.trim()) where.sessionMonth = month.trim()
  if (Number.isFinite(paper)) where.paper = Number(paper)
  if (normalizedSourceCursor) where.id = { gt: normalizedSourceCursor }

  const sources = await prisma.resourceBankItem.findMany({
    where,
    select: {
      id: true,
      grade: true,
      year: true,
      sessionMonth: true,
      paper: true,
      parsedJson: true,
    },
    orderBy: { id: 'asc' },
    take: useProcessAll ? effectivePaperBatchSize : effectiveLimit,
  }) as SourceRow[]

  if (!sources.length) {
    return res.status(200).json({
      message: 'No papers matched regex topic backfill criteria.',
      scanned: 0,
      updated: 0,
      skipped: 0,
      dryRun: Boolean(dryRun),
      processAll: useProcessAll,
      onlyMissing: useOnlyMissing,
      previews: [] as ClassificationPreview[],
    })
  }

  const sourceIds = sources.map((source) => source.id)
  const existingRows = sourceIds.length
    ? await prisma.questionAnnotation.findMany({
        where: { sourceId: { in: sourceIds } },
        select: { sourceId: true, questionNumber: true, topic: true },
      })
    : []

  const existingTopicByKey = new Map<string, string | null>()
  for (const row of existingRows) {
    const qNum = normalizeQuestionNumber(row.questionNumber)
    if (!qNum) continue
    existingTopicByKey.set(`${row.sourceId}::${qNum}`, row.topic ?? null)
  }

  const previews: ClassificationPreview[] = []
  let updated = 0
  let skipped = 0
  let scanned = 0
  let missingContextCount = 0

  for (const source of sources) {
    const mmd = typeof (source.parsedJson as any)?.raw?.mmd === 'string'
      ? String((source.parsedJson as any).raw.mmd).trim()
      : ''
    if (!mmd) {
      missingContextCount += 1
      continue
    }

    const sections = extractQuestionSectionsFromMmd(mmd)
    const validTopicsForGrade = getAllowedTopicsForGrade(source.grade as any)
    const allowedCandidateSet = new Set(validTopicsForGrade)

    for (const [root, section] of sections.entries()) {
      const qNums = extractQuestionNumbersFromSection(section, root)
      if (!qNums.length) continue

      const scores = scoreTopicMap(section)
      const rawCandidates = pickTopTopicCandidates(scores as any, {
        secondTopicThreshold: effectiveSecondTopicThreshold,
        minSecondScore: effectiveMinSecondScore,
      })

      const remappedCandidates = rawCandidates.map((candidate) => {
        const mappedTopic = normalizeTopicLabel(candidate.topic, validTopicsForGrade) || candidate.topic
        return { ...candidate, topic: mappedTopic }
      })
      const candidates = remappedCandidates.filter((candidate) => allowedCandidateSet.has(candidate.topic))

      const fallbackCandidate = [{ topic: validTopicsForGrade[0] || 'Algebra', score: 0, share: 1 } as TopicCandidate]
      const rankedCandidates = candidates.length ? candidates : fallbackCandidate
      const primary = rankedCandidates[0]
      const secondary = rankedCandidates[1] || null

      for (const qNum of qNums) {
        const existingTopic = existingTopicByKey.get(`${source.id}::${qNum}`) ?? null
        if (useOnlyMissing && String(existingTopic || '').trim()) {
          skipped += 1
          continue
        }

        scanned += 1
        previews.push({
          id: `synthetic:${source.id}:${qNum}`,
          questionNumber: qNum,
          existingTopic,
          primaryTopic: primary.topic,
          secondaryTopic: secondary?.topic || null,
          primaryShare: primary.share,
          secondaryShare: secondary?.share || null,
        })

        if (dryRun) continue

        if (existingTopic === primary.topic) {
          skipped += 1
          continue
        }

        await prisma.questionAnnotation.upsert({
          where: {
            sourceId_questionNumber: {
              sourceId: source.id,
              questionNumber: qNum,
            },
          },
          create: {
            sourceId: source.id,
            questionNumber: qNum,
            topic: primary.topic,
          },
          update: {
            topic: primary.topic,
          },
        })
        updated += 1
      }
    }
  }

  const dualTopicCount = previews.filter((p) => p.secondaryTopic).length
  const nextSourceCursor = useProcessAll ? sources[sources.length - 1]?.id || null : null
  let hasMoreSourceBatches = false
  if (useProcessAll && nextSourceCursor) {
    const nextWhere: any = {
      parsedJson: { not: null },
      id: { gt: nextSourceCursor },
    }
    if (normalizedGrade) nextWhere.grade = normalizedGrade
    if (Number.isFinite(year)) nextWhere.year = Number(year)
    if (typeof month === 'string' && month.trim()) nextWhere.sessionMonth = month.trim()
    if (Number.isFinite(paper)) nextWhere.paper = Number(paper)
    const more = await prisma.resourceBankItem.findFirst({ where: nextWhere, select: { id: true } })
    hasMoreSourceBatches = Boolean(more)
  }

  return res.status(200).json({
    message: `Regex topic backfill complete for ${scanned} question(s).`,
    scanned,
    updated,
    skipped,
    dryRun: Boolean(dryRun),
    processAll: useProcessAll,
    onlyMissing: useOnlyMissing,
    dualTopicCount,
    sourceBatchSize: useProcessAll ? effectivePaperBatchSize : null,
    nextSourceCursor,
    hasMoreSourceBatches,
    scannedSourceIds: sources.map((source) => source.id),
    thresholds: {
      secondTopicThreshold: Number(effectiveSecondTopicThreshold.toFixed(4)),
      minSecondScore: Number(effectiveMinSecondScore.toFixed(4)),
    },
    previews: previews.slice(0, 120),
    notes: [
      'Root-forced mode is active: all subquestions under a QUESTION root inherit the same primary topic.',
      'Classification source is parsed MMD blocks (QUESTION i to QUESTION i+1).',
      'Results are persisted into QuestionAnnotation keyed by sourceId+questionNumber.',
      missingContextCount > 0
        ? `${missingContextCount} source(s) had missing/empty MMD and were skipped.`
        : 'All targeted sources resolved to parsed MMD QUESTION sections.',
      `Preview sample:\n${buildPreviewMessageSample(previews) || 'No preview rows available.'}`,
    ],
  })
}
