import path from 'path'
import { promises as fs } from 'fs'
import { put } from '@vercel/blob'

type NormalizedBBox = { x: number; y: number; w: number; h: number }

async function ensurePdfJsDomPolyfills() {
  const g: any = globalThis as any
  if (typeof g.DOMMatrix !== 'undefined') return
  try {
    const mod: any = await import('dommatrix')
    const DOMMatrix = mod?.DOMMatrix || mod?.default?.DOMMatrix || mod?.default || null
    const DOMPoint = mod?.DOMPoint || mod?.default?.DOMPoint || null
    if (DOMMatrix) g.DOMMatrix = DOMMatrix
    if (DOMPoint && typeof g.DOMPoint === 'undefined') g.DOMPoint = DOMPoint
  } catch {
    // If polyfill load fails, pdfjs will likely throw; keep error surface explicit.
  }
}

export type ParsedPdfLine = {
  text: string
  bbox: NormalizedBBox
}

export type ParsedPdfDiagram = {
  url: string
  pathname: string
  bbox: NormalizedBBox
  nearestLineIndex: number | null
}

export type ParsedPdfPage = {
  pageNumber: number
  width: number
  height: number
  lines: ParsedPdfLine[]
  diagrams: ParsedPdfDiagram[]
}

export type ParsedPdfResult = {
  version: 1
  kind: 'pdf'
  resourceId: string
  extractedAt: string
  pages: ParsedPdfPage[]
  questions: Array<{
    index: number
    label: string
    pageNumber: number
    startLine: number
    endLine: number
    text: string
  }>
}

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function normalizeBBox(px: { x1: number; y1: number; x2: number; y2: number }, pageW: number, pageH: number): NormalizedBBox {
  const x1 = Math.min(px.x1, px.x2)
  const x2 = Math.max(px.x1, px.x2)
  const y1 = Math.min(px.y1, px.y2)
  const y2 = Math.max(px.y1, px.y2)

  const w = pageW || 1
  const h = pageH || 1

  return {
    x: clamp01(x1 / w),
    y: clamp01(y1 / h),
    w: clamp01((x2 - x1) / w),
    h: clamp01((y2 - y1) / h),
  }
}

function segmentQuestions(pages: ParsedPdfPage[]) {
  const questions: ParsedPdfResult['questions'] = []

  const startsQuestion = (line: string) => {
    const s = (line || '').trim()
    if (!s) return false
    return (
      /^question\s+\d+/i.test(s) ||
      /^\d+\s*[\.)]/.test(s) ||
      /^\d+\.\d+/.test(s) ||
      /^\([a-z]\)/i.test(s)
    )
  }

  let qIndex = 0

  for (const page of pages) {
    const lines = page.lines

    let currentStart = -1
    let currentLabel = ''

    const flush = (endExclusive: number) => {
      if (currentStart < 0) return
      const startLine = currentStart
      const endLine = Math.max(startLine, endExclusive - 1)
      const text = lines
        .slice(startLine, endExclusive)
        .map(l => l.text)
        .join('\n')
        .trim()
      if (!text) {
        currentStart = -1
        currentLabel = ''
        return
      }

      questions.push({
        index: qIndex++,
        label: currentLabel || `Q${qIndex}`,
        pageNumber: page.pageNumber,
        startLine,
        endLine,
        text,
      })

      currentStart = -1
      currentLabel = ''
    }

    for (let i = 0; i < lines.length; i++) {
      const text = lines[i]?.text || ''
      if (startsQuestion(text)) {
        flush(i)
        currentStart = i
        currentLabel = text.split(/\s+/).slice(0, 3).join(' ')
      }
    }

    flush(lines.length)
  }

  return questions
}

async function storePng(opts: {
  grade: string
  resourceId: string
  pageNumber: number
  index: number
  pngBuffer: Buffer
}) {
  const safeGrade = String(opts.grade)
  const relativePath = path.posix
    .join('resource-bank', safeGrade, 'parsed', String(opts.resourceId), `p${opts.pageNumber}_img${opts.index}.png`)
    .replace(/\\/g, '/')

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN
  let publicUrl = `/${relativePath}`
  let storedPath = relativePath

  if (blobToken) {
    const blob = await put(relativePath, opts.pngBuffer, {
      access: 'public',
      token: blobToken,
      contentType: 'image/png',
      addRandomSuffix: false,
    })
    publicUrl = blob.url
    storedPath = blob.pathname || relativePath
  } else {
    const absoluteDestination = path.join(process.cwd(), 'public', relativePath)
    await fs.mkdir(path.dirname(absoluteDestination), { recursive: true })
    await fs.writeFile(absoluteDestination, opts.pngBuffer)
  }

  return { url: publicUrl, pathname: storedPath }
}

async function getPageObject(page: any, name: string): Promise<any> {
  return await new Promise((resolve) => {
    try {
      page.objs.get(name, (obj: any) => resolve(obj))
    } catch {
      resolve(null)
    }
  })
}

export async function parsePdfResource(opts: {
  resourceId: string
  grade: string
  pdfBuffer: Buffer
  maxPages?: number
  maxDiagramsPerPage?: number
}): Promise<ParsedPdfResult> {
  const maxPages = typeof opts.maxPages === 'number' ? opts.maxPages : 35
  const maxDiagramsPerPage = typeof opts.maxDiagramsPerPage === 'number' ? opts.maxDiagramsPerPage : 25

  await ensurePdfJsDomPolyfills()
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { PNG }: any = await import('pngjs')

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(opts.pdfBuffer),
    disableWorker: true,
    verbosity: 0,
  })

  const pdf = await loadingTask.promise
  const totalPages = Math.min(pdf.numPages || 0, maxPages)

  const pages: ParsedPdfPage[] = []

  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const pageW = viewport.width || 1
    const pageH = viewport.height || 1

    const textContent = await page.getTextContent()

    const rawTextItems = (Array.isArray(textContent?.items) ? textContent.items : []) as any[]

    const spans = rawTextItems
      .map((item) => {
        const str = typeof item?.str === 'string' ? item.str : ''
        const text = str.replace(/\s+/g, ' ').trim()
        if (!text) return null

        const tx = pdfjs.Util.transform(viewport.transform, item.transform)
        const x = tx[4]
        const y = tx[5]
        const fontHeight = Math.max(1, Math.hypot(tx[2], tx[3]) || item.height || 0)
        const width = Math.max(1, Number(item.width) || 0)

        // y is baseline; shift up for a rough top-left.
        const bboxPx = { x1: x, y1: y - fontHeight, x2: x + width, y2: y }

        return {
          text,
          bboxPx,
        }
      })
      .filter(Boolean) as Array<{ text: string; bboxPx: { x1: number; y1: number; x2: number; y2: number } }>

    // Group spans into lines by y proximity.
    spans.sort((a, b) => (a.bboxPx.y1 - b.bboxPx.y1) || (a.bboxPx.x1 - b.bboxPx.x1))

    const lines: ParsedPdfLine[] = []
    const lineBuckets: Array<{ y: number; spans: typeof spans }> = []

    for (const s of spans) {
      const y = s.bboxPx.y1
      let bucket = lineBuckets[lineBuckets.length - 1]
      const threshold = 0.012 * pageH
      if (!bucket || Math.abs(bucket.y - y) > threshold) {
        bucket = { y, spans: [] as any }
        lineBuckets.push(bucket)
      }
      bucket.spans.push(s)
    }

    for (const bucket of lineBuckets) {
      const bucketSpans = bucket.spans.slice().sort((a, b) => a.bboxPx.x1 - b.bboxPx.x1)
      const text = bucketSpans.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim()
      if (!text) continue

      const x1 = Math.min(...bucketSpans.map(s => s.bboxPx.x1))
      const y1 = Math.min(...bucketSpans.map(s => s.bboxPx.y1))
      const x2 = Math.max(...bucketSpans.map(s => s.bboxPx.x2))
      const y2 = Math.max(...bucketSpans.map(s => s.bboxPx.y2))

      lines.push({
        text,
        bbox: normalizeBBox({ x1, y1, x2, y2 }, pageW, pageH),
      })
    }

    // Extract image XObjects + their transforms.
    const operatorList = await page.getOperatorList()
    const fnArray: number[] = operatorList?.fnArray || []
    const argsArray: any[] = operatorList?.argsArray || []

    const OPS = pdfjs.OPS
    const Util = pdfjs.Util

    const diagrams: ParsedPdfDiagram[] = []

    const identity = [1, 0, 0, 1, 0, 0]
    let ctm = identity
    const stack: number[][] = []

    const recordDiagram = async (pngBuffer: Buffer, bboxPx: { x1: number; y1: number; x2: number; y2: number }) => {
      const idx = diagrams.length
      if (idx >= maxDiagramsPerPage) return

      const stored = await storePng({
        grade: opts.grade,
        resourceId: opts.resourceId,
        pageNumber,
        index: idx,
        pngBuffer,
      })

      const bbox = normalizeBBox(bboxPx, pageW, pageH)

      // Find nearest line by vertical center.
      const cy = bbox.y + bbox.h / 2
      let bestIdx: number | null = null
      let bestDist = Infinity
      for (let i = 0; i < lines.length; i++) {
        const ly = lines[i].bbox.y + lines[i].bbox.h / 2
        const d = Math.abs(ly - cy)
        if (d < bestDist) {
          bestDist = d
          bestIdx = i
        }
      }

      diagrams.push({
        url: stored.url,
        pathname: stored.pathname,
        bbox,
        nearestLineIndex: bestIdx,
      })
    }

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i]
      const args = argsArray[i]

      if (fn === OPS.save) {
        stack.push(ctm)
        continue
      }
      if (fn === OPS.restore) {
        ctm = stack.pop() || identity
        continue
      }
      if (fn === OPS.transform) {
        if (Array.isArray(args) && args.length === 6) {
          ctm = Util.transform(ctm, args)
        }
        continue
      }

      const isPaintImage = fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject
      const isInlineImage = fn === OPS.paintInlineImageXObject

      if (!isPaintImage && !isInlineImage) continue

      // Combined transform into viewport space.
      const combined = Util.transform(viewport.transform, ctm)
      const pts = [
        Util.applyTransform([0, 0], combined),
        Util.applyTransform([1, 0], combined),
        Util.applyTransform([0, 1], combined),
        Util.applyTransform([1, 1], combined),
      ]
      const xs = pts.map((p: any) => p[0])
      const ys = pts.map((p: any) => p[1])
      const bboxPx = { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }

      if (isInlineImage) {
        // Inline image object is passed directly.
        const img = args?.[0]
        const w = img?.width
        const h = img?.height
        const data = img?.data
        if (!w || !h || !data) continue

        const png = new PNG({ width: w, height: h })
        png.data = Buffer.from(data)
        const pngBuffer = PNG.sync.write(png)
        await recordDiagram(pngBuffer, bboxPx)
        continue
      }

      const name = Array.isArray(args) ? args[0] : null
      if (!name) continue

      const obj = await getPageObject(page, name)
      const w = obj?.width
      const h = obj?.height
      const data = obj?.data
      if (!w || !h || !data) continue

      const png = new PNG({ width: w, height: h })
      png.data = Buffer.from(data)
      const pngBuffer = PNG.sync.write(png)
      await recordDiagram(pngBuffer, bboxPx)
    }

    pages.push({
      pageNumber,
      width: pageW,
      height: pageH,
      lines,
      diagrams,
    })
  }

  const questions = segmentQuestions(pages)

  return {
    version: 1,
    kind: 'pdf',
    resourceId: opts.resourceId,
    extractedAt: new Date().toISOString(),
    pages,
    questions,
  }
}
