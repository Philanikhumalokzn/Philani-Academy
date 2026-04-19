import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { tryParseJsonLoose } from '../../../lib/geminiAssignmentExtract'
import { normalizeExamQuestionContent } from '../../../lib/questionMath'
import {
  VALID_TOPICS,
  normalizeTopicLabel,
  getExtractProvider,
} from '../resources/extract-questions'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '64kb',
    },
  },
}

type AiScope = 'question' | 'root' | 'paper'

type RequestedFields = {
  questionText?: boolean
  latex?: boolean
  topic?: boolean
  cognitiveLevel?: boolean
  marks?: boolean
  tableMarkdown?: boolean
}

type QuestionSnapshot = {
  id: string
  grade: string
  year: number
  month: string
  paper: number
  sourceId: string | null
  questionNumber: string
  questionDepth: number
  topic: string | null
  cognitiveLevel: number | null
  marks: number | null
  questionText: string
  latex: string | null
  tableMarkdown: string | null
}

function normalizeTextValue(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || null
}

function normalizeQuestionNumber(value: unknown): string {
  return String(value || '').trim()
}

function questionRootFromNumber(value: unknown): string {
  const match = String(value || '').trim().match(/(\d+(?:\.\d+)*)/)
  const normalized = match?.[1] || ''
  return normalized ? normalized.split('.')[0] || normalized : ''
}

function escapeRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sliceMmdForRootQuestion(mmd: string, rootNumber: string): string {
  const lines = String(mmd || '').split(/\r?\n/)
  const startPattern = new RegExp(`(?:^|\\s)QUESTION\\s+${escapeRegExp(rootNumber)}\\b`, 'i')
  const nextQuestionPattern = /\bQUESTION\s+\d+\b/i

  let startIndex = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (startPattern.test(lines[index])) {
      startIndex = index
      break
    }
  }

  if (startIndex === -1) return String(mmd || '').slice(0, 8000)

  let endIndex = lines.length
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (nextQuestionPattern.test(lines[index])) {
      endIndex = index
      break
    }
  }

  return lines.slice(startIndex, endIndex).join('\n')
}

function sliceMmdForQuestion(mmd: string, questionNumber: string): string {
  const text = String(mmd || '')
  if (!text.trim()) return ''

  const normalizedQuestionNumber = normalizeQuestionNumber(questionNumber).replace(/^Q/i, '')
  const lines = text.split(/\r?\n/)
  const patterns = [
    new RegExp(`^\\s*${escapeRegExp(normalizedQuestionNumber)}\\b`),
    new RegExp(`^\\s*Q?${escapeRegExp(normalizedQuestionNumber)}\\b`, 'i'),
  ]

  let hitIndex = -1
  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || '')
    if (patterns.some((pattern) => pattern.test(line))) {
      hitIndex = index
      break
    }
  }

  if (hitIndex === -1) return sliceMmdForRootQuestion(text, questionRootFromNumber(questionNumber)).slice(0, 5000)

  const start = Math.max(0, hitIndex - 4)
  const end = Math.min(lines.length, hitIndex + 14)
  return lines.slice(start, end).join('\n')
}

function sanitizeRequestedFields(value: unknown): RequestedFields {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    questionText: raw.questionText !== false,
    latex: Boolean(raw.latex),
    topic: raw.topic !== false,
    cognitiveLevel: raw.cognitiveLevel !== false,
    marks: Boolean(raw.marks),
    tableMarkdown: Boolean(raw.tableMarkdown),
  }
}

function hasAnyRequestedField(fields: RequestedFields): boolean {
  return Object.values(fields).some(Boolean)
}

function normalizeCognitiveLevel(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.min(4, Math.max(1, Math.round(value)))
  const text = String(value ?? '').trim()
  if (!text) return null
  const match = text.match(/\b([1-4])\b/)
  if (!match?.[1]) return null
  return Math.min(4, Math.max(1, Number(match[1])))
}

function normalizeMarksValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value))
  const text = String(value ?? '').trim()
  if (!text) return null
  const match = text.match(/\d+/)
  return match?.[0] ? Math.max(0, Math.round(Number(match[0]))) : null
}

function buildCurrentSnapshot(question: QuestionSnapshot) {
  return {
    questionText: normalizeTextValue(question.questionText),
    latex: normalizeTextValue(question.latex),
    topic: normalizeTopicLabel(question.topic) || null,
    cognitiveLevel: typeof question.cognitiveLevel === 'number' ? Math.min(4, Math.max(1, Math.round(question.cognitiveLevel))) : null,
    marks: typeof question.marks === 'number' && Number.isFinite(question.marks) ? Math.max(0, Math.round(question.marks)) : null,
    tableMarkdown: normalizeTextValue(question.tableMarkdown),
  }
}

function sanitizeProposal(rawValue: unknown, requestedFields: RequestedFields) {
  const raw = rawValue && typeof rawValue === 'object' ? rawValue as Record<string, unknown> : {}
  const normalizedQuestion = normalizeExamQuestionContent(raw.questionText, raw.latex)

  return {
    questionText: requestedFields.questionText ? (normalizeTextValue(normalizedQuestion.questionText) || null) : null,
    latex: requestedFields.latex ? (normalizeTextValue(normalizedQuestion.latex) || null) : null,
    topic: requestedFields.topic ? (normalizeTopicLabel(raw.topic) || null) : null,
    cognitiveLevel: requestedFields.cognitiveLevel ? normalizeCognitiveLevel(raw.cognitiveLevel) : null,
    marks: requestedFields.marks ? normalizeMarksValue(raw.marks) : null,
    tableMarkdown: requestedFields.tableMarkdown ? (normalizeTextValue(raw.tableMarkdown) || null) : null,
    rationale: normalizeTextValue(raw.rationale) || null,
  }
}

function hasProposalChanges(current: ReturnType<typeof buildCurrentSnapshot>, proposal: ReturnType<typeof sanitizeProposal>): boolean {
  return (
    (proposal.questionText !== null && proposal.questionText !== current.questionText)
    || (proposal.latex !== null && proposal.latex !== current.latex)
    || (proposal.topic !== null && proposal.topic !== current.topic)
    || (proposal.cognitiveLevel !== null && proposal.cognitiveLevel !== current.cognitiveLevel)
    || (proposal.marks !== null && proposal.marks !== current.marks)
    || (proposal.tableMarkdown !== null && proposal.tableMarkdown !== current.tableMarkdown)
  )
}

function buildPrompt(question: QuestionSnapshot, scope: AiScope, requestedFields: RequestedFields, contextPreview: string, customInstructions: string, customContext: string): string {
  const requestedFieldNames = Object.entries(requestedFields)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([key]) => key)

  return [
    'You are assisting an admin who is editing a South African NSC Mathematics exam question record.',
    'Return ONLY valid JSON matching this exact shape:',
    '{"proposal":{"questionText":string|null,"latex":string|null,"topic":string|null,"cognitiveLevel":number|null,"marks":number|null,"tableMarkdown":string|null,"rationale":string}}',
    '',
    `Requested scope: ${scope}`,
    `Requested fields to propose: ${requestedFieldNames.join(', ') || 'none'}`,
    'For any field that was NOT requested, return null.',
    `Topic must be exactly one of: ${VALID_TOPICS.join(', ')}.`,
    'cognitiveLevel must be an integer 1-4 or null.',
    'marks must be an integer or null.',
    'Do not invent tables if none are visible in the context.',
    'Preserve the intended mathematics and South African exam phrasing.',
    '',
    'Current stored record:',
    JSON.stringify({
      grade: question.grade,
      year: question.year,
      month: question.month,
      paper: question.paper,
      questionNumber: question.questionNumber,
      topic: question.topic,
      cognitiveLevel: question.cognitiveLevel,
      marks: question.marks,
      questionText: question.questionText,
      latex: question.latex,
      tableMarkdown: question.tableMarkdown,
    }, null, 2),
    '',
    'Source context:',
    contextPreview || '(No source MMD context available; rely on current stored record and custom instructions.)',
    '',
    customContext.trim() ? `Admin supplied extra context:\n${customContext.trim()}` : 'Admin supplied extra context: none',
    customInstructions.trim() ? `Custom instructions:\n${customInstructions.trim()}` : 'Custom instructions: none',
    '',
    'Return only the JSON object.',
  ].join('\n')
}

async function runOpenAiJsonPrompt(apiKey: string, model: string, prompt: string) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'exam_question_edit_assist',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              proposal: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  questionText: { type: ['string', 'null'] },
                  latex: { type: ['string', 'null'] },
                  topic: { type: ['string', 'null'] },
                  cognitiveLevel: { type: ['integer', 'null'] },
                  marks: { type: ['integer', 'null'] },
                  tableMarkdown: { type: ['string', 'null'] },
                  rationale: { type: 'string' },
                },
                required: ['questionText', 'latex', 'topic', 'cognitiveLevel', 'marks', 'tableMarkdown', 'rationale'],
              },
            },
            required: ['proposal'],
          },
        },
      },
      messages: [
        {
          role: 'system',
          content: 'You are a precise exam-question editing assistant. Return only JSON that matches the provided schema.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`OpenAI error (${response.status}): ${text.slice(0, 500)}`)
  }

  const data: any = await response.json().catch(() => null)
  const rawOutput = data?.choices?.[0]?.message?.content ?? ''
  const parsed = tryParseJsonLoose(typeof rawOutput === 'string' ? rawOutput : '')
  return { parsed, rawOutput: String(rawOutput || '') }
}

async function runGeminiJsonPrompt(apiKey: string, model: string, prompt: string) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          topP: 0.1,
          maxOutputTokens: 4096,
        },
      }),
    },
  )

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Gemini error (${response.status}): ${text.slice(0, 500)}`)
  }

  const data: any = await response.json().catch(() => null)
  const rawOutput = data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text).filter(Boolean).join('') ?? ''
  const parsed = tryParseJsonLoose(typeof rawOutput === 'string' ? rawOutput : '')
  return { parsed, rawOutput: String(rawOutput || '') }
}

async function runAiProposalPrompt(prompt: string) {
  const provider = getExtractProvider()
  const openAiApiKey = (process.env.OPENAI_API_KEY || '').trim()
  const openAiModel = (process.env.OPENAI_MODEL || 'gpt-4.1-mini').trim() || 'gpt-4.1-mini'
  const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim()
  const geminiModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'

  const attempts: Array<'openai' | 'gemini'> = provider === 'openai'
    ? ['openai']
    : provider === 'gemini'
      ? ['gemini']
      : ['gemini', 'openai']

  let lastError: Error | null = null

  for (const candidate of attempts) {
    try {
      if (candidate === 'openai') {
        if (!openAiApiKey) throw new Error('OpenAI provider selected but OPENAI_API_KEY is missing')
        const result = await runOpenAiJsonPrompt(openAiApiKey, openAiModel, prompt)
        return { providerUsed: 'openai', ...result }
      }

      if (!geminiApiKey) throw new Error('Gemini provider selected but GEMINI_API_KEY is missing')
      const result = await runGeminiJsonPrompt(geminiApiKey, geminiModel, prompt)
      return { providerUsed: 'gemini', ...result }
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error || 'Unknown AI error'))
    }
  }

  throw lastError || new Error('No AI provider is configured for question edit assistance.')
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req })
  const role = ((token as any)?.role as string | undefined) || 'student'
  if (!token) return res.status(401).json({ message: 'Unauthenticated' })
  if (role !== 'admin') return res.status(403).json({ message: 'Admin only' })
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const {
    questionId,
    scope,
    requestedFields,
    customInstructions,
    customContext,
  } = req.body as {
    questionId?: string
    scope?: AiScope
    requestedFields?: RequestedFields
    customInstructions?: string
    customContext?: string
  }

  if (!questionId || typeof questionId !== 'string') {
    return res.status(400).json({ message: 'questionId is required' })
  }

  const normalizedScope: AiScope = scope === 'root' || scope === 'paper' ? scope : 'question'
  const normalizedRequestedFields = sanitizeRequestedFields(requestedFields)
  if (!hasAnyRequestedField(normalizedRequestedFields)) {
    return res.status(400).json({ message: 'Select at least one field for AI assistance.' })
  }

  const question = await prisma.examQuestion.findUnique({
    where: { id: questionId },
    select: {
      id: true,
      grade: true,
      year: true,
      month: true,
      paper: true,
      sourceId: true,
      questionNumber: true,
      questionDepth: true,
      topic: true,
      cognitiveLevel: true,
      marks: true,
      questionText: true,
      latex: true,
      tableMarkdown: true,
    },
  }) as QuestionSnapshot | null

  if (!question) return res.status(404).json({ message: 'Question not found' })

  const source = question.sourceId
    ? await prisma.resourceBankItem.findUnique({
        where: { id: question.sourceId },
        select: { parsedJson: true },
      })
    : null

  const rawMmd = typeof (source?.parsedJson as any)?.raw?.mmd === 'string'
    ? String((source?.parsedJson as any).raw.mmd)
    : ''

  const rootNumber = questionRootFromNumber(question.questionNumber)
  const contextPreview = normalizedScope === 'paper'
    ? rawMmd.slice(0, 12000)
    : normalizedScope === 'root'
      ? sliceMmdForRootQuestion(rawMmd, rootNumber).slice(0, 8000)
      : sliceMmdForQuestion(rawMmd, question.questionNumber).slice(0, 5000)

  const prompt = buildPrompt(
    question,
    normalizedScope,
    normalizedRequestedFields,
    contextPreview,
    typeof customInstructions === 'string' ? customInstructions : '',
    typeof customContext === 'string' ? customContext : '',
  )

  try {
    const { providerUsed, parsed, rawOutput } = await runAiProposalPrompt(prompt)
    const proposalRoot = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).proposal ?? parsed : null
    const current = buildCurrentSnapshot(question)
    const proposed = sanitizeProposal(proposalRoot, normalizedRequestedFields)
    const hasChanges = hasProposalChanges(current, proposed)

    return res.status(200).json({
      provider: providerUsed,
      scope: normalizedScope,
      requestedFields: normalizedRequestedFields,
      current,
      proposed,
      hasChanges,
      contextPreview: contextPreview || null,
      rawOutput: rawOutput.slice(0, 6000),
    })
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || 'AI edit assistance failed' })
  }
}