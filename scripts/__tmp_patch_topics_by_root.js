const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

const VALID_TOPICS = [
  'Algebra', 'Functions', 'Number Patterns', 'Finance', 'Trigonometry',
  'Euclidean Geometry', 'Analytical Geometry', 'Statistics', 'Probability',
  'Calculus', 'Sequences and Series', 'Polynomials',
]

function readArg(name, fallback = '') {
  const token = process.argv.find((arg) => arg.startsWith(`--${name}=`))
  return token ? token.slice(name.length + 3) : fallback
}

function readIntArg(name, fallback) {
  const value = Number(readArg(name, ''))
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback
}

function normalizeQuestionNumber(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const matches = [...text.matchAll(/(\d+(?:\.\d+)*)/g)].map((match) => match[1]).filter(Boolean)
  if (!matches.length) return ''
  return matches.sort((left, right) => {
    const depthDiff = right.split('.').length - left.split('.').length
    if (depthDiff !== 0) return depthDiff
    return right.length - left.length
  })[0] || ''
}

function compareQuestionNumbers(a, b) {
  const toParts = (v) => {
    const m = String(v || '').match(/(\d+(?:\.\d+)*)/)
    return m?.[1] ? m[1].split('.').map((p) => Number(p)).filter((n) => Number.isFinite(n)) : []
  }
  const pa = toParts(a)
  const pb = toParts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na - nb
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

function getAllowedTopicsForGrade(grade) {
  const text = String(grade || '').toUpperCase().trim()
  if (text === 'GRADE_12') return [...VALID_TOPICS]
  return VALID_TOPICS.filter((topic) => topic !== 'Calculus')
}

function normalizeTopicText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeTopicLabel(value, allowedTopics) {
  const raw = String(value || '').trim()
  if (!raw) return null

  const exact = allowedTopics.find((topic) => topic.toLowerCase() === raw.toLowerCase())
  if (exact) return exact

  const normalized = normalizeTopicText(raw)
  const aliases = new Map([
    ['number patterns', 'Number Patterns'],
    ['patterns', 'Number Patterns'],
    ['sequences', 'Sequences and Series'],
    ['series', 'Sequences and Series'],
    ['sequences and series', 'Sequences and Series'],
    ['analytic geometry', 'Analytical Geometry'],
    ['analytical geometry', 'Analytical Geometry'],
    ['euclidean geometry', 'Euclidean Geometry'],
    ['probability', 'Probability'],
    ['statistics', 'Statistics'],
    ['finance', 'Finance'],
    ['functions', 'Functions'],
    ['trigonometry', 'Trigonometry'],
    ['polynomials', 'Polynomials'],
    ['algebra', 'Algebra'],
  ])
  const viaAlias = aliases.get(normalized)
  if (viaAlias && allowedTopics.includes(viaAlias)) return viaAlias

  for (const topic of allowedTopics) {
    const t = normalizeTopicText(topic)
    if (normalized.includes(t) || t.includes(normalized)) return topic
  }

  return null
}

function inferFallbackTopic(sectionText, allowedTopics) {
  const text = normalizeTopicText(sectionText)
  const keywordMap = [
    ['sin', 'Trigonometry'],
    ['cos', 'Trigonometry'],
    ['tan', 'Trigonometry'],
    ['triangle', 'Euclidean Geometry'],
    ['chord', 'Euclidean Geometry'],
    ['circle', 'Euclidean Geometry'],
    ['gradient', 'Analytical Geometry'],
    ['midpoint', 'Analytical Geometry'],
    ['probability', 'Probability'],
    ['permutation', 'Probability'],
    ['combination', 'Probability'],
    ['mean', 'Statistics'],
    ['median', 'Statistics'],
    ['standard deviation', 'Statistics'],
    ['annuity', 'Finance'],
    ['depreciation', 'Finance'],
    ['sequence', 'Sequences and Series'],
    ['series', 'Sequences and Series'],
    ['arithmetic', 'Sequences and Series'],
    ['geometric', 'Sequences and Series'],
    ['polynomial', 'Polynomials'],
    ['factor theorem', 'Polynomials'],
    ['function', 'Functions'],
  ]
  for (const [needle, topic] of keywordMap) {
    if (text.includes(needle) && allowedTopics.includes(topic)) return topic
  }
  return allowedTopics.includes('Functions') ? 'Functions' : (allowedTopics[0] || 'Algebra')
}

function extractQuestionSectionsFromMmd(mmd) {
  const sections = new Map()
  const lines = String(mmd || '').split(/\r?\n/)
  let currentRoot = ''
  let bucket = []

  const flush = () => {
    if (!currentRoot) return
    const block = bucket.join('\n').trim()
    if (block) sections.set(currentRoot, block)
  }

  for (const rawLine of lines) {
    const line = String(rawLine || '')
    const trimmed = line.trim()
    const headingMatch = trimmed.match(/(?:\\section\*\{\s*QUESTION\s+(\d+)\s*\}|^QUESTION\s+(\d+)\b)/i)

    if (headingMatch?.[1] || headingMatch?.[2]) {
      flush()
      currentRoot = String(headingMatch[1] || headingMatch[2] || '').trim()
      bucket = [line]
      continue
    }

    if (!currentRoot) continue
    bucket.push(line)
  }

  flush()
  return sections
}

function extractQuestionNumbersFromSection(sectionMmd, rootQuestionNumber) {
  const values = new Set()
  const root = normalizeQuestionNumber(rootQuestionNumber)
  if (root) values.add(root)

  const lines = String(sectionMmd || '').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = String(rawLine || '').trim()
    if (!line) continue
    const m = line.match(/^Q?((?:\d+)(?:\.\d+){0,6})\b/)
    const qNum = normalizeQuestionNumber(m?.[1] || '')
    if (!qNum) continue
    if (root && !(qNum === root || qNum.startsWith(`${root}.`))) continue
    values.add(qNum)
  }

  return Array.from(values).sort((a, b) => compareQuestionNumbers(a, b))
}

function buildRootPrompt(input) {
  const gradeLabel = String(input.grade || '').replace('_', ' ').replace(/^GRADE /i, 'Grade ')
  return [
    `Classify ONE topic for ROOT QUESTION ${input.root}.`,
    `Context: ${gradeLabel} Mathematics Paper ${input.paper} (${input.month} ${input.year}).`,
    `Use exactly ONE topic from this list: ${input.allowedTopics.join(', ')}.`,
    'Rules:',
    '- Return only JSON in this exact form: {"topic":"Functions"}.',
    '- Calculus is not allowed for this grade.',
    `MMD block for QUESTION ${input.root}:`,
    String(input.sectionMmd || '').slice(0, 14000),
  ].join('\n')
}

function tryParseJsonLoose(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  try { return JSON.parse(raw) } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced?.[1]) {
    try { return JSON.parse(fenced[1]) } catch {}
  }
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)) } catch {}
  }
  return null
}

function extractRootTopic(aiRaw, allowedTopics, sectionText) {
  const parsed = tryParseJsonLoose(aiRaw)
  const rawTopic = parsed?.topic ?? parsed?.label ?? parsed?.classification ?? aiRaw
  let topic = normalizeTopicLabel(rawTopic, allowedTopics)
  if (!topic) topic = inferFallbackTopic(sectionText, allowedTopics)
  if (!allowedTopics.includes(topic)) topic = inferFallbackTopic(sectionText, allowedTopics)
  return topic
}

async function classifyWithOpenAI(opts) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You classify NSC Mathematics root questions into one allowed topic label only. Return JSON only.',
        },
        { role: 'user', content: opts.prompt },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`OpenAI topic classify failed (${res.status}): ${err.slice(0, 240)}`)
  }

  const data = await res.json().catch(() => null)
  return String(data?.choices?.[0]?.message?.content || '').trim()
}

async function classifyWithGemini(opts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
      },
      contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    }),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Gemini topic classify failed (${res.status}): ${err.slice(0, 240)}`)
  }

  const data = await res.json().catch(() => null)
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => String(p?.text || '')).join('\n') || ''
  return text.trim()
}

async function classifyWithProvider({ prompt, provider, openAiApiKey, openAiModel, geminiApiKey, geminiModel }) {
  if (provider === 'openai') {
    if (!openAiApiKey) throw new Error('OPENAI_API_KEY missing')
    return classifyWithOpenAI({ apiKey: openAiApiKey, model: openAiModel, prompt })
  }
  if (provider === 'gemini') {
    if (!geminiApiKey) throw new Error('GEMINI_API_KEY missing')
    return classifyWithGemini({ apiKey: geminiApiKey, model: geminiModel, prompt })
  }

  if (openAiApiKey) {
    try {
      return await classifyWithOpenAI({ apiKey: openAiApiKey, model: openAiModel, prompt })
    } catch {
      if (!geminiApiKey) throw new Error('OpenAI failed and no Gemini fallback key configured')
    }
  }
  if (!geminiApiKey) throw new Error('No AI key configured')
  return classifyWithGemini({ apiKey: geminiApiKey, model: geminiModel, prompt })
}

async function run() {
  const connectionString = String(process.env.DATABASE_URL || '').trim()
  if (!connectionString) throw new Error('DATABASE_URL is required')

  const grade = String(readArg('grade', 'GRADE_10')).trim() || 'GRADE_10'
  const startAfter = String(readArg('startAfter', '')).trim()
  const limit = readIntArg('limit', 6)
  const provider = String(readArg('provider', 'auto')).trim().toLowerCase()

  const openAiApiKey = String(process.env.OPENAI_API_KEY || '').trim()
  const openAiModel = String(process.env.OPENAI_MODEL || 'gpt-4.1-mini').trim() || 'gpt-4.1-mini'
  const geminiApiKey = String(process.env.GEMINI_API_KEY || '').trim()
  const geminiModel = String(process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'

  if (!openAiApiKey && !geminiApiKey) throw new Error('Set OPENAI_API_KEY or GEMINI_API_KEY')

  const allowedTopics = getAllowedTopicsForGrade(grade)

  const pool = new Pool({ connectionString })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  const summary = {
    grade,
    scannedSources: 0,
    targetedSources: 0,
    rootsClassified: 0,
    updatedTopics: 0,
    unresolvedRoots: 0,
    failedSources: 0,
    sourceErrors: [],
    nextCursor: null,
    hasMore: false,
  }

  try {
    const where = {
      grade,
      parsedJson: { not: null },
      ...(startAfter ? { id: { gt: startAfter } } : {}),
    }

    const sources = await prisma.resourceBankItem.findMany({
      where,
      select: { id: true, grade: true, year: true, sessionMonth: true, paper: true, parsedJson: true },
      orderBy: { id: 'asc' },
      take: limit,
    })

    summary.scannedSources = sources.length

    for (const source of sources) {
      if (typeof source.year !== 'number' || !source.sessionMonth || typeof source.paper !== 'number') continue
      const mmd = typeof source?.parsedJson?.raw?.mmd === 'string' ? String(source.parsedJson.raw.mmd).trim() : ''
      if (!mmd) continue

      const sections = extractQuestionSectionsFromMmd(mmd)
      if (!sections.size) continue

      summary.targetedSources += 1

      const existing = await prisma.questionAnnotation.findMany({
        where: { sourceId: source.id },
        select: { questionNumber: true, topic: true, cognitiveLevel: true },
      })
      const existingMap = new Map(existing.map((row) => [normalizeQuestionNumber(row.questionNumber), row]))

      try {
        for (const [root, sectionMmd] of sections.entries()) {
          const rootQ = normalizeQuestionNumber(root)
          if (!rootQ) continue
          const qNums = extractQuestionNumbersFromSection(sectionMmd, rootQ)
          if (!qNums.length) continue

          summary.rootsClassified += 1

          const prompt = buildRootPrompt({
            grade: source.grade,
            year: source.year,
            month: source.sessionMonth,
            paper: source.paper,
            root: rootQ,
            sectionMmd,
            allowedTopics,
          })

          let aiRaw = ''
          try {
            aiRaw = await classifyWithProvider({
              prompt,
              provider,
              openAiApiKey,
              openAiModel,
              geminiApiKey,
              geminiModel,
            })
          } catch {
            aiRaw = ''
          }

          const rootTopic = extractRootTopic(aiRaw, allowedTopics, sectionMmd)
          if (!rootTopic) {
            summary.unresolvedRoots += 1
            continue
          }

          for (const qNum of qNums) {
            const existingExact = existingMap.get(normalizeQuestionNumber(qNum))
            await prisma.questionAnnotation.upsert({
              where: {
                sourceId_questionNumber: {
                  sourceId: source.id,
                  questionNumber: qNum,
                },
              },
              create: {
                sourceId: source.id,
                questionNumber: qNum,
                topic: rootTopic,
                cognitiveLevel: existingExact?.cognitiveLevel ?? null,
              },
              update: {
                topic: rootTopic,
              },
            })
            summary.updatedTopics += 1
          }
        }
      } catch (err) {
        summary.failedSources += 1
        summary.sourceErrors.push({ sourceId: source.id, message: String(err?.message || err).slice(0, 200) })
      }
    }

    const nextCursor = sources.length ? sources[sources.length - 1].id : null
    summary.nextCursor = nextCursor
    summary.hasMore = Boolean(
      nextCursor
      && await prisma.resourceBankItem.findFirst({
        where: { grade, parsedJson: { not: null }, id: { gt: nextCursor } },
        select: { id: true },
      }),
    )

    console.log(`RUN_SUMMARY:${JSON.stringify(summary)}`)
  } finally {
    await prisma.$disconnect().catch(() => {})
    await pool.end().catch(() => {})
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
