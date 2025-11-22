const prisma = require('../lib/prisma.cjs')
const bcrypt = require('bcryptjs')

async function main(){
  const email = 'admin@philani.test'
  const password = 'admin'
  const hashed = await bcrypt.hash(password, 10)
  const now = new Date()

  const user = await prisma.user.upsert({
    where: { email },
    update: { password: hashed, role: 'admin', name: 'Admin User', emailVerifiedAt: now, phoneVerifiedAt: now },
    create: { name: 'Admin User', email, password: hashed, role: 'admin', emailVerifiedAt: now, phoneVerifiedAt: now }
  })

  console.log('Admin ensured:', { id: user.id, email: user.email, role: user.role })
  process.exit(0)
}

main().catch(e=>{ console.error(e); process.exit(1) })
