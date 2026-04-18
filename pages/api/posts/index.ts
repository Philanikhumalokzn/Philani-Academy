import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserGrade, getUserIdFromReq } from '../../../lib/auth'
import { normalizeGradeInput } from '../../../lib/grades'
import { buildSocialPostComposerFields, type SocialPostComposerMeta } from '../../../lib/postComposerContent'
import { normalizePostReplyBlocks } from '../../../lib/postReplyComposer'

const MAX_TITLE_LENGTH = 120
const MAX_PROMPT_LENGTH = 5000
const MAX_IMAGE_URL_LENGTH = 2000

const AUDIENCES = new Set(['public', 'grade', 'private'])

function parseComposerMeta(value: unknown): SocialPostComposerMeta | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const origin = typeof raw.origin === 'string' ? raw.origin.trim() : ''
  const sourceId = typeof raw.sourceId === 'string' ? raw.sourceId.trim() : ''
  const questionId = typeof raw.questionId === 'string' ? raw.questionId.trim() : ''
  const questionNumber = typeof raw.questionNumber === 'string' ? raw.questionNumber.trim() : ''
  if (!origin && !sourceId && !questionId && !questionNumber) return null
  return {
    ...(origin ? { origin } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(questionId ? { questionId } : {}),
    ...(questionNumber ? { questionNumber } : {}),
  }
}

function parseMaxAttempts(value: unknown) {
  if (value == null || value === '' || value === 'unlimited') return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(100, Math.max(1, Math.floor(value)))
}

function isMissingSocialPostsTableError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err || '')
  return /socialpost/i.test(message) && /(does not exist|not exist|no such table|relation)/i.test(message)
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  const socialPost = (prisma as any).socialPost as typeof prisma extends { socialPost: infer T } ? T : any

  if (req.method === 'POST') {
    const body = req.body || {}
    const title = (typeof body.title === 'string' ? body.title.trim() : '').slice(0, MAX_TITLE_LENGTH)
    const composerBlocks = normalizePostReplyBlocks(Array.isArray(body.contentBlocks) ? body.contentBlocks : { studentText: body.prompt, imageUrl: body.imageUrl })
    const hasStructuredComposer = Array.isArray(body.contentBlocks)
    const requestedPrompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    const prompt = hasStructuredComposer ? requestedPrompt : requestedPrompt.slice(0, MAX_PROMPT_LENGTH)
    const explicitImageUrl = (typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '').slice(0, MAX_IMAGE_URL_LENGTH) || null
    const structuredFields = buildSocialPostComposerFields(composerBlocks, parseComposerMeta(body.composerMeta))
    const storedPrompt = hasStructuredComposer ? structuredFields.storedPrompt : prompt
    const imageUrl = hasStructuredComposer ? structuredFields.primaryImageUrl : explicitImageUrl
    const audienceRaw = typeof body.audience === 'string' ? body.audience.trim().toLowerCase() : 'public'
    const audience = AUDIENCES.has(audienceRaw) ? audienceRaw : 'public'
    const maxAttempts = parseMaxAttempts(body.maxAttempts)
    const tokenGrade = normalizeGradeInput(await getUserGrade(req))
    const bodyGrade = normalizeGradeInput(typeof body.grade === 'string' ? body.grade : undefined)
    const grade = bodyGrade || tokenGrade || null

    if (!storedPrompt && !imageUrl && composerBlocks.length === 0) {
      return res.status(400).json({ message: 'Either text or an image is required' })
    }

    try {
      const created = await socialPost.create({
        data: {
          createdById: userId,
          title,
          prompt: storedPrompt,
          imageUrl,
          audience,
          grade,
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
            const followerIds = Array.from(new Set(followers.map((f: any) => String(f.followerId || '')).filter(Boolean)))
            if (followerIds.length > 0) {
              await prisma.notification.createMany({
                data: followerIds.map((followerId) => ({
                  userId: String(followerId),
                  type: 'new_post',
                  title: 'New post',
                  body: 'Shared a new post',
                  data: { postId: created.id, createdById: userId },
                })),
              })
            }
          }
        } catch (notifyErr) {
          if (process.env.DEBUG === '1') console.error('Failed to notify followers of new post', notifyErr)
        }
      }

      return res.status(200).json(created)
    } catch (err: any) {
      if (isMissingSocialPostsTableError(err)) {
        return res.status(503).json({ message: 'Posts are unavailable until the SocialPost database migration is applied.' })
      }
      console.error('Failed to create post', err)
      return res.status(500).json({ message: err?.message || 'Failed to create post' })
    }
  }

  res.setHeader('Allow', ['POST'])
  return res.status(405).end('Method Not Allowed')
}