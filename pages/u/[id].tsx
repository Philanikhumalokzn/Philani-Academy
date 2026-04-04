import { useSession } from 'next-auth/react'
import type { GetServerSideProps } from 'next'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import ZoomableImageOverlay from '../../components/ZoomableImageOverlay'
import { gradeToLabel } from '../../lib/grades'

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

type ProfilePost = {
  id: string
  title?: string | null
  prompt?: string | null
  imageUrl?: string | null
  grade?: string | null
  audience?: string | null
  createdAt?: string | null
  createdById?: string | null
  solutionCount?: number
  hasOwnResponse?: boolean
  threadKey?: string
}

type ProfileChallenge = {
  id: string
  title?: string | null
  prompt?: string | null
  imageUrl?: string | null
  createdAt?: string | null
}

type DiscoverProfile = {
  id: string
  name: string
  role?: string | null
  grade?: string | null
  avatar?: string | null
  schoolName?: string | null
  verified?: boolean
  sharedGroupsCount?: number
}

type ProfileTab = 'all' | 'photos' | 'reels'

const defaultMobileHeroBg = (() => {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fbfbfa"/>
      <stop offset="1" stop-color="#f3f5f9"/>
    </linearGradient>
    <pattern id="lines" width="120" height="36" patternUnits="userSpaceOnUse">
      <rect width="120" height="36" fill="url(#paper)"/>
      <line x1="0" y1="28" x2="120" y2="28" stroke="#d8e5f6" stroke-width="2"/>
    </pattern>
  </defs>
  <rect width="1920" height="1080" fill="url(#lines)"/>
</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
})()

const roleLabel = (value?: string | null) => {
  const raw = String(value || '').trim()
  if (!raw) return 'Learner'
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

const resolveImageUrl = (value?: string | null) => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.startsWith('data:')) return raw
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  if (raw.startsWith('//')) return `https:${raw}`
  if (raw.startsWith('/')) return raw
  return `/${raw}`
}

const formatShortDate = (value?: string | null) => {
  if (!value) return ''
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(dt).replace(/,/g, '')
}

const extractInitials = (name: string) => {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'U'
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase()
  return `${words[0].slice(0, 1)}${words[1].slice(0, 1)}`.toUpperCase()
}

export default function PublicUserProfilePage() {
  const router = useRouter()
  const { status, data: session } = useSession()

  const userId = typeof router.query?.id === 'string' ? router.query.id : ''

  const [profile, setProfile] = useState<PublicUser | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const [posts, setPosts] = useState<ProfilePost[]>([])
  const [postsLoading, setPostsLoading] = useState(false)
  const [postsError, setPostsError] = useState<string | null>(null)

  const [challenges, setChallenges] = useState<ProfileChallenge[]>([])
  const [challengesLoading, setChallengesLoading] = useState(false)

  const [discoverProfiles, setDiscoverProfiles] = useState<DiscoverProfile[]>([])
  const [discoverLoading, setDiscoverLoading] = useState(false)

  const [viewerId, setViewerId] = useState('')
  const [followBusy, setFollowBusy] = useState(false)
  const [activeTab, setActiveTab] = useState<ProfileTab>('all')
  const [imageViewer, setImageViewer] = useState<{ url: string; title: string } | null>(null)

  const loadProfile = useCallback(async () => {
    if (!userId) return
    setProfileLoading(true)
    setProfileError(null)
    try {
      const res = await fetch(`/api/profile/view/${encodeURIComponent(userId)}`, { credentials: 'same-origin', cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || 'Failed to load profile')
      setProfile({
        id: String(data?.id || userId),
        name: String(data?.name || 'User'),
        role: typeof data?.role === 'string' ? data.role : null,
        grade: typeof data?.grade === 'string' ? data.grade : null,
        avatar: typeof data?.avatar === 'string' ? data.avatar : null,
        profileCoverUrl: typeof data?.profileCoverUrl === 'string' ? data.profileCoverUrl : null,
        profileThemeBgUrl: typeof data?.profileThemeBgUrl === 'string' ? data.profileThemeBgUrl : null,
        statusBio: typeof data?.statusBio === 'string' ? data.statusBio : null,
        schoolName: typeof data?.schoolName === 'string' ? data.schoolName : null,
        verified: Boolean(data?.verified),
        followerCount: typeof data?.followerCount === 'number' ? data.followerCount : 0,
        followingCount: typeof data?.followingCount === 'number' ? data.followingCount : 0,
        isFollowing: Boolean(data?.isFollowing),
      })
    } catch (err: any) {
      setProfile(null)
      setProfileError(err?.message || 'Failed to load profile')
    } finally {
      setProfileLoading(false)
    }
  }, [userId])

  const loadPosts = useCallback(async () => {
    if (!userId) return
    setPostsLoading(true)
    setPostsError(null)
    try {
      const res = await fetch(`/api/profile/view/${encodeURIComponent(userId)}/posts`, { credentials: 'same-origin', cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || 'Failed to load posts')
      setPosts(Array.isArray(data?.posts) ? data.posts : [])
    } catch (err: any) {
      setPosts([])
      setPostsError(err?.message || 'Failed to load posts')
    } finally {
      setPostsLoading(false)
    }
  }, [userId])

  const loadChallenges = useCallback(async () => {
    if (!userId) return
    setChallengesLoading(true)
    try {
      const res = await fetch(`/api/profile/view/${encodeURIComponent(userId)}/challenges`, { credentials: 'same-origin', cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setChallenges([])
        return
      }
      setChallenges(Array.isArray(data?.challenges) ? data.challenges : [])
    } catch {
      setChallenges([])
    } finally {
      setChallengesLoading(false)
    }
  }, [userId])

  const loadDiscoverProfiles = useCallback(async () => {
    if (status !== 'authenticated') {
      setDiscoverProfiles([])
      return
    }
    setDiscoverLoading(true)
    try {
      const res = await fetch('/api/discover/users?limit=8', { credentials: 'same-origin', cache: 'no-store' })
      const data = await res.json().catch(() => ([]))
      if (!res.ok) {
        setDiscoverProfiles([])
        return
      }
      const nextProfiles = (Array.isArray(data) ? data : [])
        .filter((item: any) => String(item?.id || '') !== String(userId || ''))
        .slice(0, 8)
      setDiscoverProfiles(nextProfiles)
    } catch {
      setDiscoverProfiles([])
    } finally {
      setDiscoverLoading(false)
    }
  }, [status, userId])

  useEffect(() => {
    void loadProfile()
    void loadPosts()
    void loadChallenges()
  }, [loadChallenges, loadPosts, loadProfile])

  useEffect(() => {
    if (status !== 'authenticated') {
      setViewerId('')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/profile', { credentials: 'same-origin', cache: 'no-store' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || cancelled) return
        setViewerId(typeof data?.id === 'string' ? data.id : '')
      } catch {
        if (!cancelled) setViewerId('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [status])

  useEffect(() => {
    void loadDiscoverProfiles()
  }, [loadDiscoverProfiles])

  const displayName = profile?.name || 'Profile'
  const profileHandle = `@${displayName.replace(/[^a-zA-Z0-9]+/g, '').trim() || 'profile'}`
  const coverUrl = resolveImageUrl(profile?.profileCoverUrl) || resolveImageUrl(profile?.profileThemeBgUrl) || defaultMobileHeroBg
  const avatarUrl = resolveImageUrl(profile?.avatar)
  const isSelf = Boolean(profile && viewerId && String(profile.id) === String(viewerId))
  const canFollow = Boolean(profile && viewerId && !isSelf)
  const gradeLabel = profile?.grade ? gradeToLabel(profile.grade as any) : null

  const photoPosts = useMemo(
    () => posts.filter((post) => Boolean(resolveImageUrl(post.imageUrl))),
    [posts],
  )

  const reelItems = useMemo(
    () => challenges.filter((challenge) => Boolean(resolveImageUrl(challenge.imageUrl))),
    [challenges],
  )

  const handleBack = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
      return
    }
    void router.push('/dashboard?panel=discover')
  }, [router])

  const toggleFollow = useCallback(async () => {
    if (!profile || !viewerId || isSelf) return
    setFollowBusy(true)
    try {
      const method = profile.isFollowing ? 'DELETE' : 'POST'
      const res = await fetch(`/api/follow/${encodeURIComponent(profile.id)}`, {
        method,
        credentials: 'same-origin',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || 'Failed to update follow state')
      setProfile((current) => (current ? {
        ...current,
        isFollowing: Boolean(data?.isFollowing),
        followerCount: typeof data?.followerCount === 'number' ? data.followerCount : current.followerCount,
      } : current))
    } catch (err: any) {
      alert(err?.message || 'Failed to update follow state')
    } finally {
      setFollowBusy(false)
    }
  }, [isSelf, profile, viewerId])

  const openImageViewer = useCallback((url: string, title: string) => {
    if (!url) return
    setImageViewer({ url, title })
  }, [])

  const closeImageViewer = useCallback(() => {
    setImageViewer(null)
  }, [])

  const renderPostCard = (post: ProfilePost) => {
    const postImageUrl = resolveImageUrl(post.imageUrl)
    return (
      <article key={post.id} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_16px_36px_rgba(15,23,42,0.08)]">
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-sm font-semibold text-slate-700">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
              ) : (
                <span>{extractInitials(displayName)}</span>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="truncate text-[15px] font-semibold tracking-[-0.02em] text-slate-900">{displayName}</div>
                {profile?.verified ? (
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#1877f2] text-white" aria-label="Verified" title="Verified">
                    <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" aria-hidden="true">
                      <path d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.12 7.18a1 1 0 0 1-1.42.006L3.29 9.01a1 1 0 1 1 1.414-1.414l3.17 3.17 6.412-6.47a1 1 0 0 1 1.418-.006z" fill="currentColor" />
                    </svg>
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[12px] font-medium text-slate-500">
                <span>{formatShortDate(post.createdAt)}</span>
                <span className="inline-flex h-4 w-4 items-center justify-center text-slate-400">
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
                    <path d="M9.75 2.5a7.25 7.25 0 1 0 0 14.5 7.25 7.25 0 0 0 0-14.5Zm0 0c1.57 1.55 2.45 3.67 2.45 5.87 0 2.2-.88 4.32-2.45 5.88m0-11.75c-1.57 1.55-2.45 3.67-2.45 5.87 0 2.2.88 4.32 2.45 5.88m-6.1-5.88h12.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </div>
            </div>
          </div>
          <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600" aria-label="More options">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor" aria-hidden="true">
              <circle cx="4" cy="10" r="1.6" />
              <circle cx="10" cy="10" r="1.6" />
              <circle cx="16" cy="10" r="1.6" />
            </svg>
          </button>
        </div>

        <div className="px-5 pb-4 pt-4">
          {post.title ? <h3 className="text-[18px] font-semibold tracking-[-0.03em] text-slate-900">{post.title}</h3> : null}
          {post.prompt ? <p className="mt-2 whitespace-pre-wrap text-[15px] leading-7 text-slate-700">{post.prompt}</p> : null}
        </div>

        {postImageUrl ? (
          <button
            type="button"
            className="block w-full overflow-hidden bg-slate-100 text-left"
            onClick={() => openImageViewer(postImageUrl, post.title || `${displayName} post image`)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={postImageUrl} alt={post.title || 'Post image'} className="max-h-[34rem] w-full object-cover" />
          </button>
        ) : null}

        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-[13px] font-medium text-slate-500">
          <span>{Number(post.solutionCount || 0)} replies</span>
          <span>{post.audience === 'public' ? 'Public post' : post.audience === 'grade' ? 'Grade post' : 'Shared post'}</span>
        </div>
      </article>
    )
  }

  const renderPhotoGrid = () => {
    if (postsLoading) return <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">Loading photos...</div>
    if (photoPosts.length === 0) return <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">No photos yet.</div>
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photoPosts.map((post) => {
          const postImageUrl = resolveImageUrl(post.imageUrl)
          return (
            <button
              key={post.id}
              type="button"
              className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_12px_28px_rgba(15,23,42,0.08)]"
              onClick={() => openImageViewer(postImageUrl, post.title || `${displayName} photo`)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={postImageUrl} alt={post.title || 'Photo'} className="aspect-square w-full object-cover" />
            </button>
          )
        })}
      </div>
    )
  }

  const renderReels = () => {
    if (challengesLoading) return <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">Loading reels...</div>
    if (reelItems.length === 0) return <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">No reels yet.</div>
    return (
      <div className="space-y-4">
        {reelItems.map((item) => {
          const imageUrl = resolveImageUrl(item.imageUrl)
          return (
            <article key={item.id} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_16px_36px_rgba(15,23,42,0.08)]">
              <button type="button" className="block w-full text-left" onClick={() => openImageViewer(imageUrl, item.title || 'Reel')}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt={item.title || 'Reel'} className="max-h-[36rem] w-full object-cover" />
              </button>
              <div className="px-5 py-4">
                <div className="text-[17px] font-semibold tracking-[-0.03em] text-slate-900">{item.title || 'Reel'}</div>
                {item.prompt ? <p className="mt-2 text-[15px] leading-7 text-slate-700">{item.prompt}</p> : null}
              </div>
            </article>
          )
        })}
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,#f5f8fd_30%,#f7f8fb_100%)] text-slate-900">
      <div className="min-h-screen pb-[calc(var(--app-safe-bottom)+2rem)]">
        <section className="relative w-full overflow-hidden bg-slate-900">
          <div className="absolute inset-0" style={{ backgroundImage: `url("${coverUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center' }} aria-hidden="true" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.42)_0%,rgba(0,0,0,0.18)_30%,rgba(0,0,0,0.32)_100%)]" aria-hidden="true" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.7)_72%,#ffffff_100%)]" aria-hidden="true" />
          <div className="relative min-h-[17rem] px-4 pb-32 pt-[calc(var(--app-safe-top)+0.85rem)] sm:min-h-[20rem] sm:px-6">
            <div className="mx-auto flex max-w-5xl items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleBack}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white shadow-[0_10px_24px_rgba(0,0,0,0.24)] backdrop-blur-sm transition hover:bg-black/50"
                  aria-label="Go back"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                    <path d="M15 18 9 12l6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white shadow-[0_10px_24px_rgba(0,0,0,0.24)] backdrop-blur-sm transition hover:bg-black/50"
                  aria-label="Search profile"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                    <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                    <path d="m16 16 4.25 4.25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white shadow-[0_10px_24px_rgba(0,0,0,0.24)] backdrop-blur-sm transition hover:bg-black/50"
                  aria-label="More options"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                    <circle cx="5" cy="12" r="1.8" />
                    <circle cx="12" cy="12" r="1.8" />
                    <circle cx="19" cy="12" r="1.8" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="relative -mt-24 bg-transparent">
          <div className="mx-auto w-full max-w-5xl">
            <div className="relative px-4 pb-5 pt-0 sm:px-6">
              <div className="absolute inset-x-0 bottom-0 top-20 bg-white sm:top-24" aria-hidden="true" />
              <div className="flex flex-col gap-4">
                <div className="relative flex items-end justify-between gap-4">
                  <div className="-mt-10 flex min-w-0 flex-1 items-end gap-4 sm:-mt-12">
                    <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-[5px] border-white bg-slate-100 text-2xl font-semibold text-slate-700 shadow-[0_12px_24px_rgba(15,23,42,0.18)] sm:h-32 sm:w-32">
                      <div className="h-full w-full overflow-hidden rounded-full bg-slate-100">
                        {avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <span>{extractInitials(displayName)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="min-w-0 pb-1 pt-16 sm:pt-20">
                      <div className="flex items-center gap-2">
                        <h1 className="truncate text-[28px] font-semibold tracking-[-0.04em] text-slate-900 sm:text-[34px]">{displayName}</h1>
                        {profile?.verified ? (
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#1d9bf0] text-white" aria-label="Verified" title="Verified">
                            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
                              <path d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.12 7.18a1 1 0 0 1-1.42.006L3.29 9.01a1 1 0 1 1 1.414-1.414l3.17 3.17 6.412-6.47a1 1 0 0 1 1.418-.006z" fill="currentColor" />
                            </svg>
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-[15px] font-medium text-slate-500">{profileHandle}</div>
                      <div className="mt-2 text-[15px] font-medium text-slate-500">
                        {roleLabel(profile?.role)}
                        {gradeLabel ? ` • ${gradeLabel}` : ''}
                        {profile?.schoolName ? ` • ${profile.schoolName}` : ''}
                      </div>
                    </div>
                  </div>

                  {profileLoading ? null : isSelf ? (
                    <button type="button" className="inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:bg-slate-50">
                      Edit profile
                    </button>
                  ) : canFollow ? (
                    <button
                      type="button"
                      className={`inline-flex h-10 shrink-0 items-center justify-center rounded-full px-5 text-sm font-semibold transition ${profile?.isFollowing ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
                      onClick={() => void toggleFollow()}
                      disabled={followBusy}
                    >
                      {followBusy ? 'Working...' : profile?.isFollowing ? 'Following' : 'Follow'}
                    </button>
                  ) : null}
                </div>

                {profile?.statusBio ? <p className="relative max-w-3xl text-[15px] leading-7 text-slate-700">{profile?.statusBio}</p> : null}

                <div className="relative flex flex-wrap items-center gap-4 text-[14px] font-medium text-slate-500">
                  <span><span className="font-semibold text-slate-900">{Number(profile?.followingCount || 0)}</span> Following</span>
                  <span><span className="font-semibold text-slate-900">{Number(profile?.followerCount || 0)}</span> Followers</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="mx-auto w-full max-w-5xl">
        <section className="border-t border-slate-200 bg-white px-4 pt-3 sm:px-6">
          <div className="flex items-center gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {(['all', 'photos', 'reels'] as ProfileTab[]).map((tab) => {
              const active = activeTab === tab
              const label = tab === 'all' ? 'All' : tab === 'photos' ? 'Photos' : 'Reels'
              return (
                <button
                  key={tab}
                  type="button"
                  className={`relative shrink-0 px-4 py-3 text-[15px] font-semibold tracking-[-0.02em] transition ${active ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {label}
                  {active ? <span className="absolute inset-x-2 bottom-0 h-[3px] rounded-full bg-[#1d9bf0]" aria-hidden="true" /> : null}
                </button>
              )
            })}
          </div>
        </section>

        <section className="px-4 pt-2 sm:px-6">
          <div className="flex gap-5 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {(discoverProfiles.length > 0 ? discoverProfiles : []).map((item) => {
              const suggestionAvatar = resolveImageUrl(item.avatar)
              return (
                <Link key={item.id} href={`/u/${encodeURIComponent(item.id)}`} className="block min-w-[9rem] max-w-[9rem] text-left">
                  <div className="overflow-hidden rounded-[28px] bg-transparent">
                    <div className="mx-auto flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white text-lg font-semibold text-slate-700 shadow-[0_12px_22px_rgba(15,23,42,0.08)]">
                      {suggestionAvatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={suggestionAvatar} alt={item.name} className="h-full w-full object-cover" />
                      ) : (
                        <span>{extractInitials(item.name)}</span>
                      )}
                    </div>
                    <div className="mt-3 text-[15px] font-semibold tracking-[-0.03em] text-slate-900">{item.name}</div>
                    {item.sharedGroupsCount ? <div className="mt-1 text-[12px] leading-5 text-slate-500">{item.sharedGroupsCount} shared groups</div> : <div className="mt-1 text-[12px] leading-5 text-slate-500">{item.schoolName || roleLabel(item.role)}</div>}
                  </div>
                </Link>
              )
            })}
            {!discoverLoading && discoverProfiles.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-slate-200 bg-white/80 px-4 py-5 text-sm text-slate-500">No profile suggestions yet.</div>
            ) : null}
          </div>
        </section>

        <section className="px-4 pt-6 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-[26px] font-semibold tracking-[-0.05em] text-slate-900">All posts</h2>
            <button
              type="button"
              className="text-[17px] font-semibold tracking-[-0.03em] text-[#1463cc]"
              onClick={() => setActiveTab('all')}
            >
              Filters
            </button>
          </div>

          {isSelf ? (
            <div className="mt-5 overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_16px_34px_rgba(15,23,42,0.08)]">
              <div className="flex items-center gap-4 px-5 py-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-sm font-semibold text-slate-700">
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
                  ) : (
                    <span>{extractInitials(displayName)}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1 rounded-full bg-slate-50 px-4 py-3 text-[16px] font-medium tracking-[-0.02em] text-slate-800">What's on your mind?</div>
                <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[#2fb344] transition hover:bg-[#effaf2]" aria-label="Add photo">
                  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden="true">
                    <path d="M6.5 5A3.5 3.5 0 0 0 3 8.5v7A3.5 3.5 0 0 0 6.5 19h11a3.5 3.5 0 0 0 3.5-3.5v-7A3.5 3.5 0 0 0 17.5 5h-2.59l-.7-1.05A2 2 0 0 0 12.54 3h-1.08a2 2 0 0 0-1.67.95L9.09 5H6.5Zm5.5 3.25A4.25 4.25 0 1 1 7.75 12 4.25 4.25 0 0 1 12 8.25Zm0 1.5A2.75 2.75 0 1 0 14.75 12 2.75 2.75 0 0 0 12 9.75Z" />
                  </svg>
                </button>
              </div>
              <div className="border-t border-slate-100 px-5 py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-[15px] font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50">
                    <span className="text-[#ff5a5f]">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true"><path d="M4 7.75A2.75 2.75 0 0 1 6.75 5h10.5A2.75 2.75 0 0 1 20 7.75v8.5A2.75 2.75 0 0 1 17.25 19H6.75A2.75 2.75 0 0 1 4 16.25v-8.5Zm4.5 1.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm7.72.22-5.47 5.47-2.22-2.22L5.5 15.75h13l-2.28-6.28Z" /></svg>
                    </span>
                    Reel
                  </button>
                  <button type="button" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-[15px] font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50">
                    <span className="text-[#ff4b4b]">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true"><path d="M17.5 6A2.5 2.5 0 0 1 20 8.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 15.5v-7A2.5 2.5 0 0 1 6.5 6h11Zm-8 3.25v5.5L15 12l-5.5-2.75Z" /></svg>
                    </span>
                    Live
                  </button>
                </div>
              </div>
            </div>
          ) : canFollow ? (
            <div className="mt-5 rounded-[30px] border border-slate-200 bg-white px-5 py-5 shadow-[0_16px_34px_rgba(15,23,42,0.08)]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-[18px] font-semibold tracking-[-0.03em] text-slate-900">Follow {displayName}</div>
                  <div className="mt-1 text-[14px] leading-6 text-slate-600">Stay updated with posts, photos, and activity from this profile.</div>
                </div>
                <button
                  type="button"
                  className={`inline-flex h-12 items-center justify-center rounded-full px-5 text-sm font-semibold shadow-sm transition ${profile?.isFollowing ? 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50' : 'bg-[#1877f2] text-white hover:bg-[#176ad8]'}`}
                  onClick={() => void toggleFollow()}
                  disabled={followBusy}
                >
                  {followBusy ? 'Working...' : profile?.isFollowing ? 'Following' : 'Follow'}
                </button>
              </div>
            </div>
          ) : null}

          {isSelf ? (
            <div className="mt-5">
              <button type="button" className="inline-flex w-full items-center justify-center gap-2 rounded-[22px] border border-slate-200 bg-slate-100 px-5 py-4 text-[17px] font-semibold tracking-[-0.03em] text-slate-900 shadow-sm transition hover:bg-slate-200">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                  <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H11l-4.5 3v-3H6.5A2.5 2.5 0 0 1 4 13.5v-7Z" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Manage posts
              </button>
            </div>
          ) : null}
        </section>

        <section className="space-y-5 px-4 pb-8 pt-6 sm:px-6">
          {profileLoading ? <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">Loading profile...</div> : null}
          {profileError ? <div className="rounded-[24px] border border-red-200 bg-red-50 px-5 py-8 text-center text-sm text-red-700 shadow-[0_14px_30px_rgba(220,38,38,0.08)]">{profileError}</div> : null}

          {!profileLoading && !profileError && activeTab === 'all' ? (
            postsLoading ? <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">Loading posts...</div> : postsError ? <div className="rounded-[24px] border border-red-200 bg-red-50 px-5 py-8 text-center text-sm text-red-700 shadow-[0_14px_30px_rgba(220,38,38,0.08)]">{postsError}</div> : posts.length === 0 ? <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">No posts yet.</div> : posts.map(renderPostCard)
          ) : null}

          {!profileLoading && !profileError && activeTab === 'photos' ? renderPhotoGrid() : null}
          {!profileLoading && !profileError && activeTab === 'reels' ? renderReels() : null}
        </section>
        </div>
      </div>

      {imageViewer ? (
        <ZoomableImageOverlay
          open={Boolean(imageViewer)}
          imageUrl={imageViewer.url}
          title={imageViewer.title}
          onClose={closeImageViewer}
        />
      ) : null}
    </main>
  )
}

export const getServerSideProps: GetServerSideProps = async () => {
  return { props: {} }
}
