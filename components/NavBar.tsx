import Link from 'next/link'
import { useRouter } from 'next/router'
import { signOut, useSession } from 'next-auth/react'
import { useEffect, useMemo, useRef, useState } from 'react'

export default function NavBar() {
  const router = useRouter()
  const { data: session, update: updateSession } = useSession()
  const role = (session as any)?.user?.role
  const isVerified = role === 'admin' || role === 'teacher'
  const [open, setOpen] = useState(false)

  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarEditArmed, setAvatarEditArmed] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const isDashboard = router.pathname === '/dashboard'

  useEffect(() => {
    if (!avatarEditArmed) return
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-avatar-edit-container="1"]')) return
      setAvatarEditArmed(false)
    }

    document.addEventListener('mousedown', handlePointerDown, true)
    document.addEventListener('touchstart', handlePointerDown, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true)
      document.removeEventListener('touchstart', handlePointerDown, true)
    }
  }, [avatarEditArmed])

  const fallbackAvatar = ((session as any)?.user?.image as string | undefined) || '/favicon.ico'
  const effectiveAvatarUrl = useMemo(() => {
    const url = (profileAvatarUrl || fallbackAvatar || '').trim()
    return url || '/favicon.ico'
  }, [fallbackAvatar, profileAvatarUrl])

  useEffect(() => {
    if (!session) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/profile', { credentials: 'same-origin' })
        if (!res.ok) return
        const data = await res.json().catch(() => ({}))
        const next = typeof data?.avatar === 'string' ? data.avatar.trim() : ''
        if (!cancelled) setProfileAvatarUrl(next || null)
      } catch {
        // ignore
      }
    })()
    return () => {
      cancelled = true
    }
  }, [session])

  const uploadAvatar = async (file: File) => {
    if (!file) return
    setAvatarUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/profile/avatar', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data?.message || `Failed to upload avatar (${res.status})`)
        return
      }
      const url = typeof data?.url === 'string' ? data.url.trim() : ''
      if (url) {
        setProfileAvatarUrl(url)
        try {
          await updateSession?.({ image: url } as any)
        } catch {
          // ignore
        }
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to upload avatar')
    } finally {
      setAvatarUploading(false)
    }
  }

  const handleBack = () => {
    if (typeof window === 'undefined') return
    if (window.history.length > 1) {
      window.history.back()
    } else {
      window.location.href = '/'
    }
  }

  const handleForward = () => {
    if (typeof window === 'undefined') return
    window.history.forward()
  }

  return (
    <nav className="top-nav text-white hidden md:block">
      <div className="max-w-6xl mx-auto px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="hidden flex-1 md:flex" aria-hidden="true" />

          <div className="order-first w-full flex flex-col items-center gap-1 text-center md:order-none md:w-auto">
            <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.35em] text-blue-100">
              <button
                type="button"
                onClick={handleBack}
                className="inline-flex items-center gap-1 rounded-full border border-white/20 px-3 py-1 text-white/80 transition hover:border-white hover:text-white"
                aria-label="Go back"
              >
                <span aria-hidden="true">←</span>
                <span>Back</span>
              </button>
              <button
                type="button"
                onClick={handleForward}
                className="inline-flex items-center gap-1 rounded-full border border-white/20 px-3 py-1 text-white/80 transition hover:border-white hover:text-white"
                aria-label="Go forward"
              >
                <span>Forward</span>
                <span aria-hidden="true">→</span>
              </button>
            </div>
            <div className="text-base font-semibold tracking-[0.6em] text-white uppercase whitespace-nowrap md:text-lg">
              Philani Academy
            </div>
          </div>

          <div className="flex flex-1 items-center justify-end gap-4">
            <div className="hidden md:flex items-center space-x-4">
              {role && <span className="text-sm text-blue-100/80 capitalize">{role}</span>}
              {session ? (
                <>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void uploadAvatar(file)
                      e.target.value = ''
                      setAvatarEditArmed(false)
                    }}
                  />
                  {isDashboard ? (
                    <div className="relative group" data-avatar-edit-container="1">
                      <button
                        type="button"
                        className="flex items-center"
                        aria-label="Edit avatar"
                        onClick={() => setAvatarEditArmed(v => !v)}
                        disabled={avatarUploading}
                      >
                        <div className="relative overflow-visible">
                          <img src={effectiveAvatarUrl} alt="avatar" className="h-8 w-8 rounded-full object-cover" />
                          {isVerified ? (
                            <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-blue-500 text-white flex items-center justify-center border border-white/60 shadow-md pointer-events-none" aria-label="Verified" title="Verified">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                <path d="M9.0 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" fill="currentColor" />
                              </svg>
                            </span>
                          ) : null}
                        </div>
                      </button>
                      <button
                        type="button"
                        aria-label="Update avatar"
                        className={`absolute -bottom-2 -right-2 inline-flex items-center justify-center h-7 w-7 rounded-lg border border-white/20 bg-white/10 backdrop-blur transition-opacity ${avatarUploading || avatarEditArmed ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto'}`}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setAvatarEditArmed(false)
                          avatarInputRef.current?.click()
                        }}
                        disabled={avatarUploading}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm18-11.5a1 1 0 0 0 0-1.41l-1.34-1.34a1 1 0 0 0-1.41 0l-1.13 1.13 3.75 3.75L21 5.75Z" fill="currentColor" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <Link href="/profile" className="flex items-center space-x-2">
                      <div className="relative overflow-visible">
                        <img src={effectiveAvatarUrl} alt="avatar" className="h-8 w-8 rounded-full object-cover" />
                        {isVerified ? (
                          <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-blue-500 text-white flex items-center justify-center border border-white/60 shadow-md pointer-events-none" aria-label="Verified" title="Verified">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                              <path d="M9.0 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" fill="currentColor" />
                            </svg>
                          </span>
                        ) : null}
                      </div>
                    </Link>
                  )}
                  <button onClick={() => signOut({ callbackUrl: '/' })} className="btn btn-ghost border border-white/30">Sign out</button>
                </>
              ) : (
                <Link href="/api/auth/signin" className="btn btn-primary text-sm">Sign in</Link>
              )}
            </div>

            <div className="md:hidden flex items-center">
              <button onClick={() => setOpen(!open)} aria-label="Toggle menu" className="p-2">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 6H20M4 12H20M4 18H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {open && (
          <div className="md:hidden px-4 pb-2">
            <div className="flex flex-col items-center space-y-3">
              {role && <div className="text-sm text-blue-100/70 capitalize">{role}</div>}
              {session ? (
                <button onClick={() => signOut({ callbackUrl: '/' })} className="w-full text-center px-3 py-2 border border-white/30 rounded-xl">Sign out</button>
              ) : (
                <Link href="/api/auth/signin" className="block w-full text-center px-3 py-2 border border-white/30 rounded-xl">Sign in</Link>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}
