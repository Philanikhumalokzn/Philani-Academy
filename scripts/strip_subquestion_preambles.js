/**
 * Reverse-backfill: strip injected parent preamble text from subquestion rows.
 *
 * Subquestions (questionNumber contains '.', e.g. "2.3") should hold only
 * their own statement. Previously, the backfill script prepended the parent
 * preamble as "${preamble}\n\n${ownText}".
 *
 * This script:
 *  1. Loads each subquestion with its source MMD.
 *  2. Builds the preamble map.
 *  3. Checks whether questionText STARTS with the preamble block (≥75% overlap).
 *  4. If so, removes the leading preamble block, keeping only the subquestion's
 *     own statement.
 *
 * Run: DATABASE_URL="..." node scripts/strip_subquestion_preambles.js
 */

const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

// ---------- Preamble map builder (same logic as backfill script) ----------

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
    const text = scopeLines.join(' ').replace(/\s+/g, ' ').trim()
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
  return candidates.join(' ').replace(/\s+/g, ' ').trim() || null
}

// ---------- Normalization for comparison ----------

function normalizeForCompare(value) {
  return String(value || '')
    .replace(/\\begin\{tabular\}\{[^}]*\}[\s\S]*?\\end\{tabular\}/g, ' ')
    .replace(/\\begin\{tabular\}\{[^}]*\}|\\end\{tabular\}|\\hline/g, ' ')
    .replace(/\\\s*\(/g, '(')
    .replace(/\\\s*\)/g, ')')
    .replace(/(?:^|\s)(?:[^\s&]+\s*&\s*){2,}[^\s&]+(?:\s*\\\\)?/g, ' ')
    .replace(/\\\\/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * If `questionText` has a leading preamble block (first paragraph ≥ 75% overlap
 * with `preamble`), return the text with that block removed. Otherwise return null
 * (indicating no change needed).
 */
function stripLeadingPreamble(questionText, preamble) {
  const qt = String(questionText || '').trim()
  const pt = String(preamble || '').trim()
  if (!qt || !pt) return null

  const blocks = qt.split(/\n{2,}/)
  if (blocks.length < 2) return null // Only one block — nothing to strip

  const firstBlock = blocks[0]
  const firstNorm = normalizeForCompare(firstBlock)
  const pNorm = normalizeForCompare(pt)

  if (!firstNorm || !pNorm) return null

  // Check if first block IS the preamble (≥75% token overlap or substring)
  const pWords = pNorm.split(' ').filter(Boolean)
  const firstWords = new Set(firstNorm.split(' ').filter(Boolean))
  let overlap = 0
  for (const word of pWords) {
    if (firstWords.has(word)) overlap += 1
  }
  const overlapRatio = pWords.length > 0 ? overlap / pWords.length : 0
  const isLeadingPreamble =
    pNorm.length >= 40 &&
    (firstNorm === pNorm || firstNorm.includes(pNorm) || pNorm.includes(firstNorm) || overlapRatio >= 0.75)

  if (!isLeadingPreamble) return null

  const rest = blocks.slice(1).join('\n\n').trim()
  return rest || null
}

// ---------- Main ----------

async function main() {
  const grade = 'GRADE_12'
  const papers = [1, 2]

  // Only target subquestions (questionNumber contains a dot)
  const questions = await prisma.examQuestion.findMany({
    where: {
      grade,
      paper: { in: papers },
      sourceId: { not: null },
      questionNumber: { contains: '.' },
    },
    select: {
      id: true,
      sourceId: true,
      questionNumber: true,
      questionText: true,
    },
  })

  console.log(`Found ${questions.length} subquestions to scan`)

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
  let noChange = 0

  for (const question of questions) {
    const sourceId = String(question.sourceId || '')
    const preambleMap = preambleMaps.get(sourceId)
    if (!preambleMap) { noChange += 1; continue }

    const preambleText = pickQuestionPreambleText(question.questionNumber, preambleMap)
    if (!preambleText) { noChange += 1; continue }

    const stripped = stripLeadingPreamble(question.questionText, preambleText)
    if (!stripped) { noChange += 1; continue }

    await prisma.examQuestion.update({
      where: { id: question.id },
      data: { questionText: stripped },
    })

    updated += 1
    console.log(`  stripped preamble from Q${question.questionNumber} (id=${question.id})`)
  }

  console.log(JSON.stringify({ scanned: questions.length, updated, noChange }))
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
