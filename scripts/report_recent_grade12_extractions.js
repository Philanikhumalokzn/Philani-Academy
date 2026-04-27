const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

function loadEnvIntoProcess() {
  for (const envFile of ['.env.local', '.env']) {
    const full = path.join(process.cwd(), envFile)
    if (!fs.existsSync(full)) continue
    const text = fs.readFileSync(full, 'utf8')
    for (const rawLine of text.split(/\r?\n/)) {
      const line = String(rawLine || '').trim()
      if (!line || line.startsWith('#')) continue
      const idx = line.indexOf('=')
      if (idx <= 0) continue
      const key = line.slice(0, idx).trim()
      let value = line.slice(idx + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
      if (!process.env[key]) process.env[key] = value
    }
  }
}

async function main() {
  loadEnvIntoProcess()
  const dbUrl = String(process.env.DATABASE_URL || '').trim()
  if (!dbUrl) throw new Error('Missing DATABASE_URL')

  const pool = new Pool({ connectionString: dbUrl })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT q."sourceId" as source_id,
             r.title,
             count(*)::int as cnt,
             max(q."createdAt") as last_created
      FROM "ExamQuestion" q
      JOIN "ResourceBankItem" r ON r.id=q."sourceId"
      WHERE q.grade='GRADE_12'
        AND q."createdAt" > now() - interval '2 days'
      GROUP BY q."sourceId", r.title
      ORDER BY last_created DESC
      LIMIT 30
    `)

    console.log(JSON.stringify(rows, null, 2))
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
