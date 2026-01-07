import { getSession, useSession } from 'next-auth/react'
import type { GetServerSideProps } from 'next'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useMemo, useState } from 'react'

type PublicUser = {
  id: string
  name: string
  role?: string | null
  grade?: string | null
  avatar?: string | null
  statusBio?: string | null
  schoolName?: string | null
  verified?: boolean
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
        statusBio: (data?.statusBio as string | undefined) || null,
        schoolName: (data?.schoolName as string | undefined) || null,
        verified: Boolean(data?.verified),
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
    void loadProfile()
    void loadMyGroups()
    void loadChallenges()
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

  if (status === 'loading') return null

  return (
    <main className="deep-page min-h-screen pb-16">
      <div className="max-w-3xl mx-auto px-4 lg:px-8 py-8 space-y-4">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            if (typeof window !== 'undefined' && window.history.length > 1) window.history.back()
            else void router.push('/dashboard?panel=discover')
          }}
        >
          Back
        </button>

        <section className="card p-4">
          {loading ? (
            <div className="text-sm muted">Loading…</div>
          ) : error ? (
            <div className="text-sm text-red-600">{error}</div>
          ) : profile ? (
            <div className="flex items-start gap-4">
              <div className="h-14 w-14 rounded-2xl border border-white/10 bg-white/5 overflow-hidden flex items-center justify-center">
                {profile.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profile.avatar} alt={profile.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-lg font-semibold">{profile.name.slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="text-lg font-semibold truncate">{profile.name}</div>
                  {profile.verified ? (
                    <span className="text-xs px-2 py-0.5 rounded-full border border-white/10 bg-white/5">Verified</span>
                  ) : null}
                </div>
                <div className="text-sm muted">
                  {(profile.schoolName || '').trim() ? profile.schoolName : '—'}
                  {profile.grade ? ` • ${profile.grade.replace('GRADE_', 'Grade ')}` : ''}
                </div>
                {profile.statusBio ? <div className="mt-2 text-sm">{profile.statusBio}</div> : null}
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
                return (
                  <li key={c.id} className="border rounded p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium break-words">{title}</div>
                        <div className="text-xs muted">
                          {createdAt}{c.grade ? ` • ${String(c.grade).replace('GRADE_', 'Grade ')}` : ''}
                        </div>
                      </div>
                      <Link href={`/challenges/${encodeURIComponent(String(c.id))}`} className="btn btn-primary shrink-0">
                        Attempt
                      </Link>
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
