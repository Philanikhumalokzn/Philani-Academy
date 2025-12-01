import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import NavArrows from '../components/NavArrows'
import { gradeToLabel, GRADE_VALUES, GradeValue, normalizeGradeInput } from '../lib/grades'

const MyScriptMathCanvas = dynamic(() => import('../components/MyScriptMathCanvas'), { ssr: false })

export default function BoardPage() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const [selectedGrade, setSelectedGrade] = useState<GradeValue | null>(null)
  const [gradeReady, setGradeReady] = useState(false)

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

  const handleGradeChange = (value: string) => {
    const next = normalizeGradeInput(value)
    setSelectedGrade(next)
    if (router.isReady) {
      const query = next ? { ...router.query, grade: next } : { ...router.query }
      if (!next) delete query.grade
      router.replace({ pathname: router.pathname, query }, undefined, { shallow: true })
    }
  }

  const showCanvas = status === 'authenticated' && Boolean(selectedGrade)

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div className="flex flex-col gap-4">
          <NavArrows backHref="/dashboard" forwardHref={undefined} />
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Shared board</p>
              <h1 className="text-2xl font-bold text-slate-900">Mathematics Canvas</h1>
              <p className="text-sm text-slate-600">Full-screen collaborative board for instructors and students.</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/dashboard" className="btn btn-ghost">Return to Dashboard</Link>
            </div>
          </div>
          <div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div>
                <h2 className="text-lg font-semibold">Active grade</h2>
                <p className="text-sm text-slate-500">{activeGradeLabel}</p>
              </div>
              <select
                className="input w-full sm:w-auto"
                value={selectedGrade ?? ''}
                onChange={e => handleGradeChange(e.target.value)}
              >
                <option value="">Select a grade</option>
                {gradeOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="card">
          {status !== 'authenticated' ? (
            <div className="text-sm muted">Sign in to launch the collaborative canvas.</div>
          ) : !selectedGrade ? (
            <div className="text-sm muted">Choose a grade to open the shared board.</div>
          ) : (
            <MyScriptMathCanvas
              gradeLabel={activeGradeLabel}
              roomId={boardRoomId}
              userId={realtimeUserId}
              userDisplayName={realtimeDisplayName}
              isAdmin={isOwnerUser}
            />
          )}
        </div>
      </div>
    </div>
  )
}
