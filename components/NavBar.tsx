import Link from 'next/link'
import { signOut, useSession } from 'next-auth/react'
import { useState } from 'react'

export default function NavBar() {
  const { data: session } = useSession()
  const role = (session as any)?.user?.role
  const [open, setOpen] = useState(false)
  return (
    <nav className="bg-white border-b">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <img src="/logo.svg" alt="Philani Academy" style={{ height: 36 }} />
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center space-x-4">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/subscribe">Subscribe</Link>
          {role && <span className="text-sm text-gray-600">{role}</span>}
          {session ? (
            <button onClick={() => signOut({ callbackUrl: '/' })} className="px-3 py-1 border rounded">Sign out</button>
          ) : (
            <Link href="/api/auth/signin"><span className="px-3 py-1 border rounded">Sign in</span></Link>
          )}
        </div>

        {/* Mobile hamburger */}
        <div className="md:hidden flex items-center">
          <button onClick={() => setOpen(!open)} aria-label="Toggle menu" className="p-2">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 6H20M4 12H20M4 18H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu panel */}
      {open && (
        <div className="md:hidden px-4 pb-4 space-y-2">
          <Link href="/dashboard"><a className="block">Dashboard</a></Link>
          <Link href="/subscribe"><a className="block">Subscribe</a></Link>
          {role && <div className="text-sm text-gray-600">{role}</div>}
          {session ? (
            <button onClick={() => signOut({ callbackUrl: '/' })} className="w-full text-left px-3 py-1 border rounded">Sign out</button>
          ) : (
            <Link href="/api/auth/signin"><span className="block px-3 py-1 border rounded">Sign in</span></Link>
          )}
        </div>
      )}
    </nav>
  )
}
