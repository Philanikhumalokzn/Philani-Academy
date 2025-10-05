import type { NextApiRequest, NextApiResponse } from 'next'
import crypto from 'crypto'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const { id } = req.query
  if (!id || Array.isArray(id)) return res.status(400).json({ message: 'Missing session id' })

  const secret = process.env.ROOM_SECRET || ''
  if (!secret) return res.status(500).json({ message: 'Room secret not configured' })

  // Generate HMAC-based room name and prefix with project to avoid collisions
  const h = crypto.createHmac('sha256', secret).update(String(id)).digest('hex').slice(0, 12)
  const roomName = `philani-${String(id)}-${h}`
  res.status(200).json({ roomName })
}
