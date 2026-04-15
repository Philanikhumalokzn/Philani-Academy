const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const rows = await prisma.resourceBankItem.findMany({
    where: {
      OR: [
        { title: { contains: 'Mathematics P1 Nov 2024 Eng' } },
        { filename: { contains: 'Mathematics_P1_Nov_2024_Eng' } },
      ],
    },
    select: {
      id: true,
      title: true,
      filename: true,
      parsedAt: true,
      parseError: true,
      url: true,
      grade: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
  console.log(JSON.stringify(rows, null, 2))
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
