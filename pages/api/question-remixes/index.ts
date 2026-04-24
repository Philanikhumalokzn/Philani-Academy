import type { NextApiRequest, NextApiResponse } from 'next'
import type { Prisma } from '@prisma/client'
import prisma from '../../../lib/prisma'
import { getUserIdFromReq, getUserRole } from '../../../lib/auth'
import { normalizeGradeInput } from '../../../lib/grades'
import { buildSuggestedRemixName, resolveRemixName, type RemixNameSignature } from '../../../lib/remixNames'

const VALID_AUDIENCES = new Set(['private', 'grade', 'public'])

function asTrimmedString(value: unknown, maxLength = 4000): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  return raw.slice(0, maxLength)
}

function asIdList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    const id = typeof item === 'string' ? item.trim() : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= maxItems) break
  }
  return out
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text) return text
  }
  return ''
}

function getSharedString<T>(items: T[], pick: (item: T) => unknown): string {
  if (items.length === 0) return ''
  const values = items
    .map((item) => firstNonEmpty(pick(item)))
    .filter(Boolean)
  if (values.length !== items.length) return ''
  const first = values[0]
  return values.every((value) => value === first) ? first : ''
}

function getSharedNumber<T>(items: T[], pick: (item: T) => unknown): number | null {
  if (items.length === 0) return null
  const values = items
    .map((item) => {
      const raw = pick(item)
      const num = typeof raw === 'number' ? raw : Number(raw)
      return Number.isFinite(num) ? num : null
    })
  if (values.some((value) => value == null)) return null
  const first = values[0]
  return values.every((value) => value === first) ? first : null
}

function buildCompatibilitySignature(
  questions: Array<{ year: number; month: string; paper: number; topic: string | null; cognitiveLevel: string | number | null }>,
): RemixNameSignature {
  const year = getSharedNumber(questions, (item) => item.year)
  const month = getSharedString(questions, (item) => item.month)
  const paper = getSharedNumber(questions, (item) => item.paper)
  const topic = getSharedString(questions, (item) => item.topic)
  const level = getSharedString(questions, (item) => item.cognitiveLevel)

  return {
    year: year != null ? String(year) : '',
    month,
    paper: paper != null ? String(paper) : '',
    topic,
    level,
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function ensureUniqueRemixName(userId: string, baseName: string, excludeId?: string) {
  const normalizedBaseName = baseName.trim() || 'Untitled remix'
  const existing = await prisma.questionRemix.findMany({
    where: {
      createdById: userId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      name: { startsWith: normalizedBaseName },
    },
    select: { name: true },
  })

  if (existing.length === 0) return normalizedBaseName

  const matcher = new RegExp(`^${escapeRegExp(normalizedBaseName)}(?: (\\d+))?$`)
  let maxSuffix = 0
  for (const item of existing) {
    const match = item.name.match(matcher)
    if (!match) continue
    const suffix = match[1] ? Number(match[1]) : 1
    if (Number.isFinite(suffix) && suffix > maxSuffix) maxSuffix = suffix
  }

  return maxSuffix === 0 ? normalizedBaseName : `${normalizedBaseName} ${maxSuffix + 1}`
}

function isRequestedNameManual(requestedName: string, suggestedName: string): boolean {
  return Boolean(requestedName) && requestedName !== suggestedName
}

async function getViewerContext(userId: string, role: string) {
  const [viewer, memberships] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, grade: true, name: true, email: true },
    }),
    prisma.learningGroupMember.findMany({
      where: { userId },
      select: { groupId: true },
    }),
  ])

  return {
    viewer,
    role,
    isAdmin: role === 'admin',
    isTeacher: role === 'teacher',
    groupIds: Array.from(new Set(memberships.map((item) => item.groupId))).filter(Boolean),
  }
}

function buildVisibilityWhere(userId: string, role: string, grade: string | null | undefined, groupIds: string[]): Prisma.QuestionRemixWhereInput | null {
  if (!grade) return null

  if (role === 'admin') return { grade: grade as any }

  const orConditions: any[] = [
    { createdById: userId },
    { audience: 'public' },
    { invitedUsers: { some: { userId } } },
  ]

  if (grade) {
    orConditions.push({ audience: 'grade', grade: grade as any })
  }
  if (groupIds.length > 0) {
    orConditions.push({ invitedGroups: { some: { groupId: { in: groupIds } } } })
  }

  return {
    grade: grade as any,
    OR: orConditions,
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  const role = (await getUserRole(req)) || 'student'

  if (req.method === 'GET') {
    const context = await getViewerContext(userId, role)
    const viewerGrade = normalizeGradeInput(context.viewer?.grade ? String(context.viewer.grade) : undefined)
    const requestedGrade = normalizeGradeInput(typeof req.query.grade === 'string' ? req.query.grade : undefined)
    const scopeGrade = role === 'admin' ? (requestedGrade || viewerGrade) : viewerGrade
    if (!scopeGrade) return res.status(400).json({ message: 'Grade is required' })
    const visibleWhere = buildVisibilityWhere(userId, role, scopeGrade, context.groupIds)
    if (!visibleWhere) return res.status(400).json({ message: 'Grade is required' })
    const remixes = await prisma.questionRemix.findMany({
      where: visibleWhere,
      orderBy: { updatedAt: 'desc' },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true },
        },
        invitedUsers: {
          include: {
            user: {
              select: { id: true, name: true, role: true, grade: true },
            },
          },
        },
        invitedGroups: {
          include: {
            group: {
              select: { id: true, name: true, type: true, grade: true },
            },
          },
        },
        questions: {
          orderBy: { orderIndex: 'asc' },
          include: {
            question: {
              select: {
                id: true,
                questionNumber: true,
                year: true,
                month: true,
                paper: true,
                topic: true,
                cognitiveLevel: true,
              },
            },
          },
        },
        _count: {
          select: {
            questions: true,
            invitedUsers: true,
            invitedGroups: true,
          },
        },
      },
    })

    return res.status(200).json({
      items: remixes.map((item) => {
        const allQuestions = item.questions.map((entry) => entry.question)
        const compatibilitySignature = buildCompatibilitySignature(allQuestions)
        const resolvedName = resolveRemixName(
          item.name,
          compatibilitySignature,
          item.createdBy?.name || item.createdBy?.email || '',
          item.nameManuallySet,
        )
        return {
          id: item.id,
          name: resolvedName.displayName,
          suggestedName: resolvedName.suggestedName,
          nameManuallySet: resolvedName.isManualName,
          description: item.description,
          grade: item.grade,
          audience: item.audience,
          inviteNote: item.inviteNote,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          createdBy: item.createdBy,
          questionCount: item._count.questions,
          invitedUsersCount: item._count.invitedUsers,
          invitedGroupsCount: item._count.invitedGroups,
          compatibilitySignature,
          previewQuestions: item.questions.slice(0, 3).map((entry) => ({
            id: entry.question.id,
            questionNumber: entry.question.questionNumber,
            year: entry.question.year,
            month: entry.question.month,
            paper: entry.question.paper,
            topic: entry.question.topic,
          })),
          invitedUsers: item.invitedUsers.map((entry) => entry.user),
          invitedGroups: item.invitedGroups.map((entry) => entry.group),
        }
      }),
    })
  }

  if (req.method === 'POST') {
    if (!(role === 'admin' || role === 'teacher')) {
      return res.status(403).json({ message: 'Teachers or admins only' })
    }

    const requestedName = asTrimmedString(req.body?.name, 160)
    const description = asTrimmedString(req.body?.description, 4000)
    const inviteNote = asTrimmedString(req.body?.inviteNote, 2000)
    const audienceRaw = asTrimmedString(req.body?.audience, 20).toLowerCase()
    const audience = VALID_AUDIENCES.has(audienceRaw) ? audienceRaw : 'private'
    const questionIds = asIdList(req.body?.questionIds, 120)
    const invitedUserIds = asIdList(req.body?.invitedUserIds, 120).filter((id) => id !== userId)
    const invitedGroupIds = asIdList(req.body?.invitedGroupIds, 60)

    if (questionIds.length === 0) return res.status(400).json({ message: 'Select at least one question' })

    const [context, questions] = await Promise.all([
      getViewerContext(userId, role),
      prisma.examQuestion.findMany({
        where: { id: { in: questionIds } },
        select: {
          id: true,
          grade: true,
          year: true,
          month: true,
          paper: true,
          topic: true,
          cognitiveLevel: true,
        },
      }),
    ])

    if (!context.viewer) return res.status(404).json({ message: 'User not found' })
    if (questions.length !== questionIds.length) return res.status(400).json({ message: 'Some selected questions no longer exist' })

    const viewerGrade = normalizeGradeInput(context.viewer?.grade ? String(context.viewer.grade) : undefined)
    const requestedScopeGrade = normalizeGradeInput(asTrimmedString(req.body?.grade, 24) || undefined)
    const scopeGrade = role === 'admin' ? (requestedScopeGrade || viewerGrade) : viewerGrade
    if (!scopeGrade) return res.status(400).json({ message: 'Grade is required' })

    const compatibilitySignature = buildCompatibilitySignature(questions)
    const suggestedName = buildSuggestedRemixName(compatibilitySignature)
    const manualNameRequested = isRequestedNameManual(requestedName, suggestedName)
    const baseName = manualNameRequested ? requestedName : suggestedName
    if (!baseName) {
      return res.status(400).json({ message: 'Enter a remix name when the selected questions have no shared intersection.' })
    }
    const name = await ensureUniqueRemixName(userId, baseName)

    const uniqueGrades = Array.from(new Set(questions.map((item) => String(item.grade))))
    const derivedGrade = uniqueGrades.length === 1 ? normalizeGradeInput(uniqueGrades[0]) : null
    if (!derivedGrade || derivedGrade !== scopeGrade) {
      return res.status(400).json({ message: 'All selected questions must match the active grade scope' })
    }
    const grade = scopeGrade

    if (audience === 'grade' && !grade) {
      return res.status(400).json({ message: 'Grade audience requires a single remix grade' })
    }

    const [validUsers, membershipRows] = await Promise.all([
      invitedUserIds.length > 0
        ? prisma.user.findMany({
            where: { id: { in: invitedUserIds } },
            select: { id: true },
          })
        : Promise.resolve([]),
      invitedGroupIds.length > 0
        ? prisma.learningGroupMember.findMany({
            where: { userId, groupId: { in: invitedGroupIds } },
            select: { groupId: true },
          })
        : Promise.resolve([]),
    ])

    const allowedUserIds = validUsers.map((item) => item.id)
    const allowedGroupIds = membershipRows.map((item) => item.groupId)
    const orderedQuestionIds = questionIds.filter((id) => questions.some((item) => item.id === id))

    const created = await prisma.questionRemix.create({
      data: {
        createdById: userId,
        name,
        nameManuallySet: manualNameRequested,
        ...(description ? { description } : {}),
        ...(inviteNote ? { inviteNote } : {}),
        ...(grade ? { grade } : {}),
        audience,
        questions: {
          create: orderedQuestionIds.map((questionId, index) => ({
            questionId,
            orderIndex: index,
          })),
        },
        ...(allowedUserIds.length > 0
          ? {
              invitedUsers: {
                create: allowedUserIds.map((targetUserId) => ({ userId: targetUserId })),
              },
            }
          : {}),
        ...(allowedGroupIds.length > 0
          ? {
              invitedGroups: {
                create: allowedGroupIds.map((groupId) => ({ groupId })),
              },
            }
          : {}),
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true },
        },
        _count: {
          select: {
            questions: true,
            invitedUsers: true,
            invitedGroups: true,
          },
        },
      },
    })

    const notificationUserIds = new Set<string>(allowedUserIds)
    if (allowedGroupIds.length > 0) {
      const groupMembers = await prisma.learningGroupMember.findMany({
        where: { groupId: { in: allowedGroupIds } },
        select: { userId: true },
      })
      for (const member of groupMembers) {
        if (member.userId && member.userId !== userId) notificationUserIds.add(member.userId)
      }
    }

    if (notificationUserIds.size > 0) {
      await prisma.notification.createMany({
        data: Array.from(notificationUserIds).map((targetUserId) => ({
          userId: targetUserId,
          type: 'question_remix_invite',
          title: `New remix: ${name}`,
          body: inviteNote || `${context.viewer?.name || context.viewer?.email || 'A teacher'} shared a remix with you.`,
          data: { remixId: created.id },
        })),
      })
    }

    return res.status(201).json({
      id: created.id,
      name: created.name,
      suggestedName,
      nameManuallySet: manualNameRequested,
      description: created.description,
      grade: created.grade,
      audience: created.audience,
      inviteNote: created.inviteNote,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      createdBy: created.createdBy,
      questionCount: created._count.questions,
      invitedUsersCount: created._count.invitedUsers,
      invitedGroupsCount: created._count.invitedGroups,
    })
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end()
}