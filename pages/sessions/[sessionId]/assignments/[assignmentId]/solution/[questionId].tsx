import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useSession } from 'next-auth/react'
import dynamic from 'next/dynamic'

const StackedCanvasWindow = dynamic(() => import('../../../../../../components/StackedCanvasWindow'), { ssr: false })

export default function AssignmentSolutionQuestionPage() {
  const router = useRouter()
  const { data: session, status } = useSession()

  const sessionId = typeof router.query.sessionId === 'string' ? router.query.sessionId : ''
  const assignmentId = typeof router.query.assignmentId === 'string' ? router.query.assignmentId : ''
  const questionId = typeof router.query.questionId === 'string' ? router.query.questionId : ''

  const role = useMemo(() => ((session as any)?.user?.role || '') as string, [session])
  const canEditSolution = role === 'admin' || role === 'teacher'

  const userId = useMemo(() => {
    const anySession = session as any
    return (anySession?.user?.id || session?.user?.email || '') as string
  }, [session])
  const userDisplayName = session?.user?.name || session?.user?.email || ''

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [assignment, setAssignment] = useState<any | null>(null)
  const [question, setQuestion] = useState<any | null>(null)
  const [existingSolutionLatex, setExistingSolutionLatex] = useState<string>('')

  useEffect(() => {
    if (!sessionId || !assignmentId || !questionId) return
    if (status !== 'authenticated') return
    if (!canEditSolution) return

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

        try {
          const rr = await fetch(
            `/api/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}/solutions`,
            { credentials: 'same-origin' }
          )
          const rdata = await rr.json().catch(() => ({}))
          if (cancelled) return
          if (rr.ok) {
            const latex = String(rdata?.byQuestionId?.[String(questionId)]?.latex || '')
            setExistingSolutionLatex(latex)
          } else {
            setExistingSolutionLatex('')
          }
        } catch {
          if (!cancelled) setExistingSolutionLatex('')
        }
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
  }, [assignmentId, canEditSolution, questionId, sessionId, status])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (event: Event) => {
      const detail = (event as CustomEvent)?.detail as any
      if (!detail) return
      if (String(detail?.assignmentId || '') !== String(assignmentId)) return
      if (String(detail?.questionId || '') !== String(questionId)) return
      const latex = typeof detail?.latex === 'string' ? detail.latex : ''
      setExistingSolutionLatex(latex)
    }
    window.addEventListener('philani:assignment-solution-saved', handler as any)
    return () => window.removeEventListener('philani:assignment-solution-saved', handler as any)
  }, [assignmentId, questionId])

  const initialQuiz = useMemo(() => {
    if (!assignment || !question) return null
    const quizId = `assignment-solution:${String(assignment.id)}:${String(question.id)}`
    const order = typeof question.order === 'number' && Number.isFinite(question.order) ? Math.trunc(question.order) : null
    const quizLabel = `Solution • Q${order != null ? order + 1 : ''}`
    return {
      quizId,
      quizLabel,
      prompt: String(question.latex || ''),
    }
  }, [assignment, question])

  if (status === 'loading') {
    return <div className="p-6">Loading…</div>
  }

  if (status !== 'authenticated') {
    return (
      <div className="p-6 space-y-3">
        <div className="text-lg font-semibold">Sign in required</div>
        <Link href="/api/auth/signin" className="btn btn-primary">Sign in</Link>
      </div>
    )
  }

  if (!canEditSolution) {
    return (
      <div className="p-6 space-y-3">
        <div className="text-lg font-semibold">Forbidden</div>
        <div className="text-sm text-slate-600">Only teachers/admin can edit solutions.</div>
        <Link href="/dashboard" className="btn btn-primary">Back</Link>
      </div>
    )
  }

  if (loading) {
    return <div className="p-6">Loading…</div>
  }

  if (error) {
    return (
      <div className="p-6 space-y-3">
        <div className="text-lg font-semibold text-red-600">Error</div>
        <div className="text-sm text-slate-700">{error}</div>
        <Link href="/dashboard" className="btn btn-primary">Back</Link>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-slate-950 text-white overflow-hidden">
      {initialQuiz && sessionId ? (
        <div className="absolute inset-0">
          {(() => {
            const realtimeScopeId = `assignment-solution:${assignmentId}:q:${questionId}:u:${userId || 'teacher'}`
            return (
              <StackedCanvasWindow
                gradeLabel={null}
                roomId={`assignment-solution-${assignmentId}-q-${questionId}`}
                boardId={sessionId}
                realtimeScopeId={realtimeScopeId}
                userId={userId || 'teacher'}
                userDisplayName={userDisplayName}
                isAdmin
                quizMode
                initialQuiz={initialQuiz}
                assignmentSubmission={{ sessionId, assignmentId, questionId, kind: 'solution', initialLatex: existingSolutionLatex || undefined }}
                isVisible
                defaultOrientation="portrait"
              />
            )
          })()}
        </div>
      ) : null}
    </div>
  )
}
