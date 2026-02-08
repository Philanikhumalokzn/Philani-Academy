import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end('Method not allowed')
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = ((token as any)?.role as string | undefined) || 'student'
  if (role !== 'admin' && role !== 'teacher' && role !== 'student') {
    return res.status(403).json({ message: 'Forbidden' })
  }

  try {
    const body = (req.body || {}) as any
    const mmd = typeof body?.mmd === 'string' ? body.mmd.trim() : ''
    const title = typeof body?.title === 'string' ? body.title.trim() : 'parsed'

    if (!mmd) return res.status(400).json({ message: 'MMD content required' })

    const byteLength = Buffer.byteLength(mmd, 'utf8')
    if (byteLength > 9 * 1024 * 1024) {
      return res.status(400).json({ message: 'Parsed content is too large to convert (max 9MB)' })
    }

    const appId = (process.env.MATHPIX_APP_ID || '').trim()
    const appKey = (process.env.MATHPIX_APP_KEY || '').trim()
    if (!appId || !appKey) {
      return res.status(500).json({ message: 'Mathpix is not configured (missing MATHPIX_APP_ID or MATHPIX_APP_KEY)' })
    }

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

    const buffer = Buffer.from(await docxRes.arrayBuffer())
    const safeBase = title.replace(/\.[^/.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_') || 'parsed'
    const filename = `${safeBase}.docx`

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.status(200).send(buffer)
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to convert to docx' })
  }
}
