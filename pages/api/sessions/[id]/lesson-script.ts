import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../lib/prisma'
import { normalizeGradeInput } from '../../../../lib/grades'
import { getUserSubscriptionStatus, isSubscriptionGatingEnabled, subscriptionRequiredResponse } from '../../../../lib/subscription'

const safeId = (value: unknown) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const isObject = (value: any) => Boolean(value) && typeof value === 'object'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any).role as string | undefined
  const authUserId = ((token as any)?.id || (token as any)?.sub || '') as string
  const tokenGrade = normalizeGradeInput((token as any).grade as string | undefined)

  const sessionId = safeId(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id)
  if (!sessionId) return res.status(400).json({ message: 'Missing session id' })

  const session = await prisma.sessionRecord.findUnique({ where: { id: sessionId }, select: { id: true, grade: true } })
  if (!session) return res.status(404).json({ message: 'Session not found' })

  const sessionGrade = normalizeGradeInput((session as any).grade as string | undefined)

  // Grade/role gate
  if (role === 'teacher' || role === 'student') {
    if (!tokenGrade) return res.status(403).json({ message: 'Grade not configured' })
    if (sessionGrade && tokenGrade !== sessionGrade) return res.status(403).json({ message: 'Forbidden: grade mismatch' })
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
    const assignment = await prisma.sessionLessonScript.findUnique({
      where: { sessionId },
      select: {
        id: true,
        sessionId: true,
        templateId: true,
        templateVersionId: true,
        overrideContent: true,
        updatedAt: true,
        template: { select: { id: true, title: true, grade: true, subject: true, topic: true, currentVersionId: true } },
        templateVersion: { select: { id: true, version: true, createdAt: true } },
      },
    })

    if (!assignment) {
      return res.status(200).json({ sessionId, resolved: null, source: 'none' as const })
    }

    if (assignment.overrideContent) {
      return res.status(200).json({
        sessionId,
        source: 'override' as const,
        resolved: assignment.overrideContent,
        assignment,
      })
    }

    // If pinned version exists, use it; else use template current.
    let resolved: any = null
    let source: 'template-version' | 'template-current' | 'none' = 'none'

    if (assignment.templateVersionId) {
      const version = await prisma.lessonScriptVersion.findUnique({ where: { id: assignment.templateVersionId }, select: { content: true, version: true, id: true, templateId: true } })
      if (version) {
        resolved = version.content
        source = 'template-version'
      }
    }

    if (!resolved && assignment.templateId) {
      const template = await prisma.lessonScriptTemplate.findUnique({
        where: { id: assignment.templateId },
        select: {
          currentVersion: { select: { id: true, version: true, content: true } },
        },
      })
      if (template?.currentVersion?.content) {
        resolved = template.currentVersion.content
        source = 'template-current'
      }
    }

    return res.status(200).json({ sessionId, source, resolved, assignment })
  }

  if (req.method === 'PUT') {
    if (role !== 'admin' && role !== 'teacher') return res.status(403).json({ message: 'Forbidden' })

    // Teachers may only modify sessions in their grade.
    if (role === 'teacher') {
      if (!tokenGrade) return res.status(403).json({ message: 'Teacher grade not configured' })
      if (sessionGrade && tokenGrade !== sessionGrade) return res.status(403).json({ message: 'Forbidden: grade mismatch' })
    }

    const templateId = safeId(req.body?.templateId)
    const templateVersionId = safeId(req.body?.templateVersionId)
    const hasOverride = Object.prototype.hasOwnProperty.call(req.body || {}, 'overrideContent')
    const overrideContent = hasOverride ? req.body.overrideContent : undefined

    if (hasOverride && overrideContent !== null && overrideContent !== undefined && !isObject(overrideContent)) {
      return res.status(400).json({ message: 'overrideContent must be an object, null, or omitted' })
    }

    // If templateVersionId is provided, validate it and derive templateId if missing.
    let resolvedTemplateId = templateId
    if (templateVersionId) {
      const v = await prisma.lessonScriptVersion.findUnique({ where: { id: templateVersionId }, select: { id: true, templateId: true } })
      if (!v) return res.status(400).json({ message: 'Invalid templateVersionId' })
      if (resolvedTemplateId && resolvedTemplateId !== v.templateId) {
        return res.status(400).json({ message: 'templateVersionId does not belong to templateId' })
      }
      resolvedTemplateId = v.templateId
    }

    if (resolvedTemplateId) {
      const t = await prisma.lessonScriptTemplate.findUnique({ where: { id: resolvedTemplateId }, select: { id: true } })
      if (!t) return res.status(400).json({ message: 'Invalid templateId' })
    }

    const updatedBy = ((token as any)?.email as string | undefined) || ((token as any)?.sub as string | undefined) || 'unknown'

    const assignment = await prisma.sessionLessonScript.upsert({
      where: { sessionId },
      create: {
        sessionId,
        templateId: resolvedTemplateId ?? null,
        templateVersionId: templateVersionId ?? null,
        overrideContent: hasOverride ? (overrideContent as any) : null,
        createdBy: updatedBy,
        updatedBy,
      },
      update: {
        templateId: resolvedTemplateId ?? null,
        templateVersionId: templateVersionId ?? null,
        ...(hasOverride ? { overrideContent: overrideContent as any } : {}),
        updatedBy,
      },
      select: {
        id: true,
        sessionId: true,
        templateId: true,
        templateVersionId: true,
        overrideContent: true,
        updatedAt: true,
      },
    })

    return res.status(200).json({ assignment })
  }

  res.setHeader('Allow', ['GET', 'PUT'])
  return res.status(405).end('Method not allowed')
}
