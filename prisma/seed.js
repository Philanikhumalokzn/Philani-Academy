const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')
const bcrypt = require('bcryptjs')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  const email = 'admin@philani.test'
  const password = 'admin'
  const hashed = await bcrypt.hash(password, 10)

  await prisma.user.upsert({
    where: { email },
    update: { password: hashed, role: 'admin', name: 'Admin' },
    create: { email, password: hashed, role: 'admin', name: 'Admin' }
  })

  console.log('Seed: admin user ensured.')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async err => {
    console.error('Seed error', err)
    await prisma.$disconnect()
    process.exit(1)
  })
