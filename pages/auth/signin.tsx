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
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white shadow-md rounded-lg p-8">
          <h1 className="text-2xl font-semibold text-gray-900 mb-3">Sign in</h1>
          <p className="text-sm text-gray-600 mb-6">Welcome back! Enter your credentials to access the dashboard.</p>

          {error && <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          {info && <div className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-700">{info}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">Password</label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60"
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div className="mt-6 space-y-4 text-sm text-gray-600">
            <p>
              Don&apos;t have an account?{' '}
              <Link href="/signup" className="text-blue-600 hover:text-blue-700 font-medium">
                Sign up
              </Link>
            </p>

            <div className="border-t border-gray-200 pt-4">
              <p className="font-medium text-gray-700 mb-2">Email verification</p>
              <p className="mb-3">
                If you created an account earlier and have not verified your email, request a new code below.
              </p>
              <button
                type="button"
                className="w-full py-2 rounded-md border border-blue-600 text-blue-600 font-medium hover:bg-blue-50 disabled:opacity-50"
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
                <p className="mt-1 text-xs text-gray-500 text-center">Last verification attempt sent to <span className="font-medium text-gray-700">{lastOtpEmail}</span></p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
