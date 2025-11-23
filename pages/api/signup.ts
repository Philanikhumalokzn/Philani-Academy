import type { NextApiRequest, NextApiResponse } from 'next'
import bcrypt from 'bcryptjs'
import prisma from '../../lib/prisma'
import { normalizeGradeInput } from '../../lib/grades'
import { issueEmailVerification } from '../../lib/verification'

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseBoolean(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalised = value.trim().toLowerCase()
    return ['true', '1', 'yes', 'on'].includes(normalised)
  }
  return false
}

function normalisePhoneNumber(input: string) {
  const digits = input.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 10 && digits.startsWith('0')) return `+27${digits.slice(1)}`
  if (digits.length === 11 && digits.startsWith('27')) return `+${digits}`
  if (input.startsWith('+27') && digits.length === 11) return `+27${digits.slice(2)}`
  return ''
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return res.status(405).json({ message: 'Method Not Allowed' })
  }

  const body = req.body ?? {}

  const firstName = asString(body.firstName)
  const lastName = asString(body.lastName)
  const email = asString(body.email).toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''
  const gradeInput = asString(body.grade)
  const phoneInput = asString(body.phoneNumber || body.phone)
  const popiConsentAccepted = parseBoolean(body.popiConsent ?? body.consentToPolicies ?? body.termsConsent)

  const errors: string[] = []
  if (!firstName) errors.push('First name is required')
  if (!lastName) errors.push('Last name is required')
  if (!email || !emailRegex.test(email)) errors.push('Valid email is required')
  if (!password || password.length < 8) errors.push('Password must be at least 8 characters long')

  const phoneNumber = normalisePhoneNumber(phoneInput)
  if (!phoneNumber) errors.push('Valid South African phone number is required')

  if (!popiConsentAccepted) {
    errors.push('Privacy consent is required to create an account')
  }

  if (errors.length > 0) {
    return res.status(400).json({ message: 'Validation failed', errors })
  }

  try {
    const [existing, userCount] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      prisma.user.count()
    ])

    if (existing) {
      return res.status(409).json({ message: 'An account with that email already exists' })
    }

    const role = userCount === 0 ? 'admin' : 'student'
    const normalizedGrade = normalizeGradeInput(gradeInput)
    if (role !== 'admin' && !normalizedGrade) {
      return res.status(400).json({ message: 'Validation failed', errors: ['Please select a grade'] })
    }

    const hashed = await bcrypt.hash(password, 10)

    const user = await prisma.user.create({
      data: {
        name: `${firstName} ${lastName}`.trim(),
        firstName,
        lastName,
        email,
        password: hashed,
        role,
        grade: role === 'admin' ? null : normalizedGrade,
        phoneNumber,
        consentToPolicies: popiConsentAccepted,
        consentTimestamp: popiConsentAccepted ? new Date() : null,
        emailVerifiedAt: role === 'admin' ? new Date() : null,
        phoneVerifiedAt: role === 'admin' ? new Date() : null
      },
      select: { id: true, email: true }
    })

    if (role !== 'admin') {
      try {
        await issueEmailVerification(user.id, email)
      } catch (notificationErr) {
        console.error('Failed to deliver verification code after signup', notificationErr)
      }
    }

    return res.status(201).json({
      id: user.id,
      email: user.email,
      verificationRequired: role !== 'admin',
      verificationSent: role !== 'admin'
    })
  } catch (err) {
    console.error('/api/signup server error', err)
    const debug = process.env.DEBUG === '1'
    const msg = debug && err && typeof err === 'object' && 'message' in err ? (err as any).message : 'Server error'
    return res.status(500).json({ message: msg })
  }
}
