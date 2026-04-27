const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const text = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eqIndex = line.indexOf('=')
    if (eqIndex <= 0) continue
    const key = line.slice(0, eqIndex).trim()
    let value = line.slice(eqIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

function normalizeQuestionNumber(value) {
  return String(value || '').trim().replace(/^Q/i, '')
}

async function main() {
  loadEnvFile(path.join(process.cwd(), '.env.local'))

  const grade = String(process.argv[2] || 'GRADE_9').trim()
  const year = Number(process.argv[3] || 2018)
  const month = String(process.argv[4] || 'November').trim()
  const paper = Number(process.argv[5] || 0)
  const root = normalizeQuestionNumber(process.argv[6] || '4')

  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await client.connect()

  try {
    const rowsRes = await client.query(
      `SELECT
        id,
        "sourceId",
        grade,
        year,
        month,
        paper,
        "questionNumber",
        "questionDepth",
        topic,
        "cognitiveLevel",
        approved,
        left(coalesce("questionText", ''), 400) AS "questionTextPreview"
      FROM "ExamQuestion"
      WHERE grade = $1
        AND year = $2
        AND month = $3
        AND paper = $4
        AND ("questionNumber" = $5 OR "questionNumber" LIKE $6)
      ORDER BY "questionNumber" ASC`,
      [grade, year, month, paper, root, `${root}.%`],
    )

    const rows = rowsRes.rows
    console.log('ROWS')
    console.log(JSON.stringify(rows, null, 2))

    const sourceIds = Array.from(new Set(rows.map((r) => String(r.sourceId || '').trim()).filter(Boolean)))
    if (sourceIds.length === 0) {
      console.log('NO_SOURCE_IDS')
      return
    }

    const sourceId = sourceIds[0]
    const sourceRes = await client.query(
      `SELECT id, title, url, "parsedJson"
      FROM "ResourceBankItem"
      WHERE id = $1`,
      [sourceId],
    )

    const source = sourceRes.rows[0]
    const parsed = source && source.parsedJson && typeof source.parsedJson === 'object' ? source.parsedJson : null
    const mmd = parsed && parsed.raw && typeof parsed.raw.mmd === 'string' ? parsed.raw.mmd : ''

    const lines = String(mmd).split(/\r?\n/)
    const headingPattern = new RegExp(`^(?:\\\\section\\*\\{\\s*QUESTION\\s+${root}\\s*\\}|QUESTION\\s+${root}\\b)`, 'i')
    const nextHeadingPattern = /^(?:\\section\*\{\s*QUESTION\s+\d+\s*\}|QUESTION\s+\d+\b)/i

    let start = -1
    for (let i = 0; i < lines.length; i += 1) {
      if (headingPattern.test(String(lines[i] || '').trim())) {
        start = i
        break
      }
    }

    let end = lines.length
    if (start >= 0) {
      for (let i = start + 1; i < lines.length; i += 1) {
        const trimmed = String(lines[i] || '').trim()
        if (!trimmed) continue
        if (nextHeadingPattern.test(trimmed)) {
          end = i
          break
        }
      }
    }

    const section = start >= 0 ? lines.slice(start, end).join('\n') : ''

    console.log('SOURCE')
    console.log(JSON.stringify({ id: source.id, title: source.title, url: source.url }, null, 2))
    console.log('SECTION_MMD_START')
    console.log(section)
    console.log('SECTION_MMD_END')
  } finally {
    await client.end().catch(() => {})
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error)
  process.exit(1)
})
