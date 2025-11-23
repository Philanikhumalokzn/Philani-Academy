import { Resend } from 'resend'

const DEFAULT_FROM = process.env.MAIL_FROM_ADDRESS || 'Philani Academy <no-reply@philaniacademy.org>'

function logFallback(payload: { email: string; subject: string; text: string; html: string }) {
  console.info('[mail:dev] Email dispatch (fallback)', payload)
}

let resendClient: Resend | null = null

function getResendClient() {
  if (resendClient) return resendClient
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is required to send email via Resend')
  }
  resendClient = new Resend(apiKey)
  return resendClient
}

export interface SendEmailOptions {
  to: string
  subject: string
  text: string
  html: string
}

export async function sendEmail(options: SendEmailOptions) {
  const payload = {
    from: DEFAULT_FROM,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html
  }

  if (!options.to) {
    throw new Error('Destination email address is required')
  }

  if (!process.env.RESEND_API_KEY) {
    logFallback({ email: payload.to, subject: payload.subject, text: payload.text, html: payload.html })
    return { fallback: true }
  }

  try {
    const client = getResendClient()
    const response = await client.emails.send(payload)
    return response
  } catch (err) {
    console.error('Resend email send failed', err)
    logFallback({ email: payload.to, subject: payload.subject, text: payload.text, html: payload.html })
    throw err
  }
}

export async function sendEmailVerification(email: string, verificationUrl: string) {
  if (!email || !verificationUrl) {
    throw new Error('Missing email verification payload')
  }

  const text = `Hello,\n\nThanks for joining Philani Academy. Confirm your email by visiting ${verificationUrl}\n\nIf you did not sign up, ignore this email.\n\n— Philani Academy`

  const html = `
    <p>Hello,</p>
    <p>Thanks for joining Philani Academy. Confirm your email address by clicking the button below.</p>
    <p style="margin: 24px 0; text-align: center;">
      <a href="${verificationUrl}" style="display: inline-block; padding: 12px 20px; background: #1D4ED8; color: #ffffff; border-radius: 6px; text-decoration: none;">
        Verify email address
      </a>
    </p>
    <p>If the button does not work, copy and paste this link into your browser:</p>
    <p><a href="${verificationUrl}">${verificationUrl}</a></p>
    <p style="margin-top: 24px;">— Philani Academy</p>
  `

  await sendEmail({
    to: email,
    subject: 'Verify your Philani Academy email',
    text,
    html
  })
}

export function getDefaultFromAddress() {
  return DEFAULT_FROM
}
