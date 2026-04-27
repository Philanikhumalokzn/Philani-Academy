const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const { put } = require('@vercel/blob')
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

const GRADE_VALUES = new Set(['GRADE_8', 'GRADE_9', 'GRADE_10', 'GRADE_11', 'GRADE_12'])
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.docx'])
const MONTH_NAME_TO_CANONICAL = new Map([
  ['jan', 'January'],
  ['january', 'January'],
  ['feb', 'February'],
  ['february', 'February'],
  ['mar', 'March'],
  ['march', 'March'],
  ['apr', 'April'],
  ['april', 'April'],
  ['may', 'May'],
  ['jun', 'June'],
  ['june', 'June'],
  ['jul', 'July'],
  ['july', 'July'],
  ['aug', 'August'],
  ['august', 'August'],
  ['sep', 'September'],
  ['sept', 'September'],
  ['september', 'September'],
  ['oct', 'October'],
  ['october', 'October'],
  ['nov', 'November'],
  ['november', 'November'],
  ['dec', 'December'],
  ['december', 'December'],
])

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

function toBoolean(value, defaultValue = false) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return defaultValue
  return ['1', 'true', 'yes', 'on', 'y'].includes(raw)
}

function sanitizeFilename(originalName) {
  const parsed = path.parse(originalName || 'resource')
  const safeName = (parsed.name || 'resource').replace(/[^a-z0-9_-]+/gi, '_')
  const safeExt = String(parsed.ext || '').toLowerCase()
  return `${Date.now()}_${safeName}${safeExt}`
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

async function collectFilesRecursive(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true })
  const all = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = await collectFilesRecursive(fullPath)
      all.push(...nested)
      continue
    }
    if (!entry.isFile()) continue
    all.push(fullPath)
  }
  return all
}

function inferMetadataFromName(filename) {
  const base = path.basename(filename, path.extname(filename))
  const normalized = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  const lowered = normalized.toLowerCase()

  const yearMatch = lowered.match(/\b(19\d{2}|20\d{2})\b/)
  const year = yearMatch ? Number(yearMatch[1]) : null

  let sessionMonth = null
  for (const [token, canonical] of MONTH_NAME_TO_CANONICAL.entries()) {
    const rx = new RegExp(`\\b${token}\\b`, 'i')
    if (rx.test(lowered)) {
      sessionMonth = canonical
      break
    }
  }

  let paper = null
  const explicitPaperMatch = lowered.match(/\b(?:paper|p)\s*([123])\b/i)
  if (explicitPaperMatch && explicitPaperMatch[1]) {
    paper = Number(explicitPaperMatch[1])
  }

  let examCycle = null
  if (/\b(prelim|trial)\b/i.test(lowered)) examCycle = 'PRELIM'
  else if (/\b(final|nov(?:ember)?)\b/i.test(lowered)) examCycle = 'FINAL'
  else if (/\b(supp|supplementary)\b/i.test(lowered)) examCycle = 'SUPPLEMENTARY'
  else if (/\b(common\s*test)\b/i.test(lowered)) examCycle = 'COMMON_TEST'
  else if (/\b(quarter|term\s*[1-4]|q[1-4])\b/i.test(lowered)) examCycle = 'QUARTERLY'

  let assessmentType = 'EXAM'
  if (/\btest\b/i.test(lowered)) assessmentType = 'TEST'
  else if (/\bworksheet\b/i.test(lowered)) assessmentType = 'WORKSHEET'
  else if (/\bquiz\b/i.test(lowered)) assessmentType = 'QUIZ'

  const paperMode = paper === 1 ? 'P1' : paper === 2 ? 'P2' : paper === 3 ? 'P3' : 'COMBINED'

  return {
    title: normalized || base || 'Resource',
    year,
    sessionMonth,
    paper,
    paperMode,
    examCycle,
    assessmentType,
  }
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

  const directory = String(args.dir || '').trim()
  if (!directory) {
    throw new Error('Missing --dir. Example: --dir "C:\\\\PastPapers\\\\Grade12"')
  }

  const grade = String(args.grade || 'GRADE_12').trim().toUpperCase()
  if (!GRADE_VALUES.has(grade)) {
    throw new Error(`Invalid --grade '${grade}'. Expected one of: ${Array.from(GRADE_VALUES).join(', ')}`)
  }

  const dryRun = toBoolean(args.dryRun, false)
  const recursive = toBoolean(args.recursive, true)
  const tag = String(args.tag || '').trim() || null
  const sourceName = String(args.sourceName || '').trim() || null
  const province = String(args.province || '').trim() || null
  const authorityScope = String(args.authorityScope || '').trim().toUpperCase() || null
  const examCycleOverride = String(args.examCycle || '').trim().toUpperCase() || null
  const assessmentTypeOverride = String(args.assessmentType || '').trim().toUpperCase() || null
  const assessmentFormality = String(args.assessmentFormality || '').trim().toUpperCase() || null
  const createdById = String(args.createdById || '').trim() || null

  const targetPath = path.resolve(directory)
  const dirStat = await fsp.stat(targetPath).catch(() => null)
  if (!dirStat || !dirStat.isDirectory()) {
    throw new Error(`Directory not found: ${targetPath}`)
  }

  const candidateFiles = recursive
    ? await collectFilesRecursive(targetPath)
    : (await fsp.readdir(targetPath)).map((name) => path.join(targetPath, name))

  const files = candidateFiles.filter((f) => ALLOWED_EXTENSIONS.has(path.extname(f).toLowerCase()))
  if (files.length === 0) {
    console.log(JSON.stringify({ scanned: 0, uploaded: 0, skipped: 0, failed: 0, dryRun }, null, 2))
    return
  }

  const summary = {
    scanned: files.length,
    uploaded: 0,
    skipped: 0,
    failed: 0,
    dryRun,
    grade,
    directory: targetPath,
    failures: [],
  }

  for (let index = 0; index < files.length; index += 1) {
    const filePath = files[index]
    const fileLabel = path.basename(filePath)

    try {
      const checksum = await hashFileSha256(filePath)
      const existing = await prisma.resourceBankItem.findFirst({ where: { grade, checksum } })
      if (existing) {
        summary.skipped += 1
        console.log(`[${index + 1}/${files.length}] skip duplicate: ${fileLabel}`)
        continue
      }

      const inferred = inferMetadataFromName(filePath)
      const metadata = {
        title: inferred.title,
        sourceName,
        authorityScope,
        province,
        examCycle: examCycleOverride || inferred.examCycle,
        assessmentType: assessmentTypeOverride || inferred.assessmentType,
        assessmentFormality: assessmentFormality || null,
        year: inferred.year,
        sessionMonth: inferred.sessionMonth,
        paper: inferred.paper,
        paperMode: inferred.paperMode,
        paperLabelRaw: null,
        tag,
      }

      if (dryRun) {
        summary.uploaded += 1
        console.log(`[${index + 1}/${files.length}] dry-run: ${fileLabel} -> ${metadata.title}`)
        continue
      }

      const stored = await storeFilePublic(filePath, grade)
      await prisma.resourceBankItem.create({
        data: {
          grade,
          title: metadata.title,
          sourceName: metadata.sourceName,
          authorityScope: metadata.authorityScope || null,
          province: metadata.province,
          examCycle: metadata.examCycle || null,
          assessmentType: metadata.assessmentType || null,
          assessmentFormality: metadata.assessmentFormality || null,
          year: metadata.year,
          sessionMonth: metadata.sessionMonth,
          paper: metadata.paper,
          paperMode: metadata.paperMode || null,
          paperLabelRaw: metadata.paperLabelRaw,
          url: stored.url,
          filename: stored.filename,
          contentType: stored.contentType,
          size: stored.size,
          checksum,
          source: 'bulk-script',
          tag: metadata.tag,
          createdById,
        },
      })

      summary.uploaded += 1
      console.log(`[${index + 1}/${files.length}] uploaded: ${fileLabel}`)
    } catch (error) {
      summary.failed += 1
      const message = error instanceof Error ? error.message : String(error || 'Unknown error')
      summary.failures.push({ file: fileLabel, error: message })
      console.error(`[${index + 1}/${files.length}] failed: ${fileLabel} -> ${message}`)
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
