import type { NextApiRequest, NextApiResponse } from 'next'
import bcrypt from 'bcryptjs'
import prisma from '../../lib/prisma'

async function getRawBody(req: NextApiRequest) {
  return await new Promise<string>((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', (err) => reject(err))
  })
}

export const config = {
  api: {
    bodyParser: false,
  },
}

// Runtime debug: do not print secrets. Log whether DATABASE_URL is present and its scheme.
try {
  const dbUrl = process.env.DATABASE_URL
  if (dbUrl) {
    console.log('/api/signup runtime DB config: DATABASE_URL present, scheme=', dbUrl.split(':')[0])
  } else {
    console.log('/api/signup runtime DB config: DATABASE_URL missing')
  }
} catch (e) {
  // ignore
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS: allow requests from any origin for this API endpoint and respond to preflight
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }
  // Only accept POST (OPTIONS handled above). No public debug GET in production code.
  // DEBUG-aware behavior was used temporarily for troubleshooting and has been removed.
  if (req.method !== 'POST') return res.status(405).end()
  // Support cases where Next's body parser fails on the platform (returning "Invalid JSON").
  let body: any = req.body
  let rawBody = ''
  if (!body || typeof body !== 'object') {
    try {
      const raw = await getRawBody(req)
      rawBody = raw
      try {
        body = raw ? JSON.parse(raw) : {}
      } catch (jsonErr) {
        // Try parse as URL-encoded form (some clients/edge cases)
        try {
          const params = new URLSearchParams(raw)
          const obj: Record<string,string> = {}
          params.forEach((v,k) => { obj[k] = v })
          // If URLSearchParams produced no keys, try loose parser (handles colon-separated pairs)
          if (Object.keys(obj).length === 0) {
            body = parseLooseBody(raw)
          } else {
            body = obj
          }
        } catch (e) {
          // Robust fallback: handle loose formats like {name:Bob,email:bob@example.com}
          try {
            const loose = parseLooseBody(raw)
            body = loose
          } catch (e2) {
            console.error('Failed to parse raw body for /api/signup:', raw)
            throw jsonErr
          }
        }
      }
    } catch (err) {
      return res.status(400).json({ message: 'Invalid JSON' })
    }
  }

  // Loose body parser: accepts formats like
  // {name:Bob,email:bob@example.com} or name:Bob,email:bob@example.com or name=Bob&email=bob
  function parseLooseBody(raw: string) {
    const out: Record<string,string> = {}
    if (!raw) return out
    // remove surrounding braces
    let s = raw.trim()
    if (s.startsWith('{') && s.endsWith('}')) s = s.slice(1, -1)
    // split on commas or ampersands
    const pairs = s.split(/[,\u0026]/)
    for (const p of pairs) {
      const pair = p.trim()
      if (!pair) continue
      let idx = pair.indexOf(':')
      if (idx === -1) idx = pair.indexOf('=')
      if (idx === -1) continue
      const k = pair.slice(0, idx).trim()
      let v = pair.slice(idx + 1).trim()
      // strip quotes if any
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      out[k] = decodeURIComponent(v)
    }
    return out
  }
  const { name, email, password } = body
  // Debug: log which fields we received (mask password)
  try {
    console.log('/api/signup parsed body:', { name, email, password: password ? '***' : '' })
  } catch (e) {
    // ignore logging errors
  }
  if (!email || !password) {
      // Final fallback: try to extract fields directly from raw text using regexes
      try {
        const emailMatch = rawBody.match(/email\s*[:=]\s*['\"]?([^,'\"\s\}]+)/i)
        const passMatch = rawBody.match(/password\s*[:=]\s*['\"]?([^,'\"\s\}]+)/i)
        const nameMatch = rawBody.match(/name\s*[:=]\s*['\"]?([^,'\"\s\}]+)/i)
        if (emailMatch && emailMatch[1]) {
          body.email = decodeURIComponent(emailMatch[1])
        }
        if (passMatch && passMatch[1]) {
          body.password = decodeURIComponent(passMatch[1])
        }
        if (nameMatch && nameMatch[1]) {
          body.name = decodeURIComponent(nameMatch[1])
        }
      } catch (e) {
        // ignore
      }
      // recalc locals
      const { name: _name2, email: _email2, password: _password2 } = body
      if (_email2 && _password2) {
        // proceed
      } else {
        // Provide safe debug info to help diagnose production parsing differences.
        const ct = req.headers['content-type'] || ''
        const rawPreview = rawBody ? rawBody.slice(0, 512) : ''
        console.warn('/api/signup missing fields', { provided: { name: !!_name2, email: !!_email2, password: !!_password2 }, contentType: ct, rawPreview: rawPreview ? `${rawPreview}${rawBody.length > 512 ? '...(truncated)' : ''}` : '' })
        return res.status(400).json({ message: 'Missing fields', provided: { name: !!_name2, email: !!_email2, password: !!_password2 }, contentType: ct, rawPreview })
      }
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return res.status(409).json({ message: 'User exists' })

    const hashed = await bcrypt.hash(password, 10)
    // If first user, make them admin
    const count = await prisma.user.count()
    const role = count === 0 ? 'admin' : 'student'
    const user = await prisma.user.create({ data: { name, email, password: hashed, role } })
    return res.status(201).json({ id: user.id, email: user.email })
  } catch (err) {
    // Log full error server-side always (masked in production logs if necessary)
    console.error('/api/signup server error', err)
    // When DEBUG=1 expose a helpful message in the JSON body to aid diagnosis.
    const debug = process.env.DEBUG === '1'
    const msg = debug && err && typeof err === 'object' && 'message' in err ? (err as any).message : 'Server error'
    return res.status(500).json({ message: msg })
  }
}
