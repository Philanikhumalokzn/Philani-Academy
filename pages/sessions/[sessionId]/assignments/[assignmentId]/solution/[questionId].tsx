import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useSession } from 'next-auth/react'
import dynamic from 'next/dynamic'
import katex from 'katex'

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
  const [metaVisible, setMetaVisible] = useState(false)

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
    return () => window.removeEventListener('philani:assignment-meta-peek', handler as any)
  }, [])

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

      {metaVisible ? (
        <div className="absolute top-3 left-3 right-3 z-50">
          <div
            className="rounded backdrop-blur-md px-4 py-3 flex items-center justify-between gap-3"
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
