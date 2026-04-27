const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const { put } = require('@vercel/blob')
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

function parseEnvLineValue(raw) {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return ''
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function ensureDatabaseUrlFromEnvFiles() {
  if (process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim()) return
  const candidates = ['.env.local', '.env']
  for (const candidate of candidates) {
    const fullPath = path.join(process.cwd(), candidate)
    if (!fs.existsSync(fullPath)) continue
    const text = fs.readFileSync(fullPath, 'utf8')
    const lines = text.split(/\r?\n/)
    for (const line of lines) {
      const match = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/)
      if (!match || !match[1]) continue
      const value = parseEnvLineValue(match[1])
      if (value) {
        process.env.DATABASE_URL = value
        return
      }
    }
  }
}

ensureDatabaseUrlFromEnvFiles()

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

const GRADE_VALUES = new Set(['GRADE_8', 'GRADE_9', 'GRADE_10', 'GRADE_11', 'GRADE_12'])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function isTransientDbError(error) {
  const message = String(error?.message || '').toLowerCase()
  return (
    message.includes('connection terminated unexpectedly') ||
    message.includes('timed out') ||
    message.includes('connection reset') ||
    message.includes('server closed the connection') ||
    message.includes('cannot fetch data from service')
  )
}

async function withRetries(label, fn, maxAttempts = 4) {
  let lastError = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt >= maxAttempts || !isTransientDbError(error)) break
      console.warn(`[retry ${attempt}/${maxAttempts}] ${label}: ${String(error?.message || error)}`)
      await sleep(900 * attempt)
    }
  }
  throw lastError
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim()
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (!next || String(next).startsWith('--')) {
      out[key] = '1'
      continue
    }
    out[key] = String(next)
    i += 1
  }
  return out
}

function sanitizeFilename(originalName) {
  const parsed = path.parse(originalName || 'resource')
  const safeName = (parsed.name || 'resource').replace(/[^a-z0-9_-]+/gi, '_')
  const safeExt = String(parsed.ext || '').toLowerCase()
  return `${Date.now()}_${safeName}${safeExt}`
}

function detectMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.pdf') return 'application/pdf'
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  return 'application/octet-stream'
}

function normalizeProvince(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return null
  if (['ec', 'eastern cape'].includes(raw)) return 'Eastern Cape'
  if (['fs', 'free state'].includes(raw)) return 'Free State'
  if (['gp', 'gauteng'].includes(raw)) return 'Gauteng'
  if (['kzn', 'kwazulu natal', 'kwazulu-natal'].includes(raw)) return 'KwaZulu-Natal'
  if (['lp', 'lim', 'limpopo'].includes(raw)) return 'Limpopo'
  if (['mp', 'mpumalanga'].includes(raw)) return 'Mpumalanga'
  if (['nc', 'northern cape'].includes(raw)) return 'Northern Cape'
  if (['nw', 'north west'].includes(raw)) return 'North West'
  if (['wc', 'western cape'].includes(raw)) return 'Western Cape'
  return String(value || '').trim() || null
}

function paperModeFromPaper(paper) {
  if (paper === 1) return 'P1'
  if (paper === 2) return 'P2'
  if (paper === 3) return 'P3'
  return 'COMBINED'
}

async function hashFileSha256(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function storeFilePublic(filePath, grade) {
  const originalName = path.basename(filePath)
  const safeName = sanitizeFilename(originalName)
  const relativePath = path.posix.join('resource-bank', String(grade), safeName).replace(/\\/g, '/')
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN
  const mimeType = detectMimeType(filePath)
  const stat = await fsp.stat(filePath)

  if (blobToken) {
    const stream = fs.createReadStream(filePath)
    const blob = await put(relativePath, stream, {
      access: 'public',
      token: blobToken,
      contentType: mimeType,
      addRandomSuffix: false,
    })
    return {
      url: blob.url,
      filename: blob.pathname || relativePath,
      contentType: mimeType,
      size: typeof stat.size === 'number' ? stat.size : null,
    }
  }

  const targetDir = path.join(process.cwd(), 'public', 'resource-bank', String(grade))
  await fsp.mkdir(targetDir, { recursive: true })
  const destination = path.join(targetDir, safeName)
  await fsp.copyFile(filePath, destination)

  return {
    url: `/${relativePath}`,
    filename: relativePath,
    contentType: mimeType,
    size: typeof stat.size === 'number' ? stat.size : null,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const manifestPath = String(args.manifest || '').trim()
  const grade = String(args.grade || 'GRADE_12').trim().toUpperCase()

  if (!manifestPath) throw new Error('Missing --manifest path')
  if (!GRADE_VALUES.has(grade)) throw new Error(`Invalid --grade ${grade}`)

  const raw = await fsp.readFile(path.resolve(manifestPath), 'utf8')
  const items = JSON.parse(raw)
  if (!Array.isArray(items) || items.length === 0) throw new Error('Manifest must be a non-empty JSON array')

  const summary = { scanned: items.length, uploaded: 0, skipped: 0, failed: 0, failures: [] }

  for (let i = 0; i < items.length; i += 1) {
    const row = items[i] || {}
    const filePath = path.resolve(String(row.path || ''))
    const year = Number.parseInt(String(row.year ?? ''), 10)
    const paper = Number.parseInt(String(row.paper ?? ''), 10)
    const province = normalizeProvince(row.province)
    const sessionMonth = String(row.month || '').trim() || null
    const title = String(row.title || path.basename(filePath, path.extname(filePath)) || 'Resource').trim()

    const label = path.basename(filePath)

    try {
      const stat = await fsp.stat(filePath).catch(() => null)
      if (!stat || !stat.isFile()) throw new Error('File not found')
      if (!Number.isFinite(year) || year < 1900 || year > 2100) throw new Error('Invalid year')
      if (!Number.isFinite(paper) || ![0, 1, 2, 3].includes(paper)) throw new Error('Invalid paper (expected 0..3)')
      if (!province) throw new Error('Missing/invalid province')
      if (!sessionMonth) throw new Error('Missing month')

      const checksum = await hashFileSha256(filePath)
      const existing = await withRetries('dedupe lookup', async () => {
        return await prisma.resourceBankItem.findFirst({ where: { grade, checksum } })
      })
      if (existing) {
        summary.skipped += 1
        console.log(`[${i + 1}/${items.length}] skip duplicate: ${label}`)
        continue
      }

      const stored = await storeFilePublic(filePath, grade)

      try {
        await withRetries('create resource row', async () => {
          await prisma.resourceBankItem.create({
            data: {
              grade,
              title,
              province,
              year,
              sessionMonth,
              paper,
              paperMode: paperModeFromPaper(paper),
              url: stored.url,
              filename: stored.filename,
              contentType: stored.contentType,
              size: stored.size,
              checksum,
              source: 'bulk-manual-sequential',
            },
          })
        })
      } catch (createErr) {
        const message = String(createErr?.message || '').toLowerCase()
        const isDuplicate = message.includes('unique constraint failed') && message.includes('grade') && message.includes('checksum')
        if (isDuplicate) {
          summary.skipped += 1
          console.log(`[${i + 1}/${items.length}] skip duplicate (create race): ${label}`)
          continue
        }
        throw createErr
      }

      summary.uploaded += 1
      console.log(`[${i + 1}/${items.length}] uploaded: ${label}`)
    } catch (error) {
      summary.failed += 1
      const msg = error instanceof Error ? error.message : String(error || 'Unknown error')
      summary.failures.push({ file: label, error: msg })
      console.error(`[${i + 1}/${items.length}] failed: ${label} -> ${msg}`)
    }
  }

  console.log(JSON.stringify(summary, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
