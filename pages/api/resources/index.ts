import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import formidable, { File } from 'formidable'
import path from 'path'
import { createReadStream } from 'fs'
import { promises as fs } from 'fs'
import { put } from '@vercel/blob'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'
import { computeFileSha256Hex, upsertResourceBankItem } from '../../../lib/resourceBank'
import { tryParseJsonLoose } from '../../../lib/geminiAssignmentExtract'

export const config = {
  api: {
    bodyParser: false,
  },
}

type ParsedForm = {
  fields: formidable.Fields
  files: formidable.Files
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

  const res = await fetch(`https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
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
  })

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

async function parseForm(req: NextApiRequest): Promise<ParsedForm> {
  const form = formidable({
    multiples: false,
    maxFileSize: 50 * 1024 * 1024,
  })
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err)
      resolve({ fields, files })
    })
  })
}

function pickFirstFile(fileEntry: File | File[] | undefined): File | null {
  if (!fileEntry) return null
  if (Array.isArray(fileEntry) && fileEntry.length > 0) return fileEntry[0]
  if (!Array.isArray(fileEntry)) return fileEntry
  return null
}

function sanitizeFilename(original: string | undefined): string {
  const fallback = 'resource'
  const parsed = path.parse(original || fallback)
  const safeName = (parsed.name || fallback).replace(/[^a-z0-9_-]+/gi, '_')
  const timestamp = Date.now()
  const extension = parsed.ext || ''
  return `${timestamp}_${safeName}${extension}`
}

function buildDocxFilename(original: string | undefined): string {
  const fallback = 'resource'
  const parsed = path.parse(original || fallback)
  const safeName = (parsed.name || fallback).replace(/[^a-z0-9_-]+/gi, '_')
  const timestamp = Date.now()
  return `${timestamp}_${safeName}.docx`
}

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
    if (typeof data?.latex === 'string') return data.latex.trim()
    if (typeof data?.data?.latex === 'string') return data.data.latex.trim()
    if (Array.isArray(lines) && lines.length) {
      return lines
        .map((line: any) => {
          if (typeof line?.latex_styled === 'string') return line.latex_styled.trim()
          if (typeof line?.latex_simplified === 'string') return line.latex_simplified.trim()
          if (typeof line?.latex === 'string') return line.latex.trim()
          return ''
        })
        .filter(Boolean)
        .slice(0, 200)
        .join('\n')
        .trim()
    }
    return ''
  })()
  return {
    source,
    mimeType: contentType,
    confidence: typeof data?.confidence === 'number' ? data.confidence : null,
    text,
    latex,
    lines: Array.isArray(lines) ? lines.slice(0, 200) : [],
    raw: data,
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
    raw: {
      mmd: typeof mmdText === 'string' ? mmdText : null,
      linesJson: linesJson && typeof linesJson === 'object' ? linesJson : null,
    },
  }
}

function serializeDebugDetails(details: Record<string, any>) {
  const keys = Object.keys(details || {})
  if (keys.length === 0) return ''
  try {
    const raw = JSON.stringify(details, null, 2)
    if (!raw || raw === '{}' || raw === 'null') return ''
    const limit = 6000
    return raw.length > limit ? `${raw.slice(0, limit)}\n... (truncated)` : raw
  } catch {
    return ''
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

async function pollMathpixPdfConversionDocx(pdfId: string, appId: string, appKey: string) {
  const deadline = Date.now() + 180_000
  while (true) {
    if (Date.now() > deadline) throw new Error('Mathpix DOCX conversion timed out')

    const res = await fetch(`https://api.mathpix.com/v3/converter/${encodeURIComponent(pdfId)}`, {
      method: 'GET',
      headers: { app_id: appId, app_key: appKey },
    })

    const data: any = await res.json().catch(() => ({}))
    if (!res.ok) {
      const errMsg = data?.error || data?.error_info || `Mathpix conversion status failed (${res.status})`
      throw new Error(String(errMsg))
    }

    const status = String(data?.conversion_status?.docx?.status || '')
    if (status === 'completed') return
    if (status === 'error') {
      const errMsg = data?.conversion_status?.docx?.error_info?.error || 'Mathpix DOCX conversion failed'
      throw new Error(String(errMsg))
    }

    await sleep(1200)
  }
}

async function pollMathpixPdfResult(pdfId: string, appId: string, appKey: string) {
  const maxAttempts = 12
  const delayMs = 1500
  let lastData: any = null

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const res = await fetch(`https://api.mathpix.com/v3/pdf/${encodeURIComponent(pdfId)}`, {
      method: 'GET',
      headers: {
        app_id: appId,
        app_key: appKey,
      },
    })
    const data: any = await res.json().catch(() => ({}))
    lastData = data
    if (!res.ok) {
      const errMsg = data?.error || data?.error_info || `Mathpix PDF status failed (${res.status})`
      throw new Error(String(errMsg))
    }

    const status = String(data?.status || '').toLowerCase()
    if (['completed', 'finished', 'done', 'success'].includes(status)) {
      const outputs = await fetchMathpixPdfOutputs(pdfId, appId, appKey)
      return { statusData: data, ...outputs }
    }
    if (['error', 'failed', 'failure'].includes(status)) {
      const errMsg = data?.error || data?.error_info || 'Mathpix PDF processing failed'
      throw new Error(String(errMsg))
    }

    await sleep(delayMs)
  }

  const message = lastData?.status ? `Mathpix PDF processing timed out (${lastData.status})` : 'Mathpix PDF processing timed out'
  throw new Error(message)
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = ((token as any)?.role as string | undefined) || 'student'
  const authUserId = String((token as any)?.id || (token as any)?.sub || '')
  const tokenGrade = normalizeGradeInput((token as any)?.grade as string | undefined)

  if (req.method === 'GET') {
    const q = typeof req.query.grade === 'string' ? req.query.grade : ''
    const wants = normalizeGradeInput(q)

    const grade = role === 'admin' ? (wants || tokenGrade) : tokenGrade
    if (!grade) return res.status(400).json({ message: 'Grade not configured for this account' })

    const items = await prisma.resourceBankItem.findMany({
      where: { grade },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        grade: true,
        title: true,
        tag: true,
        url: true,
        filename: true,
        contentType: true,
        size: true,
        checksum: true,
        source: true,
        createdById: true,
        createdAt: true,
        parsedAt: true,
        parseError: true,
        parsedJson: true,
        createdBy: { select: { id: true, name: true, email: true, avatar: true } },
      },
    })

    return res.status(200).json({ grade, items })
  }

  if (req.method === 'POST') {
    if (role !== 'admin' && role !== 'teacher' && role !== 'student') {
      return res.status(403).json({ message: 'Forbidden' })
    }

    if (role !== 'admin') {
      if (!tokenGrade) return res.status(403).json({ message: 'Grade not configured for this account' })
    }

    try {
      const { fields, files } = await parseForm(req)
      const uploadedFile = pickFirstFile(files.file as File | File[] | undefined)
      if (!uploadedFile) return res.status(400).json({ message: 'File upload required' })

      const parseField = fields.parse
      const parseRequestedRaw = Array.isArray(parseField) ? parseField[0] : parseField
      const parseRequested = ['1', 'true', 'yes', 'on'].includes(String(parseRequestedRaw || '').trim().toLowerCase())

      const convertDocxField = fields.convertDocx
      const convertDocxRaw = Array.isArray(convertDocxField) ? convertDocxField[0] : convertDocxField
      const convertDocxRequested = ['1', 'true', 'yes', 'on'].includes(String(convertDocxRaw || '').trim().toLowerCase())

      const aiNormalizeField = fields.aiNormalize
      const aiNormalizeRaw = Array.isArray(aiNormalizeField) ? aiNormalizeField[0] : aiNormalizeField
      const aiNormalizeRequested = ['1', 'true', 'yes', 'on'].includes(String(aiNormalizeRaw || '').trim().toLowerCase())

      const titleField = fields.title
      const providedTitle = Array.isArray(titleField) ? titleField[0] : titleField
      const title = (providedTitle || uploadedFile.originalFilename || 'Resource').toString().trim()

      const tagField = fields.tag
      const providedTag = Array.isArray(tagField) ? tagField[0] : tagField
      const tag = (providedTag || '').toString().trim()

      const gradeField = fields.grade
      const providedGrade = Array.isArray(gradeField) ? gradeField[0] : gradeField
      const wantsGrade = normalizeGradeInput((providedGrade || '').toString())

      const grade = role === 'admin' ? (wantsGrade || tokenGrade) : tokenGrade
      if (!grade) return res.status(400).json({ message: 'Grade is required' })

      // Strict: users (teacher/student) can only upload for their own grade.
      if (role !== 'admin' && tokenGrade && grade !== tokenGrade) {
        return res.status(403).json({ message: 'You may only upload resources for your own grade' })
      }

      const checksum = await computeFileSha256Hex(uploadedFile.filepath)

      const safeFilename = sanitizeFilename(uploadedFile.originalFilename)
      const relativePath = path.posix.join('resource-bank', String(grade), safeFilename).replace(/\\/g, '/')

      const blobToken = process.env.BLOB_READ_WRITE_TOKEN

      let storedFilename = relativePath
      let publicUrl = `/${relativePath}`
      const storedSize = typeof uploadedFile.size === 'number' ? uploadedFile.size : null

      if (blobToken) {
        const stream = createReadStream(uploadedFile.filepath)
        const blob = await put(relativePath, stream, {
          access: 'public',
          token: blobToken,
          contentType: uploadedFile.mimetype || undefined,
          addRandomSuffix: false,
        })
        storedFilename = blob.pathname || relativePath
        publicUrl = blob.url
      } else {
        const targetDir = path.join(process.cwd(), 'public', 'resource-bank', String(grade))
        await fs.mkdir(targetDir, { recursive: true })
        const destinationPath = path.join(targetDir, safeFilename)
        await fs.copyFile(uploadedFile.filepath, destinationPath)
      }

      let parsedJson: any | null = null
      let parsedAt: Date | null = null
      let parseError: string | null = null
      let parseDebugPayload: any | null = null
      let parseDebugResponse: any | null = null

      if (convertDocxRequested) {
        try {
          const appId = (process.env.MATHPIX_APP_ID || '').trim()
          const appKey = (process.env.MATHPIX_APP_KEY || '').trim()
          if (!appId || !appKey) {
            throw new Error('Mathpix is not configured (missing MATHPIX_APP_ID or MATHPIX_APP_KEY)')
          }

          const mimeType = (uploadedFile.mimetype || '').toString()
          const isPdf = mimeType === 'application/pdf' || (uploadedFile.originalFilename || '').toLowerCase().endsWith('.pdf')
          if (!isPdf) throw new Error('DOCX conversion requires a PDF upload')

          const fileSize = typeof uploadedFile.size === 'number' ? uploadedFile.size : 0
          if (fileSize > 25 * 1024 * 1024) {
            throw new Error('File is too large to convert (max 25 MB)')
          }

          const buildAbsoluteUrl = (value: string) => {
            if (!value) return value
            if (/^https?:\/\//i.test(value)) return value
            const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
            const host = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string) || ''
            if (!host) return value
            const pathOnly = value.startsWith('/') ? value : `/${value}`
            return `${proto}://${host}${pathOnly}`
          }

          const pdfUrl = buildAbsoluteUrl(publicUrl)
          if (!/^https?:\/\//i.test(pdfUrl)) {
            throw new Error('Mathpix PDF conversion requires a public URL')
          }

          const pdfPayload = {
            url: pdfUrl,
            conversion_formats: { docx: true },
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

          // Wait for OCR to finish and docx conversion to complete
          await pollMathpixPdfResult(pdfId, appId, appKey)
          await pollMathpixPdfConversionDocx(pdfId, appId, appKey)

          const docxRes = await fetch(`https://api.mathpix.com/v3/pdf/${encodeURIComponent(pdfId)}.docx`, {
            method: 'GET',
            headers: { app_id: appId, app_key: appKey },
          })

          if (!docxRes.ok) {
            const errText = await docxRes.text().catch(() => '')
            throw new Error(errText || `Failed to download docx (${docxRes.status})`)
          }

          const docxBuffer = Buffer.from(await docxRes.arrayBuffer())
          const docxFilename = buildDocxFilename(uploadedFile.originalFilename)
          const docxRelativePath = path.posix.join('resource-bank', String(grade), docxFilename).replace(/\\/g, '/')

          let docxUrl = `/${docxRelativePath}`
          if (blobToken) {
            const blob = await put(docxRelativePath, docxBuffer, {
              access: 'public',
              token: blobToken,
              contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              addRandomSuffix: false,
            })
            docxUrl = blob.url
          } else {
            const targetDir = path.join(process.cwd(), 'public', 'resource-bank', String(grade))
            await fs.mkdir(targetDir, { recursive: true })
            const destinationPath = path.join(targetDir, docxFilename)
            await fs.writeFile(destinationPath, docxBuffer)
          }

          parsedJson = {
            source: 'mathpix-docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            docxUrl,
            docxFilename,
          }
          parsedAt = new Date()
        } catch (err: any) {
          parseError = err?.message || 'DOCX conversion failed'
          try {
            console.error('Resource DOCX conversion failed', {
              grade,
              role,
              filename: uploadedFile?.originalFilename || null,
              mimeType: uploadedFile?.mimetype || null,
              size: typeof uploadedFile?.size === 'number' ? uploadedFile.size : null,
              error: err?.message || String(err),
            })
            if (err?.stack) console.error(err.stack)
          } catch {
            // ignore
          }
        }
      } else if (parseRequested) {
        try {
          const appId = (process.env.MATHPIX_APP_ID || '').trim()
          const appKey = (process.env.MATHPIX_APP_KEY || '').trim()
          if (!appId || !appKey) {
            throw new Error('Mathpix is not configured (missing MATHPIX_APP_ID or MATHPIX_APP_KEY)')
          }

          const mimeType = (uploadedFile.mimetype || '').toString()
          const isPdf = mimeType === 'application/pdf' || (uploadedFile.originalFilename || '').toLowerCase().endsWith('.pdf')
          const isImage = mimeType.startsWith('image/')
          if (!isPdf && !isImage) {
            throw new Error('Only PDF or image files can be parsed')
          }

          const fileSize = typeof uploadedFile.size === 'number' ? uploadedFile.size : 0
          if (fileSize > 25 * 1024 * 1024) {
            throw new Error('File is too large to parse (max 25 MB)')
          }

          const contentType = isPdf ? 'application/pdf' : (mimeType || 'image/png')
          const buildAbsoluteUrl = (value: string) => {
            if (!value) return value
            if (/^https?:\/\//i.test(value)) return value
            const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
            const host = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string) || ''
            if (!host) return value
            const pathOnly = value.startsWith('/') ? value : `/${value}`
            return `${proto}://${host}${pathOnly}`
          }

          let data: any = null

          if (isPdf) {
            const pdfUrl = buildAbsoluteUrl(publicUrl)
            if (!/^https?:\/\//i.test(pdfUrl)) {
              throw new Error('Mathpix PDF parsing requires a public URL')
            }

            const pdfPayload = {
              url: pdfUrl,
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
            if (!pdfId) {
              throw new Error('Mathpix PDF did not return a pdf_id')
            }

            data = await pollMathpixPdfResult(pdfId, appId, appKey)
            parseDebugResponse = data?.statusData || data
            parsedJson = buildParsedJsonFromMathpixPdf(data?.mmdText || '', data?.linesJson, contentType, 'mathpix-pdf')
          } else {
            const rawBytes = await fs.readFile(uploadedFile.filepath)
            const base64Data = rawBytes.toString('base64')
            const src = `data:${contentType};base64,${base64Data}`
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
              src: `data:${contentType};base64,(omitted ${rawBytes.length} bytes)`,
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

            data = await mathpixRes.json().catch(() => ({}))
            if (!mathpixRes.ok) {
              parseDebugResponse = data
              const errMsg = data?.error || data?.error_info || `Mathpix request failed (${mathpixRes.status})`
              throw new Error(String(errMsg))
            }

            parseDebugResponse = data
            parsedJson = buildParsedJsonFromMathpix(data, contentType, 'mathpix')
          }

          parsedAt = new Date()
          const text = typeof parsedJson?.text === 'string' ? parsedJson.text.trim() : ''
          const latex = typeof parsedJson?.latex === 'string' ? parsedJson.latex.trim() : ''
          const hasLines = Array.isArray(parsedJson?.lines) && parsedJson.lines.length > 0
          if (!text && !latex && !hasLines) {
            parseError = 'Mathpix returned no text/latex'
          }

          if (aiNormalizeRequested) {
            const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim()
            const geminiModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'
            if (!geminiApiKey) {
              throw new Error('Gemini is not configured (missing GEMINI_API_KEY)')
            }
            try {
              const normalized = await normalizeParsedWithGemini(parsedJson, geminiModel, geminiApiKey)
              parsedJson = {
                ...normalized,
                source: 'mathpix+gemini',
                mimeType: contentType,
                confidence: typeof data?.confidence === 'number' ? data.confidence : null,
              }
            } catch (aiErr: any) {
              const msg = aiErr?.message || 'AI post-normalize failed'
              parseError = parseError ? `${parseError} | ${msg}` : msg
            }
          }
        } catch (err: any) {
          parseError = err?.message || 'Parse failed'
          try {
            console.error('Resource parse failed', {
              grade,
              role,
              filename: uploadedFile?.originalFilename || null,
              mimeType: uploadedFile?.mimetype || null,
              size: typeof uploadedFile?.size === 'number' ? uploadedFile.size : null,
              error: err?.message || String(err),
            })
            if (err?.stack) console.error(err.stack)
          } catch {
            // ignore
          }
        }
      }

      if (parseError) {
        const debugDetails: Record<string, any> = {}
        if (parseDebugPayload) debugDetails.payload = parseDebugPayload
        if (parseDebugResponse) debugDetails.response = parseDebugResponse
        const debugText = serializeDebugDetails(debugDetails)
        if (debugText) {
          parseError = `${parseError}\n\nDebug:\n${debugText}`
        }
      }

      const item = await upsertResourceBankItem({
        grade,
        title,
        tag: tag || null,
        url: publicUrl,
        filename: storedFilename,
        contentType: uploadedFile.mimetype || null,
        size: storedSize,
        checksum,
        source: role === 'admin' ? 'admin' : role,
        createdById: authUserId || null,

        parsedJson,
        parsedAt,
        parseError,
      })

      return res.status(201).json(item)
    } catch (err: any) {
      const message = err?.message?.includes('maxFileSize')
        ? 'File must be under 50 MB'
        : err?.message || 'Failed to upload resource'
      return res.status(500).json({ message })
    }
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end('Method not allowed')
}
