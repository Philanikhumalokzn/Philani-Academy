import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserIdFromReq } from '../../../lib/auth'
import fs from 'fs'
import path from 'path'

export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  const { imageBase64 } = req.body || {}
  if (!imageBase64 || typeof imageBase64 !== 'string') return res.status(400).json({ message: 'imageBase64 required' })

  try {
    // Expect data URL or pure base64; normalize
    const matches = imageBase64.match(/^data:(.+);base64,(.*)$/)
    const base64Data = matches ? matches[2] : imageBase64
    const buffer = Buffer.from(base64Data, 'base64')

    const avatarsDir = path.join(process.cwd(), 'public', 'avatars')
    if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true })
    const filename = `${userId}-${Date.now()}.png`
    const filePath = path.join(avatarsDir, filename)
    fs.writeFileSync(filePath, buffer)

    const urlPath = `/avatars/${filename}`
    await prisma.user.update({ where: { id: userId }, data: { avatarUrl: urlPath } })

    return res.status(200).json({ avatarUrl: urlPath })
  } catch (err) {
    console.error('POST /api/profile/avatar error', err)
    return res.status(500).json({ message: 'Server error' })
  }
}
