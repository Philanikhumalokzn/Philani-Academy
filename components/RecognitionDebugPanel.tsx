import { useEffect, useRef, useState } from 'react'

export type DebugField = {
  label: string
  value: React.ReactNode
}

export type DebugSection = {
  title: string
  fields: DebugField[]
}

type PanelPosition = { x: number; y: number }
type PanelSize = { width: number; height: number }

type RecognitionDebugPanelProps = {
  visible: boolean
  title?: string
  sections: DebugSection[]
  onClose?: () => void
  defaultPosition?: PanelPosition
  storageKey?: string
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const loadPosition = (storageKey?: string, fallback?: PanelPosition) => {
  if (!storageKey || typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
      return { x: parsed.x, y: parsed.y }
    }
  } catch {}
  return fallback
}

const persistPosition = (storageKey?: string, value?: PanelPosition) => {
  if (!storageKey || !value || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value))
  } catch {}
}

const loadSize = (storageKey?: string, fallback?: PanelSize) => {
  if (!storageKey || typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(`${storageKey}:size`)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    if (typeof parsed?.width === 'number' && typeof parsed?.height === 'number') {
      return { width: parsed.width, height: parsed.height }
    }
  } catch {}
  return fallback
}

const persistSize = (storageKey?: string, value?: PanelSize) => {
  if (!storageKey || !value || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(`${storageKey}:size`, JSON.stringify(value))
  } catch {}
}

export default function RecognitionDebugPanel({
  visible,
  title = 'Debug Panel',
  sections,
  onClose,
  defaultPosition = { x: 40, y: 40 },
  storageKey,
}: RecognitionDebugPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [rel, setRel] = useState({ x: 0, y: 0 })
  const [minimized, setMinimized] = useState(false)
  const [pos, setPos] = useState<PanelPosition>(() => loadPosition(storageKey, defaultPosition) || defaultPosition)
  const [size, setSize] = useState<PanelSize>(() => loadSize(storageKey, { width: 420, height: 360 }) || { width: 420, height: 360 })
  const [resizing, setResizing] = useState(false)
  const resizeStateRef = useRef({ startX: 0, startY: 0, startWidth: 420, startHeight: 360 })

  useEffect(() => {
    if (!storageKey) return
    persistPosition(storageKey, pos)
  }, [pos, storageKey])

  useEffect(() => {
    if (!storageKey) return
    persistSize(storageKey, size)
  }, [size, storageKey])

  useEffect(() => {
    if (!visible) return
    const handleMove = (e: PointerEvent) => {
      if (dragging) {
        const next = { x: e.pageX - rel.x, y: e.pageY - rel.y }
        const maxX = Math.max(8, window.innerWidth - size.width - 8)
        const maxY = Math.max(8, window.innerHeight - (minimized ? 48 : size.height) - 8)
        setPos({ x: clamp(next.x, 8, maxX), y: clamp(next.y, 8, maxY) })
      }
      if (resizing) {
        const nextWidth = resizeStateRef.current.startWidth + (e.pageX - resizeStateRef.current.startX)
        const nextHeight = resizeStateRef.current.startHeight + (e.pageY - resizeStateRef.current.startY)
        const maxWidth = Math.max(280, window.innerWidth - pos.x - 8)
        const maxHeight = Math.max(160, window.innerHeight - pos.y - 8)
        setSize({
          width: clamp(nextWidth, 280, maxWidth),
          height: clamp(nextHeight, 160, maxHeight),
        })
      }
    }
    const handleUp = () => {
      setDragging(false)
      setResizing(false)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }
  }, [dragging, minimized, pos.x, pos.y, rel, resizing, size.height, size.width, visible])

  useEffect(() => {
    if (!visible || typeof window === 'undefined') return
    const clampToViewport = () => {
      setSize(current => {
        const maxWidth = Math.max(280, window.innerWidth - 16)
        const maxHeight = Math.max(160, window.innerHeight - 16)
        const next = {
          width: clamp(current.width, 280, maxWidth),
          height: clamp(current.height, 160, maxHeight),
        }
        if (next.width === current.width && next.height === current.height) return current
        return next
      })
      setPos(current => {
        const panel = panelRef.current
        const panelWidth = minimized ? (panel?.offsetWidth || Math.min(size.width, 420)) : size.width
        const panelHeight = minimized ? (panel?.offsetHeight || 52) : size.height
        const maxX = Math.max(8, window.innerWidth - panelWidth - 8)
        const maxY = Math.max(8, window.innerHeight - panelHeight - 8)
        const next = {
          x: clamp(current.x, 8, maxX),
          y: clamp(current.y, 8, maxY),
        }
        if (next.x === current.x && next.y === current.y) return current
        return next
      })
    }
    clampToViewport()
    window.addEventListener('resize', clampToViewport)
    return () => window.removeEventListener('resize', clampToViewport)
  }, [visible, minimized, size.height, size.width])

  if (!visible) return null

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const panel = panelRef.current
    if (!panel) return
    setDragging(true)
    setRel({ x: e.pageX - pos.x, y: e.pageY - pos.y })
    e.stopPropagation()
    e.preventDefault()
  }

  const onResizeHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    resizeStateRef.current = {
      startX: e.pageX,
      startY: e.pageY,
      startWidth: size.width,
      startHeight: size.height,
    }
    setResizing(true)
    e.stopPropagation()
    e.preventDefault()
  }

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 9999,
        width: minimized ? undefined : size.width,
        height: minimized ? undefined : size.height,
        minWidth: 280,
        minHeight: 160,
        maxWidth: 'calc(100vw - 16px)',
        maxHeight: 'calc(100vh - 16px)',
        background: 'rgba(15, 23, 42, 0.7)',
        color: '#fff',
        borderRadius: 14,
        boxShadow: '0 12px 32px rgba(15,23,42,0.45)',
        border: '1px solid rgba(255,255,255,0.12)',
        padding: minimized ? 0 : 14,
        opacity: 0.98,
        userSelect: dragging || resizing ? 'none' : 'auto',
        cursor: dragging ? 'move' : resizing ? 'nwse-resize' : 'default',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        overflow: minimized ? 'hidden' : 'auto',
      }}
    >
      <div
        style={{
          width: '100%',
          padding: '6px 10px',
          background: 'rgba(30,41,59,0.6)',
          borderBottom: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '12px 12px 0 0',
          cursor: 'move',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
        onMouseDown={onMouseDown}
      >
        <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            style={{
              background: 'none',
              border: 'none',
              color: '#fff',
              fontSize: 18,
              cursor: 'pointer',
              lineHeight: 1,
              opacity: 0.9,
            }}
            onClick={() => setMinimized(m => !m)}
            title={minimized ? 'Expand' : 'Minimize'}
          >
            {minimized ? '▢' : '—'}
          </button>
          {onClose && (
            <button
              style={{
                background: 'none',
                border: 'none',
                color: '#fff',
                fontSize: 18,
                cursor: 'pointer',
                lineHeight: 1,
                opacity: 0.9,
              }}
              onClick={onClose}
              title="Close"
            >
              ×
            </button>
          )}
        </div>
      </div>
      {!minimized && (
        <div style={{ paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sections.map((section, idx) => (
            <div key={`${section.title}-${idx}`}>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, letterSpacing: 0.2 }}>{section.title}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {section.fields.map((field, fieldIdx) => (
                  <div key={`${field.label}-${fieldIdx}`} style={{ display: 'flex', gap: 6, fontSize: 12 }}>
                    <span style={{ opacity: 0.7, minWidth: 140 }}>{field.label}</span>
                    <span style={{ fontWeight: 500, wordBreak: 'break-word' }}>{field.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {!minimized && (
        <div
          role="presentation"
          onPointerDown={onResizeHandlePointerDown}
          style={{
            position: 'absolute',
            right: 6,
            bottom: 6,
            width: 18,
            height: 18,
            cursor: 'nwse-resize',
            touchAction: 'none',
            borderBottom: '2px solid rgba(255,255,255,0.45)',
            borderRight: '2px solid rgba(255,255,255,0.45)',
            borderBottomRightRadius: 6,
            opacity: 0.9,
          }}
        />
      )}
    </div>
  )
}
