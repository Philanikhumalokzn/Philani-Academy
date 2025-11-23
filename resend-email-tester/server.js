/*
 * Minimal Resend email testing server. Run with `npm install` then `npm start`.
 * Requires RESEND_API_KEY plus sender defaults in a .env file.
 */
const path = require('path')
const express = require('express')
const bodyParser = require('body-parser')
const { Resend } = require('resend')
require('dotenv').config()

const app = express()
const port = process.env.PORT || 4000

if (!process.env.RESEND_API_KEY) {
  console.warn('RESEND_API_KEY is not set. Requests will fail until you configure .env')
}

const resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

app.use(bodyParser.json())
app.use(express.static(path.join(__dirname, 'public')))

app.post('/send', async (req, res) => {
  const { to, subject, message } = req.body || {}
  const fromAddress = process.env.MAIL_FROM || 'Philani Academy <no-reply@example.com>'
  const toAddress = (to && typeof to === 'string' && to.trim()) || process.env.MAIL_TO

  if (!resendClient) {
    return res.status(500).json({ error: 'RESEND_API_KEY is missing; update .env and restart the server.' })
  }

  if (!toAddress) {
    return res.status(400).json({ error: 'Destination email is required (either in the form or MAIL_TO)' })
  }

  try {
    const response = await resendClient.emails.send({
      from: fromAddress,
      to: toAddress,
      subject: subject && subject.trim() ? subject.trim() : 'Resend Test Email',
      html:
        (message && message.trim()) ?
          `<p>${message.trim()}</p>` :
          '<p>Hello! This is a Resend test email from the Philani Academy test harness.</p>'
    })

    return res.json({ ok: true, id: response?.id || null })
  } catch (err) {
    console.error('Resend send error:', err)
    return res.status(500).json({ error: err?.message || 'Failed to send email via Resend.' })
  }
})

app.listen(port, () => {
  console.log(`Resend tester listening on http://localhost:${port}`)
})
