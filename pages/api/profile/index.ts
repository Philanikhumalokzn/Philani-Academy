import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserIdFromReq } from '../../../lib/auth'

const PROVINCES = [
  'Eastern Cape',
  'Free State',
  'Gauteng',
  'KwaZulu-Natal',
  'Limpopo',
  'Mpumalanga',
  'Northern Cape',
  'North West',
  'Western Cape'
] as const

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function toBoolean(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalised = value.trim().toLowerCase()
    return ['true', '1', 'yes', 'on'].includes(normalised)
  }
  return false
}

function normalisePhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('0') && digits.length === 10) return `+27${digits.slice(1)}`
  if (digits.startsWith('27') && digits.length === 11) return `+${digits}`
  if (value.startsWith('+27') && digits.length === 11) return `+27${digits.slice(2)}`
  return ''
}

function toLocalPhone(value?: string | null) {
  if (!value) return ''
  if (value.startsWith('+27') && value.length === 12) return `0${value.slice(3)}`
  if (value.startsWith('27') && value.length === 11) return `0${value.slice(2)}`
  return value
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  if (method === 'GET') {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        grade: true,
        name: true,
        firstName: true,
        lastName: true,
        middleNames: true,
        dateOfBirth: true,
        idNumber: true,
        phoneNumber: true,
        alternatePhone: true,
        recoveryEmail: true,
        emergencyContactName: true,
        emergencyContactRelationship: true,
        emergencyContactPhone: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        province: true,
        postalCode: true,
        country: true,
        schoolName: true,
        avatar: true,
        consentToPolicies: true,
        consentTimestamp: true,
        createdAt: true,
        updatedAt: true
      }
    })
    if (!user) return res.status(404).json({ message: 'User not found' })
    return res.status(200).json({
      ...user,
      phoneNumber: toLocalPhone(user.phoneNumber),
      alternatePhone: toLocalPhone(user.alternatePhone),
      emergencyContactPhone: toLocalPhone(user.emergencyContactPhone)
    })
  }

  if (method === 'PUT') {
    const body = req.body || {}
    const existing = await prisma.user.findUnique({ where: { id: userId } })
    if (!existing) return res.status(404).json({ message: 'User not found' })

    const firstName = asString(body.firstName)
    const lastName = asString(body.lastName)
    const middleNames = asString(body.middleNames)
    const dateOfBirthInput = asString(body.dateOfBirth)
    const idNumber = asString(body.idNumber).replace(/\D/g, '')
    const recoveryEmail = asString(body.recoveryEmail).toLowerCase()
    const schoolName = asString(body.schoolName)
    const addressLine1 = asString(body.addressLine1)
    const addressLine2 = asString(body.addressLine2)
    const city = asString(body.city)
    const province = asString(body.province)
    const postalCode = asString(body.postalCode)
    const country = asString(body.country)
    const emergencyContactName = asString(body.emergencyContactName)
    const emergencyContactRelationship = asString(body.emergencyContactRelationship)
    const popiConsent = toBoolean(body.popiConsent ?? body.consentToPolicies ?? body.termsConsent)
    const avatar = asString(body.avatar)

    const email = asString(body.email).toLowerCase() || existing.email

    const primaryPhoneFormatted = normalisePhone(asString(body.phoneNumber) || asString(body.phone))
    const alternatePhoneFormatted = asString(body.alternatePhone) ? normalisePhone(asString(body.alternatePhone)) : ''
    const emergencyPhoneFormatted = normalisePhone(asString(body.emergencyContactPhone) || asString(body.emergencyPhone))

    const errors: string[] = []
    if (!firstName) errors.push('First name is required')
    if (!lastName) errors.push('Last name is required')
    if (!email || !emailRegex.test(email)) errors.push('Valid email is required')
    if (!dateOfBirthInput) {
      errors.push('Date of birth is required')
    }
    if (!primaryPhoneFormatted) errors.push('Primary contact number must be a valid South African mobile number')
    if (asString(body.alternatePhone) && !alternatePhoneFormatted) errors.push('Alternate contact number must be valid')
    if (!emergencyContactName) errors.push('Emergency contact name is required')
    if (!emergencyContactRelationship) errors.push('Emergency contact relationship is required')
    if (!emergencyPhoneFormatted) errors.push('Emergency contact number must be a valid South African mobile number')
    if (!recoveryEmail || !emailRegex.test(recoveryEmail)) errors.push('Recovery email must be valid')
    if (!addressLine1) errors.push('Address line 1 is required')
    if (!city) errors.push('City or town is required')
    if (!province || !PROVINCES.includes(province as any)) errors.push('Province selection is required')
    if (!postalCode || !/^\d{4}$/.test(postalCode)) errors.push('Postal code must be 4 digits')
    if (!country) errors.push('Country is required')
    if (!schoolName) errors.push('School or institution is required')
    if (idNumber && !/^\d{13}$/.test(idNumber)) errors.push('South African ID numbers must be 13 digits')
    if (!popiConsent) errors.push('POPIA consent must remain in place to keep an active account')

    let dateOfBirth: Date | null = null
    if (dateOfBirthInput) {
      const parsed = new Date(dateOfBirthInput)
      if (Number.isNaN(parsed.getTime())) {
        errors.push('Date of birth is invalid')
      } else {
        dateOfBirth = parsed
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validation failed', errors })
    }

    const now = new Date()
    const nextConsentTimestamp = !existing.consentToPolicies && popiConsent
      ? now
      : existing.consentTimestamp || now

    try {
      const updated = await prisma.user.update({
        where: { id: userId },
        data: {
          email,
          name: `${firstName} ${middleNames ? `${middleNames} ` : ''}${lastName}`.trim(),
          firstName,
          lastName,
          middleNames: middleNames || null,
          dateOfBirth,
          idNumber: idNumber || null,
          phoneNumber: primaryPhoneFormatted,
          alternatePhone: alternatePhoneFormatted || null,
          recoveryEmail,
          emergencyContactName,
          emergencyContactRelationship,
          emergencyContactPhone: emergencyPhoneFormatted,
          addressLine1,
          addressLine2: addressLine2 || null,
          city,
          province,
          postalCode,
          country,
          schoolName,
          avatar: avatar || null,
          consentToPolicies: true,
          consentTimestamp: nextConsentTimestamp
        }
      })

      const safeUser = {
        ...updated,
        phoneNumber: toLocalPhone(updated.phoneNumber || ''),
        alternatePhone: toLocalPhone(updated.alternatePhone || undefined),
        emergencyContactPhone: toLocalPhone(updated.emergencyContactPhone || ''),
        password: undefined
      }
      delete (safeUser as any).password
      return res.status(200).json(safeUser)
    } catch (err) {
      console.error('PUT /api/profile error', err)
      return res.status(500).json({ message: 'Server error' })
    }
  }

  res.setHeader('Allow', ['GET', 'PUT'])
  return res.status(405).end()
}
