import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import BrandLogo from '../components/BrandLogo'
import { gradeToLabel, GRADE_VALUES, GradeValue, normalizeGradeInput } from '../lib/grades'

const MyScriptMathCanvas = dynamic(() => import('../components/MyScriptMathCanvas'), { ssr: false })
const FloatingJitsiWindow = dynamic(() => import('../components/FloatingJitsiWindow'), { ssr: false })
const DiagramOverlayModule = dynamic(() => import('../components/DiagramOverlayModule'), { ssr: false })

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

  return (
    <div className="board-fullscreen">
      <div className="board-fullscreen__topbar">
        <Link href="/dashboard" className="board-fullscreen__back" aria-label="Back to dashboard">
          ←
        </Link>
        <div className="board-fullscreen__brand">
          <BrandLogo height={isMobile ? 28 : 34} className="opacity-90" />
        </div>
        <div className="board-fullscreen__controls">
          {isMobile ? (
            <button
              type="button"
              className="board-fullscreen__grade"
              onClick={() => setGradePickerOpen(prev => !prev)}
              aria-label="Choose grade"
            >
              {activeGradeLabel}
            </button>
          ) : (
            <select
              className="input board-fullscreen__select"
              value={selectedGrade ?? ''}
              onChange={e => handleGradeChange(e.target.value)}
              aria-label="Choose grade"
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
      </div>

      {isMobile && gradePickerOpen && (
        <div className="board-fullscreen__picker">
          <select
            className="input w-full"
            value={selectedGrade ?? ''}
            onChange={e => handleGradeChange(e.target.value)}
            aria-label="Select a grade"
          >
            <option value="">Select a grade</option>
            {gradeOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="board-fullscreen__stage relative" ref={canvasStageRef}>
        {renderCanvas()}
        {status === 'authenticated' && selectedGrade && (
          <DiagramOverlayModule
            boardId={undefined}
            gradeLabel={activeGradeLabel}
            userId={realtimeUserId}
            userDisplayName={realtimeDisplayName}
            isAdmin={isOwnerUser}
          />
        )}
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
    </div>
  )
}
