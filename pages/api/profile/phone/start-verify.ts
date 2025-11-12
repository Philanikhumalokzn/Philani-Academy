import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../lib/prisma'
import { getUserIdFromReq } from '../../../../lib/auth'
import crypto from 'crypto'

function generateCode(): string {
  return (Math.floor(100000 + Math.random() * 900000)).toString() // 6 digits
}

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex')
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  const { phoneId, number, label } = req.body || {}
  if (!phoneId && !number) return res.status(400).json({ message: 'Provide phoneId or number' })

  try {
    let pn = null as any
    if (phoneId) {
      pn = await prisma.phoneNumber.findFirst({ where: { id: phoneId, userId } })
      if (!pn) return res.status(404).json({ message: 'Phone number not found' })
    } else {
      // Create if not exists
      pn = await prisma.phoneNumber.findFirst({ where: { userId, number } })
      if (!pn) {
        pn = await prisma.phoneNumber.create({ data: { userId, number, label: label || null } })
      }
    }

    // Basic rate limit: allow sending if lastSentAt older than 60 seconds
    const now = new Date()
    if (pn.lastSentAt && now.getTime() - new Date(pn.lastSentAt).getTime() < 60 * 1000) {
      return res.status(429).json({ message: 'Please wait before requesting another code' })
    }

    const code = generateCode()
    const codeHash = hashCode(code)
    const codeExpiresAt = new Date(now.getTime() + 10 * 60 * 1000)

    await prisma.phoneNumber.update({
      where: { id: pn.id },
      data: { codeHash, codeExpiresAt, lastSentAt: now, verified: false }
    })

    // TODO: Integrate SMS provider (Twilio, Africa's Talking, etc.)
    // For development, we can return the code when DEBUG=1
    const payload: any = { sent: true }
    if (process.env.DEBUG === '1') payload.debugCode = code

    return res.status(200).json(payload)
  } catch (err) {
    console.error('POST /api/profile/phone/start-verify error', err)
    return res.status(500).json({ message: 'Server error' })
  }
}
