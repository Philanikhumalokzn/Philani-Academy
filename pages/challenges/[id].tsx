import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useSession } from 'next-auth/react'
import dynamic from 'next/dynamic'
import katex from 'katex'

const StackedCanvasWindow = dynamic(() => import('../../components/StackedCanvasWindow'), { ssr: false })

type Challenge = {
  id: string
  title?: string | null
  prompt: string
  imageUrl?: string | null
  grade?: string | null
  audience?: string | null
  createdAt?: string
  isOwner?: boolean
  isPrivileged?: boolean
  attemptsOpen?: boolean
  solutionsVisible?: boolean
  maxAttempts?: number | null
  myAttemptCount?: number
  closedAt?: string | null
  revealedAt?: string | null
  takers?: Array<{ userId: string; name: string; avatar: string | null; lastSubmittedAt: string; submissions: number }>
  attempts?: Array<{ id: string; userId: string; name: string; avatar: string | null; createdAt: string; latex: string; studentText?: string | null }>
  createdBy?: { id?: string; name?: string; avatar?: string | null } | null
}

export default function ChallengeAttemptPage() {
  const [metaVisible, setMetaVisible] = useState(false)
  const router = useRouter()
  const { data: session, status } = useSession()

  const id = typeof router.query.id === 'string' ? router.query.id : ''

  const [viewerId, setViewerId] = useState<string>('')
  const userDisplayName = session?.user?.name || session?.user?.email || ''

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [savingState, setSavingState] = useState(false)
  const [myResponses, setMyResponses] = useState<any[]>([])
  const [viewMode, setViewMode] = useState<'attempt' | 'view'>('attempt')

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

  const renderKatexDisplayHtml = useCallback((latex: unknown) => {
    const input = typeof latex === 'string' ? latex.trim() : ''
    if (!input) return ''
    try {
      return katex.renderToString(input, {
        throwOnError: false,
        displayMode: true,
      })
    } catch {
      return ''
    }
  }, [])

  const splitLatexIntoSteps = useCallback((latex: unknown) => {
    const raw = typeof latex === 'string' ? latex.replace(/\r\n/g, '\n').trim() : ''
    if (!raw) return [] as string[]
    const withNewlines = raw.replace(/\\\\/g, '\n')
    const steps = withNewlines
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
    return steps.slice(0, 30)
  }, [])

  const normalizeChallengeGrade = useCallback((gradingJson: any, stepCount: number) => {
    if (!gradingJson) return null

    const mapGrade = (grade: string) => {
      const g = String(grade || '')
      if (g === 'tick') return { awardedMarks: 1, isCorrect: true, isSignificant: true }
      if (g === 'dot-green') return { awardedMarks: 0, isCorrect: true, isSignificant: false }
      if (g === 'cross') return { awardedMarks: 0, isCorrect: false, isSignificant: true }
      if (g === 'dot-red') return { awardedMarks: 0, isCorrect: false, isSignificant: false }
      return { awardedMarks: 0, isCorrect: false, isSignificant: true }
    }

    if (Array.isArray(gradingJson?.steps)) {
      const steps = gradingJson.steps.map((s: any, idx: number) => {
        const stepNum = Number(s?.step)
        const step = Number.isFinite(stepNum) && stepNum > 0 ? Math.trunc(stepNum) : idx + 1
        const awardedMarks = Number(s?.awardedMarks ?? 0)
        const safeAwarded = Number.isFinite(awardedMarks) ? Math.max(0, Math.trunc(awardedMarks)) : 0
        const isCorrect = (typeof s?.isCorrect === 'boolean') ? Boolean(s.isCorrect) : (safeAwarded > 0)
        const isSignificant = (typeof s?.isSignificant === 'boolean') ? Boolean(s.isSignificant) : (!isCorrect)
        const feedback = String(s?.feedback ?? '').trim()
        return { step, awardedMarks: safeAwarded, isCorrect, isSignificant, feedback }
      })
      const earnedMarks = Number.isFinite(Number(gradingJson.earnedMarks))
        ? Math.max(0, Math.trunc(Number(gradingJson.earnedMarks)))
        : steps.reduce((sum: number, s: any) => sum + Math.max(0, Number(s.awardedMarks || 0)), 0)
      const totalMarks = Number.isFinite(Number(gradingJson.totalMarks))
        ? Math.max(1, Math.trunc(Number(gradingJson.totalMarks)))
        : Math.max(1, stepCount || steps.length || 1)
      return { steps, earnedMarks, totalMarks }
    }

    if (Array.isArray(gradingJson)) {
      const steps = gradingJson.map((g: any, idx: number) => {
        const stepNum = Number(g?.step)
        const step = Number.isFinite(stepNum) && stepNum > 0 ? Math.trunc(stepNum) : idx + 1
        const mapped = mapGrade(String(g?.grade || ''))
        const feedback = String(g?.feedback ?? '').trim()
        return { step, feedback, ...mapped }
      })
      const earnedMarks = steps.reduce((sum: number, s: any) => sum + Math.max(0, Number(s.awardedMarks || 0)), 0)
      const totalMarks = Math.max(1, stepCount || steps.length || 1)
      return { steps, earnedMarks, totalMarks }
    }

    return null
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => {
      setMetaVisible(v => !v)
    }
    window.addEventListener('philani:challenge-meta-peek', handler as any)
    return () => {
      window.removeEventListener('philani:challenge-meta-peek', handler as any)
    }
  }, [])

  useEffect(() => {
    if (!id) return
    if (status !== 'authenticated') return

    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const res = await fetch(`/api/challenges/${encodeURIComponent(id)}`, { credentials: 'same-origin' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.message || `Failed to load challenge (${res.status})`)
        if (cancelled) return
        setChallenge(data)
      } catch (err: any) {
        if (!cancelled) {
          setChallenge(null)
          setError(err?.message || 'Failed to load challenge')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [id, status])

  const refreshChallenge = useCallback(async () => {
    if (!id) return
    const res = await fetch(`/api/challenges/${encodeURIComponent(id)}`, { credentials: 'same-origin' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.message || `Failed to load challenge (${res.status})`)
    setChallenge(data)
    
    // Fetch user's responses
    const sessionKey = `challenge:${id}`
    const respRes = await fetch(`/api/sessions/${encodeURIComponent(sessionKey)}/responses`, { credentials: 'same-origin' })
    if (respRes.ok) {
      const respData = await respRes.json().catch(() => ({}))
      setMyResponses(Array.isArray(respData?.responses) ? respData.responses : [])
    }
    
    // Determine view mode based on URL query parameter or attempt status
    const urlViewMode = typeof router.query.view === 'string' ? router.query.view : null
    if (urlViewMode === 'responses') {
      setViewMode('view')
      return
    }
    
    const myAttemptCount = typeof data?.myAttemptCount === 'number' ? data.myAttemptCount : 0
    const maxAttempts = typeof data?.maxAttempts === 'number' ? data.maxAttempts : null
    const attemptsOpen = data?.attemptsOpen !== false
    const canAttempt = attemptsOpen && (maxAttempts === null || myAttemptCount < maxAttempts)
    
    setViewMode(myAttemptCount > 0 && !canAttempt ? 'view' : 'attempt')
  }, [id, router.query.view])

  const closeAttempts = useCallback(async () => {
    if (!id) return
    setSavingState(true)
    setError(null)
    try {
      const res = await fetch(`/api/challenges/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptsOpen: false }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to close attempts (${res.status})`)
      await refreshChallenge()
    } catch (err: any) {
      setError(err?.message || 'Failed to close attempts')
    } finally {
      setSavingState(false)
    }
  }, [id, refreshChallenge])

  const revealSolutions = useCallback(async () => {
    if (!id) return
    setSavingState(true)
    setError(null)
    try {
      const res = await fetch(`/api/challenges/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solutionsVisible: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to reveal solutions (${res.status})`)
      await refreshChallenge()
    } catch (err: any) {
      setError(err?.message || 'Failed to reveal solutions')
    } finally {
      setSavingState(false)
    }
  }, [id, refreshChallenge])

  useEffect(() => {
    if (status !== 'authenticated') return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/profile', { credentials: 'same-origin' })
        if (!res.ok) return
        const data = await res.json().catch(() => ({}))
        const nextId = typeof data?.id === 'string' ? data.id : ''
        if (!cancelled) setViewerId(nextId)
      } catch {
        // ignore
      }
    })()
    return () => {
      cancelled = true
    }
  }, [status])

  useEffect(() => {
    if (!id) return
    if (!viewerId) return
    if (!challenge) return
    const createdById = (challenge as any)?.createdById || (challenge as any)?.createdBy?.id || ''
    const isOwner = createdById && String(createdById) === String(viewerId)
    if (!isOwner) return

    void router.replace(`/dashboard?manageChallenge=${encodeURIComponent(String(id))}`)
  }, [challenge, id, router, viewerId])

  const initialQuiz = useMemo(() => {
    if (!challenge?.id) return null
    const quizId = `challenge:${String(challenge.id)}`
    const quizLabel = (challenge.title || '').trim() ? String(challenge.title) : 'Challenge'
    const prompt = String(challenge.prompt || '').trim() || 'See attached image.'
    return { quizId, quizLabel, prompt }
  }, [challenge])

  if (status === 'loading') return null

  if (status !== 'authenticated') {
    return (
      <div className="p-6 space-y-3">
        <div className="text-lg font-semibold">Sign in required</div>
        <Link href="/api/auth/signin" className="btn btn-primary">Sign in</Link>
      </div>
    )
  }

  const effectiveViewerId = viewerId || session?.user?.email || ''
  
  const canAttempt = useMemo(() => {
    if (!challenge) return true
    const myAttemptCount = typeof challenge?.myAttemptCount === 'number' ? challenge.myAttemptCount : 0
    const maxAttempts = typeof challenge?.maxAttempts === 'number' ? challenge.maxAttempts : null
    const attemptsOpen = challenge?.attemptsOpen !== false
    return attemptsOpen && (maxAttempts === null || myAttemptCount < maxAttempts)
  }, [challenge])

  return (
    <div className="fixed inset-0 bg-slate-950 text-white overflow-hidden">
      {error ? <div className="absolute top-2 left-2 right-2 z-50 text-red-300 text-sm">{error}</div> : null}
      {loading ? <div className="absolute top-2 left-2 right-2 z-50 text-white/70 text-sm">Loading…</div> : null}

      {viewMode === 'view' ? (
        <div className="absolute inset-0 overflow-auto p-6">
          <div className="max-w-4xl mx-auto space-y-4">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold">
                {(challenge?.title || '').trim() || 'Challenge'} - {challenge?.isOwner ? 'Student Responses' : 'Your Responses'}
              </h1>
              <div className="flex items-center gap-2">
                {canAttempt && !challenge?.isOwner ? (
                  <button onClick={() => setViewMode('attempt')} className="btn btn-primary">
                    Attempt Again
                  </button>
                ) : null}
                <button onClick={() => router.push('/dashboard')} className="btn btn-ghost">
                  Back to Dashboard
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm text-white/80">
                <strong>Prompt:</strong> {challenge?.prompt || 'N/A'}
              </div>
              {challenge?.imageUrl ? (
                <div className="mt-3">
                  <img src={challenge.imageUrl} alt="Challenge" className="max-h-[240px] rounded border border-white/10 object-contain" />
                </div>
              ) : null}
            </div>

            {challenge?.isOwner ? (
              // Owner view: show all student responses
              <div className="space-y-3">
                <h2 className="text-lg font-semibold">
                  All Student Responses ({Array.isArray(challenge?.attempts) ? challenge.attempts.length : 0})
                </h2>
                {!challenge?.solutionsVisible ? (
                  <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-200">
                    🔒 Responses are private to you and each learner until you reveal solutions.
                  </div>
                ) : (
                  <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-200">
                    ✅ Solutions revealed — responses are now visible to all viewers.
                  </div>
                )}
                {Array.isArray(challenge?.attempts) && challenge.attempts.length > 0 ? (
                  challenge.attempts.map((resp: any, idx: number) => {
                    const [showGradePopup, setShowGradePopup] = useState(false);
                    const [grading, setGrading] = useState<{ [step: number]: string }>({});
                    const [feedback, setFeedback] = useState('');
                    const [stepFeedback, setStepFeedback] = useState<{ [step: number]: string }>({});
                    const [saving, setSaving] = useState(false);
                    const steps = splitLatexIntoSteps(resp?.latex || '')
                    const stepCount = Math.max(1, steps.length || 0)
                    const stepIndices = Array.from({ length: stepCount }, (_, i) => i)

                    // Calculate mark (simple: tick/dot-green = 1, cross/dot-red = 0)
                    const calcMark = () => {
                      const values = Object.values(grading);
                      if (!values.length) return null;
                      const score = values.filter(v => v === 'tick' || v === 'dot-green').length;
                      return `${score} / ${values.length}`;
                    };

                    const handleSaveGrading = async () => {
                      setSaving(true);
                      try {
                        const gradingSteps = stepIndices.map(idx => {
                          const grade = grading[idx] || null
                          const awardedMarks = grade === 'tick' ? 1 : 0
                          const isCorrect = grade === 'tick' || grade === 'dot-green'
                          const isSignificant = grade === 'cross'
                            ? true
                            : grade === 'dot-red'
                              ? false
                              : !isCorrect
                          const fb = String(stepFeedback[idx] || '').trim()
                          return {
                            step: idx + 1,
                            awardedMarks,
                            isCorrect,
                            isSignificant,
                            feedback: fb || undefined,
                          }
                        })
                        const earnedMarks = gradingSteps.reduce((sum, s) => sum + Math.max(0, Number(s.awardedMarks || 0)), 0)
                        const totalMarks = Math.max(1, stepCount)
                        const gradingJson = { totalMarks, earnedMarks, steps: gradingSteps }
                        await fetch(`/api/sessions/challenge:${id}/responses`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          credentials: 'same-origin',
                          body: JSON.stringify({
                            responseId: resp.id,
                            gradingJson,
                            feedback,
                          }),
                        });
                        setShowGradePopup(false);
                        setSaving(false);
                        await refreshChallenge();
                      } catch (e) {
                        setSaving(false);
                        alert('Failed to save grading');
                      }
                    };

                    return (
                      <div key={resp.id || idx} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-white">{resp.name}</div>
                          <div className="text-xs text-white/60">
                            {resp.createdAt ? new Date(resp.createdAt).toLocaleString() : 'Unknown'}
                          </div>
                        </div>
                        <div className="text-sm">
                          <strong>Response:</strong>
                          {(() => {
                            const latex = String(resp.latex || '')
                            const steps = splitLatexIntoSteps(latex)
                            const grade = normalizeChallengeGrade(resp.gradingJson, steps.length)
                            const stepGradeByIndex = new Map<number, any>()
                            if (grade?.steps) {
                              grade.steps.forEach((s: any) => {
                                const stepNum = Number(s?.step)
                                if (Number.isFinite(stepNum) && stepNum > 0) stepGradeByIndex.set(Math.trunc(stepNum) - 1, s)
                              })
                            }
                            const html = latex.trim() ? renderKatexDisplayHtml(latex) : ''
                            if (!latex.trim()) {
                              return (
                                <div className="mt-2 p-3 rounded bg-black/20 text-white/90 whitespace-pre-wrap break-words">
                                  (empty)
                                </div>
                              )
                            }
                            if (steps.length) {
                              return (
                                <div className="mt-2 p-3 rounded bg-black/20 text-white/90 overflow-auto max-h-[300px] space-y-2">
                                  {steps.map((stepLatex: string, stepIdx: number) => {
                                    const g = stepGradeByIndex.get(stepIdx)
                                    const awardedMarks = Number(g?.awardedMarks ?? 0)
                                    const awardedInt = Number.isFinite(awardedMarks) ? Math.max(0, Math.trunc(awardedMarks)) : 0
                                    const isCorrect = (typeof g?.isCorrect === 'boolean') ? Boolean(g.isCorrect) : (awardedInt > 0)
                                    const isSignificant = (typeof g?.isSignificant === 'boolean') ? Boolean(g.isSignificant) : (!isCorrect)
                                    const feedbackText = String(g?.feedback ?? '').trim()
                                    const stepHtml = renderKatexDisplayHtml(stepLatex)
                                    const line = stepHtml
                                      ? <div className={isCorrect ? 'leading-relaxed' : 'leading-relaxed underline decoration-red-500'} dangerouslySetInnerHTML={{ __html: stepHtml }} />
                                      : <div className={isCorrect ? 'text-xs font-mono whitespace-pre-wrap break-words' : 'text-xs font-mono whitespace-pre-wrap break-words underline decoration-red-500'}>{stepLatex}</div>

                                    return (
                                      <div key={`challenge-owner-step-${resp.id || idx}-${stepIdx}`} className="flex items-start gap-3">
                                        <div className="min-w-0 flex-1">{line}</div>
                                        {g ? (
                                          <div className="shrink-0 flex items-start gap-2">
                                            {awardedInt > 0 ? (
                                              <span className="text-green-500 flex items-center" aria-label={`${awardedInt} mark${awardedInt === 1 ? '' : 's'} earned`} title={`${awardedInt} mark${awardedInt === 1 ? '' : 's'}`}>
                                                {Array.from({ length: Math.min(awardedInt, 12) }).map((_, j) => (
                                                  <svg key={`tick-${resp.id || idx}-${stepIdx}-${j}`} viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
                                                    <path
                                                      d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.12 7.18a1 1 0 0 1-1.42.006L3.29 9.01a1 1 0 1 1 1.414-1.414l3.17 3.17 6.412-6.47a1 1 0 0 1 1.418-.006z"
                                                      fill="currentColor"
                                                    />
                                                  </svg>
                                                ))}
                                                {awardedInt > 12 ? (
                                                  <span className="text-xs text-white/70 ml-1">+{awardedInt - 12}</span>
                                                ) : null}
                                              </span>
                                            ) : isCorrect ? (
                                              <span className="text-green-500" aria-label="Correct but 0 marks" title="Correct but 0 marks">
                                                <svg viewBox="0 0 10 10" className="w-2 h-2" aria-hidden="true">
                                                  <circle cx="5" cy="5" r="4" fill="currentColor" />
                                                </svg>
                                              </span>
                                            ) : (
                                              isSignificant ? (
                                                <span className="text-red-500" aria-label="Incorrect significant step" title="Incorrect (significant)">
                                                  <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
                                                    <path
                                                      d="M6.293 6.293a1 1 0 0 1 1.414 0L10 8.586l2.293-2.293a1 1 0 1 1 1.414 1.414L11.414 10l2.293 2.293a1 1 0 0 1-1.414 1.414L10 11.414l-2.293 2.293a1 1 0 0 1-1.414-1.414L8.586 10 6.293 7.707a1 1 0 0 1 0-1.414z"
                                                      fill="currentColor"
                                                    />
                                                  </svg>
                                                </span>
                                              ) : (
                                                <span className="text-red-500" aria-label="Incorrect insignificant step" title="Incorrect (insignificant)">
                                                  <svg viewBox="0 0 10 10" className="w-2 h-2" aria-hidden="true">
                                                    <circle cx="5" cy="5" r="4" fill="currentColor" />
                                                  </svg>
                                                </span>
                                              )
                                            )}

                                            {feedbackText ? (
                                              <div className="text-xs text-white/70 max-w-[18rem] whitespace-pre-wrap break-words">
                                                {feedbackText.slice(0, 160)}
                                              </div>
                                            ) : null}
                                          </div>
                                        ) : null}
                                      </div>
                                    )
                                  })}
                                </div>
                              )
                            }

                            return html ? (
                              <div className="mt-2 p-3 rounded bg-black/20 text-white/90 overflow-auto max-h-[300px]">
                                <div className="leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
                              </div>
                            ) : (
                              <div className="mt-2 p-3 rounded bg-black/20 text-white/90 whitespace-pre-wrap break-words overflow-auto max-h-[300px]">
                                {renderTextWithKatex(latex)}
                              </div>
                            )
                          })()}
                        </div>
                        {resp.studentText ? (
                          <div className="text-sm">
                            <strong>Typed text:</strong>
                            <div className="mt-1 text-white/80">{resp.studentText}</div>
                          </div>
                        ) : null}
                        <div className="mt-2">
                          <button className="btn btn-secondary btn-xs" onClick={() => setShowGradePopup(true)}>
                            Grade
                          </button>
                        </div>
                        {/* Display mark and feedback if graded */}
                        {(() => {
                          const steps = splitLatexIntoSteps(resp.latex)
                          const grade = normalizeChallengeGrade(resp.gradingJson, steps.length)
                          if (!grade) return null
                          return (
                            <div className="mt-2 text-green-300 text-xs">Mark: {grade.earnedMarks} / {grade.totalMarks}</div>
                          )
                        })()}
                        {resp.feedback && (
                          <div className="mt-1 text-blue-200 text-xs">Feedback: {resp.feedback}</div>
                        )}
                        {showGradePopup && (
                          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
                            <div className="bg-white text-black rounded-lg p-6 min-w-[300px] max-w-[90vw]">
                              <div className="font-semibold mb-2">Grade Response</div>
                              {stepIndices.map((stepIdx) => {
                                const stepLatex = steps[stepIdx] || ''
                                const stepHtml = stepLatex ? renderKatexDisplayHtml(stepLatex) : ''
                                return (
                                  <div key={stepIdx} className="mb-3">
                                    <div className="mb-1 text-sm font-medium">Step {stepIdx + 1}</div>
                                    {stepLatex ? (
                                      stepHtml ? (
                                        <div className="mb-2 p-2 rounded border border-black/10" dangerouslySetInnerHTML={{ __html: stepHtml }} />
                                      ) : (
                                        <div className="mb-2 p-2 rounded border border-black/10 text-xs font-mono whitespace-pre-wrap break-words">{stepLatex}</div>
                                      )
                                    ) : null}
                                    <div className="flex flex-wrap gap-4">
                                      <label>
                                        <input type="radio" name={`grade-step-${stepIdx}`} value="tick" checked={grading[stepIdx] === 'tick'} onChange={() => setGrading(g => ({ ...g, [stepIdx]: 'tick' }))} />
                                        <span role="img" aria-label="Green Tick" className="ml-1">✅</span>
                                      </label>
                                      <label>
                                        <input type="radio" name={`grade-step-${stepIdx}`} value="dot-green" checked={grading[stepIdx] === 'dot-green'} onChange={() => setGrading(g => ({ ...g, [stepIdx]: 'dot-green' }))} />
                                        <span role="img" aria-label="Green Dot" className="ml-1">🟢</span>
                                      </label>
                                      <label>
                                        <input type="radio" name={`grade-step-${stepIdx}`} value="cross" checked={grading[stepIdx] === 'cross'} onChange={() => setGrading(g => ({ ...g, [stepIdx]: 'cross' }))} />
                                        <span role="img" aria-label="Red X" className="ml-1">❌</span>
                                      </label>
                                      <label>
                                        <input type="radio" name={`grade-step-${stepIdx}`} value="dot-red" checked={grading[stepIdx] === 'dot-red'} onChange={() => setGrading(g => ({ ...g, [stepIdx]: 'dot-red' }))} />
                                        <span role="img" aria-label="Red Dot" className="ml-1">🔴</span>
                                      </label>
                                    </div>
                                    <div className="mt-2">
                                      <label className="block text-xs font-medium mb-1">Step feedback (optional):</label>
                                      <textarea className="w-full border rounded p-1 text-xs" rows={2} value={stepFeedback[stepIdx] || ''} onChange={e => setStepFeedback(f => ({ ...f, [stepIdx]: e.target.value }))} />
                                    </div>
                                  </div>
                                )
                              })}
                              <div className="mb-2">
                                <label className="block text-xs font-medium mb-1">Feedback (optional):</label>
                                <textarea className="w-full border rounded p-1 text-xs" rows={2} value={feedback} onChange={e => setFeedback(e.target.value)} />
                              </div>
                              <div className="flex gap-2 mt-4">
                                <button className="btn btn-primary btn-xs" onClick={handleSaveGrading} disabled={saving}>
                                  {saving ? 'Saving...' : 'Save'}
                                </button>
                                <button className="btn btn-ghost btn-xs" onClick={() => setShowGradePopup(false)}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="text-sm text-white/70">No responses yet.</div>
                )}
              </div>
            ) : myResponses.length > 0 ? (
              // Student view: show their own responses
              <div className="space-y-3">
                <h2 className="text-lg font-semibold">Your Submissions ({myResponses.length})</h2>
                {myResponses.map((resp: any, idx: number) => (
                  <div key={resp.id || idx} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
                    <div className="text-xs text-white/60">
                      Submitted: {resp.createdAt ? new Date(resp.createdAt).toLocaleString() : 'Unknown'}
                    </div>
                    <div className="text-sm">
                      <strong>Response:</strong>
                      {(() => {
                        const latex = String(resp.latex || '')
                        const steps = splitLatexIntoSteps(latex)
                        const grade = normalizeChallengeGrade(resp.gradingJson, steps.length)
                        const stepGradeByIndex = new Map<number, any>()
                        if (grade?.steps) {
                          grade.steps.forEach((s: any) => {
                            const stepNum = Number(s?.step)
                            if (Number.isFinite(stepNum) && stepNum > 0) stepGradeByIndex.set(Math.trunc(stepNum) - 1, s)
                          })
                        }
                        const html = latex.trim() ? renderKatexDisplayHtml(latex) : ''
                        if (!latex.trim()) {
                          return (
                            <div className="mt-2 p-3 rounded bg-black/20 text-white/90 whitespace-pre-wrap break-words">
                              (empty)
                            </div>
                          )
                        }
                        if (steps.length) {
                          return (
                            <div className="mt-2 p-3 rounded bg-black/20 text-white/90 overflow-auto max-h-[300px] space-y-2">
                              {steps.map((stepLatex: string, stepIdx: number) => {
                                const g = stepGradeByIndex.get(stepIdx)
                                const awardedMarks = Number(g?.awardedMarks ?? 0)
                                const awardedInt = Number.isFinite(awardedMarks) ? Math.max(0, Math.trunc(awardedMarks)) : 0
                                const isCorrect = (typeof g?.isCorrect === 'boolean') ? Boolean(g.isCorrect) : (awardedInt > 0)
                                const isSignificant = (typeof g?.isSignificant === 'boolean') ? Boolean(g.isSignificant) : (!isCorrect)
                                const feedbackText = String(g?.feedback ?? '').trim()
                                const stepHtml = renderKatexDisplayHtml(stepLatex)
                                const line = stepHtml
                                  ? <div className={isCorrect ? 'leading-relaxed' : 'leading-relaxed underline decoration-red-500'} dangerouslySetInnerHTML={{ __html: stepHtml }} />
                                  : <div className={isCorrect ? 'text-xs font-mono whitespace-pre-wrap break-words' : 'text-xs font-mono whitespace-pre-wrap break-words underline decoration-red-500'}>{stepLatex}</div>

                                return (
                                  <div key={`challenge-student-step-${resp.id || idx}-${stepIdx}`} className="flex items-start gap-3">
                                    <div className="min-w-0 flex-1">{line}</div>
                                    {g ? (
                                      <div className="shrink-0 flex items-start gap-2">
                                        {awardedInt > 0 ? (
                                          <span className="text-green-500 flex items-center" aria-label={`${awardedInt} mark${awardedInt === 1 ? '' : 's'} earned`} title={`${awardedInt} mark${awardedInt === 1 ? '' : 's'}`}>
                                            {Array.from({ length: Math.min(awardedInt, 12) }).map((_, j) => (
                                              <svg key={`tick-${resp.id || idx}-${stepIdx}-${j}`} viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
                                                <path
                                                  d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.12 7.18a1 1 0 0 1-1.42.006L3.29 9.01a1 1 0 1 1 1.414-1.414l3.17 3.17 6.412-6.47a1 1 0 0 1 1.418-.006z"
                                                  fill="currentColor"
                                                />
                                              </svg>
                                            ))}
                                            {awardedInt > 12 ? (
                                              <span className="text-xs text-white/70 ml-1">+{awardedInt - 12}</span>
                                            ) : null}
                                          </span>
                                        ) : isCorrect ? (
                                          <span className="text-green-500" aria-label="Correct but 0 marks" title="Correct but 0 marks">
                                            <svg viewBox="0 0 10 10" className="w-2 h-2" aria-hidden="true">
                                              <circle cx="5" cy="5" r="4" fill="currentColor" />
                                            </svg>
                                          </span>
                                        ) : (
                                          isSignificant ? (
                                            <span className="text-red-500" aria-label="Incorrect significant step" title="Incorrect (significant)">
                                              <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
                                                <path
                                                  d="M6.293 6.293a1 1 0 0 1 1.414 0L10 8.586l2.293-2.293a1 1 0 1 1 1.414 1.414L11.414 10l2.293 2.293a1 1 0 0 1-1.414 1.414L10 11.414l-2.293 2.293a1 1 0 0 1-1.414-1.414L8.586 10 6.293 7.707a1 1 0 0 1 0-1.414z"
                                                  fill="currentColor"
                                                />
                                              </svg>
                                            </span>
                                          ) : (
                                            <span className="text-red-500" aria-label="Incorrect insignificant step" title="Incorrect (insignificant)">
                                              <svg viewBox="0 0 10 10" className="w-2 h-2" aria-hidden="true">
                                                <circle cx="5" cy="5" r="4" fill="currentColor" />
                                              </svg>
                                            </span>
                                          )
                                        )}

                                        {feedbackText ? (
                                          <div className="text-xs text-white/70 max-w-[18rem] whitespace-pre-wrap break-words">
                                            {feedbackText.slice(0, 160)}
                                          </div>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </div>
                                )
                              })}
                            </div>
                          )
                        }

                        return html ? (
                          <div className="mt-2 p-3 rounded bg-black/20 text-white/90 overflow-auto max-h-[300px]">
                            <div className="leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
                          </div>
                        ) : (
                          <div className="mt-2 p-3 rounded bg-black/20 text-white/90 whitespace-pre-wrap break-words overflow-auto max-h-[300px]">
                            {renderTextWithKatex(latex)}
                          </div>
                        )
                      })()}
                    </div>
                    {resp.studentText ? (
                      <div className="text-sm">
                        <strong>Typed text:</strong>
                        <div className="mt-1 text-white/80">{resp.studentText}</div>
                      </div>
                    ) : null}
                    {(() => {
                      const steps = splitLatexIntoSteps(resp.latex)
                      const grade = normalizeChallengeGrade(resp.gradingJson, steps.length)
                      if (!grade) return null
                      return (
                        <div className="mt-2 text-green-300 text-xs">Mark: {grade.earnedMarks} / {grade.totalMarks}</div>
                      )
                    })()}
                    {resp.feedback && (
                      <div className="mt-1 text-blue-200 text-xs">Feedback: {resp.feedback}</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-white/70">No responses found.</div>
            )}
          </div>
        </div>
      ) : (
        <>
          {initialQuiz ? (
            <div
              className="absolute inset-0"
              onClick={e => {
                // Only show badge if not already visible and tap is not on the info button
                if (!metaVisible && e.target === e.currentTarget) setMetaVisible(true)
              }}
            >
              {(() => {
                const realtimeScopeId = `challenge:${id}:u:${effectiveViewerId || 'anon'}`
                const boardId = `challenge:${id}`
                const canAdmin = Boolean(challenge?.isOwner)
                return (
                  <StackedCanvasWindow
                    gradeLabel={challenge?.grade ? String(challenge.grade).replace('GRADE_', 'Grade ') : null}
                    roomId={`challenge-${id}-u-${effectiveViewerId || 'anon'}`}
                    boardId={boardId}
                    realtimeScopeId={realtimeScopeId}
                    userId={effectiveViewerId || 'anon'}
                    userDisplayName={userDisplayName}
                    isAdmin={canAdmin}
                    forceEditable
                    quizMode
                    initialQuiz={initialQuiz}
                    isVisible
                    defaultOrientation="portrait"
                  />
                )
              })()}
            </div>
          ) : null}

          {/* Info badge logic adapted from assignments */}
          {challenge && metaVisible ? (
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
                    <span className="font-semibold text-white">{(challenge.title || '').trim() ? challenge.title : 'Challenge'}</span>
                    {challenge.createdBy?.name ? <span className="text-white/70">• {challenge.createdBy.name}</span> : null}
                  </div>
                  {challenge.prompt ? <div className="mt-2 text-sm text-white">{renderTextWithKatex(challenge.prompt)}</div> : null}
                  {challenge.imageUrl ? (
                    <div className="mt-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={challenge.imageUrl} alt="Challenge" className="max-h-[240px] rounded border border-white/10 object-contain" />
                    </div>
                  ) : null}
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
          {/* Show info button if badge is hidden */}
          {challenge && !metaVisible ? (
            <button
              type="button"
              className="absolute top-3 left-3 z-50 btn btn-ghost btn-xs"
              style={{ minWidth: 0, padding: '2px 8px', fontSize: 12 }}
              aria-label="Show info"
              onClick={() => setMetaVisible(true)}
            >
              <span className="material-icons" style={{ fontSize: 16, verticalAlign: 'middle' }}>info</span>
            </button>
          ) : null}
        </>
      )}
    </div>
  )
}
