import crypto from 'crypto'
import prisma from './prisma'
import { sendEmailVerification } from './mailer'

const DEFAULT_EMAIL_TOKEN_TTL = 1000 * 60 * 60 * 24 // 24 hours
const TOKEN_LENGTH_BYTES = 32
const EMAIL_KIND = 'EMAIL'

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function autoVerifyPhoneOnEmail() {
  return process.env.AUTO_VERIFY_PHONE_ON_EMAIL === '1'
}

function getEmailVerificationTtl(): number {
  const envValue = process.env.EMAIL_VERIFICATION_TOKEN_TTL_MS
  if (!envValue) return DEFAULT_EMAIL_TOKEN_TTL
  const parsed = Number(envValue)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EMAIL_TOKEN_TTL
}

export function getVerificationBaseUrl() {
  return (
    process.env.APP_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3000'
  )
}

export function buildEmailVerificationUrl(token: string) {
  const base = getVerificationBaseUrl().replace(/\/$/, '')
  return `${base}/verify-email?token=${encodeURIComponent(token)}`
}

export function isVerificationBypassed(email: string | null | undefined) {
  if (!email) return false
  const normalized = email.trim().toLowerCase()
  if (!normalized) return false
  return getAdminVerificationBypassEmails().includes(normalized)
}

export async function createEmailVerification(userId: string) {
  await (prisma as any).contactVerification.deleteMany({
    where: {
      userId,
      kind: EMAIL_KIND,
      consumedAt: null
    }
  })

  const token = crypto.randomBytes(TOKEN_LENGTH_BYTES).toString('hex')
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + getEmailVerificationTtl())

  await (prisma as any).contactVerification.create({
    data: {
      userId,
      kind: EMAIL_KIND,
      tokenHash,
      expiresAt
    }
  })

  return { token, expiresAt }
}

export async function issueEmailVerification(userId: string, email: string) {
  const { token, expiresAt } = await createEmailVerification(userId)
  const verificationUrl = buildEmailVerificationUrl(token)
  await sendEmailVerification(email, verificationUrl)
  return { expiresAt }
}

export async function consumeEmailVerification(token: string) {
  if (!token) {
    throw new Error('Missing verification token')
  }
  const tokenHash = hashToken(token)
  const record = await (prisma as any).contactVerification.findUnique({
    where: { tokenHash }
  })
  if (!record || record.kind !== EMAIL_KIND) {
    throw new Error('Invalid or unknown verification token')
  }
  if (record.consumedAt) {
    throw new Error('Verification token already used')
  }
  const now = new Date()
  if (record.expiresAt.getTime() < now.getTime()) {
    await (prisma as any).contactVerification.delete({ where: { id: record.id } })
    throw new Error('Verification token expired')
  }

  await prisma.$transaction([
    (prisma as any).contactVerification.update({
      where: { id: record.id },
      data: { consumedAt: now }
    }),
    prisma.user.update({
      where: { id: record.userId },
      data: {
        emailVerifiedAt: now,
        ...(autoVerifyPhoneOnEmail() ? { phoneVerifiedAt: now } : {}),
        updatedAt: now
      }
    })
  ])

  return { userId: record.userId }
}

export function getAdminVerificationBypassEmails() {
  const raw = process.env.ADMIN_VERIFICATION_BYPASS_EMAILS || 'admin@philani.test'
  return raw.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
}

export function requirePhoneVerification() {
  return process.env.REQUIRE_PHONE_VERIFICATION === '1'
}
