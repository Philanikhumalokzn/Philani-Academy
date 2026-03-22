import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop'
import { cropAndRotateImageToFile, rotateImageFile } from '../lib/imageEdit'
import FullScreenGlassOverlay from './FullScreenGlassOverlay'

type Filters = {
  brightness: number // -100 to 100
  contrast: number // -100 to 100
  saturation: number // -100 to 100
  temperature: number // -50 to 50 (warm to cool)
  hue: number // 0 to 360
}

export default function ImageCropperModal(props: {
  open: boolean
  file: File | null
  title?: string
  aspectRatio?: number
  circularCrop?: boolean
  onCancel: () => void
  onUseOriginal: (file: File) => void
  onConfirm: (file: File) => void
  confirmLabel?: string
}) {
  const { open, file, title, aspectRatio, circularCrop = false, onCancel, onUseOriginal, onConfirm, confirmLabel } = props

  const imgRef = useRef<HTMLImageElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const [workingFile, setWorkingFile] = useState<File | null>(null)
  const [rotation, setRotation] = useState(0)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [scale, setScale] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)

  const [filters, setFilters] = useState<Filters>({
    brightness: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    hue: 0,
  })

  const initialCrop = useMemo(() => {
    const baseWidth = 80
    const baseHeight = aspectRatio ? baseWidth / aspectRatio : 80
    const x = 10
    const y = aspectRatio ? (100 - baseHeight) / 2 : 10
    return { unit: '%' as const, x, y, width: baseWidth, height: baseHeight }
  }, [aspectRatio])

  const [crop, setCrop] = useState<Crop>(initialCrop)
  const [completedCropPx, setCompletedCropPx] = useState<PixelCrop | null>(null)

  const [rotating, setRotating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const objectUrl = useMemo(() => {
    if (!open) return null
    if (!workingFile) return null
    try {
      return URL.createObjectURL(workingFile)
    } catch {
      return null
    }
  }, [open, workingFile])

  useEffect(() => {
    if (!objectUrl) return
    return () => {
      try {
        URL.revokeObjectURL(objectUrl)
      } catch {
        // ignore
      }
    }
  }, [objectUrl])

  useEffect(() => {
    if (!open) return
    setWorkingFile(file)
    setCrop(initialCrop)
    setCompletedCropPx(null)
    setRotation(0)
    setPanX(0)
    setPanY(0)
    setScale(1)
    setSaving(false)
    setError(null)
    setFiltersOpen(false)
    setFilters({
      brightness: 0,
      contrast: 0,
      saturation: 0,
      temperature: 0,
      hue: 0,
    })
  }, [open, file, initialCrop])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (!containerRef.current) return
    const target = e.target as HTMLElement | null
    if (!target) return

    // Pan only when dragging inside crop selection body; edge/corner handles remain crop-only.
    const onHandle = target.closest('.ReactCrop__drag-handle, .ReactCrop__drag-bar')
    const onCropBody = target.closest('.ReactCrop__crop-selection')
    if (onHandle || !onCropBody) return

    e.preventDefault()
    e.stopPropagation()

    const rect = containerRef.current.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    setIsDragging(true)
    setDragStart({
      x: clientX - rect.left - panX,
      y: clientY - rect.top - panY,
    })
  }, [panX, panY])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStart || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    setPanX(clientX - rect.left - dragStart.x)
    setPanY(clientY - rect.top - dragStart.y)
  }, [isDragging, dragStart])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    setDragStart(null)
  }, [])

  useEffect(() => {
    if (!isDragging) return
    window.addEventListener('mousemove', handleMouseMove as any)
    window.addEventListener('touchmove', handleMouseMove as any)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('touchend', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove as any)
      window.removeEventListener('touchmove', handleMouseMove as any)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('touchend', handleMouseUp)
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  const rotateBy = useCallback(async (deltaDeg: number) => {
    if (!workingFile) return
    setRotating(true)
    setError(null)
    try {
      const rotated = await rotateImageFile({ file: workingFile, rotation: deltaDeg })
      setWorkingFile(rotated)
      setRotation((prev) => prev + deltaDeg)
      setCrop(initialCrop)
      setCompletedCropPx(null)
      setPanX(0)
      setPanY(0)
      setScale(1)
    } catch (e: any) {
      setError(e?.message || 'Failed to rotate image')
    } finally {
      setRotating(false)
    }
  }, [workingFile, initialCrop])

  const doConfirm = useCallback(async () => {
    if (!workingFile) return
    if (!objectUrl) return

    const img = imgRef.current
    if (!img) return

    setSaving(true)
    setError(null)
    try {
      const cropArea = completedCropPx
      if (!cropArea || cropArea.width <= 0 || cropArea.height <= 0) {
        // Fallback: if something went wrong, just upload original.
        onUseOriginal(file || workingFile)
        return
      }

      const scaleX = img.naturalWidth / img.width
      const scaleY = img.naturalHeight / img.height

      const naturalCrop = {
        x: Math.max(0, Math.round((cropArea.x - panX) * scaleX)),
        y: Math.max(0, Math.round((cropArea.y - panY) * scaleY)),
        width: Math.max(1, Math.round(cropArea.width * scaleX)),
        height: Math.max(1, Math.round(cropArea.height * scaleY)),
      }

      const editedFile = await cropAndRotateImageToFile({
        imageUrl: objectUrl,
        crop: naturalCrop,
        rotation: 0,
        mimeType: workingFile.type,
        filenameHint: workingFile.name,
      })
      onConfirm(editedFile)
    } catch (e: any) {
      setError(e?.message || 'Failed to process image')
      setSaving(false)
    }
  }, [completedCropPx, file, objectUrl, onConfirm, onUseOriginal, panX, panY, workingFile])

  const doUseOriginal = useCallback(() => {
    if (!file) return
    onUseOriginal(file)
  }, [file, onUseOriginal])

  const getFilterStyle = (): React.CSSProperties => {
    const brightness = Math.max(0, 100 + filters.brightness)
    const contrast = Math.max(0, 100 + filters.contrast)
    const saturation = Math.max(0, 100 + filters.saturation)
    const hue = filters.hue

    // Temperature: cool (blue) to warm (yellow)
    let tempFilter = ''
    if (filters.temperature < 0) {
      // Cool (blue)
      tempFilter = `hue-rotate(${Math.abs(filters.temperature) * 1.8}deg)`
    } else if (filters.temperature > 0) {
      // Warm (yellow/orange)
      tempFilter = `hue-rotate(${filters.temperature * 1.5}deg)`
    }

    return {
      filter: `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) hue-rotate(${hue}deg) ${tempFilter}`,
    }
  }

  if (!open) return null

  return (
    <FullScreenGlassOverlay
      title={title || 'Enhance & crop'}
      subtitle="Adjust, pan, crop. Tap image to pan."
      onClose={onCancel}
      onBackdropClick={onCancel}
      closeDisabled={saving}
      zIndexClassName="z-[90]"
      panelSize="full"
      hideHeader
      frameClassName="absolute inset-0 flex flex-col justify-end p-0"
      panelClassName="!rounded-none"
      contentClassName="relative p-0 overflow-hidden flex flex-col h-full"
    >
      {/* Main editing area */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden bg-black"
      >
        {error ? (
          <div className="absolute left-3 right-3 top-3 z-10 rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        ) : null}

        {objectUrl ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative">
              <div onMouseDownCapture={handleMouseDown} onTouchStartCapture={handleMouseDown}>
                <ReactCrop
                  crop={crop}
                  onChange={(_, percentCrop) => {
                    setCrop(percentCrop)
                  }}
                  onComplete={(px) => setCompletedCropPx(px)}
                  keepSelection
                  aspect={aspectRatio}
                  circularCrop={circularCrop}
                >
                  <img
                    ref={imgRef}
                    alt="Crop preview"
                    src={objectUrl}
                    style={{
                      width: '100vmin',
                      height: '100vmin',
                      objectFit: 'contain',
                      display: 'block',
                      transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
                      transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                      ...getFilterStyle(),
                    }}
                    onLoad={() => {
                      setCrop(initialCrop)
                      setCompletedCropPx(null)
                    }}
                    draggable="false"
                  />
                </ReactCrop>
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm text-white/70">Loading image…</div>
        )}

        {/* Top controls (floating) */}
        <div
          className="absolute inset-x-0 top-0 z-20 pointer-events-none"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 6px)' }}
        >
          <div className="px-3 pb-3 sm:px-5 bg-gradient-to-b from-black/70 via-black/35 to-transparent">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-white text-base font-semibold">{title || 'Enhance & crop'}</div>
                <div className="text-white/70 text-xs">Tap image to pan • Drag handles to crop</div>
              </div>
              <button
                type="button"
                className="pointer-events-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20 transition disabled:opacity-50"
                onClick={onCancel}
                disabled={saving}
                aria-label="Close"
              >
                <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
                  <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Right side rotate buttons (floating) */}
        <div
          className="absolute right-0 top-1/2 z-20 -translate-y-1/2 pointer-events-none"
          style={{ right: 'calc(env(safe-area-inset-right, 0px) + 8px)' }}
        >
          <div className="flex flex-col items-center gap-2 px-2">
            <button
              type="button"
              className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-black hover:bg-white shadow-lg backdrop-blur-sm transition disabled:opacity-50"
              onClick={() => void rotateBy(-90)}
              disabled={saving || rotating}
              aria-label="Rotate counterclockwise"
              title="Rotate ↶"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
                <path d="M7 7H4v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 10a8 8 0 1 0 3-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>

            <button
              type="button"
              className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-black hover:bg-white shadow-lg backdrop-blur-sm transition disabled:opacity-50"
              onClick={() => void rotateBy(90)}
              disabled={saving || rotating}
              aria-label="Rotate clockwise"
              title="Rotate ↷"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
                <path d="M17 7h3v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M20 10a8 8 0 1 1-3-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>

            {rotating ? <div className="text-[10px] text-white font-medium">…</div> : null}
          </div>
        </div>
      </div>

      {/* Bottom overlays: transparent filters drawer + action bar */}
      <div
        className="absolute inset-x-0 bottom-0 z-30"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {filtersOpen ? (
          <div className="max-h-[55vh] overflow-y-auto px-3 py-3 sm:px-5 pointer-events-auto bg-transparent">
            <div className="space-y-4">
          {/* Filter sliders */}
          <div className="space-y-3">
            <div className="text-xs font-semibold text-white/80 uppercase tracking-wider">Adjust</div>

            {/* Brightness */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-white">Brightness</label>
                <span className="text-xs text-white/60">{filters.brightness > 0 ? '+' : ''}{filters.brightness}%</span>
              </div>
              <input
                type="range"
                min="-100"
                max="100"
                value={filters.brightness}
                onChange={(e) => setFilters((prev) => ({ ...prev, brightness: Number(e.target.value) }))}
                className="w-full h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer"
              />
            </div>

            {/* Contrast */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-white">Contrast</label>
                <span className="text-xs text-white/60">{filters.contrast > 0 ? '+' : ''}{filters.contrast}%</span>
              </div>
              <input
                type="range"
                min="-100"
                max="100"
                value={filters.contrast}
                onChange={(e) => setFilters((prev) => ({ ...prev, contrast: Number(e.target.value) }))}
                className="w-full h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer"
              />
            </div>

            {/* Saturation */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-white">Saturation</label>
                <span className="text-xs text-white/60">{filters.saturation > 0 ? '+' : ''}{filters.saturation}%</span>
              </div>
              <input
                type="range"
                min="-100"
                max="100"
                value={filters.saturation}
                onChange={(e) => setFilters((prev) => ({ ...prev, saturation: Number(e.target.value) }))}
                className="w-full h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer"
              />
            </div>

            {/* Temperature */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-white">Temperature</label>
                <span className="text-xs text-white/60">{filters.temperature > 0 ? 'Warm' : filters.temperature < 0 ? 'Cool' : 'Neutral'}</span>
              </div>
              <input
                type="range"
                min="-50"
                max="50"
                value={filters.temperature}
                onChange={(e) => setFilters((prev) => ({ ...prev, temperature: Number(e.target.value) }))}
                className="w-full h-1.5 bg-gradient-to-r from-blue-500 via-white/30 to-orange-500 rounded-full appearance-none cursor-pointer"
              />
            </div>

            {/* Hue */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-white">Hue</label>
                <span className="text-xs text-white/60">{filters.hue}°</span>
              </div>
              <input
                type="range"
                min="0"
                max="360"
                value={filters.hue}
                onChange={(e) => setFilters((prev) => ({ ...prev, hue: Number(e.target.value) }))}
                className="w-full h-1.5 bg-gradient-to-r from-red-500 via-yellow-500 via-green-500 via-blue-500 to-red-500 rounded-full appearance-none cursor-pointer"
              />
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              className="text-xs font-medium px-3 py-1.5 rounded-full border border-white/30 bg-white/10 text-white hover:bg-white/15 transition disabled:opacity-50"
              onClick={() => setFilters({ brightness: 0, contrast: 0, saturation: 0, temperature: 0, hue: 0 })}
              disabled={saving || rotating}
            >
              Reset
            </button>
            <button
              type="button"
              className="text-xs font-medium px-3 py-1.5 rounded-full border border-white/30 bg-white/10 text-white hover:bg-white/15 transition disabled:opacity-50"
              onClick={() => {
                setCrop(initialCrop)
                setCompletedCropPx(null)
              }}
              disabled={saving || rotating}
            >
              Reset crop
            </button>
            <button
              type="button"
              className="text-xs font-medium px-3 py-1.5 rounded-full border border-white/30 bg-white/10 text-white hover:bg-white/15 transition"
              onClick={() => setFiltersOpen(false)}
            >
              Close filters
            </button>
          </div>
            </div>
          </div>
        ) : null}

        <div className="px-3 pb-3 sm:px-5 pt-2 pointer-events-auto bg-transparent">
          <div className="grid grid-cols-4 gap-2">
            <button
              type="button"
              className="text-xs font-medium px-3 py-2.5 rounded-xl border border-white/20 bg-white/10 text-white hover:bg-white/15 transition disabled:opacity-50"
              onClick={() => setFiltersOpen((prev) => !prev)}
              disabled={saving || rotating}
            >
              {filtersOpen ? 'Hide filters' : 'Filters'}
            </button>
            <button
              type="button"
              className="text-xs font-medium px-3 py-2.5 rounded-xl border border-white/20 bg-white/10 text-white hover:bg-white/15 transition disabled:opacity-50"
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="text-xs font-medium px-3 py-2.5 rounded-xl border border-white/20 bg-white/10 text-white hover:bg-white/15 transition disabled:opacity-50"
              onClick={doUseOriginal}
              disabled={saving}
            >
              Use original
            </button>
            <button
              type="button"
              className="text-xs font-medium px-3 py-2.5 rounded-xl bg-blue-500 text-white hover:bg-blue-600 transition disabled:opacity-50 shadow-lg"
              onClick={() => void doConfirm()}
              disabled={saving}
            >
              {saving ? 'Processing…' : confirmLabel || 'Upload'}
            </button>
          </div>
        </div>
      </div>
    </FullScreenGlassOverlay>
  )
}
