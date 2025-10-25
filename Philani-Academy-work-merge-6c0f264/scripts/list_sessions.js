const prisma = require('../lib/prisma.cjs')

async function main(){
  const sess = await prisma.sessionRecord.findMany()
  console.log(sess)
  process.exit(0)
}

main().catch(e=>{console.error(e); process.exit(1)})
