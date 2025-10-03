import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'

export default function Signup() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const [flash, setFlash] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  // Lightweight diagnostics to help determine if client JS is running in production
  useEffect(() => {
    setHydrated(true)
    console.log('[signup] signup page hydrated')
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      console.log('[signup] handleSubmit start', { name, email })
      setLoading(true)
      setError(null)
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password })
      })

      if (res.ok) {
        router.push('/api/auth/signin')
        return
      }
      // Try to parse JSON error body safely
      let message = 'Signup failed'
      try {
        const ct = res.headers.get('content-type') || ''
        if (ct.includes('application/json')) {
          const data = await res.json()
          message = data?.message || message
        } else {
          // non-JSON body
          const text = await res.text()
          message = text || message
        }
      } catch (err) {
        // Parsing failed
        message = 'Signup failed (invalid server response)'
      }

      setError(message)
    } catch (err: any) {
      setError(err?.message || 'Network error')
    }
    finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      {/* Hydration-only banner (shows when client JS ran) */}
      <div className="fixed top-4 right-4">
        {hydrated ? (
          <div className="text-sm bg-green-100 text-green-800 px-3 py-1 rounded shadow-sm">Client JS loaded ✔</div>
        ) : (
          <div className="text-sm bg-gray-100 text-gray-600 px-3 py-1 rounded">Client JS not loaded</div>
        )}
      </div>
      <div className="max-w-md w-full container-card fade-up">
        <h2 className="text-2xl font-bold mb-4">Create an account</h2>
  <form action="/api/signup" method="post" onSubmit={handleSubmit} className="space-y-4">
          <input className="input" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} required name="name" autoComplete="name" />
          <input className="input" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required name="email" autoComplete="email" />
          <input className="input" placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} required name="password" autoComplete="new-password" />
          <noscript>
            <p className="text-sm muted">JavaScript appears to be disabled in your browser. The form will submit normally without client-side enhancements.</p>
          </noscript>
          <div className="flex items-center justify-between">
              <button
                className={`btn btn-primary ${flash ? 'opacity-70' : ''}`}
                type="submit"
                disabled={loading}
                onClick={() => {
                  // visual flash so the user sees a transient change when button is clicked
                  setFlash(true)
                  setTimeout(() => setFlash(false), 300)
                  console.log('[signup] button clicked')
                }}
              >
                {loading ? 'Creating…' : 'Sign up'}
              </button>
            <Link href="/api/auth/signin" className="text-sm muted">Already have an account? Sign in</Link>
          </div>
          {error && <p className="text-red-600">{error}</p>}
        </form>
      </div>
    </main>
  )
}
