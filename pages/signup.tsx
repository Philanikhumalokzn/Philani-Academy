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
    <main className="min-h-screen flex items-center justify-center p-6 md:p-8 bg-primary">
      <NavArrows backHref="/api/auth/signin" forwardHref="/verify-email" />
      <div className="fixed top-4 right-4">
        {hydrated ? (
          <div className="text-sm bg-green-100 text-green-800 px-3 py-1 rounded shadow-sm">Client JS loaded ✔</div>
        ) : (
          <div className="text-sm bg-primary/10 text-primary px-3 py-1 rounded">Client JS not loaded</div>
        )}
      </div>
      <div className="max-w-md w-full container-card fade-up">
        <h2 className="text-2xl font-bold mb-4 text-primary">Create an account</h2>
        <form onSubmit={handleSubmit} className="space-y-6">
          <section>
            <h3 className="font-semibold mb-2 text-primary">Learner details</h3>
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
            <h3 className="font-semibold mb-2 text-primary">Contact details</h3>
            <div className="space-y-3">
              <input className="input" type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
              <input className="input" placeholder="Mobile number (e.g. 0821234567)" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} autoComplete="tel" required />
            </div>
          </section>

          <section>
            <h3 className="font-semibold mb-2 text-primary">Security</h3>
            <div className="space-y-3">
              <input className="input" type="password" placeholder="Password (min 8 characters)" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
              <label className="flex items-start space-x-2 text-sm">
                <input type="checkbox" checked={popiConsent} onChange={e => setPopiConsent(e.target.checked)} required />
                <span>By continuing you consent to the processing of your information under our{' '}<Link className="text-blue-600" href="/privacy">POPIA privacy policy</Link>.</span>
              </label>
            </div>
          </section>

          <div className="flex items-center justify-between">
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Creating…' : 'Sign up'}
            </button>
            <Link href="/api/auth/signin" className="text-sm text-primary hover:underline">Already registered? Sign in</Link>
          </div>

          {error && <p className="text-red-600">{error}</p>}
        </form>
      </div>
    </main>
  )
}
