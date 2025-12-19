import { useState, useEffect, FormEvent } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { GRADE_VALUES, GradeValue, gradeToLabel } from '../lib/grades'

import NavArrows from '../components/NavArrows'

const gradeOptions = GRADE_VALUES.map(value => ({ value, label: gradeToLabel(value) }))

function normalisePhoneNumber(input: string) {
  const digits = input.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 10 && digits.startsWith('0')) return `+27${digits.slice(1)}`
  if (digits.length === 11 && digits.startsWith('27')) return `+${digits}`
  if (input.startsWith('+27') && digits.length === 11) return `+27${digits.slice(2)}`
  return ''
}

export default function Signup() {
  const router = useRouter()
  const [hydrated, setHydrated] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [grade, setGrade] = useState<GradeValue | ''>('')
  const [password, setPassword] = useState('')
  const [popiConsent, setPopiConsent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setHydrated(true)
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    const cleanedFirst = firstName.trim()
    const cleanedLast = lastName.trim()
    const cleanedEmail = email.trim().toLowerCase()
    const cleanedPhone = phoneNumber.trim()
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const normalizedPhone = normalisePhoneNumber(cleanedPhone)
    const errors: string[] = []

    if (!cleanedFirst) errors.push('First name is required')
    if (!cleanedLast) errors.push('Last name is required')
    if (!cleanedEmail || !emailRegex.test(cleanedEmail)) errors.push('Valid email is required')
    if (!password || password.length < 8) errors.push('Password must be at least 8 characters long')
    if (!grade) errors.push('Please select your grade')
    if (!normalizedPhone) errors.push('Enter a valid South African mobile number (e.g. 0821234567)')
    if (!popiConsent) errors.push('POPIA consent is required to create an account')

    if (errors.length > 0) {
      setError(errors.join(' • '))
      return
    }

    setLoading(true)

    try {
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: cleanedFirst,
          lastName: cleanedLast,
          email: cleanedEmail,
          password,
          grade,
          phoneNumber: cleanedPhone,
          popiConsent
        })
      })

      if (!response.ok) {
        let message = 'Signup failed'
        try {
          const data = await response.json()
          if (Array.isArray(data?.errors) && data.errors.length > 0) {
            message = data.errors.join(' • ')
          } else if (data?.message) {
            message = data.message
          }
        } catch (err) {
          // ignore JSON parse errors
        }
        throw new Error(message)
      }

      setFirstName('')
      setLastName('')
      setEmail('')
      setPhoneNumber('')
      setGrade('')
      setPassword('')
      setPopiConsent(false)

      await router.push({
        pathname: '/verify-email',
        query: { email: cleanedEmail }
      })
    } catch (err: any) {
      setError(err?.message || 'Unable to create account')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="deep-page min-h-screen flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-white text-slate-900 shadow-md rounded-3xl p-8 fade-up">
        <div className="flex items-center justify-between gap-3 mb-6">
          <NavArrows backHref="/api/auth/signin" forwardHref="/verify-email" />
          <Link href="/api/auth/signin" className="text-sm text-primary hover:underline font-medium">Sign in</Link>
        </div>

        <div className="space-y-2 mb-6 text-center">
          <p className="text-[11px] uppercase tracking-[0.35em] text-slate-400">Philani Academy</p>
          <h1 className="text-3xl font-semibold text-slate-900">Create account</h1>
          <p className="text-sm text-slate-600">Minimal, mobile-first signup for learners.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <section>
            <h3 className="font-semibold mb-2 text-slate-900">Learner details</h3>
            <div className="space-y-3">
              <input className="input" placeholder="First name" value={firstName} onChange={e => setFirstName(e.target.value)} autoComplete="given-name" required />
              <input className="input" placeholder="Last name" value={lastName} onChange={e => setLastName(e.target.value)} autoComplete="family-name" required />
              <select className="input" value={grade} onChange={e => setGrade(e.target.value as GradeValue | '')} required>
                <option value="">Select your grade</option>
                {gradeOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </section>

          <section>
            <h3 className="font-semibold mb-2 text-slate-900">Contact details</h3>
            <div className="space-y-3">
              <input className="input" type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
              <input className="input" placeholder="Mobile number (e.g. 0821234567)" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} autoComplete="tel" required />
            </div>
          </section>

          <section>
            <h3 className="font-semibold mb-2 text-slate-900">Security</h3>
            <div className="space-y-3">
              <input className="input" type="password" placeholder="Password (min 8 characters)" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
              <label className="flex items-start space-x-2 text-sm">
                <input type="checkbox" checked={popiConsent} onChange={e => setPopiConsent(e.target.checked)} required />
                <span>
                  By continuing you consent to the processing of your information under our{' '}
                  <Link className="text-primary hover:underline" href="/privacy">POPIA privacy policy</Link>.
                </span>
              </label>
            </div>
          </section>

          <div className="space-y-3">
            <button className="btn btn-primary w-full" type="submit" disabled={loading}>
              {loading ? 'Creating…' : 'Sign up'}
            </button>
            <p className="text-sm text-slate-600 text-center">
              Already registered? <Link href="/api/auth/signin" className="text-primary hover:underline font-medium">Sign in</Link>
            </p>
          </div>

          {error && <p className="text-red-600">{error}</p>}
        </form>
      </div>
    </main>
  )
}
