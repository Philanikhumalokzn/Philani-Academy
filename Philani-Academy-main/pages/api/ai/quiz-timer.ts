import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'

type Body = {
  gradeLabel?: string | null
  prompt?: string
}

const MAX_PROMPT = 2500

function clampText(value: unknown, maxLen: number) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed
}

function clampDurationSec(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(30, Math.min(1800, Math.trunc(value)))
}

function parseDurationSec(text: string) {
  const raw = (text || '').trim()
  if (!raw) return 0

  // Accept either a bare number or a small JSON object.
  const withoutFences = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  // Try JSON first.
  try {
    const obj = JSON.parse(withoutFences)
    const n = typeof obj?.durationSec === 'number'
      ? obj.durationSec
      : (typeof obj?.seconds === 'number' ? obj.seconds : NaN)
    return clampDurationSec(n)
  } catch {
    // ignore
  }

  const m = withoutFences.match(/(\d{1,4})/)
  if (!m) return 0
  return clampDurationSec(Number(m[1]))
}

async function generateWithGemini(opts: { apiKey: string; model: string; gradeLabel: string | null; prompt: string }) {
  const { apiKey, model, gradeLabel, prompt } = opts

  const instruction =
    'You are an expert math teacher. ' +
    'Choose a sensible time limit for a single short quiz question. ' +
    'Return ONLY valid JSON like {"durationSec": 300}. ' +
    'Constraints: durationSec must be an integer between 30 and 1800. ' +
    'Pick the shortest time that still allows most learners to attempt the question. '

  const content =
    `${instruction}\n\n` +
    `Grade: ${gradeLabel || 'unknown'}\n` +
    `Quiz prompt:\n${prompt || '(empty)'}\n`

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
          maxOutputTokens: 80,
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

  const role = ((token as any)?.role as string | undefined) || ''
  if (role !== 'admin') return res.status(403).json({ message: 'Forbidden' })

  const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim()
  if (!geminiApiKey) {
    return res.status(500).json({ message: 'Gemini is not configured (missing GEMINI_API_KEY)', providerUsed: 'gemini' })
  }

  const body = (req.body || {}) as Body
  const gradeLabel = (typeof body.gradeLabel === 'string' ? body.gradeLabel : null)
  const prompt = clampText(body.prompt, MAX_PROMPT)

  if (!prompt) {
    return res.status(400).json({ message: 'prompt is required' })
  }

  try {
    const text = await generateWithGemini({
      apiKey: geminiApiKey,
      model: (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash',
      gradeLabel,
      prompt,
    })

    const durationSec = parseDurationSec(text)
    if (!durationSec) {
      return res.status(500).json({ message: 'Gemini returned an invalid timer', providerUsed: 'gemini', raw: text })
    }

    return res.status(200).json({ durationSec, providerUsed: 'gemini' })
  } catch (err: any) {
    console.warn('AI quiz timer failed', err?.message || err)
    return res.status(500).json({ message: 'Gemini timer failed', error: err?.message || err })
  }
}
