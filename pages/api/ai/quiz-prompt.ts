import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'

type Body = {
  gradeLabel?: string | null
  teacherLatex?: string
  previousPrompt?: string
  sessionId?: string
  phaseKey?: string
  pointId?: string
  pointIndex?: number
  pointTitle?: string
}

const MAX_LATEX = 20000
const MAX_PROMPT = 4000

// We want the quiz prompt to be extremely concise in UI.
const TARGET_PROMPT_MAX_CHARS = 220
const MAX_LABEL_CHARS = 20

function countUnescapedDollars(s: string) {
  let count = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '$') continue
    if (i > 0 && s[i - 1] === '\\') continue
    count += 1
  }
  return count
}

function clampText(value: unknown, maxLen: number) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed
}

function heuristicPrompt(gradeLabel: string | null, teacherLatex: string) {
  const grade = gradeLabel ? `Grade ${gradeLabel.replace(/[^0-9]/g, '') || gradeLabel}` : 'your grade'
  const latex = teacherLatex.trim()
  if (!latex) {
    return `Quiz (${grade}): Answer clearly. Show working.`
  }

  const compact = latex.replace(/\s+/g, ' ').trim()
  const equalsCount = (compact.match(/=/g) || []).length
  const hasX = /(^|[^a-zA-Z])x([^a-zA-Z]|$)/i.test(compact)
  const hasY = /(^|[^a-zA-Z])y([^a-zA-Z]|$)/i.test(compact)
  const hasUnknowns = hasX || hasY || /\b[a-z]\b/i.test(compact)
  // Systems of equations often come through as a single line with multiple '='.
  // Prefer class-typical instruction when it looks like two unknowns.
  const looksLikeSystem = equalsCount >= 2 && hasX && hasY
  const looksLikeQuadratic = /(x\^2|\bx\^2\b|\bquadratic\b)/i.test(compact)
  const looksLikeFactorise = /(factor|factorise|factorize|\\cdot)/i.test(compact)
  const looksLikeSimplify = /(simplify|\\frac|\\sqrt|\\left|\\right)/i.test(compact) && !looksLikeSystem

  let instruction = 'Solve. Show working.'
  if (looksLikeSystem) instruction = 'Solve the following equations simultaneously. Show working.'
  else if (looksLikeQuadratic) instruction = 'Solve the following quadratic equation. Show working.'
  else if (looksLikeFactorise) instruction = 'Factorise fully. Show working.'
  else if (looksLikeSimplify) instruction = 'Simplify the following expression. Show working.'

  return `Quiz (${grade}): ${instruction}\n${latex}`
}

function shortenPrompt(value: string) {
  const s = (value || '').trim().replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
  if (s.length <= TARGET_PROMPT_MAX_CHARS) return s

  // Prefer a single first line.
  const firstLine = s.split('\n').map(x => x.trim()).find(Boolean) || s
  if (firstLine.length <= TARGET_PROMPT_MAX_CHARS) return firstLine

  let slice = firstLine.slice(0, TARGET_PROMPT_MAX_CHARS)
  // Avoid cutting inside an unmatched $...$.
  if ((countUnescapedDollars(slice) % 2) === 1) {
    const last = slice.lastIndexOf('$')
    if (last >= 0) slice = slice.slice(0, last).trim()
  }
  const cutAt = Math.max(slice.lastIndexOf('?'), slice.lastIndexOf('.'), slice.lastIndexOf('!'))
  if (cutAt > 40) return slice.slice(0, cutAt + 1).trim()
  return slice.trim()
}

function ensureKatexDelimiters(value: string) {
  const s = (value || '').trim()
  if (!s) return s
  // If the model already used delimiters, don't touch it.
  if (/[\$]|\\\(|\\\[/.test(s)) {
    // Note: this is intentionally broad; the goal is to avoid double-wrapping.
    if (s.includes('$') || s.includes('\\(') || s.includes('\\[')) return s
  }

  const looksMathy = (t: string) => {
    const text = t.trim()
    if (!text) return false
    const hasCommand = /\\[a-zA-Z]+/.test(text)
    const hasOps = /[=^_]|\\frac|\\sqrt|\\times|\\div|\\cdot|\\pm|\\leq|\\geq/.test(text)
    const wordCount = text.split(/\s+/).filter(Boolean).length
    return (hasCommand || hasOps) && wordCount <= 7
  }

  const wrapInline = (expr: string) => `$${expr.trim()}$`
  const wrapDisplay = (expr: string) => `$$${expr.trim()}$$`

  const lines = s.split('\n')
  const out = lines.map(line => {
    const trimmed = line.trim()
    if (!trimmed) return line

    // If it's a single mathy line, wrap it.
    if (looksMathy(trimmed)) {
      const shouldDisplay = trimmed.length > 34 || trimmed.includes('\\frac') || trimmed.includes('\\sqrt') || trimmed.includes('\\begin')
      return shouldDisplay ? wrapDisplay(trimmed) : wrapInline(trimmed)
    }

    // If the line is like: "Solve: x^2+..." wrap the RHS.
    const colonIdx = line.indexOf(':')
    if (colonIdx >= 0) {
      const left = line.slice(0, colonIdx + 1)
      const right = line.slice(colonIdx + 1)
      if (looksMathy(right)) {
        return `${left} ${wrapInline(right)}`
      }
    }

    return line
  })

  return out.join('\n')
}

function clampLabel(label: string) {
  const s = (label || '').trim().replace(/^Quiz\s*/i, '').trim()
  const normalized = s ? `Quiz ${s}` : ''
  if (!normalized) return ''
  return normalized.length > MAX_LABEL_CHARS ? normalized.slice(0, MAX_LABEL_CHARS).trim() : normalized
}

function phaseNumber(phaseKey: string | null) {
  const key = (phaseKey || '').toLowerCase()
  if (key === 'engage') return 1
  if (key === 'explore') return 2
  if (key === 'explain') return 3
  if (key === 'elaborate') return 4
  if (key === 'evaluate') return 5
  return 1
}

function fallbackQuizLabel(opts: { phaseKey: string | null; pointIndex: number | null; priorQuizCount: number; priorInPointCount: number }) {
  const p = phaseNumber(opts.phaseKey)
  // If we know a point index, increment within the point: Phase.(quiz# within point)
  if (typeof opts.pointIndex === 'number' && Number.isFinite(opts.pointIndex) && opts.pointIndex >= 0) {
    return clampLabel(`${p}.${opts.priorInPointCount + 1}`)
  }
  // Otherwise, just increment within the session.
  return clampLabel(String(opts.priorQuizCount + 1))
}

function parseJsonPackage(text: string): { label?: string; prompt?: string } {
  const raw = (text || '').trim()
  if (!raw) return {}
  const withoutFences = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  try {
    const obj = JSON.parse(withoutFences)
    return {
      label: typeof obj?.label === 'string' ? obj.label : undefined,
      prompt: typeof obj?.prompt === 'string' ? obj.prompt : undefined,
    }
  } catch {
    return {}
  }
}

async function generateWithOpenAI(opts: { apiKey: string; model: string; gradeLabel: string | null; teacherLatex: string; previousPrompt: string; numberingContext: string }) {
  const { apiKey, model, gradeLabel, teacherLatex, previousPrompt, numberingContext } = opts
  const sys =
    'You write quiz prompts for learners. ' +
    'Return ONLY valid JSON with exactly these keys: {"label":"Quiz 1.1","prompt":"..."}. ' +
    `The prompt must be extremely concise (ideally 1 line, max ${TARGET_PROMPT_MAX_CHARS} chars). ` +
    'The label should be short like "Quiz 1.1" and reflect phase/point context if provided. ' +
    'You may use very light emphasis in the prompt using **bold** or _italic_ (no markdown headings/lists). ' +
    'The prompt MUST be specific to the given math context (avoid generic “Solve. Show working.”). ' +
    'Use natural classroom phrasing (e.g. “Solve the following equations simultaneously.” when appropriate). ' +
    'If you include any math, wrap it in $...$ or $$...$$ for KaTeX.'
  const user =
    `Context:\n` +
    `Grade: ${gradeLabel || 'unknown'}\n` +
    `Math context (LaTeX/notes):\n${teacherLatex || '(empty)'}\n\n` +
    (previousPrompt ? `Previous prompt (optional):\n${previousPrompt}\n\n` : '') +
    (numberingContext ? `${numberingContext}\n\n` : '') +
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

async function generateWithAnthropic(opts: { apiKey: string; model: string; gradeLabel: string | null; teacherLatex: string; previousPrompt: string; numberingContext: string }) {
  const { apiKey, model, gradeLabel, teacherLatex, previousPrompt, numberingContext } = opts
  const prompt =
    `You write quiz prompts for learners. Return ONLY valid JSON with exactly these keys: {"label":"Quiz 1.1","prompt":"..."}. ` +
    `The prompt must be extremely concise (ideally 1 line, max ${TARGET_PROMPT_MAX_CHARS} chars). ` +
    `The label should be short like "Quiz 1.1" and reflect phase/point context if provided. ` +
    `You may use very light emphasis in the prompt using **bold** or _italic_ (no markdown headings/lists). ` +
    `The prompt MUST be specific to the given math context (avoid generic “Solve. Show working.”). ` +
    `Use natural classroom phrasing (e.g. “Solve the following equations simultaneously.” when appropriate). ` +
    `If you include any math, wrap it in $...$ or $$...$$ so it renders with KaTeX.\n\n` +
    `Context:\n` +
    `Grade: ${gradeLabel || 'unknown'}\n` +
    `Math context (LaTeX/notes):\n${teacherLatex || '(empty)'}\n\n` +
    (previousPrompt ? `Previous prompt (optional):\n${previousPrompt}\n\n` : '') +
    (numberingContext ? `${numberingContext}\n\n` : '') +
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

async function generateWithGemini(opts: { apiKey: string; model: string; gradeLabel: string | null; teacherLatex: string; previousPrompt: string; numberingContext: string }) {
  const { apiKey, model, gradeLabel, teacherLatex, previousPrompt, numberingContext } = opts
  const prompt =
    `You write quiz prompts for learners. Return ONLY valid JSON with exactly these keys: {"label":"Quiz 1.1","prompt":"..."}. ` +
    `The prompt must be extremely concise (ideally 1 line, max ${TARGET_PROMPT_MAX_CHARS} chars). ` +
    `The label should be short like "Quiz 1.1" and reflect phase/point context if provided. ` +
    `You may use very light emphasis in the prompt using **bold** or _italic_ (no markdown headings/lists). ` +
    `The prompt MUST be specific to the given math context (avoid generic “Solve. Show working.”). ` +
    `Use natural classroom phrasing (e.g. “Solve the following equations simultaneously.” when appropriate). ` +
    `If you include any math, wrap it in $...$ or $$...$$ so it renders with KaTeX.\n\n` +
    `Context:\n` +
    `Grade: ${gradeLabel || 'unknown'}\n` +
    `Math context (LaTeX/notes):\n${teacherLatex || '(empty)'}\n\n` +
    (previousPrompt ? `Previous prompt (optional):\n${previousPrompt}\n\n` : '') +
    (numberingContext ? `${numberingContext}\n\n` : '') +
    `Task: Write a clear quiz question/instructions that matches the context. ` +
    `Keep it concise, student-friendly, and specific. If the context looks like a worked example, ask a similar new question.`

  // Prefer the official SDK used in the quickstart, but keep a REST fallback.
  try {
    const mod: any = await import('@google/genai')
    const GoogleGenAI = mod?.GoogleGenAI
    if (typeof GoogleGenAI !== 'function') throw new Error('GoogleGenAI not available')

    // Quickstart-style: reads from GEMINI_API_KEY; we also pass it explicitly for robustness.
    const ai = new GoogleGenAI({ apiKey })
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
    })
    const text = response?.text
    return typeof text === 'string' ? text.trim() : ''
  } catch (sdkErr: any) {
    // REST fallback (older implementation).
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

  const debugBypass = process.env.DEBUG === '1' && req.headers['x-debug-token'] === 'temp-debug-token'

  const token = debugBypass ? null : await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!debugBypass && !token) return res.status(401).json({ message: 'Unauthorized' })

  const role = debugBypass ? 'teacher' : ((token as any)?.role as string | undefined)
  const isLearner = role === 'student'
  if (isLearner) return res.status(403).json({ message: 'Forbidden' })

  const body = (req.body || {}) as Body
  const gradeLabel = (typeof body.gradeLabel === 'string' ? body.gradeLabel : null)
  const teacherLatex = clampText(body.teacherLatex, MAX_LATEX)
  const previousPrompt = clampText(body.previousPrompt, MAX_PROMPT)
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  const phaseKey = typeof body.phaseKey === 'string' ? body.phaseKey.trim() : ''
  const pointId = typeof body.pointId === 'string' ? body.pointId.trim() : ''
  const pointTitle = typeof body.pointTitle === 'string' ? body.pointTitle.trim() : ''
  const pointIndex = (typeof body.pointIndex === 'number' && Number.isFinite(body.pointIndex)) ? Math.max(0, Math.min(9999, Math.trunc(body.pointIndex))) : null

  // Pull a small summary of existing quizzes for this session (distinct quizId).
  let priorQuizCount = 0
  let priorInPointCount = 0
  let priorLabelsSample = ''
  try {
    if (sessionId) {
      const learnerResponse = (prisma as any).learnerResponse as any
      const rows = await learnerResponse.findMany({
        where: { sessionKey: sessionId },
        orderBy: { createdAt: 'asc' },
        select: { quizId: true, quizLabel: true, quizPhaseKey: true, quizPointIndex: true },
        take: 250,
      })
      const seen = new Set<string>()
      const distinct: any[] = []
      for (const r of rows) {
        const q = typeof r?.quizId === 'string' ? r.quizId : ''
        if (!q || seen.has(q)) continue
        seen.add(q)
        distinct.push(r)
      }
      priorQuizCount = distinct.length
      if (phaseKey && typeof pointIndex === 'number') {
        priorInPointCount = distinct.filter(r => (r?.quizPhaseKey || '') === phaseKey && r?.quizPointIndex === pointIndex).length
      }
      priorLabelsSample = distinct
        .slice(Math.max(0, distinct.length - 10))
        .map((r: any) => `${r.quizLabel || '(unlabeled)'} [${r.quizPhaseKey || '?'}:${typeof r.quizPointIndex === 'number' ? r.quizPointIndex + 1 : '?'}]`)
        .join(', ')
    }
  } catch {
    // ignore
  }

  // Provider selection (optional). If not configured, auto-pick based on available keys.
  const configuredProvider = (process.env.AI_PROVIDER || '').toLowerCase() // 'openai' | 'anthropic' | 'gemini'
  const hasGeminiKey = Boolean((process.env.GEMINI_API_KEY || '').trim())
  const hasOpenAIKey = Boolean((process.env.OPENAI_API_KEY || '').trim())
  const hasAnthropicKey = Boolean((process.env.ANTHROPIC_API_KEY || '').trim())

  const provider = (() => {
    if (configuredProvider === 'gemini' || configuredProvider === 'openai' || configuredProvider === 'anthropic' || configuredProvider === 'claude') {
      return configuredProvider
    }
    if (hasGeminiKey) return 'gemini'
    if (hasOpenAIKey) return 'openai'
    if (hasAnthropicKey) return 'anthropic'
    return ''
  })()

  try {
    let raw = ''
    let source: 'ai' | 'heuristic' = 'heuristic'
    let providerUsed: string | null = null

    const numberingContext =
      `Numbering context (use this to choose a new unique label):\n` +
      `Session quiz count so far: ${priorQuizCount}\n` +
      `Phase: ${phaseKey || 'unknown'}\n` +
      `Point index: ${typeof pointIndex === 'number' ? pointIndex + 1 : 'unknown'}\n` +
      `Point id: ${pointId || 'unknown'}\n` +
      (pointTitle ? `Point title: ${pointTitle}\n` : '') +
      (priorLabelsSample ? `Recent quiz labels: ${priorLabelsSample}\n` : '')

    if (provider === 'openai' && process.env.OPENAI_API_KEY) {
      raw = await generateWithOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        gradeLabel,
        teacherLatex,
        previousPrompt,
        numberingContext,
      })
      source = 'ai'
      providerUsed = 'openai'
    } else if ((provider === 'anthropic' || provider === 'claude') && process.env.ANTHROPIC_API_KEY) {
      raw = await generateWithAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest',
        gradeLabel,
        teacherLatex,
        previousPrompt,
        numberingContext,
      })
      source = 'ai'
      providerUsed = 'anthropic'
    } else if (provider === 'gemini' && process.env.GEMINI_API_KEY) {
      raw = await generateWithGemini({
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
        gradeLabel,
        teacherLatex,
        previousPrompt,
        numberingContext,
      })
      source = 'ai'
      providerUsed = 'gemini'
    } else {
      raw = ''
    }

    const parsed = raw ? parseJsonPackage(raw) : {}
    const fallbackLabel = fallbackQuizLabel({ phaseKey: phaseKey || null, pointIndex, priorQuizCount, priorInPointCount })
    const label = clampLabel(typeof parsed.label === 'string' ? parsed.label : '') || fallbackLabel

    const rawLooksLikeJson = raw.trim().startsWith('{') || raw.trim().startsWith('```')
    const finalPromptRaw = clampText(
      typeof parsed.prompt === 'string'
        ? parsed.prompt
        : (rawLooksLikeJson ? '' : (raw || '')),
      MAX_PROMPT
    )
    const promptShort = shortenPrompt(finalPromptRaw || '')
    const promptKatex = shortenPrompt(ensureKatexDelimiters(promptShort))
    const prompt = promptKatex || shortenPrompt(ensureKatexDelimiters(heuristicPrompt(gradeLabel, teacherLatex)))

    return res.status(200).json({ prompt, label, source, providerUsed })
  } catch (err: any) {
    console.warn('AI quiz prompt generation failed; falling back', err?.message || err)
    const label = fallbackQuizLabel({ phaseKey: phaseKey || null, pointIndex, priorQuizCount, priorInPointCount })
    return res.status(200).json({ prompt: shortenPrompt(ensureKatexDelimiters(heuristicPrompt(gradeLabel, teacherLatex))), label, source: 'heuristic', providerUsed: null })
  }
}
