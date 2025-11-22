import React, { useState, useEffect, useMemo, useRef } from 'react'
import dynamic from 'next/dynamic'
import JitsiRoom from '../components/JitsiRoom'
import { getSession, useSession } from 'next-auth/react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { gradeToLabel, GRADE_VALUES, GradeValue, normalizeGradeInput } from '../lib/grades'

type Announcement = {
  id: string
  title: string
  content: string
  grade: GradeValue
  createdAt: string
  createdBy?: string | null
}

type LessonMaterial = {
  id: string
  sessionId: string
  title: string
  filename: string
  url: string
  contentType?: string | null
  size?: number | null
  createdAt: string
  createdBy?: string | null
}

const MyScriptMathCanvas = dynamic(() => import('../components/MyScriptMathCanvas'), { ssr: false })

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
  const [plansLoading, setPlansLoading] = useState(false)
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [editPlanName, setEditPlanName] = useState('')
  const [editPlanAmount, setEditPlanAmount] = useState<number | ''>('')
  const [editPlanActive, setEditPlanActive] = useState(false)
  const [planSaving, setPlanSaving] = useState(false)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [announcementsLoading, setAnnouncementsLoading] = useState(false)
  const [announcementsError, setAnnouncementsError] = useState<string | null>(null)
  const [announcementTitle, setAnnouncementTitle] = useState('')
  const [announcementContent, setAnnouncementContent] = useState('')
  const [creatingAnnouncement, setCreatingAnnouncement] = useState(false)
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)
  const [materials, setMaterials] = useState<LessonMaterial[]>([])
  const [materialsLoading, setMaterialsLoading] = useState(false)
  const [materialsError, setMaterialsError] = useState<string | null>(null)
  const [materialTitle, setMaterialTitle] = useState('')
  const [materialFile, setMaterialFile] = useState<File | null>(null)
  const [materialUploading, setMaterialUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const activeGradeLabel = gradeReady
    ? (selectedGrade ? gradeToLabel(selectedGrade) : 'Select a grade')
    : 'Resolving grade'
  const userRole = (session as any)?.user?.role as string | undefined
  const isAdmin = userRole === 'admin'
  const canManageAnnouncements = userRole === 'admin' || userRole === 'teacher'
  const canUploadMaterials = userRole === 'admin' || userRole === 'teacher'
  const ownerEmail = process.env.NEXT_PUBLIC_OWNER_EMAIL || process.env.OWNER_EMAIL
  const isOwnerUser = Boolean(((session as any)?.user?.email && ownerEmail && (session as any)?.user?.email === ownerEmail) || isAdmin)
  const formatFileSize = (bytes?: number | null) => {
    if (!bytes || bytes <= 0) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  const gradeTokenEndpoint = useMemo(() => {
    if (!gradeReady || !selectedGrade) return null
    return `/api/sessions/grade/${selectedGrade}/token`
  }, [gradeReady, selectedGrade])
  const gradeSlug = useMemo(() => (selectedGrade ? selectedGrade.toLowerCase().replace(/_/g, '-') : null), [selectedGrade])
  const gradeRoomName = useMemo(() => {
    const appId = process.env.NEXT_PUBLIC_JAAS_APP_ID || ''
    const baseSlug = gradeSlug ?? 'public-room'
    const base = `philani-${baseSlug}`
    return appId ? `${appId}/${base}` : base
  }, [gradeSlug])
  const boardRoomId = useMemo(() => (gradeSlug ? `myscript-grade-${gradeSlug}` : 'myscript-grade-public'), [gradeSlug])
  const userGrade = normalizeGradeInput((session as any)?.user?.grade as string | undefined)
  const accountGradeLabel = status === 'authenticated'
    ? (userGrade ? gradeToLabel(userGrade) : 'Unassigned')
    : 'N/A'
  const formatPhoneDisplay = (value?: string | null) => {
    if (!value) return '—'
    if (value.startsWith('+27') && value.length === 12) return `0${value.slice(3)}`
    if (value.startsWith('27') && value.length === 11) return `0${value.slice(2)}`
    return value
  }
  const realtimeUserId = useMemo(() => {
    const candidate = (session as any)?.user?.id as string | undefined
    if (candidate && typeof candidate === 'string') return candidate
    if (session?.user?.email) return session.user.email
    if (session?.user?.name) return session.user.name
    return 'guest'
  }, [session])
  const realtimeDisplayName = session?.user?.name || session?.user?.email || 'Participant'

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

  async function fetchAnnouncementsForGrade(gradeOverride?: GradeValue | null) {
    const gradeToFetch = gradeOverride ?? selectedGrade
    if (!gradeToFetch) {
      setAnnouncements([])
      setAnnouncementsError('Select a grade to view announcements.')
      return
    }
    setAnnouncementsError(null)
    setAnnouncementsLoading(true)
    try {
      const res = await fetch(`/api/announcements?grade=${encodeURIComponent(gradeToFetch)}`, { credentials: 'same-origin' })
      if (res.ok) {
        const data = await res.json()
        setAnnouncements(Array.isArray(data) ? data : [])
      } else {
        const data = await res.json().catch(() => ({}))
        if (res.status === 401) {
          setAnnouncementsError('Please sign in to view announcements.')
        } else {
          setAnnouncementsError(data?.message || `Failed to load announcements (${res.status})`)
        }
        setAnnouncements([])
      }
    } catch (err) {
      console.error('fetchAnnouncements error', err)
      setAnnouncementsError(err instanceof Error ? err.message : 'Network error')
      setAnnouncements([])
    } finally {
      setAnnouncementsLoading(false)
    }
  }

  async function fetchMaterials(sessionId: string) {
    setMaterialsError(null)
    setMaterialsLoading(true)
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/materials`, { credentials: 'same-origin' })
      if (res.ok) {
        const data = await res.json()
        setMaterials(Array.isArray(data) ? data : [])
      } else {
        const data = await res.json().catch(() => ({}))
        if (res.status === 401) {
          setMaterialsError('Please sign in to view lesson materials.')
        } else {
          setMaterialsError(data?.message || `Failed to load materials (${res.status})`)
        }
        setMaterials([])
      }
    } catch (err) {
      console.error('fetchMaterials error', err)
      setMaterialsError(err instanceof Error ? err.message : 'Network error')
      setMaterials([])
    } finally {
      setMaterialsLoading(false)
    }
  }

  function resetMaterialForm() {
    setMaterialTitle('')
    setMaterialFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleMaterialFileChange(file: File | null) {
    setMaterialFile(file)
    if (file) {
      setMaterialTitle(prev => prev || file.name.replace(/\.[^.]+$/, ''))
    } else {
      setMaterialTitle('')
    }
  }

  const toggleMaterialsForSession = (sessionId: string) => {
    if (expandedSessionId === sessionId) {
      setExpandedSessionId(null)
      setMaterials([])
      setMaterialsError(null)
      resetMaterialForm()
      return
    }
    setExpandedSessionId(sessionId)
    setMaterials([])
    setMaterialsError(null)
    resetMaterialForm()
    fetchMaterials(sessionId)
  }

  async function uploadMaterial(e: React.FormEvent) {
    e.preventDefault()
    if (!expandedSessionId) {
      alert('Select a session before uploading materials')
      return
    }
    if (!materialFile) {
      alert('Choose a file to upload')
      return
    }
    const trimmedTitle = materialTitle.trim()
    const formData = new FormData()
    if (trimmedTitle) formData.append('title', trimmedTitle)
    formData.append('file', materialFile)

    setMaterialUploading(true)
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(expandedSessionId)}/materials`, {
        method: 'POST',
        credentials: 'same-origin',
        body: formData
      })
      if (res.ok) {
        resetMaterialForm()
        await fetchMaterials(expandedSessionId)
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data?.message || `Failed to upload material (${res.status})`)
      }
    } catch (err: any) {
      alert(err?.message || 'Network error')
    } finally {
      setMaterialUploading(false)
    }
  }

  async function deleteMaterial(id: string) {
    if (!confirm('Delete this material? This cannot be undone.')) return
    try {
      const res = await fetch(`/api/materials/${id}`, { method: 'DELETE', credentials: 'same-origin' })
      if (res.ok || res.status === 204) {
        setMaterials(prev => prev.filter(m => m.id !== id))
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data?.message || `Failed to delete material (${res.status})`)
      }
    } catch (err: any) {
      alert(err?.message || 'Network error')
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

  async function createAnnouncement(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedGrade) {
      alert('Select a grade before posting an announcement')
      return
    }
    const trimmedTitle = announcementTitle.trim()
    const trimmedContent = announcementContent.trim()
    if (!trimmedTitle || !trimmedContent) {
      alert('Title and content are required')
      return
    }
    setCreatingAnnouncement(true)
    try {
      const res = await fetch('/api/announcements', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: trimmedTitle, content: trimmedContent, grade: selectedGrade })
      })
      if (res.ok) {
        setAnnouncementTitle('')
        setAnnouncementContent('')
        fetchAnnouncementsForGrade(selectedGrade)
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data?.message || `Failed to create announcement (${res.status})`)
      }
    } catch (err: any) {
      alert(err?.message || 'Network error')
    } finally {
      setCreatingAnnouncement(false)
    }
  }

  async function deleteAnnouncement(id: string) {
    if (!confirm('Delete this announcement? This cannot be undone.')) return
    try {
      const res = await fetch(`/api/announcements/${id}`, { method: 'DELETE', credentials: 'same-origin' })
      if (res.ok || res.status === 204) {
        setAnnouncements(prev => prev.filter(a => a.id !== id))
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data?.message || `Failed to delete announcement (${res.status})`)
      }
    } catch (err: any) {
      alert(err?.message || 'Network error')
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
    if (!gradeReady || !selectedGrade) return
    fetchAnnouncementsForGrade(selectedGrade)
  }, [gradeReady, selectedGrade])

  useEffect(() => {
    setExpandedSessionId(null)
    setMaterials([])
    setMaterialsError(null)
    setMaterialTitle('')
    setMaterialFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [selectedGrade])

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
    }
    // Mark window global for JitsiRoom so it can disable prejoin for owner quickly
    try {
      const isOwner = ((session as any)?.user?.email === process.env.NEXT_PUBLIC_OWNER_EMAIL) || (session as any)?.user?.role === 'admin'
      ;(window as any).__JITSI_IS_OWNER__ = Boolean(isOwner)
    } catch (e) {}
  }, [session])
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

  function resetPlanEdit() {
    setEditingPlanId(null)
    setEditPlanName('')
    setEditPlanAmount('')
    setEditPlanActive(false)
    setPlanSaving(false)
  }

  function beginEditPlan(plan: any) {
    setEditingPlanId(plan.id)
    setEditPlanName(plan.name || '')
    setEditPlanAmount(typeof plan.amount === 'number' ? plan.amount : '')
    setEditPlanActive(Boolean(plan.active))
    setPlanSaving(false)
  }

  async function savePlanChanges() {
    if (!editingPlanId) return
    const trimmedName = editPlanName.trim()
    if (!trimmedName) {
      alert('Plan name is required')
      return
    }
    if (editPlanAmount === '' || editPlanAmount === null) {
      alert('Plan amount is required (cents)')
      return
    }
    const amountValue = typeof editPlanAmount === 'string' ? parseInt(editPlanAmount, 10) : editPlanAmount
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      alert('Plan amount must be greater than zero (in cents)')
      return
    }
    if (amountValue < 500) {
      alert('PayFast subscriptions require at least 500 cents (R5.00)')
      return
    }
    setPlanSaving(true)
    try {
      const res = await fetch(`/api/plans/${editingPlanId}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          amount: amountValue,
          active: editPlanActive
        })
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data?.message || `Failed to update plan (${res.status})`)
        return
      }

      resetPlanEdit()
      fetchPlans()
    } catch (err: any) {
      alert(err?.message || 'Network error while updating plan')
    } finally {
      setPlanSaving(false)
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
            ) : !selectedGrade ? (
              <div className="text-sm muted">Select a grade to join the live class.</div>
            ) : (
              <JitsiRoom
                roomName={gradeRoomName}
                displayName={session?.user?.name || session?.user?.email}
                sessionId={null}
                tokenEndpoint={gradeTokenEndpoint}
                passwordEndpoint={null}
                isOwner={isOwnerUser}
              />
            )}
          </div>
          <div className="card mb-4">
            <h2 className="font-semibold mb-3">Collaborative maths board — {activeGradeLabel}</h2>
            {status !== 'authenticated' ? (
              <div className="text-sm muted">Please sign in to launch the maths board.</div>
            ) : !selectedGrade ? (
              <div className="text-sm muted">Select a grade to open the shared board.</div>
            ) : (
              <MyScriptMathCanvas
                gradeLabel={activeGradeLabel}
                roomId={boardRoomId}
                userId={realtimeUserId}
                userDisplayName={realtimeDisplayName}
              />
            )}
          </div>
          <div className="card mb-4">
            <h2 className="font-semibold mb-3">Announcements — {activeGradeLabel}</h2>
            {status !== 'authenticated' ? (
              <div className="text-sm muted">Please sign in to view announcements.</div>
            ) : !selectedGrade ? (
              <div className="text-sm muted">Select a grade to view announcements.</div>
            ) : (
              <>
                {canManageAnnouncements && (
                  <form onSubmit={createAnnouncement} className="space-y-2 mb-4">
                    <input
                      className="input"
                      placeholder="Title"
                      value={announcementTitle}
                      onChange={e => setAnnouncementTitle(e.target.value)}
                    />
                    <textarea
                      className="input min-h-[120px]"
                      placeholder="Share important updates for this grade"
                      value={announcementContent}
                      onChange={e => setAnnouncementContent(e.target.value)}
                    />
                    <div>
                      <button className="btn btn-primary" type="submit" disabled={creatingAnnouncement}>
                        {creatingAnnouncement ? 'Saving…' : 'Post announcement'}
                      </button>
                    </div>
                  </form>
                )}
                {announcementsError ? (
                  <div className="text-sm text-red-600">{announcementsError}</div>
                ) : announcementsLoading ? (
                  <div className="text-sm muted">Loading announcements…</div>
                ) : announcements.length === 0 ? (
                  <div className="text-sm muted">No announcements yet.</div>
                ) : (
                  <ul className="space-y-3">
                    {announcements.map(a => (
                      <li key={a.id} className="p-3 border rounded">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="font-medium">{a.title}</div>
                            <div className="text-xs muted">
                              {new Date(a.createdAt).toLocaleString()}
                              {a.createdBy ? ` • ${a.createdBy}` : ''}
                            </div>
                          </div>
                          {canManageAnnouncements && (
                            <button
                              type="button"
                              className="btn btn-danger"
                              onClick={() => deleteAnnouncement(a.id)}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                        <p className="text-sm mt-2 whitespace-pre-line">{a.content}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </>
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
                  <li key={s.id} className="p-3 border rounded">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">{s.title}</div>
                        <div className="text-sm muted">{new Date(s.startsAt).toLocaleString()}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <a href={s.joinUrl} target="_blank" rel="noreferrer" className="btn btn-primary">Join</a>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => toggleMaterialsForSession(s.id)}
                        >
                          {expandedSessionId === s.id ? 'Hide materials' : 'View materials'}
                        </button>
                      </div>
                    </div>
                    {expandedSessionId === s.id && (
                      <div className="mt-3 border-t pt-3 space-y-3">
                        {canUploadMaterials && (
                          <form onSubmit={uploadMaterial} className="space-y-2">
                            <input
                              className="input"
                              placeholder="Material title"
                              value={materialTitle}
                              onChange={e => setMaterialTitle(e.target.value)}
                            />
                            <input
                              ref={fileInputRef}
                              className="input"
                              type="file"
                              accept=".pdf,.doc,.docx,.ppt,.pptx,.pps,.ppsx,.key,.txt,.xlsx,.xls,.zip,.rar,.jpg,.jpeg,.png,.mp4,.mov"
                              onChange={e => handleMaterialFileChange(e.target.files?.[0] ?? null)}
                            />
                            <div>
                              <button className="btn btn-primary" type="submit" disabled={materialUploading || !materialFile}>
                                {materialUploading ? 'Uploading…' : 'Upload material'}
                              </button>
                            </div>
                          </form>
                        )}
                        {materialsError ? (
                          <div className="text-sm text-red-600">{materialsError}</div>
                        ) : materialsLoading ? (
                          <div className="text-sm muted">Loading materials…</div>
                        ) : materials.length === 0 ? (
                          <div className="text-sm muted">No materials uploaded yet.</div>
                        ) : (
                          <ul className="space-y-2">
                            {materials.map(m => (
                              <li key={m.id} className="p-2 border rounded flex items-start justify-between gap-4">
                                <div>
                                  <a href={m.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{m.title}</a>
                                  <div className="text-xs muted">
                                    {new Date(m.createdAt).toLocaleString()}
                                    {m.createdBy ? ` • ${m.createdBy}` : ''}
                                    {m.size ? ` • ${formatFileSize(m.size)}` : ''}
                                  </div>
                                </div>
                                {canUploadMaterials && (
                                  <button
                                    type="button"
                                    className="btn btn-danger"
                                    onClick={() => deleteMaterial(m.id)}
                                  >
                                    Delete
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
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
                        <th className="px-2 py-1">Learner</th>
                        <th className="px-2 py-1">Contact</th>
                        <th className="px-2 py-1">Emergency</th>
                        <th className="px-2 py-1">Address</th>
                        <th className="px-2 py-1">Created</th>
                        <th className="px-2 py-1">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users && users.map(u => (
                        <tr key={u.id} className="border-t">
                          <td className="px-2 py-2 align-top">{u.email}</td>
                          <td className="px-2 py-2 align-top">
                            <div className="font-medium">{u.firstName || u.name || '—'} {u.lastName || ''}</div>
                            <div className="text-xs muted capitalize">Role: {u.role}</div>
                            <div className="text-xs muted">Grade: {u.grade ? gradeToLabel(u.grade) : 'Unassigned'}</div>
                            <div className="text-xs muted">School: {u.schoolName || '—'}</div>
                          </td>
                          <td className="px-2 py-2 align-top">
                            <div>{formatPhoneDisplay(u.phoneNumber)}</div>
                            <div className="text-xs muted">Alt: {formatPhoneDisplay(u.alternatePhone)}</div>
                            <div className="text-xs muted">Recovery: {u.recoveryEmail || '—'}</div>
                          </td>
                          <td className="px-2 py-2 align-top">
                            <div>{u.emergencyContactName || '—'}</div>
                            <div className="text-xs muted">{u.emergencyContactRelationship || ''}</div>
                            <div className="text-xs muted">{u.emergencyContactPhone ? formatPhoneDisplay(u.emergencyContactPhone) : 'No number'}</div>
                          </td>
                          <td className="px-2 py-2 align-top">
                            <div>{u.addressLine1 || '—'}</div>
                            <div className="text-xs muted">{u.city || ''} {u.province ? `(${u.province})` : ''}</div>
                            <div className="text-xs muted">{u.postalCode || ''}</div>
                          </td>
                          <td className="px-2 py-2 align-top">{new Date(u.createdAt).toLocaleString()}</td>
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
                  <input className="input" placeholder="Amount (cents)" type="number" value={planAmount as any} onChange={e => setPlanAmount(e.target.value ? parseInt(e.target.value, 10) : '')} />
                  <div className="text-xs muted">PayFast subscriptions are billed in ZAR.</div>
                  <div>
                    <button className="btn btn-primary" onClick={async () => {
                      if (!planName || !planAmount) return alert('Name and amount required')
                      if (typeof planAmount === 'number' && planAmount < 500) {
                        alert('PayFast subscriptions require at least 500 cents (R5.00)')
                        return
                      }
                      try {
                        const res = await fetch('/api/payfast/create-plan', {
                          method: 'POST',
                          credentials: 'same-origin',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ name: planName, amount: planAmount })
                        })

                        if (!res.ok) {
                          const data = await res.json().catch(() => ({}))
                          return alert(data?.message || `Failed to create PayFast plan (${res.status})`)
                        }

                        setPlanName('')
                        setPlanAmount('')
                        fetchPlans()
                        alert('Plan created')
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
                        <li key={p.id} className="p-2 border rounded">
                          {editingPlanId === p.id ? (
                            <div className="space-y-2">
                              <input className="input" value={editPlanName} onChange={e => setEditPlanName(e.target.value)} placeholder="Plan name" />
                              <input className="input" type="number" value={editPlanAmount as any} onChange={e => setEditPlanAmount(e.target.value ? parseInt(e.target.value, 10) : '')} placeholder="Amount (cents)" />
                              <div className="text-sm muted">Currency: {(p.currency || 'zar').toUpperCase()}</div>
                              <label className="flex items-center space-x-2 text-sm">
                                <input type="checkbox" checked={editPlanActive} onChange={e => setEditPlanActive(e.target.checked)} />
                                <span>Active</span>
                              </label>
                              <div className="flex gap-2">
                                <button className="btn btn-primary" onClick={savePlanChanges} disabled={planSaving}>
                                  {planSaving ? 'Saving…' : 'Save changes'}
                                </button>
                                <button className="btn btn-ghost" onClick={resetPlanEdit} disabled={planSaving}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="font-medium">{p.name}</div>
                                <div className="text-sm muted">{(p.amount/100).toFixed(2)} {p.currency?.toUpperCase()} {p.active ? '(active)' : '(inactive)'}</div>
                              </div>
                              <div className="flex gap-2">
                                <button className="btn btn-ghost" onClick={() => beginEditPlan(p)}>Edit</button>
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
                            </div>
                          )}
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
