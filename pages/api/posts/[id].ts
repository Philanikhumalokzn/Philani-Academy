import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserGrade, getUserIdFromReq, getUserRole } from '../../../lib/auth'
import { normalizeGradeInput } from '../../../lib/grades'

const MAX_TITLE_LENGTH = 120
const MAX_PROMPT_LENGTH = 5000
const MAX_IMAGE_URL_LENGTH = 2000

function parseMaxAttempts(value: unknown) {
  if (value == null || value === '' || value === 'unlimited') return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(100, Math.max(1, Math.floor(value)))
}

function clampAudience(audience: unknown) {
  const v = typeof audience === 'string' ? audience.trim().toLowerCase() : ''
  if (v === 'public' || v === 'grade' || v === 'private') return v
  return 'public'
}

function isMissingSocialPostsTableError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err || '')
  return /socialpost/i.test(message) && /(does not exist|not exist|no such table|relation)/i.test(message)
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requesterId = await getUserIdFromReq(req)
  if (!requesterId) return res.status(401).json({ message: 'Unauthorized' })

  const id = String(req.query.id || '')
  if (!id) return res.status(400).json({ message: 'Missing post id' })

  if (req.method !== 'GET' && req.method !== 'PATCH' && req.method !== 'DELETE') {
    res.setHeader('Allow', ['GET', 'PATCH', 'DELETE'])
    return res.status(405).end()
  }

  const role = (await getUserRole(req)) || 'student'
  const isPrivileged = role === 'admin' || role === 'teacher'
  const socialPost = (prisma as any).socialPost as typeof prisma extends { socialPost: infer T } ? T : any

  let post: any = null
  try {
    post = await socialPost.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        prompt: true,
        imageUrl: true,
        grade: true,
        audience: true,
        attemptsOpen: true,
        solutionsVisible: true,
        maxAttempts: true,
        closedAt: true,
        revealedAt: true,
        createdAt: true,
        updatedAt: true,
        createdById: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            grade: true,
            avatar: true,
            statusBio: true,
            schoolName: true,
            profileVisibility: true,
          },
        },
      },
    })
  } catch (err) {
    if (isMissingSocialPostsTableError(err)) {
      return res.status(503).json({ message: 'Posts are unavailable until the SocialPost database migration is applied.' })
    }
    throw err
  }

  if (!post) return res.status(404).json({ message: 'Post not found' })

  const isOwner = requesterId === String(post.createdById)

  if (req.method === 'DELETE') {
    if (!isOwner && !isPrivileged) return res.status(403).json({ message: 'Forbidden' })
    try {
      const learnerResponse = (prisma as any).learnerResponse as typeof prisma extends { learnerResponse: infer T } ? T : any
      const threadKey = `post:${id}`
      await prisma.$transaction([
        learnerResponse.deleteMany({ where: { sessionKey: threadKey } }),
        socialPost.delete({ where: { id } }),
      ])
      return res.status(200).json({ ok: true })
    } catch (err: any) {
      if (isMissingSocialPostsTableError(err)) {
        return res.status(503).json({ message: 'Posts are unavailable until the SocialPost database migration is applied.' })
      }
      console.error('Failed to delete post', err)
      return res.status(500).json({ message: err?.message || 'Failed to delete post' })
    }
  }

  if (req.method === 'PATCH') {
    if (!isOwner && !isPrivileged) return res.status(403).json({ message: 'Forbidden' })

    const body = (req.body || {}) as any
    const updateData: any = {}
    const hasTitle = Object.prototype.hasOwnProperty.call(body, 'title')
    const hasPrompt = Object.prototype.hasOwnProperty.call(body, 'prompt')
    const hasImageUrl = Object.prototype.hasOwnProperty.call(body, 'imageUrl')
    const hasAudience = Object.prototype.hasOwnProperty.call(body, 'audience')
    const hasAttemptsOpen = Object.prototype.hasOwnProperty.call(body, 'attemptsOpen')
    const hasSolutionsVisible = Object.prototype.hasOwnProperty.call(body, 'solutionsVisible')
    const hasMaxAttempts = Object.prototype.hasOwnProperty.call(body, 'maxAttempts')

    if (hasTitle) updateData.title = (typeof body.title === 'string' ? body.title.trim() : '').slice(0, MAX_TITLE_LENGTH)

    let nextPrompt = post.prompt
    if (hasPrompt) nextPrompt = (typeof body.prompt === 'string' ? body.prompt.trim() : '').slice(0, MAX_PROMPT_LENGTH)

    let nextImageUrl: string | null = post.imageUrl ?? null
    if (hasImageUrl) {
      nextImageUrl = (typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '').slice(0, MAX_IMAGE_URL_LENGTH) || null
    }

    if (!nextPrompt && !nextImageUrl) {
      return res.status(400).json({ message: 'Either text or an image is required' })
    }

    if (hasPrompt) updateData.prompt = nextPrompt
    if (hasImageUrl) updateData.imageUrl = nextImageUrl

    if (hasAudience) {
      updateData.audience = clampAudience(body.audience)
      const tokenGrade = normalizeGradeInput(await getUserGrade(req))
      updateData.grade = updateData.audience === 'grade' ? tokenGrade : null
    }

    if (hasAttemptsOpen) {
      updateData.attemptsOpen = typeof body.attemptsOpen === 'boolean' ? body.attemptsOpen : post.attemptsOpen
      updateData.closedAt = updateData.attemptsOpen ? null : (post.closedAt ?? new Date())
    }

    if (hasSolutionsVisible) {
      updateData.solutionsVisible = typeof body.solutionsVisible === 'boolean' ? body.solutionsVisible : post.solutionsVisible
      updateData.revealedAt = updateData.solutionsVisible ? (post.revealedAt ?? new Date()) : null
    }

    if (hasMaxAttempts) {
      updateData.maxAttempts = parseMaxAttempts(body.maxAttempts)
    }

    try {
      const updated = await socialPost.update({ where: { id }, data: updateData })
      return res.status(200).json(updated)
    } catch (err: any) {
      if (isMissingSocialPostsTableError(err)) {
        return res.status(503).json({ message: 'Posts are unavailable until the SocialPost database migration is applied.' })
      }
      console.error('Failed to update post', err)
      return res.status(500).json({ message: err?.message || 'Failed to update post' })
    }
  }

  return res.status(200).json({
    ...post,
    kind: 'post',
    threadKey: `post:${post.id}`,
  })
}