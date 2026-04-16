const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

function toKey(row) {
  const latex = typeof row.latex === 'string' ? row.latex.trim() : ''
  const text = typeof row.questionText === 'string' ? row.questionText.trim() : ''

  return [
    row.grade,
    row.year,
    row.month,
    row.paper,
    row.questionNumber,
    text,
    latex,
    row.topic || '',
    row.cognitiveLevel == null ? '' : String(row.cognitiveLevel),
    row.marks == null ? '' : String(row.marks),
  ].join('||')
}

async function main() {
  const shouldWrite = process.argv.includes('--write')
  const rows = await prisma.examQuestion.findMany({
    select: {
      id: true,
      grade: true,
      year: true,
      month: true,
      paper: true,
      questionNumber: true,
      questionText: true,
      latex: true,
      topic: true,
      cognitiveLevel: true,
      marks: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  const firstByKey = new Map()
  const duplicateIds = []

  for (const row of rows) {
    const key = toKey(row)
    if (!firstByKey.has(key)) {
      firstByKey.set(key, row.id)
      continue
    }
    duplicateIds.push(row.id)
  }

  console.log(
    `${shouldWrite ? 'Deleting' : 'Would delete'} ${duplicateIds.length} exact duplicate row(s) out of ${rows.length} total exam questions.`,
  )

  if (shouldWrite && duplicateIds.length > 0) {
    const deleted = await prisma.examQuestion.deleteMany({
      where: { id: { in: duplicateIds } },
    })
    console.log(`Deleted ${deleted.count} row(s).`)
  }
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