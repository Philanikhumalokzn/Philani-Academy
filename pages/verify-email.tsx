import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/router'

type VerifyState = 'idle' | 'submitting' | 'success' | 'error'
type ResendState = 'idle' | 'sending' | 'sent' | 'error'

export default function VerifyEmailPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<VerifyState>('idle')
  const [message, setMessage] = useState('Enter the verification code we emailed to you.')
  const [resendStatus, setResendStatus] = useState<ResendState>('idle')
  const [resendMessage, setResendMessage] = useState('')
  const [testSubject, setTestSubject] = useState('Philani Academy test email')
  const [testBody, setTestBody] = useState('This is a test email sent from the Philani Academy app.')
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [testFeedback, setTestFeedback] = useState('')
  const [lastOtpEmail, setLastOtpEmail] = useState<string | null>(null)
  const [lastTestEmail, setLastTestEmail] = useState<string | null>(null)

  useEffect(() => {
    if (!router.isReady) return
    const emailParam = router.query.email
    const initialEmail = Array.isArray(emailParam) ? emailParam[0] : emailParam
    if (initialEmail) {
      setEmail(initialEmail)
    }
  }, [router.isReady, router.query.email])

  useEffect(() => {
    if (status === 'error') {
      setStatus('idle')
      setMessage('Enter the verification code we emailed to you.')
    }
  }, [email, code, status])

  async function handleVerify(event: FormEvent) {
    event.preventDefault()
    setStatus('submitting')
    setMessage('Verifying code…')

    try {
      const response = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim() })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.message || 'Verification failed')
      }

      const followUp = data?.phoneVerificationPending
        ? 'Email verified. Phone verification will be completed separately.'
        : 'Email verified. You can now sign in.'

      setStatus('success')
      setMessage(followUp)
    } catch (err: any) {
      setStatus('error')
      setMessage(err?.message || 'We could not verify your email. Please try again.')
    }
  }

  async function handleResend() {
    if (!email.trim()) {
      setResendStatus('error')
      setResendMessage('Enter your email first')
      return
    }

    setResendStatus('sending')
    setResendMessage('Sending new code…')

    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.message || 'Unable to resend code')
      }

      setResendStatus('sent')
      setResendMessage('If your email is registered, you will receive a new verification code shortly.')
      setLastOtpEmail(email.trim())
    } catch (err: any) {
      setResendStatus('error')
      setResendMessage(err?.message || 'Could not resend code')
    }
  }

  async function handleSendTestEmail() {
    if (!email.trim()) {
      setTestStatus('error')
      setTestFeedback('Enter your email first')
      return
    }

    setTestStatus('sending')
    setTestFeedback('Sending test email…')

    try {
      const response = await fetch('/api/debug/send-test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          subject: testSubject,
          message: testBody
        })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.message || 'Unable to send test email')
      }

      setTestStatus('sent')
      setTestFeedback(data?.message || 'Test email dispatched. Check your inbox.')
      setLastTestEmail(email.trim())
    } catch (err: any) {
      setTestStatus('error')
      setTestFeedback(err?.message || 'Could not send test email')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-2xl font-semibold mb-4 text-center">Verify your email</h1>
        <p className="text-gray-700 mb-6 text-center">{message}</p>

        <form className="space-y-4" onSubmit={handleVerify}>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Verification code</label>
            <input
              className="input tracking-widest text-center"
              value={code}
              onChange={e => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
          </div>

          <button
            type="submit"
            className="w-full py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 disabled:opacity-60"
            disabled={status === 'submitting'}
          >
            {status === 'submitting' ? 'Verifying…' : 'Verify email'}
          </button>
        </form>

        <div className="mt-6 space-y-2 text-sm">
          <button
            type="button"
            className="w-full py-2 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-60"
            onClick={handleResend}
            disabled={resendStatus === 'sending'}
          >
            {resendStatus === 'sending' ? 'Resending…' : 'Resend code'}
          </button>
          {resendMessage && (
            <p className={resendStatus === 'error' ? 'text-red-600 text-center' : 'text-gray-600 text-center'}>{resendMessage}</p>
          )}
          {lastOtpEmail && (
            <p className="text-xs text-center text-gray-500">Last verification code attempt sent to <span className="font-medium text-gray-700">{lastOtpEmail}</span></p>
          )}
          <div className="mt-6 rounded border border-dashed border-gray-300 p-4">
            <h2 className="text-sm font-semibold mb-2 text-gray-700">Send a quick test email</h2>
            <p className="text-xs text-gray-500 mb-3">Use this to confirm the mailer can reach the same inbox. The test email uses the same Resend integration.</p>
            <div className="space-y-2">
              <input
                className="input"
                value={testSubject}
                onChange={e => setTestSubject(e.target.value)}
                placeholder="Subject"
              />
              <textarea
                className="input"
                rows={3}
                value={testBody}
                onChange={e => setTestBody(e.target.value)}
                placeholder="Message"
              />
            </div>
            <button
              type="button"
              className="mt-3 w-full py-2 rounded-md border border-blue-600 text-blue-600 font-medium hover:bg-blue-50 disabled:opacity-60"
              onClick={handleSendTestEmail}
              disabled={testStatus === 'sending'}
            >
              {testStatus === 'sending' ? 'Sending test…' : 'Send test email'}
            </button>
            {testFeedback && (
              <p className={`mt-2 text-center text-sm ${testStatus === 'error' ? 'text-red-600' : 'text-gray-600'}`}>{testFeedback}</p>
            )}
            {lastTestEmail && (
              <p className="text-xs text-center text-gray-500">Last test email attempt sent to <span className="font-medium text-gray-700">{lastTestEmail}</span></p>
            )}
          </div>
        </div>

        {status === 'success' && (
          <button
            type="button"
            className="mt-6 w-full py-3 bg-green-600 text-white font-medium rounded-md hover:bg-green-700"
            onClick={() => router.push('/auth/signin')}
          >
            Continue to sign in
          </button>
        )}

        {status === 'error' && (
          <p className="mt-6 text-center text-sm text-red-600">Still stuck? Contact support for help.</p>
        )}
      </div>
    </div>
  )
}
