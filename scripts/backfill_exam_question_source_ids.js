const crypto = require('crypto')
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

function coerceQuestionsArray(value) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return null

  const record = value
  const candidates = [record.questions, record.items, record.results, record.data]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }

  return null
}

function decodeStoredMathString(value) {
  if (typeof value !== 'string') return ''

  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\$/g, '$')
    .replace(/\\\\/g, '\\')
    .trim()
}

function stripOuterMathDelimiters(value) {
  let next = String(value || '').trim()

  if (next.startsWith('$$') && next.endsWith('$$') && next.length > 4) {
    next = next.slice(2, -2).trim()
  } else if (next.startsWith('$') && next.endsWith('$') && next.length > 2) {
    next = next.slice(1, -1).trim()
  } else if (next.startsWith('\\(') && next.endsWith('\\)') && next.length > 4) {
    next = next.slice(2, -2).trim()
  } else if (next.startsWith('\\[') && next.endsWith('\\]') && next.length > 4) {
    next = next.slice(2, -2).trim()
  }

  return next
}

function wrapInlineMath(expr) {
  const normalized = stripOuterMathDelimiters(expr).trim()
  return normalized ? `$${normalized}$` : ''
}

function mapPlainSegments(input, mapper) {
  if (!input) return input

  const parts = []
  let lastIndex = 0
  const regex = /\$[^$]+\$/g

  for (const match of input.matchAll(regex)) {
    const token = match[0]
    const index = match.index || 0
    parts.push(mapper(input.slice(lastIndex, index)))
    parts.push(token)
    lastIndex = index + token.length
  }

  parts.push(mapper(input.slice(lastIndex)))
  return parts.join('')
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function looksMathy(value) {
  return value.length > 1 && /[\\^_=+\-*/()\d]/.test(value)
}

function wrapExactLatexLiteral(segment, latex) {
  const normalizedLatex = latex.trim()
  if (!segment || !normalizedLatex || !looksMathy(normalizedLatex) || !segment.includes(normalizedLatex)) {
    return segment
  }

  return segment.replace(new RegExp(escapeRegex(normalizedLatex), 'g'), `$${normalizedLatex}$`)
}

function wrapBackslashCommands(segment) {
  return segment.replace(
    /(\\(?:frac|dfrac|tfrac|sqrt|theta|alpha|beta|gamma|pi|sigma|mu|sin|cos|tan|log|ln|cdot|times|pm|mp|leq|geq|neq|approx|left|right|text|mathrm|mathbf|mathit)(?:\[[^\]]+\])?(?:\{[^{}]+\}|\([^()]*\)|\[[^\]]*\]|[A-Za-z0-9])+)/g,
    (match) => wrapInlineMath(match),
  )
}

function wrapSuperscriptTerms(segment) {
  return segment.replace(
    /\b([A-Za-z0-9()]+(?:\^\{[^{}]+\}|\^[A-Za-z0-9]+|_\{[^{}]+\}|_[A-Za-z0-9]+)+)([.,;:]?)/g,
    (_, expr, trailing) => `${wrapInlineMath(expr)}${trailing || ''}`,
  )
}

function wrapOperatorExpressions(segment) {
  return segment.replace(
    /\b([A-Za-z0-9][A-Za-z0-9()]*?(?:\([A-Za-z0-9]+\))?(?:\^\{[^{}]+\}|\^[A-Za-z0-9]+|_\{[^{}]+\}|_[A-Za-z0-9]+)?(?:\s*[=+\-*/]\s*[A-Za-z0-9][A-Za-z0-9()]*?(?:\([A-Za-z0-9]+\))?(?:\^\{[^{}]+\}|\^[A-Za-z0-9]+|_\{[^{}]+\}|_[A-Za-z0-9]+)?)+)([.,;:]?)/g,
    (_, expr, trailing) => `${wrapInlineMath(expr)}${trailing || ''}`,
  )
}

function standardizeQuestionTextDelimiters(value) {
  return value
    .replace(/\$\$\s*([\s\S]+?)\s*\$\$/g, (_, expr) => wrapInlineMath(expr))
    .replace(/\\\(\s*([\s\S]+?)\s*\\\)/g, (_, expr) => wrapInlineMath(expr))
    .replace(/\\\[\s*([\s\S]+?)\s*\\\]/g, (_, expr) => wrapInlineMath(expr))
}

function repairMalformedInlineMath(value) {
  return value
    .replace(/\\(hat|widehat)\{\s*\$\s*([^$]+?)\s*\$\s*\}/g, (_m, cmd, inner) => `\\${cmd}{${String(inner || '').trim()}}`)
    .replace(/\$(\s*[-+]?\d[\s\S]*?(?:\\leq|<=|≥|\\geq|=|<|>)\s*[-+]?\d[^$]*)\$/g, (_, expr) => wrapInlineMath(expr))
}

function normalizeStoredQuestionLatex(value) {
  const decoded = decodeStoredMathString(value)
  if (!decoded) return ''
  return stripOuterMathDelimiters(decoded)
}

function normalizeStoredQuestionText(value, latex) {
  const normalizedLatex = normalizeStoredQuestionLatex(latex)
  let text = decodeStoredMathString(value)
  if (!text) return ''

  text = standardizeQuestionTextDelimiters(text)
  text = repairMalformedInlineMath(text)

  if (normalizedLatex) {
    text = mapPlainSegments(text, (segment) => wrapExactLatexLiteral(segment, normalizedLatex))
  }

  text = mapPlainSegments(text, wrapBackslashCommands)
  text = mapPlainSegments(text, wrapSuperscriptTerms)
  text = mapPlainSegments(text, wrapOperatorExpressions)

  return text
    .replace(/\$\s*([^$]+?)\s*\$/g, (_, expr) => wrapInlineMath(expr))
    .trim()
}

function normalizeExamQuestionContent(questionText, latex) {
  const normalizedLatex = normalizeStoredQuestionLatex(latex)
  return {
    questionText: normalizeStoredQuestionText(questionText, normalizedLatex),
    latex: normalizedLatex,
  }
}

function makeSignature(questionNumber, questionText, latex) {
  const normalized = normalizeExamQuestionContent(questionText, latex)
  return [
    String(questionNumber || '').trim(),
    String(normalized.questionText || '').trim(),
    String(normalized.latex || '').trim(),
  ].join('||')
}

function paperKey(row) {
  return [row.grade, row.year, row.month, row.paper].join('||')
}

function normalizeHaystack(value) {
  return String(value || '').trim().toLowerCase()
}

function resourceMatchesPaperIdentity(resource, sample) {
  const haystack = [resource.title, resource.filename, resource.url, resource.source]
    .map(normalizeHaystack)
    .filter(Boolean)
    .join(' ')

  if (!haystack) return false

  const month = normalizeHaystack(sample.month)
  const year = String(sample.year)
  const paper = String(sample.paper)
  const paperPatterns = [
    new RegExp(`\\bpaper\\s*${paper}\\b`, 'i'),
    new RegExp(`\\bp${paper}\\b`, 'i'),
    new RegExp(`[_-]paper[_-]?${paper}\\b`, 'i'),
  ]

  if (!haystack.includes(month)) return false
  if (!haystack.includes(year)) return false
  return paperPatterns.some((pattern) => pattern.test(haystack))
}

async function main() {
  const shouldWrite = process.argv.includes('--write')
  const shouldCreateSnapshots = process.argv.includes('--create-snapshots')
  const verbose = process.argv.includes('--verbose')
  const rows = await prisma.examQuestion.findMany({
    where: { sourceId: null },
    orderBy: [{ grade: 'asc' }, { year: 'asc' }, { month: 'asc' }, { paper: 'asc' }, { questionNumber: 'asc' }],
    select: {
      id: true,
      sourceId: true,
      grade: true,
      year: true,
      month: true,
      paper: true,
      questionNumber: true,
      topic: true,
      cognitiveLevel: true,
      marks: true,
      questionText: true,
      latex: true,
      imageUrl: true,
    },
  })

  const resourceRows = await prisma.resourceBankItem.findMany({
    select: {
      id: true,
      grade: true,
      title: true,
      filename: true,
      url: true,
      source: true,
      parsedJson: true,
    },
  })

  const resourcesByGrade = new Map()
  for (const resource of resourceRows) {
    const questions = coerceQuestionsArray(resource.parsedJson)
    const signatures = new Set()
    if (questions && questions.length > 0) {
      for (const raw of questions) {
        if (!raw || typeof raw !== 'object') continue
        const qNum = typeof raw.questionNumber === 'string' ? raw.questionNumber.trim() : String(raw.questionNumber || '').trim()
        if (!qNum) continue
        signatures.add(makeSignature(qNum, raw.questionText, raw.latex))
      }
    }

    const bucket = resourcesByGrade.get(resource.grade) || []
    bucket.push({
      id: resource.id,
      grade: resource.grade,
      title: String(resource.title || '').trim(),
      filename: String(resource.filename || '').trim(),
      url: String(resource.url || '').trim(),
      source: String(resource.source || '').trim(),
      signatures,
    })
    resourcesByGrade.set(resource.grade, bucket)
  }

  const groups = new Map()
  for (const row of rows) {
    const key = paperKey(row)
    const bucket = groups.get(key) || []
    bucket.push(row)
    groups.set(key, bucket)
  }

  let matchedGroups = 0
  let ambiguousGroups = 0
  let updatedRows = 0
  let snapshotGroupsCreated = 0
  let snapshotGroupsReused = 0
  const updates = []
  const ambiguous = []

  for (const groupRows of groups.values()) {
    const sample = groupRows[0]
    const knownSourceIds = Array.from(new Set((await prisma.examQuestion.findMany({
      where: {
        grade: sample.grade,
        year: sample.year,
        month: sample.month,
        paper: sample.paper,
        NOT: { sourceId: null },
      },
      select: { sourceId: true },
    })).map((item) => String(item.sourceId || '')).filter(Boolean)))

    let winningSourceId = null
    let winningReason = ''

    if (knownSourceIds.length === 1) {
      winningSourceId = knownSourceIds[0]
      winningReason = 'existing-paper-source'
    } else {
      const signatures = groupRows.map((row) => makeSignature(row.questionNumber, row.questionText, row.latex))
      const gradeResources = resourcesByGrade.get(sample.grade) || []
      const metadataCandidates = gradeResources.filter((resource) => resourceMatchesPaperIdentity(resource, sample))

      if (metadataCandidates.length === 1) {
        winningSourceId = metadataCandidates[0].id
        winningReason = 'unique-resource-metadata-match'
      }

      const candidates = []
      const signaturePool = metadataCandidates.length > 0 ? metadataCandidates : gradeResources.filter((resource) => resource.signatures.size > 0)

      for (const resource of signaturePool) {
        let score = 0
        for (const signature of signatures) {
          if (resource.signatures.has(signature)) score += 1
        }
        if (score > 0) {
          candidates.push({
            id: resource.id,
            title: resource.title,
            score,
          })
        }
      }

      candidates.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      const best = candidates[0] || null
      const next = candidates[1] || null
      if (!winningSourceId && best && best.score === signatures.length && (!next || next.score < best.score)) {
        winningSourceId = best.id
        winningReason = 'unique-full-signature-match'
      } else if (!winningSourceId && (candidates.length > 0 || metadataCandidates.length > 1)) {
        ambiguous.push({
          key: paperKey(sample),
          rowCount: groupRows.length,
          metadataCandidates: metadataCandidates.slice(0, 3).map((candidate) => ({ id: candidate.id, title: candidate.title })),
          candidates: candidates.slice(0, 3),
        })
      }
    }

    if (!winningSourceId) {
      if (shouldCreateSnapshots) {
        const snapshotPayload = {
          metadata: {
            grade: sample.grade,
            year: sample.year,
            month: sample.month,
            paper: sample.paper,
            recoveredFrom: 'exam-question-sourceId-backfill',
            generatedAt: new Date().toISOString(),
          },
          questions: groupRows.map((row) => ({
            questionNumber: row.questionNumber,
            questionText: row.questionText,
            latex: row.latex,
            topic: row.topic,
            cognitiveLevel: row.cognitiveLevel,
            marks: row.marks,
            imageUrl: row.imageUrl,
          })),
        }
        const checksum = crypto.createHash('sha256').update(JSON.stringify(snapshotPayload)).digest('hex')

        let snapshot = await prisma.resourceBankItem.findFirst({
          where: { grade: sample.grade, checksum },
          select: { id: true },
        })

        if (!snapshot && shouldWrite) {
          snapshot = await prisma.resourceBankItem.create({
            data: {
              grade: sample.grade,
              title: `Recovered exam paper snapshot · ${String(sample.grade).replace('GRADE_', 'Grade ')} · ${sample.year} ${sample.month} · Paper ${sample.paper}`,
              tag: 'Recovered paper snapshot',
              url: `internal://exam-question-snapshot/${String(sample.grade).toLowerCase()}/${sample.year}/${String(sample.month).toLowerCase()}/paper-${sample.paper}`,
              filename: `${String(sample.grade).toLowerCase()}_${sample.year}_${String(sample.month).toLowerCase()}_paper_${sample.paper}_snapshot.json`,
              contentType: 'application/json',
              checksum,
              source: 'exam-question-snapshot',
              parsedJson: snapshotPayload,
              parsedAt: new Date(),
              parseError: null,
            },
            select: { id: true },
          })
          snapshotGroupsCreated += 1
        } else if (snapshot) {
          snapshotGroupsReused += 1
        }

        if (snapshot) {
          winningSourceId = snapshot.id
          winningReason = 'recovered-paper-snapshot'
        }
      }

      if (!winningSourceId) {
      ambiguousGroups += 1
      continue
      }
    }

    matchedGroups += 1
    updatedRows += groupRows.length
    updates.push({
      ids: groupRows.map((row) => row.id),
      sourceId: winningSourceId,
      reason: winningReason,
      key: paperKey(sample),
    })
  }

  console.log(JSON.stringify({
    scannedRows: rows.length,
    scannedGroups: groups.size,
    scannedResources: resourceRows.length,
    matchedGroups,
    ambiguousGroups,
    snapshotGroupsCreated,
    snapshotGroupsReused,
    updatedRows: shouldWrite ? updatedRows : 0,
    wouldUpdateRows: shouldWrite ? undefined : updatedRows,
    resourceTitles: verbose ? resourceRows.map((resource) => ({ id: resource.id, grade: resource.grade, title: resource.title, filename: resource.filename, source: resource.source })) : undefined,
    groupKeys: verbose ? Array.from(groups.keys()) : undefined,
    sampleAmbiguous: ambiguous.slice(0, 10),
  }, null, 2))

  if (shouldWrite) {
    for (const update of updates) {
      await prisma.examQuestion.updateMany({
        where: { id: { in: update.ids } },
        data: { sourceId: update.sourceId },
      })
    }
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
