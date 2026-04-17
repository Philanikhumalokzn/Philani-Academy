import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import {
  buildQuestionPreambleMapFromMmd,
  buildRootPreambleBlocksFromMmd,
  buildQuestionImageMapFromMmd,
  buildQuestionTableMapFromMmd,
  upsertRootPreambleRecords,
} from '../resources/extract-questions'

type BackfillResult = {
  sourceId: string
  identities: number
  created: number
  updated: number
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
    limit,
    grade,
    year,
    month,
    paper,
  } = (req.body || {}) as {
    sourceId?: string
    limit?: number
    grade?: string
    year?: number
    month?: string
    paper?: number
  }

  const effectiveLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Number(limit))) : 100

  const sourceIds: string[] = []
  if (typeof sourceId === 'string' && sourceId.trim()) {
    sourceIds.push(sourceId.trim())
  } else {
    const where: Record<string, unknown> = {
      sourceId: { not: null },
    }

    if (typeof grade === 'string' && grade.trim()) where.grade = grade.trim()
    if (Number.isFinite(year)) where.year = Number(year)
    if (typeof month === 'string' && month.trim()) where.month = month.trim()
    if (Number.isFinite(paper)) where.paper = Number(paper)

    const rows = await prisma.examQuestion.findMany({
      where,
      select: { sourceId: true },
      distinct: ['sourceId'],
      take: effectiveLimit,
      orderBy: { sourceId: 'asc' },
    })

    for (const row of rows) {
      if (row.sourceId && !sourceIds.includes(row.sourceId)) sourceIds.push(row.sourceId)
    }
  }

  if (sourceIds.length === 0) {
    return res.status(200).json({
      message: 'No source documents matched the backfill criteria.',
      processedSources: 0,
      created: 0,
      updated: 0,
      results: [] as BackfillResult[],
    })
  }

  const results: BackfillResult[] = []
  let totalCreated = 0
  let totalUpdated = 0

  for (const sid of sourceIds) {
    const source = await prisma.resourceBankItem.findUnique({
      where: { id: sid },
      select: { parsedJson: true },
    })
    if (!source) continue

    const rawMmd = String((source.parsedJson as any)?.raw?.mmd || '').trim()
    if (!rawMmd) continue

    const preambleMap = buildQuestionPreambleMapFromMmd(rawMmd)
    const rootPreambleBlocks = buildRootPreambleBlocksFromMmd(rawMmd)
    const imageMap = buildQuestionImageMapFromMmd(rawMmd)
    const tableMap = buildQuestionTableMapFromMmd(rawMmd)

    const identityWhere: Record<string, unknown> = { sourceId: sid }
    if (typeof grade === 'string' && grade.trim()) identityWhere.grade = grade.trim()
    if (Number.isFinite(year)) identityWhere.year = Number(year)
    if (typeof month === 'string' && month.trim()) identityWhere.month = month.trim()
    if (Number.isFinite(paper)) identityWhere.paper = Number(paper)

    const identities = await prisma.examQuestion.findMany({
      where: identityWhere,
      select: {
        grade: true,
        year: true,
        month: true,
        paper: true,
      },
      distinct: ['grade', 'year', 'month', 'paper'],
      orderBy: [{ year: 'asc' }, { month: 'asc' }, { paper: 'asc' }],
    })

    if (identities.length === 0) continue

    let created = 0
    let updated = 0

    for (const identity of identities) {
      const summary = await upsertRootPreambleRecords({
        sourceId: sid,
        grade: identity.grade,
        year: identity.year,
        month: identity.month,
        paper: identity.paper,
        preambleMap,
        imageMap,
        tableMap,
        rootPreambleBlocks,
      })
      created += summary.created
      updated += summary.updated
    }

    totalCreated += created
    totalUpdated += updated
    results.push({ sourceId: sid, identities: identities.length, created, updated })
  }

  return res.status(200).json({
    message: `Root preamble backfill complete for ${results.length} source(s).`,
    processedSources: results.length,
    created: totalCreated,
    updated: totalUpdated,
    results,
  })
}
