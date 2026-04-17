import { useEffect, useMemo } from 'react'
import { renderQuestionTextWithInlineLatex } from '../lib/renderQuestionText'

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
      while (index + 1 < lines.length && isPipeTableLine(lines[index + 1])) {
        index += 1
        tableLines.push(String(lines[index] || '').trim())
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

function renderPipeTable(lines: string[]) {
  const rows = parsePipeTableRows(lines)
  if (rows.length < 2) {
    return <pre className="whitespace-pre-wrap text-xs text-slate-700">{lines.join('\n')}</pre>
  }

  const header = rows[0]
  const bodyRows = rows.slice(1).filter((row) => !row.every((cell) => /^[-:]+$/.test(cell.replace(/\s/g, ''))))

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-sm text-slate-800">
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th key={`header-${index}`} className="border border-stone-300 bg-stone-100 px-3 py-2 text-left font-semibold">
                {renderQuestionTextWithInlineLatex(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`cell-${rowIndex}-${cellIndex}`} className="border border-stone-200 px-3 py-2 align-top">
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

export default function MmdPaperViewer({ mmd, selectedQuestionNumber }: MmdPaperViewerProps) {
  const blocks = useMemo(() => buildBlocks(mmd), [mmd])
  const selectedRoot = String(selectedQuestionNumber || '').split('.').filter(Boolean)[0] || ''

  useEffect(() => {
    const selected = String(selectedQuestionNumber || '').trim()
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
  }, [selectedQuestionNumber, selectedRoot, mmd])

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
            const isSelected = !!selectedQuestionNumber && block.questionNumber === selectedQuestionNumber
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
                      {block.body ? renderQuestionTextWithInlineLatex(block.body) : <span className="text-stone-400">Question heading</span>}
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
                    {renderQuestionTextWithInlineLatex(block.text)}
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
                    : <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-slate-700">{block.lines.join('\n')}</pre>}
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