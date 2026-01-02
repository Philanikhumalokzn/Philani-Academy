import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../../../../lib/prisma'
import { normalizeGradeInput } from '../../../../../../../lib/grades'

const MAX_QUESTION_ID_LENGTH = 80
const MAX_ASSIGNMENT_ID_LENGTH = 80

function clampText(value: unknown, maxLen: number) {
  if (typeof value !== 'string') return ''
  const t = value.trim()
  return t.length > maxLen ? t.slice(0, maxLen) : t
}

async function generateWithGemini(opts: { apiKey: string; model: string; content: string }) {
  const { apiKey, model, content } = opts

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

  const { questionId, action, planText } = req.body || {}

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

  const existing = await prisma.assignmentSolution.findUnique({
    where: { questionId: safeQuestionId },
    select: {
      id: true,
      questionId: true,
      latex: true,
      fileUrl: true,
      aiMarkingPlan: true,
      teacherMarkingPlan: true,
    },
  })

  if (!existing) {
    return res.status(409).json({ message: 'Save a solution first (canvas and/or upload) before generating a marking plan.' })
  }

  if (safeAction === 'save') {
    const text = typeof planText === 'string' ? planText : ''
    const trimmed = text.trim()

    const updated = await prisma.assignmentSolution.update({
      where: { questionId: safeQuestionId },
      data: {
        teacherMarkingPlan: trimmed ? trimmed : null,
        createdBy: (token as any)?.email ? String((token as any).email) : null,
      },
    })

    return res.status(200).json({ ok: true, solution: updated })
  }

  // generate
  const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim()
  if (!geminiApiKey) {
    return res.status(500).json({ message: 'Gemini is not configured (missing GEMINI_API_KEY)', providerUsed: 'gemini' })
  }

  const model = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'

  const solLatex = clampText(existing.latex || '', 20000)
  const solFileUrl = clampText(existing.fileUrl || '', 2000)
  if (!solLatex && !solFileUrl) {
    return res.status(409).json({ message: 'No solution content found (save canvas solution or upload a file first).' })
  }

  const teacherPrompt = clampText(question.gradingPrompt || '', 4000)

  const instruction =
    'You are an expert teacher. Create a clear marking plan/rubric for grading this question.\n' +
    'Return plain text only (no JSON, no markdown code fences).\n' +
    'Include: expected method/steps, final answer expectations, common mistakes, and how to award marks.\n' +
    'Be specific and strict, but fair.'

  const content =
    `${instruction}\n\n` +
    `QuestionId: ${question.id}\n` +
    (teacherPrompt ? `TeacherGradingPrompt:\n${teacherPrompt}\n\n` : '') +
    `QuestionLatex:\n${clampText(question.latex || '', 20000)}\n\n` +
    `TeacherSolutionLatex:\n${solLatex || '(none)'}\n` +
    (solFileUrl ? `TeacherSolutionFileUrl: ${solFileUrl}\n` : '')

  const plan = await generateWithGemini({ apiKey: geminiApiKey, model, content })
  if (!plan) return res.status(500).json({ message: 'Gemini returned empty marking plan' })

  const updated = await prisma.assignmentSolution.update({
    where: { questionId: safeQuestionId },
    data: {
      aiMarkingPlan: plan,
      createdBy: (token as any)?.email ? String((token as any).email) : null,
    },
  })

  return res.status(200).json({ ok: true, solution: updated })
}
