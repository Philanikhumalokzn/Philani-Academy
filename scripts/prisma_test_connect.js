const { PrismaClient } = require('@prisma/client');
(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    console.log('local prisma connect ok');
  } catch (e) {
    console.error('local prisma connect err', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
