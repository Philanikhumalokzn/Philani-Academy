import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserRole, getUserIdFromReq } from '../../../lib/auth'
import { parseSouthAfricanId } from '../../../lib/saId'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  if (method === 'GET') {
    // Return enriched profile with phone numbers and teacher profile.
    const user: any = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        phoneNumbers: true,
        teacherProfile: true,
      },
    } as any)
    if (!user) return res.status(404).json({ message: 'User not found' })
    delete user.password
    return res.status(200).json(user)
  }

  if (method === 'PUT') {
    const role = await getUserRole(req)
    const {
      name,
      bio,
      race,
      idNumber,
      avatarUrl,
      phoneNumbers,
      teacherProfile,
    } = req.body || {}
    try {
      const data: any = {}
      if (typeof name !== 'undefined') data.name = name
      if (typeof bio !== 'undefined') data.bio = bio
      if (typeof race !== 'undefined') data.race = race
      if (typeof avatarUrl !== 'undefined') data.avatarUrl = avatarUrl
      if (typeof idNumber !== 'undefined') {
        data.idNumber = idNumber || null
        if (idNumber) {
          const parsed = parseSouthAfricanId(idNumber)
          if (!parsed.valid) return res.status(400).json({ message: `Invalid ID number: ${parsed.reason}` })
          data.birthDate = parsed.birthDate
        } else {
          data.birthDate = null
        }
      }

      // Update basic user fields first
      const updated = await prisma.user.update({ where: { id: userId }, data } as any)

      // Optionally upsert teacher profile (only for admins/teachers)
      if (teacherProfile && (role === 'admin' || role === 'teacher')) {
        const tpData: any = {
          title: teacherProfile.title ?? undefined,
          subjects: teacherProfile.subjects ?? undefined,
          experienceYears: teacherProfile.experienceYears ?? undefined,
          qualifications: teacherProfile.qualifications ?? undefined,
          website: teacherProfile.website ?? undefined,
          twitter: teacherProfile.twitter ?? undefined,
          linkedin: teacherProfile.linkedin ?? undefined,
          officeHours: teacherProfile.officeHours ?? undefined,
        }
        await prisma.teacherProfile.upsert({
          where: { userId },
          update: tpData,
          create: { userId, ...tpData },
        } as any)
      }

      // Phone numbers upsert (create/update basic fields; verification handled in dedicated endpoints)
      if (Array.isArray(phoneNumbers)) {
        // Fetch existing to determine deletes if needed
        const existing = await prisma.phoneNumber.findMany({ where: { userId } })
        const incomingIds = new Set<string>()
        for (const pn of phoneNumbers) {
          if (pn.id) incomingIds.add(pn.id)
        }
        // Delete numbers not present in incoming list
        const toDelete = existing.filter(e => !incomingIds.has(e.id))
        if (toDelete.length) {
          await prisma.phoneNumber.deleteMany({ where: { id: { in: toDelete.map(d => d.id) }, userId } })
        }
        // Upsert
        for (const pn of phoneNumbers) {
          const dataPn: any = {
            number: pn.number,
            label: pn.label ?? null,
            isPrimary: !!pn.isPrimary,
          }
          if (pn.id) {
            await prisma.phoneNumber.update({ where: { id: pn.id }, data: dataPn })
          } else {
            await prisma.phoneNumber.create({ data: { ...dataPn, userId } })
          }
        }
        // Ensure only one primary
        const all = await prisma.phoneNumber.findMany({ where: { userId } })
        const primaries = all.filter(a => a.isPrimary)
        if (primaries.length > 1) {
          // keep the first in incoming list marked primary, unset others
          const firstPrimaryId = (phoneNumbers.find((p: any) => p.isPrimary)?.id) || primaries[0].id
          await prisma.phoneNumber.updateMany({ where: { userId, NOT: { id: firstPrimaryId } }, data: { isPrimary: false } })
        }
      }

      return res.status(200).json({ id: updated.id })
    } catch (err) {
      console.error('PUT /api/profile error', err)
      return res.status(500).json({ message: 'Server error' })
    }
  }

  res.setHeader('Allow', ['GET', 'PUT'])
  return res.status(405).end()
}
