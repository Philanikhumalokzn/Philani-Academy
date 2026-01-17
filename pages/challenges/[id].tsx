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
                    ⚠️ Responses are only visible after you reveal solutions. Close attempts first, then reveal solutions.
                  </div>
                ) : Array.isArray(challenge?.attempts) && challenge.attempts.length > 0 ? (
                  challenge.attempts.map((resp: any, idx: number) => (
                    <div key={resp.id || idx} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-white">{resp.name}</div>
                        <div className="text-xs text-white/60">
                          {resp.createdAt ? new Date(resp.createdAt).toLocaleString() : 'Unknown'}
                        </div>
                      </div>
                      <div className="text-sm">
                        <strong>Response:</strong>
                        <pre className="mt-2 p-3 rounded bg-black/20 text-white/90 whitespace-pre-wrap break-words overflow-auto max-h-[300px]">
                          {resp.latex || '(empty)'}
                        </pre>
                      </div>
                      {resp.studentText ? (
                        <div className="text-sm">
                          <strong>Typed text:</strong>
                          <div className="mt-1 text-white/80">{resp.studentText}</div>
                        </div>
                      ) : null}
                    </div>
                  ))
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
                      <pre className="mt-2 p-3 rounded bg-black/20 text-white/90 whitespace-pre-wrap break-words overflow-auto max-h-[300px]">
                        {resp.latex || '(empty)'}
                      </pre>
                    </div>
                    {resp.studentText ? (
                      <div className="text-sm">
                        <strong>Typed text:</strong>
                        <div className="mt-1 text-white/80">{resp.studentText}</div>
                      </div>
                    ) : null}
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
                  className="btn btn-ghost shrink-0"
                  tabIndex={-1}
                  onClick={e => {
                    e.stopPropagation()
                    setMetaVisible(false)
                  }}
                >
                  Back
                </button>
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
