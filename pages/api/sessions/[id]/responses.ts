import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../lib/prisma'
import { getUserSubscriptionStatus, isSubscriptionGatingEnabled, subscriptionRequiredResponse } from '../../../../lib/subscription'

const MAX_LATEX_LENGTH = 50000
const MAX_STUDENT_TEXT_LENGTH = 5000
const MAX_PROMPT_LENGTH = 5000
const MAX_QUIZ_ID_LENGTH = 80
const MAX_QUIZ_LABEL_LENGTH = 40
const MAX_PHASE_KEY_LENGTH = 20
const MAX_POINT_ID_LENGTH = 80
const MAX_EXCALIDRAW_SCENE_LENGTH = 2_000_000
const MAX_REPLY_IMAGE_URL_LENGTH = 4000
const MAX_REPLY_BLOCKS = 32
const MAX_REPLY_REF_ID_LENGTH = 120
const MAX_REPLY_USER_ID_LENGTH = 120
const MAX_REPLY_USER_NAME_LENGTH = 160
const POST_REPLY_BLOCKS_KIND = 'post-reply-blocks-v1'
const LEGACY_LEARNER_RESPONSE_SESSION_USER_INDEX = 'LearnerResponse_sessionKey_userId_key'

let learnerResponseHistorySchemaRepairPromise: Promise<void> | null = null

const PERSISTED_PUBLIC_SOLVE_APP_STATE_KEYS = [
  'scrollX',
  'scrollY',
  'zoom',
  'viewBackgroundColor',
  'currentItemStrokeColor',
  'currentItemBackgroundColor',
  'currentItemStrokeWidth',
  'currentItemStrokeStyle',
  'currentItemFillStyle',
  'currentItemRoughness',
  'currentItemOpacity',
  'currentItemRoundness',
  'currentItemFontFamily',
  'currentItemFontSize',
  'currentItemTextAlign',
  'currentItemStartArrowhead',
  'currentItemEndArrowhead',
  'activeTool',
] as const

const cloneJsonValue = <T,>(value: T): T => {
  try {
    if (typeof structuredClone === 'function') return structuredClone(value)
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}

const sanitizeExcalidrawScene = (value: any) => {
  if (!value || typeof value !== 'object') return null

  const elements = Array.isArray(value.elements) ? cloneJsonValue(value.elements) : []
  const files = value.files && typeof value.files === 'object' ? cloneJsonValue(value.files) : undefined
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : null
  const appState = value.appState && typeof value.appState === 'object'
    ? Object.fromEntries(
        PERSISTED_PUBLIC_SOLVE_APP_STATE_KEYS
          .filter((key) => typeof value.appState[key] !== 'undefined')
          .map((key) => [key, cloneJsonValue(value.appState[key])])
      )
    : undefined
  const sceneMeta = value.sceneMeta && typeof value.sceneMeta === 'object'
    ? cloneJsonValue(value.sceneMeta)
    : undefined

  return {
    elements,
    appState: appState && Object.keys(appState).length ? appState : undefined,
    files,
    updatedAt,
    sceneMeta,
  }
}

const sanitizePostReplyContentBlocks = (value: any) => {
  if (!Array.isArray(value)) return []

  const output: any[] = []
  for (const rawBlock of value.slice(0, MAX_REPLY_BLOCKS)) {
    const type = String(rawBlock?.type || '').trim().toLowerCase()
    const id = String(rawBlock?.id || '').trim().slice(0, 80) || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

    if (type === 'text') {
      const text = typeof rawBlock?.text === 'string' ? rawBlock.text.trim().slice(0, MAX_STUDENT_TEXT_LENGTH) : ''
      if (text) output.push({ id, type: 'text', text })
      continue
    }

    if (type === 'latex') {
      const latex = typeof rawBlock?.latex === 'string' ? rawBlock.latex.trim().slice(0, MAX_LATEX_LENGTH) : ''
      if (latex) output.push({ id, type: 'latex', latex })
      continue
    }

    if (type === 'canvas') {
      const scene = sanitizeExcalidrawScene(rawBlock?.scene)
      if (!scene) continue
      const sceneJson = JSON.stringify(scene)
      if (sceneJson.length > MAX_EXCALIDRAW_SCENE_LENGTH) continue
      output.push({ id, type: 'canvas', scene: JSON.parse(sceneJson) })
      continue
    }

    if (type === 'image') {
      const imageUrl = typeof rawBlock?.imageUrl === 'string' ? rawBlock.imageUrl.trim().slice(0, MAX_REPLY_IMAGE_URL_LENGTH) : ''
      if (imageUrl) output.push({ id, type: 'image', imageUrl })
    }
  }

  return output
}

const repairLegacyLearnerResponseHistorySchema = async () => {
  const rows = await prisma.$queryRawUnsafe<Array<{ indexname?: string }>>(
    "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'LearnerResponse' AND indexname = $1",
    LEGACY_LEARNER_RESPONSE_SESSION_USER_INDEX,
  )

  if (!Array.isArray(rows) || rows.length === 0) return

  await prisma.$executeRawUnsafe(
    `ALTER TABLE "LearnerResponse" DROP CONSTRAINT IF EXISTS "${LEGACY_LEARNER_RESPONSE_SESSION_USER_INDEX}"`,
  )
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${LEGACY_LEARNER_RESPONSE_SESSION_USER_INDEX}"`)
}

const ensureLearnerResponseHistorySchema = async () => {
  if (!learnerResponseHistorySchemaRepairPromise) {
    learnerResponseHistorySchemaRepairPromise = repairLegacyLearnerResponseHistorySchema().catch((error) => {
      learnerResponseHistorySchemaRepairPromise = null
      throw error
    })
  }

  await learnerResponseHistorySchemaRepairPromise
}

const buildLegacyPostReplyBlocks = ({ studentText, latex, excalidrawScene }: { studentText: string | null; latex: string; excalidrawScene: Record<string, any> | null }) => {
  const blocks: any[] = []
  if (studentText) blocks.push({ id: `${Date.now().toString(36)}-text`, type: 'text', text: studentText })
  if (latex.trim()) blocks.push({ id: `${Date.now().toString(36)}-latex`, type: 'latex', latex: latex.trim() })
  if (excalidrawScene) blocks.push({ id: `${Date.now().toString(36)}-canvas`, type: 'canvas', scene: excalidrawScene })
  return blocks
}

const sanitizePostReplyThreadMeta = (value: any) => {
  const parentResponseId = typeof value?.parentResponseId === 'string' ? value.parentResponseId.trim().slice(0, MAX_REPLY_REF_ID_LENGTH) : ''
  const rootResponseIdRaw = typeof value?.rootResponseId === 'string' ? value.rootResponseId.trim().slice(0, MAX_REPLY_REF_ID_LENGTH) : ''
  const replyToUserId = typeof value?.replyToUserId === 'string' ? value.replyToUserId.trim().slice(0, MAX_REPLY_USER_ID_LENGTH) : ''
  const replyToUserName = typeof value?.replyToUserName === 'string' ? value.replyToUserName.trim().slice(0, MAX_REPLY_USER_NAME_LENGTH) : ''

  const rootResponseId = rootResponseIdRaw || parentResponseId
  if (!parentResponseId && !rootResponseId && !replyToUserId && !replyToUserName) return null

  return {
    ...(parentResponseId ? { parentResponseId } : {}),
    ...(rootResponseId ? { rootResponseId } : {}),
    ...(replyToUserId ? { replyToUserId } : {}),
    ...(replyToUserName ? { replyToUserName } : {}),
  }
}

const buildPostReplyPayload = ({ studentText, latex, excalidrawScene, contentBlocks, threadMeta }: { studentText: string | null; latex: string; excalidrawScene: Record<string, any> | null; contentBlocks: any; threadMeta?: any }) => {
  const safeBlocks = sanitizePostReplyContentBlocks(contentBlocks)
  const safeThreadMeta = sanitizePostReplyThreadMeta(threadMeta)
  const normalizedBlocks = safeBlocks.length > 0
    ? safeBlocks
    : buildLegacyPostReplyBlocks({ studentText, latex, excalidrawScene })
  const textSummary = normalizedBlocks
    .filter((block) => block?.type === 'text' && typeof block?.text === 'string')
    .map((block) => String(block.text))
    .join('\n')
    .trim() || null
  const latexSummary = normalizedBlocks
    .filter((block) => block?.type === 'latex' && typeof block?.latex === 'string')
    .map((block) => String(block.latex))
    .join('\n\n')
    .trim()
  const canvasBlock = normalizedBlocks.find((block) => block?.type === 'canvas' && block?.scene)

  return {
    contentBlocks: normalizedBlocks,
    studentText: textSummary,
    latex: latexSummary,
    excalidrawScene: canvasBlock?.scene || null,
    gradingJson: normalizedBlocks.length > 0
      ? {
          kind: POST_REPLY_BLOCKS_KIND,
          contentBlocks: normalizedBlocks,
          ...(safeThreadMeta ? { replyThread: safeThreadMeta } : {}),
        }
      : null,
  }
}

const updatePostReplyPayloadCanvasScene = (gradingJson: any, scene: Record<string, any>) => {
  if (!gradingJson || gradingJson.kind !== POST_REPLY_BLOCKS_KIND || !Array.isArray(gradingJson.contentBlocks)) return null
  let replaced = false
  const contentBlocks = gradingJson.contentBlocks.map((block: any) => {
    if (!replaced && String(block?.type || '').trim().toLowerCase() === 'canvas') {
      replaced = true
      return { ...block, scene: cloneJsonValue(scene) }
    }
    return block
  })
  return replaced ? { ...gradingJson, contentBlocks } : null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sessionKeyParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  if (!sessionKeyParam) {
    return res.status(400).json({ message: 'Session id is required' })
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const sessionKey = sessionKeyParam.toString()
  const legacySessionKey = sessionKey.startsWith('lesson:') ? sessionKey.slice('lesson:'.length).trim() : ''
  const responseThreadKeys = Array.from(new Set([sessionKey, legacySessionKey].filter(Boolean)))
  const userId = ((token as any)?.id || (token as any)?.sub || '')?.toString()
  const userEmail = ((token as any)?.email || null) as string | null
  const role = (token as any)?.role as string | undefined
  const isAdmin = role === 'admin'

  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  // Learner-created challenges: allow viewing/editing, but enforce owner-controlled submission state.
  // Session key format is "challenge:<challengeId>".
  const isChallengeSession = sessionKey.startsWith('challenge:')
  const challengeId = isChallengeSession ? sessionKey.slice('challenge:'.length).trim() : ''
  const isPostSession = sessionKey.startsWith('post:')
  const postId = isPostSession ? sessionKey.slice('post:'.length).trim() : ''
  let challengeOwnerId: string | null = null
  let challengeMaxAttempts: number | null = null
  let challengeTitle: string | null = null
  let postOwnerId: string | null = null
  let postMaxAttempts: number | null = null
  let postTitle: string | null = null
  let postAttemptsOpen = true
  let postSolutionsVisible = false
  if (req.method === 'POST' && isChallengeSession) {
    if (!challengeId) return res.status(400).json({ message: 'Invalid challenge session id' })

    const userChallenge = (prisma as any).userChallenge as typeof prisma extends { userChallenge: infer T } ? T : any
    const challenge = await userChallenge.findUnique({
      where: { id: challengeId },
      select: { id: true, title: true, attemptsOpen: true, createdById: true, maxAttempts: true },
    })

    if (!challenge) return res.status(404).json({ message: 'Challenge not found' })
    if (!challenge.attemptsOpen) {
      return res.status(403).json({ message: 'Attempts are closed for this challenge' })
    }

    challengeOwnerId = (challenge?.createdById ? String(challenge.createdById) : null)
    challengeMaxAttempts = typeof challenge?.maxAttempts === 'number' ? challenge.maxAttempts : null
    challengeTitle = challenge?.title ? String(challenge.title) : null
  }

  if ((req.method === 'POST' || req.method === 'GET') && isPostSession && postId) {
    const socialPost = (prisma as any).socialPost as typeof prisma extends { socialPost: infer T } ? T : any
    const post = await socialPost.findUnique({
      where: { id: postId },
      select: {
        id: true,
        title: true,
        createdById: true,
        attemptsOpen: true,
        solutionsVisible: true,
        maxAttempts: true,
      },
    }).catch(() => null)

    if (post) {
      postOwnerId = post?.createdById ? String(post.createdById) : null
      postMaxAttempts = typeof post?.maxAttempts === 'number' ? post.maxAttempts : null
      postTitle = post?.title ? String(post.title) : null
      postAttemptsOpen = post?.attemptsOpen !== false
      postSolutionsVisible = post?.solutionsVisible === true
    }

    if (req.method === 'POST') {
      if (!post) return res.status(404).json({ message: 'Post not found' })
      if (!postAttemptsOpen) {
        return res.status(403).json({ message: 'Attempts are closed for this post' })
      }
    }
  }

  const isAttemptScopedPostSession = isPostSession && (
    postAttemptsOpen === false
    || postSolutionsVisible === true
    || postMaxAttempts !== null
  )

  // Subscription gating: learners must be subscribed to access session content.
  if (!isAdmin && role === 'student') {
    const gatingEnabled = await isSubscriptionGatingEnabled()
    if (gatingEnabled) {
      const status = await getUserSubscriptionStatus(userId)
      if (!status.active) {
        const denied = subscriptionRequiredResponse()
        return res.status(denied.status).json(denied.body)
      }
    }
  }

  // Some environments may have a stale/generated Prisma client type surface.
  // The schema contains `LearnerResponse`, but TS may not see `prisma.learnerResponse` yet.
  const learnerResponse = (prisma as any).learnerResponse as typeof prisma extends { learnerResponse: infer T } ? T : any


  if (req.method === 'GET') {
    if (isChallengeSession && challengeId) {
      try {
        const userChallenge = (prisma as any).userChallenge as typeof prisma extends { userChallenge: infer T } ? T : any
        const challenge = await userChallenge.findUnique({
          where: { id: challengeId },
          select: { createdById: true, maxAttempts: true, solutionsVisible: true },
        })
        const ownAttemptCount = await learnerResponse.count({
          where: { sessionKey: { in: responseThreadKeys }, userId },
        })
        const canViewSharedChallengeThread = Boolean(challenge?.createdById && String(challenge.createdById) === String(userId))
          || isAdmin
          || Boolean(challenge?.solutionsVisible)
          || ownAttemptCount > 0

        if (canViewSharedChallengeThread) {
          const records = await learnerResponse.findMany({
            where: { sessionKey: { in: responseThreadKeys } },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatar: true,
                },
              },
            },
            orderBy: { updatedAt: 'desc' },
            take: 200,
          })
          return res.status(200).json({
            responses: records.map((record: any) => ({
              ...record,
              userName: String(record?.user?.name || record?.user?.email || 'Learner'),
              userAvatar: record?.user?.avatar || null,
            })),
          })
        }

        const maxAttempts = typeof challenge?.maxAttempts === 'number' ? challenge.maxAttempts : null
        if (maxAttempts === null) {
          const latest = await learnerResponse.findFirst({
            where: { sessionKey: { in: responseThreadKeys }, userId },
            orderBy: { updatedAt: 'desc' },
          })
          return res.status(200).json({ responses: latest ? [latest] : [] })
        }
      } catch {
        // Fall back to standard listing if challenge lookup fails.
      }
    }

    if (isAttemptScopedPostSession && postId) {
      try {
        const ownAttemptCount = await learnerResponse.count({
          where: { sessionKey: { in: responseThreadKeys }, userId },
        })
        const canViewSharedPostThread = Boolean(postOwnerId && String(postOwnerId) === String(userId))
          || isAdmin
          || postSolutionsVisible
          || ownAttemptCount > 0

        if (canViewSharedPostThread) {
          const records = await learnerResponse.findMany({
            where: { sessionKey: { in: responseThreadKeys } },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatar: true,
                },
              },
            },
            orderBy: { updatedAt: 'desc' },
            take: 200,
          })
          return res.status(200).json({
            responses: records.map((record: any) => ({
              ...record,
              userName: String(record?.user?.name || record?.user?.email || 'Learner'),
              userAvatar: record?.user?.avatar || null,
            })),
          })
        }

        if (postMaxAttempts === null) {
          const latest = await learnerResponse.findFirst({
            where: { sessionKey: { in: responseThreadKeys }, userId },
            orderBy: { updatedAt: 'desc' },
          })
          return res.status(200).json({ responses: latest ? [latest] : [] })
        }
      } catch {
        // Fall back to standard listing if post lookup fails.
      }
    }

    if (!isChallengeSession && !isAttemptScopedPostSession) {
      const records = await learnerResponse.findMany({
        where: { sessionKey: { in: responseThreadKeys } },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      })
      return res.status(200).json({
        responses: records.map((record: any) => ({
          ...record,
          userName: String(record?.user?.name || record?.user?.email || 'Learner'),
          userAvatar: record?.user?.avatar || null,
        })),
      })
    }

    const records = await learnerResponse.findMany({
      where: { sessionKey: { in: responseThreadKeys }, userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    return res.status(200).json({ responses: records })
  }

  if (req.method === 'PATCH') {
    const { responseId, gradingJson, feedback, excalidrawScene, latex, studentText, contentBlocks, parentResponseId, rootResponseId, replyToUserId, replyToUserName } = req.body || {}
    if (!responseId) return res.status(400).json({ message: 'Missing responseId' })

    const existing = await learnerResponse.findUnique({
      where: { id: String(responseId) },
      select: {
        id: true,
        userId: true,
        sessionKey: true,
        latex: true,
        studentText: true,
        gradingJson: true,
      },
    })

    if (!existing) return res.status(404).json({ message: 'Response not found' })
    if (!responseThreadKeys.includes(String(existing.sessionKey || ''))) {
      return res.status(404).json({ message: 'Response not found in this thread' })
    }

    const isPostContentUpdate = isPostSession && (
      typeof contentBlocks !== 'undefined'
      || typeof latex === 'string'
      || typeof studentText === 'string'
      || typeof parentResponseId === 'string'
      || typeof rootResponseId === 'string'
      || typeof replyToUserId === 'string'
      || typeof replyToUserName === 'string'
    )

    if (isPostContentUpdate) {
      if (String(existing.userId || '') !== String(userId)) {
        return res.status(403).json({ message: 'Only the response owner can edit this reply' })
      }

      let safeExcalidrawScene: Record<string, any> | null = null
      if (excalidrawScene && typeof excalidrawScene === 'object') {
        try {
          const sanitizedScene = sanitizeExcalidrawScene(excalidrawScene)
          const sceneJson = JSON.stringify(sanitizedScene)
          if (sceneJson.length > MAX_EXCALIDRAW_SCENE_LENGTH) {
            return res.status(400).json({ message: 'Canvas response is too large' })
          }
          safeExcalidrawScene = JSON.parse(sceneJson)
        } catch {
          return res.status(400).json({ message: 'Canvas response is invalid' })
        }
      }

      const safeLatex = typeof latex === 'string' ? latex : String(existing?.latex || '')
      if (safeLatex.length > MAX_LATEX_LENGTH) {
        return res.status(400).json({ message: 'Latex is too large' })
      }

      const safeStudentText = typeof studentText === 'string'
        ? (studentText.trim().length > 0 ? studentText.trim().slice(0, MAX_STUDENT_TEXT_LENGTH) : null)
        : (typeof existing?.studentText === 'string' ? existing.studentText : null)

      const postReplyPayload = buildPostReplyPayload({
        studentText: safeStudentText,
        latex: safeLatex,
        excalidrawScene: safeExcalidrawScene,
        contentBlocks,
        threadMeta: {
          parentResponseId,
          rootResponseId,
          replyToUserId,
          replyToUserName,
        },
      })

      if (!postReplyPayload.contentBlocks.length) {
        return res.status(400).json({ message: 'Write a reply, add math, or attach a canvas response' })
      }

      const updated = await learnerResponse.update({
        where: { id: String(responseId) },
        data: {
          latex: postReplyPayload.latex,
          studentText: postReplyPayload.studentText,
          excalidrawScene: postReplyPayload.excalidrawScene,
          gradingJson: postReplyPayload.gradingJson,
        },
      })

      return res.status(200).json(updated)
    }

    if (typeof excalidrawScene !== 'undefined') {
      if (String(existing.userId) !== String(userId)) {
        return res.status(403).json({ message: 'Only the response owner can update the saved view' })
      }
      if (!excalidrawScene || typeof excalidrawScene !== 'object') {
        return res.status(400).json({ message: 'Canvas response is invalid' })
      }

      try {
        const sanitizedScene = sanitizeExcalidrawScene(excalidrawScene)
        const sceneJson = JSON.stringify(sanitizedScene)
        if (sceneJson.length > MAX_EXCALIDRAW_SCENE_LENGTH) {
          return res.status(400).json({ message: 'Canvas response is too large' })
        }

        const updated = await learnerResponse.update({
          where: { id: String(responseId) },
          data: {
            excalidrawScene: JSON.parse(sceneJson),
            ...(isPostSession ? {
              gradingJson: updatePostReplyPayloadCanvasScene(existing.gradingJson, JSON.parse(sceneJson)) ?? undefined,
            } : {}),
          },
        })

        return res.status(200).json(updated)
      } catch {
        return res.status(400).json({ message: 'Canvas response is invalid' })
      }
    }

    if (!isChallengeSession) {
      return res.status(400).json({ message: 'No supported fields to update' })
    }

    if (!challengeId) return res.status(400).json({ message: 'Invalid challenge session id' })
    const userChallenge = (prisma as any).userChallenge as typeof prisma extends { userChallenge: infer T } ? T : any
    const challenge = await userChallenge.findUnique({
      where: { id: challengeId },
      select: { id: true, title: true, createdById: true },
    })
    if (!challenge) return res.status(404).json({ message: 'Challenge not found' })
    if (String(challenge.createdById) !== String(userId)) {
      return res.status(403).json({ message: 'Only the challenge creator can grade responses' })
    }

    try {
      const updated = await learnerResponse.update({
        where: { id: String(responseId) },
        data: {
          gradingJson: gradingJson ?? undefined,
          feedback: typeof feedback === 'string' ? feedback : undefined,
        },
      })

      try {
        const gradedUserId = updated?.userId ? String(updated.userId) : ''
        if (gradedUserId && gradedUserId !== userId) {
          await prisma.notification.create({
            data: {
              userId: gradedUserId,
              type: 'challenge_graded',
              title: 'Challenge graded',
              body: `Your response was graded${challenge?.title ? ` for ${challenge.title}` : ''}`,
              data: { responseId: updated.id, challengeId, gradedById: userId },
            },
          })
        }
      } catch (notifyErr) {
        if (process.env.DEBUG === '1') console.error('Failed to create challenge grade notification', notifyErr)
      }

      return res.status(200).json(updated)
    } catch (err: any) {
      return res.status(500).json({ message: err?.message || 'Failed to update grading' })
    }
  }

  if (req.method === 'DELETE') {
    const { responseId } = req.body || {}
    if (!responseId) return res.status(400).json({ message: 'Missing responseId' })

    const existing = await learnerResponse.findUnique({
      where: { id: String(responseId) },
      select: {
        id: true,
        userId: true,
        sessionKey: true,
      },
    })

    if (!existing) return res.status(404).json({ message: 'Response not found' })
    if (!responseThreadKeys.includes(String(existing.sessionKey || ''))) {
      return res.status(404).json({ message: 'Response not found in this thread' })
    }
    if (!isAdmin && String(existing.userId || '') !== String(userId)) {
      return res.status(403).json({ message: 'Only the response owner can delete this reply' })
    }

    await learnerResponse.delete({ where: { id: String(responseId) } })
    return res.status(200).json({ ok: true })
  }

  if (req.method === 'POST') {
    const { latex, studentText, quizId, prompt, quizLabel, quizPhaseKey, quizPointId, quizPointIndex, excalidrawScene, contentBlocks, parentResponseId, rootResponseId, replyToUserId, replyToUserName } = req.body || {}
    const safeLatex = typeof latex === 'string' ? latex : ''
    if (safeLatex.length > MAX_LATEX_LENGTH) {
      return res.status(400).json({ message: 'Latex is too large' })
    }

    let safeExcalidrawScene: Record<string, any> | null = null
    if (excalidrawScene && typeof excalidrawScene === 'object') {
      try {
        const sanitizedScene = sanitizeExcalidrawScene(excalidrawScene)
        const sceneJson = JSON.stringify(sanitizedScene)
        if (sceneJson.length > MAX_EXCALIDRAW_SCENE_LENGTH) {
          return res.status(400).json({ message: 'Canvas response is too large' })
        }
        safeExcalidrawScene = JSON.parse(sceneJson)
      } catch {
        return res.status(400).json({ message: 'Canvas response is invalid' })
      }
    }

    const safeStudentText = (typeof studentText === 'string' && studentText.trim().length > 0)
      ? studentText.trim().slice(0, MAX_STUDENT_TEXT_LENGTH)
      : null

    const postReplyPayload = isPostSession
      ? buildPostReplyPayload({
          studentText: safeStudentText,
          latex: safeLatex,
          excalidrawScene: safeExcalidrawScene,
          contentBlocks,
          threadMeta: {
            parentResponseId,
            rootResponseId,
            replyToUserId,
            replyToUserName,
          },
        })
      : null

    const effectiveStudentText = postReplyPayload ? postReplyPayload.studentText : safeStudentText
    const effectiveLatex = postReplyPayload ? postReplyPayload.latex : safeLatex
    const effectiveExcalidrawScene = postReplyPayload ? postReplyPayload.excalidrawScene : safeExcalidrawScene

    if (!effectiveLatex.trim() && !effectiveExcalidrawScene && !effectiveStudentText) {
      return res.status(400).json({ message: 'Write a reply, add math, or attach a canvas response' })
    }

    const safeQuizId = (typeof quizId === 'string' && quizId.trim().length > 0)
      ? quizId.trim().slice(0, MAX_QUIZ_ID_LENGTH)
      : 'default'
    const safePrompt = (typeof prompt === 'string' && prompt.trim().length > 0)
      ? prompt.trim().slice(0, MAX_PROMPT_LENGTH)
      : null

    const safeQuizLabel = (typeof quizLabel === 'string' && quizLabel.trim().length > 0)
      ? quizLabel.trim().slice(0, MAX_QUIZ_LABEL_LENGTH)
      : null

    const safeQuizPhaseKey = (typeof quizPhaseKey === 'string' && quizPhaseKey.trim().length > 0)
      ? quizPhaseKey.trim().slice(0, MAX_PHASE_KEY_LENGTH)
      : null

    const safeQuizPointId = (typeof quizPointId === 'string' && quizPointId.trim().length > 0)
      ? quizPointId.trim().slice(0, MAX_POINT_ID_LENGTH)
      : null

    const safeQuizPointIndex = (typeof quizPointIndex === 'number' && Number.isFinite(quizPointIndex))
      ? Math.max(0, Math.min(9999, Math.trunc(quizPointIndex)))
      : null

    if (isPostSession) {
      try {
        await ensureLearnerResponseHistorySchema()
      } catch (repairErr) {
        console.error('Failed to repair legacy learner response history schema', repairErr)
      }
    }

    let shouldNotifyOwner = false
    const responseOwnerId = isChallengeSession ? challengeOwnerId : (isAttemptScopedPostSession ? postOwnerId : null)
    if (isChallengeSession && challengeId) {
      if (!challengeOwnerId || challengeTitle == null) {
        const userChallenge = (prisma as any).userChallenge as typeof prisma extends { userChallenge: infer T } ? T : any
        const challenge = await userChallenge.findUnique({
          where: { id: challengeId },
          select: { id: true, title: true, createdById: true, maxAttempts: true },
        })
        if (challenge?.createdById) challengeOwnerId = String(challenge.createdById)
        if (challengeTitle == null) challengeTitle = challenge?.title ? String(challenge.title) : null
        if (challengeMaxAttempts == null && typeof challenge?.maxAttempts === 'number') {
          challengeMaxAttempts = challenge.maxAttempts
        }
      }
      if (challengeOwnerId && challengeOwnerId !== userId) {
        shouldNotifyOwner = true
      }
    }

    if (isAttemptScopedPostSession && postOwnerId && postOwnerId !== userId) {
      shouldNotifyOwner = true
    }

    const notifyOwner = async (responseId: string) => {
      const targetOwnerId = isChallengeSession ? challengeOwnerId : responseOwnerId
      if (!shouldNotifyOwner || !targetOwnerId || targetOwnerId === userId) return
      try {
        await prisma.notification.create({
          data: {
            userId: targetOwnerId,
            type: isChallengeSession ? 'challenge_response' : 'post_response',
            title: 'New response',
            body: isChallengeSession
              ? `Attempted${challengeTitle ? ` ${challengeTitle}` : ' your challenge'}`
              : `Responded${postTitle ? ` to ${postTitle}` : ' to your post'}`,
            data: isChallengeSession
              ? { responseId, challengeId, responderId: userId }
              : { responseId, postId, responderId: userId },
          },
        })
      } catch (notifyErr) {
        if (process.env.DEBUG === '1') console.error('Failed to create response notification', notifyErr)
      }
    }

    const createRecord = async (quizIdToUse: string) => {
      return await learnerResponse.create({
        data: {
          sessionKey,
          userId,
          ownerId: responseOwnerId,
          userEmail,
          quizId: quizIdToUse,
          prompt: safePrompt,
          quizLabel: safeQuizLabel,
          quizPhaseKey: safeQuizPhaseKey,
          quizPointId: safeQuizPointId,
          quizPointIndex: safeQuizPointIndex,
          latex: effectiveLatex,
          studentText: effectiveStudentText,
          excalidrawScene: effectiveExcalidrawScene,
          ...(isPostSession ? { gradingJson: postReplyPayload?.gradingJson ?? null } : {}),
        },
      })
    }

    const updateLatestRecord = async (opts?: { resetChallengeFeedback?: boolean; bumpCreatedAt?: boolean }) => {
      const existing = await learnerResponse.findFirst({
        where: { sessionKey: { in: responseThreadKeys }, userId },
        orderBy: { updatedAt: 'desc' },
      })
      if (!existing?.id) return null

      const updated = await learnerResponse.update({
        where: { id: existing.id },
        data: {
          latex: effectiveLatex,
          studentText: effectiveStudentText,
          excalidrawScene: effectiveExcalidrawScene,
          userEmail,
          quizId: safeQuizId,
          prompt: safePrompt,
          quizLabel: safeQuizLabel,
          quizPhaseKey: safeQuizPhaseKey,
          quizPointId: safeQuizPointId,
          quizPointIndex: safeQuizPointIndex,
          ownerId: responseOwnerId,
          ...(isPostSession ? { gradingJson: postReplyPayload?.gradingJson ?? null } : {}),
          ...(opts?.resetChallengeFeedback ? { gradingJson: null, feedback: null } : {}),
          ...(opts?.bumpCreatedAt ? { createdAt: new Date() } : {}),
        },
      })

      if (opts?.resetChallengeFeedback) {
        await learnerResponse.deleteMany({
          where: { sessionKey: { in: responseThreadKeys }, userId, id: { not: existing.id } },
        }).catch(() => null)
      }

      return updated
    }

    try {
      if (!isChallengeSession && !isAttemptScopedPostSession && !isPostSession) {
        const updated = await updateLatestRecord()
        if (updated) {
          return res.status(200).json(updated)
        }
      }

      // Unlimited attempts: overwrite the latest response instead of appending.
      if (isChallengeSession && challengeMaxAttempts === null) {
        const updated = await updateLatestRecord({ resetChallengeFeedback: true, bumpCreatedAt: true })
        if (updated) {
          await notifyOwner(updated?.id || '')
          return res.status(200).json(updated)
        }
      }

      const record = await createRecord(safeQuizId)
      await notifyOwner(record?.id || '')
      return res.status(200).json(record)
    } catch (err: any) {
      const code = err?.code || err?.name
      const target = err?.meta?.target
      const targetStr = Array.isArray(target) ? target.join(',') : String(target || '')
      const errMessage = String(err?.message || '')
      const uniqueSessionUserMentioned = /sessionkey/i.test(`${targetStr} ${errMessage}`) && /userid/i.test(`${targetStr} ${errMessage}`)

      // Backwards-compat: if DB still has UNIQUE(sessionKey,userId,quizId), create a distinct quizId per attempt.
      const isTripletUnique = code === 'P2002' && /sessionkey/i.test(`${targetStr} ${errMessage}`) && /userid/i.test(`${targetStr} ${errMessage}`) && /quizid/i.test(`${targetStr} ${errMessage}`)
      if (isTripletUnique) {
        try {
          const attemptId = `${safeQuizId}-${Date.now().toString(36)}`
          const record = await createRecord(attemptId)
          await notifyOwner(record?.id || '')
          return res.status(200).json(record)
        } catch (retryErr) {
          console.error('Retry response save failed', retryErr)
        }
      }

      // Backwards-compat: legacy UNIQUE(sessionKey,userId) means history is impossible without migration.
      // Update the existing record so learners aren't blocked.
      const isLegacyUnique = code === 'P2002' && uniqueSessionUserMentioned && !/quizid/i.test(`${targetStr} ${errMessage}`)
      if (isLegacyUnique && isPostSession) {
        try {
          learnerResponseHistorySchemaRepairPromise = null
          await ensureLearnerResponseHistorySchema()
          const record = await createRecord(safeQuizId)
          await notifyOwner(record?.id || '')
          return res.status(200).json(record)
        } catch (repairErr) {
          console.error('Failed to recover post reply history after removing legacy unique index', repairErr)
        }
      }

      if (isLegacyUnique) {
        try {
          const updated = await updateLatestRecord({
            resetChallengeFeedback: isChallengeSession && challengeMaxAttempts === null,
            bumpCreatedAt: (isChallengeSession && challengeMaxAttempts === null) || (isAttemptScopedPostSession && postMaxAttempts === null),
          })
          if (updated) {
            await notifyOwner(updated?.id || '')
            return res.status(200).json(updated)
          }
        } catch (fallbackErr) {
          console.error('Fallback response save failed', fallbackErr)
        }
      }

      console.error('Failed to save response', err)
      return res.status(500).json({ message: err?.message || 'Failed to save response' })
    }
  }

  res.setHeader('Allow', ['GET', 'POST', 'PATCH', 'DELETE'])
  return res.status(405).end(`Method ${req.method} Not Allowed`)
}
