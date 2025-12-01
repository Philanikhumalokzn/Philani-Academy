import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import NavArrows from '../components/NavArrows'
import { gradeToLabel, GRADE_VALUES, GradeValue, normalizeGradeInput } from '../lib/grades'

const MyScriptMathCanvas = dynamic(() => import('../components/MyScriptMathCanvas'), { ssr: false })

const useIsMobile = (maxWidth = 768) => {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth < maxWidth
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleResize = () => {
      setIsMobile(window.innerWidth < maxWidth)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [maxWidth])

  return isMobile
}

export default function BoardPage() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const [selectedGrade, setSelectedGrade] = useState<GradeValue | null>(null)
  const [gradeReady, setGradeReady] = useState(false)
  const [gradePickerOpen, setGradePickerOpen] = useState(false)
  const isMobile = useIsMobile(768)

  useEffect(() => {
    if (!router.isReady) return
    let nextGrade: GradeValue | null = null
    const queryGrade = router.query.grade
    if (typeof queryGrade === 'string') {
      nextGrade = normalizeGradeInput(queryGrade)
    }
    if (!nextGrade) {
      const userGrade = normalizeGradeInput((session as any)?.user?.grade as string | undefined)
      if (userGrade) {
        nextGrade = userGrade
      }
    }
    setSelectedGrade(nextGrade)
    setGradeReady(true)
  }, [router.isReady, router.query.grade, session])

  const gradeOptions = useMemo(() => GRADE_VALUES.map(value => ({ value, label: gradeToLabel(value) })), [])
  const gradeSlug = useMemo(() => (selectedGrade ? selectedGrade.toLowerCase().replace(/_/g, '-') : null), [selectedGrade])
  const boardRoomId = useMemo(() => (gradeSlug ? `myscript-grade-${gradeSlug}` : 'myscript-grade-public'), [gradeSlug])
  const ownerEmail = process.env.NEXT_PUBLIC_OWNER_EMAIL || process.env.OWNER_EMAIL
  const isOwnerUser = Boolean(((session as any)?.user?.email && ownerEmail && (session as any)?.user?.email === ownerEmail) || (session as any)?.user?.role === 'admin')
  const realtimeUserId = useMemo(() => {
    const candidate = (session as any)?.user?.id as string | undefined
    if (candidate && typeof candidate === 'string') return candidate
    if (session?.user?.email) return session.user.email
    if (session?.user?.name) return session.user.name
    return 'guest'
  }, [session])
  const realtimeDisplayName = session?.user?.name || session?.user?.email || 'Participant'
  const activeGradeLabel = gradeReady ? (selectedGrade ? gradeToLabel(selectedGrade) : 'Select a grade') : 'Resolving grade'

  const handleGradeChange = (value: string) => {
    const next = normalizeGradeInput(value)
    setSelectedGrade(next)
    setGradePickerOpen(false)
    if (router.isReady) {
      const query = next ? { ...router.query, grade: next } : { ...router.query }
      if (!next) delete query.grade
      router.replace({ pathname: router.pathname, query }, undefined, { shallow: true })
    }
  }

  useEffect(() => {
    if (!isMobile) {
      setGradePickerOpen(false)
    }
  }, [isMobile])

  const renderCanvas = () => {
    if (status !== 'authenticated') {
      return <div className="text-sm muted">Sign in to launch the collaborative canvas.</div>
    }
    if (!selectedGrade) {
      return <div className="text-sm muted">Choose a grade to open the shared board.</div>
    }
    return (
      <div className="h-full">
        <MyScriptMathCanvas
          gradeLabel={activeGradeLabel}
          roomId={boardRoomId}
          userId={realtimeUserId}
          userDisplayName={realtimeDisplayName}
          isAdmin={isOwnerUser}
        />
      </div>
    )
  }

  if (isMobile) {
    return (
      <div className="flex h-screen flex-col bg-slate-900 text-white">
        <div className="px-4 pt-5 pb-3 space-y-3 border-b border-slate-800">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              className="text-sm text-blue-200 underline underline-offset-2"
              onClick={() => router.push('/dashboard')}
            >
              Dashboard
            </button>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Shared board</p>
              <h1 className="text-xl font-semibold">Maths Canvas</h1>
              <p className="text-xs text-slate-400">Tap the grade selector, then draw with pen or finger.</p>
            </div>
          </div>
          <p className="text-xs text-slate-400">Tip: rotate your phone to landscape for extra writing space.</p>
        </div>

        <div className="px-4 py-3 border-b border-slate-800 space-y-2">
          <button
            type="button"
            className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-left"
            onClick={() => setGradePickerOpen(prev => !prev)}
          >
            <span className="block text-xs uppercase text-slate-400">Active grade</span>
            <span className="text-base font-semibold">{activeGradeLabel}</span>
            <span className="text-[11px] text-slate-500">Tap to {gradePickerOpen ? 'hide' : 'change'} grade</span>
          </button>
          {gradePickerOpen && (
            <select
              className="input w-full text-slate-900"
              value={selectedGrade ?? ''}
              onChange={e => handleGradeChange(e.target.value)}
            >
              <option value="">Select a grade</option>
              {gradeOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="px-4 py-2 text-[11px] text-slate-400 border-b border-slate-800 flex items-center justify-between">
          <span>{status === 'authenticated' ? 'You are signed in.' : 'Sign in required to draw.'}</span>
          <span className="text-blue-200">All tools live inside the board menu.</span>
        </div>

        <div className="flex-1 bg-white text-slate-900 rounded-t-3xl p-3">
          <div className="h-full rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {renderCanvas()}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div className="flex flex-col gap-4">
          <div className="hidden md:block">
            <NavArrows backHref="/dashboard" forwardHref={undefined} />
          </div>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Shared board</p>
              <h1 className="text-2xl font-bold text-slate-900">Mathematics Canvas</h1>
              <p className="text-sm text-slate-600">Full-screen collaborative board for instructors and students.</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/dashboard" className="btn btn-ghost">Return to Dashboard</Link>
            </div>
          </div>
          <div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div>
                <h2 className="text-lg font-semibold">Active grade</h2>
                <p className="text-sm text-slate-500">{activeGradeLabel}</p>
              </div>
              <select
                className="input w-full sm:w-auto"
                value={selectedGrade ?? ''}
                onChange={e => handleGradeChange(e.target.value)}
              >
                <option value="">Select a grade</option>
                {gradeOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="card">
          {renderCanvas()}
        </div>
      </div>
    </div>
  )
}
