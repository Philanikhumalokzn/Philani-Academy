const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

function questionNumberParts(qNum) {
  const match = String(qNum || '').trim().match(/(\d+(?:\.\d+)*)/)
  if (!match || !match[1]) return []
  return match[1]
    .split('.')
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part))
}

function extractMarksFromText(value) {
  const text = String(value || '').trim()
  if (!text) return null

  const tailBracketed = text.match(/(?:\(\s*(\d{1,2})\s*(?:marks?|mks?)?\s*\)|\[\s*(\d{1,2})\s*(?:marks?|mks?)?\s*\])\s*$/i)
  const bracketNum = tailBracketed && (tailBracketed[1] || tailBracketed[2])
  if (bracketNum) return Number(bracketNum)

  const tailWord = text.match(/(\d{1,2})\s*(?:marks?|mks?)\s*$/i)
  if (tailWord && tailWord[1]) return Number(tailWord[1])

  return null
}

function buildQuestionMarksMapFromMmd(mmd) {
  const map = new Map()
  if (!String(mmd || '').trim()) return map

  const lines = String(mmd || '').split(/\r?\n/)
  let currentTop = ''
  let currentSub = ''

  const setMark = (qNum, mark) => {
    if (!qNum || mark === null || !Number.isFinite(mark)) return
    if (!map.has(qNum)) map.set(qNum, Math.max(0, Math.round(mark)))
  }

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim()
    if (!line) continue

    const topSectionMatch = line.match(/\\section\*\{\s*QUESTION\s+(\d+)\s*\}/i)
      || line.match(/^QUESTION\s+(\d+)\b/i)
    if (topSectionMatch && topSectionMatch[1]) {
      currentTop = topSectionMatch[1]
      currentSub = ''
    }

    const numberedMatch = line.match(/^((?:\d+)(?:\.\d+){1,5})\b/)
    if (numberedMatch && numberedMatch[1]) {
      const candidate = numberedMatch[1]
      if (!currentTop || candidate === currentTop || candidate.startsWith(`${currentTop}.`)) {
        currentSub = candidate
      }
    }

    const target = currentSub || currentTop
    if (!target) continue

    const inferred = extractMarksFromText(line)
    if (inferred !== null) setMark(target, inferred)
  }

  return map
}

function pickQuestionMarks(qNum, marksMap) {
  const parts = questionNumberParts(qNum)
  if (parts.length === 0) return null

  for (let i = parts.length; i > 0; i -= 1) {
    const key = parts.slice(0, i).join('.')
    if (marksMap.has(key)) return marksMap.get(key)
  }

  return null
}

async function main() {
  const rows = await prisma.examQuestion.findMany({
    where: { marks: null },
    select: {
      id: true,
      sourceId: true,
      questionNumber: true,
      questionText: true,
    },
  })

  const sourceIds = Array.from(new Set(rows.map((row) => String(row.sourceId || '')).filter(Boolean)))
  const resources = sourceIds.length
    ? await prisma.resourceBankItem.findMany({
        where: { id: { in: sourceIds } },
        select: { id: true, parsedJson: true },
      })
    : []

  const marksMapBySource = new Map()
  for (const resource of resources) {
    const parsed = resource.parsedJson || {}
    const rawMmd = typeof parsed.raw?.mmd === 'string' ? parsed.raw.mmd : ''
    marksMapBySource.set(resource.id, buildQuestionMarksMapFromMmd(rawMmd))
  }

  let updated = 0
  let fromQuestionText = 0
  let fromMmd = 0

  for (const row of rows) {
    let marks = extractMarksFromText(row.questionText)
    let source = 'text'

    if (marks === null && row.sourceId) {
      const marksMap = marksMapBySource.get(String(row.sourceId)) || new Map()
      marks = pickQuestionMarks(String(row.questionNumber || ''), marksMap)
      source = 'mmd'
    }

    if (marks === null || !Number.isFinite(marks)) continue

    await prisma.examQuestion.update({
      where: { id: row.id },
      data: { marks: Math.max(0, Math.round(marks)) },
    })

    updated += 1
    if (source === 'text') fromQuestionText += 1
    else fromMmd += 1
  }

  console.log(JSON.stringify({
    scanned: rows.length,
    updated,
    fromQuestionText,
    fromMmd,
    unchanged: rows.length - updated,
  }, null, 2))
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
