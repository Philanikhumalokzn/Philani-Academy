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
    const resources = await prisma.resourceBankItem.findMany({
      where: { grade: 'GRADE_12' },
      select: {
        id: true,
        title: true,
        year: true,
        sessionMonth: true,
        paper: true,
        createdAt: true,
        examQuestions: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })

    const rows = resources.map((r) => ({
      id: r.id,
      title: r.title,
      y: r.year,
      m: r.sessionMonth,
      p: r.paper,
      count: Array.isArray(r.examQuestions) ? r.examQuestions.length : 0,
    }))

    const buckets = {
      zero: rows.filter((r) => r.count === 0).length,
      oneToFive: rows.filter((r) => r.count >= 1 && r.count <= 5).length,
      sixToFifteen: rows.filter((r) => r.count >= 6 && r.count <= 15).length,
      gt15: rows.filter((r) => r.count > 15).length,
    }

    const lowYield = rows.filter((r) => r.count >= 1 && r.count <= 5).slice(0, 40)
    const zero = rows.filter((r) => r.count === 0).slice(0, 40)

    console.log(JSON.stringify({ total: rows.length, buckets, lowYield, zero }, null, 2))
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
