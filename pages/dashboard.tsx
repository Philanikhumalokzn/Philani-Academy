import React, { useState, useEffect } from 'react'
import { getSession, useSession } from 'next-auth/react'
import Link from 'next/link'

export default function Dashboard() {
  const { data: session } = useSession()
  const [title, setTitle] = useState('')
  const [joinUrl, setJoinUrl] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [sessions, setSessions] = useState<any[]>([])
  const [users, setUsers] = useState<any[] | null>(null)
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState<string | null>(null)

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

  async function fetchUsers() {
    setUsersError(null)
    setUsersLoading(true)
    try {
      const res = await fetch('/api/users', { credentials: 'same-origin' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setUsersError(data?.message || `Error: ${res.status}`)
        setUsers(null)
      } else {
        const data = await res.json()
        setUsers(data)
      }
    } catch (err: any) {
      setUsersError(err?.message || 'Network error')
      setUsers(null)
    } finally {
      setUsersLoading(false)
    }
  }

  useEffect(() => { fetchSessions() }, [])
  useEffect(() => {
    // fetch users only for admins
    if ((session as any)?.user?.role === 'admin') {
      fetchUsers()
    }
  }, [session])

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

          {session && (session as any).user?.role === 'admin' && (
            <div className="card mt-4">
              <h2 className="font-semibold mb-3">Manage users</h2>
              {usersLoading ? (
                <div className="text-sm muted">Loading users…</div>
              ) : usersError ? (
                <div className="text-sm text-red-600">{usersError}</div>
              ) : users && users.length === 0 ? (
                <div className="text-sm muted">No users found.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr>
                        <th className="px-2 py-1">Email</th>
                        <th className="px-2 py-1">Name</th>
                        <th className="px-2 py-1">Role</th>
                        <th className="px-2 py-1">Created</th>
                        <th className="px-2 py-1">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users && users.map(u => (
                        <tr key={u.id} className="border-t">
                          <td className="px-2 py-2">{u.email}</td>
                          <td className="px-2 py-2">{u.name || '-'}</td>
                          <td className="px-2 py-2">{u.role}</td>
                          <td className="px-2 py-2">{new Date(u.createdAt).toLocaleString()}</td>
                          <td className="px-2 py-2">
                            <button
                              className="btn btn-danger"
                              onClick={async () => {
                                if (!confirm(`Delete user ${u.email}? This cannot be undone.`)) return
                                try {
                                  const res = await fetch(`/api/users/${u.id}`, { method: 'DELETE', credentials: 'same-origin' })
                                  if (res.ok) {
                                    setUsers(prev => prev ? prev.filter(x => x.id !== u.id) : prev)
                                  } else {
                                    const data = await res.json().catch(() => ({}))
                                    alert(data?.message || `Failed to delete (${res.status})`)
                                  }
                                } catch (err: any) {
                                  alert(err?.message || 'Network error')
                                }
                              }}
                            >Delete</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
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
