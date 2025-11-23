import { Resend } from 'resend'

// HARDCODED values for direct test (replace with your working values from resend-email-tester)
const HARDCODED_API_KEY = 'YOUR_RESEND_API_KEY_HERE'
const HARDCODED_FROM = 'Your Name <your_verified_sender@yourdomain.com>'

let resendClient: any = null
function getResendClient() {
  if (resendClient) return resendClient
  resendClient = new Resend(HARDCODED_API_KEY)
  return resendClient
}

export interface SendEmailOptions {
  to: string
  subject: string
  html: string
  text?: string
}

export async function sendEmail(options: SendEmailOptions) {
  const fromAddress = HARDCODED_FROM
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
