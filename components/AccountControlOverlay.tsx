import { signOut, useSession } from 'next-auth/react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

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

type ProfileSnapshot = {
  firstName?: string
  lastName?: string
  middleNames?: string | null
  dateOfBirth?: string | null
  idNumber?: string | null
  email?: string
  recoveryEmail?: string | null
  phoneNumber?: string | null
  alternatePhone?: string | null
  emergencyContactName?: string | null
  emergencyContactRelationship?: string | null
  emergencyContactPhone?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  province?: string | null
  postalCode?: string | null
  country?: string | null
  schoolName?: string | null
  avatar?: string | null
  heroBg?: string | null
  statusBio?: string | null
  profileVisibility?: string | null
  consentToPolicies?: boolean
  consentTimestamp?: string | null
}

type Props = {
  onRequestClose: () => void
}

export default function AccountControlOverlay({ onRequestClose }: Props) {
  const { data: session } = useSession()

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [original, setOriginal] = useState<ProfileSnapshot | null>(null)

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
  const [popiConsent, setPopiConsent] = useState(true)
  const [consentTimestamp, setConsentTimestamp] = useState<string | null>(null)
  const [profileVisibility, setProfileVisibility] = useState<'shared' | 'discoverable' | 'private'>('shared')

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  const [uploadingHero, setUploadingHero] = useState(false)
  const [heroFileInputRef, setHeroFileInputRef] = useState<HTMLInputElement | null>(null)

  const [openSection, setOpenSection] = useState<string | null>(null)

  const displayName = useMemo(() => {
    if (firstName || lastName) return `${firstName} ${lastName}`.trim()
    return session?.user?.name || session?.user?.email || 'Learner'
  }, [firstName, lastName, session?.user?.email, session?.user?.name])

  useEffect(() => {
    void fetchProfile()
  }, [])

  async function fetchProfile() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/profile', { credentials: 'same-origin' })
      if (!res.ok) throw new Error('Failed to load profile')
      const data = (await res.json()) as ProfileSnapshot

      setOriginal(data)
      setFirstName(data.firstName || '')
      setLastName(data.lastName || '')
      setMiddleNames(data.middleNames || '')
      setDateOfBirth(data.dateOfBirth ? String(data.dateOfBirth).slice(0, 10) : '')
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
      setPopiConsent(Boolean(data.consentToPolicies))
      setConsentTimestamp(data.consentTimestamp || null)
      const rawVisibility = String((data as any)?.profileVisibility || 'shared').toLowerCase()
      setProfileVisibility(rawVisibility === 'private' ? 'private' : rawVisibility === 'discoverable' ? 'discoverable' : 'shared')
    } catch (err: any) {
      setError(err?.message || 'Unable to load profile')
    } finally {
      setLoading(false)
    }
  }

  function toggleSection(key: string) {
    setOpenSection(prev => (prev === key ? null : key))
  }

  async function saveProfile() {
    setError(null)
    if (!original) return

    const payload: Record<string, any> = {}

    const nextFirst = firstName.trim()
    const nextLast = lastName.trim()
    const nextMiddle = middleNames.trim()

    if ((original.firstName || '') !== nextFirst) payload.firstName = nextFirst
    if ((original.lastName || '') !== nextLast) payload.lastName = nextLast
    if ((original.middleNames || '') !== nextMiddle) payload.middleNames = nextMiddle

    const nextDob = dateOfBirth || ''
    const originalDob = original.dateOfBirth ? String(original.dateOfBirth).slice(0, 10) : ''
    if (originalDob !== nextDob) payload.dateOfBirth = nextDob

    const cleanedId = idNumber.trim().replace(/[^0-9]/g, '')
    const originalId = (original.idNumber || '').replace(/[^0-9]/g, '')
    if (originalId !== cleanedId) payload.idNumber = cleanedId

    const nextEmail = primaryEmail.trim().toLowerCase()
    if ((original.email || '').toLowerCase() !== nextEmail) {
      if (!nextEmail || !emailRegex.test(nextEmail)) {
        setError('Primary email must be valid')
        return
      }
      payload.email = nextEmail
    }

    const nextRecovery = recoveryEmail.trim().toLowerCase()
    if ((original.recoveryEmail || '').toLowerCase() !== nextRecovery) {
      if (nextRecovery && !emailRegex.test(nextRecovery)) {
        setError('Recovery email must be valid')
        return
      }
      payload.recoveryEmail = nextRecovery
    }

    const nextPhone = phoneNumber.trim()
    const originalPhone = toLocalMobile(original.phoneNumber) || ''
    if (originalPhone !== nextPhone) {
      if (nextPhone && !normalisePhone(nextPhone)) {
        setError('Primary contact number must be a valid South African mobile number (e.g. 0821234567)')
        return
      }
      payload.phoneNumber = nextPhone
    }

    const nextAlt = alternatePhone.trim()
    const originalAlt = toLocalMobile(original.alternatePhone) || ''
    if (originalAlt !== nextAlt) {
      if (nextAlt && !normalisePhone(nextAlt)) {
        setError('Alternate contact number must be valid')
        return
      }
      payload.alternatePhone = nextAlt
    }

    const nextEmergencyName = emergencyContactName.trim()
    if ((original.emergencyContactName || '') !== nextEmergencyName) payload.emergencyContactName = nextEmergencyName

    const nextEmergencyRel = emergencyContactRelationship.trim()
    if ((original.emergencyContactRelationship || '') !== nextEmergencyRel) payload.emergencyContactRelationship = nextEmergencyRel

    const nextEmergencyPhone = emergencyContactPhone.trim()
    const originalEmergencyPhone = toLocalMobile(original.emergencyContactPhone) || ''
    if (originalEmergencyPhone !== nextEmergencyPhone) {
      if (nextEmergencyPhone && !normalisePhone(nextEmergencyPhone)) {
        setError('Emergency contact number must be a valid South African mobile number')
        return
      }
      payload.emergencyContactPhone = nextEmergencyPhone
    }

    const nextAddress1 = addressLine1.trim()
    if ((original.addressLine1 || '') !== nextAddress1) payload.addressLine1 = nextAddress1

    const nextAddress2 = addressLine2.trim()
    if ((original.addressLine2 || '') !== nextAddress2) payload.addressLine2 = nextAddress2

    const nextCity = city.trim()
    if ((original.city || '') !== nextCity) payload.city = nextCity

    const nextProvince = province
    if ((original.province || '') !== nextProvince) {
      if (nextProvince && !provinceOptions.includes(nextProvince)) {
        setError('Please select your province')
        return
      }
      payload.province = nextProvince
    }

    const nextPostal = postalCode.trim()
    if ((original.postalCode || '') !== nextPostal) {
      if (nextPostal && !/^\d{4}$/.test(nextPostal)) {
        setError('Postal code must be 4 digits')
        return
      }
      payload.postalCode = nextPostal
    }

    const nextCountry = country.trim()
    if ((original.country || '') !== nextCountry) payload.country = nextCountry

    const nextSchool = schoolName.trim()
    if ((original.schoolName || '') !== nextSchool) payload.schoolName = nextSchool

    const nextVisibility = profileVisibility
    const originalVisibilityRaw = String((original as any)?.profileVisibility || 'shared').toLowerCase()
    const originalVisibility = originalVisibilityRaw === 'private' ? 'private' : originalVisibilityRaw === 'discoverable' ? 'discoverable' : 'shared'
    if (originalVisibility !== nextVisibility) payload.profileVisibility = nextVisibility

    if (Boolean(original.consentToPolicies) !== Boolean(popiConsent)) payload.popiConsent = popiConsent

    if (Object.keys(payload).length === 0) {
      onRequestClose()
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const responseJson = await res.json().catch(() => ({}))

      if (res.ok) {
        if (responseJson?.emailVerificationRequired) {
          alert('Email updated. Please verify the new email address (check your inbox for a code).')
        } else {
          alert('Saved')
        }
        await fetchProfile()
      } else {
        setError(responseJson?.errors?.join(' • ') || responseJson?.message || 'Failed to update profile')
      }
    } catch (err: any) {
      setError(err?.message || 'Network error while saving profile')
    } finally {
      setSaving(false)
    }
  }

  async function handleHeroUpload(file: File) {
    const MAX_HERO_SIZE = 8 * 1024 * 1024 // 8 MB
    
    if (!file) return

    if (file.size > MAX_HERO_SIZE) {
      setError('Background image must be under 8 MB')
      return
    }

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Only JPEG, PNG, or WEBP images are allowed')
      return
    }

    setUploadingHero(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/profile/hero-bg', {
        method: 'POST',
        credentials: 'same-origin',
        body: formData
      })

      if (res.ok) {
        const data = await res.json()
        // Update original state with new hero background
        if (original) {
          setOriginal({ ...original, heroBg: data.url })
        }
        await fetchProfile()
      } else {
        const errorData = await res.json().catch(() => ({}))
        setError(errorData?.message || 'Failed to upload background image')
        // Fallback to localStorage for mobile/unauthenticated
        try {
          const reader = new FileReader()
          reader.onloadend = () => {
            const base64 = reader.result as string
            localStorage.setItem(`pa:mobileHeroBg:${file.name}`, base64)
          }
          reader.readAsDataURL(file)
        } catch (localErr) {
          console.error('Failed to save to localStorage', localErr)
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Network error while uploading background image')
      // Fallback to localStorage
      try {
        const reader = new FileReader()
        reader.onloadend = () => {
          const base64 = reader.result as string
          localStorage.setItem(`pa:mobileHeroBg:${file.name}`, base64)
        }
        reader.readAsDataURL(file)
      } catch (localErr) {
        console.error('Failed to save to localStorage', localErr)
      }
    } finally {
      setUploadingHero(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] md:hidden" role="dialog" aria-modal="true" data-mobile-chrome-ignore>
      <div
        className="absolute inset-0 philani-overlay-backdrop philani-overlay-backdrop-enter"
        onClick={onRequestClose}
        aria-hidden="true"
      />

      <div className="absolute inset-x-2 top-3 bottom-3 rounded-3xl border border-white/10 bg-white/5 backdrop-blur shadow-2xl overflow-hidden">
        <div className="p-3 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] uppercase tracking-[0.35em] text-blue-200">Account control</p>
            <div className="text-base font-semibold text-white truncate">{displayName}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-sm font-semibold text-red-200 hover:text-red-100"
              onClick={() => signOut({ callbackUrl: '/' })}
            >
              Sign out
            </button>
            <button
              type="button"
              aria-label="Close account control"
              className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-white/15 bg-white/5 backdrop-blur"
              onClick={onRequestClose}
            >
              <span aria-hidden="true" className="text-lg leading-none">×</span>
            </button>
          </div>
        </div>

        <div className="p-3 overflow-auto h-full">
          {loading ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4 text-sm text-white/80">Loading…</div>
          ) : (
            <div className="space-y-2">
              {error && <div className="rounded-2xl border border-red-400/20 bg-red-500/10 backdrop-blur p-3 text-sm text-red-100">{error}</div>}

              {/* Hero/Background Image Section */}
              <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-3">
                <div className="text-sm font-medium text-white/90 mb-2">Profile Background</div>
                {original?.heroBg ? (
                  <div className="space-y-2">
                    <div
                      className="w-full h-32 rounded-xl bg-cover bg-center border border-white/10"
                      style={{ backgroundImage: `url(${original.heroBg})` }}
                      role="img"
                      aria-label="Current profile background"
                    />
                    <button
                      type="button"
                      className="btn btn-secondary text-xs w-full"
                      onClick={() => heroFileInputRef?.click()}
                      disabled={uploadingHero}
                    >
                      {uploadingHero ? 'Uploading…' : 'Change background'}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary text-xs w-full"
                    onClick={() => heroFileInputRef?.click()}
                    disabled={uploadingHero}
                  >
                    {uploadingHero ? 'Uploading…' : 'Upload background image'}
                  </button>
                )}
                <input
                  ref={ref => setHeroFileInputRef(ref)}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) {
                      void handleHeroUpload(file)
                    }
                    e.target.value = ''
                  }}
                />
                <p className="mt-2 text-xs text-white/60">Max 8 MB • JPEG, PNG, or WEBP</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
                <button type="button" className="w-full p-3 flex items-center justify-between" onClick={() => toggleSection('learner')}>
                  <div className="font-semibold text-white">Learner information</div>
                  <div className="text-white/70">{openSection === 'learner' ? '▲' : '▼'}</div>
                </button>
                {openSection === 'learner' && (
                  <div className="p-3 pt-0 space-y-3">
                    <div className="grid gap-3">
                      <div>
                        <label className="block text-sm font-medium text-white/90">First name</label>
                        <input className="input" value={firstName} onChange={e => setFirstName(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/90">Last name</label>
                        <input className="input" value={lastName} onChange={e => setLastName(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/90">Other names</label>
                        <input className="input" value={middleNames} onChange={e => setMiddleNames(e.target.value)} placeholder="Optional" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/90">Date of birth</label>
                        <input className="input" type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/90">South African ID (optional)</label>
                        <input className="input" value={idNumber} maxLength={13} onChange={e => setIdNumber(e.target.value.replace(/[^0-9]/g, ''))} placeholder="13 digits" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/90">School / institution</label>
                        <input className="input" value={schoolName} onChange={e => setSchoolName(e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
                <button type="button" className="w-full p-3 flex items-center justify-between" onClick={() => toggleSection('contact')}>
                  <div className="font-semibold text-white">Contact details</div>
                  <div className="text-white/70">{openSection === 'contact' ? '▲' : '▼'}</div>
                </button>
                {openSection === 'contact' && (
                  <div className="p-3 pt-0 space-y-3">
                    <div className="grid gap-3">
                      <div>
                        <label className="block text-sm font-medium text-white/90">Primary email</label>
                        <input className="input" value={primaryEmail} onChange={e => setPrimaryEmail(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/90">Recovery email</label>
                        <input className="input" value={recoveryEmail} onChange={e => setRecoveryEmail(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/90">Mobile number</label>
                        <input className="input" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} placeholder="e.g. 0821234567" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/90">Alternate phone (optional)</label>
                        <input className="input" value={alternatePhone} onChange={e => setAlternatePhone(e.target.value)} placeholder="e.g. 0612345678" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
                <button type="button" className="w-full p-3 flex items-center justify-between" onClick={() => toggleSection('emergency')}>
                  <div className="font-semibold text-white">Emergency contact</div>
                  <div className="text-white/70">{openSection === 'emergency' ? '▲' : '▼'}</div>
                </button>
                {openSection === 'emergency' && (
                  <div className="p-3 pt-0 space-y-3">
                    <div className="grid gap-3">
                      <div>
                        <label className="block text-sm font-medium text-white/90">Contact name</label>
                        <input className="input" value={emergencyContactName} onChange={e => setEmergencyContactName(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/90">Relationship</label>
                        <input className="input" value={emergencyContactRelationship} onChange={e => setEmergencyContactRelationship(e.target.value)} placeholder="e.g. Parent / Guardian" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/90">Emergency phone</label>
                        <input className="input" value={emergencyContactPhone} onChange={e => setEmergencyContactPhone(e.target.value)} placeholder="e.g. 0831234567" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
                <button type="button" className="w-full p-3 flex items-center justify-between" onClick={() => toggleSection('address')}>
                  <div className="font-semibold text-white">Residential address</div>
                  <div className="text-white/70">{openSection === 'address' ? '▲' : '▼'}</div>
                </button>
                {openSection === 'address' && (
                  <div className="p-3 pt-0 space-y-3">
                    <div className="grid gap-3">
                      <div>
                        <label className="block text-sm font-medium text-white/90">Address line 1</label>
                        <input className="input" value={addressLine1} onChange={e => setAddressLine1(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/90">Address line 2 (optional)</label>
                        <input className="input" value={addressLine2} onChange={e => setAddressLine2(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/90">City / Town</label>
                        <input className="input" value={city} onChange={e => setCity(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/90">Province</label>
                        <select className="input" value={province} onChange={e => setProvince(e.target.value)}>
                          <option value="">Select province</option>
                          {provinceOptions.map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/90">Postal code</label>
                        <input className="input" value={postalCode} onChange={e => setPostalCode(e.target.value.replace(/[^0-9]/g, ''))} maxLength={4} placeholder="4 digits" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/90">Country</label>
                        <input className="input" value={country} onChange={e => setCountry(e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
                <button type="button" className="w-full p-3 flex items-center justify-between" onClick={() => toggleSection('compliance')}>
                  <div className="font-semibold text-white">Compliance & preferences</div>
                  <div className="text-white/70">{openSection === 'compliance' ? '▲' : '▼'}</div>
                </button>
                {openSection === 'compliance' && (
                  <div className="p-3 pt-0 space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-white/90">Profile visibility</label>
                      <select
                        className="input"
                        value={profileVisibility}
                        onChange={e => {
                          const v = e.target.value
                          setProfileVisibility(v === 'private' ? 'private' : v === 'discoverable' ? 'discoverable' : 'shared')
                        }}
                      >
                        <option value="shared">Classmates & groupmates (shared groups only)</option>
                        <option value="discoverable">Discoverable (searchable by others)</option>
                        <option value="private">Private (only you + admins/instructors)</option>
                      </select>
                      <p className="mt-1 text-xs text-white/70">Discoverable makes you searchable in Discover. Shared limits viewing to shared groups. Private hides you.</p>
                    </div>
                    <label className="flex items-start space-x-2 text-sm text-white/90">
                      <input type="checkbox" checked={popiConsent} onChange={e => setPopiConsent(e.target.checked)} />
                      <span>
                        I consent to the processing of my personal information in line with the{' '}
                        <Link className="text-blue-200 underline" href="/privacy">POPIA-compliant Privacy Policy</Link>.
                      </span>
                    </label>
                    {consentTimestamp && (
                      <p className="text-xs text-white/70">Last consent recorded: {new Date(consentTimestamp).toLocaleString()}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
                <button type="button" className="w-full p-3 flex items-center justify-between" onClick={() => toggleSection('security')}>
                  <div className="font-semibold text-white">Security</div>
                  <div className="text-white/70">{openSection === 'security' ? '▲' : '▼'}</div>
                </button>
                {openSection === 'security' && (
                  <div className="p-3 pt-0 space-y-3">
                    <input className="input" placeholder="Current password" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
                    <input className="input" placeholder="New password" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                    <button
                      className="btn btn-secondary"
                      onClick={async () => {
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
                      }}
                      disabled={changingPassword}
                    >
                      {changingPassword ? 'Changing…' : 'Change password'}
                    </button>
                  </div>
                )}
              </div>

              <div className="pt-1" />
              <div className="flex flex-col gap-2">
                <button className="btn btn-primary w-full" onClick={saveProfile} disabled={saving || loading}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                <button className="btn btn-ghost w-full" onClick={fetchProfile} disabled={saving || loading}>Reset</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
