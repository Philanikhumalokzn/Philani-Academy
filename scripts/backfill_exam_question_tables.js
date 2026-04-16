const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

function buildQuestionTableMapFromMmd(mmd) {
  const map = new Map()
  if (!String(mmd || '').trim()) return map

  const push = (qNum, tableMarkdown) => {
    if (!qNum || !tableMarkdown) return
    const current = map.get(qNum) || []
    if (!current.includes(tableMarkdown)) current.push(tableMarkdown)
    map.set(qNum, current)
  }

  const collapseNestedTabulars = (input) => {
    let text = input
    let prev = ''
    while (prev !== text) {
      prev = text
      text = text.replace(
        /\\begin\{tabular\}\{[^}]*\}([\s\S]*?)\\end\{tabular\}/g,
        (_match, inner) => String(inner || '')
          .replace(/\\hline/g, '')
          .replace(/\\\\/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      )
    }
    return text
  }

  const tabularToPipeTable = (tabular) => {
    let text = String(tabular || '').trim()
    if (!text.includes('\\begin{tabular}')) return null

    text = text
      .replace(/^\\begin\{tabular\}\{[^}]*\}\s*/i, '')
      .replace(/\s*\\end\{tabular\}\s*$/i, '')

    text = collapseNestedTabulars(text)

    const rows = text
      .split(/\\\\/)
      .map((row) => row.replace(/\\hline/g, '').replace(/[\r\n]+/g, ' ').trim())
      .filter(Boolean)
      .map((row) => row.split('&').map((cell) => cell.trim()).filter((_c, i, arr) => i < arr.length))
      .filter((row) => row.some((cell) => cell.length > 0))

    if (rows.length === 0) return null

    const header = rows.length === 1
      ? rows[0].map(() => '')
      : rows[0]
    const bodyRows = rows.length === 1 ? [rows[0]] : rows.slice(1)
    const width = Math.max(header.length, ...bodyRows.map((row) => row.length))
    const normalizeRow = (row) => Array.from({ length: width }, (_value, index) => row[index] || '')
    const pipeRow = (row) => `| ${normalizeRow(row).join(' | ')} |`

    return [
      pipeRow(header),
      `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
      ...bodyRows.map(pipeRow),
    ].join('\n')
  }

  const isTableLine = (line) => /^\|.*\|\s*$/.test(line)
  const lines = String(mmd || '').split(/\r?\n/)
  let currentTop = ''
  let currentSub = ''

  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '').trim()
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

    if (isTableLine(line)) {
      const block = [line]
      while (i + 1 < lines.length && isTableLine(String(lines[i + 1] || '').trim())) {
        i += 1
        block.push(String(lines[i] || '').trim())
      }

      if (block.length >= 2) {
        const target = currentSub || currentTop
        if (target) push(target, block.join('\n'))
      }
      continue
    }

    if (/\\begin\{tabular\}\{[^}]*\}/.test(line)) {
      const block = [line]
      let depth = (line.match(/\\begin\{tabular\}\{[^}]*\}/g) || []).length - (line.match(/\\end\{tabular\}/g) || []).length
      while (i + 1 < lines.length && depth > 0) {
        i += 1
        const nextLine = String(lines[i] || '').trim()
        block.push(nextLine)
        depth += (nextLine.match(/\\begin\{tabular\}\{[^}]*\}/g) || []).length
        depth -= (nextLine.match(/\\end\{tabular\}/g) || []).length
      }

      const tableMarkdown = tabularToPipeTable(block.join('\n'))
      const target = currentSub || currentTop
      if (target && tableMarkdown) push(target, tableMarkdown)
    }
  }

  return map
}

function pickQuestionTableMarkdown(qNum, tableMap) {
  const direct = tableMap.get(qNum)
  if (direct && direct.length) return direct.join('\n\n')

  const parts = String(qNum || '').split('.').filter(Boolean)
  for (let i = parts.length - 1; i > 0; i -= 1) {
    const parent = parts.slice(0, i).join('.')
    const inherited = tableMap.get(parent)
    if (inherited && inherited.length) return inherited.join('\n\n')
  }

  return null
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
      paper: true,
      year: true,
      month: true,
    },
  })

  const sourceIds = Array.from(new Set(questions.map((q) => String(q.sourceId || '')).filter(Boolean)))
  const resources = await prisma.resourceBankItem.findMany({
    where: { id: { in: sourceIds } },
    select: { id: true, parsedJson: true },
  })

  const tableMaps = new Map()
  for (const resource of resources) {
    const parsed = resource.parsedJson || {}
    const rawMmd = typeof parsed?.raw?.mmd === 'string' ? parsed.raw.mmd : ''
    tableMaps.set(resource.id, buildQuestionTableMapFromMmd(rawMmd))
  }

  let updated = 0
  for (const question of questions) {
    const sourceId = String(question.sourceId || '')
    const tableMap = tableMaps.get(sourceId)
    if (!tableMap) continue

    const tableMarkdown = pickQuestionTableMarkdown(question.questionNumber, tableMap)
    if (!tableMarkdown) continue

    await prisma.examQuestion.update({
      where: { id: question.id },
      data: { tableMarkdown },
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