const prisma = require('../lib/prisma.cjs')

async function main(){
  const rec = await prisma.sessionRecord.create({ data: {
    title: 'Welcome Session',
    description: 'Intro to Philani Academy',
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/sample',
    startsAt: new Date(),
    createdBy: 'script'
  }})
  console.log(rec)
  process.exit(0)
}

main().catch(e=>{console.error(e); process.exit(1)})
