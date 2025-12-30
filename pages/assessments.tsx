import { useMemo } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import BrandLogo from '../components/BrandLogo'

const MyScriptMathCanvas = dynamic(() => import('../components/MyScriptMathCanvas'), { ssr: false })

const sanitizeIdentifier = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60)

export default function AssessmentsPage() {
  const { data: session, status } = useSession()

  const realtimeUserId = useMemo(() => {
    const candidate = (session as any)?.user?.id as string | undefined
    if (candidate && typeof candidate === 'string') return candidate
    if (session?.user?.email) return session.user.email
    if (session?.user?.name) return session.user.name
    return 'guest'
  }, [session])

  const realtimeDisplayName = session?.user?.name || session?.user?.email || 'Learner'

  const roomId = useMemo(() => {
    // Default: private room per signed-in user.
    const base = status === 'authenticated' ? sanitizeIdentifier(realtimeUserId) : 'guest'
    return `myscript-assessments-${base.toLowerCase()}`
  }, [realtimeUserId, status])

  return (
    <div className="board-fullscreen">
      <div className="board-fullscreen__topbar">
        <Link href="/dashboard" className="board-fullscreen__back" aria-label="Back to dashboard">
          ←
        </Link>
        <div className="board-fullscreen__brand">
          <BrandLogo height={32} className="opacity-90" />
        </div>
        <div className="board-fullscreen__controls">
          <div className="text-sm font-semibold">Assessments</div>
        </div>
      </div>

      <div className="board-fullscreen__main" style={{ height: '100%' }}>
        {status !== 'authenticated' ? (
          <div className="p-4">
            <div className="card space-y-2">
              <div className="text-lg font-semibold">Sign in required</div>
              <div className="text-sm muted">Sign in to use the assessments canvas.</div>
              <div>
                <Link href="/api/auth/signin" className="btn btn-primary">
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full">
            <MyScriptMathCanvas
              gradeLabel="Assessments"
              roomId={roomId}
              userId={realtimeUserId}
              userDisplayName={realtimeDisplayName}
              isAdmin={false}
            />
          </div>
        )}
      </div>
    </div>
  )
}
