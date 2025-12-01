import Link from 'next/link'
import { signOut, useSession } from 'next-auth/react'
import { useState } from 'react'
import BrandLogo from './BrandLogo'

export default function NavBar() {
  const { data: session } = useSession()
  const role = (session as any)?.user?.role
  const [open, setOpen] = useState(false)
  return (
    <nav className="top-nav text-white">
      <div className="max-w-6xl mx-auto px-4 py-3 grid grid-cols-3 items-center gap-4">
        {/* Left: logo */}
        <div className="flex items-center col-start-1">
          <Link href="/" className="flex items-center gap-2" aria-label="Philani Academy home">
            <BrandLogo height={38} className="drop-shadow-[0_8px_16px_rgba(0,0,0,0.5)]" />
          </Link>
        </div>

        {/* Center: main nav (centered on desktop) */}
        <div className="hidden md:flex items-center justify-center col-start-2">
          <div className="flex items-center space-x-6 text-sm uppercase tracking-wide text-blue-100">
            <Link href="/dashboard" className="nav-link">Dashboard</Link>
            <Link href="/subscribe" className="nav-link">Subscribe</Link>
          </div>
        </div>

        {/* Right: auth actions (right-aligned) */}
        <div className="flex items-center justify-end col-start-3">
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

          {/* Mobile hamburger (right) */}
          <div className="md:hidden flex items-center">
            <button onClick={() => setOpen(!open)} aria-label="Toggle menu" className="p-2">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 6H20M4 12H20M4 18H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu panel: centered, symmetric layout */}
      {open && (
        <div className="md:hidden px-4 pb-4">
          <div className="flex flex-col items-center space-y-3">
            <Link href="/dashboard" className="block w-full text-center px-3 py-2 border border-white/30 rounded-xl">Dashboard</Link>
            <Link href="/subscribe" className="block w-full text-center px-3 py-2 border border-white/30 rounded-xl">Subscribe</Link>
            {role && <div className="text-sm text-blue-100/70 capitalize">{role}</div>}
            {session ? (
              <button onClick={() => signOut({ callbackUrl: '/' })} className="w-full text-center px-3 py-2 border border-white/30 rounded-xl">Sign out</button>
            ) : (
              <Link href="/api/auth/signin" className="block w-full text-center px-3 py-2 border border-white/30 rounded-xl">Sign in</Link>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}
