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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}

async function main() {
  loadEnvFile(path.join(process.cwd(), '.env.local'))
  const sourceId = String(process.argv[2] || '').trim()
  if (!sourceId) throw new Error('Usage: node scripts/inspect_exam_question_source.js <sourceId>')
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const res = await client.query(
      'SELECT "questionNumber", topic, "questionText" FROM "ExamQuestion" WHERE "sourceId" = $1 ORDER BY "questionNumber" ASC',
      [sourceId],
    )
    console.log(JSON.stringify(res.rows, null, 2))
  } finally {
    await client.end().catch(() => {})
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error)
  process.exit(1)
})
