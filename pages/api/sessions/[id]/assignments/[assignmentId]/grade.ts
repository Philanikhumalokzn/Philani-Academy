import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../../../lib/prisma'
import { normalizeGradeInput } from '../../../../../../lib/grades'

const MAX_TEXT = 20000

function clampText(value: unknown, maxLen: number) {
  if (typeof value !== 'string') return ''
  const t = value.trim()
  return t.length > maxLen ? t.slice(0, maxLen) : t
}

function extractJsonObject(text: string) {
  const raw = (text || '').trim()
  if (!raw) return ''

  // Handle ```json ... ``` wrappers
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenceMatch?.[1]) return fenceMatch[1].trim()

  // Fallback: take first { ... } block
  const first = raw.indexOf('{')
  const last = raw.lastIndexOf('}')
  if (first >= 0 && last > first) return raw.slice(first, last + 1).trim()
  return raw
}

function stripJsonNoise(text: string) {
  return (text || '')
    .replace(/^\uFEFF/, '')
    .trim()
}

function repairCommonJsonIssues(text: string) {
  // Fix common model mistakes: trailing commas before } or ]
  // Example: {"a":1,}  or  [1,2,]
  return (text || '').replace(/,\s*([}\]])/g, '$1')
}

function parseGeminiJsonStrict(rawText: string) {
  const extracted = stripJsonNoise(extractJsonObject(rawText))
  if (!extracted) throw new Error('Gemini returned empty JSON')

  try {
    return JSON.parse(extracted)
  } catch (e1: any) {
    const repaired = repairCommonJsonIssues(extracted)
    try {
      return JSON.parse(repaired)
    } catch (e2: any) {
      const msg = e2?.message || e1?.message || 'JSON parse error'
      throw new Error(`${msg}. Raw JSON excerpt: ${repaired.slice(0, 300)}`)
    }
  }
}

type GeminiResultItem = { questionId: string; correctness: 'correct' | 'incorrect' }

function normalizeCorrectness(value: unknown): 'correct' | 'incorrect' | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  if (v === 'correct') return 'correct'
  if (v === 'incorrect') return 'incorrect'
  return null
}

async function generateWithGemini(opts: { apiKey: string; model: string; content: string }) {
  const { apiKey, model, content } = opts

  // Prefer official SDK, with REST fallback (matches existing patterns in this repo).
  try {
    const mod: any = await import('@google/genai')
    const GoogleGenAI = mod?.GoogleGenAI
    if (typeof GoogleGenAI !== 'function') throw new Error('GoogleGenAI not available')

    const ai = new GoogleGenAI({ apiKey })
    const response = await ai.models.generateContent({
      model,
      contents: content,
      config: {
        temperature: 0,
        topP: 0.1,
        maxOutputTokens: 1400,
        responseMimeType: 'application/json',
      },
    } as any)

    const text = response?.text
    return typeof text === 'string' ? text.trim() : ''
  } catch (sdkErr: any) {
    const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: content }] }],
        generationConfig: {
          temperature: 0,
          topP: 0.1,
          maxOutputTokens: 1400,
          responseMimeType: 'application/json',
        },
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const detail = sdkErr?.message ? `; sdkErr=${sdkErr.message}` : ''
      throw new Error(`Gemini error (${res.status}): ${text}${detail}`)
    }

    const data: any = await res.json()
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('')
    return typeof text === 'string' ? text.trim() : ''
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sessionIdParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  const assignmentIdParam = Array.isArray((req.query as any).assignmentId) ? (req.query as any).assignmentId[0] : (req.query as any).assignmentId

  if (!sessionIdParam) return res.status(400).json({ message: 'Session id required' })
  if (!assignmentIdParam) return res.status(400).json({ message: 'Assignment id required' })

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = ((token as any)?.role as string | undefined) || ''
  const authUserId = ((token as any)?.id || (token as any)?.sub || '') as string
  const tokenGrade = normalizeGradeInput((token as any)?.grade as string | undefined)

  const sessionRecord = await prisma.sessionRecord.findUnique({
    where: { id: String(sessionIdParam) },
    select: { id: true, grade: true },
  })
  if (!sessionRecord) return res.status(404).json({ message: 'Session not found' })

  // Same access rules as other assignment routes.
  if (role === 'teacher' || role === 'student') {
    if (!tokenGrade) return res.status(403).json({ message: 'Grade not configured for this account' })
    if (tokenGrade !== sessionRecord.grade) return res.status(403).json({ message: 'Access to this session is restricted to its grade' })
  } else if (role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden' })
  }

  const requestedUserId = (typeof req.query.userId === 'string' ? req.query.userId : '')
  const targetUserId = role === 'student' ? authUserId : (requestedUserId || '')

  if (!targetUserId) {
    return res.status(400).json({ message: 'userId is required (teachers/admin). Students may omit userId.' })
  }

  // Students can only view their own grade.
  if (role === 'student' && targetUserId !== authUserId) {
    return res.status(403).json({ message: 'Forbidden' })
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  // Must be submitted before grading.
  const submission = await prisma.assignmentSubmission.findFirst({
    where: { sessionId: sessionRecord.id, assignmentId: String(assignmentIdParam), userId: String(targetUserId) },
    select: { submittedAt: true },
  })
  if (!submission) {
    return res.status(409).json({ message: 'Assignment not submitted yet' })
  }

  const existing = await prisma.assignmentGrade.findFirst({
    where: { sessionId: sessionRecord.id, assignmentId: String(assignmentIdParam), userId: String(targetUserId) },
  })

  if (existing) {
    return res.status(200).json({
      graded: true,
      grade: existing,
    })
  }

  const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim()
  if (!geminiApiKey) {
    return res.status(500).json({ message: 'Gemini is not configured (missing GEMINI_API_KEY)', providerUsed: 'gemini' })
  }

  const model = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'

  const assignment = await prisma.assignment.findFirst({
    where: { id: String(assignmentIdParam), sessionId: sessionRecord.id },
    include: {
      questions: { orderBy: { order: 'asc' } },
    },
  })
  if (!assignment) return res.status(404).json({ message: 'Assignment not found' })

  const responses = await prisma.assignmentResponse.findMany({
    where: { sessionId: sessionRecord.id, assignmentId: assignment.id, userId: String(targetUserId) },
  })

  const solutions = await prisma.assignmentSolution.findMany({
    where: { sessionId: sessionRecord.id, assignmentId: assignment.id },
  })

  const responseByQ = new Map<string, string>()
  for (const r of responses) responseByQ.set(String(r.questionId), String(r.latex || ''))

  const solByQ = new Map<string, { latex: string; fileUrl: string }>()
  for (const s of solutions) {
    solByQ.set(String(s.questionId), { latex: String(s.latex || ''), fileUrl: String(s.fileUrl || '') })
  }

  const questionBlocks = (assignment.questions || []).map((q: any) => {
    const qId = String(q.id)
    const maxPoints = (typeof q.points === 'number' && Number.isFinite(q.points) && q.points > 0) ? Math.trunc(q.points) : 1
    const studentLatex = clampText(responseByQ.get(qId) || '', MAX_TEXT)
    const sol = solByQ.get(qId)
    const solLatex = clampText(sol?.latex || '', MAX_TEXT)
    const solFileUrl = clampText(sol?.fileUrl || '', 2000)
    const prompt = clampText((q as any)?.gradingPrompt || '', 4000)

    return (
      `QuestionId: ${qId}\n` +
      `MaxPoints: ${maxPoints}\n` +
      (prompt ? `TeacherPrompt:\n${prompt}\n` : '') +
      `QuestionLatex:\n${clampText(String(q.latex || ''), MAX_TEXT)}\n\n` +
      `TeacherSolutionLatex:\n${solLatex || '(none)'}\n` +
      (solFileUrl ? `TeacherSolutionFileUrl: ${solFileUrl}\n` : '') +
      `StudentAnswerLatex:\n${studentLatex || '(empty)'}\n`
    )
  }).join('\n---\n')

  const assignmentPrompt = clampText((assignment as any)?.gradingPrompt || '', 8000)

  const instruction =
    'You are a strict auto-grader. Return ONLY valid JSON (RFC 8259). No markdown, no commentary, no trailing commas. ' +
    'Decide if each answer is exactly correct or incorrect compared to the teacher solution and prompts. ' +
    'Output schema EXACTLY:\n' +
    '{"results":[{"questionId":"...","correctness":"correct"|"incorrect"}]}'

  const content =
    `${instruction}\n\n` +
    `AssignmentId: ${assignment.id}\n` +
    `StudentUserId: ${targetUserId}\n\n` +
    (assignmentPrompt ? `AssignmentMasterPrompt:\n${assignmentPrompt}\n\n` : '') +
    `Questions:\n${questionBlocks}\n`

  try {
    const raw = await generateWithGemini({ apiKey: geminiApiKey, model, content })
    if (!raw) return res.status(500).json({ message: 'Gemini returned empty grading JSON' })

    const parsed: any = parseGeminiJsonStrict(raw)

    const resultsArr: any[] = Array.isArray(parsed?.results) ? parsed.results : []
    const normalized: GeminiResultItem[] = []

    for (const q of assignment.questions || []) {
      const qId = String(q.id)
      const found = resultsArr.find(r => String(r?.questionId || '') === qId)
      const correctness = normalizeCorrectness(found?.correctness)
      normalized.push({ questionId: qId, correctness: correctness || 'incorrect' })
    }

    const totalPoints = (assignment.questions || []).reduce((sum: number, q: any) => {
      const maxPoints = (typeof q.points === 'number' && Number.isFinite(q.points) && q.points > 0) ? Math.trunc(q.points) : 1
      return sum + maxPoints
    }, 0)

    const earnedPoints = (assignment.questions || []).reduce((sum: number, q: any) => {
      const qId = String(q.id)
      const maxPoints = (typeof q.points === 'number' && Number.isFinite(q.points) && q.points > 0) ? Math.trunc(q.points) : 1
      const verdict = normalized.find(r => r.questionId === qId)?.correctness
      return sum + (verdict === 'correct' ? maxPoints : 0)
    }, 0)

    const percentage = totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : 0

    const created = await prisma.assignmentGrade.create({
      data: {
        sessionId: sessionRecord.id,
        assignmentId: assignment.id,
        userId: String(targetUserId),
        results: normalized as any,
        earnedPoints,
        totalPoints,
        percentage,
        provider: 'gemini',
        model,
      },
    })

    return res.status(200).json({ graded: true, grade: created })
  } catch (err: any) {
    console.warn('Assignment grading failed', err?.message || err)
    return res.status(500).json({ message: 'Gemini grading failed', error: err?.message || err })
  }
}
