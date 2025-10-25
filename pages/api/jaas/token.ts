import type { NextApiRequest, NextApiResponse } from 'next'
import { getSession } from 'next-auth/react'
import jwt from 'jsonwebtoken'
import { buildJaasPayload, parseJaasSubFromKid } from '../../../lib/jaas'

// Simple in-memory rate limiter (per IP). For production use a shared cache (Redis) instead.
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
const RATE_LIMIT_MAX = parseInt(process.env.JAAS_RATE_LIMIT_MAX || '10', 10)
const hits: Record<string, number[]> = {}

function isRateLimited(ip: string) {
  const now = Date.now()
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  hits[ip] = (hits[ip] || []).filter((ts) => ts > windowStart)
  if (hits[ip].length >= RATE_LIMIT_MAX) return true
  hits[ip].push(now)
  return false
}

type Data = { token: string; expiresAt: number } | { error: string }

export default async function handler(req: NextApiRequest, res: NextApiResponse<Data>) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown'
  if (isRateLimited(ip)) {
    console.warn('[jaas:token] rate limit exceeded', { ip })
    return res.status(429).json({ error: 'Too many requests' })
  }

  console.info('[jaas:token] request', { ip, path: req.url })

  // Debug: log headers to diagnose session/cookie issues
  const headers = {
    cookie: req.headers.cookie,
    authorization: req.headers.authorization,
    'x-forwarded-for': req.headers['x-forwarded-for'],
    'user-agent': req.headers['user-agent']
  }
  console.debug('[jaas:token] headers', headers)

  const session = await getSession({ req })
  console.debug('[jaas:token] session result', { 
    hasSession: !!session,
    user: session?.user,
    expires: session?.expires
  })
  if (!session) return res.status(401).json({ error: 'Not authenticated' })

  const { room } = req.body ?? {}
  const roomName = typeof room === 'string' && room.length ? room : 'Algebra'

  const privateKey = process.env.JAAS_PRIVATE_KEY
  const kid = process.env.JAAS_KID
  if (!privateKey) {
    return res.status(500).json({ error: 'Server missing signing key' })
  }

  // Determine tenant (sub). Prefer explicit JAAS_SUB, else derive from kid (text before '/').
  const sub = process.env.JAAS_SUB || parseJaasSubFromKid(kid)
  if (!sub) {
    return res.status(500).json({ error: 'Server missing JAAS_SUB (tenant) or unparsable JAAS_KID' })
  }

  const ttlSeconds = parseInt(process.env.JAAS_TTL_SECONDS || '7200', 10)

  const userAny = session.user as any
  const moderator = (userAny?.role === 'admin')
  const payload = buildJaasPayload({
    sub,
    room: roomName || '*',
    ttlSeconds,
    moderator,
    user: {
      name: userAny?.name || 'Unknown',
      id: userAny?.id || userAny?.email,
      email: userAny?.email,
      avatar: userAny?.image,
    },
  })

  const signOptions: jwt.SignOptions = {
    algorithm: 'RS256',
    keyid: kid,
  }

  try {
    const token = jwt.sign(payload as any, privateKey, signOptions)
    // exp is in seconds inside payload
    return res.status(200).json({ token, expiresAt: (payload.exp as number) * 1000 })
  } catch (err) {
    console.error('token sign error', err)
    return res.status(500).json({ error: 'Failed to sign token' })
  }
}
