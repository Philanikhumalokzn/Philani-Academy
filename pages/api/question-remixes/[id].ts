import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserIdFromReq, getUserRole } from '../../../lib/auth'

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text) return text
  }
  return ''
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

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end()
  }

  const remixId = typeof req.query.id === 'string' ? req.query.id.trim() : ''
  if (!remixId) return res.status(400).json({ message: 'Remix id is required' })

  const role = (await getUserRole(req)) || 'student'
  const context = await getViewerContext(userId, role)
  const visibleWhere = buildVisibilityWhere(userId, role, context.viewer?.grade ? String(context.viewer.grade) : null, context.groupIds)

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

  return res.status(200).json({
    id: remix.id,
    name: remix.name,
    description: remix.description,
    grade: remix.grade,
    audience: remix.audience,
    inviteNote: remix.inviteNote,
    createdAt: remix.createdAt,
    updatedAt: remix.updatedAt,
    createdBy: remix.createdBy,
    invitedUsers: remix.invitedUsers.map((entry) => entry.user),
    invitedGroups: remix.invitedGroups.map((entry) => entry.group),
    questions: remix.questions.map((entry) => ({
      ...entry.question,
      imageUrls: entry.question.imageUrl ? [entry.question.imageUrl] : [],
      sourceTitle: '',
      sourceUrl: '',
      questionText: firstNonEmpty(entry.question.questionText),
    })),
  })
}