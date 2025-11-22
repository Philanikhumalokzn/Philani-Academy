import crypto from 'crypto'
import prisma from './prisma'
import { ContactVerificationType } from '@prisma/client'
import { sendEmail, sendSms } from './messaging'

const DEFAULT_CODE_LENGTH = Number(process.env.VERIFICATION_CODE_LENGTH || 6)
const CODE_EXPIRY_MINUTES = Number(process.env.VERIFICATION_TTL_MINUTES || 10)
const RESEND_COOLDOWN_SECONDS = Number(process.env.VERIFICATION_RESEND_COOLDOWN || 60)
const MAX_ATTEMPTS = Number(process.env.VERIFICATION_MAX_ATTEMPTS || 5)

function generateNumericCode(length: number): string {
  const digits: string[] = []
  for (let i = 0; i < length; i++) {
    const value = crypto.randomInt(0, 10)
    digits.push(value.toString())
  }
  return digits.join('')
}

function hashCode(code: string) {
  return crypto.createHash('sha256').update(code).digest('hex')
}

function asVerificationType(type: string): ContactVerificationType {
  if (type.toLowerCase() === 'email') return ContactVerificationType.EMAIL
  if (type.toLowerCase() === 'phone') return ContactVerificationType.PHONE
  throw new Error(`Unsupported verification type: ${type}`)
}

export async function issueVerificationCode(params: { userId: string, type: 'email' | 'phone', channelAddress?: string }) {
  const { userId, type } = params
  const verificationType = asVerificationType(type)
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error('User not found')

  const userRecord = user as any

  if (verificationType === ContactVerificationType.EMAIL && userRecord.emailVerifiedAt) {
    throw new Error('Email already verified')
  }
  if (verificationType === ContactVerificationType.PHONE && userRecord.phoneVerifiedAt) {
    throw new Error('Phone already verified')
  }

  const now = new Date()
  const cooldownCutoff = new Date(now.getTime() - RESEND_COOLDOWN_SECONDS * 1000)
  const contactVerificationClient = (prisma as any).contactVerification
  if (!contactVerificationClient) {
    throw new Error('Verification store is not initialised. Run prisma generate.')
  }

  const recent = await contactVerificationClient.findFirst({
    where: {
      userId,
      type: verificationType,
      createdAt: { gte: cooldownCutoff },
      consumedAt: null
    }
  })

  if (recent) {
    const remaining = RESEND_COOLDOWN_SECONDS - Math.floor((now.getTime() - recent.createdAt.getTime()) / 1000)
    const delay = remaining > 0 ? remaining : RESEND_COOLDOWN_SECONDS
    const error: any = new Error('Verification code recently sent')
    error.code = 'RATE_LIMIT'
    error.retryAfterSeconds = delay
    throw error
  }

  const code = generateNumericCode(DEFAULT_CODE_LENGTH)
  const codeHash = hashCode(code)
  const channelAddress = params.channelAddress || (verificationType === ContactVerificationType.EMAIL ? user.email : user.phoneNumber)

  if (!channelAddress) {
    throw new Error('No delivery channel available for verification code')
  }

  const expiresAt = new Date(now.getTime() + CODE_EXPIRY_MINUTES * 60 * 1000)
  const record = await contactVerificationClient.create({
    data: {
      userId,
      type: verificationType,
      channelAddress,
      codeHash,
      expiresAt
    }
  })

  try {
    if (verificationType === ContactVerificationType.EMAIL) {
      const name = user.firstName ? ` ${user.firstName}` : ''
      const text = `Hi${name.trim() ? name : ''}, your Philani Academy verification code is ${code}. It expires in ${CODE_EXPIRY_MINUTES} minutes.`
      await sendEmail({
        to: channelAddress,
        subject: 'Your Philani Academy verification code',
        text,
        html: `<p>Hi${name.trim() ? name : ''},</p><p>Your Philani Academy verification code is <strong>${code}</strong>.</p><p>This code expires in ${CODE_EXPIRY_MINUTES} minutes.</p>`
      })
    } else {
      await sendSms(channelAddress, `Your Philani Academy verification code is ${code}. This code expires in ${CODE_EXPIRY_MINUTES} minutes.`)
    }
  } catch (err) {
    await contactVerificationClient.delete({ where: { id: record.id } })
    throw err
  }

  return record
}

export async function verifyContactCode(params: { userId: string, type: 'email' | 'phone', code: string }) {
  const { userId, type } = params
  const verificationType = asVerificationType(type)
  const code = params.code.trim()
  if (!code) {
    throw new Error('Verification code required')
  }

  const contactVerificationClient = (prisma as any).contactVerification
  if (!contactVerificationClient) {
    throw new Error('Verification store is not initialised. Run prisma generate.')
  }

  const record = await contactVerificationClient.findFirst({
    where: {
      userId,
      type: verificationType,
      consumedAt: null,
      expiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: 'desc' }
  })

  if (!record) {
    throw new Error('No active verification request found')
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    throw new Error('Too many invalid attempts. Please request a new code.')
  }

  const inputHash = hashCode(code)
  if (inputHash !== record.codeHash) {
    await contactVerificationClient.update({
      where: { id: record.id },
      data: { attempts: record.attempts + 1 }
    })
    const remaining = Math.max(0, MAX_ATTEMPTS - (record.attempts + 1))
    const error: any = new Error(remaining > 0 ? `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` : 'Verification locked. Request a new code.')
    error.code = 'INVALID_CODE'
    error.remainingAttempts = remaining
    throw error
  }

  const now = new Date()
  const verificationField = verificationType === ContactVerificationType.EMAIL ? 'emailVerifiedAt' : 'phoneVerifiedAt'

  await prisma.$transaction([
    contactVerificationClient.update({
      where: { id: record.id },
      data: { consumedAt: now }
    }),
    prisma.user.update({
      where: { id: userId },
      data: {
        [verificationField]: now
      }
    }),
    contactVerificationClient.updateMany({
      where: {
        userId,
        type: verificationType,
        consumedAt: null,
        id: { not: record.id }
      },
      data: { expiresAt: now }
    })
  ])

  return { type, verifiedAt: now }
}
