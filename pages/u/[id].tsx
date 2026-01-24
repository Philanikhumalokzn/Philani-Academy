import { getSession, useSession } from 'next-auth/react'
import type { GetServerSideProps } from 'next'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import FullScreenGlassOverlay from '../../components/FullScreenGlassOverlay'

type PublicUser = {
  id: string
  name: string
  role?: string | null
  grade?: string | null
  avatar?: string | null
  profileCoverUrl?: string | null
  profileThemeBgUrl?: string | null
  statusBio?: string | null
  schoolName?: string | null
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
        const res = await fetch(url, { credentials: 'same-origin' })
        const data = await res.json().catch(() => null)
        return { res, data }
      }

      // Prefer shared-group profile view rules, then fall back to discoverable profiles.
      let out = await tryFetch(`/api/profile/view/${encodeURIComponent(userId)}`)
      if (!out.res.ok) {
        out = await tryFetch(`/api/discover/user/${encodeURIComponent(userId)}`)
      }

      if (!out.res.ok) throw new Error(out.data?.message || 'Failed to load profile')
      const data = out.data
      setProfile({
        id: String(data?.id || userId),
        name: String(data?.name || 'User'),
        role: (data?.role as string | undefined) || null,
        grade: (data?.grade as string | undefined) || null,
        avatar: (data?.avatar as string | undefined) || null,
        profileCoverUrl: (data?.profileCoverUrl as string | undefined) || null,
        profileThemeBgUrl: (data?.profileThemeBgUrl as string | undefined) || null,
        statusBio: (data?.statusBio as string | undefined) || null,
        schoolName: (data?.schoolName as string | undefined) || null,
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

  const backgroundUrl = (profile?.profileThemeBgUrl || profile?.profileCoverUrl || '').trim()
  const canFollow = Boolean(profile && viewerId && String(profile.id) !== String(viewerId))

  return (
    <main className="mobile-dashboard-theme profile-overlay-theme min-h-screen overflow-hidden text-white">
      {backgroundUrl ? (
        <div className="absolute inset-0" style={{ backgroundImage: `url(${backgroundUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }} aria-hidden="true" />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-br from-[#020b35]/55 via-[#041448]/35 to-[#031641]/55" aria-hidden="true" />

      <FullScreenGlassOverlay
        title=""
        subtitle={undefined}
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
        panelClassName="rounded-3xl bg-white/5"
        contentClassName="p-4"
        leftActions={
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate">{profile?.name || 'Profile'}</div>
            <div className="text-xs text-white/70 truncate">Philani Academy</div>
          </div>
        }
      >
        <div className="space-y-4">
          <section className="space-y-3">
          {loading ? (
            <div className="card p-4"><div className="text-sm muted">Loading…</div></div>
          ) : error ? (
            <div className="card p-4"><div className="text-sm text-red-200">{error}</div></div>
          ) : profile ? (
            <div className="card p-4 space-y-4">
              <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5">
                <div
                  className="h-[160px] w-full"
                  style={{
                    backgroundImage: `url(${(profile.profileCoverUrl || profile.profileThemeBgUrl || '').trim()})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                  aria-hidden="true"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/5 to-black/40" aria-hidden="true" />
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex items-start gap-4">
                  <div className="h-24 w-24 rounded-full border-2 border-white/30 bg-white/5 text-2xl font-semibold text-white flex items-center justify-center overflow-hidden">
                    {profile.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={profile.avatar} alt={profile.name} className="h-full w-full object-cover" />
                    ) : (
                      <span>{profile.name.slice(0, 1).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] uppercase tracking-[0.35em] text-blue-200">Profile</p>
                    <div className="flex items-center gap-2">
                      <h1 className="text-3xl font-semibold break-words">{profile.name}</h1>
                      {profile.verified ? (
                        <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-blue-500 text-white" aria-label="Verified" title="Verified">
                          <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" aria-hidden="true">
                            <path
                              d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.12 7.18a1 1 0 0 1-1.42.006L3.29 9.01a1 1 0 1 1 1.414-1.414l3.17 3.17 6.412-6.47a1 1 0 0 1 1.418-.006z"
                              fill="currentColor"
                            />
                          </svg>
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-blue-100/80">
                      {profile.role ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1) : 'Learner'}
                      {profile.grade ? ` • ${profile.grade.replace('GRADE_', 'Grade ')}` : ''}
                    </p>
                    {profile.statusBio ? <p className="mt-2 text-sm text-white/90">{profile.statusBio}</p> : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="px-2 py-1 rounded-full border border-white/10 bg-white/5">{typeof profile.followerCount === 'number' ? profile.followerCount : 0} followers</span>
                  <span className="px-2 py-1 rounded-full border border-white/10 bg-white/5">{typeof profile.followingCount === 'number' ? profile.followingCount : 0} following</span>
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
              </div>
            </div>
          ) : null}
          </section>

          <section className="card p-4 space-y-3">
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
                onChange={(e) => setSelectedGroupId(e.target.value)}
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
                disabled={!selectedGroupId || inviteBusy || !userId}
                onClick={() => void sendInvite()}
              >
                {inviteBusy ? 'Sending…' : 'Send invite'}
              </button>
            </div>
          )}
          </section>

          <section className="card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">Timeline</div>
          </div>

          {challengesLoading ? (
            <div className="text-sm muted">Loading…</div>
          ) : challengesError ? (
            <div className="text-sm text-red-600">{challengesError}</div>
          ) : challenges.length === 0 ? (
            <div className="text-sm muted">No challenges yet.</div>
          ) : (
            <ul className="space-y-3">
              {challenges.map((c) => {
                const title = (c.title || '').trim() || 'Challenge'
                const createdAt = c.createdAt ? new Date(c.createdAt).toLocaleString() : ''

                const isSelf = Boolean(viewerId && userId && String(viewerId) === String(userId))
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
                  <li key={c.id} className="border rounded p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium break-words">{title}</div>
                        <div className="text-xs muted">
                          {createdAt}{c.grade ? ` • ${String(c.grade).replace('GRADE_', 'Grade ')}` : ''}
                        </div>
                      </div>

                      {isSelf ? (
                        <Link
                          href={`/dashboard?manageChallenge=${encodeURIComponent(String(c.id))}`}
                          className="btn btn-primary shrink-0"
                        >
                          Manage
                        </Link>
                      ) : (
                        <Link href={href} className="btn btn-primary shrink-0">
                          {buttonText}
                        </Link>
                      )}
                    </div>

                    {c.prompt ? <div className="text-sm whitespace-pre-wrap break-words">{String(c.prompt)}</div> : null}
                    {c.imageUrl ? (
                      <div className="pt-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={String(c.imageUrl)} alt={title} className="max-h-[320px] rounded border border-white/10 object-contain" />
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
          </section>
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
