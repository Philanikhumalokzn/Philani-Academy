import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import { handleUpload } from '@vercel/blob/client'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
}

function getBaseUrl(req: NextApiRequest) {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  const host = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string) || ''
  return host ? `${proto}://${host}` : ''
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end('Method not allowed')
  }

  try {
    const token = await getToken({ req })
    const role = ((token as any)?.role as string | undefined) || 'student'

    if (role !== 'admin' && role !== 'teacher' && role !== 'student') {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const baseUrl = getBaseUrl(req)
    const url = `${baseUrl}${req.url || '/api/resources/blob-upload'}`

    // `handleUpload` expects a Web Fetch API `Request`.
    const request = new Request(url, {
      method: 'POST',
      headers: req.headers as any,
      body: JSON.stringify(req.body ?? {}),
    })

    const jsonResponse = await handleUpload({
      body: req.body as any,
      request,
      onBeforeGenerateToken: async (_pathname: string, _clientPayload: string | null) => {
        return {
          access: 'public',
          addRandomSuffix: false,
          // Keep this permissive; Resource Bank supports many doc types.
          // Tighten later if you want stricter upload validation.
          allowedContentTypes: [
            'application/pdf',
            'image/png',
            'image/jpeg',
            'image/webp',
            'image/gif',
            'image/svg+xml',
            'text/plain',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/octet-stream',
          ],
          tokenPayload: JSON.stringify({
            userId: String((token as any)?.sub || ''),
            role,
            at: Date.now(),
          }),
        }
      },
      onUploadCompleted: async () => {
        // Intentionally no-op.
        // We register the resource immediately from the client after upload.
      },
    })

    return res.status(200).json(jsonResponse)
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || 'Blob upload init failed' })
  }
}
