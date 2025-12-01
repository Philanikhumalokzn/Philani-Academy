import { FormEvent, useCallback, useEffect, useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { signIn } from 'next-auth/react'

function normalizeError(error?: string | null) {
  if (!error) return null
  if (error === 'CredentialsSignin') return 'Invalid email or password.'
  return error
}

export default function SignInPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resendStatus, setResendStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [lastOtpEmail, setLastOtpEmail] = useState<string | null>(null)

  const callbackUrl = typeof router.query.callbackUrl === 'string' ? router.query.callbackUrl : '/dashboard'

  useEffect(() => {
    const incomingError = normalizeError(typeof router.query.error === 'string' ? router.query.error : null)
    if (incomingError) {
      setError(incomingError)
    }
  }, [router.query.error])

  const handleSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setInfo(null)

    const result = await signIn('credentials', {
      redirect: false,
      email,
      password,
      callbackUrl
    })

    setLoading(false)

    if (result?.error) {
      setError(normalizeError(result.error))
      return
    }

    if (result?.url) {
      await router.push(result.url)
      return
    }

    await router.push('/dashboard')
  }, [email, password, callbackUrl, router])

  const handleResend = useCallback(async () => {
    if (!email) {
      setError('Enter your email first so we know where to send the code.')
      return
    }

    setResendStatus('loading')
    setError(null)
    setInfo(null)

    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.message || 'Could not send verification email.')
      }
      setResendStatus('sent')
      setInfo(data?.message || 'Check your inbox for the new verification code.')
      setLastOtpEmail(email)
      // Redirect to verify-email page with email as query param
      router.push({
        pathname: '/verify-email',
        query: { email }
      })
    } catch (err: any) {
      setResendStatus('error')
      setError(err?.message || 'Something went wrong. Please try again later.')
    }
  }, [email])

  return (
    <>
      <Head>
        <title>Sign in | Philani Academy</title>
      </Head>
      <div className="min-h-screen flex items-center justify-center bg-primary px-4">
        <div className="max-w-md w-full bg-white text-slate-900 shadow-md rounded-lg p-8">
          <h1 className="text-2xl font-semibold text-primary mb-3">Sign in</h1>
          <p className="text-sm text-slate-600 mb-6">Welcome back! Enter your credentials to access the dashboard.</p>

          {error && <div className="mb-4 rounded-md bg-red-100 p-3 text-sm text-red-700">{error}</div>}
          {info && <div className="mb-4 rounded-md bg-green-100 p-3 text-sm text-green-700">{info}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-primary">Email</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                className="input mt-1"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-primary">Password</label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                className="input mt-1"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary w-full"
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div className="mt-6 space-y-4 text-sm text-slate-600">
            <p>
              Don&apos;t have an account?{' '}
              <Link href="/signup" className="text-primary hover:underline font-medium">
                Sign up
              </Link>
            </p>

            <div className="border-t border-primary/20 pt-4">
              <p className="font-medium text-primary mb-2">Email verification</p>
              <p className="mb-3">
                If you created an account earlier and have not verified your email, request a new code below.
              </p>
              <button
                type="button"
                className="btn btn-ghost w-full border-primary text-primary font-medium hover:bg-primary/10 disabled:opacity-50"
                onClick={handleResend}
                disabled={resendStatus === 'loading'}
              >
                {resendStatus === 'loading' ? 'Sending…' : 'Resend verification code'}
              </button>
              {resendStatus === 'sent' && (
                <p className="mt-2 text-sm text-green-700">Check your inbox for the latest verification code.</p>
              )}
              {resendStatus === 'error' && (
                <p className="mt-2 text-sm text-red-600">We could not send the email. Please try again later.</p>
              )}
              {lastOtpEmail && (
                <p className="mt-1 text-xs text-slate-500 text-center">Last verification attempt sent to <span className="font-medium text-primary">{lastOtpEmail}</span></p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
