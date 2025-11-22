import { useState, useEffect, FormEvent } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { GRADE_VALUES, GradeValue, gradeToLabel } from '../lib/grades'

export default function Signup() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [middleNames, setMiddleNames] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [alternatePhone, setAlternatePhone] = useState('')
  const [recoveryEmail, setRecoveryEmail] = useState('')
  const [emergencyContactName, setEmergencyContactName] = useState('')
  const [emergencyContactRelationship, setEmergencyContactRelationship] = useState('')
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [city, setCity] = useState('')
  const [province, setProvince] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [country, setCountry] = useState('South Africa')
  const [schoolName, setSchoolName] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [popiConsent, setPopiConsent] = useState(false)
  const [grade, setGrade] = useState<GradeValue | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const [flash, setFlash] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const gradeOptions = GRADE_VALUES.map(value => ({ value, label: gradeToLabel(value) }))
  const provinceOptions = [
    'Eastern Cape',
    'Free State',
    'Gauteng',
    'KwaZulu-Natal',
    'Limpopo',
    'Mpumalanga',
    'Northern Cape',
    'North West',
    'Western Cape'
  ]

  // Lightweight diagnostics to help determine if client JS is running in production
  useEffect(() => {
    setHydrated(true)
    console.log('[signup] signup page hydrated')
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const cleanedFirst = firstName.trim()
      const cleanedLast = lastName.trim()
      const cleanedMiddle = middleNames.trim()
      const cleanedEmail = email.trim().toLowerCase()
      const cleanedRecovery = recoveryEmail.trim().toLowerCase()
      const cleanedPhone = phoneNumber.trim()
      const cleanedAltPhone = alternatePhone.trim()
      const cleanedEmergencyPhone = emergencyContactPhone.trim()
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      const postalCodeRegex = /^\d{4}$/
      const idNumberRegex = /^\d{13}$/
      const errors: string[] = []

      const normalisePhone = (input: string) => {
        const digits = input.replace(/\D/g, '')
        if (!digits) return ''
        if (digits.length === 10 && digits.startsWith('0')) return `+27${digits.slice(1)}`
        if (digits.length === 11 && digits.startsWith('27')) return `+${digits}`
        if (input.startsWith('+27') && digits.length === 11) return `+27${digits.slice(2)}`
        return ''
      }

      const primaryPhoneFormatted = normalisePhone(cleanedPhone)
      const alternatePhoneFormatted = cleanedAltPhone ? normalisePhone(cleanedAltPhone) : ''
      const emergencyPhoneFormatted = normalisePhone(cleanedEmergencyPhone)

      if (!cleanedFirst) errors.push('First name is required')
      if (!cleanedLast) errors.push('Last name is required')
      if (!cleanedEmail || !emailRegex.test(cleanedEmail)) errors.push('Valid email is required')
      if (!password || password.length < 8) errors.push('Password must be at least 8 characters long')
      if (!grade) errors.push('Please select your grade')
      if (!dateOfBirth) errors.push('Date of birth is required')
      if (!primaryPhoneFormatted) errors.push('Enter a valid South African mobile number (e.g. 0821234567)')
      if (cleanedAltPhone && !alternatePhoneFormatted) errors.push('Alternate contact number must be valid')
      if (!emergencyContactName.trim()) errors.push('Emergency contact name is required')
      if (!emergencyContactRelationship.trim()) errors.push('Emergency contact relationship is required')
      if (!emergencyPhoneFormatted) errors.push('Emergency contact number must be a valid South African mobile number')
      if (!cleanedRecovery || !emailRegex.test(cleanedRecovery)) errors.push('Recovery email must be valid')
      if (!addressLine1.trim()) errors.push('Address line 1 is required')
      if (!city.trim()) errors.push('City or town is required')
      if (!province || !provinceOptions.includes(province)) errors.push('Please select your province')
      if (!postalCode.trim() || !postalCodeRegex.test(postalCode.trim())) errors.push('Postal code must be 4 digits')
      if (!country.trim()) errors.push('Country is required')
      if (!schoolName.trim()) errors.push('Your school or institution is required')
      if (idNumber.trim() && !idNumberRegex.test(idNumber.trim())) errors.push('South African ID must be 13 digits')
      if (!popiConsent) errors.push('POPIA consent is required to create an account')

      if (errors.length > 0) {
        setError(errors.join(' • '))
        return
      }

      if (!grade) {
        setError('Please select your grade')
        return
      }
      console.log('[signup] handleSubmit start', { firstName: cleanedFirst, lastName: cleanedLast, email: cleanedEmail, grade })
      setLoading(true)
      setError(null)
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: cleanedFirst,
          lastName: cleanedLast,
          middleNames: cleanedMiddle || undefined,
          email: cleanedEmail,
          password,
          grade,
          dateOfBirth,
          phoneNumber: cleanedPhone,
          alternatePhone: cleanedAltPhone || undefined,
          recoveryEmail: cleanedRecovery,
          emergencyContactName: emergencyContactName.trim(),
          emergencyContactRelationship: emergencyContactRelationship.trim(),
          emergencyContactPhone: cleanedEmergencyPhone,
          addressLine1: addressLine1.trim(),
          addressLine2: addressLine2.trim() || undefined,
          city: city.trim(),
          province,
          postalCode: postalCode.trim(),
          country: country.trim(),
          schoolName: schoolName.trim(),
          idNumber: idNumber.trim() || undefined,
          popiConsent
        })
      })

      if (res.ok) {
        setGrade('')
        setEmail('')
        setPassword('')
        setFirstName('')
        setLastName('')
        setMiddleNames('')
        setDateOfBirth('')
        setPhoneNumber('')
        setAlternatePhone('')
        setRecoveryEmail('')
        setEmergencyContactName('')
        setEmergencyContactRelationship('')
        setEmergencyContactPhone('')
        setAddressLine1('')
        setAddressLine2('')
        setCity('')
        setProvince('')
        setPostalCode('')
        setCountry('South Africa')
        setSchoolName('')
        setIdNumber('')
        setPopiConsent(false)
        router.push('/api/auth/signin')
        return
      }
      // Try to parse JSON error body safely
      let message = 'Signup failed'
      try {
        const ct = res.headers.get('content-type') || ''
        if (ct.includes('application/json')) {
          const data = await res.json()
          message = data?.message || message
        } else {
          // non-JSON body
          const text = await res.text()
          message = text || message
        }
      } catch (err) {
        // Parsing failed
        message = 'Signup failed (invalid server response)'
      }

      setError(message)
    } catch (err: any) {
      setError(err?.message || 'Network error')
    }
    finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 md:p-8">
      {/* Hydration-only banner (shows when client JS ran) */}
      <div className="fixed top-4 right-4">
        {hydrated ? (
          <div className="text-sm bg-green-100 text-green-800 px-3 py-1 rounded shadow-sm">Client JS loaded ✔</div>
        ) : (
          <div className="text-sm bg-gray-100 text-gray-600 px-3 py-1 rounded">Client JS not loaded</div>
        )}
      </div>
      <div className="max-w-md w-full container-card fade-up">
        <h2 className="text-2xl font-bold mb-4">Create an account</h2>
        <form action="/api/signup" method="post" onSubmit={handleSubmit} className="space-y-6">
          <section>
            <h3 className="font-semibold mb-2">Personal details</h3>
            <div className="space-y-3">
              <input className="input" placeholder="First name" value={firstName} onChange={e => setFirstName(e.target.value)} required name="firstName" autoComplete="given-name" />
              <input className="input" placeholder="Last name" value={lastName} onChange={e => setLastName(e.target.value)} required name="lastName" autoComplete="family-name" />
              <input className="input" placeholder="Other names (optional)" value={middleNames} onChange={e => setMiddleNames(e.target.value)} name="middleNames" autoComplete="additional-name" />
              <input className="input" placeholder="Date of birth" type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} required name="dateOfBirth" autoComplete="bday" />
              <input className="input" placeholder="South African ID (optional)" value={idNumber} onChange={e => setIdNumber(e.target.value.replace(/[^0-9]/g, ''))} name="idNumber" maxLength={13} />
              <select className="input" value={grade} onChange={e => setGrade(e.target.value as GradeValue | '')} required name="grade">
                <option value="">Select your grade</option>
                {gradeOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <input className="input" placeholder="School or institution" value={schoolName} onChange={e => setSchoolName(e.target.value)} required name="schoolName" autoComplete="organization" />
            </div>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Contact information</h3>
            <div className="space-y-3">
              <input className="input" placeholder="Primary email" value={email} onChange={e => setEmail(e.target.value)} required name="email" autoComplete="email" />
              <input className="input" placeholder="Recovery email" value={recoveryEmail} onChange={e => setRecoveryEmail(e.target.value)} required name="recoveryEmail" autoComplete="email" />
              <input className="input" placeholder="Mobile number (e.g. 0821234567)" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} required name="phoneNumber" autoComplete="tel" pattern="^(?:\+?27|0)[0-9]{9}$" />
              <input className="input" placeholder="Alternate contact number (optional)" value={alternatePhone} onChange={e => setAlternatePhone(e.target.value)} name="alternatePhone" autoComplete="tel" pattern="^(?:\+?27|0)[0-9]{9}$" />
            </div>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Emergency contact</h3>
            <div className="space-y-3">
              <input className="input" placeholder="Contact full name" value={emergencyContactName} onChange={e => setEmergencyContactName(e.target.value)} required name="emergencyContactName" />
              <input className="input" placeholder="Relationship to learner" value={emergencyContactRelationship} onChange={e => setEmergencyContactRelationship(e.target.value)} required name="emergencyContactRelationship" />
              <input className="input" placeholder="Emergency contact number" value={emergencyContactPhone} onChange={e => setEmergencyContactPhone(e.target.value)} required name="emergencyContactPhone" autoComplete="tel" pattern="^(?:\+?27|0)[0-9]{9}$" />
            </div>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Residential address</h3>
            <div className="space-y-3">
              <input className="input" placeholder="Address line 1" value={addressLine1} onChange={e => setAddressLine1(e.target.value)} required name="addressLine1" autoComplete="address-line1" />
              <input className="input" placeholder="Address line 2 (optional)" value={addressLine2} onChange={e => setAddressLine2(e.target.value)} name="addressLine2" autoComplete="address-line2" />
              <input className="input" placeholder="City / Town" value={city} onChange={e => setCity(e.target.value)} required name="city" autoComplete="address-level2" />
              <select className="input" value={province} onChange={e => setProvince(e.target.value)} required name="province">
                <option value="">Select province</option>
                {provinceOptions.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <input className="input" placeholder="Postal code" value={postalCode} onChange={e => setPostalCode(e.target.value.replace(/[^0-9]/g, ''))} required name="postalCode" autoComplete="postal-code" maxLength={4} pattern="^[0-9]{4}$" />
              <input className="input" placeholder="Country" value={country} onChange={e => setCountry(e.target.value)} required name="country" autoComplete="country-name" />
            </div>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Security</h3>
            <div className="space-y-3">
              <input className="input" placeholder="Password (min 8 characters)" type="password" value={password} onChange={e => setPassword(e.target.value)} required name="password" autoComplete="new-password" minLength={8} />
              <label className="flex items-start space-x-2 text-sm">
                <input type="checkbox" checked={popiConsent} onChange={e => setPopiConsent(e.target.checked)} required name="popiConsent" />
                <span>
                  I confirm that the information provided is accurate and I consent to the processing of my personal information in line with the{' '}
                  <Link className="text-blue-600" href="/privacy">POPIA-compliant Privacy Policy</Link>.
                </span>
              </label>
            </div>
          </section>
          <noscript>
            <p className="text-sm muted">JavaScript appears to be disabled in your browser. The form will submit normally without client-side enhancements.</p>
          </noscript>
          <div className="flex items-center justify-between">
              <button
                className={`btn btn-primary ${flash ? 'opacity-70' : ''}`}
                type="submit"
                disabled={loading}
                onClick={() => {
                  // visual flash so the user sees a transient change when button is clicked
                  setFlash(true)
                  setTimeout(() => setFlash(false), 300)
                  console.log('[signup] button clicked')
                }}
              >
                {loading ? 'Creating…' : 'Sign up'}
              </button>
            <Link href="/api/auth/signin" className="text-sm muted">Already have an account? Sign in</Link>
          </div>
          {error && <p className="text-red-600">{error}</p>}
        </form>
      </div>
    </main>
  )
}
