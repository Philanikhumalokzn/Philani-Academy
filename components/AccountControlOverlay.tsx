import { signOut, useSession } from 'next-auth/react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import FullScreenGlassOverlay from './FullScreenGlassOverlay'

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
    .map(word => {
      const parts = word.split(/([-'’])/)
      let lastSep = ''
      return parts
        .map(part => {
          if (!part) return part
          if (part === '-' || part === "'" || part === '’') {
            lastSep = part
            return part
          }
          const lower = part.toLowerCase()
          const isPossessive = (lastSep === "'" || lastSep === '’') && lower.length === 1
          lastSep = ''
          return isPossessive ? lower : `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`
        })
        .join('')
    })
    .join(' ')
}

const normalizeEmailInput = (value: string) => value.replace(/\s+/g, '').toLowerCase()

const normalizePhoneInput = (value: string) => {
  const digits = value.replace(/\D/g, '')
  if (digits.startsWith('27')) return digits.slice(0, 11)
  return digits.slice(0, 10)
}

const normalizeSchoolInput = (value: string) => titleCaseWords(value)

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
  profileCoverUrl?: string | null
  profileThemeBgUrl?: string | null
  statusBio?: string | null
  profileVisibility?: string | null
  discoverabilityScope?: string | null
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
  const [schoolMode, setSchoolMode] = useState<'list' | 'manual'>('list')
  const [schoolSuggestions, setSchoolSuggestions] = useState<string[]>([])
  const [schoolLoading, setSchoolLoading] = useState(false)
  const [schoolSelectedFromList, setSchoolSelectedFromList] = useState(false)
  const [profileCoverUrl, setProfileCoverUrl] = useState('')
  const [profileThemeBgUrl, setProfileThemeBgUrl] = useState('')
  const [popiConsent, setPopiConsent] = useState(true)
  const [consentTimestamp, setConsentTimestamp] = useState<string | null>(null)
  const [profileVisibility, setProfileVisibility] = useState<'shared' | 'discoverable' | 'private'>('shared')
  const [discoverabilityScope, setDiscoverabilityScope] = useState<'grade' | 'school' | 'province' | 'global'>('grade')

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  const [openSection, setOpenSection] = useState<string | null>(null)

  const displayName = useMemo(() => {
    if (firstName || lastName) return `${firstName} ${lastName}`.trim()
    return session?.user?.name || session?.user?.email || 'Learner'
  }, [firstName, lastName, session?.user?.email, session?.user?.name])

  useEffect(() => {
    void fetchProfile()
  }, [])

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
      setSchoolSelectedFromList(Boolean(data.schoolName))
      setProfileCoverUrl(String((data as any)?.profileCoverUrl || ''))
      setProfileThemeBgUrl(String((data as any)?.profileThemeBgUrl || ''))
      setPopiConsent(Boolean(data.consentToPolicies))
      setConsentTimestamp(data.consentTimestamp || null)
      const rawVisibility = String((data as any)?.profileVisibility || 'shared').toLowerCase()
      setProfileVisibility(rawVisibility === 'private' ? 'private' : rawVisibility === 'discoverable' ? 'discoverable' : 'shared')

      const rawScope = String((data as any)?.discoverabilityScope || 'grade').toLowerCase()
      setDiscoverabilityScope(rawScope === 'global' ? 'global' : rawScope === 'province' ? 'province' : rawScope === 'school' ? 'school' : 'grade')
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

    const firstNameInput = normalizeNameField(firstName)
    const lastNameInput = normalizeNameField(lastName)
    const middleNamesInput = normalizeNameField(middleNames)
    const nextFirst = firstNameInput.value
    const nextLast = lastNameInput.value
    const nextMiddle = middleNamesInput.value
    const nextSchool = normalizeSchoolInput(schoolName)
    const matchedSchool = schoolSuggestions.find(s => s.toLowerCase() === nextSchool.toLowerCase())
    const finalSchool = matchedSchool || nextSchool

    if (!nextFirst) {
      setError('First name is required')
      return
    }
    if (!nextLast) {
      setError('Last name is required')
      return
    }
    if (firstNameInput.raw && (!firstNameInput.valid || firstNameInput.changed)) {
      setError('First name contains invalid characters or spacing')
      return
    }
    if (lastNameInput.raw && (!lastNameInput.valid || lastNameInput.changed)) {
      setError('Last name contains invalid characters or spacing')
      return
    }
    if (middleNamesInput.raw && (!middleNamesInput.valid || middleNamesInput.changed)) {
      setError('Other names contain invalid characters or spacing')
      return
    }

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

    if (!finalSchool) {
      setError('School or institution is required')
      return
    }
    if (schoolMode === 'list' && !schoolSelectedFromList && !matchedSchool) {
      setError('Please select your school from the list or choose manual entry')
      return
    }
    if ((original.schoolName || '') !== finalSchool) payload.schoolName = finalSchool
    const originalSchoolMode = String((original as any)?.schoolSelectionMode || '')
    if (originalSchoolMode !== schoolMode) payload.schoolSelectionMode = schoolMode

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

    const nextCover = profileCoverUrl.trim()
    const originalCover = String((original as any)?.profileCoverUrl || '')
    if (originalCover !== nextCover) payload.profileCoverUrl = nextCover

    const nextTheme = profileThemeBgUrl.trim()
    const originalTheme = String((original as any)?.profileThemeBgUrl || '')
    if (originalTheme !== nextTheme) payload.profileThemeBgUrl = nextTheme

    const nextVisibility = profileVisibility
    const originalVisibilityRaw = String((original as any)?.profileVisibility || 'shared').toLowerCase()
    const originalVisibility = originalVisibilityRaw === 'private' ? 'private' : originalVisibilityRaw === 'discoverable' ? 'discoverable' : 'shared'
    if (originalVisibility !== nextVisibility) payload.profileVisibility = nextVisibility

    const nextScope = discoverabilityScope
    const originalScopeRaw = String((original as any)?.discoverabilityScope || 'grade').toLowerCase()
    const originalScope = originalScopeRaw === 'global' ? 'global' : originalScopeRaw === 'province' ? 'province' : originalScopeRaw === 'school' ? 'school' : 'grade'
    if (originalScope !== nextScope) payload.discoverabilityScope = nextScope

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

  return (
    <FullScreenGlassOverlay
      title={displayName}
      subtitle="Account control"
      onClose={onRequestClose}
      onBackdropClick={onRequestClose}
      closeDisabled={saving}
      zIndexClassName="z-[80]"
      className="md:hidden"
      mobileChromeIgnore
      panelClassName="rounded-3xl bg-white/5"
      contentClassName="p-0"
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
      <div className="p-3">
          {loading ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4 text-sm text-white/80">Loading…</div>
          ) : (
            <div className="space-y-2">
              {error && <div className="rounded-2xl border border-red-400/20 bg-red-500/10 backdrop-blur p-3 text-sm text-red-100">{error}</div>}

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
                        <input className="input" value={firstName} onChange={e => setFirstName(normalizeNameField(e.target.value).value)} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/90">Last name</label>
                        <input className="input" value={lastName} onChange={e => setLastName(normalizeNameField(e.target.value).value)} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/90">Other names</label>
                        <input className="input" value={middleNames} onChange={e => setMiddleNames(normalizeNameField(e.target.value).value)} placeholder="Optional" />
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
                              <div className="text-xs text-white/70">Searching schools…</div>
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
                              <div className="text-xs text-white/70">No matching schools found.</div>
                            )}
                          </div>
                        ) : null}
                        <div className="mt-2 flex items-center gap-3 text-xs text-white/70">
                          <label className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="schoolModeOverlay"
                              checked={schoolMode === 'list'}
                              onChange={() => setSchoolMode('list')}
                            />
                            Select from list
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="schoolModeOverlay"
                              checked={schoolMode === 'manual'}
                              onChange={() => setSchoolMode('manual')}
                            />
                            School not listed
                          </label>
                        </div>
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
                        <input className="input" value={primaryEmail} onChange={e => setPrimaryEmail(normalizeEmailInput(e.target.value))} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/90">Recovery email</label>
                        <input className="input" value={recoveryEmail} onChange={e => setRecoveryEmail(normalizeEmailInput(e.target.value))} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/90">Mobile number</label>
                        <input className="input" value={phoneNumber} onChange={e => setPhoneNumber(normalizePhoneInput(e.target.value))} placeholder="e.g. 0821234567" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/90">Alternate phone (optional)</label>
                        <input className="input" value={alternatePhone} onChange={e => setAlternatePhone(normalizePhoneInput(e.target.value))} placeholder="e.g. 0612345678" />
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
                        <input className="input" value={emergencyContactPhone} onChange={e => setEmergencyContactPhone(normalizePhoneInput(e.target.value))} placeholder="e.g. 0831234567" />
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

                    <div>
                      <label className="block text-sm font-medium text-white/90">Discoverability scope</label>
                      <select
                        className="input"
                        value={discoverabilityScope}
                        onChange={e => {
                          const v = String(e.target.value || '').toLowerCase()
                          setDiscoverabilityScope(v === 'global' ? 'global' : v === 'province' ? 'province' : v === 'school' ? 'school' : 'grade')
                        }}
                      >
                        <option value="grade">Grade (default)</option>
                        <option value="school">School-wide</option>
                        <option value="province">Province-wide</option>
                        <option value="global">Global</option>
                      </select>
                      <p className="mt-1 text-xs text-white/70">Only used when your visibility is set to Discoverable.</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-white/90">Profile cover photo URL (optional)</label>
                      <input className="input" value={profileCoverUrl} onChange={e => setProfileCoverUrl(e.target.value)} placeholder="https://..." />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-white/90">Profile theme background URL (optional)</label>
                      <input className="input" value={profileThemeBgUrl} onChange={e => setProfileThemeBgUrl(e.target.value)} placeholder="https://..." />
                      <p className="mt-1 text-xs text-white/70">Used as the blurred background when others view your profile.</p>
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
    </FullScreenGlassOverlay>
  )
}
