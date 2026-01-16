import type { NextApiRequest, NextApiResponse } from 'next'
import crypto from 'crypto'
import prisma from '../../../lib/prisma'
import { getUserGrade, getUserIdFromReq, getUserRole } from '../../../lib/auth'

const gradeRank: Record<string, number> = {
  GRADE_8: 8,
  GRADE_9: 9,
  GRADE_10: 10,
  GRADE_11: 11,
  GRADE_12: 12,
}

function generateJoinCode() {
  // 8 chars, uppercase, avoids ambiguous chars
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(8)
  let out = ''
  for (let i = 0; i < 8; i += 1) {
    out += alphabet[bytes[i] % alphabet.length]
  }
  return out
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end()
  }

  const role = (await getUserRole(req)) || 'student'
  const userGrade = await getUserGrade(req)

  const body = req.body || {}
  const name = asString(body.name)
  const type = asString(body.type).toLowerCase() || 'study_group'
  const allowedTypes = new Set(['class', 'cohort', 'study_group'])

  if (!name || name.length < 2) return res.status(400).json({ message: 'Group name is too short' })
  if (name.length > 80) return res.status(400).json({ message: 'Group name is too long' })
  if (!allowedTypes.has(type)) return res.status(400).json({ message: 'Invalid group type' })

  const gradeRaw = asString(body.grade)
  const requestedGrade = gradeRaw ? gradeRaw.toUpperCase() : ''

  let groupGrade: string | null = requestedGrade || null
  if (role === 'student') {
    const myRank = userGrade ? gradeRank[String(userGrade)] : null
    if (!myRank) return res.status(400).json({ message: 'Your grade must be set before creating a group' })

    // Default to own grade if none supplied
    if (!groupGrade) groupGrade = String(userGrade)

    const groupRank = gradeRank[String(groupGrade)]
    if (!groupRank) return res.status(400).json({ message: 'Invalid grade' })

    // Students can create groups at their level and below
    if (groupRank > myRank) return res.status(403).json({ message: 'You can only create groups for your grade or below' })
  }

  // Instructors/admin can omit grade; keep as null or a valid Grade enum string.
  if (groupGrade && !gradeRank[String(groupGrade)]) {
    return res.status(400).json({ message: 'Invalid grade' })
  }

  let joinCode = generateJoinCode()
  for (let i = 0; i < 3; i += 1) {
    const exists = await prisma.learningGroup.findUnique({ where: { joinCode } })
    if (!exists) break
    joinCode = generateJoinCode()
  }

  const group = await prisma.learningGroup.create({
    data: {
      name,
      type,
      grade: groupGrade as any,
      createdById: userId,
      joinCode,
      joinCodeActive: true,
      members: {
        create: {
          userId,
          memberRole: role === 'teacher' || role === 'admin' ? 'instructor' : 'owner',
        },
      },
    },
    include: {
      _count: { select: { members: true } },
    },
  })

  return res.status(201).json({
    id: group.id,
    name: group.name,
    type: group.type,
    grade: group.grade,
    joinCode: group.joinCode,
    joinCodeActive: group.joinCodeActive,
    membersCount: (group as any)?._count?.members ?? 0,
  })
}
