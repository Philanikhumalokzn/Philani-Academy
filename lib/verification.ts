import crypto from 'crypto'
import prisma from './prisma'
import { sendEmail } from './mailer'

const EMAIL_KIND = 'EMAIL'
const DEFAULT_EMAIL_CODE_TTL = 1000 * 60 * 10 // 10 minutes

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function autoVerifyPhoneOnEmail() {
  return process.env.AUTO_VERIFY_PHONE_ON_EMAIL === '1'
}

function getEmailVerificationTtl(): number {
  const envValue = process.env.EMAIL_VERIFICATION_TOKEN_TTL_MS
  if (!envValue) return DEFAULT_EMAIL_CODE_TTL
  const parsed = Number(envValue)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EMAIL_CODE_TTL
}

export function isVerificationBypassed(email: string | null | undefined) {
  if (!email) return false
  const normalized = email.trim().toLowerCase()
  if (!normalized) return false
  return getAdminVerificationBypassEmails().includes(normalized)
}

function generateNumericCode(length = 6) {
  const max = 10 ** length
  const code = Math.floor(Math.random() * max).toString().padStart(length, '0')
  return code
}

async function storeEmailOtp(userId: string, code: string) {
  await (prisma as any).contactVerification.deleteMany({
    where: { userId, kind: EMAIL_KIND, consumedAt: null }
  })

  const tokenHash = hashToken(`${userId}:${code}`)
  const expiresAt = new Date(Date.now() + getEmailVerificationTtl())

  await (prisma as any).contactVerification.create({
    data: {
      userId,
      kind: EMAIL_KIND,
      tokenHash,
      expiresAt
    }
  })

  return expiresAt
}

export async function issueEmailVerification(userId: string, email: string) {
  if (!email) throw new Error('Email address is required to issue verification')
  const code = generateNumericCode(6)
  const expiresAt = await storeEmailOtp(userId, code)

  const subject = 'Philani Academy verification code'
  const text = `Hello,\n\nYour Philani Academy verification code is ${code}.\nThe code expires in ${Math.round(getEmailVerificationTtl() / 60000)} minutes.\n\nIf you did not request this, ignore this email.\n\n— Philani Academy`
  const html = `
    <p>Hello,</p>
    <p>Your Philani Academy verification code is:</p>
    <p style="margin: 24px 0; text-align: center;">
      <span style="display: inline-block; padding: 12px 24px; background: #1D4ED8; color: #ffffff; border-radius: 8px; font-size: 24px; letter-spacing: 6px; font-weight: 600;">
        ${code}
      </span>
    </p>
    <p>The code expires in ${Math.round(getEmailVerificationTtl() / 60000)} minutes.</p>
    <p>If you did not request this, you can safely ignore the email.</p>
    <p style="margin-top: 24px;">— Philani Academy</p>
  `

  await sendEmail({ to: email, subject, text, html })
  return { expiresAt }
}

export async function verifyEmailCode(email: string, code: string) {
  if (!email || !code) {
    throw new Error('Email and code are required')
  }

  const normalizedEmail = email.trim().toLowerCase()
  const trimmedCode = code.trim()
  if (!trimmedCode || trimmedCode.length < 4) {
    throw new Error('Verification code is invalid')
  }

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })
  if (!user) {
    throw new Error('Account not found for that email')
  }

  if (user.emailVerifiedAt) {
    return { userId: user.id, alreadyVerified: true }
  }

  const tokenHash = hashToken(`${user.id}:${trimmedCode}`)
  const record = await (prisma as any).contactVerification.findUnique({ where: { tokenHash } })
  if (!record || record.kind !== EMAIL_KIND) {
    throw new Error('Incorrect verification code')
  }
  if (record.consumedAt) {
    throw new Error('Verification code already used')
  }

  const now = new Date()
  if (record.expiresAt.getTime() < now.getTime()) {
    await (prisma as any).contactVerification.delete({ where: { id: record.id } })
    throw new Error('Verification code expired')
  }

  await prisma.$transaction([
    (prisma as any).contactVerification.update({
      where: { id: record.id },
      data: { consumedAt: now }
    }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: now,
        ...(autoVerifyPhoneOnEmail() ? { phoneVerifiedAt: now } : {}),
        updatedAt: now
      }
    })
  ])

  return { userId: user.id }
}

export function getAdminVerificationBypassEmails() {
  const raw = process.env.ADMIN_VERIFICATION_BYPASS_EMAILS || 'admin@philani.test'
  return raw.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
}

export function requirePhoneVerification() {
  return process.env.REQUIRE_PHONE_VERIFICATION === '1'
}
