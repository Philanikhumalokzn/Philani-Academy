import { Resend } from 'resend'

const DEFAULT_FROM = process.env.MAIL_FROM_ADDRESS || process.env.MAIL_FROM || 'Philani Academy <no-reply@philaniacademy.org>'

function resolveBaseUrl() {
  const explicit = process.env.EMAIL_BRAND_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL
  if (explicit) return explicit.trim().replace(/\/$/, '')
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`.trim().replace(/\/$/, '')
  }
  return 'https://philaniacademy.org'
}

const SITE_BASE_URL = resolveBaseUrl()

export function getSiteBaseUrl() {
  return SITE_BASE_URL
}

export function getPublicAssetUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${SITE_BASE_URL}${normalizedPath}`
}

let resendClient: any = null
function getResendClient() {
  if (resendClient) return resendClient
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set. Cannot send email.')
  }
  resendClient = new Resend(apiKey)
  return resendClient
}

export interface SendEmailOptions {
  to: string
  subject: string
  html: string
  text?: string
}

export async function sendEmail(options: SendEmailOptions) {
  const fromAddress = DEFAULT_FROM
  const toAddress = (options.to && typeof options.to === 'string' && options.to.trim())
  if (!toAddress) {
    throw new Error('Destination email is required')
  }
  const subject = options.subject && options.subject.trim() ? options.subject.trim() : 'Philani Academy email'
  const html = options.html && options.html.trim() ? options.html.trim() : '<p>Hello! This is a Philani Academy email.</p>'
  const text = options.text && options.text.trim() ? options.text.trim() : undefined

  const client = getResendClient()
  try {
    const response = await client.emails.send({
      from: fromAddress,
      to: toAddress,
      subject,
      html,
      ...(text ? { text } : {})
    })
    return response
  } catch (err: any) {
    console.error('Resend send error:', err)
    throw new Error(err?.message || 'Failed to send email via Resend.')
  }
}
