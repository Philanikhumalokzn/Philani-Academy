import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const email = 'admin@philani.test'
  const password = 'admin'
  const hashed = await bcrypt.hash(password, 10)

  await prisma.user.upsert({
    where: { email },
    update: {
      password: hashed,
      role: 'admin',
    },
    create: {
      email,
      password: hashed,
      role: 'admin',
      name: 'Admin',
    },
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
