import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useSession } from 'next-auth/react'
import dynamic from 'next/dynamic'
import katex from 'katex'

const StackedCanvasWindow = dynamic(() => import('../../../../../../components/StackedCanvasWindow'), { ssr: false })

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
  const [existingResponseLatex, setExistingResponseLatex] = useState<string>('')
  const [submittedAt, setSubmittedAt] = useState<string | null>(null)
  const [metaVisible, setMetaVisible] = useState(false)

  const renderKatexDisplayHtml = useCallback((latex: unknown) => {
    const value = typeof latex === 'string' ? latex.trim() : ''
    if (!value) return ''
    try {
      return katex.renderToString(value, {
        displayMode: true,
        throwOnError: false,
        strict: 'ignore',
      })
    } catch {
      return ''
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => {
      setMetaVisible(v => !v)
    }
    window.addEventListener('philani:assignment-meta-peek', handler as any)
    return () => {
      window.removeEventListener('philani:assignment-meta-peek', handler as any)
    }
  }, [])

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

        // Fetch learner's saved response for this question (if any) so they can edit.
        try {
          const rr = await fetch(
            `/api/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}/responses`,
            { credentials: 'same-origin' }
          )
          const rdata = await rr.json().catch(() => ({}))
          if (cancelled) return
          if (rr.ok) {
            const latex = String(rdata?.byQuestionId?.[String(questionId)]?.latex || '')
            setExistingResponseLatex(latex)
            const sAt = rdata?.submittedAt ? String(rdata.submittedAt) : null
            setSubmittedAt(sAt)
          } else {
            setExistingResponseLatex('')
            setSubmittedAt(null)
          }
        } catch {
          if (!cancelled) {
            setExistingResponseLatex('')
            setSubmittedAt(null)
          }
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
  }, [assignmentId, questionId, sessionId, status])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (event: Event) => {
      const detail = (event as CustomEvent)?.detail as any
      if (!detail) return
      if (String(detail?.assignmentId || '') !== String(assignmentId)) return
      if (String(detail?.questionId || '') !== String(questionId)) return
      const latex = typeof detail?.latex === 'string' ? detail.latex : ''
      setExistingResponseLatex(latex)
    }
    window.addEventListener('philani:assignment-response-saved', handler as any)
    return () => window.removeEventListener('philani:assignment-response-saved', handler as any)
  }, [assignmentId, questionId])

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
    <div className="fixed inset-0 bg-slate-950 text-white overflow-hidden">
      {error ? <div className="absolute top-2 left-2 right-2 z-50 text-red-300 text-sm">{error}</div> : null}
      {loading ? <div className="absolute top-2 left-2 right-2 z-50 text-white/70 text-sm">Loading…</div> : null}

      {submittedAt ? (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-lg w-full rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div className="text-lg font-semibold">Assignment submitted</div>
            <div className="text-sm text-white/80">
              This assignment was submitted on {new Date(submittedAt).toLocaleString()}. Editing is locked.
            </div>
            <div>
              <Link href="/dashboard" className="btn btn-primary">Back to dashboard</Link>
            </div>
          </div>
        </div>
      ) : initialQuiz && sessionId ? (
        <div className="absolute inset-0">
          {(() => {
            const realtimeScopeId = `assignment:${assignmentId}:q:${questionId}:u:${userId}`
            return (
              <StackedCanvasWindow
                gradeLabel={null}
                roomId={`assignment-${assignmentId}-q-${questionId}-u-${userId}`}
                boardId={sessionId}
                realtimeScopeId={realtimeScopeId}
                userId={userId}
                userDisplayName={userDisplayName}
                isAdmin={false}
                quizMode
                initialQuiz={initialQuiz}
                assignmentSubmission={{ sessionId, assignmentId, questionId, initialLatex: existingResponseLatex || undefined }}
                isVisible
                defaultOrientation="portrait"
              />
            )
          })()}
        </div>
      ) : null}

      {metaVisible ? (
        <div className="absolute top-3 left-3 right-3 z-50">
          <div
            className="rounded-2xl backdrop-blur-md px-4 py-3 flex items-center justify-between gap-3"
            style={{ background: 'var(--card)', border: '1px solid var(--card-border)' }}
            role="button"
            tabIndex={0}
            onClick={() => setMetaVisible(false)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') setMetaVisible(false)
            }}
          >
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.35em] text-white/70">Assignment</div>
              <div className="font-semibold break-words text-white">
                {(assignment as any)?.displayTitle || assignment?.title || 'Assignment'}
              </div>
              <div className="text-sm text-white/80">
                {((assignment as any)?.sectionLabel || (assignment as any)?.session?.title || 'Assignment').toString()}
                {question?.order != null ? ` • Q${Number(question.order) + 1}` : ''}
              </div>
              {question?.latex ? (
                <div className="mt-2 text-sm text-white/90">
                  {(() => {
                    const html = renderKatexDisplayHtml(String(question.latex || ''))
                    if (html) {
                      return <div className="leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
                    }
                    return <div className="whitespace-pre-wrap break-words">{String(question.latex || '')}</div>
                  })()}
                </div>
              ) : null}
            </div>
            <Link href="/dashboard" className="btn btn-ghost shrink-0" onClick={e => e.stopPropagation()}>
              Back
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  )
}
