import type { NextApiRequest, NextApiResponse } from 'next'

type MathpixStrokeRequest = {
  strokes?: {
    x?: number[][]
    y?: number[][]
  } | {
    strokes?: {
      x?: number[][]
      y?: number[][]
    }
  }
  formats?: string[]
  options?: Record<string, unknown>
}

const DEFAULT_FORMATS = ['latex_styled', 'text']

const extractLatexFromText = (text: string) => {
  if (!text) return ''
  const trimmed = text.trim()
  const strip = (value: string, open: string, close: string) =>
    value.startsWith(open) && value.endsWith(close)
      ? value.slice(open.length, value.length - close.length).trim()
      : value

  let next = trimmed
  next = strip(next, '\\(', '\\)')
  next = strip(next, '\\[', '\\]')
  next = strip(next, '$$', '$$')
  next = strip(next, '$', '$')
  return next.trim()
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const appId = process.env.MATHPIX_APP_ID
  const appKey = process.env.MATHPIX_APP_KEY

  if (!appId || !appKey) {
    res.status(500).json({ error: 'Missing Mathpix credentials on server.' })
    return
  }

  const body = req.body as MathpixStrokeRequest | null
  const direct = body?.strokes && 'x' in body.strokes ? body.strokes : null
  const nested = body?.strokes && 'strokes' in body.strokes ? body.strokes.strokes : null
  const strokes = (direct ?? nested) as { x?: number[][]; y?: number[][] } | null

  const x = Array.isArray(strokes?.x) ? strokes?.x : null
  const y = Array.isArray(strokes?.y) ? strokes?.y : null

  if (!x || !y || x.length === 0 || y.length === 0 || x.length !== y.length) {
    res.status(400).json({ error: 'Invalid strokes payload.' })
    return
  }

  const payload = {
    strokes: {
      strokes: {
        x,
        y,
      },
    },
    formats: Array.isArray(body?.formats) && body?.formats.length ? body?.formats : DEFAULT_FORMATS,
    rm_spaces: true,
    metadata: {
      improve_mathpix: false,
    },
    ...(body?.options && typeof body.options === 'object' ? body.options : {}),
  }

  try {
    const upstream = await fetch('https://api.mathpix.com/v3/strokes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        app_id: appId,
        app_key: appKey,
      },
      body: JSON.stringify(payload),
    })

    const data = await upstream.json().catch(() => null)
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: data?.error || 'Mathpix request failed.', details: data?.error_info })
      return
    }

    const latexStyled = typeof data?.latex_styled === 'string' ? data.latex_styled : ''
    const text = typeof data?.text === 'string' ? data.text : ''
    const latex = latexStyled || extractLatexFromText(text)

    res.status(200).json({
      latex,
      latex_styled: latexStyled,
      text,
      confidence: typeof data?.confidence === 'number' ? data.confidence : null,
      confidence_rate: typeof data?.confidence_rate === 'number' ? data.confidence_rate : null,
      request_id: data?.request_id,
      version: data?.version,
    })
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Mathpix request failed.' })
  }
}
