import type { NextApiRequest, NextApiResponse } from 'next'
import { getSession } from 'next-auth/react'
import jwt from 'jsonwebtoken'

type Data = { token: string; expiresAt: number } | { error: string }

export default async function handler(req: NextApiRequest, res: NextApiResponse<Data>) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const session = await getSession({ req })
  if (!session) return res.status(401).json({ error: 'Not authenticated' })

  const { room } = req.body ?? {}
  const roomName = typeof room === 'string' && room.length ? room : 'Algebra'

  const privateKey = process.env.JAAS_PRIVATE_KEY
  const kid = process.env.JAAS_KID
  const issuer = process.env.JAAS_ISS || process.env.JAAS_APP_ID || 'philani-academy'

  if (!privateKey) {
    return res.status(500).json({ error: 'Server missing signing key' })
  }

  const ttlSeconds = parseInt(process.env.JAAS_TTL_SECONDS || '3600', 10)
  const now = Math.floor(Date.now() / 1000)

  const payload = {
    iss: issuer,
    sub: issuer,
    aud: '8x8',
    room: roomName,
    iat: now,
    exp: now + ttlSeconds,
  }

  const signOptions: jwt.SignOptions = {
    algorithm: 'RS256',
    keyid: kid,
  }

  try {
    const token = jwt.sign(payload, privateKey, signOptions)
    return res.status(200).json({ token, expiresAt: (now + ttlSeconds) * 1000 })
  } catch (err) {
    console.error('token sign error', err)
    return res.status(500).json({ error: 'Failed to sign token' })
  }
}
