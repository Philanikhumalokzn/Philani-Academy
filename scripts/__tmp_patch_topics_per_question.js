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

function questionSortParts(qNum) {
  const match = String(qNum || '').trim().match(/(\d+(?:\.\d+)*)/)
  if (!match?.[1]) return []
  return match[1].split('.').map((part) => Number(part)).filter((part) => Number.isFinite(part))
}

function compareQuestionNumbers(a, b) {
  const pa = questionSortParts(a)
  const pb = questionSortParts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na - nb
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

function normalizeTopicText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getAllowedTopicsForGrade(grade) {
  const text = String(grade || '').toUpperCase().trim()
  if (text === 'GRADE_12') return [...VALID_TOPICS]
  return VALID_TOPICS.filter((topic) => topic !== 'Calculus')
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
    ['calculus', 'Calculus'],
  ])
  const viaAlias = aliases.get(normalized)
  if (viaAlias && allowedTopics.includes(viaAlias)) return viaAlias

  for (const topic of allowedTopics) {
    const t = normalizeTopicText(topic)
    if (normalized.includes(t) || t.includes(normalized)) return topic
  }

  return null
}

function inferNoCalculusFallback(questionText, allowedTopics) {
  const text = normalizeTopicText(questionText)
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

  if (allowedTopics.includes('Functions')) return 'Functions'
  return allowedTopics[0] || 'Algebra'
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

function sliceQuestionBlockFromSection(sectionMmd, targetQuestionNumber) {
  const lines = String(sectionMmd || '').split(/\r?\n/)
  const target = normalizeQuestionNumber(targetQuestionNumber)
  if (!target) return ''

  const isHeading = (line) => {
    const m = String(line || '').trim().match(/^Q?((?:\d+)(?:\.\d+){0,6})\b/)
    return normalizeQuestionNumber(m?.[1] || '') || null
  }

  let start = -1
  for (let i = 0; i < lines.length; i += 1) {
    const q = isHeading(lines[i])
    if (q === target) {
      start = i
      break
    }
  }
  if (start < 0) return ''

  const targetDepth = target.split('.').length
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    const q = isHeading(lines[i])
    if (!q) continue
    const depth = q.split('.').length
    if (depth <= targetDepth && (q === target || !q.startsWith(`${target}.`))) {
      end = i
      break
    }
  }

  return lines.slice(start, end).join('\n').trim()
}

function clampText(value, max) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ')
  return text.length > max ? `${text.slice(0, max - 1).trim()}...` : text
}

function buildQuestionPromptLine(row) {
  const body = clampText(row.questionText || '', 320) || '[no extracted text]'
  return `Q${row.questionNumber}\n${body}`
}

function buildTopicPrompt(input) {
  const gradeLabel = String(input.grade || '').replace('_', ' ').replace(/^GRADE /i, 'Grade ')
  const questionLines = input.questions.map((row) => buildQuestionPromptLine(row)).join('\n\n')
  const allowedTopics = input.allowedTopics.join(', ')
  const noCalculusRule = input.allowedTopics.includes('Calculus')
    ? ''
    : '- Calculus is NOT allowed for this grade. Never output Calculus.'

  return [
    'Assign a DB topic to EVERY listed question and subquestion in this paper.',
    `Context: ${gradeLabel} Mathematics Paper ${input.paper} (${input.month} ${input.year}).`,
    `Use ONLY these topics: ${allowedTopics}.`,
    'Rules:',
    '- Return one topic per listed questionNumber and include ALL listed items.',
    '- Do not add extra items.',
    noCalculusRule,
    '- Return ONLY valid JSON in this exact shape: {"items":[{"questionNumber":"1.1","topic":"Functions"}]}.',
    'Paper MMD context:',
    String(input.paperMmd || '').slice(0, 22000),
    'Questions to classify:',
    questionLines,
  ].filter(Boolean).join('\n')
}

function buildFocusedTopicPrompt(input) {
  const gradeLabel = String(input.grade || '').replace('_', ' ').replace(/^GRADE /i, 'Grade ')
  const questionLines = input.questions.map((row) => buildQuestionPromptLine(row)).join('\n\n')
  const allowedTopics = input.allowedTopics.join(', ')
  const noCalculusRule = input.allowedTopics.includes('Calculus')
    ? ''
    : '- Calculus is NOT allowed for this grade. Never output Calculus.'

  return [
    'Assign a DB topic to EACH listed question and subquestion below.',
    `Context: ${gradeLabel} Mathematics Paper ${input.paper} (${input.month} ${input.year}).`,
    `Use ONLY these topics: ${allowedTopics}.`,
    'Rules:',
    '- Return one topic per listed questionNumber and do not omit any listed item.',
    '- Do not add extra items that are not listed.',
    noCalculusRule,
    '- Return ONLY valid JSON: {"items":[{"questionNumber":"1.1","topic":"Functions"}]}.',
    `Question numbers to classify: ${input.questions.map((row) => row.questionNumber).join(', ')}`,
    'Paper MMD context:',
    String(input.paperMmd || '').slice(0, 16000),
    'Target questions:',
    questionLines,
  ].filter(Boolean).join('\n')
}

function buildSingleTopicPrompt(input) {
  const gradeLabel = String(input.grade || '').replace('_', ' ').replace(/^GRADE /i, 'Grade ')
  const allowedTopics = input.allowedTopics.join(', ')
  const row = input.question
  const noCalculusRule = input.allowedTopics.includes('Calculus')
    ? ''
    : '- Calculus is NOT allowed for this grade. Never output Calculus.'

  return [
    'Assign a DB topic to this ONE Mathematics question.',
    `Context: ${gradeLabel} Mathematics Paper ${input.paper} (${input.month} ${input.year}).`,
    `Use ONLY these topics: ${allowedTopics}.`,
    'Rules:',
    '- Classify this exact questionNumber only.',
    noCalculusRule,
    '- Return ONLY valid JSON in this exact shape: {"questionNumber":"1.1","topic":"Functions"}.',
    `Target questionNumber: ${row.questionNumber}`,
    'Paper MMD context:',
    String(input.paperMmd || '').slice(0, 10000),
    'Target question:',
    buildQuestionPromptLine(row),
  ].filter(Boolean).join('\n')
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

function extractItemsArray(value) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  const record = value
  const candidates = [record.items, record.questions, record.results, record.data]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }
  const entries = Object.entries(record)
    .filter(([key]) => Boolean(normalizeQuestionNumber(key)))
    .map(([questionNumber, topic]) => ({ questionNumber, topic }))
  return entries
}

function extractItemsFromRawText(aiRaw) {
  const lines = String(aiRaw || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const items = []
  for (const line of lines) {
    const questionNumberMatch = line.match(/(?:^|\b)Q?\s*(\d+(?:\.\d+)*)/i)
    if (!questionNumberMatch?.[1]) continue
    const tail = line.slice(questionNumberMatch.index != null ? questionNumberMatch.index + questionNumberMatch[0].length : 0).trim()
    items.push({ questionNumber: questionNumberMatch[1], topic: tail || line })
  }
  return items
}

function buildProposedTopicMap(aiRaw, allowedTopics, fallbackQuestionTextByNumber) {
  const parsed = tryParseJsonLoose(aiRaw)
  const items = extractItemsArray(parsed)
  const fallbackItems = items.length > 0 ? [] : extractItemsFromRawText(aiRaw)
  const candidateItems = items.length > 0 ? items : fallbackItems
  const proposedByNumber = new Map()

  for (const item of candidateItems) {
    const questionNumber = normalizeQuestionNumber(
      item?.questionNumber
      ?? item?.q
      ?? item?.question
      ?? item?.number
      ?? item?.question_id
      ?? item?.id
      ?? item?.label,
    )

    const rawTopic = String(
      item?.topic
      ?? item?.label
      ?? item?.classification
      ?? item?.answer
      ?? item
      ?? '',
    )

    let normalizedTopic = normalizeTopicLabel(rawTopic, allowedTopics)
    if (!normalizedTopic && questionNumber) {
      normalizedTopic = inferNoCalculusFallback(fallbackQuestionTextByNumber.get(questionNumber) || '', allowedTopics)
    }

    if (!questionNumber || !normalizedTopic) continue
    proposedByNumber.set(questionNumber, normalizedTopic)
  }

  return proposedByNumber
}

function extractSingleProposedTopic(aiRaw, questionNumber, allowedTopics, questionText) {
  const qNum = normalizeQuestionNumber(questionNumber)
  if (!qNum) return null

  const parsed = tryParseJsonLoose(aiRaw)
  if (parsed && typeof parsed === 'object') {
    const direct = normalizeTopicLabel(parsed.topic ?? parsed.label ?? parsed.classification ?? parsed.value, allowedTopics)
    if (direct) return direct

    const items = extractItemsArray(parsed)
    for (const item of items) {
      const itemQ = normalizeQuestionNumber(item?.questionNumber ?? item?.q ?? item?.question ?? item?.number ?? item?.label)
      if (!itemQ || itemQ !== qNum) continue
      const topic = normalizeTopicLabel(item?.topic ?? item?.label ?? item?.classification ?? item?.value ?? item, allowedTopics)
      if (topic) return topic
    }
  }

  return normalizeTopicLabel(aiRaw, allowedTopics) || inferNoCalculusFallback(questionText, allowedTopics)
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
          content: 'You assign NSC Mathematics topics using only the provided allowed topic list. Return JSON only.',
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
        maxOutputTokens: 4096,
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

  const grade = String(readArg('grade', 'GRADE_11')).trim() || 'GRADE_11'
  const startAfter = String(readArg('startAfter', '')).trim()
  const limit = readIntArg('limit', 3)
  const provider = String(readArg('provider', 'auto')).trim().toLowerCase()

  const openAiApiKey = String(process.env.OPENAI_API_KEY || '').trim()
  const openAiModel = String(process.env.OPENAI_MODEL || 'gpt-4.1-mini').trim() || 'gpt-4.1-mini'
  const geminiApiKey = String(process.env.GEMINI_API_KEY || '').trim()
  const geminiModel = String(process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'

  if (!openAiApiKey && !geminiApiKey) throw new Error('Set OPENAI_API_KEY or GEMINI_API_KEY')

  const allowedTopics = getAllowedTopicsForGrade(grade)
  if (!allowedTopics.length) throw new Error(`No allowed topics configured for ${grade}`)

  const pool = new Pool({ connectionString })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  const summary = {
    grade,
    scannedSources: 0,
    targetedSources: 0,
    scannedQuestions: 0,
    updatedTopics: 0,
    unresolvedTopics: 0,
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
      select: {
        id: true,
        grade: true,
        year: true,
        sessionMonth: true,
        paper: true,
        parsedJson: true,
      },
      orderBy: { id: 'asc' },
      take: limit,
    })

    summary.scannedSources = sources.length

    for (const source of sources) {
      if (typeof source.year !== 'number' || !source.sessionMonth || typeof source.paper !== 'number') continue
      const mmd = typeof source?.parsedJson?.raw?.mmd === 'string' ? String(source.parsedJson.raw.mmd).trim() : ''
      if (!mmd) continue

      const sections = extractQuestionSectionsFromMmd(mmd)
      const rows = []
      for (const [root, sectionMmd] of sections.entries()) {
        const questionNumbers = extractQuestionNumbersFromSection(sectionMmd, root)
        for (const questionNumber of questionNumbers) {
          let block = questionNumber === root ? sectionMmd : sliceQuestionBlockFromSection(sectionMmd, questionNumber)
          if (!block && questionNumber === root) block = sectionMmd
          rows.push({
            sourceId: source.id,
            grade: source.grade,
            year: source.year,
            month: source.sessionMonth,
            paper: source.paper,
            questionNumber,
            questionText: String(block || '').replace(/\s+/g, ' ').trim().slice(0, 1200),
          })
        }
      }
      rows.sort((a, b) => compareQuestionNumbers(a.questionNumber, b.questionNumber))
      if (!rows.length) continue

      const existing = await prisma.questionAnnotation.findMany({
        where: { sourceId: source.id },
        select: { questionNumber: true, topic: true, cognitiveLevel: true },
      })
      const existingMap = new Map(existing.map((row) => [normalizeQuestionNumber(row.questionNumber), row]))

      const targetRows = rows.filter((row) => {
        const key = normalizeQuestionNumber(row.questionNumber)
        const ann = existingMap.get(key)
        return !String(ann?.topic || '').trim()
      })

      if (!targetRows.length) continue
      summary.targetedSources += 1
      summary.scannedQuestions += targetRows.length

      const questionTextByNumber = new Map(rows.map((row) => [normalizeQuestionNumber(row.questionNumber), row.questionText]))

      try {
        const prompt = buildTopicPrompt({
          grade: source.grade,
          year: source.year,
          month: source.sessionMonth,
          paper: source.paper,
          paperMmd: mmd,
          questions: rows,
          allowedTopics,
        })

        const aiRaw = await classifyWithProvider({
          prompt,
          provider,
          openAiApiKey,
          openAiModel,
          geminiApiKey,
          geminiModel,
        })

        const proposedByNumber = buildProposedTopicMap(aiRaw, allowedTopics, questionTextByNumber)

        const unresolvedAfterPrimary = targetRows.filter((row) => {
          const qNum = normalizeQuestionNumber(row.questionNumber)
          return !proposedByNumber.has(qNum)
        })

        if (unresolvedAfterPrimary.length > 0) {
          const focusedPrompt = buildFocusedTopicPrompt({
            grade: source.grade,
            year: source.year,
            month: source.sessionMonth,
            paper: source.paper,
            paperMmd: mmd,
            questions: unresolvedAfterPrimary,
            allowedTopics,
          })

          const focusedRaw = await classifyWithProvider({
            prompt: focusedPrompt,
            provider,
            openAiApiKey,
            openAiModel,
            geminiApiKey,
            geminiModel,
          })

          const focusedMap = buildProposedTopicMap(focusedRaw, allowedTopics, questionTextByNumber)
          for (const [questionNumber, topic] of focusedMap.entries()) {
            if (!proposedByNumber.has(questionNumber)) proposedByNumber.set(questionNumber, topic)
          }

          const unresolvedAfterFocused = unresolvedAfterPrimary.filter((row) => {
            const qNum = normalizeQuestionNumber(row.questionNumber)
            return !proposedByNumber.has(qNum)
          })

          for (const row of unresolvedAfterFocused) {
            const singlePrompt = buildSingleTopicPrompt({
              grade: source.grade,
              year: source.year,
              month: source.sessionMonth,
              paper: source.paper,
              paperMmd: mmd,
              question: row,
              allowedTopics,
            })
            const singleRaw = await classifyWithProvider({
              prompt: singlePrompt,
              provider,
              openAiApiKey,
              openAiModel,
              geminiApiKey,
              geminiModel,
            })

            const qNum = normalizeQuestionNumber(row.questionNumber)
            const topic = extractSingleProposedTopic(singleRaw, qNum, allowedTopics, row.questionText)
            if (topic && !proposedByNumber.has(qNum)) proposedByNumber.set(qNum, topic)
          }
        }

        for (const row of targetRows) {
          const qNum = normalizeQuestionNumber(row.questionNumber)
          let proposed = proposedByNumber.get(qNum) || null
          if (proposed === 'Calculus' && !allowedTopics.includes('Calculus')) {
            proposed = inferNoCalculusFallback(row.questionText, allowedTopics)
          }
          if (!proposed) {
            summary.unresolvedTopics += 1
            continue
          }

          const existingExact = existingMap.get(qNum)
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
              topic: proposed,
              cognitiveLevel: existingExact?.cognitiveLevel ?? null,
            },
            update: {
              topic: proposed,
            },
          })
          summary.updatedTopics += 1
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
        where: {
          grade,
          parsedJson: { not: null },
          id: { gt: nextCursor },
        },
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
