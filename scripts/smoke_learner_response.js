const prisma = require('../lib/prisma.cjs')

async function main() {
  const session = await prisma.sessionRecord.findFirst({ select: { id: true, createdBy: true } })
  console.log('session sample', session)

  if (!session) {
    console.log('No sessions in DB; skipping insert test')
    return
  }

  const user = await prisma.user.findFirst({ where: { role: 'student' }, select: { id: true, email: true } })
  console.log('student sample', user)

  if (!user) {
    console.log('No student users in DB; skipping insert test')
    return
  }

  const rec = await prisma.learnerResponse.upsert({
    where: { sessionKey_userId: { sessionKey: session.id, userId: user.id } },
    create: { sessionKey: session.id, userId: user.id, userEmail: user.email, latex: 'x=1' },
    update: { latex: 'x=1', userEmail: user.email },
  })

  console.log('upsert ok', rec.id)

  const list = await prisma.learnerResponse.findMany({ where: { sessionKey: session.id }, take: 5 })
  console.log('count', list.length)
}

main()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await prisma.$disconnect()
    } catch {}
  })
