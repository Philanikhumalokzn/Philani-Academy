import { FormEvent, useEffect, useMemo, useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import AppFooter from '../../components/AppFooter'
import BrandLogo from '../../components/BrandLogo'

export default function ResetPasswordPage() {
  const router = useRouter()
  const token = useMemo(() => (typeof router.query.token === 'string' ? router.query.token.trim() : ''), [router.query.token])
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [validating, setValidating] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)

  useEffect(() => {
    if (!router.isReady) return
    if (!token) {
      setValidating(false)
      setError('Reset link is invalid.')
      return
    }

    let cancelled = false
    setValidating(true)
    setError(null)

    fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data?.message || 'Reset link is invalid.')
        if (!cancelled) {
          setEmail(typeof data?.email === 'string' ? data.email : null)
          setInfo(null)
        }
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || 'Reset link is invalid.')
      })
      .finally(() => {
        if (!cancelled) setValidating(false)
      })

    return () => {
      cancelled = true
    }
  }, [router.isReady, token])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!token) {
      setError('Reset link is invalid.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    setError(null)
    setInfo(null)

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.message || 'Unable to reset password.')
      setComplete(true)
      setInfo(data?.message || 'Password reset successful. You can sign in now.')
      setPassword('')
      setConfirmPassword('')
    } catch (err: any) {
      setError(err?.message || 'Unable to reset password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Head>
        <title>Reset password | Philani Academy</title>
      </Head>
      <main className="deep-page min-h-screen px-4 py-12">
        <div className="mx-auto max-w-md space-y-6">
          <div className="w-full rounded-3xl bg-white p-8 text-slate-900 shadow-md">
            <div className="mb-6 space-y-3 text-center">
              <div className="flex justify-center">
                <BrandLogo height={64} />
              </div>
              <p className="text-[11px] uppercase tracking-[0.35em] text-slate-400">Philani Academy</p>
              <h1 className="text-3xl font-semibold text-slate-900">Reset password</h1>
              <p className="text-sm text-slate-600">Choose a new password for {email || 'your account'}.</p>
            </div>

            {error ? <div className="mb-4 rounded-md bg-red-100 p-3 text-sm text-red-700">{error}</div> : null}
            {info ? <div className="mb-4 rounded-md bg-green-100 p-3 text-sm text-green-700">{info}</div> : null}

            {validating ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-600">Checking your reset link...</div>
            ) : complete ? (
              <div className="space-y-4">
                <Link href="/auth/signin" className="btn btn-primary w-full">Sign in</Link>
              </div>
            ) : error ? (
              <div className="space-y-4 text-center text-sm text-slate-600">
                <Link href="/auth/forgot-password" className="font-medium text-primary hover:underline">Request a new reset link</Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-slate-900">New password</label>
                  <input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    className="input input-light mt-1"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-900">Confirm new password</label>
                  <input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    className="input input-light mt-1"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </div>

                <button type="submit" className="btn btn-primary w-full" disabled={loading}>
                  {loading ? 'Resetting password...' : 'Reset password'}
                </button>
              </form>
            )}
          </div>

          <AppFooter tone="light" className="w-full" respectSafeBottom />
        </div>
      </main>
    </>
  )
}