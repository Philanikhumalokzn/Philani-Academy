import type { NextApiRequest, NextApiResponse } from 'next'
import formidable, { File } from 'formidable'
import path from 'path'
import crypto from 'crypto'
import { promises as fs } from 'fs'
import { PDFDocument } from 'pdf-lib'
import { put } from '@vercel/blob'
import { getToken } from 'next-auth/jwt'
import { normalizeGradeInput } from '../../../lib/grades'
import { upsertResourceBankItem } from '../../../lib/resourceBank'

export const config = {
  api: {
    bodyParser: false,
  },
}

const MAX_IMAGE_SIZE = 12 * 1024 * 1024 // 12 MB per image
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

type ParsedForm = {
  fields: formidable.Fields
  files: formidable.Files
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function parseForm(req: NextApiRequest): Promise<ParsedForm> {
  const form = formidable({
    multiples: true,
    maxFileSize: MAX_IMAGE_SIZE,
  })

  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err)
      resolve({ fields, files })
    })
  })
}

function pickFiles(entry: File | File[] | undefined): File[] {
  if (!entry) return []
  if (Array.isArray(entry)) return entry.filter(Boolean)
  return [entry]
}

function buildFilename(prefix: string, ext: string) {
  const stamp = Date.now()
  const rand = crypto.randomBytes(4).toString('hex')
  return `${stamp}_${prefix}_${rand}${ext}`
}

function isAllowedImage(file: File) {
  const mime = (file.mimetype || '').toLowerCase()
  return ALLOWED_TYPES.includes(mime)
}

async function buildPdfFromImages(files: File[]) {
  const pdf = await PDFDocument.create()

  for (const file of files) {
    const bytes = await fs.readFile(file.filepath)
    const mime = (file.mimetype || '').toLowerCase()
    const image = mime.includes('png') ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
    const { width, height } = image.scale(1)
    const page = pdf.addPage([width, height])
    page.drawImage(image, { x: 0, y: 0, width, height })
  }

  const pdfBytes = await pdf.save()
  return Buffer.from(pdfBytes)
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
      return await fetchMathpixPdfOutputs(pdfId, appId, appKey)
    }

    await sleep(1200)
  }
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

async function generateLessonPlanMmd(opts: { apiKey: string; model: string; gradeLabel: string; sourceMmd: string; title: string }) {
  const { apiKey, model, gradeLabel, sourceMmd, title } = opts

  const prompt =
    `You are producing an AI-assisted reconstruction of a lesson plan from learner notebook pages. ` +
    `The result must be strictly faithful to the source and must not invent any content. ` +
    `Include a short disclosure line at the top: "AI-assisted reconstruction from learner notebook images; verify against source." ` +
    `Output ONLY Mathpix Markdown (MMD) that can be converted to DOCX. ` +
    `Preserve wording, numbering, dates, and ordering exactly as the source. ` +
    `Do NOT paraphrase, summarize, or improve. ` +
    `If a date or label is missing, write "[missing]" instead of inventing one. ` +
    `Use headings for dates or sections if they appear in the source. ` +
    `Keep worked examples and learner exercises verbatim and in the same order. ` +
    `Keep math as LaTeX using $...$ or $$...$$. ` +
    `Do not add any content not present in the source.

` +
    `Grade: ${gradeLabel}
` +
    `Title hint: ${title || 'Lesson Plan'}

` +
    `SOURCE (MMD from OCR):
${sourceMmd.slice(0, 120000)}`

  try {
    const mod: any = await import('@google/genai')
    const GoogleGenAI = mod?.GoogleGenAI
    if (typeof GoogleGenAI !== 'function') throw new Error('GoogleGenAI not available')

    const ai = new GoogleGenAI({ apiKey })
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0,
        topP: 0.1,
        maxOutputTokens: 4096,
      },
    } as any)

    const text = response?.text
    return typeof text === 'string' ? text.trim() : ''
  } catch (sdkErr: any) {
    const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          topP: 0.1,
          maxOutputTokens: 4096,
          responseMimeType: 'text/plain',
        },
      }),
    })

    if (!res.ok) {
      const t = await res.text().catch(() => '')
      const detail = sdkErr?.message ? `; sdkErr=${sdkErr.message}` : ''
      throw new Error(`Gemini error (${res.status}): ${t}${detail}`)
    }

    const data: any = await res.json().catch(() => ({}))
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('')
    return typeof text === 'string' ? text.trim() : ''
  }
}

async function pollConversion(conversionId: string, appId: string, appKey: string) {
  const deadline = Date.now() + 120_000
  while (true) {
    if (Date.now() > deadline) throw new Error('Mathpix conversion timed out')

    const res = await fetch(`https://api.mathpix.com/v3/converter/${encodeURIComponent(conversionId)}`, {
      method: 'GET',
      headers: { app_id: appId, app_key: appKey },
    })

    const data: any = await res.json().catch(() => ({}))
    if (!res.ok) {
      const errMsg = data?.error || data?.error_info || `Mathpix converter status failed (${res.status})`
      throw new Error(String(errMsg))
    }

    const docxStatus = String(data?.conversion_status?.docx?.status || '')
    if (docxStatus === 'completed') return
    if (docxStatus === 'error') {
      const errMsg = data?.conversion_status?.docx?.error_info?.error || 'Mathpix conversion failed'
      throw new Error(String(errMsg))
    }

    await sleep(1200)
  }
}

async function convertMmdToDocx(mmd: string, appId: string, appKey: string) {
  const submitRes = await fetch('https://api.mathpix.com/v3/converter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      app_id: appId,
      app_key: appKey,
    },
    body: JSON.stringify({
      mmd,
      formats: { docx: true },
    }),
  })

  const submitData: any = await submitRes.json().catch(() => ({}))
  if (!submitRes.ok) {
    const errMsg = submitData?.error || submitData?.error_info || `Mathpix converter request failed (${submitRes.status})`
    throw new Error(String(errMsg))
  }

  const conversionId = String(submitData?.conversion_id || '').trim()
  if (!conversionId) throw new Error('Mathpix converter did not return a conversion_id')

  await pollConversion(conversionId, appId, appKey)

  const docxRes = await fetch(`https://api.mathpix.com/v3/converter/${encodeURIComponent(conversionId)}.docx`, {
    method: 'GET',
    headers: { app_id: appId, app_key: appKey },
  })

  if (!docxRes.ok) {
    const errText = await docxRes.text().catch(() => '')
    throw new Error(errText || `Failed to download docx (${docxRes.status})`)
  }

  return Buffer.from(await docxRes.arrayBuffer())
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end('Method not allowed')
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = ((token as any)?.role as string | undefined) || 'student'
  const authUserId = String((token as any)?.sub || '')
  const tokenGrade = normalizeGradeInput((token as any)?.grade)

  if (role !== 'admin' && role !== 'teacher' && role !== 'student') {
    return res.status(403).json({ message: 'Forbidden' })
  }

  try {
    const { fields, files } = await parseForm(req)

    const filesInput = pickFiles((files.files as File | File[] | undefined) || (files.file as File | File[] | undefined))
    if (!filesInput.length) return res.status(400).json({ message: 'At least one image is required' })

    const invalid = filesInput.find((file) => !isAllowedImage(file))
    if (invalid) {
      return res.status(400).json({ message: 'Only JPEG, PNG, or WEBP images are allowed' })
    }

    const oversized = filesInput.find((file) => typeof file.size === 'number' && file.size > MAX_IMAGE_SIZE)
    if (oversized) {
      return res.status(400).json({ message: 'One or more images exceeds the 12MB limit' })
    }

    const titleRaw = Array.isArray(fields.title) ? fields.title[0] : fields.title
    const tagRaw = Array.isArray(fields.tag) ? fields.tag[0] : fields.tag
    const gradeRaw = Array.isArray(fields.grade) ? fields.grade[0] : fields.grade

    const wantsGrade = normalizeGradeInput(String(gradeRaw || ''))
    const grade = role === 'admin' ? (wantsGrade || tokenGrade) : tokenGrade
    if (!grade) return res.status(400).json({ message: 'Grade is required' })

    if (role !== 'admin' && tokenGrade && grade !== tokenGrade) {
      return res.status(403).json({ message: 'You may only create lesson plans for your own grade' })
    }

    const title = String(titleRaw || '').trim() || 'Lesson Plan'
    const tag = String(tagRaw || '').trim() || 'lesson-plan'

    const orderedFiles = [...filesInput].sort((a, b) => {
      const nameA = String(a.originalFilename || '')
      const nameB = String(b.originalFilename || '')
      return nameA.localeCompare(nameB)
    })

    const pdfBuffer = await buildPdfFromImages(orderedFiles)
    const pdfFilename = buildFilename('lesson_plan_source', '.pdf')

    const blobToken = (process.env.BLOB_READ_WRITE_TOKEN || '').trim()
    const relativePdfPath = path.posix.join('lesson-plans', String(grade), pdfFilename).replace(/\\/g, '/')

    let pdfUrl = `/${relativePdfPath}`
    if (blobToken) {
      const blob = await put(relativePdfPath, pdfBuffer, {
        access: 'public',
        token: blobToken,
        contentType: 'application/pdf',
        addRandomSuffix: false,
      })
      pdfUrl = blob.url
    } else {
      const targetDir = path.join(process.cwd(), 'public', 'lesson-plans', String(grade))
      await fs.mkdir(targetDir, { recursive: true })
      const destinationPath = path.join(targetDir, pdfFilename)
      await fs.writeFile(destinationPath, pdfBuffer)
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

    const pdfPublicUrl = buildAbsoluteUrl(pdfUrl)
    if (!/^https?:\/\//i.test(pdfPublicUrl)) {
      throw new Error('Lesson plan PDF must be publicly accessible for Mathpix')
    }

    const appId = (process.env.MATHPIX_APP_ID || '').trim()
    const appKey = (process.env.MATHPIX_APP_KEY || '').trim()
    if (!appId || !appKey) {
      throw new Error('Mathpix is not configured (missing MATHPIX_APP_ID or MATHPIX_APP_KEY)')
    }

    const submitRes = await fetch('https://api.mathpix.com/v3/pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        app_id: appId,
        app_key: appKey,
      },
      body: JSON.stringify({
        url: pdfPublicUrl,
        include_smiles: false,
        math_inline_delimiters: ['$', '$'],
        math_display_delimiters: ['$$', '$$'],
        rm_spaces: true,
      }),
    })

    const submitData: any = await submitRes.json().catch(() => ({}))
    if (!submitRes.ok) {
      const errMsg = submitData?.error || submitData?.error_info || `Mathpix PDF request failed (${submitRes.status})`
      throw new Error(String(errMsg))
    }

    const pdfId = String(submitData?.pdf_id || submitData?.id || '').trim()
    if (!pdfId) throw new Error('Mathpix PDF did not return a pdf_id')

    const { mmdText } = await pollMathpixPdfResult(pdfId, appId, appKey)
    await pollMathpixPdfConversionDocx(pdfId, appId, appKey)

    const sourceDocxRes = await fetch(`https://api.mathpix.com/v3/pdf/${encodeURIComponent(pdfId)}.docx`, {
      method: 'GET',
      headers: { app_id: appId, app_key: appKey },
    })

    if (!sourceDocxRes.ok) {
      const errText = await sourceDocxRes.text().catch(() => '')
      throw new Error(errText || `Failed to download source docx (${sourceDocxRes.status})`)
    }

    const sourceDocxBuffer = Buffer.from(await sourceDocxRes.arrayBuffer())
    const sourceDocxFilename = buildFilename('source_ocr', '.docx')
    const sourceDocxPath = path.posix.join('lesson-plans', String(grade), sourceDocxFilename).replace(/\\/g, '/')

    let sourceDocxUrl = `/${sourceDocxPath}`
    if (blobToken) {
      const blob = await put(sourceDocxPath, sourceDocxBuffer, {
        access: 'public',
        token: blobToken,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        addRandomSuffix: false,
      })
      sourceDocxUrl = blob.url
    } else {
      const targetDir = path.join(process.cwd(), 'public', 'lesson-plans', String(grade))
      await fs.mkdir(targetDir, { recursive: true })
      const destinationPath = path.join(targetDir, sourceDocxFilename)
      await fs.writeFile(destinationPath, sourceDocxBuffer)
    }

    const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim()
    const geminiModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'
    if (!geminiApiKey) {
      throw new Error('Gemini is not configured (missing GEMINI_API_KEY)')
    }

    const lessonPlanMmd = await generateLessonPlanMmd({
      apiKey: geminiApiKey,
      model: geminiModel,
      gradeLabel: String(grade),
      sourceMmd: mmdText || '',
      title,
    })

    if (!lessonPlanMmd) throw new Error('Lesson plan generation returned empty output')

    const byteLength = Buffer.byteLength(lessonPlanMmd, 'utf8')
    if (byteLength > 9 * 1024 * 1024) {
      throw new Error('Lesson plan is too large to convert (max 9MB)')
    }

    const lessonDocxBuffer = await convertMmdToDocx(lessonPlanMmd, appId, appKey)
    const lessonDocxFilename = buildFilename('lesson_plan', '.docx')
    const lessonDocxPath = path.posix.join('lesson-plans', String(grade), lessonDocxFilename).replace(/\\/g, '/')

    let lessonDocxUrl = `/${lessonDocxPath}`
    if (blobToken) {
      const blob = await put(lessonDocxPath, lessonDocxBuffer, {
        access: 'public',
        token: blobToken,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        addRandomSuffix: false,
      })
      lessonDocxUrl = blob.url
    } else {
      const targetDir = path.join(process.cwd(), 'public', 'lesson-plans', String(grade))
      await fs.mkdir(targetDir, { recursive: true })
      const destinationPath = path.join(targetDir, lessonDocxFilename)
      await fs.writeFile(destinationPath, lessonDocxBuffer)
    }

    const item = await upsertResourceBankItem({
      grade,
      title,
      tag,
      url: lessonDocxUrl,
      filename: lessonDocxFilename,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: lessonDocxBuffer.byteLength,
      checksum: null,
      source: role === 'admin' ? 'admin' : role,
      createdById: authUserId || null,
      parsedJson: {
        source: 'lesson-plan-from-screenshots',
        pdfUrl: pdfUrl,
        sourceDocxUrl,
        lessonPlanMmd,
        aiDisclosure: 'AI-assisted reconstruction from learner notebook images; verify against source.',
      },
      parsedAt: new Date(),
      parseError: null,
    })

    return res.status(200).json({
      item,
      docxUrl: lessonDocxUrl,
      pdfUrl,
      sourceDocxUrl,
    })
  } catch (err: any) {
    return res.status(500).json({ message: err?.message || 'Failed to build lesson plan' })
  }
}
