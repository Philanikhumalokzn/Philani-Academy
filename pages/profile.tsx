import React, { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { signOut, useSession } from 'next-auth/react'
import { gradeToLabel } from '../lib/grades'

import NavArrows from '../components/NavArrows'

const defaultMobileHeroBg = (() => {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#020b35"/>
      <stop offset="0.55" stop-color="#041448"/>
      <stop offset="1" stop-color="#031641"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1d4ed8" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#60a5fa" stop-opacity="0.15"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#sky)"/>
  <circle cx="1540" cy="260" r="220" fill="url(#glow)"/>
  <path d="M0 850 L420 620 L720 760 L980 560 L1280 720 L1600 600 L1920 760 L1920 1080 L0 1080 Z" fill="#041a5a" opacity="0.9"/>
  <path d="M0 910 L360 740 L660 860 L920 720 L1220 860 L1500 760 L1920 900 L1920 1080 L0 1080 Z" fill="#052a7a" opacity="0.55"/>
  <path d="M0 980 L420 920 L860 1000 L1220 940 L1580 1010 L1920 960 L1920 1080 L0 1080 Z" fill="#00122f" opacity="0.65"/>
</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
})()

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
  const router = useRouter()
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
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarUploadError, setAvatarUploadError] = useState<string | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

  const [mobileHeroBgUrl, setMobileHeroBgUrl] = useState<string>(defaultMobileHeroBg)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const userKey = session?.user?.email || (session as any)?.user?.id || session?.user?.name || 'anon'
    const storageKey = `pa:mobileHeroBg:${userKey}`
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw && typeof raw === 'string') setMobileHeroBgUrl(raw)
    } catch {}
  }, [session])

  const gradeLabel = useMemo(() => {
    if (!profile?.grade) return 'Unassigned'
    return gradeToLabel(profile.grade)
  }, [profile?.grade])

  const displayName = useMemo(() => {
    if (firstName || lastName) return `${firstName} ${lastName}`.trim()
    return profile?.name || session?.user?.name || session?.user?.email || 'Learner'
  }, [firstName, lastName, profile?.name, session?.user?.email, session?.user?.name])

  const avatarInitials = useMemo(() => {
    const source = displayName || ''
    const letters = source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase() ?? '')
    const fallback = session?.user?.email?.slice(0, 2).toUpperCase() || 'PA'
    return letters.join('') || fallback
  }, [displayName, session?.user?.email])

  const handleAvatarButtonClick = () => {
    setAvatarUploadError(null)
    if (uploadingAvatar) return
    avatarInputRef.current?.click()
  }

  const handleAvatarFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setAvatarUploadError('Please choose an image file.')
      return
    }
    if (file.size > 4 * 1024 * 1024) {
      setAvatarUploadError('Please keep images under 4 MB.')
      return
    }
    setUploadingAvatar(true)
    setAvatarUploadError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/profile/avatar', {
        method: 'POST',
        body: formData
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.url) {
        throw new Error(payload?.message || 'Failed to upload avatar')
      }
      setAvatar(payload.url)
      setProfile(prev => (prev ? { ...prev, avatar: payload.url } : prev))
    } catch (err: any) {
      setAvatarUploadError(err?.message || 'Unable to upload avatar right now')
    } finally {
      setUploadingAvatar(false)
    }
  }

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
    <>
      <main className="deep-page min-h-screen px-4 py-6 md:py-12 overflow-x-hidden hidden md:block">
        <div className="mx-auto max-w-5xl space-y-6 md:space-y-8">
          <section className="hero flex-col gap-5">
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <NavArrows backHref="/dashboard" forwardHref={undefined} />
            </div>
            <div className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={handleAvatarButtonClick}
                    className="relative h-24 w-24 rounded-full border-2 border-white/30 bg-white/5 text-2xl font-semibold text-white flex items-center justify-center overflow-hidden"
                    aria-label="Update profile photo"
                    disabled={uploadingAvatar}
                  >
                    {avatar ? (
                      <img src={avatar} alt="Profile avatar" className="h-full w-full object-cover" />
                    ) : (
                      <span>{avatarInitials}</span>
                    )}
                    <span className="sr-only">Upload new avatar</span>
                    <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em]">
                      Edit
                    </span>
                  </button>
                  <div>
                    <p className="text-[12px] uppercase tracking-[0.35em] text-blue-200">Account control</p>
                    <h1 className="text-3xl font-semibold md:text-4xl">My profile</h1>
                    <p className="text-sm text-blue-100/80">{displayName}</p>
                  </div>
                </div>
                <div className="flex flex-col items-center gap-2 text-xs text-blue-100/80">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleAvatarButtonClick}
                    disabled={uploadingAvatar}
                  >
                    {uploadingAvatar ? 'Uploading…' : avatar ? 'Change photo' : 'Add photo'}
                  </button>
                  <span>Tap the photo to upload</span>
                </div>
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={handleAvatarFileChange}
              />
              {avatarUploadError && <p className="text-xs text-red-400">{avatarUploadError}</p>}
            </div>
          </section>

          {loading ? (
            <div className="card p-6 text-center text-sm text-white">Loading…</div>
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
                      <Link className="text-blue-200 underline" href="/privacy">POPIA-compliant Privacy Policy</Link>.
                    </span>
                  </label>
                  {consentTimestamp && (
                    <p className="text-xs muted">Last consent recorded: {new Date(consentTimestamp).toLocaleString()}</p>
                  )}
                </div>
              </section>

              {error && <div className="text-sm text-red-600">{error}</div>}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <button className="btn btn-primary w-full sm:w-auto" onClick={saveProfile} disabled={saving}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                <button className="btn btn-ghost w-full sm:w-auto" onClick={fetchProfile} disabled={saving}>Reset</button>
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

      <main className="mobile-dashboard-theme profile-overlay-theme min-h-screen overflow-hidden text-white md:hidden">
        <div
          className="absolute inset-0"
          style={{ backgroundImage: `url(${mobileHeroBgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#020b35]/45 via-[#041448]/30 to-[#031641]/45" aria-hidden="true" />

        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
          <div className="absolute inset-0 philani-overlay-backdrop philani-overlay-backdrop-enter" aria-hidden="true" />
          <div className="absolute inset-x-2 top-3 bottom-3 rounded-3xl border border-white/10 bg-white/3 shadow-2xl overflow-hidden">
            <div className="p-3 border-b border-white/10 flex items-center justify-between gap-3">
              <button
                type="button"
                className="text-sm font-semibold text-red-200 hover:text-red-100"
                onClick={() => signOut({ callbackUrl: '/' })}
              >
                Sign out
              </button>
              <button
                type="button"
                aria-label="Close"
                className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-white/15 bg-white/5"
                onClick={() => router.push('/dashboard')}
              >
                <span aria-hidden="true" className="text-lg leading-none">×</span>
              </button>
            </div>
            <div className="p-4 overflow-auto h-full">
              <div className="mx-auto max-w-5xl space-y-6">
                <section className="hero flex-col gap-5">
                  <div className="space-y-4 rounded-3xl border border-white/10 bg-white/3 p-5">
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center gap-4">
                        <button
                          type="button"
                          onClick={handleAvatarButtonClick}
                          className="relative h-24 w-24 rounded-full border-2 border-white/30 bg-white/5 text-2xl font-semibold text-white flex items-center justify-center overflow-hidden"
                          aria-label="Update profile photo"
                          disabled={uploadingAvatar}
                        >
                          {avatar ? (
                            <img src={avatar} alt="Profile avatar" className="h-full w-full object-cover" />
                          ) : (
                            <span>{avatarInitials}</span>
                          )}
                          <span className="sr-only">Upload new avatar</span>
                          <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em]">
                            Edit
                          </span>
                        </button>
                        <div>
                          <p className="text-[12px] uppercase tracking-[0.35em] text-blue-200">Account control</p>
                          <h1 className="text-3xl font-semibold">My profile</h1>
                          <p className="text-sm text-blue-100/80">{displayName}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-start gap-2 text-xs text-blue-100/80">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={handleAvatarButtonClick}
                          disabled={uploadingAvatar}
                        >
                          {uploadingAvatar ? 'Uploading…' : avatar ? 'Change photo' : 'Add photo'}
                        </button>
                        <span>Tap the photo to upload</span>
                      </div>
                    </div>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={handleAvatarFileChange}
                    />
                    {avatarUploadError && <p className="text-xs text-red-400">{avatarUploadError}</p>}
                  </div>
                </section>

                {loading ? (
                  <div className="card p-6 text-center text-sm text-white">Loading…</div>
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
                            <Link className="text-blue-200 underline" href="/privacy">POPIA-compliant Privacy Policy</Link>.
                          </span>
                        </label>
                        {consentTimestamp && (
                          <p className="text-xs muted">Last consent recorded: {new Date(consentTimestamp).toLocaleString()}</p>
                        )}
                      </div>
                    </section>

                    {error && <div className="text-sm text-red-600">{error}</div>}

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <button className="btn btn-primary w-full sm:w-auto" onClick={saveProfile} disabled={saving}>
                        {saving ? 'Saving…' : 'Save changes'}
                      </button>
                      <button className="btn btn-ghost w-full sm:w-auto" onClick={fetchProfile} disabled={saving}>Reset</button>
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
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
