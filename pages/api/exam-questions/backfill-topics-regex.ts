import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'
import {
  blendTopicScores,
  getQuestionRoot,
  pickTopTopicCandidates,
  scoreTopicMap,
  TopicCandidate,
} from '../../../lib/examTopicRegex'

type CandidateQuestion = {
  id: string
  sourceId: string | null
  grade: string
  year: number
  month: string
  paper: number
  questionNumber: string
  questionText: string
  latex: string | null
  tableMarkdown: string | null
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

function isMissingTopic(value: unknown): boolean {
  return !String(value || '').trim()
}

function buildIdentityKey(q: CandidateQuestion): string {
  return [
    q.sourceId || 'no-source',
    q.grade,
    q.year,
    q.month,
    q.paper,
    getQuestionRoot(q.questionNumber) || 'no-root',
  ].join('|')
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
    onlyMissing,
    dryRun,
    secondTopicThreshold,
    minSecondScore,
    questionWeight,
    rootWeight,
  } = (req.body || {}) as {
    sourceId?: string
    grade?: string
    year?: number
    month?: string
    paper?: number
    limit?: number
    onlyMissing?: boolean
    dryRun?: boolean
    secondTopicThreshold?: number
    minSecondScore?: number
    questionWeight?: number
    rootWeight?: number
  }

  const effectiveLimit = Number.isFinite(limit) ? Math.max(1, Math.min(3000, Number(limit))) : 1000
  const useOnlyMissing = onlyMissing !== false

  const where: Record<string, unknown> = {}

  if (typeof sourceId === 'string' && sourceId.trim()) where.sourceId = sourceId.trim()
  const normalizedGrade = normalizeGradeInput(typeof grade === 'string' ? grade : undefined)
  if (normalizedGrade) where.grade = normalizedGrade
  if (Number.isFinite(year)) where.year = Number(year)
  if (typeof month === 'string' && month.trim()) where.month = month.trim()
  if (Number.isFinite(paper)) where.paper = Number(paper)
  if (useOnlyMissing) {
    where.OR = [{ topic: null }, { topic: '' }]
  }

  const questions = await prisma.examQuestion.findMany({
    where,
    take: effectiveLimit,
    orderBy: [
      { year: 'desc' },
      { month: 'asc' },
      { paper: 'asc' },
      { questionNumber: 'asc' },
    ],
    select: {
      id: true,
      sourceId: true,
      grade: true,
      year: true,
      month: true,
      paper: true,
      questionNumber: true,
      questionText: true,
      latex: true,
      tableMarkdown: true,
      topic: true,
    },
  }) as CandidateQuestion[]

  if (!questions.length) {
    return res.status(200).json({
      message: 'No questions matched regex topic backfill criteria.',
      scanned: 0,
      updated: 0,
      skipped: 0,
      dryRun: Boolean(dryRun),
      onlyMissing: useOnlyMissing,
      previews: [] as ClassificationPreview[],
    })
  }

  const rootScoreMap = new Map<string, Map<string, number>>()
  const questionScoreMap = new Map<string, Map<string, number>>()

  for (const q of questions) {
    const scores = scoreTopicMap(q.questionText, q.latex, q.tableMarkdown)
    questionScoreMap.set(q.id, scores as Map<string, number>)

    const key = buildIdentityKey(q)
    const existingRootScores = rootScoreMap.get(key) || new Map<string, number>()
    for (const [topic, score] of scores.entries()) {
      existingRootScores.set(topic, Number(((existingRootScores.get(topic) || 0) + score).toFixed(3)))
    }
    rootScoreMap.set(key, existingRootScores)
  }

  let updated = 0
  let skipped = 0
  const previews: ClassificationPreview[] = []

  const qWeight = Number.isFinite(questionWeight) ? Math.max(0, Math.min(1, Number(questionWeight))) : 0.65
  const rWeight = Number.isFinite(rootWeight) ? Math.max(0, Math.min(1, Number(rootWeight))) : 0.35
  const normalizedSum = qWeight + rWeight
  const normalizedQWeight = normalizedSum > 0 ? qWeight / normalizedSum : 0.65
  const normalizedRWeight = normalizedSum > 0 ? rWeight / normalizedSum : 0.35

  for (const q of questions) {
    const rawQuestionScores = questionScoreMap.get(q.id) || new Map<string, number>()
    const rawRootScores = rootScoreMap.get(buildIdentityKey(q)) || new Map<string, number>()

    const blendedScores = blendTopicScores(
      rawQuestionScores as Map<any, any>,
      rawRootScores as Map<any, any>,
      { questionWeight: normalizedQWeight, rootWeight: normalizedRWeight },
    ) as Map<any, any>

    const candidates = pickTopTopicCandidates(blendedScores as any, {
      secondTopicThreshold: Number.isFinite(secondTopicThreshold) ? Number(secondTopicThreshold) : 0.8,
      minSecondScore: Number.isFinite(minSecondScore) ? Number(minSecondScore) : 2.4,
    })

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

    await prisma.examQuestion.update({
      where: { id: q.id },
      data: { topic: primary.topic },
    })
    updated += 1
  }

  const dualTopicCount = previews.filter((p) => p.secondaryTopic).length

  return res.status(200).json({
    message: `Regex topic backfill complete for ${questions.length} question(s).`,
    scanned: questions.length,
    updated,
    skipped,
    dryRun: Boolean(dryRun),
    onlyMissing: useOnlyMissing,
    dualTopicCount,
    weighting: {
      questionWeight: Number(normalizedQWeight.toFixed(4)),
      rootWeight: Number(normalizedRWeight.toFixed(4)),
    },
    thresholds: {
      secondTopicThreshold: Number((Number.isFinite(secondTopicThreshold) ? Number(secondTopicThreshold) : 0.8).toFixed(4)),
      minSecondScore: Number((Number.isFinite(minSecondScore) ? Number(minSecondScore) : 2.4).toFixed(4)),
    },
    previews: previews.slice(0, 120),
    notes: [
      'Topic persistence remains single-label in the current schema; secondary topic is returned in preview output only.',
      'Run with dryRun=true first to audit dual-topic assignments and shares.',
    ],
  })
}
