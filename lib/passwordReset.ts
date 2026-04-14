import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import prisma from './prisma'
import { getPublicAssetUrl, getSiteBaseUrl, sendEmail } from './mailer'

const PASSWORD_RESET_KIND = 'PASSWORD_RESET'
const DEFAULT_PASSWORD_RESET_TTL = 1000 * 60 * 30

function getPasswordResetTtl() {
  const raw = process.env.PASSWORD_RESET_TOKEN_TTL_MS
  if (!raw) return DEFAULT_PASSWORD_RESET_TTL
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PASSWORD_RESET_TTL
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function generateResetToken() {
  return crypto.randomBytes(32).toString('hex')
}

function getExpiryMinutes() {
  return Math.max(1, Math.round(getPasswordResetTtl() / 60000))
}

async function clearOutstandingPasswordResetTokens(userId: string) {
  await (prisma as any).contactVerification.deleteMany({
    where: {
      userId,
      kind: PASSWORD_RESET_KIND,
      consumedAt: null,
    },
  })
}

export async function issuePasswordReset(emailInput: string) {
  const email = String(emailInput || '').trim().toLowerCase()
  if (!email) return

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, firstName: true, name: true, email: true },
  })

  if (!user) return

  await clearOutstandingPasswordResetTokens(user.id)

  const token = generateResetToken()
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + getPasswordResetTtl())

  await (prisma as any).contactVerification.create({
    data: {
      userId: user.id,
      kind: PASSWORD_RESET_KIND,
      tokenHash,
      expiresAt,
    },
  })

  const resetUrl = `${getSiteBaseUrl()}/auth/reset-password?token=${encodeURIComponent(token)}`
  const displayName = String(user.firstName || user.name || 'there').trim() || 'there'
  const subject = 'Reset your Philani Academy password'
  const text = `Hello ${displayName},\n\nWe received a request to reset your Philani Academy password.\n\nOpen this link to choose a new password:\n${resetUrl}\n\nThis link expires in ${getExpiryMinutes()} minutes. If you did not request a reset, you can ignore this email.\n\n- Philani Academy`
  const logoUrl = getPublicAssetUrl('/philani-logo.png')
  const html = `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#040b1d;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="background:#ffffff;border-radius:24px;padding:32px;font-family:'Inter',Arial,sans-serif;color:#0f172a;">
            <tr>
              <td align="center" style="padding-bottom:12px;">
                <img src="${logoUrl}" alt="Philani Academy" height="60" style="display:inline-block;height:60px;width:auto;" />
              </td>
            </tr>
            <tr>
              <td style="text-align:center;">
                <p style="text-transform:uppercase;letter-spacing:0.35em;font-size:11px;margin:0;color:#475569;">Password Reset</p>
                <h1 style="margin:12px 0 0;font-size:26px;color:#0f172a;">Hello ${displayName}!</h1>
                <p style="margin:12px 0 24px;font-size:15px;color:#334155;">Use the button below to choose a new password for your Philani Academy account.</p>
                <a href="${resetUrl}" style="display:inline-block;padding:16px 28px;border-radius:999px;background:#1d4ed8;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">Reset password</a>
                <p style="margin:24px 0 0;font-size:14px;color:#475569;">This link expires in ${getExpiryMinutes()} minutes.</p>
                <p style="margin:12px 0 0;font-size:14px;color:#475569;word-break:break-all;">If the button does not work, paste this into your browser:<br /><a href="${resetUrl}" style="color:#1d4ed8;">${resetUrl}</a></p>
                <p style="margin:12px 0 0;font-size:14px;color:#475569;">If you did not request a reset, you can ignore this email.</p>
              </td>
            </tr>
            <tr>
              <td style="padding-top:32px;text-align:center;font-size:12px;color:#94a3b8;">- Philani Academy</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `

  await sendEmail({ to: email, subject, text, html })
}

export async function validatePasswordResetToken(tokenInput: string) {
  const token = String(tokenInput || '').trim()
  if (!token) {
    throw new Error('Reset link is invalid.')
  }

  const tokenHash = hashToken(token)
  const record = await (prisma as any).contactVerification.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, email: true, firstName: true, name: true } } },
  })

  if (!record || record.kind !== PASSWORD_RESET_KIND) {
    throw new Error('Reset link is invalid.')
  }
  if (record.consumedAt) {
    throw new Error('Reset link has already been used.')
  }

  const now = Date.now()
  if (new Date(record.expiresAt).getTime() < now) {
    await (prisma as any).contactVerification.delete({ where: { id: record.id } })
    throw new Error('Reset link has expired.')
  }

  return {
    recordId: String(record.id),
    userId: String(record.userId),
    email: String(record.user?.email || '').trim().toLowerCase(),
    firstName: String(record.user?.firstName || record.user?.name || '').trim() || null,
    expiresAt: record.expiresAt as Date,
  }
}

export async function resetPasswordWithToken(tokenInput: string, newPassword: string) {
  const trimmedPassword = String(newPassword || '')
  if (trimmedPassword.length < 8) {
    throw new Error('Password must be at least 8 characters long.')
  }

  const validation = await validatePasswordResetToken(tokenInput)
  const now = new Date()
  const hashed = await bcrypt.hash(trimmedPassword, 10)

  await prisma.$transaction([
    (prisma as any).contactVerification.update({
      where: { id: validation.recordId },
      data: { consumedAt: now },
    }),
    (prisma as any).contactVerification.deleteMany({
      where: {
        userId: validation.userId,
        kind: PASSWORD_RESET_KIND,
        consumedAt: null,
        id: { not: validation.recordId },
      },
    }),
    prisma.user.update({
      where: { id: validation.userId },
      data: { password: hashed, updatedAt: now },
    }),
  ])

  return { email: validation.email }
}