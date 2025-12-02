import React, { useState, useEffect, useMemo, useRef } from 'react'
import JitsiRoom from '../components/JitsiRoom'
import { getSession, useSession } from 'next-auth/react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { gradeToLabel, GRADE_VALUES, GradeValue, normalizeGradeInput } from '../lib/grades'

import NavArrows from '../components/NavArrows'
import BrandLogo from '../components/BrandLogo'

const DASHBOARD_SECTIONS = [
  { id: 'overview', label: 'Overview', description: 'Grade & quick actions', roles: ['admin', 'teacher', 'student', 'guest'] },
  { id: 'live', label: 'Live Class', description: 'Join lessons & board', roles: ['admin', 'teacher', 'student'] },
  { id: 'announcements', label: 'Announcements', description: 'Communicate updates', roles: ['admin', 'teacher', 'student'] },
  { id: 'sessions', label: 'Sessions', description: 'Schedule classes & materials', roles: ['admin', 'teacher', 'student'] },
  { id: 'users', label: 'Learners', description: 'Manage enrolments', roles: ['admin'] },
  { id: 'billing', label: 'Billing', description: 'Subscription plans', roles: ['admin'] }
] as const

type SectionId = typeof DASHBOARD_SECTIONS[number]['id']
type SectionRole = typeof DASHBOARD_SECTIONS[number]['roles'][number]

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

export default function Dashboard() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const gradeOptions = useMemo(() => GRADE_VALUES.map(value => ({ value, label: gradeToLabel(value) })), [])
  const [selectedGrade, setSelectedGrade] = useState<GradeValue | null>(null)
  const [gradeReady, setGradeReady] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
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
  const [activeSection, setActiveSection] = useState<SectionId>('overview')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const activeGradeLabel = gradeReady
    ? (selectedGrade ? gradeToLabel(selectedGrade) : 'Select a grade')
    : 'Resolving grade'
  const userRole = (session as any)?.user?.role as SectionRole | undefined
  const normalizedRole: SectionRole = userRole ?? 'guest'
  const isAdmin = normalizedRole === 'admin'
  const canManageAnnouncements = normalizedRole === 'admin' || normalizedRole === 'teacher'
  const canUploadMaterials = normalizedRole === 'admin' || normalizedRole === 'teacher'
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
  const availableSections = useMemo(
    () => DASHBOARD_SECTIONS.filter(section => (section.roles as ReadonlyArray<SectionRole>).includes(normalizedRole)),
    [normalizedRole]
  )

  useEffect(() => {
    if (availableSections.length === 0) return
    if (!availableSections.some(section => section.id === activeSection)) {
      setActiveSection(availableSections[0].id)
    }
  }, [availableSections, activeSection])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const updateViewport = () => {
      setIsMobile(window.innerWidth < 768)
    }
    updateViewport()
    window.addEventListener('resize', updateViewport)
    return () => window.removeEventListener('resize', updateViewport)
  }, [])

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

  const OverviewSection = () => {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card dashboard-card space-y-3">
            <h2 className="text-lg font-semibold">Grade workspace</h2>
            {status !== 'authenticated' ? (
              <p className="text-sm muted">Sign in to manage a grade workspace.</p>
            ) : !gradeReady ? (
              <p className="text-sm muted">Loading grade options...</p>
            ) : isAdmin ? (
              <div className="space-y-3">
                <p className="text-sm muted">Switch the active grade to manage sessions and announcements.</p>
                <div className="flex flex-wrap gap-3">
                  {gradeOptions.map(option => (
                    <label
                      key={option.value}
                      className={`px-3 py-2 rounded border text-sm cursor-pointer transition ${
                        selectedGrade === option.value ? 'border-blue-500 bg-blue-50 font-semibold' : 'border-slate-200 hover:border-blue-200'
                      }`}
                    >
                      <input
                        type="radio"
                        name="active-grade"
                        value={option.value}
                        checked={selectedGrade === option.value}
                        onChange={() => updateGradeSelection(option.value)}
                        className="sr-only"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
                <p className="text-xs muted">Learners only see sessions, notes, and announcements for the selected grade.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm muted">
                  You are currently in the <span className="font-medium text-white">{activeGradeLabel}</span> workspace.
                </p>
                {!userGrade && (
                  <p className="text-sm text-red-600">Your profile does not have a grade yet. Please contact an administrator.</p>
                )}
              </div>
            )}
          </div>

          <div className="card dashboard-card space-y-3">
            <h2 className="text-lg font-semibold">Account snapshot</h2>
            <dl className="grid gap-2 text-sm text-white">
              <div>
                <dt className="font-medium text-white">Email</dt>
                <dd>{session?.user?.email || 'Not signed in'}</dd>
              </div>
              <div>
                <dt className="font-medium text-white">Role</dt>
                <dd className="capitalize">{userRole || 'guest'}</dd>
              </div>
              <div>
                <dt className="font-medium text-white">Grade</dt>
                <dd>{status === 'authenticated' ? accountGradeLabel : 'N/A'}</dd>
              </div>
            </dl>
            <div className="flex flex-col sm:flex-row gap-2">
              <Link href="/profile" className="btn btn-ghost w-full sm:w-auto">Update profile</Link>
              <Link href="/subscribe" className="btn btn-primary w-full sm:w-auto">Manage subscription</Link>
            </div>
          </div>
        </div>

      </div>
    )
  }

  const LiveSection = () => {
    const canvasPath = selectedGrade ? `/board?grade=${encodeURIComponent(selectedGrade)}` : '/board'
    const canvasLabel = selectedGrade ? `Canvas (${gradeToLabel(selectedGrade)})` : 'Canvas workspace'

    return (
      <div className="space-y-6">
        <div className="card space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-lg font-semibold">Live class — {activeGradeLabel}</h2>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => router.push(canvasPath)}
            >
              {canvasLabel}
            </button>
          </div>
          <p className="text-xs text-white">Canvas opens on its own page so you get the entire screen for handwriting.</p>
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
      </div>
    )
  }

  const AnnouncementsSection = () => (
    <div className="space-y-6">
      {canManageAnnouncements && (
        <div className="card space-y-3">
          <h2 className="text-lg font-semibold">Create announcement</h2>
          {!selectedGrade ? (
            <div className="text-sm muted">Select a grade before posting an announcement.</div>
          ) : (
            <form onSubmit={createAnnouncement} className="space-y-2">
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
                  {creatingAnnouncement ? 'Saving...' : 'Post announcement'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <div className="card space-y-3">
        <h2 className="text-lg font-semibold">Grade updates — {activeGradeLabel}</h2>
        {status !== 'authenticated' ? (
          <div className="text-sm muted">Please sign in to view announcements.</div>
        ) : !selectedGrade ? (
          <div className="text-sm muted">Select a grade to view announcements.</div>
        ) : announcementsError ? (
          <div className="text-sm text-red-600">{announcementsError}</div>
        ) : announcementsLoading ? (
          <div className="text-sm muted">Loading announcements...</div>
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
      </div>
    </div>
  )

  const SessionsSection = () => {
    const canCreateSession = Boolean(session && (session as any).user?.role && ((session as any).user.role === 'admin' || (session as any).user.role === 'teacher'))

    return (
      <div className="space-y-6">
        <div className="card space-y-3">
          <h2 className="text-lg font-semibold">Create session</h2>
          {!canCreateSession ? (
            <div className="text-sm muted">You do not have permission to create sessions. Contact an admin to request instructor access.</div>
          ) : !selectedGrade ? (
            <div className="text-sm muted">Select a grade before creating a session.</div>
          ) : (
            <form onSubmit={createSession} className="space-y-3">
              <p className="text-sm muted">This session will be visible only to {activeGradeLabel} learners.</p>
              <input className="input" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
              <input className="input" placeholder="Join URL (Teams, Padlet, Zoom)" value={joinUrl} onChange={e => setJoinUrl(e.target.value)} />
              <input className="input" type="datetime-local" value={startsAt} min={minStartsAt} step={60} onChange={e => setStartsAt(e.target.value)} />
              <div>
                <button className="btn btn-primary" type="submit">Create</button>
              </div>
            </form>
          )}
        </div>

        <div className="card space-y-3">
          <h2 className="text-lg font-semibold">Upcoming sessions — {activeGradeLabel}</h2>
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
                              {materialUploading ? 'Uploading...' : 'Upload material'}
                            </button>
                          </div>
                        </form>
                      )}
                      {materialsError ? (
                        <div className="text-sm text-red-600">{materialsError}</div>
                      ) : materialsLoading ? (
                        <div className="text-sm muted">Loading materials...</div>
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
      </div>
    )
  }

  const UsersSection = () => (
    <div className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Manage users</h2>
        <p className="text-sm muted">Create learners and instructors, update their access, and remove accounts when needed.</p>
      </div>

      <div className="space-y-2">
        <h3 className="font-medium">Create user</h3>
        <div className="grid gap-2 lg:grid-cols-2">
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
        </div>
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

      {usersLoading ? (
        <div className="text-sm muted">Loading users...</div>
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
  )

  const BillingSection = () => (
    <div className="space-y-6">
      <div className="card space-y-3">
        <h2 className="text-lg font-semibold">Create subscription plan</h2>
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

      <div className="card space-y-3">
        <h2 className="text-lg font-semibold">Existing plans</h2>
        {plansLoading ? <div className="text-sm muted">Loading...</div> : (
          plans.length === 0 ? <div className="text-sm muted">No plans found.</div> : (
            <ul className="space-y-2">
              {plans.map(p => (
                <li key={p.id} className="p-2 border rounded">
                  {editingPlanId === p.id ? (
                    <div className="space-y-2">
                      <input className="input" value={editPlanName} onChange={e => setEditPlanName(e.target.value)} placeholder="Plan name" />
                      <input className="input" type="number" value={editPlanAmount as any} onChange={e => setEditPlanAmount(e.target.value ? parseInt(e.target.value, 10) : '')} placeholder="Amount (cents)" />
                      <div className="text-sm muted">Currency: {(p.currency || 'zar').toUpperCase()}</div>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={editPlanActive} onChange={e => setEditPlanActive(e.target.checked)} />
                        <span>Active</span>
                      </label>
                      <div className="flex gap-2">
                        <button className="btn btn-primary" onClick={savePlanChanges} disabled={planSaving}>
                          {planSaving ? 'Saving...' : 'Save changes'}
                        </button>
                        <button className="btn btn-ghost" onClick={resetPlanEdit} disabled={planSaving}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-sm muted">{(p.amount / 100).toFixed(2)} {p.currency?.toUpperCase()} {p.active ? '(active)' : '(inactive)'}</div>
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
  )

  const renderSection = () => {
    switch (activeSection) {
      case 'live':
        return <LiveSection />
      case 'announcements':
        return <AnnouncementsSection />
      case 'sessions':
        return <SessionsSection />
      case 'users':
        return <UsersSection />
      case 'billing':
        return <BillingSection />
      default:
        return <OverviewSection />
    }
  }

  const SectionNav = () => {
    if (availableSections.length <= 1) return null

    return (
      <div className="space-y-3">
        <div className="hidden lg:grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          {availableSections.map(section => {
            const isActive = activeSection === section.id
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                className={`rounded-2xl border px-4 py-3 text-left transition focus:outline-none focus:ring-2 ${
                  isActive
                    ? 'border-blue-500 bg-white text-slate-900 shadow-lg focus:ring-blue-200'
                    : 'border-white/10 bg-white/5 text-white/80 hover:border-white/30 focus:ring-white/10'
                }`}
              >
                <div className="text-sm font-semibold tracking-wide uppercase">{section.label}</div>
                <div className="text-xs opacity-70">{section.description}</div>
              </button>
            )
          })}
        </div>

        <div className="lg:hidden grid grid-cols-2 gap-3">
          {availableSections.map(section => {
            const isActive = activeSection === section.id
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 ${
                  isActive
                    ? 'bg-white text-[#04123b] border-white focus:ring-white/40 shadow-lg'
                    : 'bg-white/10 border-white/20 text-white focus:ring-white/20'
                }`}
              >
                {section.label}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  const boardLinkHref = selectedGrade ? `/board?grade=${encodeURIComponent(selectedGrade)}` : '/board'

  return (
    <main className={`${isMobile ? 'mobile-dashboard-theme bg-gradient-to-b from-[#010924] via-[#041550] to-[#071e63] text-white' : 'deep-page'} min-h-screen pb-16`}>
      {!isMobile && <NavArrows backHref="/api/auth/signin" forwardHref={undefined} />}
      <div className={`max-w-6xl mx-auto ${isMobile ? 'px-4 py-6 space-y-5' : 'px-4 lg:px-8 py-8 space-y-6'}`}>
        {isMobile ? (
          <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#020b35] via-[#041448] to-[#031641] px-5 py-6 text-center shadow-2xl space-y-4">
            <div className="flex justify-center">
              <BrandLogo height={68} className="drop-shadow-[0_15px_35px_rgba(5,10,35,0.7)]" />
            </div>
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.35em] text-blue-200">Dashboard</p>
              <h1 className="text-3xl font-semibold">Stay ready for class</h1>
              <p className="text-sm text-blue-100/80">Manage your grade workspace, join live sessions, and launch the canvas without leaving this hub.</p>
            </div>
            <div className="text-xs text-blue-100/70">
              {session ? (
                <>Signed in as <span className="font-semibold">{session.user?.email}</span></>
              ) : (
                'Sign in to unlock every tool.'
              )}
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                className="px-5 py-2 rounded-full bg-white text-[#05133e] font-semibold shadow-lg"
                onClick={() => setActiveSection('live')}
              >
                Live class
              </button>
              <Link
                href={boardLinkHref}
                className="px-5 py-2 rounded-full border border-white/30 text-sm font-semibold text-white hover:bg-white/10"
              >
                Canvas
              </Link>
            </div>
            <div className="flex flex-wrap justify-center gap-2 text-[11px] text-blue-100/70">
              <span className="px-3 py-1 rounded-full bg-white/10 border border-white/20">Grade: {activeGradeLabel}</span>
              <span className="px-3 py-1 rounded-full bg-white/10 border border-white/20">Role: {(session as any)?.user?.role || 'guest'}</span>
            </div>
          </section>
        ) : (
          <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <BrandLogo height={56} className="drop-shadow-[0_20px_45px_rgba(3,5,20,0.6)]" />
              <div>
                <h1 className="text-3xl font-bold">Dashboard</h1>
                <p className="text-sm muted">Manage your classes, communicate with learners, and handle billing from one place.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {session ? (
                <div className="text-sm muted">Signed in as <span className="font-medium text-white">{session.user?.email}</span></div>
              ) : (
                <Link href="/api/auth/signin" className="btn btn-primary">Sign in</Link>
              )}
            </div>
          </header>
        )}

        <SectionNav />

        <section className="min-w-0 space-y-6">
          {renderSection()}
        </section>
      </div>
    </main>
  )
}

export async function getServerSideProps(context: any) {
  // protect page server-side if desired
  const session = await getSession(context)
  return { props: { session } }
}
