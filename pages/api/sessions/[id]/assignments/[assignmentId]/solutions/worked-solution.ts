import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import path from 'path'
import { promises as fs } from 'fs'
import prisma from '../../../../../../../lib/prisma'
import { normalizeGradeInput } from '../../../../../../../lib/grades'

const MAX_QUESTION_ID_LENGTH = 80
const MAX_ASSIGNMENT_ID_LENGTH = 80
const MAX_INLINE_FILE_BYTES = 6 * 1024 * 1024

function clampText(value: unknown, maxLen: number) {
  if (typeof value !== 'string') return ''
  const t = value.trim()
  return t.length > maxLen ? t.slice(0, maxLen) : t
}

function guessMimeType(fileUrl: string, fallback?: string | null) {
  const hinted = (fallback || '').trim()
  if (hinted) return hinted
  const lower = (fileUrl || '').toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'application/octet-stream'
}

async function loadInlineFileFromUrl(fileUrl: string, contentTypeHint?: string | null) {
  const url = (fileUrl || '').trim()
  if (!url) return null

  if (url.startsWith('/')) {
    const fullPath = path.join(process.cwd(), 'public', url.replace(/^\/+/, ''))
    const buf = await fs.readFile(fullPath)
    if (!buf?.length) return null
    if (buf.length > MAX_INLINE_FILE_BYTES) return { tooLarge: true as const, mimeType: guessMimeType(url, contentTypeHint) }
    return { tooLarge: false as const, mimeType: guessMimeType(url, contentTypeHint), base64: buf.toString('base64') }
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    const resp = await fetch(url)
    if (!resp.ok) return null
    const arr = await resp.arrayBuffer()
    const buf = Buffer.from(arr)
    if (!buf?.length) return null
    if (buf.length > MAX_INLINE_FILE_BYTES) return { tooLarge: true as const, mimeType: guessMimeType(url, contentTypeHint) }
    return { tooLarge: false as const, mimeType: guessMimeType(url, contentTypeHint), base64: buf.toString('base64') }
  }

  return null
}

async function generateWithGemini(opts: { apiKey: string; model: string; text: string; inlineFile?: { mimeType: string; base64: string } | null }) {
  const { apiKey, model, text, inlineFile } = opts

  const sdkParts: any[] = [{ text }]
  if (inlineFile?.base64 && inlineFile?.mimeType) {
    sdkParts.push({ inlineData: { mimeType: inlineFile.mimeType, data: inlineFile.base64 } })
  }

  const restParts: any[] = [{ text }]
  if (inlineFile?.base64 && inlineFile?.mimeType) {
    restParts.push({ inline_data: { mime_type: inlineFile.mimeType, data: inlineFile.base64 } })
  }

  try {
    const mod: any = await import('@google/genai')
    const GoogleGenAI = mod?.GoogleGenAI
    if (typeof GoogleGenAI !== 'function') throw new Error('GoogleGenAI not available')

    const ai = new GoogleGenAI({ apiKey })
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: sdkParts }],
      config: {
        temperature: 0,
        topP: 0.1,
        maxOutputTokens: 2600,
      },
    } as any)

    const out = response?.text
    return typeof out === 'string' ? out.trim() : ''
  } catch (sdkErr: any) {
    const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: restParts }],
        generationConfig: {
          temperature: 0,
          topP: 0.1,
          maxOutputTokens: 2600,
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

  const role = (token as any)?.role as string | undefined
  const tokenGrade = normalizeGradeInput((token as any)?.grade as string | undefined)

  const sessionRecord = await prisma.sessionRecord.findUnique({
    where: { id: String(sessionIdParam) },
    select: { grade: true, id: true },
  })
  if (!sessionRecord) return res.status(404).json({ message: 'Session not found' })

  if (role === 'teacher') {
    if (!tokenGrade) return res.status(403).json({ message: 'Grade not configured for this account' })
    if (tokenGrade !== sessionRecord.grade) return res.status(403).json({ message: 'Access to this session is restricted to its grade' })
  } else if (role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden' })
  }

  const assignmentId = String(assignmentIdParam).trim().slice(0, MAX_ASSIGNMENT_ID_LENGTH)
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, sessionId: sessionRecord.id },
    select: { id: true },
  })
  if (!assignment) return res.status(404).json({ message: 'Assignment not found' })

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const { questionId, action, solutionText } = req.body || {}

  const safeQuestionId = (typeof questionId === 'string' && questionId.trim())
    ? questionId.trim().slice(0, MAX_QUESTION_ID_LENGTH)
    : ''
  if (!safeQuestionId) return res.status(400).json({ message: 'questionId is required' })

  const safeAction = typeof action === 'string' ? action : ''
  if (safeAction !== 'generate' && safeAction !== 'save') {
    return res.status(400).json({ message: 'action must be generate or save' })
  }

  const question = await prisma.assignmentQuestion.findFirst({
    where: { id: safeQuestionId, assignmentId },
    select: { id: true, latex: true, gradingPrompt: true },
  })
  if (!question) return res.status(404).json({ message: 'Question not found' })

  const assignmentSolution = (prisma as any).assignmentSolution as any

  const existing = await assignmentSolution.findUnique({
    where: { questionId: safeQuestionId },
    select: {
      id: true,
      questionId: true,
      latex: true,
      fileUrl: true,
      contentType: true,
      aiWorkedSolution: true,
      teacherWorkedSolution: true,
      aiMarkingPlan: true,
      teacherMarkingPlan: true,
    },
  })

  if (!existing) {
    return res.status(409).json({ message: 'Save a solution first (canvas and/or upload) before generating a worked solution.' })
  }

  if (safeAction === 'save') {
    const text = typeof solutionText === 'string' ? solutionText : ''
    const trimmed = text.trim()

    const updated = await assignmentSolution.update({
      where: { questionId: safeQuestionId },
      data: {
        teacherWorkedSolution: trimmed ? trimmed : null,
        createdBy: (token as any)?.email ? String((token as any).email) : null,
      },
    })

    return res.status(200).json({ ok: true, solution: updated })
  }

  const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim()
  if (!geminiApiKey) {
    return res.status(500).json({ message: 'Gemini is not configured (missing GEMINI_API_KEY)', providerUsed: 'gemini' })
  }

  const model = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'

  const teacherCanvasLatex = clampText(existing.latex || '', 16000)
  const solFileUrl = clampText(existing.fileUrl || '', 2000)
  const markingPlan = clampText((existing.teacherMarkingPlan || existing.aiMarkingPlan || ''), 12000)

  const inlineFile = solFileUrl ? await loadInlineFileFromUrl(solFileUrl, existing.contentType || null) : null

  const instruction =
    'You are an expert teacher. Produce a fully worked solution for the question.\n' +
    'Use ALL available info: (1) teacher canvas solution LaTeX, (2) uploaded PDF/image solution (if provided), and (3) your own math understanding.\n' +
    'Return plain text only. DO NOT use markdown code fences.\n' +
    'Write a complete, step-by-step solution. Prefer LaTeX math for equations.\n' +
    'Include the final answer clearly. If teacher solution is incomplete, fill in missing steps explicitly.'

  const prompt =
    `${instruction}\n\n` +
    `QuestionId: ${question.id}\n\n` +
    (markingPlan ? `TeacherMarkingPlan (authoritative rubric):\n${markingPlan}\n\n` : '') +
    `QuestionLatex:\n${clampText(question.latex || '', 20000)}\n\n` +
    `TeacherCanvasSolutionLatex:\n${teacherCanvasLatex || '(none)'}\n` +
    (solFileUrl ? `TeacherUploadedSolutionFileUrl: ${solFileUrl}\n` : '') +
    (inlineFile && (inlineFile as any).tooLarge ? 'TeacherUploadedSolutionFileInline: (omitted; file too large to attach inline)\n' : '')

  const worked = await generateWithGemini({
    apiKey: geminiApiKey,
    model,
    text: prompt,
    inlineFile: (inlineFile && !(inlineFile as any).tooLarge) ? (inlineFile as any) : null,
  })

  if (!worked) return res.status(500).json({ message: 'Gemini returned empty worked solution' })

  const updated = await assignmentSolution.update({
    where: { questionId: safeQuestionId },
    data: {
      aiWorkedSolution: worked,
      createdBy: (token as any)?.email ? String((token as any).email) : null,
    },
  })

  return res.status(200).json({ ok: true, solution: updated })
}
