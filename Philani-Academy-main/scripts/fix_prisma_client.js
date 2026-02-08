const fs = require('fs')
const path = require('path')

function exists(p) {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
}

function copyDir(src, dest) {
  // Node 16+ supports fs.cpSync
  fs.cpSync(src, dest, { recursive: true, force: true })
}

function main() {
  const projectRoot = process.cwd()

  const src = path.join(projectRoot, 'node_modules', '.prisma', 'client')
  const dest = path.join(projectRoot, 'node_modules', '@prisma', 'client', '.prisma', 'client')

  if (!exists(src)) {
    console.log(`[fix_prisma_client] Skip: source not found: ${src}`)
    return
  }

  ensureDir(dest)
  copyDir(src, dest)

  const expected = path.join(dest, 'default.js')
  if (exists(expected)) {
    console.log('[fix_prisma_client] OK: synced generated client into @prisma/client/.prisma')
  } else {
    console.log('[fix_prisma_client] Warning: sync completed but default.js not found')
  }
}

main()
