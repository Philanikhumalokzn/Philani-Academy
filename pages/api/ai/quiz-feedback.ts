import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'

type Body = {
  gradeLabel?: string | null
  prompt?: string
  studentLatex?: string
  studentText?: string
}

const MAX_PROMPT = 2000
const MAX_LATEX = 20000
const MAX_STUDENT_TEXT = 5000

function clampText(value: unknown, maxLen: number) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed
}

async function generateWithGemini(opts: { apiKey: string; model: string; gradeLabel: string | null; prompt: string; studentLatex: string; studentText: string }) {
  const { apiKey, model, gradeLabel, prompt, studentLatex, studentText } = opts

  const instruction =
    'You are a friendly math tutor. ' +
    'Give instant, concise feedback on the student answer. ' +
    'Be specific but very short (1–2 sentences). ' +
    'If the answer is incomplete, give the next best step. ' +
    'Do NOT provide a full worked solution. ' +
    'If you include math, wrap it in $...$.'

  const content =
    `${instruction}\n\n` +
    `Context:\n` +
    `Grade: ${gradeLabel || 'unknown'}\n` +
    `Quiz prompt:\n${prompt || '(unknown)'}\n\n` +
    `Student work (canvas/LaTeX):\n${studentLatex || '(empty)'}\n\n` +
    `Student typed answer:\n${studentText || '(empty)'}\n`

  // Prefer the official SDK, with REST fallback.
  try {
    const mod: any = await import('@google/genai')
    const GoogleGenAI = mod?.GoogleGenAI
    if (typeof GoogleGenAI !== 'function') throw new Error('GoogleGenAI not available')

    const ai = new GoogleGenAI({ apiKey })
    const response = await ai.models.generateContent({
      model,
      contents: content,
    })
    const text = response?.text
    return typeof text === 'string' ? text.trim() : ''
  } catch (sdkErr: any) {
    const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: content }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 220,
        },
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const detail = sdkErr?.message ? `; sdkErr=${sdkErr.message}` : ''
      throw new Error(`Gemini error (${res.status}): ${text}${detail}`)
    }

    const data: any = await res.json()
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('')
    return typeof text === 'string' ? text.trim() : ''
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end('Method Not Allowed')
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  // Cost control: AI tools are admin-only.
  const role = ((token as any)?.role as string | undefined) || ''
  if (role !== 'admin') return res.status(403).json({ message: 'Forbidden' })

  const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim()
  if (!geminiApiKey) {
    return res.status(500).json({ message: 'Gemini is not configured (missing GEMINI_API_KEY)', providerUsed: 'gemini' })
  }

  const body = (req.body || {}) as Body
  const gradeLabel = (typeof body.gradeLabel === 'string' ? body.gradeLabel : null)
  const prompt = clampText(body.prompt, MAX_PROMPT)
  const studentLatex = clampText(body.studentLatex, MAX_LATEX)
  const studentText = clampText(body.studentText, MAX_STUDENT_TEXT)

  if (!studentLatex && !studentText) {
    return res.status(400).json({ message: 'Either studentLatex or studentText is required' })
  }

  try {
    const text = await generateWithGemini({
      apiKey: geminiApiKey,
      model: (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash',
      gradeLabel,
      prompt,
      studentLatex,
      studentText,
    })

    if (!text) {
      return res.status(500).json({ message: 'Gemini returned empty feedback', providerUsed: 'gemini' })
    }

    return res.status(200).json({ feedback: text, providerUsed: 'gemini' })
  } catch (err: any) {
    console.warn('AI quiz feedback failed', err?.message || err)
    return res.status(500).json({ message: 'Gemini feedback failed', error: err?.message || err })
  }
}
