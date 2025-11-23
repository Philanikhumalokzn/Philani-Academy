import type { NextApiRequest, NextApiResponse } from 'next'
import { sendEmail } from '../../../lib/mailer'

const TESTER_ENABLED = process.env.ENABLE_EMAIL_TESTER === '1' || process.env.NODE_ENV !== 'production'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!TESTER_ENABLED) {
    return res.status(403).json({ message: 'Email tester is disabled' })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ message: 'Method Not Allowed' })
  }

  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : ''
  const subject = typeof req.body?.subject === 'string' && req.body.subject.trim() ? req.body.subject.trim() : 'Philani Academy test email'
  const message = typeof req.body?.message === 'string' && req.body.message.trim() ? req.body.message.trim() : 'If you received this, the Philani Academy mailer is working.'

  if (!email) {
    return res.status(400).json({ message: 'Email is required' })
  }

  try {
    const htmlMessage = message.split('\n').map((line) => `<p>${line}</p>`).join('')
    await sendEmail({
      to: email,
      subject,
      text: message,
      html: htmlMessage
    })
    return res.status(200).json({ message: 'Test email dispatched' })
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to send test email'
    return res.status(500).json({ message: errorMsg })
  }
}
