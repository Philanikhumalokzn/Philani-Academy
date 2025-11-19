import type { NextApiRequest, NextApiResponse } from 'next'
import Ably from 'ably/promises'

type ErrorResponse = { error: string }
type TokenRequestResponse = Record<string, unknown>

const sanitizeIdentifier = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60)

let restClient: any = null

const getRestClient = () => {
  const apiKey = process.env.ABLY_API_KEY
  if (!apiKey) {
    return null
  }
  if (!restClient) {
    restClient = new Ably.Rest({ key: apiKey })
  }
  return restClient
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TokenRequestResponse | ErrorResponse>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'Method not allowed.' })
    return
  }

  const rest = getRestClient()
  if (!rest) {
    res.status(500).json({ error: 'Missing ABLY_API_KEY environment variable' })
    return
  }

  const rawClientId = Array.isArray(req.query.clientId) ? req.query.clientId[0] : req.query.clientId
  const clientId = rawClientId ? sanitizeIdentifier(rawClientId) : 'anonymous'

  try {
    const tokenRequest = await rest.auth.createTokenRequest({
      clientId,
      capability: JSON.stringify({
        'myscript:*': ['publish', 'subscribe', 'presence'],
      }),
      ttl: 60 * 60 * 1000,
    })
    res.status(200).json(tokenRequest)
  } catch (error) {
    console.error('Failed to create Ably token request', error)
    res.status(500).json({ error: 'Unable to create Ably token request' })
  }
}
