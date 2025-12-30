import { useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
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
  defaultStudentWriteEnabled?: boolean
  quizMode?: boolean
  initialQuiz?: InitialQuizConfig
  realtimeKey?: string
  studentLayout?: 'stacked' | 'canvasOnly'
  isVisible: boolean
  defaultOrientation?: CanvasOrientation
  onOverlayChromeVisibilityChange?: (visible: boolean) => void
  autoOpenDiagramTray?: boolean
  lessonAuthoring?: { phaseKey: string; pointId: string }
}

type OverlayControlsHandle = {
  open: () => void
  close: () => void
  toggle: () => void
}

export default function StackedCanvasWindow({ gradeLabel, roomId, boardId, userId, userDisplayName, isAdmin, defaultStudentWriteEnabled, quizMode, initialQuiz, realtimeKey, studentLayout, isVisible, defaultOrientation = 'portrait', onOverlayChromeVisibilityChange, autoOpenDiagramTray, lessonAuthoring }: Props) {
  const controlsHandleRef = useRef<OverlayControlsHandle | null>(null)

  useEffect(() => {
    if (!isVisible || typeof window === 'undefined') return
    const resizeHandle = setTimeout(() => {
      window.dispatchEvent(new Event('resize'))
    }, 120)
    return () => clearTimeout(resizeHandle)
  }, [isVisible])

  return (
    <div className="live-canvas-window" aria-hidden={!isVisible}>
      <div className="live-canvas-window__header">
        <div className="live-canvas-window__brand">
          <BrandLogo height={32} label className="text-white" labelClassName="text-white/60 tracking-[0.3em] uppercase text-[10px]" />
          <span className="live-canvas-window__badge">{gradeLabel || 'Shared board'}</span>
        </div>
      </div>
      <div className="live-canvas-window__body relative">
        <MyScriptMathCanvas
          uiMode="overlay"
          gradeLabel={gradeLabel || undefined}
          roomId={roomId}
          boardId={boardId}
          realtimeKey={realtimeKey}
          userId={userId}
          userDisplayName={userDisplayName}
          isAdmin={isAdmin}
          defaultStudentWriteEnabled={defaultStudentWriteEnabled}
          quizMode={quizMode}
          initialQuiz={initialQuiz}
          studentLayout={studentLayout}
          defaultOrientation={defaultOrientation}
          autoOpenDiagramTray={autoOpenDiagramTray}
          lessonAuthoring={lessonAuthoring}
          overlayControlsHandleRef={controlsHandleRef}
          onOverlayChromeVisibilityChange={visible => {
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
