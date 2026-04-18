import { useEffect, useMemo, useState } from 'react'
import { renderQuestionTextWithInlineLatex } from '../lib/renderQuestionText'
import { renderKatexDisplayHtml } from '../lib/latexRender'

type MmdPaperViewerProps = {
  mmd: string
  selectedQuestionNumber?: string | null
  compact?: boolean
  questionMetaByNumber?: Record<string, {
    topic?: string | null
    cognitiveLevel?: string | number | null
    marksLabel?: string | null
    isFocus?: boolean
  }> | null
}

type Block =
  | { type: 'heading'; key: string; text: string; level: 1 | 2; questionNumber?: string }
  | { type: 'paragraph'; key: string; text: string; questionNumber?: string }
  | { type: 'question-line'; key: string; label: string; body: string; questionNumber: string }
  | { type: 'image'; key: string; url: string; alt: string; questionNumber?: string }
  | { type: 'table'; key: string; lines: string[]; tableKind: 'pipe' | 'latex'; questionNumber?: string }

function normalizeQuestionHeadingNumber(line: string): string | null {
  const match = String(line || '').trim().match(/(?:\\section\*\{\s*QUESTION\s+(\d+)\s*\}|^QUESTION\s+(\d+)\b)/i)
  return match?.[1] || match?.[2] || null
}

function normalizeScopedQuestionNumber(line: string): string | null {
  const match = String(line || '').trim().match(/^((?:\d+)(?:\.\d+){0,6})\b/)
  return match?.[1] || null
}

function extractMarksFromText(value: unknown): number | null {
  const text = String(value ?? '').trim()
  if (!text) return null

  const tailBracketed = text.match(/(?:\(\s*(\d{1,2})\s*(?:marks?|mks?)?\s*\)|\[\s*(\d{1,2})\s*(?:marks?|mks?)?\s*\])\s*$/i)
  const bracketNum = tailBracketed?.[1] || tailBracketed?.[2]
  if (bracketNum) return Number(bracketNum)

  const tailWord = text.match(/(\d{1,2})\s*(?:marks?|mks?)\s*$/i)
  if (tailWord?.[1]) return Number(tailWord[1])

  return null
}

function buildQuestionMarksMapFromMmd(mmd: string): Map<string, number> {
  const map = new Map<string, number>()
  if (!mmd.trim()) return map

  const lines = mmd.split(/\r?\n/)
  let currentTop = ''
  let currentSub = ''

  const setMark = (qNum: string, mark: number | null) => {
    if (!qNum || mark === null || !Number.isFinite(mark)) return
    if (!map.has(qNum)) map.set(qNum, Math.max(0, Math.round(mark)))
  }

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim()
    if (!line) continue

    const topSectionMatch = line.match(/\\section\*\{\s*QUESTION\s+(\d+)\s*\}/i)
      || line.match(/^QUESTION\s+(\d+)\b/i)
    if (topSectionMatch?.[1]) {
      currentTop = topSectionMatch[1]
      currentSub = ''
    }

    const numberedMatch = line.match(/^((?:\d+)(?:\.\d+){1,5})\b/)
    if (numberedMatch?.[1]) {
      const candidate = numberedMatch[1]
      if (!currentTop || candidate === currentTop || candidate.startsWith(`${currentTop}.`)) {
        currentSub = candidate
      }
    }

    const target = currentSub || currentTop
    if (!target) continue

    const inferred = extractMarksFromText(line)
    if (inferred !== null) setMark(target, inferred)
  }

  return map
}

function pickQuestionMarks(qNum: string, marksMap: Map<string, number>): number | null {
  const parts = String(qNum || '').split('.').filter((p) => /^\d+$/.test(p)).map((p) => Number(p))
  if (parts.length === 0) return null

  for (let i = parts.length; i > 0; i -= 1) {
    const key = parts.slice(0, i).join('.')
    if (marksMap.has(key)) return marksMap.get(key) ?? null
  }

  return null
}

function toMarksLabel(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null
  const n = Math.max(0, Math.round(value))
  return `${n} mark${n === 1 ? '' : 's'}`
}

function buildAnchorId(questionNumber: string): string {
  return `mmd-paper-anchor-${String(questionNumber || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()}`
}

function resolveQuestionMeta(
  questionNumber: string,
  questionMetaByNumber?: Record<string, { topic?: string | null; cognitiveLevel?: string | number | null; marksLabel?: string | null; isFocus?: boolean }> | null,
) {
  if (!questionMetaByNumber) return null
  const safe = String(questionNumber || '').trim()
  if (!safe) return null
  const parts = safe.split('.').filter(Boolean)
  for (let i = parts.length; i > 0; i -= 1) {
    const key = parts.slice(0, i).join('.')
    const hit = questionMetaByNumber[key]
    if (hit) return hit
  }
  return null
}

function isPipeTableLine(line: string): boolean {
  const trimmed = String(line || '').trim()
  return trimmed.startsWith('|') && trimmed.endsWith('|')
}

function isLatexTabularStart(line: string): boolean {
  return /\\begin\{tabular\}/.test(String(line || ''))
}

function isAllCapsHeading(line: string): boolean {
  const trimmed = String(line || '').trim()
  if (!trimmed || trimmed.length > 90) return false
  if (/\d/.test(trimmed)) return false
  return /^[A-Z][A-Z\s,&:/()'-]{3,}$/.test(trimmed)
}

function parsePipeTableRows(lines: string[]): string[][] {
  return lines.map((line) => line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()))
}

function buildBlocks(mmd: string): Block[] {
  const lines = String(mmd || '').split(/\r?\n/)
  const blocks: Block[] = []
  let paragraphLines: string[] = []
  let currentQuestionNumber = ''

  const flushParagraph = () => {
    const text = paragraphLines.join('\n').trim()
    if (!text) {
      paragraphLines = []
      return
    }
    blocks.push({
      type: 'paragraph',
      key: `paragraph-${blocks.length}`,
      text,
      questionNumber: currentQuestionNumber || undefined,
    })
    paragraphLines = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = String(lines[index] || '')
    const line = rawLine.trim()

    if (!line) {
      flushParagraph()
      continue
    }

    const headingRoot = normalizeQuestionHeadingNumber(line)
    if (headingRoot) {
      flushParagraph()
      currentQuestionNumber = headingRoot
      blocks.push({
        type: 'heading',
        key: `heading-${blocks.length}`,
        text: `QUESTION ${headingRoot}`,
        level: 1,
        questionNumber: headingRoot,
      })
      continue
    }

    const scopedQuestion = normalizeScopedQuestionNumber(line)
    if (scopedQuestion) {
      flushParagraph()
      currentQuestionNumber = scopedQuestion
      const body = line.replace(/^((?:\d+)(?:\.\d+){0,6})\b\s*/, '').trim()
      blocks.push({
        type: 'question-line',
        key: `question-${blocks.length}`,
        label: scopedQuestion,
        body,
        questionNumber: scopedQuestion,
      })
      continue
    }

    if (isPipeTableLine(line)) {
      flushParagraph()
      const tableLines: string[] = [line]
      // Consume all pipe-table lines, skipping over blank lines between rows
      // so that table rows separated by a single blank are merged into one block.
      while (true) {
        let next = index + 1
        while (next < lines.length && String(lines[next] || '').trim() === '') next++
        if (next < lines.length && isPipeTableLine(String(lines[next] || '').trim())) {
          index = next
          tableLines.push(String(lines[next] || '').trim())
        } else {
          break
        }
      }
      blocks.push({
        type: 'table',
        key: `table-${blocks.length}`,
        lines: tableLines,
        tableKind: 'pipe',
        questionNumber: currentQuestionNumber || undefined,
      })
      continue
    }

    if (isLatexTabularStart(line)) {
      flushParagraph()
      const tableLines: string[] = [rawLine]
      while (index + 1 < lines.length) {
        index += 1
        tableLines.push(String(lines[index] || ''))
        if (/\\end\{tabular\}/.test(String(lines[index] || ''))) break
      }
      // Merge consecutive \begin{tabular} blocks (Mathpix sometimes emits one per row)
      while (true) {
        let next = index + 1
        while (next < lines.length && String(lines[next] || '').trim() === '') next++
        if (next < lines.length && isLatexTabularStart(String(lines[next] || '').trim())) {
          index = next
          tableLines.push(String(lines[index] || ''))
          while (index + 1 < lines.length) {
            index += 1
            tableLines.push(String(lines[index] || ''))
            if (/\\end\{tabular\}/.test(String(lines[index] || ''))) break
          }
        } else {
          break
        }
      }
      blocks.push({
        type: 'table',
        key: `latex-table-${blocks.length}`,
        lines: tableLines,
        tableKind: 'latex',
        questionNumber: currentQuestionNumber || undefined,
      })
      continue
    }

    const imageMatches = Array.from(line.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g))
    if (imageMatches.length > 0) {
      flushParagraph()
      for (const match of imageMatches) {
        blocks.push({
          type: 'image',
          key: `image-${blocks.length}`,
          alt: String(match?.[1] || '').trim(),
          url: String(match?.[2] || '').trim(),
          questionNumber: currentQuestionNumber || undefined,
        })
      }
      const withoutImages = line.replace(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g, '').trim()
      if (withoutImages) paragraphLines.push(withoutImages)
      continue
    }

    if (isAllCapsHeading(line)) {
      flushParagraph()
      blocks.push({
        type: 'heading',
        key: `subheading-${blocks.length}`,
        text: line,
        level: 2,
        questionNumber: currentQuestionNumber || undefined,
      })
      continue
    }

    paragraphLines.push(rawLine)
  }

  flushParagraph()
  return blocks
}

function isSeparatorRow(row: string[]): boolean {
  return row.length > 0 && row.every((cell) => /^[-:]+$/.test(cell.replace(/\s/g, '')))
}

function renderPipeTable(lines: string[]) {
  const rows = parsePipeTableRows(lines).filter((row) => !isSeparatorRow(row))
  if (rows.length === 0) {
    return <pre className="whitespace-pre-wrap text-xs text-slate-700">{lines.join('\n')}</pre>
  }

  return (
    <div className="overflow-x-auto my-2">
      <table className="border-collapse text-sm text-slate-900 [&_.katex]:text-slate-900">
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`cell-${rowIndex}-${cellIndex}`} className="border border-stone-400 px-3 py-1.5 align-top text-slate-900">
                  {renderQuestionTextWithInlineLatex(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function parseLatexTabularRows(lines: string[]): string[][] {
  const raw = lines.join(' ')
  if (!raw.trim()) return []

  const withFlattenedNested = raw.replace(/\\begin\{tabular\}\{[^}]*\}([\s\S]*?)\\end\{tabular\}/g, (_full, inner: string) => {
    return String(inner || '')
      .replace(/\\\\/g, ' | ')
      .replace(/\s+/g, ' ')
      .trim()
  })

  const stripped = withFlattenedNested
    .replace(/\\begin\{tabular\}\{[^}]*\}/g, ' ')
    .replace(/\\end\{tabular\}/g, ' ')
    .replace(/\\hline/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!stripped) return []

  return stripped
    .split(/\\\\/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => row.split('&').map((cell) => cell.trim()).filter((cell) => cell.length > 0))
    .filter((row) => row.length > 0)
}

function renderLatexTabular(lines: string[]) {
  const rows = parseLatexTabularRows(lines)
  if (rows.length === 0) {
    return <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-slate-700">{lines.join('\n')}</pre>
  }

  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const normalizedRows = rows.map((row) => {
    if (row.length >= maxCols) return row
    const next = row.slice()
    while (next.length < maxCols) next.push('')
    return next
  })

  return (
    <div className="overflow-x-auto my-2">
      <table className="border-collapse text-sm text-slate-900 [&_.katex]:text-slate-900">
        <tbody>
          {normalizedRows.map((row, rowIndex) => (
            <tr key={`latex-row-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`latex-cell-${rowIndex}-${cellIndex}`} className="border border-stone-400 px-3 py-1.5 align-top text-slate-900">
                  {renderMmdText(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function stripQuestionPrefix(raw: string): string {
  return String(raw || '').trim().replace(/^Q+/i, '')
}

function normalizeMmdQuestionSpacing(raw: string): string {
  const lines = String(raw || '').split(/\r?\n/)
  const out: string[] = []
  let inTabular = false
  let inCodeFence = false

  for (const line of lines) {
    const trimmed = String(line || '').trim()
    if (/^```/.test(trimmed)) inCodeFence = !inCodeFence
    if (/\\begin\{tabular\}/.test(trimmed)) inTabular = true

    const isScopedQuestionLine = /^\s*Q?(?:\d+)(?:\.\d+){1,6}\b(?:\s|$)/.test(line)
    const isPipeTableLine = /^\s*\|.*\|\s*$/.test(line)

    if (!inTabular && !inCodeFence && isScopedQuestionLine && !isPipeTableLine) {
      // Ensure a visual break between question parts (1.1, 1.2, 1.1.2, ...).
      if (out.length > 0 && String(out[out.length - 1] || '').trim() !== '') {
        out.push('')
      }
    }

    out.push(line)

    if (/\\end\{tabular\}/.test(trimmed)) inTabular = false
  }

  return out.join('\n')
}

function decorateMmdHtmlWithAnchors(html: string): string {
  if (typeof window === 'undefined') return html
  if (!String(html || '').trim()) return ''

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(`<div id="mmd-root">${html}</div>`, 'text/html')
    const root = doc.getElementById('mmd-root')
    if (!root) return html

    const assigned = new Set<string>()
    const candidates = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,div'))

    for (const element of candidates) {
      const text = String(element.textContent || '').replace(/\s+/g, ' ').trim()
      if (!text) continue

      const headingMatch = text.match(/^QUESTION\s+(\d+)\b/i)
      if (headingMatch?.[1]) {
        const questionNumber = headingMatch[1]
        element.classList.add('mmd-question-heading')
        if (element instanceof HTMLElement) {
          element.style.setProperty('font-weight', '700', 'important')
          element.style.setProperty('letter-spacing', '0.01em')
        }
        if (!assigned.has(questionNumber)) {
          element.id = buildAnchorId(questionNumber)
          assigned.add(questionNumber)
        }
        continue
      }

      const scopedMatch = text.match(/^Q?((?:\d+)(?:\.\d+){0,6})\b/)
      if (scopedMatch?.[1]) {
        const questionNumber = stripQuestionPrefix(scopedMatch[1])
        element.classList.add('mmd-question-subpart')
        // Force spacing before sub-question lines even when upstream styles are aggressive.
        if (element instanceof HTMLElement) {
          element.style.setProperty('margin-top', '0.9rem', 'important')
          const depth = questionNumber.split('.').filter(Boolean).length
          const depthIndentRem = Math.max(0, Math.min(depth - 2, 2) * 0.55)
          const hangingIndentRem = Math.max(1.35, Math.min(2.25, questionNumber.length * 0.26 + 0.55))
          element.style.setProperty('padding-left', `${depthIndentRem + hangingIndentRem}rem`)
          element.style.setProperty('text-indent', `-${hangingIndentRem}rem`)
        }
        if (!assigned.has(questionNumber)) {
          element.id = buildAnchorId(questionNumber)
          assigned.add(questionNumber)
        }
      }
    }

    // Normalize table layout for small viewports and keep row-title cells readable.
    const tables = Array.from(root.querySelectorAll('table'))
    for (const table of tables) {
      table.classList.add('mmd-compact-table')

      const rows = Array.from(table.querySelectorAll('tr'))
      for (const row of rows) {
        const firstCell = row.querySelector('th,td')
        if (firstCell) firstCell.classList.add('mmd-row-title')
      }

      const parent = table.parentElement
      if (!parent || parent.classList.contains('mmd-table-wrap')) continue
      const wrapper = doc.createElement('div')
      wrapper.className = 'mmd-table-wrap'
      parent.insertBefore(wrapper, table)
      wrapper.appendChild(table)
    }

    return root.innerHTML
  } catch {
    return html
  }
}

function looksLikeStandaloneLatex(line: string): boolean {
  const trimmed = String(line || '').trim()
  if (!trimmed) return false
  if (trimmed.includes('$') || trimmed.includes('\\(') || trimmed.includes('\\[')) return false
  if (!/\\[a-zA-Z]+/.test(trimmed)) return false
  return /^\\/.test(trimmed) || /:\s*\\/.test(trimmed)
}

function renderMmdText(raw: string) {
  const source = String(raw || '')
  const lines = source.split(/\n/)

  return lines.map((line, index) => {
    const trimmed = line.trim()

    if (!trimmed) {
      return <br key={`mmd-line-break-${index}`} />
    }

    if (looksLikeStandaloneLatex(trimmed)) {
      const colonIdx = trimmed.indexOf(':')
      let prefix = ''
      let expr = trimmed
      if (colonIdx >= 0 && colonIdx + 1 < trimmed.length) {
        const right = trimmed.slice(colonIdx + 1).trim()
        if (/^\\/.test(right)) {
          prefix = trimmed.slice(0, colonIdx + 1).trim()
          expr = right
        }
      }

      const html = renderKatexDisplayHtml(expr)
      if (html) {
        return (
          <span key={`mmd-latex-${index}`} className="block my-1">
            {prefix ? <span className="block mb-1">{renderQuestionTextWithInlineLatex(prefix)}</span> : null}
            <span dangerouslySetInnerHTML={{ __html: html }} />
          </span>
        )
      }
    }

    return <span key={`mmd-line-${index}`}>{renderQuestionTextWithInlineLatex(line)}</span>
  })
}

export default function MmdPaperViewer({ mmd, selectedQuestionNumber, compact = false, questionMetaByNumber = null }: MmdPaperViewerProps) {
  const blocks = useMemo(() => buildBlocks(mmd), [mmd])
  const marksMap = useMemo(() => buildQuestionMarksMapFromMmd(mmd), [mmd])
  const hasQuestionMeta = useMemo(() => {
    if (!questionMetaByNumber) return false
    return Object.keys(questionMetaByNumber).length > 0
  }, [questionMetaByNumber])
  const [renderedHtml, setRenderedHtml] = useState('')
  const [useMathpixRenderer, setUseMathpixRenderer] = useState(false)
  const normalizedSelectedQuestionNumber = stripQuestionPrefix(String(selectedQuestionNumber || ''))
  const selectedRoot = normalizedSelectedQuestionNumber.split('.').filter(Boolean)[0] || ''

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const source = String(mmd || '')
      if (!source.trim()) {
        if (!cancelled) {
          setRenderedHtml('')
          setUseMathpixRenderer(false)
        }
        return
      }

      try {
        const mod = await import('mathpix-markdown-it')
        const MM = (mod as any)?.MathpixMarkdownModel
        if (!MM || typeof MM.markdownToHTML !== 'function') throw new Error('Mathpix renderer unavailable')

        if (typeof window !== 'undefined' && !document.getElementById('mathpix-mmd-viewer-style')) {
          const styleEl = document.createElement('style')
          styleEl.id = 'mathpix-mmd-viewer-style'
          const fonts = typeof MM.getMathpixFontsStyle === 'function' ? MM.getMathpixFontsStyle() : ''
          const styles = typeof MM.getMathpixStyleOnly === 'function' ? MM.getMathpixStyleOnly(false) : ''
          styleEl.textContent = `${fonts}\n${styles}`
          document.head.appendChild(styleEl)
        }

        const htmlRaw = MM.markdownToHTML(normalizeMmdQuestionSpacing(source), {
          htmlTags: false,
          breaks: true,
          centerTables: false,
          centerImages: false,
          parserErrors: 'show_input',
          outMath: {
            include_svg: true,
            include_latex: true,
            include_error: false,
          },
          renderOptions: {
            enable_markdown: true,
            enable_latex: true,
            enable_markdown_mmd_extensions: true,
          },
        } as any)

        const html = decorateMmdHtmlWithAnchors(String(htmlRaw || ''))
        if (!cancelled && html.trim()) {
          setRenderedHtml(html)
          setUseMathpixRenderer(true)
        }
      } catch {
        if (!cancelled) {
          setRenderedHtml('')
          setUseMathpixRenderer(false)
        }
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [mmd])

  useEffect(() => {
    const selected = normalizedSelectedQuestionNumber.trim()
    if (!selected) return

    const tryIds = [selected]
    if (selectedRoot && selectedRoot !== selected) tryIds.push(selectedRoot)

    const timer = window.setTimeout(() => {
      for (const questionNumber of tryIds) {
        const element = document.getElementById(buildAnchorId(questionNumber))
        if (!element) continue
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        break
      }
    }, 120)

    return () => window.clearTimeout(timer)
  }, [normalizedSelectedQuestionNumber, selectedRoot, mmd, renderedHtml, useMathpixRenderer])

  useEffect(() => {
    if (!useMathpixRenderer || !renderedHtml || typeof document === 'undefined') return
    const root = document.getElementById('mmd-paper-viewer-content')
    if (!root) return

    const nodes = Array.from(root.querySelectorAll<HTMLElement>('.mmd-question-heading, .mmd-question-subpart'))
    for (const node of nodes) {
      if (node.querySelector('.mmd-mark-badge')) continue
      const text = String(node.textContent || '').trim()
      const qNum = normalizeQuestionHeadingNumber(text) || normalizeScopedQuestionNumber(text)
      if (!qNum) continue
      const label = toMarksLabel(pickQuestionMarks(qNum, marksMap))
      if (!label) continue

      const badge = document.createElement('span')
      badge.className = 'mmd-mark-badge'
      badge.textContent = label
      badge.style.display = 'inline-block'
      badge.style.marginLeft = '0.45rem'
      badge.style.padding = '0.05rem 0.42rem'
      badge.style.borderRadius = '999px'
      badge.style.border = '1px solid #cbd5e1'
      badge.style.background = '#f8fafc'
      badge.style.color = '#334155'
      badge.style.fontSize = '0.7rem'
      badge.style.fontWeight = '600'
      node.appendChild(badge)
    }
  }, [marksMap, renderedHtml, useMathpixRenderer])

  if (!String(mmd || '').trim()) {
    return <div className="px-4 py-6 text-sm text-slate-500">No MMD document is available for this paper.</div>
  }

  if (compact) {
    return (
      <div className="w-full bg-transparent [&_.katex]:!text-[#1c1e21] [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:max-w-full" style={{ fontFamily: '"Times New Roman", Times, serif' }}>
        <div className="space-y-1">
          {blocks.map((block) => {
            const isSelected = !!normalizedSelectedQuestionNumber && block.questionNumber === normalizedSelectedQuestionNumber
            const isSelectedRoot = !isSelected && !!selectedRoot && block.questionNumber === selectedRoot
            const anchorId = block.questionNumber ? buildAnchorId(block.questionNumber) : undefined
            const selectedClass = isSelected
              ? 'ring-2 ring-sky-300 bg-sky-50/70'
              : isSelectedRoot
                ? 'ring-1 ring-amber-300 bg-amber-50/70'
                : ''

            if (block.type === 'heading') {
              return (
                <section
                  key={block.key}
                  id={anchorId}
                  className={`scroll-mt-24 rounded-2xl px-3 py-3 ${selectedClass}`.trim()}
                >
                  <div className={block.level === 1
                    ? 'text-xl font-bold tracking-[0.06em] text-stone-900'
                    : 'text-sm font-semibold uppercase tracking-[0.18em] text-stone-500'}>
                    {block.text}
                  </div>
                </section>
              )
            }

            if (block.type === 'question-line') {
              const questionMeta = resolveQuestionMeta(block.questionNumber, questionMetaByNumber)
              const marksLabel = questionMeta?.marksLabel || toMarksLabel(pickQuestionMarks(block.questionNumber, marksMap))
              const topicLabel = typeof questionMeta?.topic === 'string' ? questionMeta.topic.trim() : ''
              const cognitiveValue = questionMeta?.cognitiveLevel
              const cognitiveLabel = cognitiveValue === null || cognitiveValue === undefined || String(cognitiveValue).trim() === ''
                ? ''
                : `Level ${String(cognitiveValue).trim()}`
              const selectedBadge = Boolean(questionMeta?.isFocus || isSelected)
              return (
                <section
                  key={block.key}
                  id={anchorId}
                  className={`scroll-mt-24 rounded-2xl border border-[#dbe4f3] bg-white px-3 py-3 ${selectedClass}`.trim()}
                >
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-[#65676b]">Q{block.label}</span>
                    {topicLabel ? <span className="text-xs rounded-full bg-[#e8f4fd] px-2 py-0.5 text-[#1877f2]">{topicLabel}</span> : null}
                    {cognitiveLabel ? <span className="text-xs rounded-full bg-[#fff3cd] px-2 py-0.5 text-[#856404]">{cognitiveLabel}</span> : null}
                    {marksLabel ? <span className="text-xs rounded-full bg-[#f0f2f5] px-2 py-0.5 text-[#4b5563]">{marksLabel}</span> : null}
                    {selectedBadge ? <span className="text-xs rounded-full bg-[#dce9ff] px-2 py-0.5 text-[#1d4ed8]">Selected result</span> : null}
                  </div>
                  <div className="min-w-0 text-[13px] leading-[1.4] text-stone-900 whitespace-pre-wrap break-words">
                    {block.body ? renderMmdText(block.body) : <span className="text-stone-400">Question heading</span>}
                  </div>
                </section>
              )
            }

            if (block.type === 'paragraph') {
              return (
                <section
                  key={block.key}
                  id={anchorId}
                  className={`scroll-mt-24 rounded-2xl px-3 py-1 ${selectedClass}`.trim()}
                >
                  <div className="text-[13px] leading-[1.4] text-stone-900 whitespace-pre-wrap break-words">
                    {renderMmdText(block.text)}
                  </div>
                </section>
              )
            }

            if (block.type === 'image') {
              return (
                <section
                  key={block.key}
                  id={anchorId}
                  className={`scroll-mt-24 rounded-2xl px-3 py-2 ${selectedClass}`.trim()}
                >
                  <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white p-2 shadow-sm">
                    <img
                      src={block.url}
                      alt={block.alt || 'Exam figure'}
                      className="max-h-[520px] w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                </section>
              )
            }

            return (
              <section
                key={block.key}
                id={anchorId}
                className={`scroll-mt-24 rounded-2xl px-3 py-2 ${selectedClass}`.trim()}
              >
                <div className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
                  {block.tableKind === 'pipe'
                    ? renderPipeTable(block.lines)
                    : renderLatexTabular(block.lines)}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="px-0 pb-0 pt-0 h-full" style={{ fontFamily: '"Times New Roman", Times, serif' }}>
      <div className="w-full h-full bg-[#fffdf7] shadow-none">
        <div className="border-b border-stone-200 bg-[linear-gradient(180deg,rgba(255,250,240,0.95),rgba(255,253,247,0.92))] px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-stone-500">Paper View</div>
          <div className="mt-1 text-sm text-stone-600">Continuous MMD rendering of the source paper, with math, tables, images, and question anchors.</div>
        </div>

        <div className="space-y-2 px-2 py-2 sm:px-2">
          {useMathpixRenderer && renderedHtml && !hasQuestionMeta ? (
            <section className="scroll-mt-24 rounded-xl px-0 py-1">
              <div
                id="mmd-paper-viewer-content"
                className="text-[13px] leading-[1.35] text-stone-900 [&_.katex]:text-stone-900 [&_.preview]:!max-w-none [&_.preview]:!mx-0 [&_.preview]:!px-0 [&_.preview-content]:!max-w-none [&_.preview-content]:!mx-0 [&_.preview-content]:!px-0 [&_p]:my-1.5 [&_.mmd-question-subpart]:mt-3 [&_.mmd-table-wrap]:my-1.5 [&_.mmd-table-wrap]:max-w-full [&_.mmd-table-wrap]:overflow-x-auto [&_table]:!border-collapse [&_table]:text-[12px] [&_table]:!border [&_table]:!border-solid [&_table]:!border-stone-500 [&_table]:!text-slate-900 [&_table]:!bg-white [&_.mmd-compact-table]:w-max [&_.mmd-compact-table]:min-w-full [&_.table_tabular]:!border [&_.table_tabular]:!border-solid [&_.table_tabular]:!border-stone-500 [&_.table_tabular]:!bg-white [&_tr]:!border-stone-500 [&_td]:!border [&_td]:!border-solid [&_td]:!border-stone-500 [&_td]:!bg-white [&_td]:!text-slate-900 [&_td]:px-1.5 [&_td]:py-0.5 [&_td]:leading-tight [&_th]:!border [&_th]:!border-solid [&_th]:!border-stone-500 [&_th]:!bg-white [&_th]:!text-slate-900 [&_th]:px-1.5 [&_th]:py-0.5 [&_th]:leading-tight [&_.mmd-row-title]:whitespace-nowrap [&_.mmd-row-title]:font-medium"
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
            </section>
          ) : blocks.map((block) => {
            const isSelected = !!normalizedSelectedQuestionNumber && block.questionNumber === normalizedSelectedQuestionNumber
            const isSelectedRoot = !isSelected && !!selectedRoot && block.questionNumber === selectedRoot
            const anchorId = block.questionNumber ? buildAnchorId(block.questionNumber) : undefined
            const selectedClass = isSelected
              ? 'ring-2 ring-sky-300 bg-sky-50/70'
              : isSelectedRoot
                ? 'ring-1 ring-amber-300 bg-amber-50/70'
                : ''

            if (block.type === 'heading') {
              return (
                <section
                  key={block.key}
                  id={anchorId}
                  className={`scroll-mt-24 rounded-2xl px-3 py-3 ${selectedClass}`.trim()}
                >
                  <div className={block.level === 1
                    ? 'text-xl font-bold tracking-[0.06em] text-stone-900'
                    : 'text-sm font-semibold uppercase tracking-[0.18em] text-stone-500'}>
                    {block.text}
                  </div>
                </section>
              )
            }

            if (block.type === 'question-line') {
              const questionMeta = resolveQuestionMeta(block.questionNumber, questionMetaByNumber)
              const marksLabel = questionMeta?.marksLabel || toMarksLabel(pickQuestionMarks(block.questionNumber, marksMap))
              const topicLabel = typeof questionMeta?.topic === 'string' ? questionMeta.topic.trim() : ''
              const cognitiveValue = questionMeta?.cognitiveLevel
              const cognitiveLabel = cognitiveValue === null || cognitiveValue === undefined || String(cognitiveValue).trim() === ''
                ? ''
                : `Level ${String(cognitiveValue).trim()}`
              const selectedBadge = Boolean(questionMeta?.isFocus || isSelected)
              return (
                <section
                  key={block.key}
                  id={anchorId}
                  className={`scroll-mt-24 rounded-2xl border border-[#dbe4f3] bg-white px-3 py-3 shadow-sm ${selectedClass}`.trim()}
                >
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-[#65676b]">Q{block.label}</span>
                    {topicLabel ? <span className="text-xs rounded-full bg-[#e8f4fd] px-2 py-0.5 text-[#1877f2]">{topicLabel}</span> : null}
                    {cognitiveLabel ? <span className="text-xs rounded-full bg-[#fff3cd] px-2 py-0.5 text-[#856404]">{cognitiveLabel}</span> : null}
                    {marksLabel ? <span className="text-xs rounded-full bg-[#f0f2f5] px-2 py-0.5 text-[#4b5563]">{marksLabel}</span> : null}
                    {selectedBadge ? <span className="text-xs rounded-full bg-[#dce9ff] px-2 py-0.5 text-[#1d4ed8]">Selected result</span> : null}
                  </div>
                  <div className="min-w-0 text-[13px] leading-[1.4] text-stone-900 whitespace-pre-wrap break-words">
                    {block.body ? renderMmdText(block.body) : <span className="text-stone-400">Question heading</span>}
                    </div>
                </section>
              )
            }

            if (block.type === 'paragraph') {
              return (
                <section
                  key={block.key}
                  id={anchorId}
                  className={`scroll-mt-24 rounded-2xl px-3 py-1 ${selectedClass}`.trim()}
                >
                  <div className="text-[13px] leading-[1.4] text-stone-900 whitespace-pre-wrap break-words">
                    {renderMmdText(block.text)}
                  </div>
                </section>
              )
            }

            if (block.type === 'image') {
              return (
                <section
                  key={block.key}
                  id={anchorId}
                  className={`scroll-mt-24 rounded-2xl px-3 py-2 ${selectedClass}`.trim()}
                >
                  <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white p-2 shadow-sm">
                    <img
                      src={block.url}
                      alt={block.alt || 'Exam figure'}
                      className="max-h-[520px] w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                </section>
              )
            }

            return (
              <section
                key={block.key}
                id={anchorId}
                className={`scroll-mt-24 rounded-2xl px-3 py-2 ${selectedClass}`.trim()}
              >
                <div className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
                  {block.tableKind === 'pipe'
                    ? renderPipeTable(block.lines)
                    : renderLatexTabular(block.lines)}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

(MmdPaperViewer as any).displayName = 'MmdPaperViewer'