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
    if (/\\(begin|end)\{tabular\}|\\hline\b/.test(line)) continue
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

  const normalizeForCompare = (value) => String(value || '')
    .replace(/\\begin\{tabular\}\{[^}]*\}[\s\S]*?\\end\{tabular\}/g, ' ')
    .replace(/\\begin\{tabular\}\{[^}]*\}|\\end\{tabular\}|\\hline/g, ' ')
    .replace(/\\\s*\(/g, '(')
    .replace(/\\\s*\)/g, ')')
    .replace(/(?:^|\s)(?:[^\s&]+\s*&\s*){2,}[^\s&]+(?:\s*\\\\)?/g, ' ')
    .replace(/\\\\/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  const qNorm = normalizeForCompare(qText)
  const pNorm = normalizeForCompare(pText)
  if (!pNorm || qNorm.includes(pNorm) || pNorm.includes(qNorm)) return qText

  const qWords = new Set(qNorm.split(' ').filter(Boolean))
  const pWords = pNorm.split(' ').filter(Boolean)
  let overlap = 0
  for (const word of pWords) {
    if (qWords.has(word)) overlap += 1
  }
  const overlapRatio = pWords.length > 0 ? overlap / pWords.length : 0
  if (overlapRatio >= 0.78) return qText

  return `${pText}\n\n${qText}`
}

function cleanupQuestionTextArtifacts(value) {
  const blocks = String(value || '')
    .replace(/\\begin\{tabular\}\{[^}]*\}[\s\S]*?\\end\{tabular\}/g, ' ')
    .replace(/\\begin\{tabular\}\{[^}]*\}|\\end\{tabular\}|\\hline/g, ' ')
    .replace(/\\\s*\(/g, '(')
    .replace(/\\\s*\)/g, ')')
    .replace(/(?:^|\s)(?:[^\s&]+\s*&\s*){2,}[^\s&]+(?:\s*\\\\)?/g, ' ')
    .replace(/\\\\/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n +/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)

  const normalizeBlock = (block) => block
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/gi, '')
    .trim()
    .toLowerCase()

  if (blocks.length >= 2) {
    const first = normalizeBlock(blocks[0])
    const second = normalizeBlock(blocks[1])
    const wordsA = new Set(first.split(' ').filter(Boolean))
    const wordsB = second.split(' ').filter(Boolean)
    let common = 0
    for (const word of wordsB) {
      if (wordsA.has(word)) common += 1
    }
    const overlapRatio = wordsB.length > 0 ? common / wordsB.length : 0
    const nearDuplicate = first.length >= 80
      && second.length >= 80
      && (first === second || first.includes(second) || second.includes(first) || overlapRatio >= 0.75)
    if (nearDuplicate) {
      const keepFirst = first.length >= second.length
      const deduped = keepFirst ? [blocks[0], ...blocks.slice(2)] : [blocks[1], ...blocks.slice(2)]
      return deduped.join('\n\n').trim()
    }
  }

  return blocks.join('\n\n').trim()
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

    const cleanedText = cleanupQuestionTextArtifacts(question.questionText)
    const preambleText = pickQuestionPreambleText(question.questionNumber, preambleMap)
    const mergedText = preambleText
      ? mergePreambleIntoQuestionText(cleanedText, preambleText)
      : cleanedText
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
