import Link from 'next/link'
import { signOut, useSession } from 'next-auth/react'
import { useState } from 'react'

export default function NavBar() {
  const { data: session } = useSession()
  const role = (session as any)?.user?.role
  const [open, setOpen] = useState(false)

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
    <nav className="top-nav text-white">
      <div className="w-full px-2 py-3 space-y-3">
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
                  <Link href="/profile" className="flex items-center space-x-2">
                    <img src={(session as any)?.user?.image || '/favicon.ico'} alt="avatar" style={{ width: 32, height: 32, borderRadius: 8 }} />
                  </Link>
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
          <div className="md:hidden px-2 pb-2">
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
