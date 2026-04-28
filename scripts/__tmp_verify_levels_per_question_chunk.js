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

async function run() {
  const connectionString = String(process.env.DATABASE_URL || '').trim()
  if (!connectionString) throw new Error('DATABASE_URL is required')

  const grade = String(readArg('grade', 'GRADE_12')).trim() || 'GRADE_12'
  const startAfter = String(readArg('startAfter', '')).trim()
  const limit = readIntArg('limit', 20)

  const pool = new Pool({ connectionString })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  try {
    const where = {
      grade,
      parsedJson: { not: null },
      ...(startAfter ? { id: { gt: startAfter } } : {}),
    }

    const sources = await prisma.resourceBankItem.findMany({
      where,
      select: { id: true, parsedJson: true },
      orderBy: { id: 'asc' },
      take: limit,
    })

    let papers = 0
    let totalQuestions = 0
    let missingLevels = 0

    for (const source of sources) {
      const mmd = typeof source?.parsedJson?.raw?.mmd === 'string' ? String(source.parsedJson.raw.mmd).trim() : ''
      if (!mmd) continue

      const sections = extractQuestionSectionsFromMmd(mmd)
      const questionNumbers = []
      for (const [root, section] of sections.entries()) {
        for (const q of extractQuestionNumbersFromSection(section, root)) questionNumbers.push(q)
      }
      const uniqueQuestionNumbers = Array.from(new Set(questionNumbers)).sort((a, b) => compareQuestionNumbers(a, b))
      if (!uniqueQuestionNumbers.length) continue

      papers += 1
      totalQuestions += uniqueQuestionNumbers.length

      const annotations = await prisma.questionAnnotation.findMany({
        where: { sourceId: source.id, questionNumber: { in: uniqueQuestionNumbers } },
        select: { questionNumber: true, cognitiveLevel: true },
      })
      const byQ = new Map(annotations.map((row) => [normalizeQuestionNumber(row.questionNumber), row]))
      for (const q of uniqueQuestionNumbers) {
        const ann = byQ.get(normalizeQuestionNumber(q))
        if (ann?.cognitiveLevel == null) missingLevels += 1
      }
    }

    const nextCursor = sources.length ? sources[sources.length - 1].id : null
    const hasMore = Boolean(
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

    console.log(`RUN_SUMMARY:${JSON.stringify({ papers, totalQuestions, missingLevels, nextCursor, hasMore })}`)
  } finally {
    await prisma.$disconnect().catch(() => {})
    await pool.end().catch(() => {})
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
