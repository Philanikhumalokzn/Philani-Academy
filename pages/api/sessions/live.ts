import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'

type LiveResponse = {
  grade: string
  overrideSessionId: string | null
  resolvedLiveSessionId: string | null
  resolvedReason: 'override' | 'current-default' | 'next-upcoming' | 'none'
}

const appSettingKeyForGrade = (grade: string) => `liveSessionOverride:${grade}`

const safeSessionId = (value: unknown) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const resolveDefaultLiveSessionId = (sessions: any[], nowMs: number) => {
  const getTime = (d: any) => new Date(d).getTime()
  const normalizeEndMs = (s: any) => {
    const end = s?.endsAt
    if (end) return getTime(end)
    const start = s?.startsAt
    const startMs = start ? getTime(start) : nowMs
    return startMs + 60 * 60 * 1000
  }

  const current = (sessions || [])
    .filter(s => s?.id && s?.startsAt)
    .filter(s => {
      const startMs = getTime(s.startsAt)
      const endMs = normalizeEndMs(s)
      return startMs <= nowMs && nowMs <= endMs
    })
    // If multiple overlap, pick the one that started most recently.
    .sort((a, b) => getTime(b.startsAt) - getTime(a.startsAt))

  if (current.length) return { id: String(current[0].id), reason: 'current-default' as const }

  const upcoming = (sessions || [])
    .filter(s => s?.id && s?.startsAt)
    .filter(s => getTime(s.startsAt) > nowMs)
    .sort((a, b) => getTime(a.startsAt) - getTime(b.startsAt))

  if (upcoming.length) return { id: String(upcoming[0].id), reason: 'next-upcoming' as const }

  return { id: null, reason: 'none' as const }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any).role as string | undefined
  const tokenGrade = normalizeGradeInput((token as any).grade as string | undefined)
  const queryGradeRaw = Array.isArray(req.query.grade) ? req.query.grade[0] : req.query.grade
  const requestedGrade = normalizeGradeInput(typeof queryGradeRaw === 'string' ? queryGradeRaw : undefined)

  let gradeToUse = tokenGrade
  if (role === 'admin') {
    gradeToUse = requestedGrade || tokenGrade
    if (!gradeToUse) return res.status(400).json({ message: 'Grade is required for admins' })
  }

  if (role === 'teacher' || role === 'student') {
    if (!tokenGrade) return res.status(403).json({ message: 'Grade not configured' })
    if (requestedGrade && requestedGrade !== tokenGrade) return res.status(403).json({ message: 'Forbidden: grade mismatch' })
    gradeToUse = tokenGrade
  }

  if (!gradeToUse) return res.status(400).json({ message: 'Grade not determined' })

  const nowMs = Date.now()

  if (req.method === 'GET') {
    const sessions = await prisma.sessionRecord.findMany({
      where: { grade: gradeToUse as any },
      orderBy: { startsAt: 'asc' },
    })

    const setting = await prisma.appSetting.findUnique({ where: { key: appSettingKeyForGrade(gradeToUse) } })
    const overrideSessionId = setting?.value ? setting.value : null

    const overrideRec = overrideSessionId
      ? sessions.find(s => String(s.id) === String(overrideSessionId))
      : null

    const overrideIsPast = (() => {
      if (!overrideRec) return false
      const endMs = new Date((overrideRec as any).endsAt || (overrideRec as any).startsAt).getTime()
      return endMs < nowMs
    })()

    if (overrideSessionId && overrideRec && overrideIsPast) {
      const payload: LiveResponse = {
        grade: gradeToUse,
        overrideSessionId: String(overrideSessionId),
        resolvedLiveSessionId: String(overrideSessionId),
        resolvedReason: 'override',
      }
      return res.status(200).json(payload)
    }

    const def = resolveDefaultLiveSessionId(sessions, nowMs)
    const payload: LiveResponse = {
      grade: gradeToUse,
      overrideSessionId: overrideIsPast ? String(overrideSessionId) : null,
      resolvedLiveSessionId: def.id,
      resolvedReason: def.reason,
    }
    return res.status(200).json(payload)
  }

  if (req.method === 'PUT') {
    if (role !== 'admin') return res.status(403).json({ message: 'Forbidden' })

    const overrideSessionId = safeSessionId(req.body?.overrideSessionId)

    if (!overrideSessionId) {
      // Clear override -> auto.
      await prisma.appSetting.upsert({
        where: { key: appSettingKeyForGrade(gradeToUse) },
        create: { key: appSettingKeyForGrade(gradeToUse), value: '' },
        update: { value: '' },
      })
      return res.status(200).json({ ok: true, overrideSessionId: null })
    }

    const rec = await prisma.sessionRecord.findUnique({ where: { id: overrideSessionId } })
    if (!rec) return res.status(404).json({ message: 'Session not found' })
    if (normalizeGradeInput((rec as any).grade as string | undefined) !== gradeToUse) {
      return res.status(400).json({ message: 'Session grade mismatch' })
    }

    const endMs = new Date((rec as any).endsAt || (rec as any).startsAt).getTime()
    if (!(endMs < nowMs)) {
      return res.status(400).json({ message: 'Only past sessions can be selected as an override' })
    }

    await prisma.appSetting.upsert({
      where: { key: appSettingKeyForGrade(gradeToUse) },
      create: { key: appSettingKeyForGrade(gradeToUse), value: String(overrideSessionId) },
      update: { value: String(overrideSessionId) },
    })

    return res.status(200).json({ ok: true, overrideSessionId: String(overrideSessionId) })
  }

  res.setHeader('Allow', ['GET', 'PUT'])
  return res.status(405).end('Method not allowed')
}
