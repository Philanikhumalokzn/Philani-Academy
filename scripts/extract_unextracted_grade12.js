const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

const VALID_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const VALID_TOPICS = [
  'Algebra', 'Functions', 'Number Patterns', 'Finance', 'Trigonometry',
  'Euclidean Geometry', 'Analytical Geometry', 'Statistics', 'Probability',
  'Calculus', 'Sequences and Series', 'Polynomials',
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function loadEnvIntoProcess() {
  const envFiles = ['.env.local', '.env']
  for (const envFile of envFiles) {
    const full = path.join(process.cwd(), envFile)
    if (!fs.existsSync(full)) continue
    const text = fs.readFileSync(full, 'utf8')
    for (const rawLine of text.split(/\r?\n/)) {
      const line = String(rawLine || '').trim()
      if (!line || line.startsWith('#')) continue
      const idx = line.indexOf('=')
      if (idx <= 0) continue
      const key = line.slice(0, idx).trim()
      let value = line.slice(idx + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = value
    }
  }
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim()
    if (!token.startsWith('--')) continue
    const eqIdx = token.indexOf('=')
    if (eqIdx > 2) {
      const key = token.slice(2, eqIdx)
      const value = token.slice(eqIdx + 1)
      out[key] = value || '1'
      continue
    }
    const key = token.slice(2)
    const next = argv[i + 1]
    if (!next || String(next).startsWith('--')) {
      out[key] = '1'
      continue
    }
    out[key] = String(next)
    i += 1
  }
  return out
}

function toBool(value, fallback = false) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return fallback
  return ['1', 'true', 'yes', 'on', 'y'].includes(raw)
}

function toInt(value, fallback = 0) {
  const n = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(n) ? n : fallback
}

function normalizeQuestionNumber(value) {
  return String(value == null ? '' : value).trim()
}

function normalizeQuestionText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
}

function normalizeLatex(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
}

function normalizeTopic(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const exact = VALID_TOPICS.find((topic) => topic.toLowerCase() === raw.toLowerCase())
  return exact || null
}

function normalizeMarks(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value))
  const m = String(value == null ? '' : value).trim().match(/\d+/)
  if (!m) return null
  const n = Number.parseInt(m[0], 10)
  return Number.isFinite(n) ? Math.max(0, n) : null
}

function questionDepthFromNumber(qNum) {
  const parts = String(qNum || '').split('.').filter(Boolean)
  return Math.max(0, parts.length - 1)
}

function findRootQuestionStarts(lines) {
  const starts = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '').trim()
    if (!line) continue

    const sectionMatch = line.match(/\\section\*\{\s*QUESTION\s+(\d+)\s*\}/i)
      || line.match(/^QUESTION\s+(\d+)\b/i)
    if (sectionMatch?.[1]) {
      starts.push({ root: sectionMatch[1], start: i })
      continue
    }

    // Fallback when headings are flattened: top-level numbering at line start.
    const topLevel = line.match(/^(\d{1,2})\s*[\.:)]\s+/)
    if (topLevel?.[1]) {
      starts.push({ root: topLevel[1], start: i })
    }
  }

  const unique = []
  const seenStarts = new Set()
  for (const s of starts) {
    const key = `${s.root}:${s.start}`
    if (seenStarts.has(key)) continue
    seenStarts.add(key)
    unique.push(s)
  }

  unique.sort((a, b) => a.start - b.start)
  return unique
}

function buildMmdExtractionChunks(mmd, maxChars = 11000) {
  const source = String(mmd || '').trim()
  if (!source) return []

  const lines = source.split(/\r?\n/)
  const starts = findRootQuestionStarts(lines)
  if (starts.length === 0) return [source.slice(0, 24000)]

  const sections = []
  for (let i = 0; i < starts.length; i += 1) {
    const s = starts[i]
    const end = i + 1 < starts.length ? starts[i + 1].start : lines.length
    const text = lines.slice(s.start, end).join('\n').trim()
    if (!text) continue
    sections.push({ root: s.root, text })
  }
  if (sections.length === 0) return [source.slice(0, 24000)]

  const chunks = []
  let current = ''
  for (const section of sections) {
    const sectionText = section.text
    if (!current) {
      if (sectionText.length > maxChars) {
        chunks.push(sectionText.slice(0, maxChars))
        continue
      }
      current = sectionText
      continue
    }

    if (current.length + 2 + sectionText.length <= maxChars) {
      current += `\n\n${sectionText}`
    } else {
      chunks.push(current)
      if (sectionText.length > maxChars) {
        chunks.push(sectionText.slice(0, maxChars))
        current = ''
      } else {
        current = sectionText
      }
    }
  }
  if (current) chunks.push(current)

  return chunks.length ? chunks : [source.slice(0, 24000)]
}

function inferYearMonthPaper(resource) {
  const title = String(resource?.title || '')
  const filename = String(resource?.filename || '')
  const parsed = resource?.parsedJson || {}
  const parsedText = String((typeof parsed?.raw?.mmd === 'string' ? parsed.raw.mmd : parsed?.text || '') || '')
  const merged = `${title} ${filename} ${parsedText.slice(0, 3000)}`
  const mergedLower = merged.toLowerCase()

  const compactDigits = merged.replace(/(?<=\d)\s+(?=\d)/g, '')
  const yearMatch = compactDigits.match(/\b(20\d{2}|19\d{2})\b/)
  const inferredYear = yearMatch ? Number(yearMatch[1]) : null

  let inferredMonth = null
  if (/\b(prelim|trial|september|sept|\bs\d{2}\b)\b/i.test(mergedLower)) inferredMonth = 'September'
  else if (/\b(june|jun|common\s*test|mid[-\s]?year)\b/i.test(mergedLower)) inferredMonth = 'June'
  else if (/\b(november|nov|final)\b/i.test(mergedLower)) inferredMonth = 'November'

  let inferredPaper = null
  const paperMatch = compactDigits.match(/\b(?:paper|p)\s*([123])\b/i)
  if (paperMatch?.[1]) inferredPaper = Number(paperMatch[1])

  return { inferredYear, inferredMonth, inferredPaper }
}

function coerceQuestionsArray(value) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return null
  const rec = value
  if (Array.isArray(rec.questions)) return rec.questions
  if (Array.isArray(rec.items)) return rec.items
  if (Array.isArray(rec.results)) return rec.results
  if (Array.isArray(rec.data)) return rec.data
  return null
}

function salvageJsonObjectsArray(text) {
  const source = String(text || '')
  if (!source) return null
  const items = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') { if (depth === 0) start = i; depth += 1; continue }
    if (ch === '}') {
      if (depth > 0) depth -= 1
      if (depth === 0 && start >= 0) {
        const chunk = source.slice(start, i + 1)
        try { items.push(JSON.parse(chunk)) } catch {}
        start = -1
      }
    }
  }
  return items.length ? items : null
}

function parseJsonLoose(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  try { return JSON.parse(raw) } catch {}
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fence && fence[1]) {
    try { return JSON.parse(fence[1]) } catch {}
  }
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start >= 0 && end > start) {
    const arr = raw.slice(start, end + 1)
    try { return JSON.parse(arr) } catch {}
  }
  const oStart = raw.indexOf('{')
  const oEnd = raw.lastIndexOf('}')
  if (oStart >= 0 && oEnd > oStart) {
    const obj = raw.slice(oStart, oEnd + 1)
    try { return JSON.parse(obj) } catch {}
  }
  return null
}

function isRetryableExtractError(error) {
  const msg = String(error?.message || error || '').toLowerCase()
  return (
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('authentication timed out') ||
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('temporarily unavailable')
  )
}

async function extractQuestionsWithGeminiRetry(opts) {
  let lastErr = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await extractQuestionsWithGemini(opts)
    } catch (err) {
      lastErr = err
      if (attempt >= 3 || !isRetryableExtractError(err)) throw err
      await sleep(1200 * attempt)
    }
  }
  throw lastErr
}

async function withTimeout(promise, ms, label) {
  let timeoutId = null
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

async function extractQuestionsWithGemini(opts) {
  const { apiKey, model, prompt } = opts
  const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`

  let responseData = null
  let lastErr = ''

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120000)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          topP: 0.1,
          maxOutputTokens: 8000,
        },
      }),
    }).finally(() => clearTimeout(timeout))

    if (res.ok) {
      responseData = await res.json().catch(() => null)
      break
    }

    lastErr = await res.text().catch(() => '')
    if (res.status !== 429 && res.status !== 503) {
      throw new Error(`Gemini error (${res.status}): ${lastErr.slice(0, 500)}`)
    }

    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
  }

  if (!responseData) {
    throw new Error(`Gemini error: ${lastErr.slice(0, 500) || 'No response after retries'}`)
  }

  const rawOutput = responseData?.candidates?.[0]?.content?.parts?.map((p) => p?.text).filter(Boolean).join('') || ''
  const parsed = parseJsonLoose(rawOutput)
  const fromParsed = coerceQuestionsArray(parsed)
  if (fromParsed) return fromParsed

  const salvaged = salvageJsonObjectsArray(rawOutput)
  if (salvaged) return salvaged

  throw new Error(`Gemini returned non-array output; raw=${String(rawOutput).replace(/\s+/g, ' ').slice(0, 1200)}`)
}

function buildPrompt(resource, year, month, paper, inputText) {
  const gradeLabel = String(resource.grade).replace('_', ' ').replace('GRADE ', 'Grade ')
  return (
    `You are a South African National Senior Certificate (NSC) Mathematics exam parser.\n` +
    `You are given OCR/Mathpix output from a ${gradeLabel} Mathematics Paper ${paper} exam (${month} ${year}).\n` +
    `The input uses Mathpix Markdown (MMD): math is already in LaTeX, and tables may appear as pipe tables.\n\n` +
    `Extract every question and sub-question as JSON array objects with keys: questionNumber, questionText, latex, marks, topic, cognitiveLevel, tableMarkdown.\n` +
    `Rules:\n` +
    `- questionNumber preserves dot notation exactly as seen (e.g. 1, 1.1, 1.2.1).\n` +
    `- questionText contains the full statement. Where math appears, wrap it inline as single-dollar only, e.g. $x^2-4=0$.\n` +
    `- Do NOT use $$...$$, \\(...\\), or \\[...\\] in questionText.\n` +
    `- latex contains the primary expression without outer $ delimiters, else empty string.\n` +
    `- marks integer when present else null.\n` +
    `- topic must be EXACTLY one of: ${VALID_TOPICS.join(', ')}\n` +
    `- all sub-questions under the same root must keep one consistent topic label.\n` +
    `- cognitiveLevel is REQUIRED for every question and must be integer 1..4.\n` +
    `- tableMarkdown must include full pipe-table markdown when a question/preamble includes a table; else null.\n` +
    `Return ONLY valid JSON array.\n\n` +
    `OCR/MMD INPUT:\n${inputText}`
  )
}

async function extractQuestionsForResource(opts) {
  const { resource, year, month, paper, rawMmd, rawText, apiKey, model } = opts
  const chunkSources = rawMmd
    ? buildMmdExtractionChunks(rawMmd, 11000)
    : [String(rawText || '').slice(0, 24000)]

  const chunks = chunkSources.filter((s) => String(s || '').trim())
  if (chunks.length === 0) return []

  const merged = []
  const seen = new Set()

  for (let c = 0; c < chunks.length; c += 1) {
    const chunk = chunks[c]
    const prompt = buildPrompt(resource, year, month, paper, chunk)
    const extracted = await withTimeout(
      extractQuestionsWithGeminiRetry({ apiKey, model, prompt }),
      720000,
      `extract ${resource.id} chunk ${c + 1}/${chunks.length}`,
    )

    for (const item of extracted) {
      if (!item || typeof item !== 'object') continue
      const qNum = normalizeQuestionNumber(item.questionNumber)
      const qText = normalizeQuestionText(item.questionText)
      const latex = normalizeLatex(item.latex)
      if (!qNum || !qText) continue
      const dedupeKey = `${qNum}::${qText}::${latex}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      merged.push(item)
    }
  }

  return merged
}

async function main() {
  loadEnvIntoProcess()
  const args = parseArgs(process.argv.slice(2))
  const dryRun = toBool(args.dryRun, false)
  const limit = Number.isFinite(Number.parseInt(String(args.limit || ''), 10)) ? Number.parseInt(String(args.limit), 10) : 0
  const maxExisting = Math.max(0, toInt(args.maxExisting, 0))
  const redoAll = toBool(args.redoAll, false)

  const dbUrl = String(process.env.DATABASE_URL || '').trim()
  if (!dbUrl) throw new Error('Missing DATABASE_URL')
  const geminiApiKey = String(process.env.GEMINI_API_KEY || '').trim()
  if (!geminiApiKey) throw new Error('Missing GEMINI_API_KEY')
  const geminiModel = String(process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'

  const pool = new Pool({ connectionString: dbUrl })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  const summary = {
    scanned: 0,
    processed: 0,
    resetResources: 0,
    deletedQuestions: 0,
    createdQuestions: 0,
    duplicateQuestionSkips: 0,
    skippedResources: 0,
    failedResources: 0,
    dryRun,
    failures: [],
  }

  try {
    const resourcesAll = await prisma.resourceBankItem.findMany({
      where: {
        grade: 'GRADE_12',
        parsedJson: { not: null },
      },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        title: true,
        filename: true,
        grade: true,
        parsedJson: true,
        year: true,
        sessionMonth: true,
        paper: true,
        sourceName: true,
        authorityScope: true,
        province: true,
        examCycle: true,
        assessmentType: true,
        assessmentFormality: true,
        paperMode: true,
        paperLabelRaw: true,
        examQuestions: {
          select: { id: true },
        },
      },
    })

    const resources = redoAll
      ? resourcesAll
      : resourcesAll.filter((resource) => {
      const existingCount = Array.isArray(resource.examQuestions) ? resource.examQuestions.length : 0
      if (maxExisting <= 0) return existingCount === 0
      return existingCount <= maxExisting
      })

    const queue = limit > 0 ? resources.slice(0, limit) : resources
    summary.scanned = queue.length

    for (let i = 0; i < queue.length; i += 1) {
      const resource = queue[i]
      const label = `${resource.title || resource.id} (${resource.id})`

      if (redoAll && !dryRun) {
        const deleted = await prisma.examQuestion.deleteMany({ where: { sourceId: resource.id } })
        summary.resetResources += 1
        summary.deletedQuestions += Number(deleted?.count || 0)
      }

      const { inferredYear, inferredMonth, inferredPaper } = inferYearMonthPaper(resource)
      const year = typeof resource.year === 'number' ? resource.year : (Number.isFinite(inferredYear) ? inferredYear : NaN)
      const month = String(resource.sessionMonth || inferredMonth || '').trim()
      const paper = typeof resource.paper === 'number' ? resource.paper : (Number.isFinite(inferredPaper) ? inferredPaper : null)
      if (!Number.isFinite(year) || year < 2000 || year > 2100 || !VALID_MONTHS.includes(month) || paper == null) {
        summary.skippedResources += 1
        console.log(`[${i + 1}/${queue.length}] skip metadata incomplete: ${label} -> year=${String(year)} month=${month || 'null'} paper=${String(paper)}`)
        continue
      }

      const parsed = resource.parsedJson || {}
      const rawText = (typeof parsed?.text === 'string' ? parsed.text : '').trim()
      const rawMmd = (typeof parsed?.raw?.mmd === 'string' ? parsed.raw.mmd : '').trim()
      const inputText = (rawMmd || rawText).slice(0, 24000)
      if (!inputText) {
        summary.skippedResources += 1
        console.log(`[${i + 1}/${queue.length}] skip empty parsed text: ${label}`)
        continue
      }

      try {
        console.log(`[${i + 1}/${queue.length}] extracting ${label} ...`)
        const extracted = await extractQuestionsForResource({
          resource,
          year,
          month,
          paper,
          rawMmd,
          rawText,
          apiKey: geminiApiKey,
          model: geminiModel,
        })

        let createdForResource = 0
        let duplicateForResource = 0

        for (let qIndex = 0; qIndex < extracted.length; qIndex += 1) {
          const item = extracted[qIndex]
          if (!item || typeof item !== 'object') continue

          const qNum = normalizeQuestionNumber(item.questionNumber)
          const qText = normalizeQuestionText(item.questionText)
          const latex = normalizeLatex(item.latex) || null
          if (!qNum || !qText) continue

          const marks = normalizeMarks(item.marks)
          const topic = normalizeTopic(item.topic) || VALID_TOPICS[0]
          const clRaw = typeof item.cognitiveLevel === 'number' ? Math.round(item.cognitiveLevel) : Number.parseInt(String(item.cognitiveLevel || ''), 10)
          const cognitiveLevel = Number.isFinite(clRaw) ? Math.max(1, Math.min(4, clRaw)) : null
          const tableMarkdown = typeof item.tableMarkdown === 'string' && item.tableMarkdown.trim() ? item.tableMarkdown.trim() : null
          const depth = questionDepthFromNumber(qNum)

          const existing = await prisma.examQuestion.findFirst({
            where: {
              sourceId: resource.id,
              grade: resource.grade,
              year,
              month,
              paper,
              questionNumber: qNum,
              questionText: qText,
              latex: latex || null,
            },
            select: { id: true },
          })
          if (existing) {
            duplicateForResource += 1
            continue
          }

          if (!dryRun) {
            await prisma.examQuestion.create({
              data: {
                sourceId: resource.id,
                grade: resource.grade,
                year,
                month,
                paper,
                paperMode: resource.paperMode || (paper === 1 ? 'P1' : paper === 2 ? 'P2' : paper === 3 ? 'P3' : 'COMBINED'),
                paperLabelRaw: resource.paperLabelRaw || null,
                sourceName: resource.sourceName || null,
                authorityScope: resource.authorityScope || null,
                province: resource.province || null,
                examCycle: resource.examCycle || null,
                assessmentType: resource.assessmentType || null,
                assessmentFormality: resource.assessmentFormality || null,
                questionNumber: qNum,
                questionDepth: depth,
                topic,
                cognitiveLevel,
                marks,
                questionText: qText,
                latex,
                tableMarkdown,
                approved: false,
              },
              select: { id: true },
            })
          }

          createdForResource += 1
        }

        summary.processed += 1
        summary.createdQuestions += createdForResource
        summary.duplicateQuestionSkips += duplicateForResource
        console.log(`[${i + 1}/${queue.length}] ok ${label} -> created ${createdForResource}, duplicates ${duplicateForResource}`)
      } catch (err) {
        summary.failedResources += 1
        const message = String(err?.message || err)
        summary.failures.push({ resourceId: resource.id, title: resource.title, error: message })
        console.log(`[${i + 1}/${queue.length}] failed ${label} -> ${message}`)
      }
    }

    console.log(JSON.stringify(summary, null, 2))
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
