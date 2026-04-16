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

function coerceGeminiQuestionsArray(value: unknown): any[] | null {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  const candidates = [record.questions, record.items, record.results, record.data]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }

  return null
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
  let currentSub = ''

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim()
    if (!line) continue

    const topSectionMatch = line.match(/\\section\*\{\s*QUESTION\s+(\d+)\s*\}/i)
      || line.match(/^QUESTION\s+(\d+)\b/i)
    if (topSectionMatch?.[1]) {
      currentTop = topSectionMatch[1]
      currentSub = ''
    }

    const numberedMatch = line.match(/^((?:\d+)(?:\.\d+){1,5})\b/)
    if (numberedMatch?.[1]) {
      const candidate = numberedMatch[1]
      if (!currentTop || candidate === currentTop || candidate.startsWith(`${currentTop}.`)) {
        currentSub = candidate
      }
    }

    const imageMatches = line.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)
    for (const match of imageMatches) {
      const url = String(match?.[1] || '').trim()
      if (!url) continue

      if (currentSub) {
        push(currentSub, url)
      } else if (currentTop) {
        push(currentTop, url)
      }
    }
  }

  return map
}

function pickQuestionImageUrl(qNum: string, imageMap: Map<string, string[]>): string | null {
  const direct = imageMap.get(qNum)
  if (direct?.length) return direct[0]

  const parts = qNum.split('.').filter(Boolean)
  for (let i = parts.length - 1; i > 0; i -= 1) {
    const parent = parts.slice(0, i).join('.')
    const inherited = imageMap.get(parent)
    if (inherited?.length) return inherited[0]
  }

  return null
}

function salvageJsonObjectsArray(text: string): any[] | null {
  const source = String(text || '')
  if (!source) return null

  const items: any[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const ch = source[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{') {
      if (depth === 0) start = index
      depth += 1
      continue
    }

    if (ch === '}') {
      if (depth > 0) depth -= 1
      if (depth === 0 && start >= 0) {
        const slice = source.slice(start, index + 1)
        try {
          items.push(JSON.parse(slice))
        } catch {
          // Skip malformed object slices.
        }
        start = -1
      }
    }
  }

  return items.length ? items : null
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

type ExtractProvider = 'openai' | 'gemini' | 'auto'

function getExtractProvider(): ExtractProvider {
  const value = String(process.env.EXTRACT_PROVIDER || 'gemini').trim().toLowerCase()
  if (value === 'openai' || value === 'gemini' || value === 'auto') return value
  return 'gemini'
}

async function extractQuestionsWithOpenAI(opts: {
  apiKey: string
  model: string
  prompt: string
}): Promise<any[]> {
  const { apiKey, model, prompt } = opts
  let lastError = ''

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const openAiRes = await fetch('https://api.openai.com/v1/chat/completions', {
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
            name: 'exam_question_extraction',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                questions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      questionNumber: { type: 'string' },
                      questionText: { type: 'string' },
                      latex: { type: 'string' },
                      marks: { type: ['integer', 'null'] },
                      topic: { type: 'string' },
                      cognitiveLevel: { type: ['integer', 'null'] },
                    },
                    required: ['questionNumber', 'questionText', 'latex', 'marks', 'topic', 'cognitiveLevel'],
                  },
                },
              },
              required: ['questions'],
            },
          },
        },
        messages: [
          {
            role: 'system',
            content:
              'You are a South African NSC Mathematics exam parser. Return only JSON matching the provided schema. Do not add commentary.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    })

    if (openAiRes.ok) {
      const openAiData: any = await openAiRes.json().catch(() => null)
      const rawOutput = openAiData?.choices?.[0]?.message?.content ?? ''
      const parsed = tryParseJsonLoose(typeof rawOutput === 'string' ? rawOutput : '')
      const extractedQuestions = coerceGeminiQuestionsArray(parsed) || salvageJsonObjectsArray(String(rawOutput || ''))
      if (extractedQuestions) return extractedQuestions

      const parsedType = Array.isArray(parsed) ? 'array' : typeof parsed
      const parsedKeys = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? Object.keys(parsed as Record<string, unknown>).slice(0, 20)
        : []
      const rawPreview = String(rawOutput || '').replace(/\s+/g, ' ').trim().slice(0, 1200)
      throw new Error(
        `OpenAI returned non-array output — could not extract questions; parsedType=${parsedType}; parsedKeys=${parsedKeys.join(',')}; raw=${rawPreview}`,
      )
    }

    lastError = await openAiRes.text().catch(() => '')
    if (openAiRes.status !== 429 && openAiRes.status !== 503) {
      throw new Error(`OpenAI error (${openAiRes.status}): ${lastError.slice(0, 500)}`)
    }

    if (attempt < 3) {
      await sleep(1500 * (attempt + 1))
    }
  }

  throw new Error(`OpenAI error: ${lastError.slice(0, 500) || 'No response after retries'}`)
}

async function extractQuestionsWithGeminiApi(opts: {
  apiKey: string
  model: string
  prompt: string
}): Promise<any[]> {
  const { apiKey, model, prompt } = opts
  let geminiData: any = null
  let geminiErr = ''

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            topP: 0.1,
            maxOutputTokens: 8000,
          },
        }),
      },
    )

    if (geminiRes.ok) {
      geminiData = await geminiRes.json().catch(() => null)
      geminiErr = ''
      break
    }

    geminiErr = await geminiRes.text().catch(() => '')
    if (geminiRes.status !== 429 && geminiRes.status !== 503) {
      throw new Error(`Gemini error (${geminiRes.status}): ${geminiErr.slice(0, 500)}`)
    }

    if (attempt < 3) {
      await sleep(1500 * (attempt + 1))
    }
  }

  if (!geminiData) {
    throw new Error(`Gemini error: ${geminiErr.slice(0, 500) || 'No response after retries'}`)
  }

  const rawOutput = geminiData?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('') ?? ''
  const parsed = tryParseJsonLoose(typeof rawOutput === 'string' ? rawOutput : '')
  const extractedQuestions = coerceGeminiQuestionsArray(parsed) || salvageJsonObjectsArray(rawOutput)

  if (!extractedQuestions) {
    const parsedType = Array.isArray(parsed) ? 'array' : typeof parsed
    const parsedKeys = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.keys(parsed as Record<string, unknown>).slice(0, 20)
      : []
    const rawPreview = String(rawOutput || '').replace(/\s+/g, ' ').trim().slice(0, 1200)

    throw new Error(
      `Gemini returned non-array output — could not extract questions; parsedType=${parsedType}; parsedKeys=${parsedKeys.join(',')}; raw=${rawPreview}`,
    )
  }

  return extractedQuestions
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

  const provider = getExtractProvider()
  const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim()
  const geminiModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'
  const openAiApiKey = (process.env.OPENAI_API_KEY || '').trim()
  const openAiModel = (process.env.OPENAI_MODEL || 'gpt-4.1-mini').trim() || 'gpt-4.1-mini'

  const parsed = resource.parsedJson as any
  const rawText = (typeof parsed?.text === 'string' ? parsed.text : '').trim()
  const rawMmd = (typeof parsed?.raw?.mmd === 'string' ? parsed.raw.mmd : '').trim()
  const questionImageMap = buildQuestionImageMapFromMmd(rawMmd)
  const gradeLabel = String(resource.grade).replace('_', ' ').replace('GRADE ', 'Grade ')

  const prompt =
    `You are a South African National Senior Certificate (NSC) Mathematics exam parser.\n` +
    `You are given OCR text from a ${gradeLabel} Mathematics Paper ${paper} exam (${month} ${year}).\n\n` +
    `Extract every question and sub-question as a JSON array. Rules:\n` +
    `- questionNumber: the dot-notation number exactly as it appears (e.g. "1", "1.1", "1.1.2")\n` +
    `- questionText: the full question text. Where the question contains mathematical expressions, wrap each expression inline using $...$  KaTeX delimiters so the prose and math are unified in one readable string. Example: "Solve for x: $3x^{2}-5x-2=0$" or "Simplify $\\\\frac{a^2-b^2}{a-b}$". Do NOT leave math as bare undelimited text.\n` +
    `- latex: the PRIMARY mathematical expression for the question in valid LaTeX without outer $ delimiters (e.g. "3x^{2}-5x-2=0"). Leave empty string if questionText contains no math at all.\n` +
    `- marks: the mark allocation as an integer if shown in brackets (e.g. "(3)" → 3), else null\n` +
    `- topic: one of: ${VALID_TOPICS.join(', ')}\n` +
    `- cognitiveLevel: integer 1-4 where 1=Knowledge, 2=Routine procedures, 3=Complex procedures, 4=Problem-solving\n\n` +
    `Return ONLY a valid JSON array of objects with keys: questionNumber, questionText, latex, marks, topic, cognitiveLevel\n` +
    `Do not include preamble, instructions, or any text outside the JSON array.\n\n` +
    `OCR TEXT (may be imperfect):\n${rawText.slice(0, 20000)}`

  let geminiResult: any[]
  try {
    if (provider === 'openai') {
      if (!openAiApiKey) {
        return res.status(500).json({ message: 'OpenAI is not configured (missing OPENAI_API_KEY)' })
      }
      geminiResult = await extractQuestionsWithOpenAI({
        apiKey: openAiApiKey,
        model: openAiModel,
        prompt,
      })
    } else if (provider === 'auto') {
      if (openAiApiKey) {
        try {
          geminiResult = await extractQuestionsWithOpenAI({
            apiKey: openAiApiKey,
            model: openAiModel,
            prompt,
          })
        } catch (openAiErr: any) {
          if (!geminiApiKey) throw openAiErr
          geminiResult = await extractQuestionsWithGeminiApi({
            apiKey: geminiApiKey,
            model: geminiModel,
            prompt,
          })
        }
      } else {
        if (!geminiApiKey) {
          return res.status(500).json({ message: 'No extraction provider is configured (missing OPENAI_API_KEY and GEMINI_API_KEY)' })
        }
        geminiResult = await extractQuestionsWithGeminiApi({
          apiKey: geminiApiKey,
          model: geminiModel,
          prompt,
        })
      }
    } else {
      if (!geminiApiKey) {
        return res.status(500).json({ message: 'Gemini is not configured (missing GEMINI_API_KEY)' })
      }
      geminiResult = await extractQuestionsWithGeminiApi({
        apiKey: geminiApiKey,
        model: geminiModel,
        prompt,
      })
    }
  } catch (err: any) {
    return res.status(500).json({ message: err?.message || 'Question extraction failed' })
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
    const imageUrl = pickQuestionImageUrl(qNum, questionImageMap)

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
          imageUrl,
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
