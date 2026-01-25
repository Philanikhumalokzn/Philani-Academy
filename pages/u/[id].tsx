import { getSession, useSession } from 'next-auth/react'
import type { GetServerSideProps } from 'next'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import FullScreenGlassOverlay from '../../components/FullScreenGlassOverlay'
import { gradeToLabel } from '../../lib/grades'

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

type PublicUser = {
  id: string
  name: string
  email?: string | null
  firstName?: string | null
  lastName?: string | null
  middleNames?: string | null
  dateOfBirth?: string | null
  idNumber?: string | null
  role?: string | null
  grade?: string | null
  avatar?: string | null
  profileCoverUrl?: string | null
  profileThemeBgUrl?: string | null
  statusBio?: string | null
  schoolName?: string | null
  phoneNumber?: string | null
  alternatePhone?: string | null
  recoveryEmail?: string | null
  emergencyContactName?: string | null
  emergencyContactRelationship?: string | null
  emergencyContactPhone?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  province?: string | null
  postalCode?: string | null
  country?: string | null
  uiHandedness?: string | null
  consentToPolicies?: boolean
  consentTimestamp?: string | null
  verified?: boolean
  followerCount?: number
  followingCount?: number
  isFollowing?: boolean
}

type MyGroup = {
  membershipId: string
  memberRole: string
  group: {
    id: string
    name: string
    type?: string | null
    grade?: string | null
  }
}

type ProfileChallenge = {
  id: string
  title?: string | null
  prompt?: string | null
  imageUrl?: string | null
  grade?: string | null
  audience?: string | null
  attemptsOpen?: boolean
  maxAttempts?: number | null
  myAttemptCount?: number
  createdById?: string
  createdAt?: string
}

export default function PublicUserProfilePage() {
  const router = useRouter()
  const { status, data: session } = useSession()

  const userId = typeof router.query?.id === 'string' ? router.query.id : ''

  const [profile, setProfile] = useState<PublicUser | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [myGroups, setMyGroups] = useState<MyGroup[]>([])
  const [myGroupsLoading, setMyGroupsLoading] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState<string>('')
  const [inviteBusy, setInviteBusy] = useState(false)

  const [challenges, setChallenges] = useState<ProfileChallenge[]>([])
  const [challengesLoading, setChallengesLoading] = useState(false)
  const [challengesError, setChallengesError] = useState<string | null>(null)

  const [viewerId, setViewerId] = useState<string>('')
  const [followBusy, setFollowBusy] = useState(false)

  const role = ((session as any)?.user?.role as string | undefined) || 'student'
  const isPrivileged = role === 'admin' || role === 'teacher'

  const canInviteGroups = useMemo(() => {
    if (isPrivileged) return myGroups
    return myGroups.filter(m => m.memberRole === 'owner' || m.memberRole === 'instructor')
  }, [isPrivileged, myGroups])

  const loadProfile = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setError(null)
    try {
      const tryFetch = async (url: string) => {
        const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
        const data = await res.json().catch(() => null)
        return { res, data }
      }

      let out = await tryFetch(`/api/profile/view/${encodeURIComponent(userId)}`)
      if (!out.res.ok) {
        out = await tryFetch(`/api/discover/user/${encodeURIComponent(userId)}`)
      }

      if (!out.res.ok) throw new Error(out.data?.message || 'Failed to load profile')
      const data = out.data
      setProfile({
        id: String(data?.id || userId),
        name: String(data?.name || 'User'),
        email: (data?.email as string | undefined) || null,
        firstName: (data?.firstName as string | undefined) || null,
        lastName: (data?.lastName as string | undefined) || null,
        middleNames: (data?.middleNames as string | undefined) || null,
        dateOfBirth: (data?.dateOfBirth as string | undefined) || null,
        idNumber: (data?.idNumber as string | undefined) || null,
        role: (data?.role as string | undefined) || null,
        grade: (data?.grade as string | undefined) || null,
        avatar: (data?.avatar as string | undefined) || null,
        profileCoverUrl: (data?.profileCoverUrl as string | undefined) || null,
        profileThemeBgUrl: (data?.profileThemeBgUrl as string | undefined) || null,
        statusBio: (data?.statusBio as string | undefined) || null,
        schoolName: (data?.schoolName as string | undefined) || null,
        phoneNumber: (data?.phoneNumber as string | undefined) || null,
        alternatePhone: (data?.alternatePhone as string | undefined) || null,
        recoveryEmail: (data?.recoveryEmail as string | undefined) || null,
        emergencyContactName: (data?.emergencyContactName as string | undefined) || null,
        emergencyContactRelationship: (data?.emergencyContactRelationship as string | undefined) || null,
        emergencyContactPhone: (data?.emergencyContactPhone as string | undefined) || null,
        addressLine1: (data?.addressLine1 as string | undefined) || null,
        addressLine2: (data?.addressLine2 as string | undefined) || null,
        city: (data?.city as string | undefined) || null,
        province: (data?.province as string | undefined) || null,
        postalCode: (data?.postalCode as string | undefined) || null,
        country: (data?.country as string | undefined) || null,
        uiHandedness: (data?.uiHandedness as string | undefined) || null,
        consentToPolicies: Boolean(data?.consentToPolicies),
        consentTimestamp: (data?.consentTimestamp as string | undefined) || null,
        verified: Boolean(data?.verified),
        followerCount: typeof data?.followerCount === 'number' ? data.followerCount : 0,
        followingCount: typeof data?.followingCount === 'number' ? data.followingCount : 0,
        isFollowing: Boolean(data?.isFollowing),
      })
    } catch (err: any) {
      setProfile(null)
      setError(err?.message || 'Failed to load profile')
    } finally {
      setLoading(false)
    }
  }, [userId])

  const loadChallenges = useCallback(async () => {
    if (!userId) return
    setChallengesLoading(true)
    setChallengesError(null)
    try {
      const res = await fetch(`/api/profile/view/${encodeURIComponent(userId)}/challenges`, { credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setChallenges([])
        setChallengesError(data?.message || `Failed to load timeline (${res.status})`)
        return
      }
      const next = Array.isArray(data?.challenges) ? data.challenges : []
      setChallenges(next)
    } catch (err: any) {
      setChallenges([])
      setChallengesError(err?.message || 'Failed to load timeline')
    } finally {
      setChallengesLoading(false)
    }
  }, [userId])

  const loadMyGroups = useCallback(async () => {
    if (status !== 'authenticated') return
    setMyGroupsLoading(true)
    try {
      const res = await fetch('/api/groups/mine', { credentials: 'same-origin' })
      const data = await res.json().catch(() => ([]))
      if (!res.ok) {
        setMyGroups([])
        return
      }
      setMyGroups(Array.isArray(data) ? data : [])
    } catch {
      setMyGroups([])
    } finally {
      setMyGroupsLoading(false)
    }
  }, [status])

  useEffect(() => {
    if (status !== 'authenticated') return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/profile', { credentials: 'same-origin' })
        if (!res.ok) return
        const data = await res.json().catch(() => ({}))
        const nextId = typeof data?.id === 'string' ? data.id : ''
        if (!cancelled) setViewerId(nextId)
      } catch {
        // ignore
      }
    })()

    void loadProfile()
    void loadMyGroups()
    void loadChallenges()

    return () => {
      cancelled = true
    }
  }, [loadChallenges, loadMyGroups, loadProfile, status])

  useEffect(() => {
    if (!selectedGroupId) {
      const first = canInviteGroups[0]?.group?.id
      if (first) setSelectedGroupId(first)
    }
  }, [canInviteGroups, selectedGroupId])

  const sendInvite = useCallback(async () => {
    if (!userId) return
    if (!selectedGroupId) return
    setInviteBusy(true)
    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(selectedGroupId)}/invite`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.message || 'Failed to send invite')
      alert('Invitation sent')
    } catch (err: any) {
      alert(err?.message || 'Failed to send invite')
    } finally {
      setInviteBusy(false)
    }
  }, [selectedGroupId, userId])

  const toggleFollow = useCallback(async () => {
    if (!profile) return
    if (!viewerId) return
    if (String(profile.id) === String(viewerId)) return

    setFollowBusy(true)
    try {
      const method = profile.isFollowing ? 'DELETE' : 'POST'
      const res = await fetch(`/api/follow/${encodeURIComponent(profile.id)}`, {
        method,
        credentials: 'same-origin',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || 'Failed')
      setProfile(prev => (prev ? {
        ...prev,
        isFollowing: Boolean(data?.isFollowing),
        followerCount: typeof data?.followerCount === 'number' ? data.followerCount : prev.followerCount,
        followingCount: typeof data?.followingCount === 'number' ? data.followingCount : prev.followingCount,
      } : prev))
    } catch (err: any) {
      alert(err?.message || 'Failed')
    } finally {
      setFollowBusy(false)
    }
  }, [profile, viewerId])

  if (status === 'loading') return null

  const resolveProfileImageUrl = (value?: string | null) => {
    const raw = String(value || '').trim()
    if (!raw) return ''
    if (raw.startsWith('data:')) return raw
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
    if (raw.startsWith('//')) return `https:${raw}`
    if (raw.startsWith('/')) return raw
    return `/${raw}`
  }

  const backgroundUrl = resolveProfileImageUrl(profile?.profileThemeBgUrl)
    || resolveProfileImageUrl(profile?.profileCoverUrl)
    || defaultMobileHeroBg
  const heroCoverUrl = resolveProfileImageUrl(profile?.profileCoverUrl)
    || resolveProfileImageUrl(profile?.profileThemeBgUrl)
    || defaultMobileHeroBg
  const canFollow = Boolean(profile && viewerId && String(profile.id) !== String(viewerId))

  const safeInputValue = (value?: string | null) => String(value || '')
  const formatDateForInput = (value?: string | null) => {
    if (!value) return ''
    const dt = new Date(value)
    if (Number.isNaN(dt.getTime())) return ''
    const yyyy = dt.getFullYear()
    const mm = String(dt.getMonth() + 1).padStart(2, '0')
    const dd = String(dt.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }
  const displayName = profile?.name || 'Profile'
  const gradeLabel = profile?.grade ? gradeToLabel(profile.grade as any) : 'Unassigned'

  return (
    <main className="mobile-dashboard-theme profile-overlay-theme min-h-screen overflow-hidden text-white">
      {backgroundUrl ? (
        <div className="absolute inset-0" style={{ backgroundImage: `url(\"${backgroundUrl}\")`, backgroundSize: 'cover', backgroundPosition: 'center' }} aria-hidden="true" />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-br from-[#020b35]/55 via-[#041448]/35 to-[#031641]/55" aria-hidden="true" />

      <FullScreenGlassOverlay
        title="Profile"
        subtitle={displayName}
        onClose={() => {
          if (typeof window !== 'undefined' && window.history.length > 1) window.history.back()
          else void router.push('/dashboard?panel=discover')
        }}
        onBackdropClick={() => {
          if (typeof window !== 'undefined' && window.history.length > 1) window.history.back()
          else void router.push('/dashboard?panel=discover')
        }}
        zIndexClassName="z-40"
        frameClassName="absolute inset-0 px-2 pt-3 pb-3"
        panelClassName="rounded-3xl bg-white/3"
        contentClassName="p-4"
      >
        <div className="mx-auto max-w-5xl space-y-6">
          <section className="hero flex-col gap-5">
            <div className="space-y-4 rounded-3xl border border-white/10 bg-white/3 p-5">
              <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5">
                <div
                  className="h-[160px] w-full"
                  style={{
                    backgroundImage: `url(\"${heroCoverUrl}\")`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                  aria-hidden="true"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/5 to-black/40" aria-hidden="true" />
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <div className="relative h-24 w-24 rounded-full border-2 border-white/30 bg-white/5 text-2xl font-semibold text-white flex items-center justify-center overflow-hidden">
                    {profile?.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={profile.avatar} alt={displayName} className="h-full w-full object-cover" />
                    ) : (
                      <span>{displayName.slice(0, 1).toUpperCase()}</span>
                    )}
                  </div>
                  <div>
                    <p className="text-[12px] uppercase tracking-[0.35em] text-blue-200">Account control</p>
                    <h1 className="text-3xl font-semibold">{displayName}</h1>
                    <p className="text-sm text-blue-100/80">
                      {profile?.role ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1) : 'Learner'}
                      {profile?.grade ? ` • ${gradeLabel}` : ''}
                    </p>
                  </div>
                </div>
                {profile?.statusBio ? <p className="text-sm text-white/90">{profile.statusBio}</p> : null}
              </div>
            </div>
          </section>

          {loading ? (
            <div className="card p-6 text-center text-sm text-white">Loading…</div>
          ) : error ? (
            <div className="card p-6 text-center text-sm text-red-200">{error}</div>
          ) : profile ? (
            <div className="space-y-6">
              <section className="card p-6 space-y-4">
                <h2 className="text-xl font-semibold">Visitor actions</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-1 rounded-full border border-white/10 bg-white/5 text-xs">
                    {typeof profile.followerCount === 'number' ? profile.followerCount : 0} followers
                  </span>
                  <span className="px-2 py-1 rounded-full border border-white/10 bg-white/5 text-xs">
                    {typeof profile.followingCount === 'number' ? profile.followingCount : 0} following
                  </span>
                </div>
                {canFollow ? (
                  <div>
                    <button
                      type="button"
                      className={profile.isFollowing ? 'btn btn-secondary' : 'btn btn-primary'}
                      disabled={followBusy}
                      onClick={() => void toggleFollow()}
                    >
                      {followBusy ? '…' : profile.isFollowing ? 'Following' : 'Follow'}
                    </button>
                  </div>
                ) : null}

                <div className="pt-3 border-t border-white/10 space-y-3">
                  <div className="text-sm font-semibold">Invite to your group</div>
                  {myGroupsLoading ? (
                    <div className="text-sm muted">Loading your groups…</div>
                  ) : canInviteGroups.length === 0 ? (
                    <div className="text-sm muted">You don’t have any groups you can invite people to.</div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <select
                        className="input"
                        value={selectedGroupId}
                        onChange={e => setSelectedGroupId(e.target.value)}
                      >
                        {canInviteGroups.map(m => (
                          <option key={m.group.id} value={m.group.id}>
                            {m.group.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={!selectedGroupId || inviteBusy}
                        onClick={() => void sendInvite()}
                      >
                        {inviteBusy ? 'Sending…' : 'Send invite'}
                      </button>
                    </div>
                  )}
                </div>
              </section>

              <section className="card p-6 space-y-4">
                <h2 className="text-xl font-semibold">Learner information</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium">First name</label>
                    <input className="input" value={safeInputValue(profile.firstName)} disabled />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Last name</label>
                    <input className="input" value={safeInputValue(profile.lastName)} disabled />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium">Other names</label>
                    <input className="input" value={safeInputValue(profile.middleNames)} disabled />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Date of birth</label>
                    <input className="input" type="date" value={formatDateForInput(profile.dateOfBirth)} disabled />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">South African ID (optional)</label>
                    <input className="input" value={safeInputValue(profile.idNumber)} disabled />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Grade</label>
                    <input className="input" value={gradeLabel} disabled />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">School / institution</label>
                    <input className="input" value={safeInputValue(profile.schoolName)} disabled />
                  </div>
                </div>
              </section>

              <section className="card p-6 space-y-4">
                <h2 className="text-xl font-semibold">Contact details</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium">Primary email</label>
                    <input className="input" value={safeInputValue(profile.email)} disabled />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Recovery email</label>
                    <input className="input" value={safeInputValue(profile.recoveryEmail)} disabled />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Mobile number</label>
                    <input className="input" value={safeInputValue(profile.phoneNumber)} disabled />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Alternate phone (optional)</label>
                    <input className="input" value={safeInputValue(profile.alternatePhone)} disabled />
                  </div>
                </div>
              </section>

              <section className="card p-6 space-y-4">
                <h2 className="text-xl font-semibold">Emergency contact</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium">Contact name</label>
                    <input className="input" value={safeInputValue(profile.emergencyContactName)} disabled />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Relationship</label>
                    <input className="input" value={safeInputValue(profile.emergencyContactRelationship)} disabled />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium">Emergency phone</label>
                    <input className="input" value={safeInputValue(profile.emergencyContactPhone)} disabled />
                  </div>
                </div>
              </section>

              <section className="card p-6 space-y-4">
                <h2 className="text-xl font-semibold">Residential address</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium">Address line 1</label>
                    <input className="input" value={safeInputValue(profile.addressLine1)} disabled />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium">Address line 2 (optional)</label>
                    <input className="input" value={safeInputValue(profile.addressLine2)} disabled />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">City / Town</label>
                    <input className="input" value={safeInputValue(profile.city)} disabled />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Province</label>
                    <input className="input" value={safeInputValue(profile.province)} disabled />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Postal code</label>
                    <input className="input" value={safeInputValue(profile.postalCode)} disabled />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Country</label>
                    <input className="input" value={safeInputValue(profile.country)} disabled />
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
                          (profile.uiHandedness === 'left' ? 'bg-white/15 text-white' : 'text-white/75')
                        }
                        disabled
                      >
                        Left
                      </button>
                      <button
                        type="button"
                        className={
                          `px-4 py-2 text-sm font-semibold rounded-lg transition ` +
                          (profile.uiHandedness === 'right' ? 'bg-white/15 text-white' : 'text-white/75')
                        }
                        disabled
                      >
                        Right
                      </button>
                    </div>
                  </div>
                  <label className="flex items-start space-x-2 text-sm">
                    <input type="checkbox" checked={Boolean(profile.consentToPolicies)} readOnly disabled />
                    <span>I consent to the processing of my personal information in line with the POPIA-compliant Privacy Policy.</span>
                  </label>
                  {profile.consentTimestamp ? (
                    <p className="text-xs muted">Last consent recorded: {new Date(profile.consentTimestamp).toLocaleString()}</p>
                  ) : null}
                </div>
              </section>

              <section className="card p-6 space-y-3">
                <h2 className="text-xl font-semibold">Timeline</h2>
                {challengesLoading ? (
                  <div className="text-sm muted">Loading timeline…</div>
                ) : challengesError ? (
                  <div className="text-sm text-red-200">{challengesError}</div>
                ) : challenges.length === 0 ? (
                  <div className="text-sm muted">No challenges yet.</div>
                ) : (
                  <div className="space-y-2">
                    {challenges.map(c => {
                      const createdAt = c.createdAt ? new Date(c.createdAt).toLocaleString() : ''
                      const myAttemptCount = typeof c?.myAttemptCount === 'number' ? c.myAttemptCount : 0
                      const maxAttempts = typeof c?.maxAttempts === 'number' ? c.maxAttempts : null
                      const attemptsOpen = c?.attemptsOpen !== false
                      const hasAttempted = myAttemptCount > 0
                      const canAttempt = attemptsOpen && (maxAttempts === null || myAttemptCount < maxAttempts)
                      const buttonText = hasAttempted && !canAttempt ? 'View Response' : 'Attempt'
                      const href = hasAttempted && !canAttempt
                        ? `/dashboard?viewUserChallenge=${encodeURIComponent(String(c.id))}&userId=${encodeURIComponent(userId)}`
                        : `/challenges/${encodeURIComponent(String(c.id))}`

                      return (
                        <div key={String(c.id)} className="rounded-xl border border-white/10 bg-white/5 p-3">
                          <div className="text-sm font-semibold">{c.title || 'Challenge'}</div>
                          {createdAt ? <div className="text-xs text-white/60">{createdAt}</div> : null}
                          <div className="mt-2">
                            <Link href={href} className="btn btn-primary">
                              {buttonText}
                            </Link>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </div>
      </FullScreenGlassOverlay>
    </main>
  )
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const session = await getSession(ctx)
  if (!session) {
    return {
      redirect: { destination: '/', permanent: false },
    }
  }
  return { props: {} }
}
