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
  let s = (text || '')

  // Trailing commas before a closer
  s = s.replace(/,\s*([}\]])/g, '$1')

  // Missing values after a colon. Example: {"earnedMarks":}]}
  // Insert a placeholder so JSON.parse can succeed; downstream normalization will clamp defaults.
  s = s.replace(/:\s*(?=[}\]])/g, ': null')
  s = s.replace(/:\s*(?=,)/g, ': null')
  s = s.replace(/:\s*$/g, ': null')

  return s
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

function getBestEffortJsonCandidate(rawText: string) {
  const extracted = stripJsonNoise(extractJsonObject(rawText))
  if (!extracted) return ''
  const repaired = repairCommonJsonIssues(extracted)
  return closeTruncatedJson(repaired)
}

type GeminiResultItem = { questionId: string; correctness: 'correct' | 'incorrect' }

type GeminiStepItem = {
  step: number
  awardedMarks: number
  isCorrect: boolean
  isSignificant?: boolean
  feedback?: string
}

type GeminiMarksResultItem = {
  questionId: string
  earnedMarks: number
  totalMarks?: number
  correctness?: 'correct' | 'incorrect'
  steps?: GeminiStepItem[]
}

function extractTotalMarksFromText(text: string) {
  const t = (text || '').toLowerCase()
  if (!t.trim()) return null

  // Common patterns: "(3 marks)", "3 marks", "out of 3", "/3".
  const candidates: number[] = []
  const markRe = /\b(\d{1,3})\s*(?:marks?|pts?|points?)\b/g
  for (const m of t.matchAll(markRe)) {
    const n = Number(m[1])
    if (Number.isFinite(n)) candidates.push(Math.trunc(n))
  }

  const outOfRe = /\bout\s+of\s+(\d{1,3})\b/g
  for (const m of t.matchAll(outOfRe)) {
    const n = Number(m[1])
    if (Number.isFinite(n)) candidates.push(Math.trunc(n))
  }

  const slashRe = /\/(\d{1,3})\b/g
  for (const m of t.matchAll(slashRe)) {
    const n = Number(m[1])
    if (Number.isFinite(n)) candidates.push(Math.trunc(n))
  }

  const best = candidates.filter(n => n > 0 && n <= 100)
  if (!best.length) return null
  return Math.max(...best)
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

  // Output length:
  // - Default: scale with prompt size to reduce truncation.
  // - Override: GEMINI_MAX_OUTPUT_TOKENS (can be set very high; we'll allow up to 1,000,000).
  // Note: If the chosen value is not supported by the API/model, we retry with a smaller fallback.
  const approxChars = content.length
  const computedDefault = Math.max(1600, 1600 + Math.floor(approxChars / 35))
  const envMaxRaw = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || '')
  const envMax = Number.isFinite(envMaxRaw) && envMaxRaw > 0 ? Math.trunc(envMaxRaw) : null
  const initialMaxOutputTokens = Math.max(1, Math.min(1_000_000, envMax ?? computedDefault))

  const shouldRetryTokenLimit = (message: string) => {
    const m = (message || '').toLowerCase()
    return m.includes('maxoutputtokens') || m.includes('max output tokens') || m.includes('invalid argument')
  }

  const tryOnce = async (maxOutputTokens: number) => {
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

  try {
    return await tryOnce(initialMaxOutputTokens)
  } catch (err: any) {
    const msg = String(err?.message || err || '')
    // If the API rejects a huge maxOutputTokens, retry with a conservative fallback.
    if (initialMaxOutputTokens > 8192 && shouldRetryTokenLimit(msg)) {
      return await tryOnce(8192)
    }
    throw err
  }
}

async function validateAndFixJsonWithGemini(opts: {
  apiKey: string
  model: string
  candidateJson: string
  questionIds: string[]
  stepCountsByQuestionId: Record<string, number>
}) {
  const { apiKey, model, candidateJson, questionIds, stepCountsByQuestionId } = opts

  const boundedCandidate = clampText(candidateJson, 12000)
  const boundedQuestionIds = questionIds.slice(0, 200)

  const fixerInstruction =
    'You are a JSON validator/fixer. Output ONLY valid JSON (RFC 8259). No markdown, no commentary. ' +
    'Use double quotes for all keys/strings. Do not include trailing commas. ' +
    'Return an object with exactly one key: "results" (an array). ' +
    'The "results" array MUST contain exactly one entry per questionId in the provided list, in the same order. ' +
    'Each entry MUST have keys in this exact order: questionId, totalMarks, earnedMarks, steps. ' +
    'steps MUST be an array with exactly stepCount entries (stepCount provided per questionId). ' +
    'Each step entry MUST have keys in this exact order: step, awardedMarks, isCorrect, isSignificant, feedback. ' +
    'If a value is missing/invalid, fill a safe default: totalMarks>=1 int, earnedMarks>=0 int, awardedMarks>=0 int, isCorrect boolean, isSignificant boolean, feedback string ("" allowed). ' +
    'Never omit required keys.'

  const schemaExample =
    '{"results":[{"questionId":"...","totalMarks":1,"earnedMarks":0,"steps":[{"step":1,"awardedMarks":0,"isCorrect":false,"isSignificant":true,"feedback":""}]}]}'

  const fixerPrompt =
    `${fixerInstruction}\n\n` +
    `RequiredQuestionIds (ordered):\n${boundedQuestionIds.map(id => `- ${id}`).join('\n')}\n\n` +
    `StepCountsByQuestionId (integers):\n${JSON.stringify(stepCountsByQuestionId)}\n\n` +
    `SchemaExample:\n${schemaExample}\n\n` +
    `CandidateJsonToFix:\n${boundedCandidate}\n`

  const raw = await generateWithGemini({ apiKey, model, content: fixerPrompt })
  return typeof raw === 'string' ? raw.trim() : ''
}

async function bounceJsonUntilValid(opts: {
  apiKey: string
  model: string
  initialCandidate: string
  questionIds: string[]
  stepCountsByQuestionId: Record<string, number>
  maxAttempts?: number
}) {
  const { apiKey, model, initialCandidate, questionIds, stepCountsByQuestionId } = opts
  const maxAttempts = Math.max(2, Math.min(6, opts.maxAttempts ?? 4))

  let candidate = clampText(initialCandidate, 12000)
  let lastFixed = ''
  let lastErr: any = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastFixed = await validateAndFixJsonWithGemini({
      apiKey,
      model,
      candidateJson: candidate,
      questionIds,
      stepCountsByQuestionId,
    })

    if (!lastFixed) {
      lastErr = new Error(`Gemini JSON validation pass returned empty output (attempt ${attempt}/${maxAttempts})`)
      // Try again using the last candidate (already repaired/closed).
      continue
    }

    try {
      return parseGeminiJsonStrict(lastFixed)
    } catch (err: any) {
      lastErr = err
      // Locally repair the fixer output (strip noise, remove trailing commas, fill missing values, close truncation)
      // and send it back again. This is format-only; no re-grading context is included.
      candidate = getBestEffortJsonCandidate(lastFixed) || clampText(lastFixed, 12000)
    }
  }

  const excerpt = clampText(lastFixed || candidate, 300)
  const msg = lastErr?.message || 'JSON parse error'
  throw new Error(`${msg}. Raw JSON excerpt: ${excerpt}`)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractFirstInt(text: string, key: string) {
  const re = new RegExp(`${escapeRegExp(key)}\\s*"?\\s*:\\s*(-?\\d+)`, 'i')
  const m = String(text || '').match(re)
  if (!m?.[1]) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function extractFirstBool(text: string, key: string) {
  const re = new RegExp(`${escapeRegExp(key)}\\s*"?\\s*:\\s*(true|false)`, 'i')
  const m = String(text || '').match(re)
  if (!m?.[1]) return null
  return m[1].toLowerCase() === 'true'
}

function extractFirstString(text: string, key: string) {
  // Prefer quoted strings; if missing, return null.
  const s = String(text || '')
  const reDouble = new RegExp(`${escapeRegExp(key)}\\s*"?\\s*:\\s*"([^"\\r\\n]*)`, 'i')
  const m1 = s.match(reDouble)
  if (m1?.[1] != null) return m1[1]
  const reSingle = new RegExp(`${escapeRegExp(key)}\\s*"?\\s*:\\s*'([^'\\r\\n]*)`, 'i')
  const m2 = s.match(reSingle)
  if (m2?.[1] != null) return m2[1]
  return null
}

function buildResponseTemplate(questionIds: string[], stepCountsByQuestionId: Record<string, number>) {
  const results = questionIds.map(questionId => {
    const stepCount = Math.max(0, Math.min(50, Math.trunc(Number(stepCountsByQuestionId[questionId] ?? 0))))
    return {
      questionId,
      totalMarks: 1,
      earnedMarks: 0,
      steps: Array.from({ length: stepCount }, (_, idx) => ({
        step: idx + 1,
        awardedMarks: 0,
        isCorrect: false,
        isSignificant: true,
        feedback: '',
      })),
    }
  })
  return JSON.stringify({ results }, null, 2)
}

function extractQuestionBlocks(rawText: string) {
  const s = String(rawText || '')
  const re = /questionId\s*"?\s*:\s*"?([a-z0-9_-]{6,})"?/gi
  const matches: Array<{ index: number; id: string }> = []
  for (const m of s.matchAll(re)) {
    if (typeof m.index === 'number' && m[1]) matches.push({ index: m.index, id: String(m[1]) })
  }
  return matches.sort((a, b) => a.index - b.index)
}

function getQuestionIdsMentionedInText(rawText: string) {
  const blocks = extractQuestionBlocks(rawText)
  const set = new Set<string>()
  for (const b of blocks) set.add(String(b.id))
  return set
}

function extractQuestionSegment(rawText: string, qId: string, blocks: Array<{ index: number; id: string }>) {
  const s = String(rawText || '')
  const hitIndex = blocks.findIndex(b => b.id === qId)
  if (hitIndex < 0) return ''
  const start = blocks[hitIndex].index
  const end = (hitIndex + 1 < blocks.length) ? blocks[hitIndex + 1].index : s.length
  return s.slice(start, end)
}

function extractStepSlice(questionSegment: string, stepNumber: number) {
  const s = String(questionSegment || '')
  const reThis = new RegExp(`step\\s*"?\\s*:\\s*${stepNumber}\\b`, 'i')
  const m = s.match(reThis)
  if (!m || m.index == null) return ''
  const start = m.index
  const reNext = new RegExp(`step\\s*"?\\s*:\\s*${stepNumber + 1}\\b`, 'i')
  const tail = s.slice(start + 1)
  const mNext = tail.match(reNext)
  const end = mNext && mNext.index != null ? start + 1 + mNext.index : Math.min(s.length, start + 900)
  return s.slice(start, end)
}

function extractGeminiResultsFromText(rawText: string, questionIds: string[], stepCountsByQuestionId: Record<string, number>) {
  const blocks = extractQuestionBlocks(rawText)
  const results: Array<{ questionId: string; totalMarks?: number; earnedMarks?: number; steps?: any[]; hasStepSignals?: boolean }> = []

  for (const qId of questionIds) {
    const seg = extractQuestionSegment(rawText, qId, blocks)
    const totalMarks = extractFirstInt(seg, 'totalMarks')
    const earnedMarks = extractFirstInt(seg, 'earnedMarks')

    const stepCount = Math.max(0, Math.min(50, Math.trunc(Number(stepCountsByQuestionId[qId] ?? 0))))
    const steps: any[] = []
    let hasStepSignals = false
    for (let step = 1; step <= stepCount; step += 1) {
      const stepSlice = extractStepSlice(seg, step)
      const awardedMarks = extractFirstInt(stepSlice, 'awardedMarks')
      const isCorrect = extractFirstBool(stepSlice, 'isCorrect')
      const isSignificant = extractFirstBool(stepSlice, 'isSignificant')
      const feedback = extractFirstString(stepSlice, 'feedback')

      if (awardedMarks != null || isCorrect != null || isSignificant != null || feedback != null) {
        hasStepSignals = true
      }
      steps.push({
        step,
        awardedMarks: awardedMarks == null ? 0 : awardedMarks,
        isCorrect: isCorrect == null ? (awardedMarks != null && awardedMarks > 0) : isCorrect,
        isSignificant: isSignificant == null ? undefined : isSignificant,
        feedback: feedback == null ? '' : feedback,
      })
    }

    results.push({
      questionId: qId,
      totalMarks: totalMarks == null ? undefined : totalMarks,
      earnedMarks: earnedMarks == null ? undefined : earnedMarks,
      steps,
      hasStepSignals,
    })
  }

  return results
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

  const debugEnabled = (role === 'admin' || role === 'teacher') && (
    req.query.debug === '1' || req.query.debug === 'true' || req.headers['x-debug'] === '1'
  )

  const forceRegrade = (role === 'admin') && (
    req.query.force === '1' || req.query.force === 'true' || req.headers['x-force-regrade'] === '1'
  )

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

  if (existing && !forceRegrade) {
    return res.status(200).json({
      graded: true,
      grade: existing,
    })
  }

  if (existing && forceRegrade) {
    // Unique per assignment+user, so delete the existing record before re-creating.
    await (prisma as any).assignmentGrade.deleteMany({
      where: { sessionId: sessionRecord.id, assignmentId: String(assignmentIdParam), userId: String(targetUserId) },
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

  const orderedQuestionIds = (assignment.questions || []).map((q: any) => String(q.id))
  const stepCountsByQuestionId: Record<string, number> = {}
  for (const qId of orderedQuestionIds) stepCountsByQuestionId[qId] = (studentStepsByQ.get(qId) || []).length

  const questionBlockById = new Map<string, string>()
  for (const q of (assignment.questions || [])) {
    const qId = String((q as any)?.id || '')
    if (!qId) continue
    const configuredPoints = (typeof (q as any).points === 'number' && Number.isFinite((q as any).points) && (q as any).points > 0) ? Math.trunc((q as any).points) : null
    const studentLatex = clampText(responseByQ.get(qId) || '', MAX_TEXT)
    const studentSteps = studentStepsByQ.get(qId) || []
    const sol = solByQ.get(qId)
    const solLatex = clampText(sol?.latex || '', MAX_TEXT)
    const solFileUrl = clampText(sol?.fileUrl || '', 2000)
    const markingPlan = clampText((sol?.teacherMarkingPlan || sol?.aiMarkingPlan || ''), 12000)
    const workedSolution = clampText((sol?.teacherWorkedSolution || sol?.aiWorkedSolution || ''), 16000)
    const prompt = clampText((q as any)?.gradingPrompt || '', 4000)

    const block = (
      `QuestionId: ${qId}\n` +
      `ConfiguredPoints: ${configuredPoints == null ? '(none)' : configuredPoints}\n` +
      `StudentStepCount: ${studentSteps.length}\n` +
      (studentSteps.length ? `StudentSteps (1-indexed):\n${studentSteps.map((s, i) => `${i + 1}: ${clampText(s, 800)}`).join('\n')}\n` : '') +
      (prompt ? `TeacherPrompt:\n${prompt}\n` : '') +
      (markingPlan ? `TeacherMarkingPlan:\n${markingPlan}\n` : '') +
      (workedSolution ? `TeacherWorkedSolution:\n${workedSolution}\n` : '') +
      `QuestionLatex:\n${clampText(String((q as any).latex || ''), MAX_TEXT)}\n\n` +
      `TeacherSolutionLatex:\n${solLatex || '(none)'}\n` +
      (solFileUrl ? `TeacherSolutionFileUrl: ${solFileUrl}\n` : '') +
      `StudentAnswerLatex:\n${studentLatex || '(empty)'}\n`
    )
    questionBlockById.set(qId, block)
  }

  const questionBlocks = orderedQuestionIds
    .map(qid => questionBlockById.get(String(qid)) || '')
    .filter(Boolean)
    .join('\n---\n')

  const assignmentPrompt = clampText((assignment as any)?.gradingPrompt || '', 8000)

  const responseTemplate = clampText(buildResponseTemplate(orderedQuestionIds, stepCountsByQuestionId), 12000)

  const instruction =
    'You are a strict auto-grader. Return ONLY a JSON object in the EXACT template provided (same keys/order). ' +
    'Do NOT add any extra keys. Do NOT add markdown. Do NOT add commentary. ' +
    'If you cannot decide a value, use 0 / false / "" but keep the template valid. ' +
    'If TeacherMarkingPlan is present, treat it as the authoritative rubric (source of truth). ' +
    'If TeacherWorkedSolution is present, treat it as authoritative solution context. ' +
    'Award method marks per step based on TeacherPrompt / TeacherMarkingPlan and totalMarks. ' +
    'Use StudentSteps as the ONLY step references (1-indexed) and return a steps[] entry for EVERY step 1..StudentStepCount. ' +
    'Each step MUST include isSignificant (boolean): significant=true only if that step would affect marks under the marking scheme; significant=false for steps that would not contribute marks. ' +
    'If a step is incorrect but insignificant, set awardedMarks=0, isCorrect=false, isSignificant=false and include brief feedback. ' +
    'If a step is correct but insignificant, set awardedMarks=0, isCorrect=true, isSignificant=false and leave feedback empty unless truly necessary. ' +
    'You MUST set totalMarks for each question (integer >= 1). Infer it from TeacherPrompt / TeacherMarkingPlan when ConfiguredPoints is (none). ' +
    'awardedMarks must be an integer >=0; the sum of awardedMarks across steps must be <= totalMarks and should reflect earnedMarks. ' +
    'Set earnedMarks as an integer 0..totalMarks representing the total marks earned for that question. ' +
    'Be concise to save compute: for incorrect steps, feedback must be short (<=120 chars) and either a brief reason or the corrected step. ' +
    'Output MUST be parseable JSON. Do not use trailing commas.'

  const content =
    `${instruction}\n\n` +
    `JSON_TEMPLATE_TO_FILL (return exactly this structure, only change values):\n${responseTemplate}\n\n` +
    `AssignmentId: ${assignment.id}\n` +
    `StudentUserId: ${targetUserId}\n\n` +
    (assignmentPrompt ? `AssignmentMasterPrompt:\n${assignmentPrompt}\n\n` : '') +
    `Questions:\n${questionBlocks}\n`

  try {
    let raw = await generateWithGemini({ apiKey: geminiApiKey, model, content })
    if (!raw) return res.status(500).json({ message: 'Gemini returned empty grading JSON' })

    // If Gemini output is truncated / missing questionIds, re-ask once for ONLY the missing questions.
    const mentioned = getQuestionIdsMentionedInText(raw)
    const missing = orderedQuestionIds.filter(qid => !mentioned.has(String(qid)))
    if (missing.length > 0) {
      const retryStepCounts: Record<string, number> = {}
      for (const qid of missing) retryStepCounts[String(qid)] = stepCountsByQuestionId[String(qid)] ?? 0
      const retryTemplate = clampText(buildResponseTemplate(missing, retryStepCounts), 12000)
      const retryBlocks = missing
        .map(qid => questionBlockById.get(String(qid)) || '')
        .filter(Boolean)
        .join('\n---\n')

      const retryInstruction =
        instruction +
        ` You are grading ONLY these questionIds (in order): ${missing.join(', ')}.`

      const retryContent =
        `${retryInstruction}\n\n` +
        `JSON_TEMPLATE_TO_FILL (return exactly this structure, only change values):\n${retryTemplate}\n\n` +
        `AssignmentId: ${assignment.id}\n` +
        `StudentUserId: ${targetUserId}\n\n` +
        (assignmentPrompt ? `AssignmentMasterPrompt:\n${assignmentPrompt}\n\n` : '') +
        `Questions:\n${retryBlocks}\n`

      const retryRaw = await generateWithGemini({ apiKey: geminiApiKey, model, content: retryContent })
      if (retryRaw) {
        raw = `${raw}\n\n---RETRY_FOR_MISSING_QUESTIONS---\n\n${retryRaw}`
      }
    }

    const rawToStore = clampText(raw, 50000)

    // Deterministic parsing: treat Gemini output as text and extract only the fields we need.
    // This avoids depending on JSON.parse of potentially malformed JSON.
    const resultsArr: any[] = extractGeminiResultsFromText(raw, orderedQuestionIds, stepCountsByQuestionId)
    const normalized: GeminiMarksResultItem[] = []

    for (const q of assignment.questions || []) {
      const qId = String(q.id)
      const configuredPoints = (typeof q.points === 'number' && Number.isFinite(q.points) && q.points > 0) ? Math.trunc(q.points) : null
      const stepCount = (studentStepsByQ.get(qId) || []).length

      const found: any = resultsArr.find(r => String(r?.questionId || '') === qId)

      const sol = solByQ.get(qId)
      const teacherPrompt = clampText((q as any)?.gradingPrompt || '', 8000)
      const teacherPlan = clampText((sol?.teacherMarkingPlan || sol?.aiMarkingPlan || ''), 12000)
      const inferredFromText = extractTotalMarksFromText(`${teacherPrompt}\n${teacherPlan}`)
      const inferredFromModel = clampInt(found?.totalMarks, 1, 100)
      const resolvedTotalMarks = configuredPoints != null
        ? configuredPoints
        : Math.max(1, inferredFromText || 1, inferredFromModel || 1)

      const stepsArr: any[] = Array.isArray(found?.steps)
        ? found.steps
        : (Array.isArray(found?.stepFeedback) ? found.stepFeedback : [])

      let remaining = resolvedTotalMarks
      let sumAwarded = 0
      const steps: GeminiStepItem[] = []
      for (let i = 1; i <= stepCount; i += 1) {
        const item = stepsArr.find(s => Number(s?.step ?? s?.index ?? s?.stepIndex ?? 0) === i)
        const rawAward = item?.awardedMarks ?? item?.awarded ?? item?.marks ?? 0
        const awardedMarks = clampInt(rawAward, 0, remaining)
        remaining -= awardedMarks
        sumAwarded += awardedMarks

        const isCorrect = (typeof item?.isCorrect === 'boolean') ? Boolean(item.isCorrect) : (awardedMarks > 0)
        const isSignificant = (typeof item?.isSignificant === 'boolean') ? Boolean(item.isSignificant) : (!isCorrect)
        const feedback = clampText(item?.feedback ?? item?.note ?? item?.why ?? item?.correctStep ?? '', 200)
        steps.push({ step: i, awardedMarks, isCorrect, isSignificant, feedback: feedback || undefined })
      }

      // Prefer step marks as the source of truth for earnedMarks ONLY when the model actually
      // provided step fields. The deterministic extractor always builds a steps[] array (default
      // zeros), so we must not treat that as evidence of model-provided step marking.
      const modelProvidedStepMarks = Boolean(found?.hasStepSignals)
      const earnedMarks = (stepCount > 0 && modelProvidedStepMarks)
        ? clampInt(sumAwarded, 0, resolvedTotalMarks)
        : clampInt(found?.earnedMarks, 0, resolvedTotalMarks)

      if (debugEnabled) {
        console.info('[grading_debug]', {
          sessionId: sessionRecord.id,
          assignmentId: assignment.id,
          targetUserId,
          questionId: qId,
          stepCount,
          hasStepSignals: modelProvidedStepMarks,
          configuredPoints,
          inferredFromText,
          inferredFromModel: found?.totalMarks,
          resolvedTotalMarks,
          modelEarnedMarks: found?.earnedMarks,
          sumAwarded,
          computedEarnedMarks: earnedMarks,
        })
      }

      const correctness: 'correct' | 'incorrect' = earnedMarks >= resolvedTotalMarks ? 'correct' : 'incorrect'

      normalized.push({
        questionId: qId,
        earnedMarks,
        totalMarks: resolvedTotalMarks,
        correctness,
        steps,
      })
    }

    const totalPoints = normalized.reduce((sum: number, r) => sum + clampInt(r?.totalMarks, 1, 100), 0)

    const earnedPoints = normalized.reduce((sum: number, r) => {
      const total = clampInt(r?.totalMarks, 1, 100)
      return sum + clampInt(r?.earnedMarks, 0, total)
    }, 0)

    const percentage = totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : 0

    const created = await (prisma as any).assignmentGrade.create({
      data: {
        sessionId: sessionRecord.id,
        assignmentId: assignment.id,
        userId: String(targetUserId),
        results: normalized as any,
        rawGeminiOutput: rawToStore || null,
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
