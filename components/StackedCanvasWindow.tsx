import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import MyScriptMathCanvas from './MyScriptMathCanvas'
import BrandLogo from './BrandLogo'

const DiagramOverlayModule = dynamic(() => import('./DiagramOverlayModule'), { ssr: false })
const TextOverlayModule = dynamic(() => import('./TextOverlayModule'), { ssr: false })

type CanvasOrientation = 'portrait' | 'landscape'

type InitialQuizConfig = {
  quizId: string
  quizLabel?: string
  quizPhaseKey?: string
  quizPointId?: string
  quizPointIndex?: number
  prompt: string
  durationSec?: number | null
  endsAt?: number | null
}

type Props = {
  gradeLabel?: string | null
  roomId: string
  boardId?: string
  userId: string
  userDisplayName?: string
  isAdmin?: boolean
  quizMode?: boolean
  initialQuiz?: InitialQuizConfig
  isVisible: boolean
  defaultOrientation?: CanvasOrientation
  onOverlayChromeVisibilityChange?: (visible: boolean) => void
  autoOpenDiagramTray?: boolean
  lessonAuthoring?: { phaseKey: string; pointId: string }
  autoHideHeader?: boolean
  backHref?: string
}

type OverlayControlsHandle = {
  open: () => void
  close: () => void
  toggle: () => void
}

export default function StackedCanvasWindow({ gradeLabel, roomId, boardId, userId, userDisplayName, isAdmin, quizMode, initialQuiz, isVisible, defaultOrientation = 'portrait', onOverlayChromeVisibilityChange, autoOpenDiagramTray, lessonAuthoring, autoHideHeader, backHref }: Props) {
  const controlsHandleRef = useRef<OverlayControlsHandle | null>(null)
  const [headerVisible, setHeaderVisible] = useState(true)
  const headerHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearHeaderHide = () => {
    if (headerHideTimeoutRef.current) {
      clearTimeout(headerHideTimeoutRef.current)
      headerHideTimeoutRef.current = null
    }
  }

  const showHeaderForMoment = () => {
    if (!autoHideHeader) return
    setHeaderVisible(true)
    clearHeaderHide()
    headerHideTimeoutRef.current = setTimeout(() => {
      setHeaderVisible(false)
      headerHideTimeoutRef.current = null
    }, 1500)
  }

  useEffect(() => {
    if (!isVisible || typeof window === 'undefined') return
    const resizeHandle = setTimeout(() => {
      window.dispatchEvent(new Event('resize'))
    }, 120)
    return () => clearTimeout(resizeHandle)
  }, [isVisible])

  useEffect(() => {
    if (!autoHideHeader) {
      setHeaderVisible(true)
      return
    }
    showHeaderForMoment()
    return () => {
      clearHeaderHide()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoHideHeader, isVisible])

  useEffect(() => {
    if (!autoHideHeader) return
    if (!isVisible) return
    if (typeof window === 'undefined') return

    const onAnyPointer = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      // Ignore taps inside the header itself.
      if (target.closest('[data-stacked-canvas-header]')) return
      // "Empty" means: not an interactive element.
      if (target.closest('a,button,input,textarea,select,[role="button"]')) return
      showHeaderForMoment()
    }

    window.addEventListener('pointerdown', onAnyPointer, { capture: true })
    return () => window.removeEventListener('pointerdown', onAnyPointer, { capture: true } as any)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoHideHeader, isVisible])

  return (
    <div className="live-canvas-window" aria-hidden={!isVisible}>
      <div data-stacked-canvas-header className="live-canvas-window__header" style={{ display: !autoHideHeader || headerVisible ? undefined : 'none' }}>
        <div className="live-canvas-window__brand">
          <BrandLogo height={32} label className="text-white" labelClassName="text-white/60 tracking-[0.3em] uppercase text-[10px]" />
          <span className="live-canvas-window__badge">{gradeLabel || 'Shared board'}</span>
        </div>
        {backHref ? (
          <Link href={backHref} className="live-canvas-window__controls" aria-label="Back">
            Back
          </Link>
        ) : null}
      </div>
      <div className="live-canvas-window__body relative">
        <MyScriptMathCanvas
          uiMode="overlay"
          gradeLabel={gradeLabel || undefined}
          roomId={roomId}
          boardId={boardId}
          userId={userId}
          userDisplayName={userDisplayName}
          isAdmin={isAdmin}
          quizMode={quizMode}
          initialQuiz={initialQuiz}
          defaultOrientation={defaultOrientation}
          autoOpenDiagramTray={autoOpenDiagramTray}
          lessonAuthoring={lessonAuthoring}
          overlayControlsHandleRef={controlsHandleRef}
          onOverlayChromeVisibilityChange={visible => {
            if (autoHideHeader) {
              if (visible) showHeaderForMoment()
            }
            onOverlayChromeVisibilityChange?.(visible)
          }}
        />

        {boardId && (
          <DiagramOverlayModule
            boardId={boardId}
            gradeLabel={gradeLabel || null}
            userId={userId}
            userDisplayName={userDisplayName}
            isAdmin={Boolean(isAdmin)}
            lessonAuthoring={lessonAuthoring}
          />
        )}

        {boardId && (
          <TextOverlayModule
            boardId={boardId}
            gradeLabel={gradeLabel || null}
            userId={userId}
            userDisplayName={userDisplayName}
            isAdmin={Boolean(isAdmin)}
          />
        )}
      </div>
    </div>
  )
}
