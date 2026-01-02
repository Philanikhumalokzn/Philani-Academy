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

function closeTruncatedJson(text: string) {
  // If the model output is cut off mid-object/array, try to close any still-open
  // braces/brackets. This is conservative: it does NOT invent missing commas/quotes.
  const s = text || ''
  const closers: Array<'}' | ']'> = []
  let inString = false
  let escape = false

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]

    if (escape) {
      escape = false
      continue
    }

    if (ch === '\\' && inString) {
      escape = true
      continue
    }

    if (ch === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (ch === '{') closers.push('}')
    else if (ch === '[') closers.push(']')
    else if (ch === '}' || ch === ']') {
      const expected = closers[closers.length - 1]
      if (expected === ch) closers.pop()
    }
  }

  if (closers.length === 0) return s
  return s + closers.reverse().join('')
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
      const closed = closeTruncatedJson(repaired)
      try {
        return JSON.parse(closed)
      } catch (e3: any) {
        const msg = e3?.message || e2?.message || e1?.message || 'JSON parse error'
        throw new Error(`${msg}. Raw JSON excerpt: ${closed.slice(0, 300)}`)
      }
    }
  }
}

type GeminiResultItem = { questionId: string; correctness: 'correct' | 'incorrect' }

type GeminiStepItem = {
  step: number
  awardedMarks: number
  isCorrect: boolean
  feedback?: string
}

type GeminiMarksResultItem = {
  questionId: string
  earnedMarks: number
  totalMarks?: number
  correctness?: 'correct' | 'incorrect'
  steps?: GeminiStepItem[]
}

function clampInt(value: unknown, min: number, max: number) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return min
  const i = Math.trunc(n)
  if (i < min) return min
  if (i > max) return max
  return i
}

function splitLatexIntoSteps(latex: string) {
  const raw = (latex || '').replace(/\r\n/g, '\n').trim()
  if (!raw) return []

  // Treat LaTeX line breaks as steps. This is intentionally simple and stable.
  const withNewlines = raw.replace(/\\\\/g, '\n')
  const steps = withNewlines
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)

  // Keep prompts bounded.
  return steps.slice(0, 30)
}

function normalizeCorrectness(value: unknown): 'correct' | 'incorrect' | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  if (v === 'correct') return 'correct'
  if (v === 'incorrect') return 'incorrect'
  return null
}

async function generateWithGemini(opts: { apiKey: string; model: string; content: string }) {
  const { apiKey, model, content } = opts

  // Scale output tokens a bit with prompt size to reduce truncation.
  const approxChars = content.length
  const maxOutputTokens = Math.max(1600, Math.min(7000, 1600 + Math.floor(approxChars / 40)))

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
        maxOutputTokens,
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
          maxOutputTokens,
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

  const studentStepsByQ = new Map<string, string[]>()
  for (const q of assignment.questions || []) {
    const qId = String(q.id)
    const studentLatex = clampText(responseByQ.get(qId) || '', MAX_TEXT)
    studentStepsByQ.set(qId, splitLatexIntoSteps(studentLatex))
  }

  const solByQ = new Map<string, { latex: string; fileUrl: string; aiMarkingPlan: string; teacherMarkingPlan: string; aiWorkedSolution: string; teacherWorkedSolution: string }>()
  for (const s of solutions) {
    solByQ.set(String(s.questionId), {
      latex: String((s as any).latex || ''),
      fileUrl: String((s as any).fileUrl || ''),
      aiMarkingPlan: String((s as any).aiMarkingPlan || ''),
      teacherMarkingPlan: String((s as any).teacherMarkingPlan || ''),
      aiWorkedSolution: String((s as any).aiWorkedSolution || ''),
      teacherWorkedSolution: String((s as any).teacherWorkedSolution || ''),
    })
  }

  const questionBlocks = (assignment.questions || []).map((q: any) => {
    const qId = String(q.id)
    const maxPoints = (typeof q.points === 'number' && Number.isFinite(q.points) && q.points > 0) ? Math.trunc(q.points) : 1
    const studentLatex = clampText(responseByQ.get(qId) || '', MAX_TEXT)
    const studentSteps = studentStepsByQ.get(qId) || []
    const sol = solByQ.get(qId)
    const solLatex = clampText(sol?.latex || '', MAX_TEXT)
    const solFileUrl = clampText(sol?.fileUrl || '', 2000)
    const markingPlan = clampText((sol?.teacherMarkingPlan || sol?.aiMarkingPlan || ''), 12000)
    const workedSolution = clampText((sol?.teacherWorkedSolution || sol?.aiWorkedSolution || ''), 16000)
    const prompt = clampText((q as any)?.gradingPrompt || '', 4000)

    return (
      `QuestionId: ${qId}\n` +
      `MaxPoints: ${maxPoints}\n` +
      `StudentStepCount: ${studentSteps.length}\n` +
      (studentSteps.length ? `StudentSteps (1-indexed):\n${studentSteps.map((s, i) => `${i + 1}: ${clampText(s, 800)}`).join('\n')}\n` : '') +
      (prompt ? `TeacherPrompt:\n${prompt}\n` : '') +
      (markingPlan ? `TeacherMarkingPlan:\n${markingPlan}\n` : '') +
      (workedSolution ? `TeacherWorkedSolution:\n${workedSolution}\n` : '') +
      `QuestionLatex:\n${clampText(String(q.latex || ''), MAX_TEXT)}\n\n` +
      `TeacherSolutionLatex:\n${solLatex || '(none)'}\n` +
      (solFileUrl ? `TeacherSolutionFileUrl: ${solFileUrl}\n` : '') +
      `StudentAnswerLatex:\n${studentLatex || '(empty)'}\n`
    )
  }).join('\n---\n')

  const assignmentPrompt = clampText((assignment as any)?.gradingPrompt || '', 8000)

  const instruction =
    'You are a strict auto-grader. Return ONLY valid JSON (RFC 8259). No markdown, no commentary, no trailing commas. ' +
    'If TeacherMarkingPlan is present, treat it as the authoritative rubric (source of truth). ' +
    'If TeacherWorkedSolution is present, treat it as authoritative solution context. ' +
    'Award method marks per step based on TeacherPrompt / TeacherMarkingPlan and MaxPoints. ' +
    'Use StudentSteps as the ONLY step references (1-indexed) and return a steps[] entry for EVERY step 1..StudentStepCount. ' +
    'awardedMarks must be an integer >=0; the sum of awardedMarks across steps must be <= MaxPoints and should reflect earnedMarks. ' +
    'Set earnedMarks as an integer 0..MaxPoints representing the total marks earned for that question. ' +
    'Be concise to save compute: for incorrect steps, feedback must be short (<=120 chars) and either a brief reason or the corrected step. ' +
    'Output schema EXACTLY:\n' +
    '{"results":[{"questionId":"...","earnedMarks":0,"steps":[{"step":1,"awardedMarks":0,"isCorrect":false,"feedback":"..."}]}]}'

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
    const normalized: GeminiMarksResultItem[] = []

    for (const q of assignment.questions || []) {
      const qId = String(q.id)
      const maxPoints = (typeof q.points === 'number' && Number.isFinite(q.points) && q.points > 0) ? Math.trunc(q.points) : 1
      const stepCount = (studentStepsByQ.get(qId) || []).length

      const found: any = resultsArr.find(r => String(r?.questionId || '') === qId)

      const stepsArr: any[] = Array.isArray(found?.steps)
        ? found.steps
        : (Array.isArray(found?.stepFeedback) ? found.stepFeedback : [])

      let remaining = maxPoints
      let sumAwarded = 0
      const steps: GeminiStepItem[] = []
      for (let i = 1; i <= stepCount; i += 1) {
        const item = stepsArr.find(s => Number(s?.step ?? s?.index ?? s?.stepIndex ?? 0) === i)
        const rawAward = item?.awardedMarks ?? item?.awarded ?? item?.marks ?? 0
        const awardedMarks = clampInt(rawAward, 0, remaining)
        remaining -= awardedMarks
        sumAwarded += awardedMarks

        const isCorrect = (typeof item?.isCorrect === 'boolean') ? Boolean(item.isCorrect) : (awardedMarks > 0)
        const feedback = clampText(item?.feedback ?? item?.note ?? item?.why ?? item?.correctStep ?? '', 200)
        steps.push({ step: i, awardedMarks, isCorrect, feedback: feedback || undefined })
      }

      // Prefer step marks as the source of truth for earnedMarks when present.
      const earnedMarks = (stepCount > 0 && Array.isArray(stepsArr) && stepsArr.length > 0)
        ? clampInt(sumAwarded, 0, maxPoints)
        : clampInt(found?.earnedMarks, 0, maxPoints)

      const correctness: 'correct' | 'incorrect' = earnedMarks >= maxPoints ? 'correct' : 'incorrect'

      normalized.push({
        questionId: qId,
        earnedMarks,
        totalMarks: maxPoints,
        correctness,
        steps,
      })
    }

    const totalPoints = (assignment.questions || []).reduce((sum: number, q: any) => {
      const maxPoints = (typeof q.points === 'number' && Number.isFinite(q.points) && q.points > 0) ? Math.trunc(q.points) : 1
      return sum + maxPoints
    }, 0)

    const earnedPoints = (assignment.questions || []).reduce((sum: number, q: any) => {
      const qId = String(q.id)
      const maxPoints = (typeof q.points === 'number' && Number.isFinite(q.points) && q.points > 0) ? Math.trunc(q.points) : 1
      const earned = normalized.find(r => r.questionId === qId)?.earnedMarks
      return sum + clampInt(earned, 0, maxPoints)
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
