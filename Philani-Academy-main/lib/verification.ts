import crypto from 'crypto'
import prisma from './prisma'
import { sendEmail, getPublicAssetUrl } from './mailer'

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
  const logoUrl = getPublicAssetUrl('/philani-logo.png')
  const html = `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#040b1d;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="background:#ffffff;border-radius:24px;padding:32px; font-family: 'Inter', Arial, sans-serif; color:#0f172a;">
            <tr>
              <td align="center" style="padding-bottom:12px;">
                <img src="${logoUrl}" alt="Philani Academy" height="60" style="display:inline-block;height:60px;width:auto;" />
              </td>
            </tr>
            <tr>
              <td style="text-align:center;">
                <p style="text-transform:uppercase;letter-spacing:0.35em;font-size:11px;margin:0;color:#475569;">Verification</p>
                <h1 style="margin:12px 0 0;font-size:26px;color:#0f172a;">Hello!</h1>
                <p style="margin:12px 0 24px;font-size:15px;color:#334155;">Use the code below to finish signing in to Philani Academy.</p>
                <div style="display:inline-block;padding:16px 28px;border-radius:16px;background:#1d4ed8;color:#ffffff;font-size:28px;letter-spacing:8px;font-weight:700;">
                  ${code}
                </div>
                <p style="margin:24px 0 0;font-size:14px;color:#475569;">This code expires in ${Math.round(getEmailVerificationTtl() / 60000)} minutes.</p>
                <p style="margin:12px 0 0;font-size:14px;color:#475569;">Ignore this email if you didn't try to sign in.</p>
              </td>
            </tr>
            <tr>
              <td style="padding-top:32px;text-align:center;font-size:12px;color:#94a3b8;">— Philani Academy</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
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
