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
    const text = scopeLines.join(' ').replace(/\s+/g, ' ').trim()
    if (text) map.set(scope, text)
  }

  return map
}

function buildQuestionImageMapFromMmd(mmd) {
  const map = new Map()
  if (!String(mmd || '').trim()) return map

  const push = (qNum, url) => {
    if (!qNum || !url) return
    const current = map.get(qNum) || []
    if (!current.includes(url)) current.push(url)
    map.set(qNum, current)
  }

  const lines = String(mmd || '').split(/\r?\n/)
  let currentTop = ''
  let currentSub = ''

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

    const imageMatches = line.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)
    for (const match of imageMatches) {
      const url = String(match && match[1] ? match[1] : '').trim()
      if (!url) continue

      if (currentSub) push(currentSub, url)
      else if (currentTop) push(currentTop, url)
    }
  }

  return map
}

function collapseNestedTabulars(input) {
  let text = input
  let prev = ''
  while (prev !== text) {
    prev = text
    text = text.replace(
      /\\begin\{tabular\}\{[^}]*\}((?:(?!\\begin\{tabular\})[\s\S])*?)\\end\{tabular\}/g,
      (_match, inner) => String(inner || '')
        .replace(/\\hline/g, '')
        .replace(/\\\\/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
  }
  return text
}

function tabularToPipeTable(tabular) {
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
    .map((row) => row.split('&').map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell.length > 0))

  if (rows.length === 0) return null

  const header = rows.length === 1 ? rows[0].map(() => '') : rows[0]
  const bodyRows = rows.length === 1 ? [rows[0]] : rows.slice(1)
  const width = Math.max(header.length, ...bodyRows.map((row) => row.length))
  const normalizeRow = (row) => Array.from({ length: width }, (_v, idx) => row[idx] || '')

  const h = normalizeRow(header)
  const separator = Array.from({ length: width }, () => '---')
  const body = bodyRows.map(normalizeRow)

  const toLine = (row) => `| ${row.join(' | ')} |`
  return [toLine(h), toLine(separator), ...body.map(toLine)].join('\n')
}

function buildQuestionTableMapFromMmd(mmd) {
  const map = new Map()
  if (!String(mmd || '').trim()) return map

  const push = (qNum, tableMd) => {
    if (!qNum || !tableMd) return
    const current = map.get(qNum) || []
    if (!current.includes(tableMd)) current.push(tableMd)
    map.set(qNum, current)
  }

  const isPipeLine = (line) => /^\|.*\|\s*$/.test(line)

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
      continue
    }

    const numberedMatch = line.match(/^((?:\d+)(?:\.\d+){1,5})\b/)
    if (numberedMatch && numberedMatch[1]) {
      const candidate = numberedMatch[1]
      if (!currentTop || candidate === currentTop || candidate.startsWith(`${currentTop}.`)) {
        currentSub = candidate
      }
      continue
    }

    // ── Pipe-table block ──────────────────────────────────────────────────────
    if (isPipeLine(line)) {
      const block = [line]
      while (i + 1 < lines.length && isPipeLine(String(lines[i + 1] || '').trim())) {
        i += 1
        block.push(String(lines[i] || '').trim())
      }
      if (block.length >= 2) {
        const target = currentSub || currentTop
        if (target) push(target, block.join('\n'))
      }
      continue
    }

    // ── LaTeX tabular block ───────────────────────────────────────────────────
    if (/\\begin\{tabular\}\{[^}]*\}/.test(line)) {
      const block = [line]
      let depth = (line.match(/\\begin\{tabular\}\{[^}]*\}/g) || []).length
                - (line.match(/\\end\{tabular\}/g) || []).length
      while (i + 1 < lines.length && depth > 0) {
        i += 1
        const nextLine = String(lines[i] || '').trim()
        block.push(nextLine)
        depth += (nextLine.match(/\\begin\{tabular\}\{[^}]*\}/g) || []).length
        depth -= (nextLine.match(/\\end\{tabular\}/g) || []).length
      }
      const tableMd = tabularToPipeTable(block.join('\n'))
      if (!tableMd) continue
      const target = currentSub || currentTop
      if (target) push(target, tableMd)
      continue
    }
  }

  return map
}

function pickQuestionImageUrl(qNum, imageMap) {
  if (!qNum) return null

  const direct = imageMap.get(qNum)
  if (direct && direct.length) return direct[0]

  const parts = String(qNum).split('.').filter(Boolean)
  for (let i = parts.length - 1; i > 0; i -= 1) {
    const parent = parts.slice(0, i).join('.')
    const inherited = imageMap.get(parent)
    if (inherited && inherited.length) return inherited[0]
  }

  return null
}

function pickQuestionTableMarkdown(qNum, tableMap) {
  if (!qNum) return null

  const direct = tableMap.get(qNum)
  if (direct && direct.length) return direct.join('\n\n')

  const parts = String(qNum).split('.').filter(Boolean)
  for (let i = parts.length - 1; i > 0; i -= 1) {
    const parent = parts.slice(0, i).join('.')
    const inherited = tableMap.get(parent)
    if (inherited && inherited.length) return inherited.join('\n\n')

  // For ROOT (depth-0) preamble records we also look at direct children (root.1, root.2…)
  // as a fallback. This covers cases where Mathpix placed the shared preamble diagram or
  // table after the first sub-question marker in the MMD output.
  function pickRootPreambleImageUrls(root, imageMap) {
    const urls = []
    const push = (u) => { if (u && !urls.includes(u)) urls.push(u) }

    // 1. Direct root scope (preamble section images — before any n.x line)
    for (const u of imageMap.get(root) || []) push(u)
    if (urls.length > 0) return urls

    // 2. Fallback: images tagged to direct children (root.1, root.2, …)
    //    Sort children numerically so root.1 is checked before root.2
    const childKeys = Array.from(imageMap.keys())
      .filter((k) => {
        const parts = String(k).split('.')
        return parts.length === 2 && parts[0] === root
      })
      .sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1]))

    for (const key of childKeys) {
      for (const u of imageMap.get(key) || []) push(u)
      if (urls.length > 0) break // take first child that has images
    }

    return urls
  }

  function pickRootPreambleTableMarkdown(root, tableMap) {
    // 1. Direct root scope
    const direct = tableMap.get(root)
    if (direct && direct.length) return direct.join('\n\n')

    // 2. Fallback: first direct child with tables
    const childKeys = Array.from(tableMap.keys())
      .filter((k) => {
        const parts = String(k).split('.')
        return parts.length === 2 && parts[0] === root
      })
      .sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1]))

    for (const key of childKeys) {
      const tables = tableMap.get(key)
      if (tables && tables.length) return tables.join('\n\n')
    }

    return null
  }
  }

  return null
}

function questionNumberParts(qNum) {
  const match = String(qNum || '').trim().match(/(\d+(?:\.\d+)*)/)
  if (!match || !match[1]) return []
  return match[1]
    .split('.')
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part))
}

function questionRootFromNumber(qNum) {
  const parts = questionNumberParts(qNum)
  return parts.length > 0 ? String(parts[0]) : ''
}

function isTopLevelQuestionNumber(qNum, depth) {
  if (typeof depth === 'number') return depth <= 0
  return questionNumberParts(qNum).length <= 1
}

function normalizeQuestionText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
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

async function upsertRootPreamblesForGroup({ sourceId, grade, year, month, paper, existingRows, preambleMap, imageMap, tableMap }) {
  const roots = Array.from(preambleMap.entries())
    .filter(([scope, text]) => !scope.includes('.') && String(text || '').trim().length > 0)
    .sort(([a], [b]) => Number(a) - Number(b))

  let created = 0
  let updated = 0

  for (const [root, preamble] of roots) {
    const preambleText = normalizeQuestionText(preamble)
    if (!preambleText) continue

    const rootImageUrls = pickRootPreambleImageUrls(root, imageMap)
    const rootImageUrl = rootImageUrls[0] || null
    const rootTableMarkdown = pickRootPreambleTableMarkdown(root, tableMap)

    const existingRoot = existingRows.find((row) => {
      const qNum = String(row.questionNumber || '')
      return isTopLevelQuestionNumber(qNum, row.questionDepth) && questionRootFromNumber(qNum) === root
    })

    if (existingRoot) {
      const mergedText = mergePreambleIntoQuestionText(existingRoot.questionText, preambleText)
      const updateData = {}

      if (mergedText && mergedText !== existingRoot.questionText) updateData.questionText = mergedText
      if ((existingRoot.questionDepth || 0) !== 0) updateData.questionDepth = 0
      if (!existingRoot.imageUrl && rootImageUrl) updateData.imageUrl = rootImageUrl
      if (!existingRoot.tableMarkdown && rootTableMarkdown) updateData.tableMarkdown = rootTableMarkdown

      if (Object.keys(updateData).length > 0) {
        await prisma.examQuestion.update({
          where: { id: existingRoot.id },
          data: updateData,
        })
        updated += 1
      }
      continue
    }

    await prisma.examQuestion.create({
      data: {
        sourceId,
        grade,
        year,
        month,
        paper,
        questionNumber: root,
        questionDepth: 0,
        topic: null,
        cognitiveLevel: null,
        marks: null,
        questionText: preambleText,
        latex: null,
        imageUrl: rootImageUrl,
        tableMarkdown: rootTableMarkdown,
        approved: false,
      },
      select: { id: true },
    })

    created += 1
  }

  return { created, updated }
}

async function main() {
  const groups = await prisma.examQuestion.findMany({
    where: { sourceId: { not: null } },
    select: {
      sourceId: true,
      grade: true,
      year: true,
      month: true,
      paper: true,
    },
    distinct: ['sourceId', 'grade', 'year', 'month', 'paper'],
  })

  const sourceIds = Array.from(new Set(groups.map((g) => String(g.sourceId || '')).filter(Boolean)))
  const resources = await prisma.resourceBankItem.findMany({
    where: { id: { in: sourceIds } },
    select: { id: true, parsedJson: true },
  })

  const resourceById = new Map(resources.map((resource) => [resource.id, resource]))

  let scannedGroups = 0
  let createdRoots = 0
  let updatedRoots = 0
  let skippedGroups = 0

  for (const group of groups) {
    const sourceId = String(group.sourceId || '')
    const resource = resourceById.get(sourceId)
    if (!resource) {
      skippedGroups += 1
      continue
    }

    const parsed = resource.parsedJson || {}
    const rawMmd = typeof parsed.raw?.mmd === 'string' ? parsed.raw.mmd : ''
    if (!String(rawMmd || '').trim()) {
      skippedGroups += 1
      continue
    }

    const preambleMap = buildQuestionPreambleMapFromMmd(rawMmd)
    if (preambleMap.size === 0) {
      skippedGroups += 1
      continue
    }

    const imageMap = buildQuestionImageMapFromMmd(rawMmd)
    const tableMap = buildQuestionTableMapFromMmd(rawMmd)

    const existingRows = await prisma.examQuestion.findMany({
      where: {
        sourceId,
        grade: group.grade,
        year: group.year,
        month: group.month,
        paper: group.paper,
      },
      select: {
        id: true,
        questionNumber: true,
        questionDepth: true,
        questionText: true,
        imageUrl: true,
        tableMarkdown: true,
      },
    })

    const result = await upsertRootPreamblesForGroup({
      sourceId,
      grade: group.grade,
      year: group.year,
      month: group.month,
      paper: group.paper,
      existingRows,
      preambleMap,
      imageMap,
      tableMap,
    })

    scannedGroups += 1
    createdRoots += result.created
    updatedRoots += result.updated
  }

  console.log(JSON.stringify({ scannedGroups, createdRoots, updatedRoots, skippedGroups }, null, 2))
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
