/* eslint-disable no-console */
const { Client } = require('pg')

function normalizeHierarchyQuestionNumber(value) {
  return String(value || '').trim().replace(/^Q/i, '')
}

function getHierarchyQuestionParts(value) {
  const normalized = normalizeHierarchyQuestionNumber(value)
  if (!normalized) return []
  return normalized.split('.').map((part) => part.trim()).filter(Boolean)
}

function compareHierarchyQuestionNumbers(a, b) {
  const aParts = getHierarchyQuestionParts(a)
  const bParts = getHierarchyQuestionParts(b)

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i += 1) {
    const aPart = Number(aParts[i] ?? 0)
    const bPart = Number(bParts[i] ?? 0)
    if (aPart !== bPart) return aPart - bPart
  }

  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' })
}

function buildQuestionScopeKey(item) {
  if (item.sourceId) return `source:${item.sourceId}`
  return `paper:${item.grade}|${item.year}|${item.month}|${item.paper}`
}

function shapeCompositeBranchItems(items, scopeItems) {
  const scopeItemsByScope = new Map()

  for (const item of scopeItems) {
    const scopeKey = buildQuestionScopeKey(item)
    const list = scopeItemsByScope.get(scopeKey) || []
    list.push(item)
    scopeItemsByScope.set(scopeKey, list)
  }

  const shapedItems = []

  for (const item of items) {
    const normalized = normalizeHierarchyQuestionNumber(item.questionNumber)
    if (!normalized) {
      shapedItems.push(item)
      continue
    }

    const scopeKey = buildQuestionScopeKey(item)
    const scopeSiblings = scopeItemsByScope.get(scopeKey) || []
    const descendantsInScope = scopeSiblings
      .filter((candidate) => {
        const candidateNumber = normalizeHierarchyQuestionNumber(candidate.questionNumber)
        return candidate.id !== item.id && candidateNumber !== normalized && candidateNumber.startsWith(`${normalized}.`)
      })
      .sort((left, right) => compareHierarchyQuestionNumbers(left.questionNumber, right.questionNumber))

    if (descendantsInScope.length === 0) {
      shapedItems.push(item)
      continue
    }

    const terminalDescendants = descendantsInScope.filter((candidate) => {
      const candidateNumber = normalizeHierarchyQuestionNumber(candidate.questionNumber)
      if (!candidateNumber) return false
      return !descendantsInScope.some((other) => {
        if (other.id === candidate.id) return false
        const otherNumber = normalizeHierarchyQuestionNumber(other.questionNumber)
        return otherNumber !== candidateNumber && otherNumber.startsWith(`${candidateNumber}.`)
      })
    })

    if (terminalDescendants.length === 0) {
      shapedItems.push(item)
      continue
    }

    shapedItems.push(...terminalDescendants)
  }

  return shapedItems.filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index)
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim()
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required')
  }

  const args = process.argv.slice(2)
  const deepMode = args.includes('--deep')
  const prefixArg = args.find((arg) => arg.startsWith('--prefix='))
  const prefix = String(prefixArg ? prefixArg.split('=')[1] : '').trim() || '2.1'

  const client = new Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const whereLike = deepMode ? '%' : `${prefix}%`
    const query = await client.query(
      `SELECT
        id,
        "sourceId",
        grade,
        year,
        month,
        paper,
        "questionNumber",
        "questionDepth"
      FROM "ExamQuestion"
      WHERE grade IN ('GRADE_8', 'GRADE_9')
        AND "questionNumber" LIKE $1
      ORDER BY year DESC, month ASC, paper ASC, "questionNumber" ASC
      LIMIT 20000`,
      [whereLike],
    )
    const rows = query.rows

    const byScope = new Map()
    for (const row of rows) {
      const key = buildQuestionScopeKey(row)
      const list = byScope.get(key) || []
      list.push(row)
      byScope.set(key, list)
    }

    let chosenScope = null
    let chosenScopeItems = null
    let chosenPrefix = prefix
    let fallbackDeepest = null

    if (deepMode) {
      for (const [scopeKey, scopeItems] of byScope.entries()) {
        const nums = new Set(scopeItems.map((x) => normalizeHierarchyQuestionNumber(x.questionNumber)))
        const sorted = Array.from(nums).sort(compareHierarchyQuestionNumbers)

        for (const number of sorted) {
          const parts = getHierarchyQuestionParts(number)
          if (!fallbackDeepest || parts.length > fallbackDeepest.parts.length) {
            const fallbackPrefix = parts.length >= 2 ? parts.slice(0, 2).join('.') : number
            fallbackDeepest = {
              scopeKey,
              scopeItems,
              number,
              parts,
              prefix: fallbackPrefix,
            }
          }
          if (parts.length < 4) continue

          const level2 = parts.slice(0, 2).join('.')
          const level3 = parts.slice(0, 3).join('.')
          if (!nums.has(level2) || !nums.has(level3)) continue

          chosenScope = scopeKey
          chosenScopeItems = scopeItems
          chosenPrefix = level2
          break
        }

        if (chosenScope) break
      }
    }

    for (const [scopeKey, scopeItems] of byScope.entries()) {
      if (deepMode) break
      const nums = new Set(scopeItems.map((x) => normalizeHierarchyQuestionNumber(x.questionNumber)))
      if (nums.has(prefix) && nums.has(`${prefix}.1`) && nums.has(`${prefix}.2`)) {
        chosenScope = scopeKey
        chosenScopeItems = scopeItems
        break
      }
    }

    if (!chosenScope || !chosenScopeItems) {
      if (deepMode && fallbackDeepest && fallbackDeepest.parts.length >= 3) {
        chosenScope = fallbackDeepest.scopeKey
        chosenScopeItems = fallbackDeepest.scopeItems
        chosenPrefix = fallbackDeepest.prefix
        console.log('NO_4PART_CHAIN_FOUND_FALLING_BACK_TO_MAX_DEPTH', fallbackDeepest.parts.length)
        console.log('DEEPEST_NUMBER', fallbackDeepest.number)
      } else {
        console.log(deepMode ? 'NO_DEEP_SCOPE_FOUND' : `NO_SCOPE_FOUND_WITH_${prefix}`)
        return
      }
    }

    const targetItems = chosenScopeItems.filter((item) => {
      const normalized = normalizeHierarchyQuestionNumber(item.questionNumber)
      return normalized === chosenPrefix || normalized.startsWith(`${chosenPrefix}.`)
    })

    const shaped = shapeCompositeBranchItems(targetItems, chosenScopeItems)

    const rawNumbers = Array.from(new Set(targetItems.map((item) => normalizeHierarchyQuestionNumber(item.questionNumber))))
      .sort(compareHierarchyQuestionNumbers)
    const shapedNumbers = Array.from(new Set(shaped.map((item) => normalizeHierarchyQuestionNumber(item.questionNumber))))
      .sort(compareHierarchyQuestionNumbers)

    console.log('SCOPE', chosenScope)
  console.log('PREFIX', chosenPrefix)
    console.log('RAW', rawNumbers.join(', '))
    console.log('RESULT_UNITS', shapedNumbers.join(', '))

    const grouped = new Map()
    for (const number of shapedNumbers) {
      const parent = number.split('.').slice(0, -1).join('.') || number
      const list = grouped.get(parent) || []
      list.push(number)
      grouped.set(parent, list)
    }

    for (const [parent, children] of grouped.entries()) {
      if (children.length > 1 && parent === chosenPrefix) {
        console.log('SIBLINGS_RETURNED_SEPARATELY', children.join(' | '))
      }
    }
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
