const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  try {
    const count = await prisma.questionAnnotation.count({
      where: {
        source: { grade: 'GRADE_11' },
        topic: 'Calculus',
      },
    })
    console.log(`GRADE11_CALCULUS_TOPIC_COUNT:${count}`)
  } finally {
    await prisma.$disconnect().catch(() => {})
    await pool.end().catch(() => {})
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
