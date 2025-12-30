import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useSession } from 'next-auth/react'
import dynamic from 'next/dynamic'

const MyScriptMathCanvas = dynamic(() => import('../../../../../../components/MyScriptMathCanvas'), { ssr: false })

export default function AssignmentQuestionPage() {
  const router = useRouter()
  const { data: session, status } = useSession()

  const sessionId = typeof router.query.sessionId === 'string' ? router.query.sessionId : ''
  const assignmentId = typeof router.query.assignmentId === 'string' ? router.query.assignmentId : ''
  const questionId = typeof router.query.questionId === 'string' ? router.query.questionId : ''

  const userId = useMemo(() => {
    const anySession = session as any
    return (anySession?.user?.id || session?.user?.email || '') as string
  }, [session])
  const userDisplayName = session?.user?.name || session?.user?.email || ''

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [assignment, setAssignment] = useState<any | null>(null)
  const [question, setQuestion] = useState<any | null>(null)

  const [chromeVisible, setChromeVisible] = useState(true)
  const chromeHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleChromeHide = useCallback(() => {
    if (chromeHideTimeoutRef.current) {
      clearTimeout(chromeHideTimeoutRef.current)
      chromeHideTimeoutRef.current = null
    }
    chromeHideTimeoutRef.current = setTimeout(() => {
      setChromeVisible(false)
    }, 1500)
  }, [])

  const revealChrome = useCallback(() => {
    setChromeVisible(true)
    scheduleChromeHide()
  }, [scheduleChromeHide])

  useEffect(() => {
    revealChrome()
    return () => {
      if (chromeHideTimeoutRef.current) clearTimeout(chromeHideTimeoutRef.current)
    }
  }, [revealChrome])

  useEffect(() => {
    if (!sessionId || !assignmentId || !questionId) return
    if (status !== 'authenticated') return

    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}`, {
          credentials: 'same-origin',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.message || `Failed to load assignment (${res.status})`)
        if (cancelled) return
        setAssignment(data)
        const qs = Array.isArray(data?.questions) ? data.questions : []
        const found = qs.find((q: any) => String(q?.id) === String(questionId)) || null
        setQuestion(found)
        if (!found) setError('Question not found')
      } catch (err: any) {
        if (cancelled) return
        setError(err?.message || 'Failed to load assignment')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [assignmentId, questionId, sessionId, status])

  const initialQuiz = useMemo(() => {
    if (!assignment || !question) return null
    const quizId = `assignment:${String(assignment.id)}:${String(question.id)}`
    const order = typeof question.order === 'number' && Number.isFinite(question.order) ? Math.trunc(question.order) : null
    const quizLabel = `Assignment • Q${order != null ? order + 1 : ''}`
    return {
      quizId,
      quizLabel,
      prompt: String(question.latex || ''),
    }
  }, [assignment, question])

  const realtimeKey = useMemo(() => {
    if (!assignmentId || !questionId) return ''
    return `assignment-${assignmentId}-q-${questionId}`
  }, [assignmentId, questionId])

  if (status === 'loading') {
    return <div className="p-6">Loading…</div>
  }

  if (status !== 'authenticated') {
    return (
      <div className="p-6 space-y-3">
        <div className="text-lg font-semibold">Sign in required</div>
        <Link href="/api/auth/signin" className="btn btn-primary">
          Sign in
        </Link>
      </div>
    )
  }

  if (!userId) {
    return <div className="p-6">Missing user identity. Please sign out and sign in again.</div>
  }

  return (
    <div
      className="fixed inset-0 bg-slate-950 text-white overflow-hidden"
      onPointerDown={() => {
        // Any tap reveals the top chrome briefly.
        revealChrome()
      }}
    >
      <div
        className={`absolute top-0 left-0 right-0 z-30 border-b border-white/10 bg-slate-950/70 backdrop-blur transition-all ${chromeVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}`}
      >
        <div className="p-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm text-white/70">Assignment</div>
            <div className="font-semibold break-words">
              {assignment?.title || 'Assignment'}
              {question?.order != null ? ` • Q${Number(question.order) + 1}` : ''}
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <Link href="/dashboard" className="btn btn-ghost">
              Back
            </Link>
          </div>
        </div>
      </div>

      {error ? <div className="absolute top-16 left-0 right-0 z-20 p-3 text-red-300">{error}</div> : null}
      {loading ? <div className="absolute top-16 left-0 right-0 z-20 p-3 text-white/70">Loading…</div> : null}

      <div className="absolute inset-0 pt-0">
        {initialQuiz && sessionId && realtimeKey ? (
          <div className="absolute inset-0">
            <MyScriptMathCanvas
              uiMode="overlay"
              gradeLabel={undefined}
              roomId={realtimeKey}
              realtimeKey={realtimeKey}
              boardId={sessionId}
              userId={userId}
              userDisplayName={userDisplayName}
              isAdmin={false}
              quizMode
              initialQuiz={initialQuiz}
              studentLayout="canvasOnly"
              defaultOrientation="portrait"
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
