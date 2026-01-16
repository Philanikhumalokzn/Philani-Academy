const prisma = require('../lib/prisma.cjs')

async function main(){
  const users = await prisma.user.findMany()
  console.log(users)
  process.exit(0)
}

main().catch(e=>{console.error(e); process.exit(1)})
