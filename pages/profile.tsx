import React, { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { signOut, useSession } from 'next-auth/react'
import { gradeToLabel } from '../lib/grades'

import NavArrows from '../components/NavArrows'
import FullScreenGlassOverlay from '../components/FullScreenGlassOverlay'
import ImageCropperModal from '../components/ImageCropperModal'

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

const normalizeNameField = (value: string) => {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  const stripped = collapsed.replace(/[^\p{L}\s'-]/gu, '')
  const trimmed = stripped.replace(/^[-']+|[-']+$/g, '').replace(/\s+/g, ' ').trim()
  const valid = trimmed ? /^[\p{L}]+([\s'-][\p{L}]+)*$/u.test(trimmed) : false
  const changed = trimmed !== collapsed
  return { raw: collapsed, value: trimmed, valid, changed }
}

const titleCaseWords = (value: string) => {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  return cleaned
    .split(/\s+/)
    .map(word => word
      .split(/([-'])/)
      .map(part => {
        if (!part || part === '-' || part === "'") return part
        return `${part.charAt(0).toUpperCase()}${part.slice(1)}`
      })
      .join('')
    )
    .join(' ')
}

const normalizeEmailInput = (value: string) => value.replace(/\s+/g, '').toLowerCase()

const normalizePhoneInput = (value: string) => {
  const digits = value.replace(/\D/g, '')
  if (digits.startsWith('27')) return digits.slice(0, 11)
  return digits.slice(0, 10)
}

const normalizeSchoolInput = (value: string) => titleCaseWords(value)

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
  const [schoolMode, setSchoolMode] = useState<'list' | 'manual'>('list')
  const [schoolSuggestions, setSchoolSuggestions] = useState<string[]>([])
  const [schoolLoading, setSchoolLoading] = useState(false)
  const [schoolSelectedFromList, setSchoolSelectedFromList] = useState(false)
  const [avatar, setAvatar] = useState('')
  const [profileCoverUrl, setProfileCoverUrl] = useState('')
  const [uiHandedness, setUiHandedness] = useState<'left' | 'right'>('right')
  const [popiConsent, setPopiConsent] = useState(true)
  const [consentTimestamp, setConsentTimestamp] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarUploadError, setAvatarUploadError] = useState<string | null>(null)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [coverUploadError, setCoverUploadError] = useState<string | null>(null)
  const [avatarCropFile, setAvatarCropFile] = useState<File | null>(null)
  const [coverCropFile, setCoverCropFile] = useState<File | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const coverInputRef = useRef<HTMLInputElement | null>(null)

  const [mobileHeroBgUrl, setMobileHeroBgUrl] = useState<string>(defaultMobileHeroBg)

  useEffect(() => {
    // Prefer the DB-stored theme background. Fallback to legacy localStorage value.
    if (profile?.profileThemeBgUrl && typeof profile.profileThemeBgUrl === 'string') {
      const next = profile.profileThemeBgUrl.trim()
      if (next) setMobileHeroBgUrl(next)
      return
    }
    if (typeof window === 'undefined') return
    const userKey = session?.user?.email || (session as any)?.user?.id || session?.user?.name || 'anon'
    const storageKey = `pa:mobileHeroBg:${userKey}`
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw && typeof raw === 'string') setMobileHeroBgUrl(raw)
    } catch {}
  }, [profile?.profileThemeBgUrl, session])

  useEffect(() => {
    if (schoolMode !== 'list') {
      setSchoolSuggestions([])
      setSchoolLoading(false)
      return
    }

    const query = schoolName.trim()
    if (query.length < 2) {
      setSchoolSuggestions([])
      setSchoolLoading(false)
      return
    }

    const handle = setTimeout(async () => {
      setSchoolLoading(true)
      try {
        const res = await fetch(`/api/schools?q=${encodeURIComponent(query)}`)
        if (!res.ok) throw new Error('Failed to load schools')
        const data = await res.json()
        const next = Array.isArray(data?.schools) ? data.schools : []
        setSchoolSuggestions(next)
      } catch {
        setSchoolSuggestions([])
      } finally {
        setSchoolLoading(false)
      }
    }, 200)

    return () => clearTimeout(handle)
  }, [schoolName, schoolMode])

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

  const handleCoverButtonClick = () => {
    setCoverUploadError(null)
    if (uploadingCover) return
    coverInputRef.current?.click()
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
    setAvatarUploadError(null)
    setAvatarCropFile(file)
  }

  const handleAvatarCropConfirm = async (croppedFile: File) => {
    setAvatarCropFile(null)
    setUploadingAvatar(true)
    setAvatarUploadError(null)
    try {
      const formData = new FormData()
      formData.append('file', croppedFile)
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

  const handleCoverFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setCoverUploadError('Please choose an image file.')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setCoverUploadError('Please keep images under 8 MB.')
      return
    }
    setCoverUploadError(null)
    setCoverCropFile(file)
  }

  const handleCoverCropConfirm = async (croppedFile: File) => {
    setCoverCropFile(null)
    setUploadingCover(true)
    setCoverUploadError(null)
    try {
      const formData = new FormData()
      formData.append('file', croppedFile)
      const response = await fetch('/api/profile/cover', {
        method: 'POST',
        credentials: 'same-origin',
        body: formData,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.url) {
        throw new Error(payload?.message || 'Failed to upload cover image')
      }
      setProfileCoverUrl(payload.url)
      setProfile((prev: any) => (prev ? { ...prev, profileCoverUrl: payload.url } : prev))
    } catch (err: any) {
      setCoverUploadError(err?.message || 'Unable to upload cover image right now')
    } finally {
      setUploadingCover(false)
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
        setSchoolSelectedFromList(Boolean(data.schoolName))
        setAvatar(data.avatar || '')
        setProfileCoverUrl(data.profileCoverUrl || '')
        setUiHandedness(data.uiHandedness === 'left' ? 'left' : 'right')
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
    const firstNameInput = normalizeNameField(firstName)
    const lastNameInput = normalizeNameField(lastName)
    const middleNamesInput = normalizeNameField(middleNames)
    const cleanedFirst = firstNameInput.value
    const cleanedLast = lastNameInput.value
    const cleanedMiddle = middleNamesInput.value
    const cleanedEmail = primaryEmail.trim().toLowerCase()
    const cleanedRecovery = recoveryEmail.trim().toLowerCase()
    const cleanedPhone = phoneNumber.trim()
    const cleanedAlt = alternatePhone.trim()
    const cleanedEmergency = emergencyContactPhone.trim()
    const cleanedAddress1 = addressLine1.trim()
    const cleanedCity = city.trim()
    const cleanedPostal = postalCode.trim()
    const cleanedCountry = country.trim()
    const cleanedSchool = normalizeSchoolInput(schoolName)
    const matchedSchool = schoolSuggestions.find(s => s.toLowerCase() === cleanedSchool.toLowerCase())
    const finalSchool = matchedSchool || cleanedSchool
    const cleanedId = idNumber.trim().replace(/[^0-9]/g, '')

    const primaryPhoneFormatted = normalisePhone(cleanedPhone)
    const alternatePhoneFormatted = cleanedAlt ? normalisePhone(cleanedAlt) : ''
    const emergencyPhoneFormatted = normalisePhone(cleanedEmergency)

    const errors: string[] = []
    if (!cleanedFirst) errors.push('First name is required')
    if (!cleanedLast) errors.push('Last name is required')
    if (firstNameInput.raw && (!firstNameInput.valid || firstNameInput.changed)) {
      errors.push('First name contains invalid characters or spacing')
    }
    if (lastNameInput.raw && (!lastNameInput.valid || lastNameInput.changed)) {
      errors.push('Last name contains invalid characters or spacing')
    }
    if (middleNamesInput.raw && (!middleNamesInput.valid || middleNamesInput.changed)) {
      errors.push('Other names contain invalid characters or spacing')
    }
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
    if (!finalSchool) errors.push('School or institution is required')
    if (schoolMode === 'list' && !schoolSelectedFromList && !matchedSchool) {
      errors.push('Please select your school from the list or choose manual entry')
    }
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
          schoolName: finalSchool,
          schoolSelectionMode: schoolMode,
          uiHandedness,
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
              <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5">
                <div
                  className="h-[180px] w-full"
                  style={{
                    backgroundImage: `url(${(profileCoverUrl || '').trim() || defaultMobileHeroBg})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                  aria-hidden="true"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/5 to-black/40" aria-hidden="true" />
                <button
                  type="button"
                  className="absolute top-3 right-3 inline-flex items-center justify-center h-10 w-10 rounded-xl border border-white/20 bg-white/10 backdrop-blur"
                  aria-label="Edit cover"
                  onClick={handleCoverButtonClick}
                  disabled={uploadingCover}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm18-11.5a1 1 0 0 0 0-1.41l-1.34-1.34a1 1 0 0 0-1.41 0l-1.13 1.13 3.75 3.75L21 5.75Z" fill="currentColor" />
                  </svg>
                </button>
              </div>

              <input
                ref={coverInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={handleCoverFileChange}
              />
              {coverUploadError && <p className="text-xs text-red-400">{coverUploadError}</p>}

              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={handleAvatarButtonClick}
                    className="relative w-24 h-24 aspect-square rounded-full border-2 border-white/30 bg-white/5 text-2xl font-semibold text-white flex items-center justify-center overflow-hidden flex-shrink-0"
                    aria-label="Update profile photo"
                    disabled={uploadingAvatar}
                  >
                    {avatar ? (
                      <img src={avatar} alt="Profile avatar" className="w-full h-full object-cover" />
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
                    <input className="input" value={firstName} onChange={e => setFirstName(normalizeNameField(e.target.value).value)} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Last name</label>
                    <input className="input" value={lastName} onChange={e => setLastName(normalizeNameField(e.target.value).value)} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium">Other names</label>
                    <input className="input" value={middleNames} onChange={e => setMiddleNames(normalizeNameField(e.target.value).value)} placeholder="Optional" />
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
                    <input
                      className="input"
                      value={schoolName}
                      onChange={e => {
                        setSchoolName(normalizeSchoolInput(e.target.value))
                        setSchoolSelectedFromList(false)
                      }}
                    />
                    {schoolMode === 'list' ? (
                      <div className="mt-2 rounded-xl border border-white/10 bg-white/5 p-2">
                        {schoolLoading ? (
                          <div className="text-xs muted">Searching schools…</div>
                        ) : schoolSuggestions.length > 0 ? (
                          <div className="flex flex-col gap-1 max-h-40 overflow-auto">
                            {schoolSuggestions.map(school => (
                              <button
                                key={school}
                                type="button"
                                className="text-left px-2 py-1 rounded-lg hover:bg-white/5 text-sm"
                                onClick={() => {
                                  setSchoolName(school)
                                  setSchoolSelectedFromList(true)
                                }}
                              >
                                {school}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs muted">No matching schools found.</div>
                        )}
                      </div>
                    ) : null}
                    <div className="mt-2 flex items-center gap-3 text-xs muted">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="schoolMode"
                          checked={schoolMode === 'list'}
                          onChange={() => setSchoolMode('list')}
                        />
                        Select from list
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="schoolMode"
                          checked={schoolMode === 'manual'}
                          onChange={() => setSchoolMode('manual')}
                        />
                        School not listed
                      </label>
                    </div>
                  </div>
                </div>
              </section>

              <section className="card p-6 space-y-4">
                <h2 className="text-xl font-semibold">Contact details</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium">Primary email</label>
                    <input className="input" value={primaryEmail} onChange={e => setPrimaryEmail(normalizeEmailInput(e.target.value))} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Recovery email</label>
                    <input className="input" value={recoveryEmail} onChange={e => setRecoveryEmail(normalizeEmailInput(e.target.value))} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Mobile number</label>
                    <input className="input" value={phoneNumber} onChange={e => setPhoneNumber(normalizePhoneInput(e.target.value))} placeholder="e.g. 0821234567" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Alternate phone (optional)</label>
                    <input className="input" value={alternatePhone} onChange={e => setAlternatePhone(normalizePhoneInput(e.target.value))} placeholder="e.g. 0612345678" />
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
                    <input className="input" value={emergencyContactPhone} onChange={e => setEmergencyContactPhone(normalizePhoneInput(e.target.value))} placeholder="e.g. 0831234567" />
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
                  <div>
                    <label className="block text-sm font-medium">Handedness</label>
                    <p className="mt-1 text-xs muted">Used to position small one-handed UI controls (like the grade selector).</p>
                    <div className="mt-2 inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
                      <button
                        type="button"
                        className={
                          `px-4 py-2 text-sm font-semibold rounded-lg transition ` +
                          (uiHandedness === 'left' ? 'bg-white/15 text-white' : 'text-white/75 hover:bg-white/10')
                        }
                        onClick={() => setUiHandedness('left')}
                      >
                        Left
                      </button>
                      <button
                        type="button"
                        className={
                          `px-4 py-2 text-sm font-semibold rounded-lg transition ` +
                          (uiHandedness === 'right' ? 'bg-white/15 text-white' : 'text-white/75 hover:bg-white/10')
                        }
                        onClick={() => setUiHandedness('right')}
                      >
                        Right
                      </button>
                    </div>
                  </div>
                  <label className="flex items-start space-x-2 text-sm">
                    <input type="checkbox" checked={popiConsent} onChange={e => setPopiConsent(e.target.checked)} />
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

        <FullScreenGlassOverlay
          title="My profile"
          subtitle={displayName}
          onClose={() => router.push('/dashboard')}
          onBackdropClick={() => router.push('/dashboard')}
          zIndexClassName="z-40"
          className="md:hidden"
          frameClassName="absolute inset-0 px-2 pt-3 pb-3"
          panelClassName="rounded-3xl bg-white/3"
          contentClassName="p-4"
          leftActions={
            <button
              type="button"
              className="text-sm font-semibold text-red-200 hover:text-red-100"
              onClick={() => signOut({ callbackUrl: '/' })}
            >
              Sign out
            </button>
          }
        >
          <div className="mx-auto max-w-5xl space-y-6">
                <section className="hero flex-col gap-5">
                  <div className="space-y-4 rounded-3xl border border-white/10 bg-white/3 p-5">
                    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5">
                      <div
                        className="h-[160px] w-full"
                        style={{
                          backgroundImage: `url(${(profileCoverUrl || '').trim() || defaultMobileHeroBg})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                        }}
                        aria-hidden="true"
                      />
                      <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/5 to-black/40" aria-hidden="true" />
                      <button
                        type="button"
                        className="absolute top-3 right-3 inline-flex items-center justify-center h-10 w-10 rounded-xl border border-white/20 bg-white/10 backdrop-blur"
                        aria-label="Edit cover"
                        onClick={handleCoverButtonClick}
                        disabled={uploadingCover}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm18-11.5a1 1 0 0 0 0-1.41l-1.34-1.34a1 1 0 0 0-1.41 0l-1.13 1.13 3.75 3.75L21 5.75Z" fill="currentColor" />
                        </svg>
                      </button>
                    </div>

                    <input
                      ref={coverInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={handleCoverFileChange}
                    />
                    {coverUploadError && <p className="text-xs text-red-400">{coverUploadError}</p>}

                    <div className="flex flex-col gap-4">
                      <div className="flex items-center gap-4">
                        <button
                          type="button"
                          onClick={handleAvatarButtonClick}
                          className="relative w-24 h-24 aspect-square rounded-full border-2 border-white/30 bg-white/5 text-2xl font-semibold text-white flex items-center justify-center overflow-hidden flex-shrink-0"
                          aria-label="Update profile photo"
                          disabled={uploadingAvatar}
                        >
                          {avatar ? (
                            <img src={avatar} alt="Profile avatar" className="w-full h-full object-cover" />
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
                          <input className="input" value={firstName} onChange={e => setFirstName(normalizeNameField(e.target.value).value)} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium">Last name</label>
                          <input className="input" value={lastName} onChange={e => setLastName(normalizeNameField(e.target.value).value)} />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium">Other names</label>
                          <input className="input" value={middleNames} onChange={e => setMiddleNames(normalizeNameField(e.target.value).value)} placeholder="Optional" />
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
                          <input
                            className="input"
                            value={schoolName}
                            onChange={e => {
                              setSchoolName(normalizeSchoolInput(e.target.value))
                              setSchoolSelectedFromList(false)
                            }}
                          />
                          {schoolMode === 'list' ? (
                            <div className="mt-2 rounded-xl border border-white/10 bg-white/5 p-2">
                              {schoolLoading ? (
                                <div className="text-xs muted">Searching schools…</div>
                              ) : schoolSuggestions.length > 0 ? (
                                <div className="flex flex-col gap-1 max-h-40 overflow-auto">
                                  {schoolSuggestions.map(school => (
                                    <button
                                      key={school}
                                      type="button"
                                      className="text-left px-2 py-1 rounded-lg hover:bg-white/5 text-sm"
                                      onClick={() => {
                                        setSchoolName(school)
                                        setSchoolSelectedFromList(true)
                                      }}
                                    >
                                      {school}
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-xs muted">No matching schools found.</div>
                              )}
                            </div>
                          ) : null}
                          <div className="mt-2 flex items-center gap-3 text-xs muted">
                            <label className="flex items-center gap-2">
                              <input
                                type="radio"
                                name="schoolModeMobile"
                                checked={schoolMode === 'list'}
                                onChange={() => setSchoolMode('list')}
                              />
                              Select from list
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="radio"
                                name="schoolModeMobile"
                                checked={schoolMode === 'manual'}
                                onChange={() => setSchoolMode('manual')}
                              />
                              School not listed
                            </label>
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="card p-6 space-y-4">
                      <h2 className="text-xl font-semibold">Contact details</h2>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <label className="block text-sm font-medium">Primary email</label>
                          <input className="input" value={primaryEmail} onChange={e => setPrimaryEmail(normalizeEmailInput(e.target.value))} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium">Recovery email</label>
                          <input className="input" value={recoveryEmail} onChange={e => setRecoveryEmail(normalizeEmailInput(e.target.value))} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium">Mobile number</label>
                          <input className="input" value={phoneNumber} onChange={e => setPhoneNumber(normalizePhoneInput(e.target.value))} placeholder="e.g. 0821234567" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium">Alternate phone (optional)</label>
                          <input className="input" value={alternatePhone} onChange={e => setAlternatePhone(normalizePhoneInput(e.target.value))} placeholder="e.g. 0612345678" />
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
                          <input className="input" value={emergencyContactPhone} onChange={e => setEmergencyContactPhone(normalizePhoneInput(e.target.value))} placeholder="e.g. 0831234567" />
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
        </FullScreenGlassOverlay>
      </main>

      <ImageCropperModal
        open={!!avatarCropFile}
        file={avatarCropFile}
        title="Crop profile photo"
        aspectRatio={1}
        circularCrop={true}
        onCancel={() => setAvatarCropFile(null)}
        onUseOriginal={handleAvatarCropConfirm}
        onConfirm={handleAvatarCropConfirm}
        confirmLabel="Set as avatar"
      />

      <ImageCropperModal
        open={!!coverCropFile}
        file={coverCropFile}
        title="Crop cover image"
        aspectRatio={16 / 9}
        circularCrop={false}
        onCancel={() => setCoverCropFile(null)}
        onUseOriginal={handleCoverCropConfirm}
        onConfirm={handleCoverCropConfirm}
        confirmLabel="Set as cover"
      />
    </>
  )
}
