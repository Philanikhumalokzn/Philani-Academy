import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../lib/prisma'
import { getUserIdFromReq } from '../../../../lib/auth'
import crypto from 'crypto'

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex')
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })
  const { phoneId, code } = req.body || {}
  if (!phoneId || !code) return res.status(400).json({ message: 'Missing fields' })

  try {
    const pn = await prisma.phoneNumber.findFirst({ where: { id: phoneId, userId } })
    if (!pn) return res.status(404).json({ message: 'Phone number not found' })
    if (!pn.codeHash || !pn.codeExpiresAt) return res.status(400).json({ message: 'No code requested' })
    if (new Date(pn.codeExpiresAt).getTime() < Date.now()) return res.status(400).json({ message: 'Code expired' })

    const ok = hashCode(code) === pn.codeHash
    if (!ok) return res.status(400).json({ message: 'Invalid code' })

    await prisma.phoneNumber.update({
      where: { id: pn.id },
      data: { verified: true, codeHash: null, codeExpiresAt: null }
    })

    return res.status(200).json({ verified: true })
  } catch (err) {
    console.error('POST /api/profile/phone/confirm error', err)
    return res.status(500).json({ message: 'Server error' })
  }
}
