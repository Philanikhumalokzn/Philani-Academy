import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useSession } from 'next-auth/react'
import dynamic from 'next/dynamic'
import katex from 'katex'
import { isSpecialTestStudentEmail } from '../../../../../../lib/testUsers'
import useRedirectToDashboardOnReload from '../../../../../../lib/useRedirectToDashboardOnReload'

const StackedCanvasWindow = dynamic(() => import('../../../../../../components/StackedCanvasWindow'), { ssr: false })

export default function AssignmentQuestionPage() {
  const router = useRouter()
  useRedirectToDashboardOnReload(true)
  const { data: session, status } = useSession()

  const sessionId = typeof router.query.sessionId === 'string' ? router.query.sessionId : ''
  const assignmentId = typeof router.query.assignmentId === 'string' ? router.query.assignmentId : ''
  const questionId = typeof router.query.questionId === 'string' ? router.query.questionId : ''

  const userId = useMemo(() => {
    const anySession = session as any
    return (anySession?.user?.id || session?.user?.email || '') as string
  }, [session])
  const userDisplayName = session?.user?.name || session?.user?.email || ''
  const isTestStudent = useMemo(() => isSpecialTestStudentEmail(session?.user?.email || ''), [session])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [assignment, setAssignment] = useState<any | null>(null)
  const [question, setQuestion] = useState<any | null>(null)
  const [existingResponseLatex, setExistingResponseLatex] = useState<string>('')
  const [submittedAt, setSubmittedAt] = useState<string | null>(null)
  const [metaVisible, setMetaVisible] = useState(false)
  const [assignmentSubmitting, setAssignmentSubmitting] = useState(false)
  const [assignmentSubmitError, setAssignmentSubmitError] = useState<string | null>(null)

  const renderTextWithKatex = useCallback((text: unknown) => {
    const input = typeof text === 'string' ? text : ''
    if (!input) return input

    const nodes: Array<string | { display: boolean; expr: string }> = []
    let i = 0

    const pushText = (s: string) => {
      if (!s) return
      const last = nodes[nodes.length - 1]
      if (typeof last === 'string') nodes[nodes.length - 1] = last + s
      else nodes.push(s)
    }

    const tryReadDelimited = (open: string, close: string, display: boolean) => {
      if (!input.startsWith(open, i)) return false
      const start = i + open.length
      const end = input.indexOf(close, start)
      if (end < 0) return false
      const expr = input.slice(start, end).trim()
      i = end + close.length
      if (!expr) {
        pushText(open + close)
        return true
      }
      nodes.push({ display, expr })
      return true
    }

    while (i < input.length) {
      if (tryReadDelimited('$$', '$$', true)) continue
      if (tryReadDelimited('\\[', '\\]', true)) continue
      if (tryReadDelimited('\\(', '\\)', false)) continue

      // Inline $...$ (ignore escaped \$)
      if (input[i] === '$' && (i === 0 || input[i - 1] !== '\\')) {
        if (input[i + 1] === '$') {
          pushText('$')
          i += 1
          continue
        }
        const start = i + 1
        let end = start
        while (end < input.length) {
          if (input[end] === '$' && input[end - 1] !== '\\') break
          end += 1
        }
        if (end < input.length && input[end] === '$') {
          const expr = input.slice(start, end).trim()
          i = end + 1
          if (!expr) {
            pushText('$$')
            continue
          }
          nodes.push({ display: false, expr })
          continue
        }
      }

      // Plain text
      let j = i + 1
      while (j < input.length) {
        const c = input[j]
        if (c === '$') break
        if (c === '\\' && (input.startsWith('\\[', j) || input.startsWith('\\(', j))) break
        j += 1
      }
      pushText(input.slice(i, j))
      i = j
    }

    return nodes.map((n, idx) => {
      if (typeof n === 'string') return <span key={`t-${idx}`} className="whitespace-pre-wrap break-words">{n}</span>
      try {
        const html = katex.renderToString(n.expr, {
          displayMode: n.display,
          throwOnError: false,
          strict: 'ignore',
          errorColor: 'currentColor',
        })
        return (
          <span
            key={`k-${idx}`}
            className={n.display ? 'block leading-relaxed' : 'inline leading-relaxed'}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )
      } catch {
        return <span key={`e-${idx}`} className="whitespace-pre-wrap break-words">{n.expr}</span>
      }
    })
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

  const orderedQuestions = useMemo(() => {
    const qs = Array.isArray((assignment as any)?.questions) ? (assignment as any).questions : []
    return [...qs].sort((a, b) => {
      const ao = typeof a?.order === 'number' && Number.isFinite(a.order) ? a.order : 9999
      const bo = typeof b?.order === 'number' && Number.isFinite(b.order) ? b.order : 9999
      if (ao !== bo) return ao - bo
      return String(a?.id || '').localeCompare(String(b?.id || ''))
    })
  }, [assignment])

  const currentQuestionIndex = useMemo(() => {
    if (!orderedQuestions.length) return -1
    return orderedQuestions.findIndex((q: any) => String(q?.id) === String(questionId))
  }, [orderedQuestions, questionId])

  const prevQuestionId = useMemo(() => {
    if (currentQuestionIndex <= 0) return null
    return orderedQuestions[currentQuestionIndex - 1]?.id || null
  }, [currentQuestionIndex, orderedQuestions])

  const nextQuestionId = useMemo(() => {
    if (currentQuestionIndex < 0) return null
    if (currentQuestionIndex >= orderedQuestions.length - 1) return null
    return orderedQuestions[currentQuestionIndex + 1]?.id || null
  }, [currentQuestionIndex, orderedQuestions])

  const isLastQuestion = currentQuestionIndex >= 0 && currentQuestionIndex === orderedQuestions.length - 1

  const submitAssignment = useCallback(async () => {
    if (assignmentSubmitting) return
    if (!sessionId || !assignmentId) return
    setAssignmentSubmitError(null)

    if (!isTestStudent) {
      alert('Submitting will lock this assignment. You will no longer be able to edit your answers after submission.')
    }

    const ok = window.confirm(
      isTestStudent
        ? submittedAt
          ? 'Resubmit this assignment now? (Test account: editing stays unlocked)'
          : 'Submit this assignment now? (Test account: editing stays unlocked)'
        : 'Submit this assignment now?'
    )
    if (!ok) return

    setAssignmentSubmitting(true)
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}/submit`,
        { method: 'POST', credentials: 'same-origin' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Submit failed (${res.status})`)
      setSubmittedAt(data?.submittedAt ? String(data.submittedAt) : new Date().toISOString())
      alert(isTestStudent && submittedAt ? 'Assignment resubmitted.' : 'Assignment submitted.')
    } catch (err: any) {
      setAssignmentSubmitError(err?.message || 'Submit failed')
      alert(err?.message || 'Submit failed')
    } finally {
      setAssignmentSubmitting(false)
    }
  }, [assignmentId, assignmentSubmitting, isTestStudent, sessionId, submittedAt])

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

      {submittedAt && !isTestStudent ? (
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
            className="rounded-2xl backdrop-blur-md px-4 py-3 flex items-start justify-between gap-3 relative"
            style={{ background: 'var(--card)', border: '1px solid var(--card-border)' }}
            role="button"
            tabIndex={0}
            onClick={() => setMetaVisible(false)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') setMetaVisible(false)
            }}
          >
            <div className="min-w-0">
              <div className="text-xs text-white/80 flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-white">{(assignment as any)?.displayTitle || assignment?.title || 'Assignment'}</span>
                {question?.order != null ? <span className="text-white/80">• Q{Number(question.order) + 1}</span> : null}
                {(assignment as any)?.sectionLabel || (assignment as any)?.session?.title
                  ? <span className="text-white/70">• {String((assignment as any)?.sectionLabel || (assignment as any)?.session?.title || '')}</span>
                  : null}
              </div>
              {question?.latex ? (
                <div className="mt-2 text-sm text-white">{renderTextWithKatex(String(question.latex || ''))}</div>
              ) : null}
              {assignmentSubmitError ? (
                <div className="mt-2 text-xs text-red-200">{assignmentSubmitError}</div>
              ) : null}
              <div className="mt-3 flex items-center justify-between gap-3 w-full">
                <button
                  type="button"
                  className="px-2 text-4xl font-bold text-white/90 hover:text-white disabled:opacity-30"
                  disabled={!prevQuestionId}
                  aria-label="Previous question"
                  onClick={e => {
                    e.stopPropagation()
                    if (!prevQuestionId) return
                    void router.push(`/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}/q/${encodeURIComponent(String(prevQuestionId))}`)
                  }}
                >
                  ←
                </button>
                {isLastQuestion ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={assignmentSubmitting}
                    onClick={e => {
                      e.stopPropagation()
                      void submitAssignment()
                    }}
                  >
                    {assignmentSubmitting
                      ? 'Submitting…'
                      : (isTestStudent && submittedAt ? 'Resubmit Assignment' : 'Submit Assignment')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="px-2 text-4xl font-bold text-white/90 hover:text-white disabled:opacity-30"
                    disabled={!nextQuestionId}
                    aria-label="Next question"
                    onClick={e => {
                      e.stopPropagation()
                      if (!nextQuestionId) return
                      void router.push(`/sessions/${encodeURIComponent(sessionId)}/assignments/${encodeURIComponent(assignmentId)}/q/${encodeURIComponent(String(nextQuestionId))}`)
                    }}
                  >
                    →
                  </button>
                )}
              </div>
            </div>
            <button
              type="button"
              className="absolute top-2 right-2 h-8 w-8 rounded-full border border-white/20 text-white/80 hover:text-white hover:border-white/40"
              aria-label="Close"
              onClick={e => {
                e.stopPropagation()
                void router.push('/dashboard')
              }}
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
