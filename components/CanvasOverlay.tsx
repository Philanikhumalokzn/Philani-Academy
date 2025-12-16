import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MyScriptMathCanvas } from './MyScriptMathCanvas'
import BrandLogo from './BrandLogo'

type CanvasOverlayProps = {
  isOpen: boolean
  onClose: () => void
  gradeLabel?: string | null
  roomId: string
  userId: string
  userDisplayName?: string
  isAdmin?: boolean
}

export default function CanvasOverlay({ isOpen, onClose, gradeLabel, roomId, userId, userDisplayName, isAdmin }: CanvasOverlayProps) {
  const controlsHandleRef = useRef<{ open: () => void; close: () => void; toggle: () => void } | null>(null)

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
    if (!isOpen || typeof document === 'undefined') return
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeydown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeydown)
    }
  }, [isOpen, onClose])

  if (!isOpen || typeof document === 'undefined') return null

  return createPortal(
    <div className="canvas-overlay-shell" role="dialog" aria-modal="true">
      <div className="canvas-overlay-shell__backdrop" onClick={onClose} />
      <div className="canvas-overlay-shell__content" role="document">
        <header className="canvas-overlay-shell__header">
          <div className="canvas-overlay-shell__brand">
            <BrandLogo
              height={40}
              label
              className="text-white"
              labelClassName="text-white/70 text-xs tracking-[0.35em] uppercase"
            />
            <div className="canvas-overlay-shell__badge">{gradeLabel || 'Shared board'}</div>
          </div>
          <div className="canvas-overlay-shell__actions">
            <button
              type="button"
              className="canvas-overlay-shell__controls canvas-overlay-shell__controls--icon"
              onClick={triggerOverlayControls}
              aria-label="Open canvas controls"
            >
              <span aria-hidden="true">⚙</span>
            </button>
            <button type="button" className="canvas-overlay-shell__close" onClick={onClose}>
              Close
            </button>
          </div>
        </header>
        <div className="canvas-overlay-shell__canvas">
          <button
            type="button"
            className="canvas-overlay-shell__floating-gear"
            onClick={triggerOverlayControls}
            aria-label="Open canvas controls"
          >
            <span aria-hidden="true">⚙</span>
          </button>
          <button
            type="button"
            className="canvas-overlay-shell__mobile-close"
            onClick={onClose}
            aria-label="Close canvas"
          >
            ×
          </button>
          <MyScriptMathCanvas
            uiMode="overlay"
            gradeLabel={gradeLabel || undefined}
            roomId={roomId}
            userId={userId}
            userDisplayName={userDisplayName}
            isAdmin={isAdmin}
            overlayControlsHandleRef={controlsHandleRef}
          />
        </div>
      </div>
    </div>,
    document.body
  )
}
