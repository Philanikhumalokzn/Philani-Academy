import nodemailer, { Transporter } from 'nodemailer'

export interface EmailPayload {
  to: string
  subject: string
  text: string
  html?: string
  from?: string
}

let cachedTransporter: Transporter | null = null

function buildTransporter(): Transporter | null {
  if (cachedTransporter) return cachedTransporter

  const smtpUrl = process.env.SMTP_URL || process.env.EMAIL_SERVER
  if (smtpUrl) {
    cachedTransporter = nodemailer.createTransport(smtpUrl)
    return cachedTransporter
  }

  const host = process.env.SMTP_HOST
  const portRaw = process.env.SMTP_PORT
  if (host && portRaw) {
    const port = Number(portRaw)
    const secure = port === 465
    cachedTransporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: process.env.SMTP_USER && process.env.SMTP_PASS ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      } : undefined
    })
    return cachedTransporter
  }

  return null
}

export async function sendEmail(payload: EmailPayload) {
  const transporter = buildTransporter()
  const from = payload.from || process.env.SMTP_FROM || process.env.EMAIL_FROM || 'no-reply@philani.academy'

  if (!transporter) {
    console.warn('[messaging] SMTP configuration missing, email will be logged locally.')
    console.log(`[email] to=${payload.to} subject="${payload.subject}" text="${payload.text}"`)
    return { queued: false, simulated: true }
  }

  try {
    await transporter.sendMail({
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      from
    })
  } catch (err) {
    console.error('[messaging] Failed to send transactional email:', err)
    throw err
  }
  return { queued: true, simulated: false }
}

export interface SmsResult {
  delivered: boolean
  simulated: boolean
}

export async function sendSms(to: string, message: string): Promise<SmsResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER

  if (!accountSid || !authToken || !from) {
    console.warn('[messaging] Twilio configuration missing, SMS will be logged locally.')
    console.log(`[sms] to=${to} message="${message}")`)
    return { delivered: false, simulated: true }
  }

  const body = new URLSearchParams({
    To: to,
    From: from,
    Body: message
  })

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to send SMS: ${text}`)
  }

  return { delivered: true, simulated: false }
}
