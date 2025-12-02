import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import NavArrows from '../components/NavArrows'
import BrandLogo from '../components/BrandLogo'
import { gradeToLabel, GRADE_VALUES, GradeValue, normalizeGradeInput } from '../lib/grades'

const MyScriptMathCanvas = dynamic(() => import('../components/MyScriptMathCanvas'), { ssr: false })
const FloatingJitsiWindow = dynamic(() => import('../components/FloatingJitsiWindow'), { ssr: false })

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
  const canvasStageRef = useRef<HTMLDivElement | null>(null)

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
  const gradeRoomName = useMemo(() => {
    const appId = process.env.NEXT_PUBLIC_JAAS_APP_ID || ''
    const baseSlug = gradeSlug ?? 'public-room'
    const base = `philani-${baseSlug}`
    return appId ? `${appId}/${base}` : base
  }, [gradeSlug])
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
  const gradeTokenEndpoint = useMemo(() => {
    if (!gradeReady || !selectedGrade) return null
    return `/api/sessions/grade/${selectedGrade}/token`
  }, [gradeReady, selectedGrade])

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
      return <div className="text-sm muted">Sign in to open the canvas.</div>
    }
    if (!selectedGrade) {
      return <div className="text-sm muted">Choose a grade to continue.</div>
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
        <div className="px-5 pt-6 pb-4 space-y-3 border-b border-slate-800 text-center">
          <div className="flex justify-center">
            <BrandLogo height={60} className="drop-shadow-[0_18px_40px_rgba(2,6,20,0.7)]" />
          </div>
          <button
            type="button"
            className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/30 px-4 py-1 text-sm text-blue-100"
            onClick={() => router.push('/dashboard')}
          >
            ← Dashboard
          </button>
          <h1 className="text-2xl font-semibold">Maths Canvas</h1>
        </div>

        <div className="px-5 py-4 border-b border-slate-800 space-y-3 text-center">
          <button
            type="button"
            className="mx-auto inline-flex min-w-[180px] items-center justify-center rounded-2xl border border-slate-700 bg-slate-800 px-5 py-3 text-base font-semibold"
            onClick={() => setGradePickerOpen(prev => !prev)}
          >
            {activeGradeLabel}
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

        <div className="px-5 py-2 text-[11px] text-center text-white border-b border-slate-800">
          {status === 'authenticated' ? 'Ready' : 'Sign in to draw'}
        </div>

        <div className="flex-1 bg-white text-slate-900 rounded-t-3xl p-3">
          <div className="h-full rounded-3xl border border-slate-200 shadow-lg overflow-hidden">
            {renderCanvas()}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="board-page min-h-screen">
      <div className="board-page__inner mx-auto px-4 sm:px-6 lg:px-0 py-10 space-y-8">
        <section className="board-page__hero text-center space-y-4">
          <div className="flex items-center justify-between">
            <NavArrows backHref="/dashboard" forwardHref={undefined} />
            <Link href="/dashboard" className="btn btn-ghost text-sm">Back to dashboard</Link>
          </div>
          <div className="flex justify-center">
            <BrandLogo height={72} className="drop-shadow-[0_30px_60px_rgba(0,0,0,0.55)]" />
          </div>
          <h1 className="text-4xl font-semibold text-white">Maths Canvas</h1>
          <div className="flex flex-wrap justify-center gap-3 text-xs">
            <span className="board-chip">Grade: {activeGradeLabel}</span>
            <span className="board-chip">{status === 'authenticated' ? 'Signed in' : 'Sign in required'}</span>
          </div>
        </section>

        <section className="board-card text-center space-y-4">
          <select
            className="input mx-auto max-w-sm text-center"
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
        </section>

        <section className="board-card board-card--canvas">
          <div className="canvas-stage" ref={canvasStageRef}>
            {renderCanvas()}
            {status === 'authenticated' && !isMobile && selectedGrade && (
              <FloatingJitsiWindow
                roomName={gradeRoomName}
                displayName={realtimeDisplayName}
                tokenEndpoint={gradeTokenEndpoint}
                isOwner={isOwnerUser}
                gradeLabel={activeGradeLabel}
                boundsRef={canvasStageRef}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
