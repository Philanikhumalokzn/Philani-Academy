import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import jwt from 'jsonwebtoken'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // require GET
  if (req.method !== 'GET') return res.status(405).end()

  // require authenticated user (admin/owner) to avoid public probing
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ ok: false, message: 'Unauthorized' })

  const ownerEmail = process.env.OWNER_EMAIL || process.env.NEXT_PUBLIC_OWNER_EMAIL || ''
  const isOwner = ownerEmail && (token as any).email === ownerEmail
  const isAdmin = (token as any)?.role === 'admin'
  if (!isOwner && !isAdmin) return res.status(403).json({ ok: false, message: 'Forbidden' })

  // Check RS256 config
  const jaasPriv = process.env.JAAS_PRIVATE_KEY || ''
  const jaasKid = process.env.JAAS_KEY_ID || ''
  const jaasApp = process.env.JAAS_APP_ID || ''

  if (jaasPriv && jaasKid && jaasApp) {
    // Try a quick sign (short-lived) to verify key is usable, but do NOT return the token
    try {
      const now = Math.floor(Date.now() / 1000)
      const payload: any = { aud: 'jitsi', iss: 'chat', iat: now, exp: now + 60, sub: jaasApp }
      const privateKey = jaasPriv.replace(/\\n/g, '\n')
      jwt.sign(payload, privateKey, { algorithm: 'RS256', keyid: jaasKid })
      return res.status(200).json({ ok: true, alg: 'RS256', kid: jaasKid, app: jaasApp })
    } catch (err: any) {
      return res.status(500).json({ ok: false, message: 'RS256 signing failed', error: String(err) })
    }
  }

  // HS256 fallback check
  const appId = process.env.JITSI_JAAS_APP_ID || ''
  const apiKey = process.env.JITSI_JAAS_API_KEY || ''
  const apiSecret = process.env.JITSI_JAAS_API_SECRET || ''
  if (appId && apiKey && apiSecret) {
    return res.status(200).json({ ok: true, alg: 'HS256', app: appId })
  }

  return res.status(500).json({ ok: false, message: 'No JaaS credentials configured' })
}
