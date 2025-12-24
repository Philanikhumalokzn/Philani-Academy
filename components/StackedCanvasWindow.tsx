import { useEffect, useRef } from 'react'
import MyScriptMathCanvas from './MyScriptMathCanvas'
import BrandLogo from './BrandLogo'

type CanvasOrientation = 'portrait' | 'landscape'

type Props = {
  gradeLabel?: string | null
  roomId: string
  boardId?: string
  userId: string
  userDisplayName?: string
  isAdmin?: boolean
  isVisible: boolean
  defaultOrientation?: CanvasOrientation
  onOverlayChromeVisibilityChange?: (visible: boolean) => void
}

type OverlayControlsHandle = {
  open: () => void
  close: () => void
  toggle: () => void
}

export default function StackedCanvasWindow({ gradeLabel, roomId, boardId, userId, userDisplayName, isAdmin, isVisible, defaultOrientation = 'portrait', onOverlayChromeVisibilityChange }: Props) {
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
      <div className="live-canvas-window__body">
        <MyScriptMathCanvas
          uiMode="overlay"
          gradeLabel={gradeLabel || undefined}
          roomId={roomId}
          boardId={boardId}
          userId={userId}
          userDisplayName={userDisplayName}
          isAdmin={isAdmin}
          defaultOrientation={defaultOrientation}
          overlayControlsHandleRef={controlsHandleRef}
          onOverlayChromeVisibilityChange={visible => {
            onOverlayChromeVisibilityChange?.(visible)
          }}
        />
      </div>
    </div>
  )
}
