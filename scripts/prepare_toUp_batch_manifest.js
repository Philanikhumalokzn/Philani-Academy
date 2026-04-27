const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')

function monthCanonical(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return null
  if (['sep', 'september', 'prelim', 'trial'].includes(raw)) return 'September'
  if (['jun', 'june'].includes(raw)) return 'June'
  if (['nov', 'november', 'final'].includes(raw)) return 'November'
  return null
}

function monthUpper(value) {
  const m = monthCanonical(value)
  return m ? m.toUpperCase() : null
}

function extractYearLoose(text) {
  const compactDigits = String(text || '').replace(/(?<=\d)\s+(?=\d)/g, '')
  const hit = compactDigits.match(/\b(20\d{2}|19\d{2})\b/)
  return hit ? Number(hit[1]) : null
}

function looksNational(text) {
  const t = String(text || '').toLowerCase().replace(/\s+/g, ' ')
  return /national\s+senior\s+cert|\bnsc\b|department\s+of\s+basic\s+education|\bdbe\b/.test(t)
}

function looksGautengPrep(text) {
  const t = String(text || '').toLowerCase().replace(/\s+/g, ' ')
  return /gauteng\s+department\s+of\s+education|\bgde\b|\b10611\b|\b10612\b/.test(t)
}

function inferMonth(row) {
  if (row.month) return monthCanonical(row.month)
  const merged = `${row.filename || ''} ${row.coverPreview || ''}`.toLowerCase()
  if (/preparatory\s+examination|\bprelim\b|\btrial\b|\bsept?\b|september/.test(merged)) return 'September'
  if (/\bjune\b|\bjun\b/.test(merged)) return 'June'
  if (/\bnov\b|november|\bfinal\b/.test(merged)) return 'November'
  return null
}

function ensureUniqueTarget(targetBaseName, ext, usedTargets) {
  let candidate = `${targetBaseName}${ext}`
  if (!usedTargets.has(candidate)) {
    usedTargets.add(candidate)
    return candidate
  }
  let idx = 2
  while (true) {
    const next = `${targetBaseName}_ALT${idx}${ext}`
    if (!usedTargets.has(next)) {
      usedTargets.add(next)
      return next
    }
    idx += 1
  }
}

async function main() {
  const reportPath = path.resolve('scripts/cover_manifest_report_toUp.json')
  const dirPath = path.resolve('C:/Users/mandl/Desktop/toUp')
  const rows = JSON.parse(await fsp.readFile(reportPath, 'utf8'))

  const overrides = {
    '2021 KZN June QP.pdf': { paper: 0 },
    'Maths P1 Gr12 June QP 2018 Eng Flatend.pdf': { province: 'EC' },
    'Mathematics P1 (English) QP.pdf': { year: 2023 },
    'Mathematics P1 2016 QP.pdf': { year: 2016 },
    'Mathematics P1 2017 QP.pdf': { year: 2017 },
    'Mathematics P2 2016 QP.pdf': { year: 2016 },
    'Mathematics P2 2017 QP.pdf': { year: 2017 },
    'Maths P2 2018 QP.pdf': { year: 2018 },
  }

  const plan = []
  const renameWarnings = []
  const usedTargets = new Set((await fsp.readdir(dirPath)).map((n) => n.toLowerCase()))

  for (const row of rows) {
    const filename = String(row.filename || '')
    const srcPath = path.join(dirPath, filename)
    const ext = path.extname(filename) || '.pdf'
    const cover = String(row.coverPreview || '')

    const ov = overrides[filename] || {}

    const year = Number.isFinite(ov.year)
      ? ov.year
      : (Number.isFinite(row.year) ? row.year : extractYearLoose(`${filename} ${cover}`))
    let paper = Number.isFinite(row.paper) ? row.paper : null
    if (ov.paper !== undefined) paper = ov.paper

    let province = String(ov.province || row.province || '').trim().toUpperCase() || null
    if (!province && looksGautengPrep(`${filename} ${cover}`)) province = 'GP'
    if (!province && looksNational(`${filename} ${cover}`)) province = 'NATIONAL'

    const month = inferMonth(row)
    const monthUp = monthUpper(month)

    if (!year || !province || !month || !monthUp || paper === null || paper === undefined) {
      plan.push({
        status: 'UNRESOLVED',
        filename,
        reason: { year, province, month, paper },
      })
      continue
    }

    const baseName = `${year} ${province} ${monthUp} P${paper} QP`
    const targetName = ensureUniqueTarget(baseName, '.pdf', usedTargets)
    const targetPath = path.join(dirPath, targetName)

    plan.push({
      status: 'READY',
      filename,
      srcPath,
      targetName,
      targetPath,
      year,
      province,
      month,
      paper,
      title: path.basename(targetName, '.pdf'),
    })
  }

  const unresolved = plan.filter((p) => p.status !== 'READY')
  if (unresolved.length > 0) {
    const unresolvedPath = path.resolve('scripts/upload_manifest_toUp_unresolved.json')
    await fsp.writeFile(unresolvedPath, JSON.stringify(unresolved, null, 2), 'utf8')
    throw new Error(`Unresolved files: ${unresolved.length}. See ${unresolvedPath}`)
  }

  const ready = plan.filter((p) => p.status === 'READY')

  for (const item of ready) {
    if (item.filename.toLowerCase() === item.targetName.toLowerCase()) continue
    if (!fs.existsSync(item.srcPath)) continue
    if (fs.existsSync(item.targetPath) && item.srcPath.toLowerCase() !== item.targetPath.toLowerCase()) {
      throw new Error(`Target already exists: ${item.targetName}`)
    }
    try {
      await fsp.rename(item.srcPath, item.targetPath)
    } catch (error) {
      if (String(error?.code || '') === 'EBUSY') {
        // File is likely open in another process; keep original file name but continue.
        renameWarnings.push({ file: item.filename, target: item.targetName, reason: 'EBUSY' })
        item.targetName = item.filename
        item.targetPath = item.srcPath
        continue
      }
      throw error
    }
  }

  const uploadManifest = ready.map((item) => ({
    path: item.targetPath.replace(/\\/g, '/'),
    title: item.title,
    year: item.year,
    province: item.province,
    paper: item.paper,
    month: item.month,
  }))

  const outPath = path.resolve('scripts/upload_manifest_toUp_next_batch.json')
  await fsp.writeFile(outPath, JSON.stringify(uploadManifest, null, 2), 'utf8')

  console.log(JSON.stringify({
    renamed: ready.filter((r) => r.filename.toLowerCase() !== r.targetName.toLowerCase()).length,
    total: ready.length,
    renameWarnings,
    manifest: outPath,
  }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
