const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

const globalForPrisma = global
const pool = globalForPrisma.pgPool || new Pool({ connectionString: process.env.DATABASE_URL })
if (process.env.NODE_ENV !== 'production') globalForPrisma.pgPool = pool

const prisma = globalForPrisma.prisma || new PrismaClient({ adapter: new PrismaPg(pool) })
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

module.exports = prisma
