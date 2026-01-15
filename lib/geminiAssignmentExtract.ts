function clampText(input: any, max: number): string {
  const s = typeof input === 'string' ? input : ''
  if (s.length <= max) return s
  return s.slice(0, max)
}

export function tryParseJsonLoose(text: string): any | null {
  const trimmed = (text || '').trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
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

export async function extractQuestionsWithGemini(opts: {
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
    `\n- Do NOT invent missing text; if something is unreadable, insert a short placeholder like "[illegible]".` +
    `\n- Grade level: ${gradeLabel}.` +
    `\n\nTitle hint: ${clampText(titleHint || filename || 'Assignment', 160)}.`

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
          parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Data } }],
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
            parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Data } }],
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
