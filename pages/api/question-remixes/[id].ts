import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserIdFromReq, getUserRole } from '../../../lib/auth'
import { getDisplayRemixName, type RemixNameSignature } from '../../../lib/remixNames'

const VALID_AUDIENCES = new Set(['private', 'grade', 'public'])

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text) return text
  }
  return ''
}

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

async function getViewerContext(userId: string, role: string) {
  const [viewer, memberships] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, grade: true },
    }),
    prisma.learningGroupMember.findMany({
      where: { userId },
      select: { groupId: true },
    }),
  ])

  return {
    viewer,
    role,
    groupIds: Array.from(new Set(memberships.map((item) => item.groupId))).filter(Boolean),
  }
}

function buildVisibilityWhere(userId: string, role: string, grade: string | null | undefined, groupIds: string[]) {
  if (role === 'admin') return {}

  const orConditions: any[] = [
    { createdById: userId },
    { audience: 'public' },
    { invitedUsers: { some: { userId } } },
  ]

  if (grade) {
    orConditions.push({ audience: 'grade', grade })
  }
  if (groupIds.length > 0) {
    orConditions.push({ invitedGroups: { some: { groupId: { in: groupIds } } } })
  }

  return { OR: orConditions }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  const remixId = typeof req.query.id === 'string' ? req.query.id.trim() : ''
  if (!remixId) return res.status(400).json({ message: 'Remix id is required' })

  const role = (await getUserRole(req)) || 'student'
  const context = await getViewerContext(userId, role)
  const visibleWhere = buildVisibilityWhere(userId, role, context.viewer?.grade ? String(context.viewer.grade) : null, context.groupIds)

  if (req.method === 'GET') {
    const remix = await prisma.questionRemix.findFirst({
      where: {
        id: remixId,
        ...visibleWhere,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true },
        },
        invitedUsers: {
          include: {
            user: {
              select: { id: true, name: true, email: true, role: true, grade: true },
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
                grade: true,
                year: true,
                month: true,
                paper: true,
                questionNumber: true,
                questionDepth: true,
                topic: true,
                cognitiveLevel: true,
                marks: true,
                questionText: true,
                latex: true,
                imageUrl: true,
                tableMarkdown: true,
                approved: true,
                sourceId: true,
                createdAt: true,
              },
            },
          },
        },
      },
    })

    if (!remix) return res.status(404).json({ message: 'Remix not found' })

    const compatibilitySignature = buildCompatibilitySignature(remix.questions.map((entry) => entry.question))

    return res.status(200).json({
      id: remix.id,
      name: getDisplayRemixName(remix.name, compatibilitySignature, remix.createdBy?.name || remix.createdBy?.email || ''),
      description: remix.description,
      grade: remix.grade,
      audience: remix.audience,
      inviteNote: remix.inviteNote,
      createdAt: remix.createdAt,
      updatedAt: remix.updatedAt,
      createdBy: remix.createdBy,
      invitedUsers: remix.invitedUsers.map((entry) => entry.user),
      invitedGroups: remix.invitedGroups.map((entry) => entry.group),
      compatibilitySignature,
      questions: remix.questions.map((entry) => ({
        ...entry.question,
        imageUrls: entry.question.imageUrl ? [entry.question.imageUrl] : [],
        sourceTitle: '',
        sourceUrl: '',
        questionText: firstNonEmpty(entry.question.questionText),
      })),
    })
  }

  if (req.method === 'PATCH') {
    const remix = await prisma.questionRemix.findUnique({
      where: { id: remixId },
      include: {
        invitedUsers: { select: { userId: true } },
        invitedGroups: { select: { groupId: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    })

    if (!remix) return res.status(404).json({ message: 'Remix not found' })

    const canEdit = role === 'admin' || remix.createdById === userId
    if (!canEdit) return res.status(403).json({ message: 'Only the creator can edit this remix' })

    const description = asTrimmedString(req.body?.description, 4000)
    const inviteNote = asTrimmedString(req.body?.inviteNote, 2000)
    const audienceRaw = asTrimmedString(req.body?.audience, 20).toLowerCase()
    const audience = VALID_AUDIENCES.has(audienceRaw) ? audienceRaw : remix.audience
    const questionIds = asIdList(req.body?.questionIds, 120)
    const invitedUserIds = asIdList(req.body?.invitedUserIds, 120).filter((id) => id !== userId)
    const invitedGroupIds = asIdList(req.body?.invitedGroupIds, 60)

    if (audience === 'grade' && !remix.grade) {
      return res.status(400).json({ message: 'Grade audience requires a single remix grade' })
    }

    const [validUsers, membershipRows, existingQuestions, appendedQuestions] = await Promise.all([
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
      prisma.questionRemixQuestion.findMany({
        where: { remixId },
        select: { questionId: true, orderIndex: true },
        orderBy: { orderIndex: 'asc' },
      }),
      questionIds.length > 0
        ? prisma.examQuestion.findMany({
            where: { id: { in: questionIds } },
            select: { id: true },
          })
        : Promise.resolve([]),
    ])

    const allowedUserIds = validUsers.map((item) => item.id)
    const allowedGroupIds = membershipRows.map((item) => item.groupId)
    const previousUserIds = new Set(remix.invitedUsers.map((item) => item.userId))
    const previousGroupIds = new Set(remix.invitedGroups.map((item) => item.groupId))
    const existingQuestionIds = new Set(existingQuestions.map((item) => item.questionId))
    const validAppendedQuestionIds = appendedQuestions.map((item) => item.id)
    if (validAppendedQuestionIds.length !== questionIds.length) {
      return res.status(400).json({ message: 'Some selected questions no longer exist' })
    }
    const nextOrderIndex = existingQuestions.length > 0 ? Math.max(...existingQuestions.map((item) => item.orderIndex)) + 1 : 0
    const appendedQuestionCreates = validAppendedQuestionIds
      .filter((questionId) => !existingQuestionIds.has(questionId))
      .map((questionId, index) => ({ questionId, orderIndex: nextOrderIndex + index }))

    const updated = await prisma.questionRemix.update({
      where: { id: remixId },
      data: {
        description: description || null,
        inviteNote: inviteNote || null,
        audience,
        ...(appendedQuestionCreates.length > 0
          ? {
              questions: {
                create: appendedQuestionCreates,
              },
            }
          : {}),
        invitedUsers: {
          deleteMany: {},
          ...(allowedUserIds.length > 0
            ? {
                create: allowedUserIds.map((targetUserId) => ({ userId: targetUserId })),
              }
            : {}),
        },
        invitedGroups: {
          deleteMany: {},
          ...(allowedGroupIds.length > 0
            ? {
                create: allowedGroupIds.map((groupId) => ({ groupId })),
              }
            : {}),
        },
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true },
        },
        invitedUsers: {
          include: {
            user: {
              select: { id: true, name: true, email: true, role: true, grade: true },
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
        _count: {
          select: {
            questions: true,
            invitedUsers: true,
            invitedGroups: true,
          },
        },
      },
    })

    const nextNotificationUserIds = new Set<string>()
    for (const targetUserId of allowedUserIds) {
      if (!previousUserIds.has(targetUserId)) nextNotificationUserIds.add(targetUserId)
    }
    const newlyAddedGroupIds = allowedGroupIds.filter((groupId) => !previousGroupIds.has(groupId))
    if (newlyAddedGroupIds.length > 0) {
      const groupMembers = await prisma.learningGroupMember.findMany({
        where: { groupId: { in: newlyAddedGroupIds } },
        select: { userId: true },
      })
      for (const member of groupMembers) {
        if (member.userId && member.userId !== userId) nextNotificationUserIds.add(member.userId)
      }
    }

    if (nextNotificationUserIds.size > 0) {
      const actorName = firstNonEmpty(remix.createdBy?.name, remix.createdBy?.email, 'A teacher')
      await prisma.notification.createMany({
        data: Array.from(nextNotificationUserIds).map((targetUserId) => ({
          userId: targetUserId,
          type: 'question_remix_invite',
          title: `Updated remix: ${updated.name}`,
          body: inviteNote || `${actorName} shared a remix with you.`,
          data: { remixId: updated.id },
        })),
      })
    }

    return res.status(200).json({
      id: updated.id,
      name: updated.name,
      description: updated.description,
      grade: updated.grade,
      audience: updated.audience,
      inviteNote: updated.inviteNote,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      createdBy: updated.createdBy,
      questionCount: updated._count.questions,
      invitedUsersCount: updated._count.invitedUsers,
      invitedGroupsCount: updated._count.invitedGroups,
      addedQuestionCount: appendedQuestionCreates.length,
      invitedUsers: updated.invitedUsers.map((entry) => entry.user),
      invitedGroups: updated.invitedGroups.map((entry) => entry.group),
    })
  }

  res.setHeader('Allow', ['GET', 'PATCH'])
  return res.status(405).end()
}