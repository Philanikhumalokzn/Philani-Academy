import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserIdFromReq } from '../../../lib/auth'
import { issueEmailVerification, isVerificationBypassed } from '../../../lib/verification'

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

function titleCaseName(value: string) {
  const cleaned = value.trim()
  if (!cleaned) return ''
  return cleaned
    .split(/\s+/)
    .map(word => word
      .split(/([-'])/)
      .map(part => {
        if (!part || part === '-' || part === "'") return part
        return `${part.charAt(0).toUpperCase()}${part.slice(1)}`
      })
      .join('')
    )
    .join(' ')
}

function normalizeNameField(value: unknown) {
  const raw = asString(value)
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  const stripped = collapsed.replace(/[^\p{L}\s'-]/gu, '')
  const trimmed = stripped.replace(/^[-']+|[-']+$/g, '').replace(/\s+/g, ' ').trim()
  const valid = trimmed ? /^[\p{L}]+([\s'-][\p{L}]+)*$/u.test(trimmed) : false
  const changed = trimmed !== collapsed
  return { raw: collapsed, value: trimmed, valid, changed }
}

function hasKey(obj: any, key: string) {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, key)
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
        profileCoverUrl: true,
        profileThemeBgUrl: true,
        statusBio: true,
        uiHandedness: true,
        profileVisibility: true,
        discoverabilityScope: true,
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

    const errors: string[] = []
    const data: any = {}
    let emailChanged = false
    let nextEmail = existing.email

    const firstNameInput = hasKey(body, 'firstName') ? normalizeNameField(body.firstName) : null
    const lastNameInput = hasKey(body, 'lastName') ? normalizeNameField(body.lastName) : null
    const middleNamesInput = hasKey(body, 'middleNames') ? normalizeNameField(body.middleNames) : null

    if (firstNameInput) {
      if (!firstNameInput.value) errors.push('First name is required')
      if (firstNameInput.raw && (!firstNameInput.valid || firstNameInput.changed)) {
        errors.push('First name contains invalid characters or spacing')
      }
    }
    if (lastNameInput) {
      if (!lastNameInput.value) errors.push('Last name is required')
      if (lastNameInput.raw && (!lastNameInput.valid || lastNameInput.changed)) {
        errors.push('Last name contains invalid characters or spacing')
      }
    }
    if (middleNamesInput?.raw && (!middleNamesInput.valid || middleNamesInput.changed)) {
      errors.push('Middle names contain invalid characters or spacing')
    }

    const nextFirstName = firstNameInput ? titleCaseName(firstNameInput.value) : existing.firstName
    const nextLastName = lastNameInput ? titleCaseName(lastNameInput.value) : existing.lastName
    const nextMiddleNames = middleNamesInput
      ? titleCaseName(middleNamesInput.value)
      : (existing.middleNames || '')
    const nextDisplayName = `${nextFirstName} ${nextMiddleNames ? `${nextMiddleNames} ` : ''}${nextLastName}`.trim()

    if (hasKey(body, 'firstName')) data.firstName = nextFirstName
    if (hasKey(body, 'lastName')) data.lastName = nextLastName
    if (hasKey(body, 'middleNames')) data.middleNames = nextMiddleNames || null
    if (hasKey(body, 'firstName') || hasKey(body, 'lastName') || hasKey(body, 'middleNames')) {
      data.name = nextDisplayName
    }

    if (hasKey(body, 'dateOfBirth')) {
      const dateOfBirthInput = asString(body.dateOfBirth)
      if (!dateOfBirthInput) {
        data.dateOfBirth = null
      } else {
        const parsed = new Date(dateOfBirthInput)
        if (Number.isNaN(parsed.getTime())) {
          errors.push('Date of birth is invalid')
        } else {
          data.dateOfBirth = parsed
        }
      }
    }

    if (hasKey(body, 'idNumber')) {
      const idNumber = asString(body.idNumber).replace(/\D/g, '')
      if (idNumber && !/^\d{13}$/.test(idNumber)) errors.push('South African ID numbers must be 13 digits')
      data.idNumber = idNumber || null
    }

    if (hasKey(body, 'email')) {
      const email = asString(body.email).toLowerCase()
      if (!email || !emailRegex.test(email)) {
        errors.push('Valid email is required')
      } else if (email !== existing.email) {
        nextEmail = email
        emailChanged = true
        data.email = email
        data.emailVerifiedAt = null
      }
    }

    if (hasKey(body, 'recoveryEmail')) {
      const recoveryEmail = asString(body.recoveryEmail).toLowerCase()
      if (recoveryEmail && !emailRegex.test(recoveryEmail)) errors.push('Recovery email must be valid')
      data.recoveryEmail = recoveryEmail || null
    }

    if (hasKey(body, 'phoneNumber') || hasKey(body, 'phone')) {
      const localPhone = asString(body.phoneNumber) || asString(body.phone)
      if (!localPhone) {
        data.phoneNumber = ''
      } else {
        const formatted = normalisePhone(localPhone)
        if (!formatted) errors.push('Primary contact number must be a valid South African mobile number')
        else data.phoneNumber = formatted
      }
    }

    if (hasKey(body, 'alternatePhone')) {
      const localAlt = asString(body.alternatePhone)
      if (!localAlt) {
        data.alternatePhone = null
      } else {
        const formattedAlt = normalisePhone(localAlt)
        if (!formattedAlt) errors.push('Alternate contact number must be valid')
        else data.alternatePhone = formattedAlt
      }
    }

    if (hasKey(body, 'emergencyContactName')) data.emergencyContactName = asString(body.emergencyContactName)
    if (hasKey(body, 'emergencyContactRelationship')) {
      const rel = asString(body.emergencyContactRelationship)
      data.emergencyContactRelationship = rel || null
    }

    if (hasKey(body, 'emergencyContactPhone') || hasKey(body, 'emergencyPhone')) {
      const localEmergency = asString(body.emergencyContactPhone) || asString(body.emergencyPhone)
      if (!localEmergency) {
        data.emergencyContactPhone = ''
      } else {
        const formattedEmergency = normalisePhone(localEmergency)
        if (!formattedEmergency) errors.push('Emergency contact number must be a valid South African mobile number')
        else data.emergencyContactPhone = formattedEmergency
      }
    }

    if (hasKey(body, 'addressLine1')) data.addressLine1 = asString(body.addressLine1)
    if (hasKey(body, 'addressLine2')) {
      const addr2 = asString(body.addressLine2)
      data.addressLine2 = addr2 || null
    }
    if (hasKey(body, 'city')) data.city = asString(body.city)
    if (hasKey(body, 'province')) {
      const province = asString(body.province)
      if (province && !PROVINCES.includes(province as any)) errors.push('Province selection is invalid')
      data.province = province
    }
    if (hasKey(body, 'postalCode')) {
      const postalCode = asString(body.postalCode)
      if (postalCode && !/^\d{4}$/.test(postalCode)) errors.push('Postal code must be 4 digits')
      data.postalCode = postalCode
    }
    if (hasKey(body, 'country')) data.country = asString(body.country)
    if (hasKey(body, 'schoolName')) data.schoolName = asString(body.schoolName)
    if (hasKey(body, 'avatar')) {
      const avatar = asString(body.avatar)
      data.avatar = avatar ? avatar : null
    }

    if (hasKey(body, 'profileCoverUrl')) {
      const v = asString((body as any).profileCoverUrl)
      data.profileCoverUrl = v ? v : null
    }

    if (hasKey(body, 'profileThemeBgUrl')) {
      const v = asString((body as any).profileThemeBgUrl)
      data.profileThemeBgUrl = v ? v : null
    }

    if (hasKey(body, 'statusBio')) {
      const statusBioRaw = asString(body.statusBio)
      if (statusBioRaw.length > 100) {
        errors.push('Status/bio must be 100 characters or less')
      } else {
        data.statusBio = statusBioRaw ? statusBioRaw : null
      }
    }

    if (hasKey(body, 'profileVisibility')) {
      const raw = asString(body.profileVisibility).toLowerCase()
      const allowed = new Set(['shared', 'private', 'discoverable'])
      if (!raw || !allowed.has(raw)) {
        errors.push('Profile visibility must be shared, discoverable, or private')
      } else {
        data.profileVisibility = raw
      }
    }

    if (hasKey(body, 'discoverabilityScope')) {
      const raw = asString((body as any).discoverabilityScope).toLowerCase()
      const allowed = new Set(['grade', 'school', 'province', 'global'])
      if (!raw || !allowed.has(raw)) {
        errors.push('Discoverability scope must be grade, school, province, or global')
      } else {
        data.discoverabilityScope = raw
      }
    }

    if (hasKey(body, 'uiHandedness')) {
      const raw = asString(body.uiHandedness).toLowerCase()
      const allowed = new Set(['left', 'right'])
      if (!raw || !allowed.has(raw)) {
        errors.push('Handedness must be left or right')
      } else {
        data.uiHandedness = raw
      }
    }

    const hasConsentKey = hasKey(body, 'popiConsent') || hasKey(body, 'consentToPolicies') || hasKey(body, 'termsConsent')
    if (hasConsentKey) {
      const popiConsent = toBoolean(body.popiConsent ?? body.consentToPolicies ?? body.termsConsent)
      if (popiConsent && !existing.consentToPolicies) {
        const now = new Date()
        data.consentToPolicies = true
        data.consentTimestamp = now
      }
      // If popiConsent is false, ignore (do not block saving other sections).
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validation failed', errors })
    }

    // No-op updates should still return the current profile.
    if (Object.keys(data).length === 0) {
      return res.status(200).json({
        ...existing,
        phoneNumber: toLocalPhone(existing.phoneNumber),
        alternatePhone: toLocalPhone(existing.alternatePhone),
        emergencyContactPhone: toLocalPhone(existing.emergencyContactPhone),
        password: undefined
      })
    }

    try {
      const updated = await prisma.user.update({
        where: { id: userId },
        data
      })

      let emailVerificationRequired = false
      if (emailChanged && nextEmail && !isVerificationBypassed(nextEmail)) {
        emailVerificationRequired = true
        try {
          await issueEmailVerification(userId, nextEmail)
        } catch (verificationErr) {
          console.error('Failed to issue email verification after email change', verificationErr)
          // Do not fail the save; user can still use resend-verification.
        }
      }

      const safeUser = {
        ...updated,
        phoneNumber: toLocalPhone(updated.phoneNumber || ''),
        alternatePhone: toLocalPhone(updated.alternatePhone || undefined),
        emergencyContactPhone: toLocalPhone(updated.emergencyContactPhone || ''),
        emailVerificationRequired,
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
