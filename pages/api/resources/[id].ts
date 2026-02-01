import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'
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
    if (status === 'completed' || status === 'complete' || status === 'done') return statusData
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = ((token as any)?.role as string | undefined) || 'student'
  const authUserId = String((token as any)?.id || (token as any)?.sub || '')
  const tokenGrade = normalizeGradeInput((token as any)?.grade as string | undefined)

  const idParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  if (!idParam) return res.status(400).json({ message: 'Resource id required' })

  if (req.method !== 'DELETE' && req.method !== 'PATCH') {
    res.setHeader('Allow', ['DELETE', 'PATCH'])
    return res.status(405).end('Method not allowed')
  }

  const item = await prisma.resourceBankItem.findUnique({ where: { id: String(idParam) } })
  if (!item) return res.status(404).json({ message: 'Resource not found' })

  if (req.method === 'DELETE') {
    // Admin can delete anything.
    if (role === 'admin') {
      await prisma.resourceBankItem.delete({ where: { id: item.id } })
      return res.status(204).end()
    }

    // Teachers/students can only delete their own uploads, and only within their grade.
    if (!tokenGrade) return res.status(403).json({ message: 'Grade not configured for this account' })
    if (String(item.grade) !== String(tokenGrade)) return res.status(403).json({ message: 'Forbidden' })
    if (!item.createdById || String(item.createdById) !== String(authUserId)) return res.status(403).json({ message: 'Forbidden' })

    await prisma.resourceBankItem.delete({ where: { id: item.id } })
    return res.status(204).end()
  }

  // PATCH (edit) is currently admin-only.
  if (role !== 'admin') return res.status(403).json({ message: 'Forbidden' })

  try {
    const body = (req.body || {}) as any
    const nextTitle = typeof body.title === 'string' ? body.title.trim() : undefined
    const nextTag = typeof body.tag === 'string' ? body.tag.trim() : undefined
    const nextGrade = normalizeGradeInput(body.grade)

    const shouldParse = ['1', 'true', 'yes', 'on'].includes(String(body.parse || '').trim().toLowerCase())
    const shouldAiNormalize = shouldParse && ['1', 'true', 'yes', 'on'].includes(String(body.aiNormalize || '').trim().toLowerCase())

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

        const storedSize = typeof (item as any).size === 'number' ? (item as any).size : null
        if (storedSize && storedSize > 25 * 1024 * 1024) {
          throw new Error('File is too large to parse (max 25 MB)')
        }

        const url = String((item as any).url || '').trim()
        const filename = String((item as any).filename || '').trim()
        const mime = String((item as any).contentType || '').trim()
        const lowerName = filename.toLowerCase()

        const isPdf = mime.toLowerCase() === 'application/pdf' || lowerName.endsWith('.pdf') || url.toLowerCase().includes('.pdf')
        const isImage = mime.toLowerCase().startsWith('image/')
        if (!isPdf && !isImage) throw new Error('Only PDF or image files can be parsed')

        if (!url) throw new Error('Resource URL is required for parsing')

        if (isPdf) {
          if (!/^https?:\/\//i.test(url)) throw new Error('Mathpix PDF parsing requires a public URL')

          const pdfPayload = {
            url,
            formats: ['text', 'data', 'latex_styled', 'latex_simplified'],
            include_line_data: true,
            include_smiles: false,
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
          parseDebugResponse = data
          parsedJson = buildParsedJsonFromMathpix(data, mime || 'application/pdf', 'mathpix-pdf')
        } else {
          const imgRes = await fetch(url)
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
      } catch (parseErr: any) {
        parseError = parseErr?.message || 'Parse failed'
      }
    }

    if (parseError) {
      const debugDetails: Record<string, any> = {}
      if (parseDebugPayload) debugDetails.payload = parseDebugPayload
      if (parseDebugResponse) debugDetails.response = parseDebugResponse
      try {
        const compact = JSON.stringify(debugDetails, null, 2)
        const debugText = compact ? (compact.length <= 20000 ? compact : compact.slice(0, 20000) + '\n... (truncated)') : ''
        if (debugText) parseError = `${parseError}\n\nDebug:\n${debugText}`
      } catch {
        // ignore
      }
    }

    const updated = await prisma.resourceBankItem.update({
      where: { id: item.id },
      data: {
        title: nextTitle ? nextTitle : undefined,
        tag: nextTag != null ? (nextTag || null) : undefined,
        grade: nextGrade ? nextGrade : undefined,
        parsedJson: shouldParse ? parsedJson : undefined,
        parsedAt: shouldParse ? (parsedAt || null) : undefined,
        parseError: shouldParse ? (parseError || null) : undefined,
      },
    })

    return res.status(200).json(updated)
  } catch (err: any) {
    return res.status(500).json({ message: err?.message || 'Failed to edit resource' })
  }
}
