const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

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
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  try {
    const sources = await prisma.resourceBankItem.findMany({
      where: { grade: 'GRADE_11', parsedJson: { not: null } },
      select: { id: true, parsedJson: true },
      orderBy: { id: 'asc' },
    })

    let papers = 0
    let totalQuestions = 0
    let withExplicitTopic = 0
    let missingExplicitTopic = 0

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
        select: { questionNumber: true, topic: true },
      })
      const byQ = new Map(annotations.map((row) => [normalizeQuestionNumber(row.questionNumber), row]))

      for (const q of uniqueQuestionNumbers) {
        const ann = byQ.get(normalizeQuestionNumber(q))
        if (ann?.topic && String(ann.topic).trim()) {
          withExplicitTopic += 1
        } else {
          missingExplicitTopic += 1
        }
      }
    }

    console.log('GRADE11_TOPIC_COVERAGE:' + JSON.stringify({ papers, totalQuestions, withExplicitTopic, missingExplicitTopic }))
  } finally {
    await prisma.$disconnect().catch(() => {})
    await pool.end().catch(() => {})
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
