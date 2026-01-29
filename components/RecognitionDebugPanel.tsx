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

  useEffect(() => {
    if (!storageKey) return
    persistPosition(storageKey, pos)
  }, [pos, storageKey])

  useEffect(() => {
    if (!visible) return
    const handleMove = (e: MouseEvent) => {
      if (!dragging) return
      const next = { x: e.pageX - rel.x, y: e.pageY - rel.y }
      const maxX = Math.max(0, window.innerWidth - 120)
      const maxY = Math.max(0, window.innerHeight - 80)
      setPos({ x: clamp(next.x, 8, maxX), y: clamp(next.y, 8, maxY) })
    }
    const handleUp = () => setDragging(false)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragging, rel, visible])

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

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 9999,
        minWidth: 280,
        maxWidth: 420,
        background: 'rgba(30,30,40,0.98)',
        color: '#fff',
        borderRadius: 10,
        boxShadow: '0 2px 16px #0008',
        border: '1px solid #fff2',
        padding: minimized ? 0 : 14,
        opacity: 0.98,
        userSelect: dragging ? 'none' : 'auto',
        cursor: dragging ? 'move' : 'default',
      }}
    >
      <div
        style={{
          width: '100%',
          padding: '6px 10px',
          background: 'rgba(40,40,60,0.95)',
          borderBottom: '1px solid #fff2',
          borderRadius: '10px 10px 0 0',
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
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>{section.title}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {section.fields.map((field, fieldIdx) => (
                  <div key={`${field.label}-${fieldIdx}`} style={{ display: 'flex', gap: 6, fontSize: 12 }}>
                    <span style={{ opacity: 0.75, minWidth: 140 }}>{field.label}</span>
                    <span style={{ fontWeight: 500, wordBreak: 'break-word' }}>{field.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
