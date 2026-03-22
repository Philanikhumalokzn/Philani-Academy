import type { NextApiRequest, NextApiResponse } from 'next'
import { getUserGrade, getUserIdFromReq, getUserRole } from '../../../lib/auth'
import { normalizeGradeInput } from '../../../lib/grades'
import prisma from '../../../lib/prisma'

const clampText = (value: unknown, maxLength: number) => {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

const parseNumber = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

const parseScoreFromLabel = (value: unknown) => {
  const scoreLabel = clampText(value, 64)
  if (!scoreLabel) return { scoreLabel: '', earnedMarks: null as number | null, totalMarksFromLabel: null as number | null }

  const ratioMatch = scoreLabel.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/)
  if (ratioMatch) {
    const earned = Number(ratioMatch[1])
    const total = Number(ratioMatch[2])
    return {
      scoreLabel,
      earnedMarks: Number.isFinite(earned) ? Math.max(0, earned) : null,
      totalMarksFromLabel: Number.isFinite(total) && total > 0 ? total : null,
    }
  }

  const numericMatch = scoreLabel.match(/-?\d+(?:\.\d+)?/)
  if (!numericMatch) return { scoreLabel, earnedMarks: null, totalMarksFromLabel: null }
  const earned = Number(numericMatch[0])
  return {
    scoreLabel,
    earnedMarks: Number.isFinite(earned) ? Math.max(0, earned) : null,
    totalMarksFromLabel: null,
  }
}

const inferSurname = (user: any) => {
  const explicit = clampText(user?.lastName, 80)
  if (explicit) return explicit

  const fullName = clampText(user?.name, 140)
  if (fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean)
    if (parts.length > 1) return parts[parts.length - 1]
    return parts[0]
  }

  const email = clampText(user?.email, 200)
  if (email.includes('@')) {
    return email.split('@')[0]
  }

  return 'Learner'
}

const inferGivenName = (user: any) => {
  const explicit = clampText(user?.firstName, 80)
  if (explicit) return explicit

  const fullName = clampText(user?.name, 140)
  if (fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean)
    if (parts.length > 1) return parts.slice(0, parts.length - 1).join(' ')
    return parts[0]
  }

  const email = clampText(user?.email, 200)
  if (email.includes('@')) return email.split('@')[0]
  return ''
}

const normalizeScoreLabel = (value: unknown) => {
  const label = clampText(value, 64)
  return label || 'Not marked'
}

const parseAssessmentPayload = (payload: any) => {
  const safe = payload && typeof payload === 'object' ? payload : {}
  const maxMarksRaw = parseNumber(safe?.maxMarks ?? safe?.testTotal)
  return {
    kind: clampText(safe?.kind, 40) || 'manual-assessment-v1',
    grade: normalizeGradeInput(safe?.grade),
    subject: clampText(safe?.subject, 80),
    term: clampText(safe?.term, 40),
    description: clampText(safe?.description, 500),
    assessmentDate: clampText(safe?.assessmentDate, 40),
    maxMarks: maxMarksRaw != null ? Math.max(1, Math.min(1000, Math.trunc(maxMarksRaw))) : null,
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requesterId = await getUserIdFromReq(req)
  const role = await getUserRole(req)

  if (!requesterId) return res.status(401).json({ message: 'Unauthorized' })
  if (role !== 'admin' && role !== 'teacher') return res.status(403).json({ message: 'Forbidden' })

  const requesterGrade = normalizeGradeInput(await getUserGrade(req))

  if (req.method === 'GET') {
    const assessmentId = clampText(req.query.assessmentId, 120)
    const gradeQueryRaw = Array.isArray(req.query.grade) ? req.query.grade[0] : req.query.grade
    const gradeQuery = normalizeGradeInput(typeof gradeQueryRaw === 'string' ? gradeQueryRaw : undefined)

    if (!assessmentId) {
      const gradeFilter = gradeQuery || requesterGrade || null
      if (role === 'teacher' && requesterGrade && gradeFilter && requesterGrade !== gradeFilter) {
        return res.status(403).json({ message: 'Teachers can only access their grade assessments' })
      }

      const where: any = {
        sessionKey: gradeFilter ? `manual-assessment:${gradeFilter}` : { startsWith: 'manual-assessment:' },
      }

      const assessments = await prisma.latexSave.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 120,
        select: {
          id: true,
          title: true,
          payload: true,
          createdAt: true,
          updatedAt: true,
        },
      }).catch(() => [])

      const items = assessments
        .map((item: any) => {
          const payload = parseAssessmentPayload(item?.payload)
          const grade = payload.grade || normalizeGradeInput(String(item?.sessionKey || '').replace('manual-assessment:', ''))
          if (!grade) return null
          return {
            id: String(item?.id || ''),
            title: clampText(item?.title, 140) || 'Untitled assessment',
            grade,
            subject: payload.subject || null,
            term: payload.term || null,
            assessmentDate: payload.assessmentDate || null,
            maxMarks: payload.maxMarks,
            description: payload.description || null,
            createdAt: item?.createdAt,
            updatedAt: item?.updatedAt,
          }
        })
        .filter(Boolean)

      return res.status(200).json({ items })
    }

    const assessment = await prisma.latexSave.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        sessionKey: true,
        title: true,
        payload: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    if (!assessment || !String(assessment.sessionKey || '').startsWith('manual-assessment:')) {
      return res.status(404).json({ message: 'Assessment not found' })
    }

    const assessmentPayload = parseAssessmentPayload(assessment.payload)
    const assessmentGrade = assessmentPayload.grade || normalizeGradeInput(String(assessment.sessionKey).replace('manual-assessment:', ''))
    if (!assessmentGrade) {
      return res.status(400).json({ message: 'Assessment grade is missing' })
    }

    if (role === 'teacher' && requesterGrade && requesterGrade !== assessmentGrade) {
      return res.status(403).json({ message: 'Teachers can only access their grade assessments' })
    }

    const learners = await prisma.user.findMany({
      where: {
        role: 'student',
        grade: assessmentGrade,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        name: true,
        email: true,
      },
      take: 1000,
    })

    const collator = new Intl.Collator('en', { sensitivity: 'base' })
    const orderedLearners = [...learners].sort((left: any, right: any) => {
      const leftSurname = inferSurname(left)
      const rightSurname = inferSurname(right)
      const surnameCmp = collator.compare(leftSurname, rightSurname)
      if (surnameCmp !== 0) return surnameCmp

      const leftGiven = inferGivenName(left)
      const rightGiven = inferGivenName(right)
      const givenCmp = collator.compare(leftGiven, rightGiven)
      if (givenCmp !== 0) return givenCmp

      return collator.compare(String(left?.email || ''), String(right?.email || ''))
    })

    const marksRowsRaw = await (prisma as any).learnerResponse.findMany({
      where: {
        sessionKey: `manual-grade:${assessment.id}`,
        userId: { in: orderedLearners.map((learner: any) => learner.id) },
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        userId: true,
        latex: true,
        feedback: true,
        gradingJson: true,
        updatedAt: true,
        createdAt: true,
      },
    }).catch(() => [])

    const latestMarkByUserId = new Map<string, any>()
    for (const row of marksRowsRaw as any[]) {
      const userId = String(row?.userId || '')
      if (!userId || latestMarkByUserId.has(userId)) continue
      latestMarkByUserId.set(userId, row)
    }

    const rows = orderedLearners.map((learner: any, index: number) => {
      const markRow = latestMarkByUserId.get(String(learner.id)) || null
      const grading = markRow?.gradingJson && typeof markRow.gradingJson === 'object' ? markRow.gradingJson : {}
      const percentage = parseNumber((grading as any)?.percentage)
      const screenshotUrl = clampText((grading as any)?.screenshotUrl, 1024)
      const screenshotUrlsRaw = (grading as any)?.screenshotUrls
      const screenshotUrls: string[] = Array.isArray(screenshotUrlsRaw)
        ? screenshotUrlsRaw.map((u: unknown) => (typeof u === 'string' ? u.trim() : '')).filter(Boolean)
        : (screenshotUrl ? [screenshotUrl] : [])
      const notes = clampText((grading as any)?.notes || markRow?.feedback || '', 1200)

      return {
        number: index + 1,
        userId: String(learner.id),
        surname: inferSurname(learner),
        givenName: inferGivenName(learner),
        fullName: clampText(learner?.name, 160) || `${inferGivenName(learner)} ${inferSurname(learner)}`.trim(),
        scoreLabel: normalizeScoreLabel((grading as any)?.scoreLabel || markRow?.latex),
        percentage: percentage != null ? Math.max(0, Math.min(100, percentage)) : null,
        notes: notes || null,
        screenshotUrl: screenshotUrl || null,
        screenshotUrls,
        gradedAt: markRow?.updatedAt || markRow?.createdAt || null,
      }
    })

    return res.status(200).json({
      assessment: {
        id: String(assessment.id),
        title: clampText(assessment.title, 140) || 'Untitled assessment',
        grade: assessmentGrade,
        subject: assessmentPayload.subject || null,
        term: assessmentPayload.term || null,
        assessmentDate: assessmentPayload.assessmentDate || null,
        maxMarks: assessmentPayload.maxMarks,
        description: assessmentPayload.description || null,
        createdAt: assessment.createdAt,
        updatedAt: assessment.updatedAt,
      },
      rows,
    })
  }

  if (req.method === 'POST') {
    const action = clampText(req.body?.action, 60)

    if (action === 'create') {
      const title = clampText(req.body?.title, 140)
      const grade = normalizeGradeInput(req.body?.grade)
      const subject = clampText(req.body?.subject, 80)
      const term = clampText(req.body?.term, 40)
      const description = clampText(req.body?.description, 500)
      const assessmentDate = clampText(req.body?.assessmentDate, 40)
      const maxMarksRaw = parseNumber(req.body?.maxMarks)
      const maxMarks = maxMarksRaw != null ? Math.max(1, Math.min(1000, Math.trunc(maxMarksRaw))) : null

      if (!title) return res.status(400).json({ message: 'Assessment title is required' })
      if (!grade) return res.status(400).json({ message: 'Assessment grade is required' })
      if (role === 'teacher' && requesterGrade && requesterGrade !== grade) {
        return res.status(403).json({ message: 'Teachers can only create assessments for their grade' })
      }

      const created = await prisma.latexSave.create({
        data: {
          sessionKey: `manual-assessment:${grade}`,
          userId: requesterId,
          title,
          latex: '',
          shared: false,
          payload: {
            kind: 'manual-assessment-v1',
            grade,
            subject,
            term,
            description,
            assessmentDate,
            maxMarks,
          },
        },
        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,
          payload: true,
        },
      })

      return res.status(201).json({
        item: {
          id: String(created.id),
          title: clampText(created.title, 140) || 'Untitled assessment',
          grade,
          subject: subject || null,
          term: term || null,
          description: description || null,
          assessmentDate: assessmentDate || null,
          maxMarks,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
        },
      })
    }

    if (action === 'updateAssessment') {
      const assessmentId = clampText(req.body?.assessmentId, 120)
      if (!assessmentId) return res.status(400).json({ message: 'Assessment id is required' })

      const assessment = await prisma.latexSave.findUnique({
        where: { id: assessmentId },
        select: { id: true, sessionKey: true, payload: true },
      })
      if (!assessment || !String(assessment.sessionKey || '').startsWith('manual-assessment:')) {
        return res.status(404).json({ message: 'Assessment not found' })
      }

      const existingPayload = parseAssessmentPayload(assessment.payload)
      const assessmentGrade = existingPayload.grade || normalizeGradeInput(String(assessment.sessionKey).replace('manual-assessment:', ''))
      if (!assessmentGrade) return res.status(400).json({ message: 'Assessment grade is missing' })
      if (role === 'teacher' && requesterGrade && requesterGrade !== assessmentGrade) {
        return res.status(403).json({ message: 'Teachers can only update assessments for their grade' })
      }

      const title = clampText(req.body?.title, 140) || 'Untitled assessment'
      const subject = clampText(req.body?.subject, 80)
      const term = clampText(req.body?.term, 40)
      const description = clampText(req.body?.description, 500)
      const assessmentDate = clampText(req.body?.assessmentDate, 40)
      const maxMarksRaw = parseNumber(req.body?.maxMarks)
      const maxMarks = maxMarksRaw != null ? Math.max(1, Math.min(1000, Math.trunc(maxMarksRaw))) : null

      const updated = await prisma.latexSave.update({
        where: { id: assessmentId },
        data: {
          title,
          payload: {
            ...existingPayload,
            kind: 'manual-assessment-v1',
            grade: assessmentGrade,
            subject,
            term,
            description,
            assessmentDate,
            maxMarks,
          },
        },
        select: {
          id: true,
          title: true,
          payload: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      return res.status(200).json({
        item: {
          id: String(updated.id),
          title: clampText(updated.title, 140) || 'Untitled assessment',
          grade: assessmentGrade,
          subject: subject || null,
          term: term || null,
          description: description || null,
          assessmentDate: assessmentDate || null,
          maxMarks,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        },
      })
    }

    if (action === 'deleteAssessment') {
      const assessmentId = clampText(req.body?.assessmentId, 120)
      if (!assessmentId) return res.status(400).json({ message: 'Assessment id is required' })

      const assessment = await prisma.latexSave.findUnique({
        where: { id: assessmentId },
        select: { id: true, sessionKey: true, payload: true },
      })
      if (!assessment || !String(assessment.sessionKey || '').startsWith('manual-assessment:')) {
        return res.status(404).json({ message: 'Assessment not found' })
      }

      const payload = parseAssessmentPayload(assessment.payload)
      const assessmentGrade = payload.grade || normalizeGradeInput(String(assessment.sessionKey).replace('manual-assessment:', ''))
      if (!assessmentGrade) return res.status(400).json({ message: 'Assessment grade is missing' })
      if (role === 'teacher' && requesterGrade && requesterGrade !== assessmentGrade) {
        return res.status(403).json({ message: 'Teachers can only delete assessments for their grade' })
      }

      await prisma.$transaction([
        (prisma as any).learnerResponse.deleteMany({
          where: { sessionKey: `manual-grade:${assessment.id}` },
        }),
        prisma.latexSave.delete({ where: { id: assessment.id } }),
      ])

      return res.status(200).json({ ok: true })
    }

    if (action === 'saveMark') {
      const assessmentId = clampText(req.body?.assessmentId, 120)
      const learnerUserId = clampText(req.body?.learnerUserId, 120)
      const parsedScore = parseScoreFromLabel(req.body?.scoreLabel)
      const scoreLabel = normalizeScoreLabel(parsedScore.scoreLabel)
      const notes = clampText(req.body?.notes, 1200)
      const screenshotUrlSingle = clampText(req.body?.screenshotUrl, 1024)
      // Support array of screenshot URLs for multi-page scripts
      const screenshotUrlsRaw: unknown = req.body?.screenshotUrls
      const screenshotUrls: string[] = Array.isArray(screenshotUrlsRaw)
        ? screenshotUrlsRaw
            .map((u: unknown) => (typeof u === 'string' ? u.trim() : ''))
            .filter(Boolean)
            .slice(0, 20)
        : (screenshotUrlSingle ? [screenshotUrlSingle] : [])
      // First URL kept in screenshotUrl for backward compat
      const screenshotUrl = screenshotUrls[0] || ''
      const percentageRaw = parseNumber(req.body?.percentage)
      const percentage = percentageRaw != null ? Math.max(0, Math.min(100, percentageRaw)) : null

      if (!assessmentId) return res.status(400).json({ message: 'Assessment id is required' })
      if (!learnerUserId) return res.status(400).json({ message: 'Learner id is required' })

      const assessment = await prisma.latexSave.findUnique({
        where: { id: assessmentId },
        select: { id: true, sessionKey: true, title: true, payload: true },
      })
      if (!assessment || !String(assessment.sessionKey || '').startsWith('manual-assessment:')) {
        return res.status(404).json({ message: 'Assessment not found' })
      }

      const assessmentPayload = parseAssessmentPayload(assessment.payload)
      const assessmentGrade = assessmentPayload.grade || normalizeGradeInput(String(assessment.sessionKey).replace('manual-assessment:', ''))
      if (!assessmentGrade) return res.status(400).json({ message: 'Assessment grade is missing' })
      if (role === 'teacher' && requesterGrade && requesterGrade !== assessmentGrade) {
        return res.status(403).json({ message: 'Teachers can only mark learners in their grade' })
      }

      const learner = await prisma.user.findUnique({
        where: { id: learnerUserId },
        select: { id: true, email: true, grade: true, role: true },
      })
      if (!learner || learner.role !== 'student') return res.status(404).json({ message: 'Learner not found' })
      if (learner.grade !== assessmentGrade) {
        return res.status(400).json({ message: 'Learner is not in the assessment grade' })
      }

      const totalMarks = assessmentPayload.maxMarks != null
        ? assessmentPayload.maxMarks
        : parsedScore.totalMarksFromLabel
      const autoPercentage = (parsedScore.earnedMarks != null && totalMarks != null && totalMarks > 0)
        ? Math.max(0, Math.min(100, Math.round((parsedScore.earnedMarks / totalMarks) * 100)))
        : null
      const finalPercentage = percentage != null ? percentage : autoPercentage

      const existing = await (prisma as any).learnerResponse.findFirst({
        where: {
          sessionKey: `manual-grade:${assessment.id}`,
          userId: learner.id,
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      }).catch(() => null)

      const gradingJson = {
        type: 'manual-assessment-mark-v1',
        scoreLabel,
        percentage: finalPercentage,
        earnedMarks: parsedScore.earnedMarks,
        totalMarks,
        notes,
        screenshotUrl,
        screenshotUrls,
        gradedAt: new Date().toISOString(),
        gradedById: requesterId,
      }

      const saved = existing
        ? await (prisma as any).learnerResponse.update({
            where: { id: existing.id },
            data: {
              latex: scoreLabel,
              feedback: notes || null,
              gradingJson,
              studentText: notes || null,
            },
            select: { id: true, userId: true, latex: true, feedback: true, gradingJson: true, updatedAt: true },
          })
        : await (prisma as any).learnerResponse.create({
            data: {
              sessionKey: `manual-grade:${assessment.id}`,
              userId: learner.id,
              ownerId: requesterId,
              userEmail: learner.email || null,
              quizId: 'manual-assessment',
              quizLabel: clampText(assessment.title, 140),
              prompt: clampText(assessment.title, 140),
              latex: scoreLabel,
              studentText: notes || null,
              gradingJson,
              feedback: notes || null,
            },
            select: { id: true, userId: true, latex: true, feedback: true, gradingJson: true, updatedAt: true },
          })

      return res.status(200).json({
        item: {
          id: String(saved?.id || ''),
          userId: String(saved?.userId || ''),
          scoreLabel,
          percentage: finalPercentage,
          notes: notes || null,
          screenshotUrl: screenshotUrl || null,
          screenshotUrls,
          gradedAt: saved?.updatedAt || new Date().toISOString(),
        },
      })
    }

    return res.status(400).json({ message: 'Unsupported action' })
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end('Method not allowed')
}
