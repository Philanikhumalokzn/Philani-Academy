import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'
import { tryParseJsonLoose } from '../../../lib/geminiAssignmentExtract'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '64kb',
    },
  },
}

const VALID_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const VALID_TOPICS = [
  'Algebra', 'Functions', 'Number Patterns', 'Finance', 'Trigonometry',
  'Euclidean Geometry', 'Analytical Geometry', 'Statistics', 'Probability',
  'Calculus', 'Sequences and Series', 'Polynomials', 'Other',
]

function questionDepthFromNumber(qNum: string): number {
  const parts = (qNum || '').split('.')
  return Math.max(0, parts.length - 1)
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end('Method not allowed')
  }

  const token = await getToken({ req })
  const role = ((token as any)?.role as string | undefined) || 'student'
  if (role !== 'admin') {
    return res.status(403).json({ message: 'Admin only' })
  }

  const { resourceId, year, month, paper } = req.body as {
    resourceId?: string
    year?: number
    month?: string
    paper?: number
  }

  if (!resourceId || typeof resourceId !== 'string') {
    return res.status(400).json({ message: 'resourceId is required' })
  }
  if (!year || typeof year !== 'number' || year < 2000 || year > 2100) {
    return res.status(400).json({ message: 'Valid year (2000-2100) is required' })
  }
  if (!month || !VALID_MONTHS.includes(month)) {
    return res.status(400).json({ message: `month must be one of: ${VALID_MONTHS.join(', ')}` })
  }
  if (!paper || (paper !== 1 && paper !== 2 && paper !== 3)) {
    return res.status(400).json({ message: 'paper must be 1, 2, or 3' })
  }

  // Fetch the resource
  const resource = await prisma.resourceBankItem.findUnique({
    where: { id: resourceId },
    select: { id: true, grade: true, title: true, parsedJson: true, parsedAt: true },
  })

  if (!resource) {
    return res.status(404).json({ message: 'Resource not found' })
  }
  if (!resource.parsedJson) {
    return res.status(400).json({ message: 'Resource has not been parsed yet. Parse it first using Mathpix OCR.' })
  }

  const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim()
  const geminiModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'
  if (!geminiApiKey) {
    return res.status(500).json({ message: 'Gemini is not configured (missing GEMINI_API_KEY)' })
  }

  const parsed = resource.parsedJson as any
  const rawText = (typeof parsed?.text === 'string' ? parsed.text : '').trim()
  const gradeLabel = String(resource.grade).replace('_', ' ').replace('GRADE ', 'Grade ')

  const prompt =
    `You are a South African National Senior Certificate (NSC) Mathematics exam parser.\n` +
    `You are given OCR text from a ${gradeLabel} Mathematics Paper ${paper} exam (${month} ${year}).\n\n` +
    `Extract every question and sub-question as a JSON array. Rules:\n` +
    `- questionNumber: the dot-notation number exactly as it appears (e.g. "1", "1.1", "1.1.2")\n` +
    `- questionText: the full question text, preserving wording exactly\n` +
    `- latex: any mathematical expression in valid LaTeX (or empty string if none)\n` +
    `- marks: the mark allocation as an integer if shown in brackets (e.g. "(3)" → 3), else null\n` +
    `- topic: one of: ${VALID_TOPICS.join(', ')}\n` +
    `- cognitiveLevel: integer 1-4 where 1=Knowledge, 2=Routine procedures, 3=Complex procedures, 4=Problem-solving\n\n` +
    `Return ONLY a valid JSON array of objects with keys: questionNumber, questionText, latex, marks, topic, cognitiveLevel\n` +
    `Do not include preamble, instructions, or any text outside the JSON array.\n\n` +
    `OCR TEXT (may be imperfect):\n${rawText.slice(0, 20000)}`

  let geminiResult: any[]
  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            topP: 0.1,
            maxOutputTokens: 8000,
            responseMimeType: 'application/json',
          },
        }),
      },
    )

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => '')
      return res.status(502).json({ message: `Gemini error (${geminiRes.status}): ${errText.slice(0, 500)}` })
    }

    const geminiData: any = await geminiRes.json().catch(() => null)
    const rawOutput = geminiData?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('') ?? ''
    const parsed = tryParseJsonLoose(typeof rawOutput === 'string' ? rawOutput : '')

    if (!Array.isArray(parsed)) {
      return res.status(502).json({ message: 'Gemini returned non-array output — could not extract questions', raw: rawOutput?.slice(0, 1000) })
    }

    geminiResult = parsed
  } catch (err: any) {
    return res.status(500).json({ message: err?.message || 'Gemini extraction failed' })
  }

  // Normalise and write to DB
  const gradeEnum = resource.grade

  const created: string[] = []
  const skipped: number[] = []

  for (let i = 0; i < geminiResult.length; i++) {
    const item = geminiResult[i]
    if (!item || typeof item !== 'object') { skipped.push(i); continue }

    const qNum = (typeof item.questionNumber === 'string' ? item.questionNumber : String(item.questionNumber || '')).trim()
    const qText = (typeof item.questionText === 'string' ? item.questionText : '').trim()

    if (!qNum || !qText) { skipped.push(i); continue }

    const latex = typeof item.latex === 'string' ? item.latex.trim() : null
    const marks = typeof item.marks === 'number' && Number.isFinite(item.marks) ? Math.round(item.marks) : null
    const topic = VALID_TOPICS.includes(item.topic) ? item.topic : null
    const cl = typeof item.cognitiveLevel === 'number' ? Math.min(4, Math.max(1, Math.round(item.cognitiveLevel))) : null
    const depth = questionDepthFromNumber(qNum)

    try {
      const eq = await prisma.examQuestion.create({
        data: {
          sourceId: resource.id,
          grade: gradeEnum,
          year,
          month,
          paper,
          questionNumber: qNum,
          questionDepth: depth,
          topic: topic || null,
          cognitiveLevel: cl,
          marks,
          questionText: qText,
          latex: latex || null,
          approved: false,
        },
        select: { id: true },
      })
      created.push(eq.id)
    } catch {
      skipped.push(i)
    }
  }

  return res.status(200).json({
    message: `Extracted ${created.length} question(s). ${skipped.length} skipped.`,
    created: created.length,
    skipped: skipped.length,
    ids: created,
  })
}
