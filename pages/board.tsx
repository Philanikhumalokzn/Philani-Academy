import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import BrandLogo from '../components/BrandLogo'
import { gradeToLabel, GRADE_VALUES, GradeValue, normalizeGradeInput } from '../lib/grades'
import type { JitsiControls, JitsiMuteState } from '../components/JitsiRoom'

const MyScriptMathCanvas = dynamic(() => import('../components/MyScriptMathCanvas'), { ssr: false })
const FloatingJitsiWindow = dynamic(() => import('../components/FloatingJitsiWindow'), { ssr: false })
const DiagramOverlayModule = dynamic(() => import('../components/DiagramOverlayModule'), { ssr: false })
const TextOverlayModule = dynamic(() => import('../components/TextOverlayModule'), { ssr: false })

const sanitizeIdentifier = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60)
const makeChannelName = (boardId: string) => `myscript:${sanitizeIdentifier(boardId).toLowerCase()}`

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

  const lessonAuthoring = router.isReady && router.query.lessonAuthoring === '1'
  const lessonAuthoringModule = router.isReady && typeof router.query.module === 'string' ? router.query.module : null
  const lessonAuthoringPhase = router.isReady && typeof router.query.phase === 'string' ? router.query.phase : null
  const lessonAuthoringPointId = router.isReady && typeof router.query.pointId === 'string' ? router.query.pointId : null
  const lessonAuthoringBoardId = router.isReady && typeof router.query.boardId === 'string' ? router.query.boardId : null
  const returnTo = useMemo(() => {
    if (!router.isReady) return '/dashboard'
    const value = router.query.returnTo
    if (typeof value === 'string' && value.trim()) return value
    return '/dashboard'
  }, [router.isReady, router.query.returnTo])

  useEffect(() => {
    if (!router.isReady) return

    if (lessonAuthoring) {
      setSelectedGrade(null)
      setGradeReady(true)
      return
    }

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
  }, [lessonAuthoring, router.isReady, router.query.grade, session])

  const gradeOptions = useMemo(() => GRADE_VALUES.map(value => ({ value, label: gradeToLabel(value) })), [])
  const gradeSlug = useMemo(() => (selectedGrade ? selectedGrade.toLowerCase().replace(/_/g, '-') : null), [selectedGrade])
  const boardRoomId = useMemo(() => {
    if (lessonAuthoring && lessonAuthoringBoardId) return makeChannelName(lessonAuthoringBoardId)
    return gradeSlug ? `myscript-grade-${gradeSlug}` : 'myscript-grade-public'
  }, [gradeSlug, lessonAuthoring, lessonAuthoringBoardId])
  const gradeRoomName = useMemo(() => {
    const appId = process.env.NEXT_PUBLIC_JAAS_APP_ID || ''
    const baseSlug = gradeSlug ?? 'public-room'
    const base = `philani-${baseSlug}`
    return appId ? `${appId}/${base}` : base
  }, [gradeSlug])
  const ownerEmail = process.env.NEXT_PUBLIC_OWNER_EMAIL || process.env.OWNER_EMAIL
  const isOwnerUser = Boolean(((session as any)?.user?.email && ownerEmail && (session as any)?.user?.email === ownerEmail) || (session as any)?.user?.role === 'admin')

  const isTeacherUser = Boolean((session as any)?.user?.role === 'teacher')

  const isLessonAuthoringTeacher = Boolean(
    lessonAuthoring &&
      (session as any)?.user?.role &&
      (((session as any).user.role === 'admin') || ((session as any).user.role === 'teacher'))
  )

  const isBoardAdmin = lessonAuthoring ? isLessonAuthoringTeacher : (isOwnerUser || isTeacherUser)
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

  const [teacherAudioEnabled, setTeacherAudioEnabled] = useState(false)
  const [teacherVideoVisible, setTeacherVideoVisible] = useState(false)
  const [studentMicEnabled, setStudentMicEnabled] = useState(false)
  const [jitsiControls, setJitsiControls] = useState<JitsiControls | null>(null)
  const [jitsiMuteState, setJitsiMuteState] = useState<JitsiMuteState>({ audioMuted: true, videoMuted: true })

  const shouldMountJitsi = Boolean(
    status === 'authenticated' &&
    !lessonAuthoring &&
    selectedGrade &&
    gradeRoomName &&
    gradeTokenEndpoint &&
    (teacherAudioEnabled || teacherVideoVisible || studentMicEnabled || isBoardAdmin)
  )

  // For the live board we drive all UX from the header icons, so remove the in-iframe toolbar.
  const boardJitsiToolbarButtons: string[] = []
  // Always start with camera off; we will toggle it via the header for teachers only.
  const startWithVideoMuted = true
  // Start with mic muted for everyone; teachers/students explicitly enable mic via header.
  const startWithAudioMuted = true

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
    if (!lessonAuthoring && !selectedGrade) {
      return <div className="text-sm muted">Choose a grade to open the shared board.</div>
    }
    return (
      <div className="h-full">
        <MyScriptMathCanvas
          gradeLabel={activeGradeLabel}
          roomId={boardRoomId}
          userId={realtimeUserId}
          userDisplayName={realtimeDisplayName}
          isAdmin={isBoardAdmin}
          boardId={lessonAuthoring ? (lessonAuthoringBoardId || undefined) : undefined}
          autoOpenDiagramTray={Boolean(lessonAuthoring && lessonAuthoringModule === 'diagram')}
          lessonAuthoring={lessonAuthoring && lessonAuthoringPhase && lessonAuthoringPointId
            ? { phaseKey: lessonAuthoringPhase, pointId: lessonAuthoringPointId }
            : undefined}
        />
      </div>
    )
  }

  // Note: do not force-open the diagram overlay here.
  // The middle-strip diagram icon uses a mobile tray toggle handler; lesson authoring should
  // trigger that same UX from inside the canvas component to keep behaviour identical.

  useEffect(() => {
    if (!router.isReady) return
    if (!lessonAuthoring) return
    if (typeof window === 'undefined') return

    const handler = () => {
      void router.push(returnTo)
    }
    window.addEventListener('philani-lesson-authoring:close', handler as any)
    return () => window.removeEventListener('philani-lesson-authoring:close', handler as any)
  }, [lessonAuthoring, returnTo, router, router.isReady])

  return (
    <div className="board-fullscreen">
      <div className="board-fullscreen__topbar">
        <Link
          href={lessonAuthoring ? returnTo : '/dashboard'}
          className="board-fullscreen__back"
          aria-label={lessonAuthoring ? 'Close authoring board' : 'Back to dashboard'}
        >
          {lessonAuthoring ? '✕' : '←'}
        </Link>
        <div className="board-fullscreen__brand">
          <BrandLogo height={isMobile ? 28 : 34} className="opacity-90" />
        </div>
        {!lessonAuthoring && (
          <div className="board-fullscreen__controls">
            {status === 'authenticated' && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="board-fullscreen__back"
                  aria-label={isBoardAdmin ? (jitsiMuteState.audioMuted ? 'Start teacher audio' : 'Stop teacher audio') : (teacherAudioEnabled ? 'Stop listening to teacher audio' : 'Listen to teacher audio')}
                  disabled={!gradeTokenEndpoint}
                  onClick={async () => {
                    if (!gradeTokenEndpoint) return
                    if (isBoardAdmin) {
                      // Teacher/admin: toggle their mic (commentary).
                      if (!jitsiControls) {
                        setTeacherAudioEnabled(true)
                        return
                      }
                      jitsiControls.toggleAudio()
                      return
                    }

                    // Student: connect/disconnect to pull teacher audio.
                    setTeacherAudioEnabled(prev => !prev)
                    if (teacherAudioEnabled && !studentMicEnabled && !teacherVideoVisible) {
                      setTeacherVideoVisible(false)
                      setStudentMicEnabled(false)
                    }
                  }}
                >
                  <span className="sr-only">Teacher audio</span>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                    <path d="M3 10v4a2 2 0 0 0 2 2h2.1l4.4 3.3A1 1 0 0 0 13 18.8V5.2a1 1 0 0 0-1.6-.8L7.1 8H5a2 2 0 0 0-2 2z" />
                    <path d="M16.5 8.2a1 1 0 0 1 1.4 0A6 6 0 0 1 20 12a6 6 0 0 1-2.1 3.8 1 1 0 1 1-1.3-1.5A4 4 0 0 0 18 12a4 4 0 0 0-1.5-2.3 1 1 0 0 1 0-1.5z" opacity="0.65" />
                  </svg>
                </button>

                <button
                  type="button"
                  className="board-fullscreen__back"
                  aria-label={teacherVideoVisible ? 'Hide teacher video' : 'Show teacher video'}
                  disabled={!gradeTokenEndpoint}
                  onClick={async () => {
                    if (!gradeTokenEndpoint) return
                    // Ensure we stay connected when opening the overlay.
                    setTeacherAudioEnabled(true)
                    setTeacherVideoVisible(prev => !prev)

                    // Teacher/admin: toggles their own camera when they show/hide video.
                    if (isBoardAdmin && jitsiControls) {
                      jitsiControls.toggleVideo()
                    }
                  }}
                >
                  <span className="sr-only">Teacher video</span>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                    <path d="M4 7a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7z" />
                    <path d="M16 10.5 21 7v10l-5-3.5v-3z" opacity="0.65" />
                  </svg>
                </button>

                {!isBoardAdmin && (
                  <button
                    type="button"
                    className="board-fullscreen__back"
                    aria-label={studentMicEnabled ? 'Mute your microphone' : 'Unmute your microphone'}
                    disabled={!gradeTokenEndpoint}
                    onClick={async () => {
                      if (!gradeTokenEndpoint) return
                      // Student mic publish toggle.
                      const next = !studentMicEnabled
                      setTeacherAudioEnabled(true)
                      setStudentMicEnabled(next)
                      if (!jitsiControls) return
                      // In JitsiMeetExternalAPI, toggleAudio controls the local mic mute state.
                      jitsiControls.toggleAudio()
                    }}
                  >
                    <span className="sr-only">Your microphone</span>
                    {studentMicEnabled ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                        <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
                        <path d="M7 11a1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.08A7 7 0 0 0 19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0z" opacity="0.65" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                        <path d="M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0V6z" opacity="0.65" />
                        <path d="M5 11a1 1 0 1 1 2 0 5 5 0 0 0 8.5 3.5 1 1 0 1 1 1.4 1.4A7 7 0 0 1 13 17.92V20h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.08A7 7 0 0 1 5 11z" />
                        <path d="M4 3.3a1 1 0 0 1 1.4 0l15.3 15.3a1 1 0 1 1-1.4 1.4L4 4.7a1 1 0 0 1 0-1.4z" />
                      </svg>
                    )}
                  </button>
                )}
              </div>
            )}
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
        )}
      </div>

      {!lessonAuthoring && isMobile && gradePickerOpen && (
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
        {status === 'authenticated' && (
          <>
            {/* In lesson authoring mode, only mount the tool the teacher asked for. */}
            {(lessonAuthoring ? lessonAuthoringModule === 'diagram' : Boolean(selectedGrade)) && (
              <DiagramOverlayModule
                boardId={lessonAuthoring ? (lessonAuthoringBoardId || undefined) : undefined}
                gradeLabel={lessonAuthoring ? null : activeGradeLabel}
                userId={realtimeUserId}
                userDisplayName={realtimeDisplayName}
                isAdmin={isBoardAdmin}
                lessonAuthoring={lessonAuthoring && lessonAuthoringPhase && lessonAuthoringPointId
                  ? { phaseKey: lessonAuthoringPhase, pointId: lessonAuthoringPointId }
                  : undefined}
              />
            )}

            {!lessonAuthoring && selectedGrade && (
              <TextOverlayModule
                boardId={undefined}
                gradeLabel={activeGradeLabel}
                userId={realtimeUserId}
                userDisplayName={realtimeDisplayName}
                isAdmin={isOwnerUser}
              />
            )}

            {shouldMountJitsi && (
              <FloatingJitsiWindow
                roomName={gradeRoomName}
                displayName={realtimeDisplayName}
                tokenEndpoint={gradeTokenEndpoint}
                isOwner={isOwnerUser}
                gradeLabel={activeGradeLabel}
                boundsRef={canvasStageRef}
                visible={teacherVideoVisible}
                toolbarButtons={boardJitsiToolbarButtons}
                startWithAudioMuted={startWithAudioMuted}
                startWithVideoMuted={startWithVideoMuted}
                onControlsChange={setJitsiControls}
                onMuteStateChange={setJitsiMuteState}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
