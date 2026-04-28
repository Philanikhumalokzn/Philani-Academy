const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

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

function normalizeExamQuestionContent(questionText, latex) {
  const text = String(questionText || '').replace(/\s+/g, ' ').trim()
  const ltx = String(latex || '').replace(/\s+/g, ' ').trim()
  return { questionText: text, latex: ltx }
}

function clampText(value, max) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ')
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text
}

function buildQuestionPromptLine(row) {
  const normalized = normalizeExamQuestionContent(row.questionText, row.latex)
  const body = clampText(normalized.questionText || normalized.latex || row.tableMarkdown || '', 320) || '[no extracted text]'
  const parts = [`Q${row.questionNumber}`, `depth=${row.questionDepth}`]
  if (row.marks != null) parts.push(`marks=${row.marks}`)
  if (row.topic) parts.push(`topic=${row.topic}`)
  if (row.imageUrl) parts.push('hasImage=true')
  return `${parts.join(' | ')}\n${body}`
}

function buildCognitivePrompt(input) {
  const gradeLabel = String(input.grade || '').replace('_', ' ').replace(/^GRADE /i, 'Grade ')
  const questionLines = input.questions.map((row) => buildQuestionPromptLine(row)).join('\n\n')
  return [
    'Assign a DB cognitive level to EVERY listed question and subquestion in this paper.',
    `Context: ${gradeLabel} Mathematics Paper ${input.paper} (${input.month} ${input.year}).`,
    'Use ONLY these DB levels and meanings:',
    '- 1 = Knowledge',
    '- 2 = Routine procedures',
    '- 3 = Complex procedures',
    '- 4 = Problem-solving',
    'Strict classification rules:',
    '- Level 1 (Knowledge): recall, identification, simple reading from a table/graph/diagram, direct substitution, or a plainly obvious one-step fact/procedure.',
    '- Level 2 (Routine procedures): familiar standard methods, straightforward calculations/manipulations, or obvious multi-step procedures where the method is already clear.',
    '- Level 3 (Complex procedures): non-routine or connected procedures requiring method selection, linking ideas, interpretation, or sustained reasoning across steps.',
    '- Level 4 (Problem-solving): unfamiliar or unstructured tasks requiring insight, strategy design, justification, modelling, or extended reasoning.',
    'Additional rules:',
    '- Classify the actual demand of each specific listed questionNumber, not just the root topic.',
    '- Include EVERY listed questionNumber exactly once, including subquestions such as 1.1, 1.2, 3.4.2, etc.',
    '- cognitiveLevel must be an integer 1, 2, 3, or 4 only.',
    '- Do not omit items. Do not add extra items. Do not output commentary.',
    '- Return ONLY valid JSON in this exact shape: {"items":[{"questionNumber":"1.1","cognitiveLevel":2}]}.',
    'Paper MMD context:',
    String(input.paperMmd || '').slice(0, 24000),
    'Extracted questions to classify:',
    questionLines,
  ].join('\n')
}

function buildFocusedCognitivePrompt(input) {
  const gradeLabel = String(input.grade || '').replace('_', ' ').replace(/^GRADE /i, 'Grade ')
  const questionLines = input.questions.map((row) => buildQuestionPromptLine(row)).join('\n\n')
  return [
    'Assign a DB cognitive level to EACH listed question and subquestion below.',
    `Context: ${gradeLabel} Mathematics Paper ${input.paper} (${input.month} ${input.year}).`,
    'Use ONLY DB levels 1, 2, 3, 4 with these meanings:',
    '- 1 = Knowledge',
    '- 2 = Routine procedures',
    '- 3 = Complex procedures',
    '- 4 = Problem-solving',
    'Rules:',
    '- Return one item per listed questionNumber and do not omit any listed item.',
    '- Do not add extra items that are not listed.',
    '- cognitiveLevel must be an integer 1, 2, 3, or 4 only.',
    '- Return ONLY valid JSON: {"items":[{"questionNumber":"1.1","cognitiveLevel":2}]}.',
    `Question numbers to classify: ${input.questions.map((row) => row.questionNumber).join(', ')}`,
    'Paper MMD context:',
    String(input.paperMmd || '').slice(0, 18000),
    'Target extracted questions:',
    questionLines,
  ].join('\n')
}

function buildSingleQuestionPrompt(input) {
  const gradeLabel = String(input.grade || '').replace('_', ' ').replace(/^GRADE /i, 'Grade ')
  const row = input.question
  return [
    'Assign a DB cognitive level to this ONE Mathematics question.',
    `Context: ${gradeLabel} Mathematics Paper ${input.paper} (${input.month} ${input.year}).`,
    'Use ONLY one integer level:',
    '- 1 = Knowledge',
    '- 2 = Routine procedures',
    '- 3 = Complex procedures',
    '- 4 = Problem-solving',
    'Rules:',
    '- Classify the demand of this exact questionNumber only.',
    '- Return ONLY valid JSON in this exact shape: {"questionNumber":"1.1","cognitiveLevel":2}.',
    `Target questionNumber: ${row.questionNumber}`,
    'Paper MMD context:',
    String(input.paperMmd || '').slice(0, 12000),
    'Target extracted question:',
    buildQuestionPromptLine(row),
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

function clampCognitiveLevel(value) {
  if (!Number.isFinite(value)) return null
  return Math.min(4, Math.max(1, Math.round(value)))
}

function normalizeCognitiveLevel(value) {
  if (value == null) return null
  if (typeof value === 'number') return clampCognitiveLevel(value)
  const text = String(value).trim()
  if (!text) return null
  const direct = text.match(/\b([1-4])\b/)
  if (direct?.[1]) return clampCognitiveLevel(Number(direct[1]))
  const any = text.match(/-?\d+(?:\.\d+)?/)
  if (any?.[0]) return clampCognitiveLevel(Number(any[0]))
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
    .map(([questionNumber, cognitiveLevel]) => ({ questionNumber, cognitiveLevel }))
  return entries
}

function extractItemsFromRawText(aiRaw) {
  const lines = String(aiRaw || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const items = []
  for (const line of lines) {
    const questionNumberMatch = line.match(/(?:^|\b)Q?\s*(\d+(?:\.\d+)*)/i)
    if (!questionNumberMatch?.[1]) continue
    const tail = line.slice(questionNumberMatch.index != null ? questionNumberMatch.index + questionNumberMatch[0].length : 0).trim()
    items.push({ questionNumber: questionNumberMatch[1], cognitiveLevel: tail || line })
  }
  return items
}

function buildProposedLevelMap(rows, aiRaw) {
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
    const cognitiveLevel = normalizeCognitiveLevel(
      item?.cognitiveLevel
      ?? item?.level
      ?? item?.classification
      ?? item?.cognitive_level
      ?? item?.value
      ?? item?.answer
      ?? item,
    )

    if (!questionNumber || cognitiveLevel == null) continue
    proposedByNumber.set(questionNumber, cognitiveLevel)
  }

  return proposedByNumber
}

function extractSingleProposedLevel(aiRaw, questionNumber) {
  const qNum = normalizeQuestionNumber(questionNumber)
  if (!qNum) return null

  const parsed = tryParseJsonLoose(aiRaw)
  if (parsed && typeof parsed === 'object') {
    const direct = normalizeCognitiveLevel(
      parsed.cognitiveLevel
      ?? parsed.level
      ?? parsed.classification
      ?? parsed.cognitive_level
      ?? parsed.value,
    )
    if (direct != null) return direct

    const items = extractItemsArray(parsed)
    for (const item of items) {
      const itemQ = normalizeQuestionNumber(
        item?.questionNumber
        ?? item?.q
        ?? item?.question
        ?? item?.number
        ?? item?.label,
      )
      if (!itemQ || itemQ !== qNum) continue
      const level = normalizeCognitiveLevel(
        item?.cognitiveLevel
        ?? item?.level
        ?? item?.classification
        ?? item?.value
        ?? item,
      )
      if (level != null) return level
    }
  }

  return normalizeCognitiveLevel(aiRaw)
}

async function classifyLevelsWithOpenAI(opts) {
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
          content: 'You assign NSC Mathematics cognitive levels using only the fixed DB levels 1, 2, 3, and 4. Return JSON only.',
        },
        { role: 'user', content: opts.prompt },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`OpenAI cognitive classify failed (${res.status}): ${err.slice(0, 240)}`)
  }

  const data = await res.json().catch(() => null)
  return String(data?.choices?.[0]?.message?.content || '').trim()
}

async function classifyLevelsWithGemini(opts) {
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
    throw new Error(`Gemini cognitive classify failed (${res.status}): ${err.slice(0, 240)}`)
  }

  const data = await res.json().catch(() => null)
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => String(p?.text || '')).join('\n') || ''
  return text.trim()
}

async function classifyWithProvider({ prompt, provider, openAiApiKey, openAiModel, geminiApiKey, geminiModel }) {
  if (provider === 'openai') {
    if (!openAiApiKey) throw new Error('OPENAI_API_KEY missing')
    return classifyLevelsWithOpenAI({ apiKey: openAiApiKey, model: openAiModel, prompt })
  }
  if (provider === 'gemini') {
    if (!geminiApiKey) throw new Error('GEMINI_API_KEY missing')
    return classifyLevelsWithGemini({ apiKey: geminiApiKey, model: geminiModel, prompt })
  }

  if (openAiApiKey) {
    try {
      return await classifyLevelsWithOpenAI({ apiKey: openAiApiKey, model: openAiModel, prompt })
    } catch {
      if (!geminiApiKey) throw new Error('OpenAI failed and no Gemini fallback key configured')
    }
  }
  if (!geminiApiKey) throw new Error('No AI key configured')
  return classifyLevelsWithGemini({ apiKey: geminiApiKey, model: geminiModel, prompt })
}

async function run() {
  const connectionString = String(process.env.DATABASE_URL || '').trim()
  if (!connectionString) throw new Error('DATABASE_URL is required')

  const grade = String(readArg('grade', 'GRADE_12')).trim() || 'GRADE_12'
  const startAfter = String(readArg('startAfter', '')).trim()
  const limit = readIntArg('limit', 3)
  const provider = String(readArg('provider', 'auto')).trim().toLowerCase()

  const openAiApiKey = String(process.env.OPENAI_API_KEY || '').trim()
  const openAiModel = String(process.env.OPENAI_MODEL || 'gpt-4.1-mini').trim() || 'gpt-4.1-mini'
  const geminiApiKey = String(process.env.GEMINI_API_KEY || '').trim()
  const geminiModel = String(process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'

  if (!openAiApiKey && !geminiApiKey) throw new Error('Set OPENAI_API_KEY or GEMINI_API_KEY')

  const pool = new Pool({ connectionString })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  const summary = {
    grade,
    scannedSources: 0,
    targetedSources: 0,
    scannedQuestions: 0,
    updatedLevels: 0,
    unresolvedLevels: 0,
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
          const normalized = normalizeExamQuestionContent(String(block || '').replace(/\s+/g, ' ').trim(), '')
          rows.push({
            sourceId: source.id,
            grade: source.grade,
            year: source.year,
            month: source.sessionMonth,
            paper: source.paper,
            questionNumber,
            questionDepth: Math.max(0, questionNumber.split('.').filter(Boolean).length - 1),
            topic: null,
            marks: null,
            cognitiveLevel: null,
            questionText: normalized.questionText || normalized.latex || String(block || '').slice(0, 1200),
            latex: null,
            imageUrl: null,
            tableMarkdown: null,
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
        return ann?.cognitiveLevel == null
      })

      if (!targetRows.length) continue
      summary.targetedSources += 1
      summary.scannedQuestions += targetRows.length

      const paperRows = rows.map((row) => {
        const key = normalizeQuestionNumber(row.questionNumber)
        const ann = existingMap.get(key)
        return {
          ...row,
          topic: ann?.topic ?? null,
          cognitiveLevel: ann?.cognitiveLevel ?? null,
        }
      })

      try {
        const prompt = buildCognitivePrompt({
          grade: source.grade,
          year: source.year,
          month: source.sessionMonth,
          paper: source.paper,
          paperMmd: mmd,
          questions: paperRows,
        })

        const aiRaw = await classifyWithProvider({
          prompt,
          provider,
          openAiApiKey,
          openAiModel,
          geminiApiKey,
          geminiModel,
        })

        const proposedByNumber = buildProposedLevelMap(paperRows, aiRaw)

        const unresolvedAfterPrimary = targetRows.filter((row) => {
          const qNum = normalizeQuestionNumber(row.questionNumber)
          return !proposedByNumber.has(qNum)
        })

        if (unresolvedAfterPrimary.length > 0) {
          const focusedPrompt = buildFocusedCognitivePrompt({
            grade: source.grade,
            year: source.year,
            month: source.sessionMonth,
            paper: source.paper,
            paperMmd: mmd,
            questions: unresolvedAfterPrimary.map((row) => {
              const key = normalizeQuestionNumber(row.questionNumber)
              const ann = existingMap.get(key)
              return {
                ...row,
                topic: ann?.topic ?? null,
                cognitiveLevel: ann?.cognitiveLevel ?? null,
              }
            }),
          })

          const focusedRaw = await classifyWithProvider({
            prompt: focusedPrompt,
            provider,
            openAiApiKey,
            openAiModel,
            geminiApiKey,
            geminiModel,
          })

          const focusedMap = buildProposedLevelMap(unresolvedAfterPrimary, focusedRaw)
          for (const [questionNumber, cognitiveLevel] of focusedMap.entries()) {
            if (!proposedByNumber.has(questionNumber)) {
              proposedByNumber.set(questionNumber, cognitiveLevel)
            }
          }

          const unresolvedAfterFocused = unresolvedAfterPrimary.filter((row) => {
            const qNum = normalizeQuestionNumber(row.questionNumber)
            return !proposedByNumber.has(qNum)
          })

          for (const row of unresolvedAfterFocused) {
            const singlePrompt = buildSingleQuestionPrompt({
              grade: source.grade,
              year: source.year,
              month: source.sessionMonth,
              paper: source.paper,
              paperMmd: mmd,
              question: row,
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
            const singleLevel = extractSingleProposedLevel(singleRaw, qNum)
            if (singleLevel != null && !proposedByNumber.has(qNum)) {
              proposedByNumber.set(qNum, singleLevel)
            }
          }
        }

        for (const row of targetRows) {
          const qNum = normalizeQuestionNumber(row.questionNumber)
          const proposed = proposedByNumber.get(qNum) ?? null
          if (proposed == null) {
            summary.unresolvedLevels += 1
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
              topic: existingExact?.topic ?? null,
              cognitiveLevel: proposed,
            },
            update: {
              cognitiveLevel: proposed,
            },
          })
          summary.updatedLevels += 1
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
