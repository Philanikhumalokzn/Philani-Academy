import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { gradeToLabel } from '../lib/grades'

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

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const normalisePhone = (input: string) => {
  const digits = input.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 10 && digits.startsWith('0')) return `+27${digits.slice(1)}`
  if (digits.length === 11 && digits.startsWith('27')) return `+${digits}`
  if (input.startsWith('+27') && digits.length === 11) return `+27${digits.slice(2)}`
  return ''
}

const toLocalMobile = (input?: string | null) => {
  if (!input) return ''
  if (input.startsWith('+27') && input.length === 12) return `0${input.slice(3)}`
  if (input.startsWith('27') && input.length === 11) return `0${input.slice(2)}`
  return input
}

export default function ProfilePage() {
  const { data: session } = useSession()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [profile, setProfile] = useState<any>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [middleNames, setMiddleNames] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [primaryEmail, setPrimaryEmail] = useState('')
  const [recoveryEmail, setRecoveryEmail] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [alternatePhone, setAlternatePhone] = useState('')
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
  const [avatar, setAvatar] = useState('')
  const [popiConsent, setPopiConsent] = useState(true)
  const [consentTimestamp, setConsentTimestamp] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  const gradeLabel = useMemo(() => {
    if (!profile?.grade) return 'Unassigned'
    return gradeToLabel(profile.grade)
  }, [profile?.grade])

  useEffect(() => {
    fetchProfile()
  }, [])

  async function fetchProfile() {
    setLoading(true)
    try {
      const res = await fetch('/api/profile', { credentials: 'same-origin' })
      if (res.ok) {
        const data = await res.json()
        setProfile(data)
        setFirstName(data.firstName || '')
        setLastName(data.lastName || '')
        setMiddleNames(data.middleNames || '')
        setDateOfBirth(data.dateOfBirth ? data.dateOfBirth.slice(0, 10) : '')
        setIdNumber(data.idNumber || '')
        setPrimaryEmail(data.email || '')
        setRecoveryEmail(data.recoveryEmail || '')
        setPhoneNumber(toLocalMobile(data.phoneNumber))
        setAlternatePhone(toLocalMobile(data.alternatePhone))
        setEmergencyContactName(data.emergencyContactName || '')
        setEmergencyContactRelationship(data.emergencyContactRelationship || '')
        setEmergencyContactPhone(toLocalMobile(data.emergencyContactPhone))
        setAddressLine1(data.addressLine1 || '')
        setAddressLine2(data.addressLine2 || '')
        setCity(data.city || '')
        setProvince(data.province || '')
        setPostalCode(data.postalCode || '')
        setCountry(data.country || 'South Africa')
        setSchoolName(data.schoolName || '')
        setAvatar(data.avatar || '')
        setPopiConsent(Boolean(data.consentToPolicies))
        setConsentTimestamp(data.consentTimestamp || null)
      }
    } catch (err) {
      console.error('fetchProfile error', err)
    } finally {
      setLoading(false)
    }
  }

  async function saveProfile() {
    setError(null)
    const cleanedFirst = firstName.trim()
    const cleanedLast = lastName.trim()
    const cleanedMiddle = middleNames.trim()
    const cleanedEmail = primaryEmail.trim().toLowerCase()
    const cleanedRecovery = recoveryEmail.trim().toLowerCase()
    const cleanedPhone = phoneNumber.trim()
    const cleanedAlt = alternatePhone.trim()
    const cleanedEmergency = emergencyContactPhone.trim()
    const cleanedAddress1 = addressLine1.trim()
    const cleanedCity = city.trim()
    const cleanedPostal = postalCode.trim()
    const cleanedCountry = country.trim()
    const cleanedSchool = schoolName.trim()
    const cleanedId = idNumber.trim().replace(/[^0-9]/g, '')

    const primaryPhoneFormatted = normalisePhone(cleanedPhone)
    const alternatePhoneFormatted = cleanedAlt ? normalisePhone(cleanedAlt) : ''
    const emergencyPhoneFormatted = normalisePhone(cleanedEmergency)

    const errors: string[] = []
    if (!cleanedFirst) errors.push('First name is required')
    if (!cleanedLast) errors.push('Last name is required')
    if (!cleanedEmail || !emailRegex.test(cleanedEmail)) errors.push('Primary email must be valid')
    if (!cleanedRecovery || !emailRegex.test(cleanedRecovery)) errors.push('Recovery email must be valid')
    if (!dateOfBirth) errors.push('Date of birth is required')
    if (!primaryPhoneFormatted) errors.push('Primary contact number must be a valid South African mobile number (e.g. 0821234567)')
    if (cleanedAlt && !alternatePhoneFormatted) errors.push('Alternate contact number must be valid')
    if (!emergencyContactName.trim()) errors.push('Emergency contact name is required')
    if (!emergencyContactRelationship.trim()) errors.push('Emergency contact relationship is required')
    if (!emergencyPhoneFormatted) errors.push('Emergency contact number must be valid')
    if (!cleanedAddress1) errors.push('Address line 1 is required')
    if (!cleanedCity) errors.push('City / town is required')
    if (!province || !provinceOptions.includes(province)) errors.push('Please select your province')
    if (!cleanedPostal || !/^\d{4}$/.test(cleanedPostal)) errors.push('Postal code must be 4 digits')
    if (!cleanedCountry) errors.push('Country is required')
    if (!cleanedSchool) errors.push('School or institution is required')
    if (cleanedId && !/^\d{13}$/.test(cleanedId)) errors.push('South African ID numbers must be exactly 13 digits')
    if (!popiConsent) errors.push('POPIA consent must remain active to keep your account')

    if (errors.length > 0) {
      setError(errors.join(' • '))
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: cleanedFirst,
          lastName: cleanedLast,
          middleNames: cleanedMiddle || undefined,
          dateOfBirth,
          idNumber: cleanedId || undefined,
          email: cleanedEmail,
          recoveryEmail: cleanedRecovery,
          phoneNumber: cleanedPhone,
          alternatePhone: cleanedAlt || undefined,
          emergencyContactName: emergencyContactName.trim(),
          emergencyContactRelationship: emergencyContactRelationship.trim(),
          emergencyContactPhone: cleanedEmergency,
          addressLine1: cleanedAddress1,
          addressLine2: addressLine2.trim() || undefined,
          city: cleanedCity,
          province,
          postalCode: cleanedPostal,
          country: cleanedCountry,
          schoolName: cleanedSchool,
          popiConsent: true,
          avatar: avatar.trim() || undefined
        })
      })

      if (res.ok) {
        alert('Profile updated successfully')
        await fetchProfile()
      } else {
        const payload = await res.json().catch(() => ({}))
        setError(payload?.errors?.join(' • ') || payload?.message || 'Failed to update profile')
      }
    } catch (err: any) {
      setError(err?.message || 'Network error while saving profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">My profile</h1>
        {loading ? (
          <div>Loading…</div>
        ) : (
          <div className="space-y-6">
            <section className="card p-6 space-y-4">
              <h2 className="text-xl font-semibold">Learner information</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium">First name</label>
                  <input className="input" value={firstName} onChange={e => setFirstName(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium">Last name</label>
                  <input className="input" value={lastName} onChange={e => setLastName(e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium">Other names</label>
                  <input className="input" value={middleNames} onChange={e => setMiddleNames(e.target.value)} placeholder="Optional" />
                </div>
                <div>
                  <label className="block text-sm font-medium">Date of birth</label>
                  <input className="input" type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium">South African ID (optional)</label>
                  <input className="input" value={idNumber} maxLength={13} onChange={e => setIdNumber(e.target.value.replace(/[^0-9]/g, ''))} placeholder="13 digits" />
                </div>
                <div>
                  <label className="block text-sm font-medium">Grade</label>
                  <input className="input" value={gradeLabel} disabled />
                </div>
                <div>
                  <label className="block text-sm font-medium">School / institution</label>
                  <input className="input" value={schoolName} onChange={e => setSchoolName(e.target.value)} />
                </div>
              </div>
            </section>

            <section className="card p-6 space-y-4">
              <h2 className="text-xl font-semibold">Contact details</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium">Primary email</label>
                  <input className="input" value={primaryEmail} onChange={e => setPrimaryEmail(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium">Recovery email</label>
                  <input className="input" value={recoveryEmail} onChange={e => setRecoveryEmail(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium">Mobile number</label>
                  <input className="input" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} placeholder="e.g. 0821234567" />
                </div>
                <div>
                  <label className="block text-sm font-medium">Alternate phone (optional)</label>
                  <input className="input" value={alternatePhone} onChange={e => setAlternatePhone(e.target.value)} placeholder="e.g. 0612345678" />
                </div>
              </div>
            </section>

            <section className="card p-6 space-y-4">
              <h2 className="text-xl font-semibold">Emergency contact</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium">Contact name</label>
                  <input className="input" value={emergencyContactName} onChange={e => setEmergencyContactName(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium">Relationship</label>
                  <input className="input" value={emergencyContactRelationship} onChange={e => setEmergencyContactRelationship(e.target.value)} placeholder="e.g. Parent / Guardian" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium">Emergency phone</label>
                  <input className="input" value={emergencyContactPhone} onChange={e => setEmergencyContactPhone(e.target.value)} placeholder="e.g. 0831234567" />
                </div>
              </div>
            </section>

            <section className="card p-6 space-y-4">
              <h2 className="text-xl font-semibold">Residential address</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium">Address line 1</label>
                  <input className="input" value={addressLine1} onChange={e => setAddressLine1(e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium">Address line 2 (optional)</label>
                  <input className="input" value={addressLine2} onChange={e => setAddressLine2(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium">City / Town</label>
                  <input className="input" value={city} onChange={e => setCity(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium">Province</label>
                  <select className="input" value={province} onChange={e => setProvince(e.target.value)}>
                    <option value="">Select province</option>
                    {provinceOptions.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium">Postal code</label>
                  <input className="input" value={postalCode} onChange={e => setPostalCode(e.target.value.replace(/[^0-9]/g, ''))} maxLength={4} placeholder="4 digits" />
                </div>
                <div>
                  <label className="block text-sm font-medium">Country</label>
                  <input className="input" value={country} onChange={e => setCountry(e.target.value)} />
                </div>
              </div>
            </section>

            <section className="card p-6 space-y-4">
              <h2 className="text-xl font-semibold">Compliance & preferences</h2>
              <div className="space-y-3">
                <label className="flex items-start space-x-2 text-sm">
                  <input type="checkbox" checked={popiConsent} onChange={e => setPopiConsent(e.target.checked)} disabled />
                  <span>
                    I consent to the processing of my personal information in line with the{' '}
                    <Link className="text-blue-600" href="/privacy">POPIA-compliant Privacy Policy</Link>.
                  </span>
                </label>
                {consentTimestamp && (
                  <p className="text-xs muted">Last consent recorded: {new Date(consentTimestamp).toLocaleString()}</p>
                )}
                <div>
                  <label className="block text-sm font-medium">Avatar URL (optional)</label>
                  <input className="input" value={avatar} onChange={e => setAvatar(e.target.value)} placeholder="https://…" />
                  <div className="mt-2">
                    {avatar ? (
                      <img src={avatar} alt="avatar" style={{ width: 64, height: 64, borderRadius: 8 }} />
                    ) : (
                      <span className="muted text-sm">No avatar on file</span>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {error && <div className="text-sm text-red-600">{error}</div>}

            <div className="flex items-center gap-3">
              <button className="btn btn-primary" onClick={saveProfile} disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              <button className="btn btn-ghost" onClick={fetchProfile} disabled={saving}>Reset</button>
            </div>

            <section className="card p-6 space-y-3">
              <h2 className="text-xl font-semibold">Security</h2>
              <div className="grid gap-3 md:grid-cols-2">
                <input className="input" placeholder="Current password" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
                <input className="input" placeholder="New password" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
              </div>
              <div>
                <button className="btn btn-secondary" onClick={async () => {
                  if (!currentPassword || !newPassword) {
                    alert('Please supply both the current and new password.')
                    return
                  }
                  setChangingPassword(true)
                  try {
                    const res = await fetch('/api/profile/change-password', {
                      method: 'POST',
                      credentials: 'same-origin',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ currentPassword, newPassword })
                    })
                    if (res.ok) {
                      alert('Password updated')
                      setCurrentPassword('')
                      setNewPassword('')
                    } else {
                      const payload = await res.json().catch(() => ({}))
                      alert(payload?.message || 'Failed to change password')
                    }
                  } catch (err: any) {
                    alert(err?.message || 'Network error while changing password')
                  }
                  setChangingPassword(false)
                }} disabled={changingPassword}>
                  {changingPassword ? 'Changing…' : 'Change password'}
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  )
}
