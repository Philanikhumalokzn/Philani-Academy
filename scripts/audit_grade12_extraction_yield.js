const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

function loadEnvIntoProcess() {
  const envFiles = ['.env.local', '.env']
  for (const envFile of envFiles) {
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
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = value
    }
  }
}

function countQuestionRoots(mmd) {
  const lines = String(mmd || '').split(/\r?\n/)
  let c = 0
  for (const lineRaw of lines) {
    const line = String(lineRaw || '').trim()
    if (!line) continue
    if (/^\\section\*\{\s*QUESTION\s+\d+\s*\}/i.test(line)) c += 1
    else if (/^QUESTION\s+\d+\b/i.test(line)) c += 1
  }
  return c
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
      orderBy: { createdAt: 'desc' },
      take: 80,
      select: {
        id: true,
        title: true,
        year: true,
        sessionMonth: true,
        paper: true,
        parsedJson: true,
        createdAt: true,
        examQuestions: {
          select: { id: true, questionNumber: true },
        },
      },
    })

    const rows = resources.map((r) => {
      const parsed = r.parsedJson || {}
      const mmd = typeof parsed?.raw?.mmd === 'string' ? parsed.raw.mmd : ''
      const text = typeof parsed?.text === 'string' ? parsed.text : ''
      const input = (mmd || text)
      const qCount = Array.isArray(r.examQuestions) ? r.examQuestions.length : 0
      const uniqueRoots = new Set((r.examQuestions || []).map((q) => String(q.questionNumber || '').split('.')[0]).filter(Boolean)).size
      return {
        id: r.id,
        title: r.title,
        y: r.year,
        m: r.sessionMonth,
        p: r.paper,
        parsedLen: input.length,
        rootsInMmd: countQuestionRoots(mmd),
        extractedQuestions: qCount,
        extractedRoots: uniqueRoots,
      }
    })

    const suspicious = rows
      .filter((r) => r.parsedLen > 30000 && r.extractedQuestions > 0 && r.extractedQuestions <= 8)
      .sort((a, b) => b.parsedLen - a.parsedLen)

    console.log(JSON.stringify({
      scanned: rows.length,
      suspiciousCount: suspicious.length,
      suspicious: suspicious.slice(0, 40),
      sampleTop: rows.slice(0, 20),
    }, null, 2))
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
