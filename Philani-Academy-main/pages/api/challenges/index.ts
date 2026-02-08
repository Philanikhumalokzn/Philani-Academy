import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserGrade, getUserIdFromReq } from '../../../lib/auth'
import { normalizeGradeInput } from '../../../lib/grades'

const MAX_TITLE_LENGTH = 120
const MAX_PROMPT_LENGTH = 5000
const MAX_IMAGE_URL_LENGTH = 2000

const AUDIENCES = new Set(['public', 'grade', 'private'])

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  // Schema contains UserChallenge but some Prisma clients in this repo are generated stale.
  const userChallenge = (prisma as any).userChallenge as typeof prisma extends { userChallenge: infer T } ? T : any

  if (req.method === 'POST') {
    const body = req.body || {}

    const title = (typeof body.title === 'string' ? body.title.trim() : '').slice(0, MAX_TITLE_LENGTH)
    const imageUrl = (typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '').slice(0, MAX_IMAGE_URL_LENGTH) || null

    const requestedPrompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    const prompt = requestedPrompt.slice(0, MAX_PROMPT_LENGTH)

    const audienceRaw = typeof body.audience === 'string' ? body.audience.trim().toLowerCase() : 'public'
    const audience = AUDIENCES.has(audienceRaw) ? audienceRaw : 'public'

    const tokenGrade = normalizeGradeInput(await getUserGrade(req))
    const bodyGrade = normalizeGradeInput(typeof body.grade === 'string' ? body.grade : undefined)
    const grade = bodyGrade || tokenGrade || null

    const maxAttempts = (typeof body.maxAttempts === 'number' && body.maxAttempts > 0) 
      ? Math.min(100, Math.max(1, Math.floor(body.maxAttempts)))
      : null

    const hasMeaningfulPrompt = Boolean(prompt)
    const hasImage = Boolean(imageUrl)
    if (!hasMeaningfulPrompt && !hasImage) {
      return res.status(400).json({ message: 'Either a prompt or an image is required' })
    }

    // Canvas quiz initialization requires a non-empty prompt.
    const effectivePrompt = hasMeaningfulPrompt ? prompt : 'See attached image.'

    try {
      const created = await userChallenge.create({
        data: {
          createdById: userId,
          title,
          prompt: effectivePrompt,
          imageUrl,
          grade,
          audience,
          maxAttempts,
        },
      })

      if (audience === 'public') {
        try {
          const userFollow = (prisma as any).userFollow as any
          if (userFollow) {
            const followers = await userFollow.findMany({
              where: { followingId: userId },
              select: { followerId: true },
            })
            const followerIds = Array.from(new Set(followers.map((f: any) => String(f.followerId)).filter(Boolean))) as string[]
            if (followerIds.length > 0) {
              await prisma.notification.createMany({
                data: followerIds.map((followerId) => ({
                  userId: String(followerId),
                  type: 'new_challenge',
                  title: 'New challenge',
                  body: 'Posted a new challenge',
                  data: { challengeId: created.id, createdById: userId },
                })),
              })
            }
          }
        } catch (notifyErr) {
          if (process.env.DEBUG === '1') console.error('Failed to notify followers of new challenge', notifyErr)
        }
      }

      return res.status(200).json(created)
    } catch (err: any) {
      console.error('Failed to create challenge', err)
      return res.status(500).json({ message: err?.message || 'Failed to create challenge' })
    }
  }

  res.setHeader('Allow', ['POST'])
  return res.status(405).end('Method Not Allowed')
}
