const prisma = require('../lib/prisma.cjs')
const bcrypt = require('bcryptjs')

async function main(){
  const email = 'admin@philani.test'
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    console.log('Admin already exists:', existing)
    process.exit(0)
  }
  const hashed = await bcrypt.hash('AdminPass123!', 10)
  const user = await prisma.user.create({ data: { name: 'Admin User', email, password: hashed, role: 'admin' } })
  console.log('Created admin:', user)
  process.exit(0)
}

main().catch(e=>{ console.error(e); process.exit(1) })
