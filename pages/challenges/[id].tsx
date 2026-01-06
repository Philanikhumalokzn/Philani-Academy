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
  closedAt?: string | null
  revealedAt?: string | null
  takers?: Array<{ userId: string; name: string; avatar: string | null; lastSubmittedAt: string; submissions: number }>
  attempts?: Array<{ id: string; userId: string; name: string; avatar: string | null; createdAt: string; latex: string; studentText?: string | null }>
  createdBy?: { id?: string; name?: string; avatar?: string | null } | null
}

export default function ChallengeAttemptPage() {
  const router = useRouter()
  const { data: session, status } = useSession()

  const id = typeof router.query.id === 'string' ? router.query.id : ''

  const [viewerId, setViewerId] = useState<string>('')
  const userDisplayName = session?.user?.name || session?.user?.email || ''

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [savingState, setSavingState] = useState(false)

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
  }, [id])

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

  return (
    <div className="fixed inset-0 bg-slate-950 text-white overflow-hidden">
      {error ? <div className="absolute top-2 left-2 right-2 z-50 text-red-300 text-sm">{error}</div> : null}
      {loading ? <div className="absolute top-2 left-2 right-2 z-50 text-white/70 text-sm">Loading…</div> : null}

      {initialQuiz ? (
        <div className="absolute inset-0">
          {(() => {
            const realtimeScopeId = `challenge:${id}:u:${effectiveViewerId || 'anon'}`
            const boardId = `challenge:${id}`
            const canAdmin = Boolean(challenge?.isOwner || challenge?.isPrivileged)
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

      {challenge ? (
        <div className="absolute top-3 left-3 right-3 z-50">
          <div className="rounded backdrop-blur-md px-4 py-3" style={{ background: 'var(--card)', border: '1px solid var(--card-border)' }}>
            <div className="flex items-start justify-between gap-3">
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

                {challenge.isOwner ? (
                  <div className="mt-3 rounded px-3 py-2" style={{ background: 'var(--card)', border: '1px solid var(--card-border)' }}>
                    <div className="text-xs text-white/80 flex items-center gap-3 flex-wrap">
                      <span>Attempts: <span className="font-semibold text-white">{challenge.attemptsOpen === false ? 'Closed' : 'Open'}</span></span>
                      <span>Solutions: <span className="font-semibold text-white">{challenge.solutionsVisible ? 'Revealed' : 'Hidden'}</span></span>
                      {savingState ? <span className="text-white/60">Saving…</span> : null}
                    </div>

                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      {challenge.attemptsOpen !== false ? (
                        <button className="btn btn-primary" onClick={closeAttempts} disabled={savingState}>
                          Close attempts
                        </button>
                      ) : null}
                      {challenge.attemptsOpen === false && !challenge.solutionsVisible ? (
                        <button className="btn btn-primary" onClick={revealSolutions} disabled={savingState}>
                          Reveal solutions
                        </button>
                      ) : null}
                    </div>

                    <div className="mt-3">
                      <div className="text-xs text-white/70">Takers</div>
                      {Array.isArray(challenge.takers) && challenge.takers.length > 0 ? (
                        <div className="mt-1 space-y-1">
                          {challenge.takers.map(t => (
                            <div key={t.userId} className="text-xs text-white/80 flex items-center justify-between gap-3">
                              <span className="truncate">{t.name}</span>
                              <span className="shrink-0 text-white/60">{new Date(t.lastSubmittedAt).toLocaleString()} • {t.submissions}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-white/60">No attempts yet.</div>
                      )}
                    </div>

                    {challenge.solutionsVisible && Array.isArray(challenge.attempts) ? (
                      <div className="mt-3">
                        <div className="text-xs text-white/70">Attempts (newest first)</div>
                        {challenge.attempts.length > 0 ? (
                          <div className="mt-2 space-y-2 max-h-[200px] overflow-auto pr-1">
                            {challenge.attempts.map(a => (
                              <div key={a.id} className="rounded px-2 py-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                <div className="text-xs text-white/80 flex items-center justify-between gap-3">
                                  <span className="truncate">{a.name}</span>
                                  <span className="shrink-0 text-white/60">{new Date(a.createdAt).toLocaleString()}</span>
                                </div>
                                <pre className="mt-2 text-xs text-white/90 whitespace-pre-wrap break-words">{a.latex}</pre>
                                {a.studentText ? <div className="mt-2 text-xs text-white/80">Typed: {a.studentText}</div> : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-1 text-xs text-white/60">No attempt records.</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <Link href={`/u/${encodeURIComponent(String(challenge.createdBy?.id || ''))}`} className="btn btn-ghost shrink-0">
                Back
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
