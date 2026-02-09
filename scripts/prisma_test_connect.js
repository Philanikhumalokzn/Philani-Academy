const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
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
