import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../lib/prisma'
import { normalizeGradeInput } from '../../../../lib/grades'
import { getUserSubscriptionStatus, isSubscriptionGatingEnabled, subscriptionRequiredResponse } from '../../../../lib/subscription'

type LessonScriptSource = 'override' | 'template-version' | 'template-current' | 'none'

const VALID_PHASE_KEYS = new Set(['engage', 'explore', 'explain', 'elaborate', 'evaluate'])

const isPlainObject = (value: any) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const validateLessonScriptOverride = (value: any): { ok: true } | { ok: false; message: string } => {
  if (value === undefined || value === null) return { ok: true }
  if (!isPlainObject(value)) return { ok: false, message: 'overrideContent must be a JSON object' }

  const schemaVersion = typeof (value as any).schemaVersion === 'number' ? (value as any).schemaVersion : null

  // Legacy schemaVersion 1: keep permissive to avoid breaking old sessions.
  if (schemaVersion === 1) {
    return { ok: true }
  }

  // schemaVersion 2: Phase -> Points -> Modules
  if (schemaVersion === 2) {
    const phases = (value as any).phases
    if (!Array.isArray(phases)) return { ok: false, message: 'schemaVersion 2 requires phases[]' }

    for (const phase of phases) {
      if (!isPlainObject(phase)) return { ok: false, message: 'Each phase must be an object' }
      const key = (phase as any).key
      if (typeof key !== 'string' || !VALID_PHASE_KEYS.has(key)) return { ok: false, message: `Invalid phase key: ${String(key)}` }

      const points = (phase as any).points
      if (!Array.isArray(points)) return { ok: false, message: `Phase ${key} requires points[]` }

      for (const point of points) {
        if (!isPlainObject(point)) return { ok: false, message: `Phase ${key} point must be an object` }
        const modules = (point as any).modules
        if (!Array.isArray(modules)) return { ok: false, message: `Phase ${key} point requires modules[]` }
        if (modules.length > 3) return { ok: false, message: `Phase ${key} point has too many modules (max 3)` }

        for (const mod of modules) {
          if (!isPlainObject(mod)) return { ok: false, message: `Phase ${key} module must be an object` }
          const type = (mod as any).type
          if (type !== 'text' && type !== 'diagram' && type !== 'latex') return { ok: false, message: `Invalid module type: ${String(type)}` }

          if (type === 'text') {
            if (typeof (mod as any).text !== 'string') return { ok: false, message: 'Text module requires text:string' }
          }
          if (type === 'diagram') {
            if (typeof (mod as any).title !== 'string') return { ok: false, message: 'Diagram module requires title:string' }
          }
          if (type === 'latex') {
            if (typeof (mod as any).latex !== 'string') return { ok: false, message: 'LaTeX module requires latex:string' }
          }
        }
      }
    }

    return { ok: true }
  }

  // Unknown schema: allow only if it's clearly the old shape (to be safe, require explicit schemaVersion).
  return { ok: false, message: 'Unknown lesson script schemaVersion. Expected 1 or 2.' }
}

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

    if (overrideContent !== undefined) {
      const validated = validateLessonScriptOverride(overrideContent)
      if (validated.ok === false) return res.status(400).json({ message: validated.message })
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
