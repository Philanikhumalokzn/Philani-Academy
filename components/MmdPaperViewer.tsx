import { useEffect, useMemo } from 'react'
import { renderQuestionTextWithInlineLatex } from '../lib/renderQuestionText'
import { renderKatexDisplayHtml } from '../lib/latexRender'

type MmdPaperViewerProps = {
  mmd: string
  selectedQuestionNumber?: string | null
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

function buildAnchorId(questionNumber: string): string {
  return `mmd-paper-anchor-${String(questionNumber || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()}`
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

export default function MmdPaperViewer({ mmd, selectedQuestionNumber }: MmdPaperViewerProps) {
  const blocks = useMemo(() => buildBlocks(mmd), [mmd])
  const normalizedSelectedQuestionNumber = stripQuestionPrefix(String(selectedQuestionNumber || ''))
  const selectedRoot = normalizedSelectedQuestionNumber.split('.').filter(Boolean)[0] || ''

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
  }, [normalizedSelectedQuestionNumber, selectedRoot, mmd])

  if (!String(mmd || '').trim()) {
    return <div className="px-4 py-6 text-sm text-slate-500">No MMD document is available for this paper.</div>
  }

  return (
    <div className="px-3 pb-8 pt-3 sm:px-4">
      <div className="mx-auto max-w-4xl rounded-[28px] border border-stone-300 bg-[#fffdf7] shadow-[0_18px_54px_rgba(15,23,42,0.08)]">
        <div className="border-b border-stone-200 bg-[linear-gradient(180deg,rgba(255,250,240,0.95),rgba(255,253,247,0.92))] px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-stone-500">Paper View</div>
          <div className="mt-1 text-sm text-stone-600">Continuous MMD rendering of the source paper, with math, tables, images, and question anchors.</div>
        </div>

        <div className="space-y-4 px-4 py-5 sm:px-6">
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
              return (
                <section
                  key={block.key}
                  id={anchorId}
                  className={`scroll-mt-24 rounded-2xl border border-transparent px-3 py-3 ${selectedClass}`.trim()}
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-[3.25rem] rounded-full bg-stone-900 px-2.5 py-1 text-center text-xs font-semibold text-white">
                      {block.label}
                    </div>
                    <div className="min-w-0 flex-1 text-[15px] leading-7 text-stone-900 whitespace-pre-wrap break-words">
                      {block.body ? renderMmdText(block.body) : <span className="text-stone-400">Question heading</span>}
                    </div>
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
                  <div className="text-[15px] leading-7 text-stone-900 whitespace-pre-wrap break-words">
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