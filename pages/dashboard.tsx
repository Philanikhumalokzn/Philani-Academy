import React, { useState, useEffect } from 'react'
import { getSession, useSession } from 'next-auth/react'
import Link from 'next/link'

export default function Dashboard() {
  const { data: session } = useSession()
  const [title, setTitle] = useState('')
  const [joinUrl, setJoinUrl] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [sessions, setSessions] = useState<any[]>([])

  async function createSession(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch('/api/create-session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, joinUrl, startsAt })
    })
    if (res.ok) {
      alert('Session created')
      setTitle('')
      setJoinUrl('')
      setStartsAt('')
      fetchSessions()
    } else {
      const data = await res.json()
      alert(data.message || 'Error')
    }
  }

  async function fetchSessions() {
  const res = await fetch('/api/sessions', { credentials: 'same-origin' })
    if (res.ok) {
      const data = await res.json()
      setSessions(data)
    }
  }

  useEffect(() => { fetchSessions() }, [])

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto grid grid-cols-3 gap-6">
        <div className="col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <div>{session ? <span className="mr-4 muted">Signed in as {session.user?.email}</span> : <Link href="/api/auth/signin">Sign in</Link>}</div>
          </div>

          <div className="card mb-4">
            <h2 className="font-semibold mb-3">Create session</h2>
            {session && (session as any).user?.role && ((session as any).user.role === 'admin' || (session as any).user.role === 'teacher') ? (
              <form onSubmit={createSession} className="space-y-3">
                <input className="input" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
                <input className="input" placeholder="Join URL (Teams, Padlet, Zoom)" value={joinUrl} onChange={e => setJoinUrl(e.target.value)} />
                <input className="input" placeholder="Starts at (ISO)" value={startsAt} onChange={e => setStartsAt(e.target.value)} />
                <div>
                  <button className="btn btn-primary" type="submit">Create</button>
                </div>
              </form>
            ) : (
              <div className="text-sm muted">You do not have permission to create sessions. Contact an admin to request instructor access.</div>
            )}
          </div>

          <div className="card">
            <h2 className="font-semibold mb-3">Upcoming sessions</h2>
            <ul className="space-y-3">
              {sessions.map(s => (
                <li key={s.id} className="p-3 rounded flex items-center justify-between border">
                  <div>
                    <div className="font-medium">{s.title}</div>
                    <div className="text-sm muted">{new Date(s.startsAt).toLocaleString()}</div>
                  </div>
                  <div>
                    <a href={s.joinUrl} target="_blank" rel="noreferrer" className="btn btn-primary">Join</a>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <aside className="card">
          <h3 className="font-semibold">Account</h3>
          <div className="mt-3 muted">Role: {(session as any)?.user?.role || 'guest'}</div>
          <div className="mt-4">
            <Link href="/subscribe" className="btn btn-primary">Subscribe</Link>
          </div>
        </aside>
      </div>
    </main>
  )
}

export async function getServerSideProps(context: any) {
  // protect page server-side if desired
  const session = await getSession(context)
  return { props: { session } }
}
