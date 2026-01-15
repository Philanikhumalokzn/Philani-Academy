import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useSession } from 'next-auth/react'
import { useMemo } from 'react'
import BrandLogo from '../components/BrandLogo'

const DiagramOverlayModule = dynamic(() => import('../components/DiagramOverlayModule'), { ssr: false })

export default function DiagramPage() {
  const router = useRouter()
  const { data: session, status } = useSession()

  const returnTo = useMemo(() => {
    if (!router.isReady) return '/dashboard?section=sessions'
    const value = router.query.returnTo
    if (typeof value === 'string' && value.trim()) return value
    return '/dashboard?section=sessions'
  }, [router.isReady, router.query.returnTo])

  const boardId = useMemo(() => {
    if (!router.isReady) return null
    const value = router.query.boardId
    if (typeof value === 'string' && value.trim()) return value
    return null
  }, [router.isReady, router.query.boardId])

  const lessonAuthoringPhase = useMemo(() => {
    if (!router.isReady) return null
    const value = router.query.phase
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }, [router.isReady, router.query.phase])

  const lessonAuthoringPointId = useMemo(() => {
    if (!router.isReady) return null
    const value = router.query.pointId
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }, [router.isReady, router.query.pointId])

  const promptUpload = useMemo(() => {
    if (!router.isReady) return false
    return router.query.promptUpload === '1'
  }, [router.isReady, router.query.promptUpload])

  const userId = useMemo(() => {
    const candidate = (session as any)?.user?.id as string | undefined
    if (candidate && typeof candidate === 'string') return candidate
    if (session?.user?.email) return session.user.email
    if (session?.user?.name) return session.user.name
    return 'guest'
  }, [session])

  const userDisplayName = session?.user?.name || session?.user?.email || 'Participant'
  const role = (session as any)?.user?.role as string | undefined
  const isAdmin = Boolean(role === 'admin' || role === 'teacher')

  // This page is intentionally diagram-only; boardId scopes realtime + diagram session state.
  const effectiveBoardId = boardId || `diagram-${userId}`

  return (
    <div className="board-fullscreen">
      <div className="board-fullscreen__topbar">
        <Link href={returnTo} className="board-fullscreen__back" aria-label="Back">
          ✕
        </Link>
        <div className="board-fullscreen__brand">
          <BrandLogo height={34} className="opacity-90" />
        </div>
        <div className="board-fullscreen__controls" />
      </div>

      <div className="board-fullscreen__stage relative">
        {status !== 'authenticated' ? (
          <div className="text-sm muted">Sign in to use the diagram tool.</div>
        ) : !router.isReady ? null : (
          <DiagramOverlayModule
            boardId={effectiveBoardId}
            gradeLabel={null}
            userId={userId}
            userDisplayName={userDisplayName}
            isAdmin={isAdmin}
            lessonAuthoring={lessonAuthoringPhase && lessonAuthoringPointId
              ? { phaseKey: lessonAuthoringPhase, pointId: lessonAuthoringPointId }
              : undefined}
            autoOpen
            autoPromptUpload={promptUpload}
          />
        )}
      </div>
    </div>
  )
}
