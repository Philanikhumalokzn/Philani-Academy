// --- HARDCODED resend-email-tester logic ---
const { Resend } = require('resend')

// Copy your working values from resend-email-tester/.env here:
const API_KEY = 'YOUR_RESEND_API_KEY_HERE'
const FROM = 'Your Name <your_verified_sender@yourdomain.com>'

const resendClient = new Resend(API_KEY)

/**
 * Send an email using the exact resend-email-tester logic.
 * @param {Object} options
 * @param {string} options.to
 * @param {string} options.subject
 * @param {string} options.html
 * @param {string} [options.text]
 */
async function sendEmail({ to, subject, html, text }) {
  if (!to) throw new Error('Destination email is required')
  try {
    const response = await resendClient.emails.send({
      from: FROM,
      to,
      subject: subject && subject.trim() ? subject.trim() : 'Resend Test Email',
      html: html && html.trim() ? html.trim() : '<p>Hello! This is a Resend test email from the Philani Academy test harness.</p>',
      ...(text ? { text } : {})
    })
    return response
  } catch (err) {
    console.error('Resend send error:', err)
    throw new Error(err?.message || 'Failed to send email via Resend.')
  }
}

exports.sendEmail = sendEmail
