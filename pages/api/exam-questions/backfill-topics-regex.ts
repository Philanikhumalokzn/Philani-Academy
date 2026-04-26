import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'
import {
  getQuestionRoot,
  pickTopTopicCandidates,
  scoreTopicMap,
  TopicCandidate,
  VALID_TOPICS,
} from '../../../lib/examTopicRegex'
import { getAllowedTopicsForGrade } from '../resources/extract-questions'

type CandidateQuestion = {
  id: string
  sourceId: string | null
  grade: string
  year: number
  month: string
  paper: number
  questionNumber: string
  topic: string | null
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

function buildIdentityKey(q: CandidateQuestion): string {
  return [
    q.sourceId || 'no-source',
    q.grade,
    q.year,
    q.month,
    q.paper,
  ].join('|')
}

function buildIdentityRootKey(identityKey: string, root: string): string {
  return `${identityKey}|${root || 'no-root'}`
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

function parseIdentityKey(identityKey: string): {
  sourceId: string | null
  grade: string
  year: number
  month: string
  paper: number
} {
  const [sourceIdRaw, grade, yearRaw, month, paperRaw] = identityKey.split('|')
  return {
    sourceId: sourceIdRaw && sourceIdRaw !== 'no-source' ? sourceIdRaw : null,
    grade,
    year: Number(yearRaw),
    month,
    paper: Number(paperRaw),
  }
}

function buildPreviewMessageSample(previews: ClassificationPreview[]): string {
  const lines = previews.slice(0, 6).map((item) => {
    const secondary = item.secondaryTopic ? ` | ${item.secondaryTopic} ${(item.secondaryShare || 0) * 100}%` : ''
    return `Q${item.questionNumber}: ${item.primaryTopic} ${(item.primaryShare * 100).toFixed(0)}%${secondary}`
  })
  return lines.join('\n')
}

  function buildIdentityRoots(questions: CandidateQuestion[]): Map<string, Set<string>> {
    const rootsByIdentity = new Map<string, Set<string>>()
    for (const q of questions) {
      const root = getQuestionRoot(q.questionNumber)
      if (!root) continue
      const identityKey = buildIdentityKey(q)
      const roots = rootsByIdentity.get(identityKey) || new Set<string>()
      roots.add(root)
      rootsByIdentity.set(identityKey, roots)
    }
    return rootsByIdentity
  }

  function buildSourceIds(questions: CandidateQuestion[]): string[] {
    return Array.from(new Set(questions.map((q) => q.sourceId).filter((v): v is string => Boolean(v))))
  }

  function buildMmdBySource(rows: Array<{ id: string; parsedJson: unknown }>): Map<string, string> {
    const map = new Map<string, string>()
    for (const row of rows) {
      const parsed = row.parsedJson as any
      const mmd = typeof parsed?.raw?.mmd === 'string' ? parsed.raw.mmd.trim() : ''
      if (mmd) map.set(row.id, mmd)
    }
    return map
  }

  function buildRootCandidatesFromMmd(
    rootsByIdentity: Map<string, Set<string>>,
    mmdBySource: Map<string, string>,
    opts: { secondTopicThreshold: number; minSecondScore: number },
  ): {
    candidatesByIdentityRoot: Map<string, TopicCandidate[]>
    missingContextCount: number
  } {
    const candidatesByIdentityRoot = new Map<string, TopicCandidate[]>()
    const sectionCache = new Map<string, Map<string, string>>()
    let missingContextCount = 0

    for (const [identityKey, roots] of rootsByIdentity.entries()) {
      const identity = parseIdentityKey(identityKey)
      if (!identity.sourceId) {
        missingContextCount += roots.size
        continue
      }

      const mmd = mmdBySource.get(identity.sourceId) || ''
      if (!mmd) {
        missingContextCount += roots.size
        continue
      }

      const sections = sectionCache.get(identity.sourceId) || extractQuestionSectionsFromMmd(mmd)
      if (!sectionCache.has(identity.sourceId)) sectionCache.set(identity.sourceId, sections)

      for (const root of roots) {
        const section = sections.get(root) || ''
        const scores = scoreTopicMap(section)
        const candidates = pickTopTopicCandidates(scores as any, opts)
        candidatesByIdentityRoot.set(buildIdentityRootKey(identityKey, root), candidates)
        if (!section) missingContextCount += 1
      }
    }

    return { candidatesByIdentityRoot, missingContextCount }
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
      secondTopicThreshold?: number
      minSecondScore?: number
    }

    const effectiveLimit = Number.isFinite(limit) ? Math.max(1, Math.min(3000, Number(limit))) : 1000
    const useProcessAll = Boolean(processAll)
    const useOnlyMissing = onlyMissing !== false
    const effectiveSecondTopicThreshold = Number.isFinite(secondTopicThreshold) ? Number(secondTopicThreshold) : 0.8
    const effectiveMinSecondScore = Number.isFinite(minSecondScore) ? Number(minSecondScore) : 2.4

    const where: Record<string, unknown> = {}
    if (typeof sourceId === 'string' && sourceId.trim()) where.sourceId = sourceId.trim()
    const normalizedGrade = normalizeGradeInput(typeof grade === 'string' ? grade : undefined)
    if (normalizedGrade) where.grade = normalizedGrade
    if (useProcessAll && !where.sourceId && !normalizedGrade) {
      return res.status(400).json({ message: 'grade is required when processAll=true (unless sourceId is provided).' })
    }
    if (Number.isFinite(year)) where.year = Number(year)
    if (typeof month === 'string' && month.trim()) where.month = month.trim()
    if (Number.isFinite(paper)) where.paper = Number(paper)
    if (useOnlyMissing) where.OR = [{ topic: null }, { topic: '' }]

    const queryArgs: Record<string, unknown> = {
      where,
      orderBy: [{ year: 'desc' }, { month: 'asc' }, { paper: 'asc' }, { questionNumber: 'asc' }],
      select: {
        id: true,
        sourceId: true,
        grade: true,
        year: true,
        month: true,
        paper: true,
        questionNumber: true,
        topic: true,
      },
    }
    if (!useProcessAll) queryArgs.take = effectiveLimit

    const targetQuestions = await prisma.examQuestion.findMany(queryArgs as any) as CandidateQuestion[]

    if (!targetQuestions.length) {
      return res.status(200).json({
        message: 'No questions matched regex topic backfill criteria.',
        scanned: 0,
        updated: 0,
        skipped: 0,
        dryRun: Boolean(dryRun),
        processAll: useProcessAll,
        onlyMissing: useOnlyMissing,
        previews: [] as ClassificationPreview[],
      })
    }

    const rootsByIdentity = buildIdentityRoots(targetQuestions)
    const sourceIds = buildSourceIds(targetQuestions)
    const sourceRows = sourceIds.length
      ? await prisma.resourceBankItem.findMany({
          where: { id: { in: sourceIds } },
          select: { id: true, parsedJson: true },
        })
      : []
    const mmdBySource = buildMmdBySource(sourceRows)

    const { candidatesByIdentityRoot, missingContextCount } = buildRootCandidatesFromMmd(
      rootsByIdentity,
      mmdBySource,
      {
        secondTopicThreshold: effectiveSecondTopicThreshold,
        minSecondScore: effectiveMinSecondScore,
      },
    )

    const previews: ClassificationPreview[] = []
    let updated = 0
    let skipped = 0

    for (const q of targetQuestions) {
      const root = getQuestionRoot(q.questionNumber)
      const identityKey = buildIdentityKey(q)
      const validTopicsForGrade = getAllowedTopicsForGrade(q.grade as any)
      const candidates = candidatesByIdentityRoot.get(buildIdentityRootKey(identityKey, root))
        || [{ topic: validTopicsForGrade[0] || 'Algebra', score: 0, share: 1 } as TopicCandidate]

      const primary = candidates[0]
      const secondary = candidates[1] || null

      previews.push({
        id: q.id,
        questionNumber: q.questionNumber,
        existingTopic: q.topic,
        primaryTopic: primary.topic,
        secondaryTopic: secondary?.topic || null,
        primaryShare: primary.share,
        secondaryShare: secondary?.share || null,
      })

      if (dryRun) continue

      const shouldSkip = q.topic === primary.topic
      if (shouldSkip) {
        skipped += 1
        continue
      }

      await prisma.examQuestion.update({ where: { id: q.id }, data: { topic: primary.topic } })
      updated += 1
    }

    const dualTopicCount = previews.filter((p) => p.secondaryTopic).length

    return res.status(200).json({
      message: `Regex topic backfill complete for ${targetQuestions.length} question(s).`,
      scanned: targetQuestions.length,
      updated,
      skipped,
      dryRun: Boolean(dryRun),
      processAll: useProcessAll,
      onlyMissing: useOnlyMissing,
      dualTopicCount,
      thresholds: {
        secondTopicThreshold: Number(effectiveSecondTopicThreshold.toFixed(4)),
        minSecondScore: Number(effectiveMinSecondScore.toFixed(4)),
      },
      previews: previews.slice(0, 120),
      notes: [
        'Root-forced mode is active: all subquestions under a QUESTION root inherit the same primary topic.',
        'Classification source is original parsed MMD blocks (QUESTION i to QUESTION i+1), not extracted question text.',
        useProcessAll
          ? 'Global mode is active: this run scoped across all matching papers in the database.'
          : 'Single-scope mode is active: this run scoped to the provided source/filters.',
        missingContextCount > 0
          ? `${missingContextCount} root block(s) had missing/undetected QUESTION sections and defaulted to fallback scoring.`
          : 'All targeted roots resolved to parsed MMD QUESTION sections.',
        `Preview sample:\n${buildPreviewMessageSample(previews) || 'No preview rows available.'}`,
      ],
    })
}
