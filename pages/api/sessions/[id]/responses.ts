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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sessionKeyParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  if (!sessionKeyParam) {
    return res.status(400).json({ message: 'Session id is required' })
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const sessionKey = sessionKeyParam.toString()
  const userId = ((token as any)?.id || (token as any)?.sub || '')?.toString()
  const userEmail = ((token as any)?.email || null) as string | null
  const role = (token as any)?.role as string | undefined
  const isAdmin = role === 'admin'

  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  // Learner-created challenges: allow viewing/editing, but enforce owner-controlled submission state.
  // Session key format is "challenge:<challengeId>".
  const isChallengeSession = sessionKey.startsWith('challenge:')
  const challengeId = isChallengeSession ? sessionKey.slice('challenge:'.length).trim() : ''
  let challengeOwnerId: string | null = null
  let challengeMaxAttempts: number | null = null
  let challengeTitle: string | null = null
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
    // Learners only fetch their own responses.
    if (isChallengeSession && challengeId) {
      try {
        const userChallenge = (prisma as any).userChallenge as typeof prisma extends { userChallenge: infer T } ? T : any
        const challenge = await userChallenge.findUnique({
          where: { id: challengeId },
          select: { maxAttempts: true },
        })
        const maxAttempts = typeof challenge?.maxAttempts === 'number' ? challenge.maxAttempts : null
        if (maxAttempts === null) {
          const latest = await learnerResponse.findFirst({
            where: { sessionKey, userId },
            orderBy: { updatedAt: 'desc' },
          })
          return res.status(200).json({ responses: latest ? [latest] : [] })
        }
      } catch {
        // Fall back to standard listing if challenge lookup fails.
      }
    }

    const records = await learnerResponse.findMany({
      where: { sessionKey, userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    return res.status(200).json({ responses: records })
  }

  // PATCH: Challenge owner can update gradingJson and feedback for a learner's response
  if (req.method === 'PATCH' && isChallengeSession) {
    // Only the challenge owner can grade
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
    const { responseId, gradingJson, feedback } = req.body || {}
    if (!responseId) return res.status(400).json({ message: 'Missing responseId' })
    try {
      const updated = await learnerResponse.update({
        where: { id: responseId },
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

  if (req.method === 'POST') {
    const { latex, studentText, quizId, prompt, quizLabel, quizPhaseKey, quizPointId, quizPointIndex } = req.body || {}
    if (!latex || typeof latex !== 'string') {
      return res.status(400).json({ message: 'Latex is required' })
    }
    if (latex.length > MAX_LATEX_LENGTH) {
      return res.status(400).json({ message: 'Latex is too large' })
    }

    const safeStudentText = (typeof studentText === 'string' && studentText.trim().length > 0)
      ? studentText.trim().slice(0, MAX_STUDENT_TEXT_LENGTH)
      : null

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

    let shouldNotifyOwner = false
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

    const notifyOwner = async (responseId: string) => {
      if (!shouldNotifyOwner || !challengeOwnerId || challengeOwnerId === userId) return
      try {
        await prisma.notification.create({
          data: {
            userId: challengeOwnerId,
            type: 'challenge_response',
            title: 'New response',
            body: `Someone attempted${challengeTitle ? ` ${challengeTitle}` : ' your challenge'}`,
            data: { responseId, challengeId, responderId: userId },
          },
        })
      } catch (notifyErr) {
        if (process.env.DEBUG === '1') console.error('Failed to create challenge response notification', notifyErr)
      }
    }

    const createRecord = async (quizIdToUse: string) => {
      return await learnerResponse.create({
        data: {
          sessionKey,
          userId,
          ownerId: challengeOwnerId,
          userEmail,
          quizId: quizIdToUse,
          prompt: safePrompt,
          quizLabel: safeQuizLabel,
          quizPhaseKey: safeQuizPhaseKey,
          quizPointId: safeQuizPointId,
          quizPointIndex: safeQuizPointIndex,
          latex,
          studentText: safeStudentText,
        },
      })
    }

    try {
      // Unlimited attempts: overwrite the latest response instead of appending.
      if (isChallengeSession && challengeMaxAttempts === null) {
        const existing = await learnerResponse.findFirst({
          where: { sessionKey, userId },
          orderBy: { updatedAt: 'desc' },
        })
        if (existing?.id) {
          const updated = await learnerResponse.update({
            where: { id: existing.id },
            data: {
              latex,
              studentText: safeStudentText,
              userEmail,
              quizId: safeQuizId,
              prompt: safePrompt,
              quizLabel: safeQuizLabel,
              quizPhaseKey: safeQuizPhaseKey,
              quizPointId: safeQuizPointId,
              quizPointIndex: safeQuizPointIndex,
              ownerId: challengeOwnerId,
              gradingJson: null,
              feedback: null,
              createdAt: new Date(),
            },
          })
          await learnerResponse.deleteMany({
            where: { sessionKey, userId, id: { not: existing.id } },
          }).catch(() => null)
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

      // Backwards-compat: if DB still has UNIQUE(sessionKey,userId,quizId), create a distinct quizId per attempt.
      const isTripletUnique = code === 'P2002' && /sessionKey/i.test(targetStr) && /userId/i.test(targetStr) && /quizId/i.test(targetStr)
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
      const isLegacyUnique = code === 'P2002' && /sessionKey/i.test(targetStr) && /userId/i.test(targetStr) && !/quizId/i.test(targetStr)
      if (isLegacyUnique) {
        try {
          const existing = await learnerResponse.findFirst({
            where: { sessionKey, userId },
            orderBy: { updatedAt: 'desc' },
          })
          if (existing?.id) {
            const updated = await learnerResponse.update({
              where: { id: existing.id },
              data: {
                latex,
                studentText: safeStudentText,
                userEmail,
                quizId: safeQuizId,
                prompt: safePrompt,
                quizLabel: safeQuizLabel,
                quizPhaseKey: safeQuizPhaseKey,
                quizPointId: safeQuizPointId,
                quizPointIndex: safeQuizPointIndex,
                ownerId: challengeOwnerId,
              },
            })
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

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end(`Method ${req.method} Not Allowed`)
}
