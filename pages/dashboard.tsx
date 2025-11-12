import React, { useState, useEffect, useMemo } from 'react'
import JitsiRoom from '../components/JitsiRoom'
import { getSession, useSession } from 'next-auth/react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { gradeToLabel, GRADE_VALUES, GradeValue, normalizeGradeInput } from '../lib/grades'

export default function Dashboard() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const gradeOptions = useMemo(() => GRADE_VALUES.map(value => ({ value, label: gradeToLabel(value) })), [])
  const [selectedGrade, setSelectedGrade] = useState<GradeValue | null>(null)
  const [gradeReady, setGradeReady] = useState(false)
  const [title, setTitle] = useState('')
  const [joinUrl, setJoinUrl] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [minStartsAt, setMinStartsAt] = useState('')
  const [sessions, setSessions] = useState<any[]>([])
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [users, setUsers] = useState<any[] | null>(null)
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState('student')
  const [newGrade, setNewGrade] = useState<GradeValue | ''>('')
  const [plans, setPlans] = useState<any[]>([])
  const [planName, setPlanName] = useState('')
  const [planAmount, setPlanAmount] = useState<number | ''>('')
  const [planCurrency, setPlanCurrency] = useState('usd')
  const [plansLoading, setPlansLoading] = useState(false)
  const [payfastAvailable, setPayfastAvailable] = useState(false)
  const [secureRoomName, setSecureRoomName] = useState<string | null>(null)
  const [runningSession, setRunningSession] = useState<any | null>(null)

  const activeGradeLabel = gradeReady
    ? (selectedGrade ? gradeToLabel(selectedGrade) : 'Select a grade')
    : 'Resolving grade'
  const userRole = (session as any)?.user?.role as string | undefined
  const isAdmin = userRole === 'admin'
  const isOwnerUser = Boolean(((session as any)?.user?.email && (session as any)?.user?.email === process.env.NEXT_PUBLIC_OWNER_EMAIL) || isAdmin)
  const adminRoomName = useMemo(() => {
    const appId = process.env.NEXT_PUBLIC_JAAS_APP_ID || ''
    return appId ? `${appId}/philani-admin-room` : 'philani-admin-room'
  }, [])
  const userGrade = normalizeGradeInput((session as any)?.user?.grade as string | undefined)
  const accountGradeLabel = status === 'authenticated'
    ? (userGrade ? gradeToLabel(userGrade) : 'Unassigned')
    : 'N/A'

  const updateGradeSelection = (grade: GradeValue) => {
    if (selectedGrade === grade) return
    setSelectedGrade(grade)
    if (router.isReady) {
      const nextQuery = { ...router.query, grade }
      router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true })
    }
  }

  async function createSession(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedGrade) {
      alert('Select a grade before creating a session')
      return
    }
    try {
      // convert local datetime-local value to an ISO UTC string before sending
      let startsAtIso = startsAt
      if (startsAt) {
        const dt = new Date(startsAt)
        startsAtIso = dt.toISOString()
      }

      const res = await fetch('/api/create-session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, joinUrl, startsAt: startsAtIso, grade: selectedGrade })
      })

      if (res.ok) {
        alert('Session created')
        setTitle('')
        setJoinUrl('')
        setStartsAt('')
        fetchSessionsForGrade(selectedGrade)
        return
      }

      // Try to parse JSON response; fall back to plain text so we always show an error
      let data: any = null
      try {
        data = await res.json()
      } catch (err) {
        const txt = await res.text().catch(() => '')
        data = { message: txt || `HTTP ${res.status}` }
      }
      alert(data?.message || `Error: ${res.status}`)
    } catch (err: any) {
      // Network or unexpected error
      console.error('createSession error', err)
      alert(err?.message || 'Network error')
    }
  }

  async function fetchSessionsForGrade(gradeOverride?: GradeValue | null) {
    const gradeToFetch = gradeOverride ?? selectedGrade
    if (!gradeToFetch) {
      setSessions([])
      setSessionsError('Select a grade to view sessions.')
      return
    }
    setSessionsError(null)
    setSessions([])
    try {
      const res = await fetch(`/api/sessions?grade=${encodeURIComponent(gradeToFetch)}`, { credentials: 'same-origin' })
      if (res.ok) {
        const data = await res.json()
        setSessions(data)
        setSessionsError(null)
      } else {
        const data = await res.json().catch(() => ({}))
        if (res.status === 401) {
          setSessionsError('Please sign in to view grade-specific sessions.')
        } else {
          setSessionsError(data?.message || `Failed to load sessions (${res.status})`)
        }
      }
    } catch (err) {
      // Network or unexpected error
      console.error('fetchSessions error', err)
      setSessionsError(err instanceof Error ? err.message : 'Network error')
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

  const queryGradeParam = router.query?.grade
  const queryGradeString = Array.isArray(queryGradeParam) ? queryGradeParam[0] : queryGradeParam

  useEffect(() => {
    if (!router.isReady || gradeReady) return
    const normalizedQuery = normalizeGradeInput(typeof queryGradeString === 'string' ? queryGradeString : undefined)
    const sessionGrade = normalizeGradeInput((session as any)?.user?.grade as string | undefined)
    const role = (session as any)?.user?.role as string | undefined

    let resolved: GradeValue | null = normalizedQuery || null
    if (!resolved) {
      if ((role === 'student' || role === 'teacher') && sessionGrade) {
        resolved = sessionGrade
      }
    }
    if (!resolved) {
      resolved = 'GRADE_8'
    }

    if (resolved) {
      if (resolved !== normalizedQuery) {
        if (selectedGrade !== resolved) setSelectedGrade(resolved)
        const nextQuery = { ...router.query, grade: resolved }
        router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true })
      } else if (selectedGrade !== resolved) {
        setSelectedGrade(resolved)
      }
    }
    setGradeReady(true)
  }, [router.isReady, router.pathname, gradeReady, session, queryGradeString, selectedGrade])

  useEffect(() => {
    if (!gradeReady || !selectedGrade) return
    fetchSessionsForGrade(selectedGrade)
  }, [gradeReady, selectedGrade])

  useEffect(() => {
    if (!gradeReady) return
    if (newRole === 'admin') {
      setNewGrade('')
    } else if (!newGrade && selectedGrade) {
      setNewGrade(selectedGrade)
    }
  }, [newRole, selectedGrade, newGrade, gradeReady])
  // Prefill startsAt with the next minute and set a sensible min value
  useEffect(() => {
    const pad = (n: number) => n.toString().padStart(2, '0')
    const now = new Date()
    now.setSeconds(0, 0)
    now.setMinutes(now.getMinutes() + 1)
    const yyyy = now.getFullYear()
    const mm = pad(now.getMonth() + 1)
    const dd = pad(now.getDate())
    const hh = pad(now.getHours())
    const min = pad(now.getMinutes())
    const local = `${yyyy}-${mm}-${dd}T${hh}:${min}`
    setStartsAt(local)
    setMinStartsAt(local)
  }, [])
  useEffect(() => {
    // fetch users only for admins
    if ((session as any)?.user?.role === 'admin') {
      fetchUsers()
    }
  }, [session])

  useEffect(() => {
    // fetch plans for admins
    if ((session as any)?.user?.role === 'admin') {
      fetchPlans()
      // detect PayFast usage by checking NEXT_PUBLIC_PAYFAST flag
      setPayfastAvailable(!!process.env.NEXT_PUBLIC_PAYFAST)
    }
    // Mark window global for JitsiRoom so it can disable prejoin for owner quickly
    try {
      const isOwner = ((session as any)?.user?.email === process.env.NEXT_PUBLIC_OWNER_EMAIL) || (session as any)?.user?.role === 'admin'
      ;(window as any).__JITSI_IS_OWNER__ = Boolean(isOwner)
    } catch (e) {}
  }, [session])

  // Compute currently running session and fetch secure room name for it when sessions update
  useEffect(() => {
    if (isAdmin) {
      setRunningSession(null)
      setSecureRoomName(null)
      return
    }
    try {
      const now = new Date()
      const running = sessions.find(s => new Date(s.startsAt) <= now) || null
      setRunningSession(running)
      if (running) {
        // For learners: poll until jitsiActive is true, then fetch secure room name
        const check = async () => {
          try {
            const statusRes = await fetch(`/api/sessions/${running.id}/status`)
            if (statusRes.ok) {
              const st = await statusRes.json()
              if (st?.jitsiActive) {
                const roomRes = await fetch(`/api/sessions/${running.id}/room`)
                if (roomRes.ok) {
                  const data = await roomRes.json()
                  if (data?.roomName) setSecureRoomName(data.roomName)
                }
                return true
              }
            }
          } catch (e) {}
          return false
        }
        // Run immediately, then poll every 5s until active
        let mounted = true
        const runCheck = async () => {
          if (!mounted) return
          const ok = await check()
          if (!ok && mounted) setTimeout(runCheck, 5000)
        }
        runCheck()
        return () => { mounted = false }
      } else {
        setSecureRoomName(null)
      }
    } catch (e) {
      // ignore
    }
  }, [sessions, isAdmin])

  async function fetchPlans() {
    setPlansLoading(true)
    try {
      const res = await fetch('/api/plans', { credentials: 'same-origin' })
      if (res.ok) {
        const data = await res.json()
        setPlans(data || [])
      }
    } catch (err) {
      // ignore for now
    } finally {
      setPlansLoading(false)
    }
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto grid grid-cols-3 gap-6">
        <div className="col-span-2">
          {gradeReady && status === 'authenticated' && (userRole === 'admin' ? (
            <div className="card mb-4">
              <h2 className="font-semibold mb-3">Current grade</h2>
              <div className="flex flex-wrap gap-4">
                {gradeOptions.map(option => (
                  <label key={option.value} className="flex items-center space-x-2">
                    <input
                      type="radio"
                      name="active-grade"
                      value={option.value}
                      checked={selectedGrade === option.value}
                      onChange={() => updateGradeSelection(option.value)}
                    />
                    <span className={selectedGrade === option.value ? 'font-semibold' : ''}>{option.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs muted mt-2">Learners only see sessions, notes, and announcements for the active grade.</p>
            </div>
          ) : (
            <div className="card mb-4">
              <h2 className="font-semibold mb-1">Grade environment</h2>
              <p className="text-sm muted">You are currently in the {activeGradeLabel} workspace.</p>
              {!userGrade && (
                <p className="text-sm text-red-600 mt-2">Your profile does not have a grade yet. Please contact an administrator.</p>
              )}
            </div>
          ))}

          {/* Jitsi meeting area: automatically joins the next upcoming session or a default room */}
          <div className="card mb-4">
            <h2 className="font-semibold mb-3">Live class — {activeGradeLabel}</h2>
            {status !== 'authenticated' ? (
              <div className="text-sm muted">Please sign in to join the live class.</div>
            ) : (
              <JitsiRoom
                roomName={adminRoomName}
                displayName={session?.user?.name || session?.user?.email}
                sessionId={null}
                tokenEndpoint="/api/sessions/admin/token"
                passwordEndpoint={null}
                isOwner={isOwnerUser}
              />
            )}
          </div>
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <div>{session ? <span className="mr-4 muted">Signed in as {session.user?.email}</span> : <Link href="/api/auth/signin">Sign in</Link>}</div>
          </div>

          <div className="card mb-4">
            <h2 className="font-semibold mb-3">Create session</h2>
            {session && (session as any).user?.role && ((session as any).user.role === 'admin' || (session as any).user.role === 'teacher') ? (
              <form onSubmit={createSession} className="space-y-3">
                <p className="text-sm muted">This session will be visible only to {activeGradeLabel} learners.</p>
                <input className="input" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
                <input className="input" placeholder="Join URL (Teams, Padlet, Zoom)" value={joinUrl} onChange={e => setJoinUrl(e.target.value)} />
                <input className="input" type="datetime-local" value={startsAt} min={minStartsAt} step={60} onChange={e => setStartsAt(e.target.value)} />
                <div>
                  <button className="btn btn-primary" type="submit">Create</button>
                </div>
              </form>
            ) : (
              <div className="text-sm muted">You do not have permission to create sessions. Contact an admin to request instructor access.</div>
            )}
          </div>

          <div className="card">
            <h2 className="font-semibold mb-3">Upcoming sessions — {activeGradeLabel}</h2>
            {sessionsError ? (
              <div className="text-sm text-red-600">{sessionsError}</div>
            ) : sessions.length === 0 ? (
              <div className="text-sm muted">No sessions scheduled for this grade yet.</div>
            ) : (
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
            )}
          </div>

          {session && (session as any).user?.role === 'admin' && (
            <div className="card mt-4">
              <h2 className="font-semibold mb-3">Manage users</h2>
              <div className="mb-4">
                <h3 className="font-medium mb-2">Create user</h3>
                <div className="space-y-2">
                  <input className="input" placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)} />
                  <input className="input" placeholder="Email" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
                  <input className="input" placeholder="Password" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                  <select className="input" value={newRole} onChange={e => setNewRole(e.target.value)}>
                    <option value="student">student</option>
                    <option value="teacher">teacher</option>
                    <option value="admin">admin</option>
                  </select>
                  {(newRole === 'student' || newRole === 'teacher') && (
                    <select
                      className="input"
                      value={newGrade}
                      onChange={e => setNewGrade(e.target.value as GradeValue | '')}
                    >
                      <option value="">Select grade</option>
                      {gradeOptions.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  )}
                  <div>
                    <button className="btn btn-primary" onClick={async () => {
                      if ((newRole === 'student' || newRole === 'teacher') && !newGrade) {
                        alert('Please assign a grade to the new user')
                        return
                      }
                      try {
                        const res = await fetch('/api/users', {
                          method: 'POST',
                          credentials: 'same-origin',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            name: newName,
                            email: newEmail,
                            password: newPassword,
                            role: newRole,
                            grade: newRole === 'admin' ? undefined : newGrade
                          })
                        })
                        if (res.ok) {
                          setNewName('')
                          setNewEmail('')
                          setNewPassword('')
                          setNewRole('student')
                          setNewGrade(selectedGrade ?? '')
                          fetchUsers()
                          alert('User created')
                        } else {
                          const data = await res.json().catch(() => ({}))
                          alert(data?.message || `Failed to create user (${res.status})`)
                        }
                      } catch (err: any) {
                        alert(err?.message || 'Network error')
                      }
                    }}>Create user</button>
                  </div>
                </div>
              </div>
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
                        <th className="px-2 py-1">Grade</th>
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
                          <td className="px-2 py-2">{gradeToLabel(u.grade)}</td>
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

          {session && (session as any).user?.role === 'admin' && (
            <div className="card mt-4">
              <h2 className="font-semibold mb-3">Subscription plans</h2>
              <div className="mb-4">
                <h3 className="font-medium mb-2">Create plan</h3>
                <div className="space-y-2">
                  <input className="input" placeholder="Plan name" value={planName} onChange={e => setPlanName(e.target.value)} />
                  <input className="input" placeholder="Amount (cents)" type="number" value={planAmount as any} onChange={e => setPlanAmount(e.target.value ? parseInt(e.target.value) : '')} />
                  <select className="input" value={planCurrency} onChange={e => setPlanCurrency(e.target.value)}>
                    <option value="usd">USD</option>
                  </select>
                  <div>
                    <button className="btn btn-primary" onClick={async () => {
                      if (!planName || !planAmount) return alert('Name and amount required')
                      try {
                        if (payfastAvailable) {
                          // Use PayFast flow
                          const res = await fetch('/api/payfast/create-plan', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: planName, amount: planAmount, currency: planCurrency }) })
                          if (!res.ok) {
                            const data = await res.json().catch(() => ({}))
                            return alert(data?.message || `Failed to create PayFast plan (${res.status})`)
                          }
                          const data = await res.json()
                          // Build and submit a form to PayFast
                          const form = document.createElement('form')
                          form.method = 'POST'
                          form.action = data.action
                          Object.entries(data.payload || {}).forEach(([k, v]) => {
                            const input = document.createElement('input')
                            input.type = 'hidden'
                            input.name = k
                            input.value = v as any
                            form.appendChild(input)
                          })
                          const sigInput = document.createElement('input')
                          sigInput.type = 'hidden'
                          sigInput.name = 'signature'
                          sigInput.value = data.signature || ''
                          form.appendChild(sigInput)
                          document.body.appendChild(form)
                          form.submit()
                        } else {
                          // Fallback to Stripe plan creation (existing flow)
                          const res = await fetch('/api/plans', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: planName, amount: planAmount, currency: planCurrency }) })
                          if (res.ok) {
                            setPlanName('')
                            setPlanAmount('')
                            setPlanCurrency('usd')
                            fetchPlans()
                            alert('Plan created')
                          } else {
                            const data = await res.json().catch(() => ({}))
                            alert(data?.message || `Failed to create plan (${res.status})`)
                          }
                        }
                      } catch (err: any) {
                        alert(err?.message || 'Network error')
                      }
                    }}>Create plan</button>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-medium mb-2">Existing plans</h3>
                {plansLoading ? <div className="text-sm muted">Loading…</div> : (
                  plans.length === 0 ? <div className="text-sm muted">No plans found.</div> : (
                    <ul className="space-y-2">
                      {plans.map(p => (
                        <li key={p.id} className="p-2 border rounded flex items-center justify-between">
                          <div>
                            <div className="font-medium">{p.name}</div>
                            <div className="text-sm muted">{(p.amount/100).toFixed(2)} {p.currency?.toUpperCase()} {p.active ? '(active)' : ''}</div>
                          </div>
                          <div>
                            <button className="btn btn-danger" onClick={async () => {
                              if (!confirm('Delete plan?')) return
                              try {
                                const res = await fetch(`/api/plans`, { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id }) })
                                if (res.ok) fetchPlans()
                                else alert('Failed to delete')
                              } catch (err) {
                                alert('Network error')
                              }
                            }}>Delete</button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )
                )}
              </div>
            </div>
          )}
        </div>

        <aside className="card">
          <h3 className="font-semibold">Account</h3>
          <div className="mt-3 muted">Role: {(session as any)?.user?.role || 'guest'}</div>
          <div className="mt-1 text-sm muted">Grade: {status === 'authenticated' ? accountGradeLabel : 'N/A'}</div>
          <div className="mt-4">
            <Link href="/subscribe" className="btn btn-primary">Subscribe</Link>
          </div>
        </aside>
      </div>

      {/* demo embed removed from dashboard to avoid showing public demo heading */}
    </main>
  )
}

export async function getServerSideProps(context: any) {
  // protect page server-side if desired
  const session = await getSession(context)
  return { props: { session } }
}
