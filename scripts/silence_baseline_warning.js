const fs = require('fs')
const path = require('path')

const filePath = path.join(
  process.cwd(),
  'node_modules',
  'next',
  'dist',
  'compiled',
  'browserslist',
  'index.js'
)

const warningCall = 'console.warn("[baseline-browser-mapping] The data in this module is over two months old.  To ensure accurate Baseline data, please update: `npm i baseline-browser-mapping@latest -D`")'

try {
  if (!fs.existsSync(filePath)) {
    console.log('[silence-baseline-warning] skipped (next compiled browserslist not found)')
    process.exit(0)
  }

  const source = fs.readFileSync(filePath, 'utf8')
  if (!source.includes(warningCall)) {
    console.log('[silence-baseline-warning] already clean (warning call not found)')
    process.exit(0)
  }

  const updated = source.replaceAll(warningCall, 'void 0')
  fs.writeFileSync(filePath, updated, 'utf8')
  console.log('[silence-baseline-warning] patched next/dist/compiled/browserslist/index.js')
} catch (error) {
  console.error('[silence-baseline-warning] failed:', error && error.message ? error.message : error)
  process.exit(1)
}
