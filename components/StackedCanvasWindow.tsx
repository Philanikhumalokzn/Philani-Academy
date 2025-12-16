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
}

type OverlayControlsHandle = {
  open: () => void
  close: () => void
  toggle: () => void
}

export default function StackedCanvasWindow({ gradeLabel, roomId, boardId, userId, userDisplayName, isAdmin, isVisible, defaultOrientation = 'portrait' }: Props) {
  const controlsHandleRef = useRef<OverlayControlsHandle | null>(null)

  const triggerOverlayControls = () => {
    const handle = controlsHandleRef.current
    if (!handle) return
    if (handle.open) {
      handle.open()
      return
    }
    if (handle.toggle) {
      handle.toggle()
    }
  }

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
        <button
          type="button"
          className="live-canvas-window__controls live-canvas-window__controls--icon"
          onClick={triggerOverlayControls}
          aria-label="Open canvas controls"
        >
          <span aria-hidden="true">⚙</span>
        </button>
      </div>
      <div className="live-canvas-window__body">
        <button
          type="button"
          className="live-canvas-window__floating-gear"
          onClick={triggerOverlayControls}
          aria-label="Open canvas controls"
        >
          <span aria-hidden="true">⚙</span>
        </button>
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
        />
      </div>
    </div>
  )
}
