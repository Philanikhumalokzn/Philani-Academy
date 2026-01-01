import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import formidable, { File } from 'formidable'
import path from 'path'
import { createReadStream } from 'fs'
import { promises as fs } from 'fs'
import { put } from '@vercel/blob'
import prisma from '../../../../../lib/prisma'
import { normalizeGradeInput } from '../../../../../lib/grades'

export const config = {
  api: {
    bodyParser: false,
  },
}

type ParsedForm = {
  fields: formidable.Fields
  files: formidable.Files
}

async function parseForm(req: NextApiRequest): Promise<ParsedForm> {
  const form = formidable({
    multiples: false,
    maxFileSize: 25 * 1024 * 1024, // 25 MB cap for assignment import
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
  if (Array.isArray(fileEntry) && fileEntry.length > 0) {
    return fileEntry[0]
  }
  if (!Array.isArray(fileEntry)) return fileEntry
  return null
}

function sanitizeFilename(original: string | undefined): string {
  const fallback = 'assignment'
  const parsed = path.parse(original || fallback)
  const safeName = (parsed.name || fallback).replace(/[^a-z0-9_-]+/gi, '_')
  const timestamp = Date.now()
  const extension = parsed.ext || ''
  return `${timestamp}_${safeName}${extension}`
}

function clampText(input: any, max: number): string {
  const s = typeof input === 'string' ? input : ''
  if (s.length <= max) return s
  return s.slice(0, max)
}

function tryParseJsonLoose(text: string): any | null {
  const trimmed = (text || '').trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    // try to extract first JSON object
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      const sliced = trimmed.slice(start, end + 1)
      try {
        return JSON.parse(sliced)
      } catch {
        return null
      }
    }
    return null
  }
}

async function extractQuestionsWithGemini(opts: {
  apiKey: string
  model: string
  gradeLabel: string
  mimeType: string
  base64Data: string
  filename: string
  titleHint: string
}) {
  const { apiKey, model, gradeLabel, mimeType, base64Data, filename, titleHint } = opts

  const prompt =
    `You are a verbatim extraction engine. ` +
    `Transcribe the assignment exactly as written in the source. ` +
    `CRITICAL: Do NOT rephrase, paraphrase, summarize, simplify, or “improve” any wording. ` +
    `Preserve original wording, punctuation, capitalization, numbers, units, and question labels (e.g. “1.2”, “(a)”, “Question 7”). ` +
    `Only convert mathematical notation into LaTeX when needed; do not rewrite surrounding text. ` +
    `Return ONLY valid JSON with this shape: ` +
    `{"title":"...","displayTitle":"...","sectionLabel":"...","questions":[{"latex":"..."}]}. ` +
    `Where:` +
    `\n- title: copied from the source header if present (no rewording). If missing, use the title hint.` +
    `\n- displayTitle: copied from the source header if present (no rewording). If missing, reuse title.` +
    `\n- sectionLabel: a short section/tag label inferred from the source (e.g. "Analysis", "Algebra", "Geometry"). Keep it 1-2 words.` +
    `\n- questions: the extracted LaTeX questions/sub-questions.` +
    `\n\nRules:` +
    `\n- Produce 1 question per item in questions[].` +
    `\n- Split ONLY on explicit question boundaries visible in the source. If unsure, keep content together rather than re-grouping.` +
    `\n- If you include math, wrap it in $...$ or $$...$$.` +
    `\n- Do NOT include solutions.` +
    `\n- Preserve the order from the source.` +
    `\n- Keep instruction lines verbatim (e.g., “Show all working”, “Give your answer to 2 d.p.”).` +
    `\n- Do NOT invent missing text; if something is unreadable, insert a short placeholder like “[illegible]”.` +
    `\n- Grade level: ${gradeLabel}.` +
    `\n\nTitle hint: ${titleHint || filename || 'Assignment'}.`

  // Prefer SDK, but REST is more predictable for inlineData.
  try {
    const mod: any = await import('@google/genai')
    const GoogleGenAI = mod?.GoogleGenAI
    if (typeof GoogleGenAI !== 'function') throw new Error('GoogleGenAI not available')

    const ai = new GoogleGenAI({ apiKey })

    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64Data } },
          ],
        },
      ],
      config: {
        temperature: 0,
        topP: 0.1,
        maxOutputTokens: 2000,
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
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data: base64Data } },
            ],
          },
        ],
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
      const detail = sdkErr?.message ? `; sdkErr=${sdkErr.message}` : ''
      throw new Error(`Gemini error (${res.status}): ${t}${detail}`)
    }

    const data: any = await res.json()
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('')
    return typeof text === 'string' ? text.trim() : ''
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sessionIdParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  if (!sessionIdParam) return res.status(400).json({ message: 'Session id required' })

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any)?.role as string | undefined
  const tokenGrade = normalizeGradeInput((token as any)?.grade as string | undefined)

  if (role !== 'admin' && role !== 'teacher') {
    return res.status(403).json({ message: 'Only instructors may import assignments' })
  }

  const sessionRecord = await prisma.sessionRecord.findUnique({
    where: { id: sessionIdParam },
    select: { grade: true, id: true },
  })
  if (!sessionRecord) return res.status(404).json({ message: 'Session not found' })

  if (role === 'teacher') {
    if (!tokenGrade) return res.status(403).json({ message: 'Grade not configured for this account' })
    if (tokenGrade !== sessionRecord.grade) {
      return res.status(403).json({ message: 'Access to this session is restricted to its grade' })
    }
  }

  const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim()
  if (!geminiApiKey) {
    return res.status(500).json({ message: 'Gemini is not configured (missing GEMINI_API_KEY)' })
  }

  try {
    const { fields, files } = await parseForm(req)
    const uploadedFile = pickFirstFile(files.file as File | File[] | undefined)
    if (!uploadedFile) {
      return res.status(400).json({ message: 'File upload required' })
    }

    const mimeType = (uploadedFile.mimetype || '').toString()
    const isPdf = mimeType === 'application/pdf' || (uploadedFile.originalFilename || '').toLowerCase().endsWith('.pdf')
    const isImage = mimeType.startsWith('image/')
    if (!isPdf && !isImage) {
      return res.status(400).json({ message: 'Only PDF or image files are supported for assignment import' })
    }

    const titleField = fields.title
    const providedTitle = Array.isArray(titleField) ? titleField[0] : titleField
    const titleHint = clampText((providedTitle || '').toString().trim(), 160)

    const safeFilename = sanitizeFilename(uploadedFile.originalFilename)
    const relativePath = path.posix
      .join('sessions', sessionRecord.id, 'assignments', safeFilename)
      .replace(/\\/g, '/')

    const blobToken = process.env.BLOB_READ_WRITE_TOKEN

    let storedFilename = relativePath
    let publicUrl = `/${relativePath}`

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
      const targetDir = path.join(process.cwd(), 'public', 'sessions', sessionRecord.id, 'assignments')
      await fs.mkdir(targetDir, { recursive: true })
      const destinationPath = path.join(targetDir, safeFilename)
      await fs.copyFile(uploadedFile.filepath, destinationPath)
    }

    const rawBytes = await fs.readFile(uploadedFile.filepath)
    const base64Data = rawBytes.toString('base64')

    const gradeLabel = `Grade ${String(sessionRecord.grade).replace('GRADE_', '')}`
    const model = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'

    const geminiText = await extractQuestionsWithGemini({
      apiKey: geminiApiKey,
      model,
      gradeLabel,
      mimeType: isPdf ? 'application/pdf' : (mimeType || 'image/png'),
      base64Data,
      filename: uploadedFile.originalFilename || safeFilename,
      titleHint: titleHint || (uploadedFile.originalFilename || 'Assignment'),
    })

    const parsed = tryParseJsonLoose(geminiText)
    const titleFromAi = typeof parsed?.title === 'string' ? parsed.title.trim() : ''
    const displayTitleFromAi = typeof (parsed as any)?.displayTitle === 'string' ? String((parsed as any).displayTitle).trim() : ''
    const sectionLabelFromAi = typeof (parsed as any)?.sectionLabel === 'string' ? String((parsed as any).sectionLabel).trim() : ''
    const questionsRaw = Array.isArray(parsed?.questions) ? parsed.questions : []
    const questions = questionsRaw
      .map((q: any) => ({ latex: typeof q?.latex === 'string' ? q.latex.trim() : '' }))
      .filter((q: any) => q.latex)
      .slice(0, 50)

    if (!questions.length) {
      return res.status(422).json({
        message: 'Gemini returned no questions. Try a clearer screenshot or a smaller PDF.',
        debug: process.env.DEBUG === '1' ? { geminiText: geminiText.slice(0, 4000) } : undefined,
      })
    }

    const assignmentTitle = titleHint || titleFromAi || uploadedFile.originalFilename || 'Assignment'
    const displayTitle = (displayTitleFromAi || assignmentTitle).trim().slice(0, 180)
    const sectionLabel = (sectionLabelFromAi || '').trim().slice(0, 60) || null

    const created = await (prisma as any).assignment.create({
      data: {
        sessionId: sessionRecord.id,
        title: assignmentTitle,
        displayTitle,
        sectionLabel,
        sourceUrl: publicUrl,
        sourceFilename: storedFilename,
        sourceContentType: uploadedFile.mimetype || null,
        createdBy: (token as any)?.email ? String((token as any).email) : null,
        questions: {
          create: questions.map((q: any, idx: number) => ({
            order: idx,
            latex: q.latex,
          })),
        },
      },
      include: { questions: true },
    })

    return res.status(201).json(created)
  } catch (err: any) {
    console.error('Assignment import error', err)
    return res.status(500).json({ message: err?.message || 'Failed to import assignment' })
  }
}
