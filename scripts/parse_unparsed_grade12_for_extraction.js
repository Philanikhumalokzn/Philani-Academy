const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function loadEnvIntoProcess() {
  const envFiles = ['.env.local', '.env']
  for (const envFile of envFiles) {
    const full = path.join(process.cwd(), envFile)
    if (!fs.existsSync(full)) continue
    const text = fs.readFileSync(full, 'utf8')
    for (const rawLine of text.split(/\r?\n/)) {
      const line = String(rawLine || '').trim()
      if (!line || line.startsWith('#')) continue
      const idx = line.indexOf('=')
      if (idx <= 0) continue
      const key = line.slice(0, idx).trim()
      let value = line.slice(idx + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = value
    }
  }
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim()
    if (!token.startsWith('--')) continue
    const eqIdx = token.indexOf('=')
    if (eqIdx > 2) {
      out[token.slice(2, eqIdx)] = token.slice(eqIdx + 1) || '1'
      continue
    }
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

function toBool(value, fallback = false) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return fallback
  return ['1', 'true', 'yes', 'on', 'y'].includes(raw)
}

function extractLinesFromMathpix(data) {
  const direct = Array.isArray(data?.line_data) ? data.line_data : null
  if (direct?.length) return direct

  const pages = Array.isArray(data?.pages) ? data.pages : []
  const lines = []
  for (const page of pages) {
    const pageLines = Array.isArray(page?.line_data) ? page.line_data : Array.isArray(page?.lines) ? page.lines : []
    for (const line of pageLines) lines.push(line)
  }
  return lines.length ? lines : []
}

function extractLinesFromPdfLinesJson(data) {
  const pages = Array.isArray(data?.pages) ? data.pages : []
  const lines = []
  for (const page of pages) {
    const pageLines = Array.isArray(page?.lines) ? page.lines : []
    for (const line of pageLines) {
      lines.push({
        text: typeof line?.text_display === 'string' ? line.text_display : typeof line?.text === 'string' ? line.text : '',
        latex: '',
        latex_styled: '',
        latex_simplified: '',
        type: line?.type || null,
        subtype: line?.subtype || null,
        page: page?.page ?? null,
        confidence: typeof line?.confidence === 'number' ? line.confidence : null,
        confidence_rate: typeof line?.confidence_rate === 'number' ? line.confidence_rate : null,
      })
    }
  }
  return lines.length ? lines : []
}

function buildParsedJsonFromMathpixPdf(mmdText, linesJson, contentType) {
  const lines = extractLinesFromPdfLinesJson(linesJson)
  const text = (typeof mmdText === 'string' ? mmdText : '').trim() ||
    (Array.isArray(lines) && lines.length
      ? lines
          .map((line) => (typeof line?.text === 'string' ? line.text.trim() : ''))
          .filter(Boolean)
          .slice(0, 200)
          .join('\n')
          .trim()
      : '')

  return {
    source: 'mathpix-pdf',
    mimeType: contentType,
    confidence: null,
    text,
    latex: '',
    lines: Array.isArray(lines) ? lines.slice(0, 500) : [],
    raw: {
      mmd: typeof mmdText === 'string' ? mmdText : null,
      linesJson: linesJson && typeof linesJson === 'object' ? linesJson : null,
    },
  }
}

function buildParsedJsonFromMathpixImage(data, contentType) {
  const lines = extractLinesFromMathpix(data)
  const text = (() => {
    if (typeof data?.text === 'string') return data.text.trim()
    if (typeof data?.data?.text === 'string') return data.data.text.trim()
    if (Array.isArray(lines) && lines.length) {
      return lines.map((line) => (typeof line?.text === 'string' ? line.text.trim() : '')).filter(Boolean).slice(0, 200).join('\n').trim()
    }
    return ''
  })()

  const latex = (() => {
    if (typeof data?.latex_styled === 'string') return data.latex_styled.trim()
    if (typeof data?.latex_simplified === 'string') return data.latex_simplified.trim()
    if (typeof data?.latex === 'string') return data.latex.trim()
    return ''
  })()

  return {
    source: 'mathpix-image',
    mimeType: contentType,
    confidence: typeof data?.confidence === 'number' ? data.confidence : null,
    text,
    latex,
    lines: Array.isArray(lines) ? lines.slice(0, 500) : [],
    raw: data,
  }
}

async function fetchMathpixPdfOutputs(pdfId, appId, appKey) {
  const headers = { app_id: appId, app_key: appKey }
  const [mmdRes, linesRes] = await Promise.all([
    fetch(`https://api.mathpix.com/v3/pdf/${encodeURIComponent(pdfId)}.mmd`, { method: 'GET', headers }),
    fetch(`https://api.mathpix.com/v3/pdf/${encodeURIComponent(pdfId)}.lines.json`, { method: 'GET', headers }),
  ])

  const mmdText = mmdRes.ok ? await mmdRes.text().catch(() => '') : ''
  const linesJson = linesRes.ok ? await linesRes.json().catch(() => null) : null
  return { mmdText, linesJson }
}

async function pollMathpixPdfResult(pdfId, appId, appKey) {
  const deadline = Date.now() + 180000
  while (true) {
    if (Date.now() > deadline) throw new Error('Mathpix PDF processing timed out')

    const res = await fetch(`https://api.mathpix.com/v3/pdf/${encodeURIComponent(pdfId)}`, {
      method: 'GET',
      headers: { app_id: appId, app_key: appKey },
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const errMsg = data?.error || data?.error_info || `Mathpix PDF status failed (${res.status})`
      throw new Error(String(errMsg))
    }

    const status = String(data?.status || '').toLowerCase()
    if (['completed', 'finished', 'done', 'success', 'complete'].includes(status)) {
      const outputs = await fetchMathpixPdfOutputs(pdfId, appId, appKey)
      return { statusData: data, ...outputs }
    }
    if (['error', 'failed', 'failure'].includes(status)) {
      const errMsg = data?.error || data?.error_info || 'Mathpix PDF processing failed'
      throw new Error(String(errMsg))
    }

    await sleep(1200)
  }
}

async function parseResourceWithMathpix(resource, appId, appKey) {
  const url = String(resource?.url || '').trim()
  const mime = String(resource?.contentType || '').trim().toLowerCase()
  const filenameRaw = String(resource?.filename || '').trim()
  const filename = filenameRaw.toLowerCase()
  const isPdf = mime === 'application/pdf' || filename.endsWith('.pdf') || /\.pdf(\?|$)/i.test(url)
  const isImage = mime.startsWith('image/')

  if (!url) throw new Error('Missing resource URL')
  if (!isPdf && !isImage) throw new Error('Unsupported resource type for parse')

  const resolveLocalPathFromUrl = (value) => {
    const raw = String(value || '').trim()
    if (!raw.startsWith('/')) return null
    const rel = raw.replace(/^\/+/, '').replace(/\//g, path.sep)
    const full = path.join(process.cwd(), 'public', rel)
    return fs.existsSync(full) ? full : null
  }

  if (isPdf) {
    let submitRes
    if (/^https?:\/\//i.test(url)) {
      const pdfPayload = {
        url,
        include_smiles: false,
        math_inline_delimiters: ['$', '$'],
        math_display_delimiters: ['$$', '$$'],
        rm_spaces: true,
      }
      submitRes = await fetch('https://api.mathpix.com/v3/pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          app_id: appId,
          app_key: appKey,
        },
        body: JSON.stringify(pdfPayload),
      })
    } else {
      const localPath = resolveLocalPathFromUrl(url)
      if (!localPath) throw new Error('Mathpix PDF parse needs a public URL or local file')
      const bytes = await fs.promises.readFile(localPath)
      const form = new FormData()
      form.append('file', new Blob([bytes], { type: 'application/pdf' }), filenameRaw || path.basename(localPath))
      form.append('options_json', JSON.stringify({
        include_smiles: false,
        math_inline_delimiters: ['$', '$'],
        math_display_delimiters: ['$$', '$$'],
        rm_spaces: true,
      }))

      submitRes = await fetch('https://api.mathpix.com/v3/pdf', {
        method: 'POST',
        headers: {
          app_id: appId,
          app_key: appKey,
        },
        body: form,
      })
    }

    const submitData = await submitRes.json().catch(() => ({}))
    if (!submitRes.ok) {
      const errMsg = submitData?.error || submitData?.error_info || `Mathpix PDF request failed (${submitRes.status})`
      throw new Error(String(errMsg))
    }

    const pdfId = String(submitData?.pdf_id || submitData?.id || '').trim()
    if (!pdfId) throw new Error('Mathpix PDF did not return pdf_id')

    const data = await pollMathpixPdfResult(pdfId, appId, appKey)
    return buildParsedJsonFromMathpixPdf(data?.mmdText || '', data?.linesJson, mime || 'application/pdf')
  }

  const imgRes = await fetch(url)
  if (!imgRes.ok) throw new Error(`Failed to fetch image (${imgRes.status})`)
  const raw = Buffer.from(await imgRes.arrayBuffer())
  const contentTypeFinal = mime || imgRes.headers.get('content-type') || 'image/png'
  const src = `data:${contentTypeFinal};base64,${raw.toString('base64')}`

  const payload = {
    src,
    formats: ['text', 'data', 'latex_styled', 'latex_simplified'],
    include_line_data: true,
    include_smiles: false,
    math_inline_delimiters: ['$', '$'],
    math_display_delimiters: ['$$', '$$'],
    rm_spaces: true,
  }

  const parseRes = await fetch('https://api.mathpix.com/v3/text', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      app_id: appId,
      app_key: appKey,
    },
    body: JSON.stringify(payload),
  })

  const parseData = await parseRes.json().catch(() => ({}))
  if (!parseRes.ok) {
    const errMsg = parseData?.error || parseData?.error_info || `Mathpix image parse failed (${parseRes.status})`
    throw new Error(String(errMsg))
  }

  return buildParsedJsonFromMathpixImage(parseData, contentTypeFinal)
}

async function main() {
  loadEnvIntoProcess()
  const args = parseArgs(process.argv.slice(2))
  const dryRun = toBool(args.dryRun, false)
  const limitRaw = Number.parseInt(String(args.limit || ''), 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 0

  const dbUrl = String(process.env.DATABASE_URL || '').trim()
  if (!dbUrl) throw new Error('Missing DATABASE_URL')

  const appId = String(process.env.MATHPIX_APP_ID || '').trim()
  const appKey = String(process.env.MATHPIX_APP_KEY || '').trim()
  if (!appId || !appKey) throw new Error('Missing MATHPIX_APP_ID or MATHPIX_APP_KEY')

  const pool = new Pool({ connectionString: dbUrl })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  const summary = {
    scanned: 0,
    parsed: 0,
    skipped: 0,
    failed: 0,
    dryRun,
    failures: [],
  }

  try {
    const resourcesAll = await prisma.resourceBankItem.findMany({
      where: {
        grade: 'GRADE_12',
        examQuestions: { none: {} },
      },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        title: true,
        filename: true,
        url: true,
        contentType: true,
        size: true,
        parsedJson: true,
      },
    })

    const resources = resourcesAll.filter((r) => r.parsedJson == null)

    const queue = limit > 0 ? resources.slice(0, limit) : resources
    summary.scanned = queue.length

    for (let i = 0; i < queue.length; i += 1) {
      const resource = queue[i]
      const label = `${resource.title || resource.filename || resource.id} (${resource.id})`

      try {
        const storedSize = typeof resource.size === 'number' ? resource.size : 0
        if (storedSize > 25 * 1024 * 1024) {
          summary.skipped += 1
          console.log(`[${i + 1}/${queue.length}] skip too large: ${label}`)
          continue
        }

        const mime = String(resource.contentType || '').toLowerCase()
        const name = String(resource.filename || '').toLowerCase()
        const isPdf = mime === 'application/pdf' || name.endsWith('.pdf') || /\.pdf(\?|$)/i.test(String(resource.url || ''))
        const isImage = mime.startsWith('image/')
        if (!isPdf && !isImage) {
          summary.skipped += 1
          console.log(`[${i + 1}/${queue.length}] skip unsupported type: ${label}`)
          continue
        }

        if (dryRun) {
          summary.parsed += 1
          console.log(`[${i + 1}/${queue.length}] dry-run parse: ${label}`)
          continue
        }

        const parsedJson = await parseResourceWithMathpix(resource, appId, appKey)

        await prisma.resourceBankItem.update({
          where: { id: resource.id },
          data: {
            parsedJson,
            parsedAt: new Date(),
            parseError: null,
          },
        })

        summary.parsed += 1
        console.log(`[${i + 1}/${queue.length}] parsed: ${label}`)
      } catch (err) {
        const message = String(err?.message || err)
        summary.failed += 1
        summary.failures.push({ resourceId: resource.id, title: resource.title, error: message })

        if (!dryRun) {
          await prisma.resourceBankItem.update({
            where: { id: resource.id },
            data: {
              parseError: message,
            },
          }).catch(() => {})
        }

        console.log(`[${i + 1}/${queue.length}] failed parse: ${label} -> ${message}`)
      }
    }

    console.log(JSON.stringify(summary, null, 2))
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
