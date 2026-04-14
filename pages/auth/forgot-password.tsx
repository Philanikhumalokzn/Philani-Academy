import { FormEvent, useEffect, useMemo, useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import AppFooter from '../../components/AppFooter'
import BrandLogo from '../../components/BrandLogo'

function normalizeEmailInput(value: string) {
  return value.replace(/\s+/g, '').toLowerCase()
}

export default function ForgotPasswordPage() {
  const router = useRouter()
  const initialEmail = useMemo(() => {
    return typeof router.query.email === 'string' ? normalizeEmailInput(router.query.email) : ''
  }, [router.query.email])
  const [email, setEmail] = useState(initialEmail)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    if (initialEmail) setEmail(initialEmail)
  }, [initialEmail])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const safeEmail = normalizeEmailInput(email)
    if (!safeEmail) {
      setError('Enter the email address you used for your account.')
      return
    }

    setLoading(true)
    setError(null)
    setInfo(null)

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: safeEmail }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.message || 'Could not send reset email.')
      setInfo(data?.message || 'Check your inbox for a password reset link.')
    } catch (err: any) {
      setError(err?.message || 'Could not send reset email.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Head>
        <title>Forgot password | Philani Academy</title>
      </Head>
      <main className="deep-page min-h-screen px-4 py-12">
        <div className="mx-auto max-w-md space-y-6">
          <div className="w-full rounded-3xl bg-white p-8 text-slate-900 shadow-md">
            <div className="mb-6 space-y-3 text-center">
              <div className="flex justify-center">
                <BrandLogo height={64} />
              </div>
              <p className="text-[11px] uppercase tracking-[0.35em] text-slate-400">Philani Academy</p>
              <h1 className="text-3xl font-semibold text-slate-900">Forgot password?</h1>
              <p className="text-sm text-slate-600">Enter your registered email address and we&apos;ll send you a secure link to reset your password.</p>
            </div>

            {error ? <div className="mb-4 rounded-md bg-red-100 p-3 text-sm text-red-700">{error}</div> : null}
            {info ? <div className="mb-4 rounded-md bg-green-100 p-3 text-sm text-green-700">{info}</div> : null}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-900">Email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="input input-light mt-1"
                  value={email}
                  onChange={(event) => setEmail(normalizeEmailInput(event.target.value))}
                />
              </div>

              <button type="submit" className="btn btn-primary w-full" disabled={loading}>
                {loading ? 'Sending reset link...' : 'Send reset link'}
              </button>
            </form>

            <div className="mt-6 text-center text-sm text-slate-600">
              Remembered your password? <Link href="/auth/signin" className="font-medium text-primary hover:underline">Back to sign in</Link>
            </div>
          </div>

          <AppFooter tone="light" className="w-full" respectSafeBottom />
        </div>
      </main>
    </>
  )
}