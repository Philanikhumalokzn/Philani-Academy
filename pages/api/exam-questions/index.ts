import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
}

const VALID_TOPICS = [
  'Algebra', 'Functions', 'Number Patterns', 'Finance', 'Trigonometry',
  'Euclidean Geometry', 'Analytical Geometry', 'Statistics', 'Probability',
  'Calculus', 'Sequences and Series', 'Polynomials', 'Other',
]

function pushUniqueUrl(target: string[], value: unknown) {
  const url = typeof value === 'string' ? value.trim() : ''
  if (!url) return
  if (!/^https?:\/\//i.test(url)) return
  if (!target.includes(url)) target.push(url)
}

function readQuestionImageUrls(question: unknown): string[] {
  const urls: string[] = []
  if (!question || typeof question !== 'object') return urls
  const obj = question as Record<string, unknown>

  pushUniqueUrl(urls, obj.imageUrl)

  const diagrams = Array.isArray(obj.diagrams) ? obj.diagrams : []
  for (const diagram of diagrams) {
    if (!diagram || typeof diagram !== 'object') continue
    pushUniqueUrl(urls, (diagram as Record<string, unknown>).url)
    pushUniqueUrl(urls, (diagram as Record<string, unknown>).imageUrl)
  }

  return urls
}

function coerceQuestionsArray(value: unknown): any[] | null {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const candidates = [record.questions, record.items, record.results, record.data]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }
  return null
}

function buildQuestionImageMapFromPayload(payload: unknown): Map<string, string[]> {
  const map = new Map<string, string[]>()
  const questions = coerceQuestionsArray(payload)
  if (!questions?.length) return map

  for (const rawItem of questions) {
    if (!rawItem || typeof rawItem !== 'object') continue
    const item = rawItem as Record<string, unknown>
    const qNum = typeof item.questionNumber === 'string'
      ? item.questionNumber.trim()
      : String(item.questionNumber || '').trim()
    if (!qNum) continue
    const urls = readQuestionImageUrls(item)
    if (!urls.length) continue
    map.set(qNum, urls)
  }

  return map
}

function buildQuestionImageMapFromMmd(mmd: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  if (!mmd.trim()) return map

  const push = (qNum: string, url: string) => {
    if (!qNum || !url) return
    const current = map.get(qNum) || []
    if (!current.includes(url)) current.push(url)
    map.set(qNum, current)
  }

  const lines = mmd.split(/\r?\n/)
  let currentTop = ''
  let currentScoped = ''

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim()
    if (!line) continue

    const topMatch = line.match(/\\section\*\{\s*QUESTION\s+(\d+)\s*\}/i)
      || line.match(/^QUESTION\s+(\d+)\b/i)
    if (topMatch?.[1]) {
      currentTop = topMatch[1]
      currentScoped = currentTop
    }

    const scopedMatch = line.match(/^((?:\d+)(?:\.\d+){0,6})\b/)
    if (scopedMatch?.[1]) {
      const qNum = scopedMatch[1]
      if (!currentTop || qNum === currentTop || qNum.startsWith(`${currentTop}.`)) {
        currentScoped = qNum
      }
    }

    const imageMatches = line.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)
    for (const match of imageMatches) {
      const url = String(match?.[1] || '').trim()
      if (!url) continue
      if (currentScoped) {
        push(currentScoped, url)
      } else if (currentTop) {
        push(currentTop, url)
      }
    }
  }

  return map
}

function collectInheritedImages(questionNumber: string, map: Map<string, string[]>): string[] {
  const urls: string[] = []
  const parts = String(questionNumber || '').split('.').filter(Boolean)
  for (let i = parts.length; i > 0; i -= 1) {
    const key = parts.slice(0, i).join('.')
    const values = map.get(key) || []
    for (const value of values) {
      if (!urls.includes(value)) urls.push(value)
    }
  }
  return urls
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req })
  const role = ((token as any)?.role as string | undefined) || 'student'
  const tokenGrade = normalizeGradeInput((token as any)?.grade)

  if (!token) return res.status(401).json({ message: 'Unauthenticated' })

  // Bulk DELETE
  if (req.method === 'DELETE') {
    if (role !== 'admin') return res.status(403).json({ message: 'Admin only' })
    const { ids } = req.body as { ids?: unknown }
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'ids array is required' })
    }
    const safeIds = (ids as unknown[]).filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 500)
    if (safeIds.length === 0) return res.status(400).json({ message: 'No valid ids provided' })
    const { count } = await prisma.examQuestion.deleteMany({ where: { id: { in: safeIds } } })
    return res.status(200).json({ deleted: count })
  }

  // Bulk PATCH
  if (req.method === 'PATCH') {
    if (role !== 'admin') return res.status(403).json({ message: 'Admin only' })
    const { ids, patch } = req.body as { ids?: unknown; patch?: any }
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'ids array is required' })
    }
    if (!patch || typeof patch !== 'object') {
      return res.status(400).json({ message: 'patch object is required' })
    }
    const safeIds = (ids as unknown[]).filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 500)
    if (safeIds.length === 0) return res.status(400).json({ message: 'No valid ids provided' })
    const data: any = {}
    if (patch.approved !== undefined) data.approved = Boolean(patch.approved)
    if (patch.topic !== undefined) {
      data.topic = typeof patch.topic === 'string' && VALID_TOPICS.includes(patch.topic) ? patch.topic : null
    }
    if (patch.cognitiveLevel !== undefined) {
      const cl = typeof patch.cognitiveLevel === 'number' ? patch.cognitiveLevel : parseInt(String(patch.cognitiveLevel), 10)
      data.cognitiveLevel = Number.isFinite(cl) && cl >= 1 && cl <= 4 ? cl : null
    }
    if (patch.marks !== undefined) {
      const m = typeof patch.marks === 'number' ? patch.marks : parseFloat(String(patch.marks))
      data.marks = Number.isFinite(m) && m >= 0 ? Math.round(m) : null
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: 'No patchable fields provided' })
    }
    const { count } = await prisma.examQuestion.updateMany({ where: { id: { in: safeIds } }, data })
    return res.status(200).json({ updated: count })
  }

  // POST: create a single (root) ExamQuestion record
  if (req.method === 'POST') {
    if (role !== 'admin') return res.status(403).json({ message: 'Admin only' })
    const body = req.body as Record<string, unknown>
    const postGrade = normalizeGradeInput(body.grade as string)
    if (!postGrade) return res.status(400).json({ message: 'grade is required' })
    const postYear = typeof body.year === 'number' ? body.year : parseInt(String(body.year || ''), 10)
    if (!Number.isFinite(postYear)) return res.status(400).json({ message: 'year is required' })
    const postMonth = typeof body.month === 'string' ? body.month.trim() : ''
    if (!postMonth) return res.status(400).json({ message: 'month is required' })
    const postPaper = typeof body.paper === 'number' ? body.paper : parseInt(String(body.paper || ''), 10)
    if (!Number.isFinite(postPaper)) return res.status(400).json({ message: 'paper is required' })
    const postQNum = typeof body.questionNumber === 'string' ? body.questionNumber.trim() : ''
    if (!postQNum) return res.status(400).json({ message: 'questionNumber is required' })
    const postText = typeof body.questionText === 'string' ? body.questionText.trim() : ''
    if (!postText) return res.status(400).json({ message: 'questionText is required' })
    const postDepth = typeof body.questionDepth === 'number' ? body.questionDepth : 0
    const postImageUrl = typeof body.imageUrl === 'string' && /^https?:\/\//i.test(body.imageUrl.trim()) ? body.imageUrl.trim() : null
    const postTableMd = typeof body.tableMarkdown === 'string' ? body.tableMarkdown.trim() || null : null
    const postSourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() || null : null
    const postApproved = body.approved !== undefined ? Boolean(body.approved) : false
    try {
      const created = await prisma.examQuestion.create({
        data: {
          grade: postGrade,
          year: postYear,
          month: postMonth,
          paper: postPaper,
          questionNumber: postQNum,
          questionDepth: postDepth,
          questionText: postText,
          imageUrl: postImageUrl,
          tableMarkdown: postTableMd,
          sourceId: postSourceId,
          approved: postApproved,
        },
        select: {
          id: true, grade: true, year: true, month: true, paper: true,
          questionNumber: true, questionDepth: true, questionText: true,
          latex: true, imageUrl: true, tableMarkdown: true, approved: true, sourceId: true,
        },
      })
      return res.status(201).json(created)
    } catch (err: any) {
      return res.status(500).json({ message: err?.message || 'Failed to create question' })
    }
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET', 'PATCH', 'DELETE', 'POST'])
    return res.status(405).end('Method not allowed')
  }

  const q = req.query

  // Grade: admins can query any grade, students are confined to their own
  const requestedGrade = normalizeGradeInput(q.grade as string)
  const grade = role === 'admin' ? (requestedGrade || undefined) : (tokenGrade || undefined)

  const year = q.year ? parseInt(String(q.year), 10) : undefined
  const month = q.month ? String(q.month) : undefined
  const paper = q.paper ? parseInt(String(q.paper), 10) : undefined
  const topic = q.topic ? String(q.topic) : undefined
  const cognitiveLevel = q.cognitiveLevel ? parseInt(String(q.cognitiveLevel), 10) : undefined
  const questionNumber = q.questionNumber ? String(q.questionNumber) : undefined
  const sourceId = q.sourceId ? String(q.sourceId) : undefined
  const approvedOnly = role !== 'admin' // students only see approved questions
  const page = Math.max(1, parseInt(String(q.page || '1'), 10))
  const take = Math.min(100, Math.max(1, parseInt(String(q.take || '50'), 10)))
  const skip = (page - 1) * take

  const where: any = {}
  if (grade) where.grade = grade
  if (year && Number.isFinite(year)) where.year = year
  if (month) where.month = month
  if (paper && Number.isFinite(paper)) where.paper = paper
  if (topic) where.topic = topic
  if (cognitiveLevel && Number.isFinite(cognitiveLevel)) where.cognitiveLevel = cognitiveLevel
  if (questionNumber) where.questionNumber = { startsWith: questionNumber }
  if (sourceId) where.sourceId = sourceId
  if (approvedOnly) where.approved = true

  const [total, items] = await Promise.all([
    prisma.examQuestion.count({ where }),
    prisma.examQuestion.findMany({
      where,
      orderBy: [{ year: 'desc' }, { month: 'asc' }, { paper: 'asc' }, { questionNumber: 'asc' }],
      skip,
      take,
      select: {
        id: true,
        grade: true,
        year: true,
        month: true,
        paper: true,
        questionNumber: true,
        questionDepth: true,
        topic: true,
        cognitiveLevel: true,
        marks: true,
        questionText: true,
        latex: true,
        imageUrl: true,
        tableMarkdown: true,
        approved: true,
        sourceId: true,
        createdAt: true,
      },
    }),
  ])

  const sourceIds = Array.from(new Set(items.map((item) => String(item.sourceId || '')).filter(Boolean)))
  const sources = sourceIds.length
    ? await prisma.resourceBankItem.findMany({
        where: { id: { in: sourceIds } },
        select: { id: true, title: true, url: true, parsedJson: true },
      })
    : []

  const sourceImageMap = new Map<string, Map<string, string[]>>()
  const sourceTitleMap = new Map<string, string>()
  const sourceUrlMap = new Map<string, string>()
  for (const source of sources) {
    sourceTitleMap.set(source.id, String(source.title || '').trim())
    if (source.url) sourceUrlMap.set(source.id, String(source.url).trim())
    const parsed = source.parsedJson as any
    const combined = new Map<string, string[]>()

    const fromPayload = buildQuestionImageMapFromPayload(parsed)
    for (const [qNum, urls] of fromPayload.entries()) {
      combined.set(qNum, urls)
    }

    const mmd = typeof parsed?.raw?.mmd === 'string' ? parsed.raw.mmd : ''
    const fromMmd = buildQuestionImageMapFromMmd(mmd)
    for (const [qNum, urls] of fromMmd.entries()) {
      const existing = combined.get(qNum) || []
      const merged = [...existing]
      for (const url of urls) {
        if (!merged.includes(url)) merged.push(url)
      }
      combined.set(qNum, merged)
    }

    sourceImageMap.set(source.id, combined)
  }

  const enrichedItems = items.map((item) => {
    const derivedUrls = item.sourceId
      ? collectInheritedImages(item.questionNumber, sourceImageMap.get(item.sourceId) || new Map<string, string[]>())
      : []

    const imageUrls: string[] = []
    pushUniqueUrl(imageUrls, item.imageUrl)
    for (const url of derivedUrls) pushUniqueUrl(imageUrls, url)

    return {
      ...item,
      imageUrl: imageUrls[0] || null,
      imageUrls,
      sourceTitle: item.sourceId ? (sourceTitleMap.get(item.sourceId) || null) : null,
      sourceUrl: item.sourceId ? (sourceUrlMap.get(item.sourceId) || null) : null,
    }
  })

  return res.status(200).json({ total, page, take, items: enrichedItems })
}
