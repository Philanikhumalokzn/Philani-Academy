import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/router'

import NavArrows from '../components/NavArrows'

type VerifyState = 'idle' | 'submitting' | 'success' | 'error'
type ResendState = 'idle' | 'sending' | 'sent' | 'error'

const normalizeEmailInput = (value: string) => value.replace(/\s+/g, '').toLowerCase()

export default function VerifyEmailPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<VerifyState>('idle')
  const [message, setMessage] = useState('Enter the verification code we emailed to you.')
  const [resendStatus, setResendStatus] = useState<ResendState>('idle')
  const [resendMessage, setResendMessage] = useState('')
  const [lastOtpEmail, setLastOtpEmail] = useState<string | null>(null)

  useEffect(() => {
    if (!router.isReady) return
    const emailParam = router.query.email
    const initialEmail = Array.isArray(emailParam) ? emailParam[0] : emailParam
    if (initialEmail) {
      setEmail(normalizeEmailInput(initialEmail))
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

    const safeEmail = normalizeEmailInput(email)

    try {
      const response = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: safeEmail, code: code.trim() })
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
    const safeEmail = normalizeEmailInput(email)
    if (!safeEmail) {
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
        body: JSON.stringify({ email: safeEmail })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.message || 'Unable to resend code')
      }

      setResendStatus('sent')
      setResendMessage('If your email is registered, you will receive a new verification code shortly.')
      setLastOtpEmail(safeEmail)
    } catch (err: any) {
      setResendStatus('error')
      setResendMessage(err?.message || 'Could not resend code')
    }
  }

  return (
    <main className="deep-page min-h-screen flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-white text-slate-900 shadow-md rounded-3xl p-8">
        <div className="flex items-center justify-between gap-3 mb-6">
          <NavArrows backHref="/signup" forwardHref="/auth/signin" />
          <button type="button" className="text-sm text-primary hover:underline font-medium" onClick={() => router.push('/auth/signin')}>Sign in</button>
        </div>

        <div className="space-y-2 mb-6 text-center">
          <p className="text-[11px] uppercase tracking-[0.35em] text-slate-400">Philani Academy</p>
          <h1 className="text-3xl font-semibold text-slate-900">Verify email</h1>
          <p className="text-sm text-slate-600">{message}</p>
        </div>

          <form className="space-y-4" onSubmit={handleVerify}>
            <div>
              <label className="block text-sm font-medium text-primary mb-1">Email address</label>
              <input
                className="input input-light"
                type="email"
                value={email}
                onChange={e => setEmail(normalizeEmailInput(e.target.value))}
                placeholder="you@example.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-primary mb-1">Verification code</label>
              <input
                className="input input-light tracking-widest text-center"
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
              className="btn btn-primary w-full"
              disabled={status === 'submitting'}
            >
              {status === 'submitting' ? 'Verifying…' : 'Verify email'}
            </button>
          </form>

          <div className="mt-6 space-y-2 text-sm text-slate-700">
            <button
              type="button"
              className="btn btn-ghost w-full border-primary text-primary font-medium hover:bg-primary/10 disabled:opacity-60"
              onClick={handleResend}
              disabled={resendStatus === 'sending'}
            >
              {resendStatus === 'sending' ? 'Resending…' : 'Resend code'}
            </button>
            {resendMessage && (
              <p className={resendStatus === 'error' ? 'text-red-600 text-center' : 'text-slate-500 text-center'}>{resendMessage}</p>
            )}
            {lastOtpEmail && (
              <p className="text-xs text-center text-slate-500">Last verification code attempt sent to <span className="font-medium text-primary">{lastOtpEmail}</span></p>
            )}
          </div>

          {status === 'success' && (
            <button type="button" className="btn btn-primary w-full mt-6" onClick={() => router.push('/auth/signin')}>
              Continue
            </button>
          )}

          {status === 'error' && (
            <p className="mt-6 text-center text-sm text-red-600">Still stuck? Contact support for help.</p>
          )}
      </div>
    </main>
  )
}
