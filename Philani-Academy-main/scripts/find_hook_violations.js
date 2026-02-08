/*
  Finds likely React hook-rule violations that can cause:
  - Minified React error #310 (Rendered more hooks than during the previous render)

  Heuristics:
  - Flags calls like useMemo/useState/useEffect/... (and any useX identifier)
    when they are inside control-flow (if/ternary/loops/try/switch)
    or inside nested functions.

  Usage:
    node scripts/find_hook_violations.js
*/

const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..')

const INCLUDE_DIRS = ['components', 'pages']
const EXT_RE = /\.(ts|tsx)$/

const KNOWN_BUILTIN_HOOKS = new Set([
  'useState',
  'useEffect',
  'useMemo',
  'useCallback',
  'useRef',
  'useLayoutEffect',
  'useImperativeHandle',
  'useReducer',
  'useContext',
  'useId',
  'useDeferredValue',
  'useTransition',
])

function listFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // skip build artifacts
      if (entry.name === 'node_modules' || entry.name === '.next') continue
      out.push(...listFiles(full))
    } else if (entry.isFile() && EXT_RE.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function isHookCallee(node) {
  if (!ts.isCallExpression(node)) return null

  const expr = node.expression
  if (ts.isIdentifier(expr)) {
    const name = expr.text
    if (KNOWN_BUILTIN_HOOKS.has(name)) return name
    if (/^use[A-Z0-9_]/.test(name)) return name
    return null
  }

  // e.g. React.useMemo
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
    const name = expr.name.text
    if (KNOWN_BUILTIN_HOOKS.has(name)) return name
    if (/^use[A-Z0-9_]/.test(name)) return name
    return null
  }

  return null
}

function hasControlFlowAncestor(ancestors) {
  for (const a of ancestors) {
    if (
      ts.isIfStatement(a) ||
      ts.isConditionalExpression(a) ||
      ts.isForStatement(a) ||
      ts.isForOfStatement(a) ||
      ts.isForInStatement(a) ||
      ts.isWhileStatement(a) ||
      ts.isDoStatement(a) ||
      ts.isSwitchStatement(a) ||
      ts.isCaseClause(a) ||
      ts.isDefaultClause(a) ||
      ts.isTryStatement(a) ||
      ts.isCatchClause(a)
    ) {
      return true
    }
  }
  return false
}

function findNearestFunctionAncestor(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i]
    if (ts.isFunctionLike(a)) return a
  }
  return null
}

function isInsideNestedFunction(ancestors) {
  // Find the closest function-like; if any other function-like exists above it, it's nested.
  let foundClosest = false
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i]
    if (!ts.isFunctionLike(a)) continue
    if (!foundClosest) {
      foundClosest = true
      continue
    }
    return true
  }
  return false
}

function formatLoc(sourceFile, node) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return { line: line + 1, col: character + 1 }
}

function readLine(filePath, line) {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
    return lines[line - 1] || ''
  } catch {
    return ''
  }
}

function run() {
  const files = INCLUDE_DIRS.flatMap((d) => listFiles(path.join(ROOT, d)))
  const findings = []

  for (const filePath of files) {
    const text = fs.readFileSync(filePath, 'utf8')
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.ESNext, true, filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

    function visit(node, ancestors) {
      const hookName = isHookCallee(node)
      if (hookName) {
        const inControlFlow = hasControlFlowAncestor(ancestors)
        const inNestedFn = isInsideNestedFunction(ancestors)

        if (inControlFlow || inNestedFn) {
          const loc = formatLoc(sourceFile, node)
          findings.push({
            filePath,
            hookName,
            line: loc.line,
            col: loc.col,
            inControlFlow,
            inNestedFn,
          })
        }
      }

      ts.forEachChild(node, (child) => visit(child, [...ancestors, node]))
    }

    visit(sourceFile, [])
  }

  if (!findings.length) {
    console.log('No obvious hook-rule violations found.')
    return
  }

  const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/')

  console.log(`Found ${findings.length} suspicious hook calls:`)
  for (const f of findings) {
    const code = readLine(f.filePath, f.line).trim()
    console.log(
      `- ${rel(f.filePath)}:${f.line}:${f.col} ${f.hookName} ` +
        `[controlFlow=${f.inControlFlow ? 'yes' : 'no'} nestedFn=${f.inNestedFn ? 'yes' : 'no'}]` +
        (code ? `\n    ${code}` : '')
    )
  }

  process.exitCode = 1
}

run()
