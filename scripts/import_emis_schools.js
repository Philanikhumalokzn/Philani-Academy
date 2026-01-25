const fs = require('fs')
const path = require('path')
const prisma = require('../lib/prisma.cjs')
const xlsx = require('xlsx')

function titleCaseWords(value) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  return cleaned
    .split(/\s+/)
    .map(word => word
      .split(/([-'])/)
      .map(part => {
        if (!part || part === '-' || part === "'") return part
        return `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`
      })
      .join('')
    )
    .join(' ')
}

function normalizeSchoolName(value) {
  const normalized = titleCaseWords(String(value || '').replace(/\s+/g, ' ').trim())
  if (!normalized) return ''
  if (/^\d+$/.test(normalized)) return ''
  return normalized
}

function pickNameColumn(columns) {
  const lowered = columns.map(c => String(c || '').toLowerCase().trim())
  const priorities = [
    'official_institution_name',
    'official institution name',
    'institution name',
    'school name',
    'name of school',
    'institutionname',
    'schoolname',
    'school'
  ]
  for (const p of priorities) {
    const idx = lowered.indexOf(p)
    if (idx >= 0) return columns[idx]
  }
  const fuzzyIdx = lowered.findIndex(c => c.includes('institution') && c.includes('name'))
  if (fuzzyIdx >= 0) return columns[fuzzyIdx]
  const schoolIdx = lowered.findIndex(c => c.includes('school') && c.includes('name'))
  if (schoolIdx >= 0) return columns[schoolIdx]
  // fallback to first string-ish column
  return columns[0]
}

async function main() {
  const inputPath = process.argv[2] || path.join(__dirname, 'emis_latest', 'national.xlsx')
  if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`)
    process.exit(1)
  }

  const stat = fs.statSync(inputPath)
  const files = stat.isDirectory()
    ? fs.readdirSync(inputPath).filter(f => /\.(xlsx|xls|csv)$/i.test(f)).map(f => path.join(inputPath, f))
    : [inputPath]

  if (files.length === 0) {
    console.error('No .xlsx/.xls/.csv files found in', inputPath)
    process.exit(1)
  }

  const names = new Set()

  for (const file of files) {
    const workbook = xlsx.readFile(file)
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' })
    if (rows.length === 0) continue

    const columns = Object.keys(rows[0])
    const nameCol = pickNameColumn(columns)
    if (!nameCol) continue

    for (const row of rows) {
      const raw = row[nameCol]
      const normalized = normalizeSchoolName(raw)
      if (normalized) names.add(normalized)
    }
  }

  const schoolModel = prisma.school

  const entries = Array.from(names).map(name => ({ name }))
  const chunkSize = 500
  let created = 0

  for (let i = 0; i < entries.length; i += chunkSize) {
    const chunk = entries.slice(i, i + chunkSize)
    const result = await schoolModel.createMany({ data: chunk, skipDuplicates: true })
    created += result.count || 0
  }

  console.log(`Imported ${created} schools (unique in this run: ${names.size}).`)
  process.exit(0)
}

main().catch(err => {
  console.error('Import failed', err)
  process.exit(1)
})
