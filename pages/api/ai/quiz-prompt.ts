import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'

type Body = {
  gradeLabel?: string | null
  teacherLatex?: string
  previousPrompt?: string
}

const MAX_LATEX = 20000
const MAX_PROMPT = 4000

function clampText(value: unknown, maxLen: number) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed
}

function heuristicPrompt(gradeLabel: string | null, teacherLatex: string) {
  const grade = gradeLabel ? `Grade ${gradeLabel.replace(/[^0-9]/g, '') || gradeLabel}` : 'your grade'
  const latex = teacherLatex.trim()
  if (!latex) {
    return `Quiz (${grade}): Answer the question your teacher has given. Show your working clearly.`
  }
  // Very lightweight heuristic: wrap teacher’s latest content as the reference.
  return (
    `Quiz (${grade}):\n` +
    `Use the method shown in class to solve/simplify the following. Show all working.\n\n` +
    `${latex}`
  )
}

async function generateWithOpenAI(opts: { apiKey: string; model: string; gradeLabel: string | null; teacherLatex: string; previousPrompt: string }) {
  const { apiKey, model, gradeLabel, teacherLatex, previousPrompt } = opts
  const sys =
    'You are an assistant helping a teacher write a short quiz prompt for learners. ' +
    'Return ONLY the quiz instructions/question text, no quotes, no markdown fences.'
  const user =
    `Context:\n` +
    `Grade: ${gradeLabel || 'unknown'}\n` +
    `Teacher notes (LaTeX, may include multiple lines):\n${teacherLatex || '(empty)'}\n\n` +
    (previousPrompt ? `Previous prompt (optional):\n${previousPrompt}\n\n` : '') +
    `Task: Write a clear quiz question/instructions that matches the context. ` +
    `Keep it concise, student-friendly, and specific. If the context looks like a worked example, ask a similar new question.`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenAI error (${res.status}): ${text}`)
  }

  const data: any = await res.json()
  const content = data?.choices?.[0]?.message?.content
  return typeof content === 'string' ? content.trim() : ''
}

async function generateWithAnthropic(opts: { apiKey: string; model: string; gradeLabel: string | null; teacherLatex: string; previousPrompt: string }) {
  const { apiKey, model, gradeLabel, teacherLatex, previousPrompt } = opts
  const prompt =
    `You are an assistant helping a teacher write a short quiz prompt for learners. ` +
    `Return ONLY the quiz instructions/question text, no quotes, no markdown fences.\n\n` +
    `Context:\n` +
    `Grade: ${gradeLabel || 'unknown'}\n` +
    `Teacher notes (LaTeX, may include multiple lines):\n${teacherLatex || '(empty)'}\n\n` +
    (previousPrompt ? `Previous prompt (optional):\n${previousPrompt}\n\n` : '') +
    `Task: Write a clear quiz question/instructions that matches the context. ` +
    `Keep it concise, student-friendly, and specific. If the context looks like a worked example, ask a similar new question.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Anthropic error (${res.status}): ${text}`)
  }

  const data: any = await res.json()
  const content = data?.content?.[0]?.text
  return typeof content === 'string' ? content.trim() : ''
}

async function generateWithGemini(opts: { apiKey: string; model: string; gradeLabel: string | null; teacherLatex: string; previousPrompt: string }) {
  const { apiKey, model, gradeLabel, teacherLatex, previousPrompt } = opts
  const prompt =
    `You are an assistant helping a teacher write a short quiz prompt for learners. ` +
    `Return ONLY the quiz instructions/question text, no quotes, no markdown fences.\n\n` +
    `Context:\n` +
    `Grade: ${gradeLabel || 'unknown'}\n` +
    `Teacher notes (LaTeX, may include multiple lines):\n${teacherLatex || '(empty)'}\n\n` +
    (previousPrompt ? `Previous prompt (optional):\n${previousPrompt}\n\n` : '') +
    `Task: Write a clear quiz question/instructions that matches the context. ` +
    `Keep it concise, student-friendly, and specific. If the context looks like a worked example, ask a similar new question.`

  // Google AI Studio (Generative Language API) key-based endpoint.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 400,
      },
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Gemini error (${res.status}): ${text}`)
  }

  const data: any = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('')
  return typeof text === 'string' ? text.trim() : ''
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end('Method Not Allowed')
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any)?.role as string | undefined
  const isLearner = role === 'student'
  if (isLearner) return res.status(403).json({ message: 'Forbidden' })

  const body = (req.body || {}) as Body
  const gradeLabel = (typeof body.gradeLabel === 'string' ? body.gradeLabel : null)
  const teacherLatex = clampText(body.teacherLatex, MAX_LATEX)
  const previousPrompt = clampText(body.previousPrompt, MAX_PROMPT)

  // Provider selection (optional). If not configured, fall back to heuristics.
  const provider = (process.env.AI_PROVIDER || '').toLowerCase() // 'openai' | 'anthropic' | 'gemini'

  try {
    let prompt = ''

    if (provider === 'openai' && process.env.OPENAI_API_KEY) {
      prompt = await generateWithOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        gradeLabel,
        teacherLatex,
        previousPrompt,
      })
    } else if ((provider === 'anthropic' || provider === 'claude') && process.env.ANTHROPIC_API_KEY) {
      prompt = await generateWithAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest',
        gradeLabel,
        teacherLatex,
        previousPrompt,
      })
    } else if (provider === 'gemini' && process.env.GEMINI_API_KEY) {
      prompt = await generateWithGemini({
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
        gradeLabel,
        teacherLatex,
        previousPrompt,
      })
    } else {
      prompt = heuristicPrompt(gradeLabel, teacherLatex)
    }

    const finalPrompt = clampText(prompt, MAX_PROMPT)
    if (!finalPrompt) {
      return res.status(200).json({ prompt: heuristicPrompt(gradeLabel, teacherLatex) })
    }

    return res.status(200).json({ prompt: finalPrompt })
  } catch (err: any) {
    console.warn('AI quiz prompt generation failed; falling back', err?.message || err)
    return res.status(200).json({ prompt: heuristicPrompt(gradeLabel, teacherLatex) })
  }
}
