import type { NextApiRequest, NextApiResponse } from 'next'

import prisma from '../../../lib/prisma'
import { getUserIdFromReq } from '../../../lib/auth'
import { buildSuggestedRemixName, resolveRemixName } from '../../../lib/remixNames'

const MY_SOLVES_NAME = 'My Solves'

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text) return text
  }
  return ''
}

function getSharedString<T>(items: T[], pick: (item: T) => unknown): string {
  if (items.length === 0) return ''
  const values = items.map((item) => firstNonEmpty(pick(item))).filter(Boolean)
  if (values.length !== items.length) return ''
  const first = values[0]
  return values.every((value) => value === first) ? first : ''
}

function getSharedNumber<T>(items: T[], pick: (item: T) => unknown): number | null {
  if (items.length === 0) return null
  const values = items.map((item) => {
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
) {
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end()
  }

  const questionId = typeof req.body?.questionId === 'string' ? req.body.questionId.trim() : ''
  if (!questionId) {
    return res.status(400).json({ message: 'Question id is required' })
  }

  const question = await prisma.examQuestion.findUnique({
    where: { id: questionId },
    select: {
      id: true,
      grade: true,
      year: true,
      month: true,
      paper: true,
      topic: true,
      cognitiveLevel: true,
    },
  })
  if (!question) {
    return res.status(404).json({ message: 'Question not found' })
  }

  let remix = await prisma.questionRemix.findFirst({
    where: {
      createdById: userId,
      name: MY_SOLVES_NAME,
      audience: 'private',
    },
    orderBy: { updatedAt: 'desc' },
    include: {
      questions: {
        orderBy: { orderIndex: 'asc' },
        select: {
          questionId: true,
          orderIndex: true,
          question: {
            select: {
              year: true,
              month: true,
              paper: true,
              topic: true,
              cognitiveLevel: true,
            },
          },
        },
      },
      createdBy: {
        select: { id: true, name: true, email: true, role: true },
      },
      _count: {
        select: { questions: true, invitedUsers: true, invitedGroups: true },
      },
    },
  })

  if (!remix) {
    remix = await prisma.questionRemix.create({
      data: {
        createdById: userId,
        name: MY_SOLVES_NAME,
        nameManuallySet: true,
        description: 'Questions you have solved in Remix.',
        audience: 'private',
        grade: question.grade,
        questions: {
          create: [{
            questionId: question.id,
            orderIndex: 0,
          }],
        },
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true },
        },
        questions: {
          orderBy: { orderIndex: 'asc' },
          select: {
            questionId: true,
            orderIndex: true,
            question: {
              select: {
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
          select: { questions: true, invitedUsers: true, invitedGroups: true },
        },
      },
    })
  } else if (!remix.questions.some((entry) => entry.questionId === question.id)) {
    const nextOrderIndex = remix.questions.length > 0
      ? Math.max(...remix.questions.map((entry) => entry.orderIndex)) + 1
      : 0

    remix = await prisma.questionRemix.update({
      where: { id: remix.id },
      data: {
        questions: {
          create: {
            questionId: question.id,
            orderIndex: nextOrderIndex,
          },
        },
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true },
        },
        questions: {
          orderBy: { orderIndex: 'asc' },
          select: {
            questionId: true,
            orderIndex: true,
            question: {
              select: {
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
          select: { questions: true, invitedUsers: true, invitedGroups: true },
        },
      },
    })
  }

  const compatibilitySignature = buildCompatibilitySignature(remix.questions.map((entry) => entry.question))
  const resolvedName = resolveRemixName(
    remix.name,
    compatibilitySignature,
    remix.createdBy?.name || remix.createdBy?.email || '',
    remix.nameManuallySet,
  )

  return res.status(200).json({
    id: remix.id,
    name: resolvedName.displayName,
    suggestedName: buildSuggestedRemixName(compatibilitySignature),
    nameManuallySet: true,
    description: remix.description,
    grade: remix.grade,
    audience: remix.audience,
    inviteNote: remix.inviteNote,
    createdAt: remix.createdAt,
    updatedAt: remix.updatedAt,
    createdBy: remix.createdBy,
    questionCount: remix._count.questions,
    invitedUsersCount: remix._count.invitedUsers,
    invitedGroupsCount: remix._count.invitedGroups,
    compatibilitySignature,
    previewQuestions: remix.questions.slice(0, 3).map((entry) => ({
      id: entry.questionId,
      questionNumber: '',
      year: entry.question.year,
      month: entry.question.month,
      paper: entry.question.paper,
      topic: entry.question.topic,
    })),
  })
}