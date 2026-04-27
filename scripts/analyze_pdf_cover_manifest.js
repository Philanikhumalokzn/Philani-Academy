const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')

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

async function listPdfFiles(dirPath) {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.toLowerCase().endsWith('.pdf'))
    .sort((a, b) => a.localeCompare(b))
}

async function extractFirstPageText(filePath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const bytes = await fsp.readFile(filePath)
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) })
  const pdf = await loadingTask.promise
  const page = await pdf.getPage(1)
  const content = await page.getTextContent()
  const text = (content.items || [])
    .map((item) => String(item?.str || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text
}

function findYear(textA, textB) {
  const merged = `${textA} ${textB}`
  const compactDigits = merged.replace(/(?<=\d)\s+(?=\d)/g, '')
  const years = [...compactDigits.matchAll(/\b(20\d{2}|19\d{2})\b/g)].map((m) => Number(m[1]))
  if (years.length === 0) return null
  const sensible = years.filter((y) => y >= 2005 && y <= 2030)
  return sensible.length ? sensible[0] : years[0]
}

function findPaper(textA, textB) {
  const merged = `${textA} ${textB}`.toLowerCase()
  const normalized = merged.replace(/\s+/g, ' ')
  const m = normalized.match(/\b(?:paper|p)\s*([123])\b/)
  if (m && m[1]) return Number(m[1])
  return null
}

function findMonth(textA, textB) {
  const merged = `${textA} ${textB}`.toLowerCase()
  if (/\b(prelim|trial|september|sept|\bs\d{2}\b)\b/.test(merged)) return 'September'
  if (/\b(june|jun|mid[-\s]?year)\b/.test(merged)) return 'June'
  if (/\b(november|nov|final)\b/.test(merged)) return 'November'
  return null
}

function findProvince(textA, textB) {
  const merged = `${textA} ${textB}`.toLowerCase()
  const compact = merged
    .replace(/\s+/g, ' ')
    .replace(/\bcertifica\s+t\s+e\b/g, 'certificate')
    .replace(/\brepu\s*8uc\b/g, 'republic')
  const patterns = [
    { key: 'EC', rx: /\b(eastern\s+cape|\bec\b)\b/i },
    { key: 'FS', rx: /\b(free\s+state|\bfs\b)\b/i },
    { key: 'GP', rx: /\b(gauteng|\bgp\b)\b/i },
    { key: 'KZN', rx: /\b(kwazulu[-\s]?natal|\bkzn\b)\b/i },
    { key: 'LIM', rx: /\b(limpopo|\blim\b|\blp\b)\b/i },
    { key: 'MP', rx: /\b(mpumalanga|\bmp\b)\b/i },
    { key: 'NC', rx: /\b(northern\s+cape|\bnc\b)\b/i },
    { key: 'NW', rx: /\b(north\s+west|\bnw\b)\b/i },
    { key: 'WC', rx: /\b(western\s+cape|\bwc\b)\b/i },
    { key: 'NATIONAL', rx: /\b(national\s+senior\s+certificate|department\s+of\s+basic\s+education|\bnsc\b|\bdbe\b)\b/i },
  ]
  for (const p of patterns) {
    if (p.rx.test(compact)) return p.key
  }
  return null
}

function normalizedName({ year, province, month, paper }) {
  if (!year || !province || !month || !paper) return null
  return `${year} ${province} ${month} P${paper} QP.pdf`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const dir = String(args.dir || '').trim()
  if (!dir) throw new Error('Missing --dir')

  const outPath = path.resolve(String(args.out || 'scripts/cover_manifest_report.json'))
  const dirPath = path.resolve(dir)
  if (!fs.existsSync(dirPath)) throw new Error(`Directory not found: ${dirPath}`)

  const files = await listPdfFiles(dirPath)
  const report = []

  for (let i = 0; i < files.length; i += 1) {
    const filename = files[i]
    const fullPath = path.join(dirPath, filename)
    let coverText = ''
    let error = null
    try {
      coverText = await extractFirstPageText(fullPath)
    } catch (err) {
      error = String(err?.message || err)
    }

    const year = findYear(filename, coverText)
    const paper = findPaper(filename, coverText)
    const month = findMonth(filename, coverText)
    const province = findProvince(filename, coverText)
    const normalized = normalizedName({ year, province, month, paper })

    report.push({
      filename,
      path: fullPath,
      year,
      province,
      month,
      paper,
      normalized,
      ambiguous: !(year && province && month && paper),
      error,
      coverPreview: String(coverText || '').slice(0, 360),
    })

    const status = !(year && province && month && paper) ? 'AMBIGUOUS' : 'OK'
    console.log(`[${i + 1}/${files.length}] ${status} ${filename}`)
  }

  await fsp.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8')

  const totals = {
    scanned: report.length,
    resolvable: report.filter((r) => !r.ambiguous).length,
    ambiguous: report.filter((r) => r.ambiguous).length,
    errors: report.filter((r) => r.error).length,
    output: outPath,
  }

  console.log(JSON.stringify(totals, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
