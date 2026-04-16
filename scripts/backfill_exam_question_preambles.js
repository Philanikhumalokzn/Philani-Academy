const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

function buildQuestionPreambleMapFromMmd(mmd) {
  const map = new Map()
  if (!String(mmd || '').trim()) return map

  const lines = String(mmd || '').split(/\r?\n/)
  const preambleLines = new Map()
  const sealed = new Set()
  let currentScope = ''

  const ensureScope = (scope) => {
    if (!scope) return
    if (!preambleLines.has(scope)) preambleLines.set(scope, [])
  }

  const parentScope = (scope) => {
    const parts = String(scope || '').split('.').filter(Boolean)
    if (parts.length <= 1) return ''
    return parts.slice(0, parts.length - 1).join('.')
  }

  const appendPreambleLine = (scope, line) => {
    if (!scope || !line || sealed.has(scope)) return
    ensureScope(scope)
    preambleLines.get(scope).push(line)
  }

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim()
    if (!line) continue

    const topSectionMatch = line.match(/\\section\*\{\s*QUESTION\s+(\d+)\s*\}/i)
      || line.match(/^QUESTION\s+(\d+)\b/i)
    if (topSectionMatch && topSectionMatch[1]) {
      const scope = topSectionMatch[1]
      ensureScope(scope)
      currentScope = scope
      continue
    }

    const numberedMatch = line.match(/^((?:\d+)(?:\.\d+){1,5})\b/)
    if (numberedMatch && numberedMatch[1]) {
      const scope = numberedMatch[1]
      ensureScope(scope)
      const parent = parentScope(scope)
      if (parent) sealed.add(parent)
      currentScope = scope
      continue
    }

    if (/^\|.*\|\s*$/.test(line)) continue
    if (/^!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/.test(line)) continue
    if (/^\\(begin|end)\{tabular\}/.test(line)) continue
    if (/^\\hline\b/.test(line)) continue
    if (/(?:^|\s)(?:[^\s&]+\s*&\s*){2,}[^\s&]+(?:\s*\\\\)?(?:\s*\\hline)?\s*$/i.test(line)) continue

    appendPreambleLine(currentScope, line)
  }

  for (const [scope, scopeLines] of preambleLines.entries()) {
    const text = scopeLines
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) map.set(scope, text)
  }

  return map
}

function pickQuestionPreambleText(qNum, preambleMap) {
  if (!qNum) return null

  const segments = String(qNum || '').split('.').filter(Boolean)
  const candidates = []

  for (let i = 1; i <= segments.length; i += 1) {
    const scope = segments.slice(0, i).join('.')
    const scopePreamble = preambleMap.get(scope)
    if (scopePreamble) candidates.push(scopePreamble)
  }

  if (candidates.length === 0) return null

  const merged = candidates
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  return merged || null
}

function mergePreambleIntoQuestionText(questionText, preamble) {
  const qText = String(questionText || '').trim()
  const pText = String(preamble || '').trim()
  if (!qText) return pText
  if (!pText) return qText

  const normalize = (value) => value.replace(/\s+/g, ' ').trim().toLowerCase()
  const qNorm = normalize(qText)
  const pNorm = normalize(pText)
  if (!pNorm || qNorm.includes(pNorm)) return qText

  return `${pText}\n\n${qText}`
}

async function main() {
  const grade = 'GRADE_12'
  const papers = [1, 2]

  const questions = await prisma.examQuestion.findMany({
    where: {
      grade,
      paper: { in: papers },
      sourceId: { not: null },
    },
    select: {
      id: true,
      sourceId: true,
      questionNumber: true,
      questionText: true,
    },
  })

  const sourceIds = Array.from(new Set(questions.map((q) => String(q.sourceId || '')).filter(Boolean)))
  const resources = await prisma.resourceBankItem.findMany({
    where: { id: { in: sourceIds } },
    select: { id: true, parsedJson: true },
  })

  const preambleMaps = new Map()
  for (const resource of resources) {
    const parsed = resource.parsedJson || {}
    const rawMmd = typeof parsed?.raw?.mmd === 'string' ? parsed.raw.mmd : ''
    preambleMaps.set(resource.id, buildQuestionPreambleMapFromMmd(rawMmd))
  }

  let updated = 0
  for (const question of questions) {
    const sourceId = String(question.sourceId || '')
    const preambleMap = preambleMaps.get(sourceId)
    if (!preambleMap) continue

    const preambleText = pickQuestionPreambleText(question.questionNumber, preambleMap)
    if (!preambleText) continue

    const mergedText = mergePreambleIntoQuestionText(question.questionText, preambleText)
    if (!mergedText || mergedText === question.questionText) continue

    await prisma.examQuestion.update({
      where: { id: question.id },
      data: { questionText: mergedText },
    })

    updated += 1
  }

  console.log(JSON.stringify({ scanned: questions.length, updated }))
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
