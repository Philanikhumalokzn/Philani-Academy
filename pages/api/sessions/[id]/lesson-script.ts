import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../lib/prisma'
import { normalizeGradeInput } from '../../../../lib/grades'
import { getUserSubscriptionStatus, isSubscriptionGatingEnabled, subscriptionRequiredResponse } from '../../../../lib/subscription'

type LessonScriptSource = 'override' | 'template-version' | 'template-current' | 'none'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any).role as string | undefined
  const authUserId = ((token as any)?.id || (token as any)?.sub || '') as string
  const tokenGrade = normalizeGradeInput((token as any).grade as string | undefined)

  const sessionId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  const safeSessionId = String(sessionId || '').trim()
  if (!safeSessionId) return res.status(400).json({ message: 'Missing session id' })

  const session = await prisma.sessionRecord.findUnique({
    where: { id: safeSessionId },
    include: {
      lessonScript: {
        include: {
          template: { include: { currentVersion: true } },
          templateVersion: true,
        },
      },
    },
  })

  if (!session) return res.status(404).json({ message: 'Session not found' })

  // Authorization: students/teachers are constrained to their grade.
  if (role === 'teacher' || role === 'student') {
    if (!tokenGrade) return res.status(403).json({ message: 'Grade not configured' })
    if (session.grade !== tokenGrade) return res.status(403).json({ message: 'Forbidden for this grade' })
  }

  if (role === 'student') {
    const gatingEnabled = await isSubscriptionGatingEnabled()
    if (gatingEnabled) {
      const status = await getUserSubscriptionStatus(authUserId)
      if (!status.active) {
        const denied = subscriptionRequiredResponse()
        return res.status(denied.status).json(denied.body)
      }
    }
  }

  if (req.method === 'GET') {
    const assignment = session.lessonScript

    let resolved: any | null = null
    let source: LessonScriptSource = 'none'

    if (assignment?.overrideContent) {
      resolved = assignment.overrideContent
      source = 'override'
    } else if (assignment?.templateVersion?.content) {
      resolved = assignment.templateVersion.content
      source = 'template-version'
    } else if (assignment?.template?.currentVersion?.content) {
      resolved = assignment.template.currentVersion.content
      source = 'template-current'
    }

    return res.status(200).json({
      resolved,
      assignment: assignment
        ? {
            id: assignment.id,
            sessionId: assignment.sessionId,
            templateId: assignment.templateId,
            templateVersionId: assignment.templateVersionId,
            overrideContent: assignment.overrideContent,
            updatedAt: assignment.updatedAt,
          }
        : null,
      source,
    })
  }

  if (req.method === 'PUT') {
    if (!role || (role !== 'admin' && role !== 'teacher')) return res.status(403).json({ message: 'Forbidden' })

    const templateIdRaw = req.body?.templateId
    const templateVersionIdRaw = req.body?.templateVersionId
    const overrideContent = req.body?.overrideContent

    const templateId = templateIdRaw ? String(templateIdRaw).trim() : null
    const templateVersionId = templateVersionIdRaw ? String(templateVersionIdRaw).trim() : null

    if (overrideContent !== undefined && overrideContent !== null) {
      if (typeof overrideContent !== 'object' || Array.isArray(overrideContent)) {
        return res.status(400).json({ message: 'overrideContent must be a JSON object' })
      }
    }

    // Basic referential validation if ids are provided.
    if (templateVersionId) {
      const version = await prisma.lessonScriptVersion.findUnique({ where: { id: templateVersionId } })
      if (!version) return res.status(400).json({ message: 'Invalid templateVersionId' })
      if (templateId && version.templateId !== templateId) {
        return res.status(400).json({ message: 'templateVersionId does not belong to templateId' })
      }
    }
    if (templateId) {
      const template = await prisma.lessonScriptTemplate.findUnique({ where: { id: templateId } })
      if (!template) return res.status(400).json({ message: 'Invalid templateId' })
    }

    const updated = await prisma.sessionLessonScript.upsert({
      where: { sessionId: safeSessionId },
      create: {
        sessionId: safeSessionId,
        templateId,
        templateVersionId,
        overrideContent: overrideContent === undefined ? null : overrideContent,
        createdBy: (token as any)?.email || null,
        updatedBy: (token as any)?.email || null,
      },
      update: {
        templateId,
        templateVersionId,
        overrideContent: overrideContent === undefined ? undefined : overrideContent,
        updatedBy: (token as any)?.email || null,
      },
    })

    return res.status(200).json({ assignment: updated })
  }

  return res.status(405).end()
}
