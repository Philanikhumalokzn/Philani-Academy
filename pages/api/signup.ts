import type { NextApiRequest, NextApiResponse } from 'next'
import bcrypt from 'bcryptjs'
import prisma from '../../lib/prisma'
import { GRADE_VALUES, normalizeGradeInput } from '../../lib/grades'
import { issueVerificationCode } from '../../lib/verification'

async function getRawBody(req: NextApiRequest) {
  return await new Promise<string>((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', (err) => reject(err))
  })
}

export const config = {
  api: {
    bodyParser: false,
  },
}

// Runtime debug: do not print secrets. Log whether DATABASE_URL is present and its scheme.
try {
  const dbUrl = process.env.DATABASE_URL
  if (dbUrl) {
    console.log('/api/signup runtime DB config: DATABASE_URL present, scheme=', dbUrl.split(':')[0])
  } else {
    console.log('/api/signup runtime DB config: DATABASE_URL missing')
  }
} catch (e) {
  // ignore
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS: allow requests from any origin for this API endpoint and respond to preflight
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }
  // Only accept POST (OPTIONS handled above). No public debug GET in production code.
  // DEBUG-aware behavior was used temporarily for troubleshooting and has been removed.
  if (req.method !== 'POST') return res.status(405).end()
  // Support cases where Next's body parser fails on the platform (returning "Invalid JSON").
  let body: any = req.body
  let rawBody = ''
  if (!body || typeof body !== 'object') {
    try {
      const raw = await getRawBody(req)
      rawBody = raw
      try {
        body = raw ? JSON.parse(raw) : {}
      } catch (jsonErr) {
        // Try parse as URL-encoded form (some clients/edge cases)
        try {
          const params = new URLSearchParams(raw)
          const obj: Record<string,string> = {}
          params.forEach((v,k) => { obj[k] = v })
          // If URLSearchParams produced no keys, try loose parser (handles colon-separated pairs)
          if (Object.keys(obj).length === 0) {
            body = parseLooseBody(raw)
          } else {
            body = obj
          }
        } catch (e) {
          // Robust fallback: handle loose formats like {name:Bob,email:bob@example.com}
          try {
            const loose = parseLooseBody(raw)
            body = loose
          } catch (e2) {
            console.error('Failed to parse raw body for /api/signup:', raw)
            throw jsonErr
          }
        }
      }
    } catch (err) {
      return res.status(400).json({ message: 'Invalid JSON' })
    }
  }

  // Loose body parser: accepts formats like
  // {name:Bob,email:bob@example.com} or name:Bob,email:bob@example.com or name=Bob&email=bob
  function parseLooseBody(raw: string) {
    const out: Record<string,string> = {}
    if (!raw) return out
    // remove surrounding braces
    let s = raw.trim()
    if (s.startsWith('{') && s.endsWith('}')) s = s.slice(1, -1)
    // split on commas or ampersands
    const pairs = s.split(/[,\u0026]/)
    for (const p of pairs) {
      const pair = p.trim()
      if (!pair) continue
      let idx = pair.indexOf(':')
      if (idx === -1) idx = pair.indexOf('=')
      if (idx === -1) continue
      const k = pair.slice(0, idx).trim()
      let v = pair.slice(idx + 1).trim()
      // strip quotes if any
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      out[k] = decodeURIComponent(v)
    }
    return out
  }
  const allowedGrades = GRADE_VALUES as readonly string[]
  const normalizedGrade = normalizeGradeInput(typeof body.grade === 'string' ? body.grade : undefined)

  if ((!body.email || !body.password) && rawBody) {
    try {
      const emailMatch = rawBody.match(/email\s*[:=]\s*['"]?([^,'"\s\}]+)/i)
      const passMatch = rawBody.match(/password\s*[:=]\s*['"]?([^,'"\s\}]+)/i)
      const firstMatch = rawBody.match(/first[name\s]*[:=]\s*['"]?([^,'"\s\}]+)/i)
      const lastMatch = rawBody.match(/last[name\s]*[:=]\s*['"]?([^,'"\s\}]+)/i)
      if (emailMatch && emailMatch[1]) body.email = decodeURIComponent(emailMatch[1])
      if (passMatch && passMatch[1]) body.password = decodeURIComponent(passMatch[1])
      if (firstMatch && firstMatch[1] && !body.firstName) body.firstName = decodeURIComponent(firstMatch[1])
      if (lastMatch && lastMatch[1] && !body.lastName) body.lastName = decodeURIComponent(lastMatch[1])
    } catch (fallbackErr) {
      // ignore fallback parsing errors
    }
  }

  const asString = (value: any) => (typeof value === 'string' ? value.trim() : '')
  const toBoolean = (value: any) => {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      const normalised = value.trim().toLowerCase()
      return ['true', '1', 'yes', 'on'].includes(normalised)
    }
    return false
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const postalCodeRegex = /^\d{4}$/
  const idNumberRegex = /^\d{13}$/
  const provinceOptions = [
    'Eastern Cape',
    'Free State',
    'Gauteng',
    'KwaZulu-Natal',
    'Limpopo',
    'Mpumalanga',
    'Northern Cape',
    'North West',
    'Western Cape'
  ]

  const fallbackName = asString(body.name)
  let firstName = asString(body.firstName)
  let lastName = asString(body.lastName)
  const middleNames = asString(body.middleNames)
  if ((!firstName || !lastName) && fallbackName) {
    const parts = fallbackName.split(/\s+/).filter(Boolean)
    if (!firstName && parts.length > 0) firstName = parts.shift() || ''
    if (!lastName && parts.length > 0) lastName = parts.join(' ')
  }

  const email = asString(body.email).toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''
  const recoveryEmailRaw = asString(body.recoveryEmail)
  const recoveryEmail = recoveryEmailRaw ? recoveryEmailRaw.toLowerCase() : ''

  const phoneRaw = asString(body.phoneNumber || body.phone)
  const alternatePhoneRaw = asString(body.alternatePhone)
  const emergencyPhoneRaw = asString(body.emergencyContactPhone || body.emergencyPhone)

  function normalisePhone(input: string) {
    if (!input) return ''
    const digits = input.replace(/\D/g, '')
    if (digits.length === 10 && digits.startsWith('0')) {
      return `+27${digits.slice(1)}`
    }
    if (digits.length === 11 && digits.startsWith('27')) {
      return `+${digits}`
    }
    if (input.startsWith('+27') && digits.length === 11) {
      return `+27${digits.slice(2)}`
    }
    return ''
  }

  const phoneNumber = normalisePhone(phoneRaw)
  const alternatePhone = alternatePhoneRaw ? normalisePhone(alternatePhoneRaw) : ''
  const emergencyContactPhone = normalisePhone(emergencyPhoneRaw)

  const emergencyContactName = asString(body.emergencyContactName)
  const emergencyContactRelationship = asString(body.emergencyContactRelationship)

  const addressLine1 = asString(body.addressLine1)
  const addressLine2 = asString(body.addressLine2)
  const city = asString(body.city)
  const province = asString(body.province)
  const postalCode = asString(body.postalCode)
  const country = asString(body.country) || 'South Africa'
  const schoolName = asString(body.schoolName)
  const idNumber = asString(body.idNumber).replace(/\D/g, '')
  const dateOfBirthInput = asString(body.dateOfBirth)
  const popiConsent = toBoolean(body.popiConsent ?? body.consentToPolicies ?? body.termsConsent)

  const errors: string[] = []

  if (!firstName) errors.push('First name is required')
  if (!lastName) errors.push('Last name is required')
  if (!email || !emailRegex.test(email)) errors.push('Valid email address is required')
  if (!password || password.length < 8) errors.push('Password must be at least 8 characters long')
  if (!phoneNumber) errors.push('Valid South African contact number is required (e.g. 0XXXXXXXXX)')
  if (alternatePhoneRaw && !alternatePhone) errors.push('Alternate contact number must be a valid South African number')
  if (!emergencyContactName) errors.push('Emergency contact name is required')
  if (!emergencyContactRelationship) errors.push('Emergency contact relationship is required')
  if (!emergencyContactPhone) errors.push('Emergency contact number is required and must be South African')
  if (!recoveryEmail || !emailRegex.test(recoveryEmail)) errors.push('Valid recovery email is required')
  if (!addressLine1) errors.push('Address line 1 is required')
  if (!city) errors.push('City or town is required')
  if (!province || !provinceOptions.includes(province)) errors.push('Province selection is required')
  if (!postalCode || !postalCodeRegex.test(postalCode)) errors.push('Postal code must be a 4-digit South African code')
  if (!country) errors.push('Country is required')
  if (!schoolName) errors.push('Current school or institution is required')
  if (idNumber && !idNumberRegex.test(idNumber)) errors.push('South African ID numbers must be 13 digits')
  if (!popiConsent) errors.push('You must consent to the POPIA-compliant policy to create an account')

  let dateOfBirth: Date | null = null
  if (!dateOfBirthInput) {
    errors.push('Date of birth is required')
  } else {
    const parsed = new Date(dateOfBirthInput)
    if (Number.isNaN(parsed.getTime())) {
      errors.push('Date of birth is invalid')
    } else {
      const today = new Date()
      if (parsed > today) {
        errors.push('Date of birth cannot be in the future')
      } else {
        const age = today.getFullYear() - parsed.getFullYear() - ((today.getMonth() < parsed.getMonth() || (today.getMonth() === parsed.getMonth() && today.getDate() < parsed.getDate())) ? 1 : 0)
        if (age < 5) errors.push('Learners must be at least 5 years old to register')
        if (age > 120) errors.push('Date of birth appears incorrect')
      }
      dateOfBirth = parsed
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({ message: 'Validation failed', errors })
  }

  // After validation, ensure grade requirements for learners
  try {
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return res.status(409).json({ message: 'User exists' })

    const hashed = await bcrypt.hash(password, 10)
    // If first user, make them admin
    const count = await prisma.user.count()
    const role = count === 0 ? 'admin' : 'student'
    if (role !== 'admin') {
      if (!normalizedGrade || !allowedGrades.includes(normalizedGrade)) {
        return res.status(400).json({ message: 'Grade is required for learners' })
      }
    }

    const gradeValue = role === 'admin' ? null : (normalizedGrade as any)

    const now = new Date()
    let user
    try {
      user = await prisma.user.create({
      data: {
        name: `${firstName} ${middleNames ? `${middleNames} ` : ''}${lastName}`.trim(),
        firstName,
        lastName,
        middleNames: middleNames || null,
        email,
        password: hashed,
        role,
        grade: gradeValue,
        avatar: null,
        dateOfBirth,
        phoneNumber,
        alternatePhone: alternatePhone || null,
        recoveryEmail,
        emergencyContactName,
        emergencyContactRelationship: emergencyContactRelationship || null,
        emergencyContactPhone,
        addressLine1,
        addressLine2: addressLine2 || null,
        city,
        province,
        postalCode,
        country,
        schoolName,
        idNumber: idNumber || null,
        consentToPolicies: true,
        consentTimestamp: now
      } as any
      })

      await issueVerificationCode({ userId: user.id, type: 'email' })
      await issueVerificationCode({ userId: user.id, type: 'phone' })
    } catch (verificationError) {
      if (user) {
        try {
          await prisma.user.delete({ where: { id: user.id } })
        } catch (cleanupErr) {
          console.error('/api/signup cleanup failed after verification error', cleanupErr)
        }
      }
      throw verificationError
    }

    return res.status(201).json({
      userId: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      requiresVerification: true,
      message: 'Verification codes sent to your email and phone number. Please confirm both to activate your account.'
    })
  } catch (err) {
    // Log full error server-side always (masked in production logs if necessary)
    console.error('/api/signup server error', err)
    // When DEBUG=1 expose a helpful message in the JSON body to aid diagnosis.
    const debug = process.env.DEBUG === '1'
    let msg = 'Server error'
    if (err && typeof err === 'object' && 'message' in err) {
      const message = String((err as any).message)
      if (/verification/i.test(message) && !debug) {
        msg = 'Unable to send verification codes. Please try again shortly.'
      } else if (debug) {
        msg = message
      } else {
        msg = 'Server error'
      }
    }
    return res.status(500).json({ message: msg })
  }
}
