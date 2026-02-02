import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import { normalizeGradeInput } from '../../../lib/grades'
import { upsertResourceBankItem } from '../../../lib/resourceBank'
import { tryParseJsonLoose } from '../../../lib/geminiAssignmentExtract'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function extractLinesFromMathpix(data: any) {
  const direct = Array.isArray(data?.line_data) ? data.line_data : null
  if (direct?.length) return direct

  const pages = Array.isArray(data?.pages) ? data.pages : []
  const lines: any[] = []
  for (const page of pages) {
    const pageLines = Array.isArray(page?.line_data) ? page.line_data : Array.isArray(page?.lines) ? page.lines : []
    for (const line of pageLines) lines.push(line)
  }
  return lines.length ? lines : []
}

function buildParsedJsonFromMathpix(data: any, contentType: string, source: string) {
  const lines = extractLinesFromMathpix(data)
  const text = (() => {
    if (typeof data?.text === 'string') return data.text.trim()
    if (typeof data?.data?.text === 'string') return data.data.text.trim()
    if (Array.isArray(lines) && lines.length) {
      return lines
        .map((line: any) => (typeof line?.text === 'string' ? line.text.trim() : ''))
        .filter(Boolean)
        .slice(0, 200)
        .join('\n')
        .trim()
    }
    return ''
  })()

  const latex = (() => {
    if (typeof data?.latex_styled === 'string') return data.latex_styled.trim()
    if (typeof data?.latex_simplified === 'string') return data.latex_simplified.trim()
    return ''
  })()

  const normalizedLines = (Array.isArray(lines) ? lines : []).slice(0, 500).map((line: any) => {
    const lineText = typeof line?.text === 'string' ? line.text : ''
    const latexStyled = typeof line?.latex_styled === 'string' ? line.latex_styled : ''
    const latexSimplified = typeof line?.latex_simplified === 'string' ? line.latex_simplified : ''
    return {
      text: lineText,
      latex: latexStyled || latexSimplified || '',
      latex_styled: latexStyled || '',
      latex_simplified: latexSimplified || '',
    }
  })

  return {
    source,
    mimeType: contentType,
    confidence: typeof data?.confidence === 'number' ? data.confidence : null,
    text,
    latex,
    lines: normalizedLines,
  }
}

function extractLinesFromPdfLinesJson(data: any) {
  const pages = Array.isArray(data?.pages) ? data.pages : []
  const lines: any[] = []
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

function buildParsedJsonFromMathpixPdf(mmdText: string | null, linesJson: any, contentType: string, source: string) {
  const lines = extractLinesFromPdfLinesJson(linesJson)
  const text = (typeof mmdText === 'string' ? mmdText : '').trim() ||
    (Array.isArray(lines) && lines.length
      ? lines
          .map((line: any) => (typeof line?.text === 'string' ? line.text.trim() : ''))
          .filter(Boolean)
          .slice(0, 200)
          .join('\n')
          .trim()
      : '')

  return {
    source,
    mimeType: contentType,
    confidence: null,
    text,
    latex: '',
    lines: Array.isArray(lines) ? lines.slice(0, 500) : [],
  }
}

async function fetchMathpixPdfOutputs(pdfId: string, appId: string, appKey: string) {
  const headers = { app_id: appId, app_key: appKey }
  const [mmdRes, linesRes] = await Promise.all([
    fetch(`https://api.mathpix.com/v3/pdf/${encodeURIComponent(pdfId)}.mmd`, { method: 'GET', headers }),
    fetch(`https://api.mathpix.com/v3/pdf/${encodeURIComponent(pdfId)}.lines.json`, { method: 'GET', headers }),
  ])

  const mmdText = mmdRes.ok ? await mmdRes.text().catch(() => '') : ''
  const linesJson = linesRes.ok ? await linesRes.json().catch(() => null) : null
  return { mmdText, linesJson }
}

async function pollMathpixPdfResult(pdfId: string, appId: string, appKey: string) {
  const deadline = Date.now() + 120_000
  while (true) {
    if (Date.now() > deadline) throw new Error('Mathpix PDF timed out')

    const statusRes = await fetch(`https://api.mathpix.com/v3/pdf/${encodeURIComponent(pdfId)}`, {
      headers: { app_id: appId, app_key: appKey },
    })

    const statusData: any = await statusRes.json().catch(() => ({}))
    if (!statusRes.ok) {
      const errMsg = statusData?.error || statusData?.error_info || `Mathpix PDF status failed (${statusRes.status})`
      throw new Error(String(errMsg))
    }

    const status = String(statusData?.status || '').toLowerCase()
    if (status === 'completed' || status === 'complete' || status === 'done') {
      const outputs = await fetchMathpixPdfOutputs(pdfId, appId, appKey)
      return { statusData, ...outputs }
    }
    if (status === 'error' || status === 'failed') {
      const errMsg = statusData?.error || statusData?.error_info || 'Mathpix PDF failed'
      throw new Error(String(errMsg))
    }

    await sleep(1200)
  }
}

async function normalizeParsedWithGemini(parsed: any, model: string, apiKey: string) {
  const safeJson = (() => {
    if (!parsed || typeof parsed !== 'object') return {}
    const { raw, ...rest } = parsed as any
    return rest
  })()

  const prompt =
    `You are a LaTeX normalizer. Fix OCR/Mathpix LaTeX errors and normalize delimiters. ` +
    `Return ONLY valid JSON. Keep the same shape: {text, latex, lines:[{text, latex, latex_styled, latex_simplified}]}. ` +
    `Rules: preserve original wording; only fix LaTeX tokens (e.g., \\labda->\\lambda, \\infinity->\\infty), ` +
    `remove escaped delimiters, and keep math delimiters consistent. ` +
    `If a field is missing in input, omit it.\n\n` +
    `INPUT JSON:\n${JSON.stringify(safeJson).slice(0, 15000)}`

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          topP: 0.1,
          maxOutputTokens: 2000,
          responseMimeType: 'application/json',
        },
      }),
    },
  )

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Gemini error (${res.status}): ${t}`)
  }

  const data: any = await res.json().catch(() => null)
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('')
  const normalized = tryParseJsonLoose(typeof text === 'string' ? text : '')
  if (!normalized || typeof normalized !== 'object') {
    throw new Error('Gemini returned invalid JSON')
  }
  return normalized
}

function serializeDebugDetails(details: Record<string, any>) {
  try {
    const compact = JSON.stringify(details, null, 2)
    if (!compact) return ''
    if (compact.length <= 20000) return compact
    return compact.slice(0, 20000) + '\n... (truncated)'
  } catch {
    return ''
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '256kb',
    },
  },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end('Method not allowed')
  }

  const token = await getToken({ req })
  const role = ((token as any)?.role as string | undefined) || 'student'
  const authUserId = String((token as any)?.sub || '')
  const tokenGrade = normalizeGradeInput((token as any)?.grade)

  if (role !== 'admin' && role !== 'teacher' && role !== 'student') {
    return res.status(403).json({ message: 'Forbidden' })
  }

  if (role !== 'admin' && !tokenGrade) {
    return res.status(403).json({ message: 'Grade not configured for this account' })
  }

  try {
    const {
      url,
      filename,
      title,
      tag,
      grade: requestedGrade,
      contentType,
      size,
      parse,
      aiNormalize,
    } = (req.body || {}) as any

    const cleanUrl = String(url || '').trim()
    if (!cleanUrl) return res.status(400).json({ message: 'Resource URL is required' })

    const wantsGrade = normalizeGradeInput(String(requestedGrade || ''))
    const grade = role === 'admin' ? (wantsGrade || tokenGrade) : tokenGrade
    if (!grade) return res.status(400).json({ message: 'Grade is required' })

    if (role !== 'admin' && tokenGrade && grade !== tokenGrade) {
      return res.status(403).json({ message: 'You may only upload resources for your own grade' })
    }

    const shouldParse = ['1', 'true', 'yes', 'on'].includes(String(parse || '').trim().toLowerCase())
    const shouldAiNormalize = shouldParse && ['1', 'true', 'yes', 'on'].includes(String(aiNormalize || '').trim().toLowerCase())

    const storedSize = typeof size === 'number' ? size : typeof size === 'string' ? Number(size) : null
    const mime = String(contentType || '').trim() || null

    let parsedJson: any | null = null
    let parsedAt: Date | null = null
    let parseError: string | null = null
    let parseDebugPayload: any | null = null
    let parseDebugResponse: any | null = null

    if (shouldParse) {
      try {
        const appId = (process.env.MATHPIX_APP_ID || '').trim()
        const appKey = (process.env.MATHPIX_APP_KEY || '').trim()
        if (!appId || !appKey) {
          throw new Error('Mathpix is not configured (missing MATHPIX_APP_ID or MATHPIX_APP_KEY)')
        }

        if (storedSize && storedSize > 25 * 1024 * 1024) {
          throw new Error('File is too large to parse (max 25 MB)')
        }

        const lowerName = String(filename || '').toLowerCase()
        const isPdf = (mime || '').toLowerCase() === 'application/pdf' || lowerName.endsWith('.pdf') || cleanUrl.toLowerCase().includes('.pdf')
        const isImage = (mime || '').toLowerCase().startsWith('image/')

        if (!isPdf && !isImage) {
          throw new Error('Only PDF or image files can be parsed')
        }

        if (isPdf) {
          if (!/^https?:\/\//i.test(cleanUrl)) throw new Error('Mathpix PDF parsing requires a public URL')

          const pdfPayload = {
            url: cleanUrl,
            include_smiles: false,
            math_inline_delimiters: ['$', '$'],
            math_display_delimiters: ['$$', '$$'],
            rm_spaces: true,
          }
          parseDebugPayload = { endpoint: '/v3/pdf', ...pdfPayload }

          const submitRes = await fetch('https://api.mathpix.com/v3/pdf', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              app_id: appId,
              app_key: appKey,
            },
            body: JSON.stringify(pdfPayload),
          })

          const submitData: any = await submitRes.json().catch(() => ({}))
          if (!submitRes.ok) {
            parseDebugResponse = submitData
            const errMsg = submitData?.error || submitData?.error_info || `Mathpix PDF request failed (${submitRes.status})`
            throw new Error(String(errMsg))
          }

          const pdfId = String(submitData?.pdf_id || submitData?.id || '').trim()
          if (!pdfId) throw new Error('Mathpix PDF did not return a pdf_id')

          const data = await pollMathpixPdfResult(pdfId, appId, appKey)
          parseDebugResponse = data?.statusData || data
          parsedJson = buildParsedJsonFromMathpixPdf(data?.mmdText || '', data?.linesJson, mime || 'application/pdf', 'mathpix-pdf')
        } else {
          const imgRes = await fetch(cleanUrl)
          if (!imgRes.ok) throw new Error(`Failed to fetch image (${imgRes.status})`)
          const raw = Buffer.from(await imgRes.arrayBuffer())
          const contentTypeFinal = mime || imgRes.headers.get('content-type') || 'image/png'

          const base64Data = raw.toString('base64')
          const src = `data:${contentTypeFinal};base64,${base64Data}`

          const payload = {
            src,
            formats: ['text', 'data', 'latex_styled', 'latex_simplified'],
            include_line_data: true,
            include_smiles: false,
            math_inline_delimiters: ['$', '$'],
            math_display_delimiters: ['$$', '$$'],
            rm_spaces: true,
          }

          parseDebugPayload = {
            endpoint: '/v3/text',
            src: `data:${contentTypeFinal};base64,(omitted ${raw.length} bytes)`,
            formats: payload.formats,
            include_line_data: payload.include_line_data,
            include_smiles: payload.include_smiles,
            math_inline_delimiters: payload.math_inline_delimiters,
            math_display_delimiters: payload.math_display_delimiters,
            rm_spaces: payload.rm_spaces,
          }

          const mathpixRes = await fetch('https://api.mathpix.com/v3/text', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              app_id: appId,
              app_key: appKey,
            },
            body: JSON.stringify(payload),
          })

          const data: any = await mathpixRes.json().catch(() => ({}))
          if (!mathpixRes.ok) {
            parseDebugResponse = data
            const errMsg = data?.error || data?.error_info || `Mathpix request failed (${mathpixRes.status})`
            throw new Error(String(errMsg))
          }

          parseDebugResponse = data
          parsedJson = buildParsedJsonFromMathpix(data, contentTypeFinal, 'mathpix')
        }

        parsedAt = new Date()

        const text = typeof parsedJson?.text === 'string' ? parsedJson.text.trim() : ''
        const latex = typeof parsedJson?.latex === 'string' ? parsedJson.latex.trim() : ''
        const hasLines = Array.isArray(parsedJson?.lines) && parsedJson.lines.length > 0
        if (!text && !latex && !hasLines) {
          parseError = 'Mathpix returned no text/latex'
        }

        if (shouldAiNormalize) {
          const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim()
          const geminiModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'
          if (!geminiApiKey) throw new Error('Gemini is not configured (missing GEMINI_API_KEY)')

          try {
            const normalized = await normalizeParsedWithGemini(parsedJson, geminiModel, geminiApiKey)
            parsedJson = {
              ...normalized,
              source: 'mathpix+gemini',
              mimeType: parsedJson?.mimeType || mime,
              confidence: parsedJson?.confidence ?? null,
            }
          } catch (aiErr: any) {
            const msg = aiErr?.message || 'AI post-normalize failed'
            parseError = parseError ? `${parseError} | ${msg}` : msg
          }
        }
      } catch (err: any) {
        parseError = err?.message || 'Parse failed'
      }
    }

    if (parseError) {
      const debugDetails: Record<string, any> = {}
      if (parseDebugPayload) debugDetails.payload = parseDebugPayload
      if (parseDebugResponse) debugDetails.response = parseDebugResponse
      const debugText = serializeDebugDetails(debugDetails)
      if (debugText) parseError = `${parseError}\n\nDebug:\n${debugText}`
    }

    const item = await upsertResourceBankItem({
      grade,
      title: String(title || '').trim() || String(filename || '').trim() || 'Resource',
      tag: String(tag || '').trim() || null,
      url: cleanUrl,
      filename: String(filename || '').trim() || null,
      contentType: mime,
      size: storedSize,
      checksum: null,
      source: role === 'admin' ? 'admin' : role,
      createdById: authUserId || null,
      parsedJson,
      parsedAt,
      parseError,
    })

    return res.status(201).json(item)
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || 'Failed to register resource' })
  }
}
