import Link from 'next/link'
import { signOut, useSession } from 'next-auth/react'
import { useState } from 'react'

export default function NavBar() {
  const { data: session } = useSession()
  const role = (session as any)?.user?.role
  const [open, setOpen] = useState(false)
  return (
    <nav className="bg-white border-b">
      <div className="max-w-6xl mx-auto px-4 py-3 grid grid-cols-3 items-center gap-4">
        {/* Left: logo */}
        <div className="flex items-center col-start-1">
          <Link href="/" className="flex items-center gap-2">
            <img src="/logo.svg" alt="Philani Academy" style={{ height: 36 }} />
          </Link>
        </div>

        {/* Center: main nav (centered on desktop) */}
        <div className="hidden md:flex items-center justify-center col-start-2">
          <div className="flex items-center space-x-6">
            <Link href="/dashboard" className="hover:text-gray-700">Dashboard</Link>
            <Link href="/subscribe" className="hover:text-gray-700">Subscribe</Link>
          </div>
        </div>

        {/* Right: auth actions (right-aligned) */}
        <div className="flex items-center justify-end col-start-3">
          <div className="hidden md:flex items-center space-x-4">
            {role && <span className="text-sm text-gray-600">{role}</span>}
            {session ? (
              <>
                <Link href="/profile"><a className="flex items-center space-x-2"><img src={(session as any)?.user?.image || '/favicon.ico'} alt="avatar" style={{ width: 32, height: 32, borderRadius: 8 }} /></a></Link>
                <button onClick={() => signOut({ callbackUrl: '/' })} className="px-3 py-1 border rounded">Sign out</button>
              </>
            ) : (
              <Link href="/api/auth/signin"><a className="px-3 py-1 border rounded">Sign in</a></Link>
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
            <Link href="/dashboard"><a className="block w-full text-center px-3 py-2 border rounded">Dashboard</a></Link>
            <Link href="/subscribe"><a className="block w-full text-center px-3 py-2 border rounded">Subscribe</a></Link>
            {role && <div className="text-sm text-gray-600">{role}</div>}
            {session ? (
              <button onClick={() => signOut({ callbackUrl: '/' })} className="w-full text-center px-3 py-2 border rounded">Sign out</button>
            ) : (
              <Link href="/api/auth/signin"><a className="block w-full text-center px-3 py-2 border rounded">Sign in</a></Link>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}
