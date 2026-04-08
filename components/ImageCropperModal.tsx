import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop'
import { cropAndRotateImageToFile, rotateImageFile } from '../lib/imageEdit'
import FullScreenGlassOverlay from './FullScreenGlassOverlay'

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

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
  const settleCropOnCompleteRef = useRef(false)
  const recenterFrameRef = useRef<number | null>(null)
  const settleTimeoutRef = useRef<number | null>(null)

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
  const [isSettlingCrop, setIsSettlingCrop] = useState(false)

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
    setCrop({ ...initialCrop })
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

  const handleMouseDown = useCallback((_e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    // Intentionally disabled: dragging the crop body should adjust the crop box,
    // not pan the source image under it.
  }, [])

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
      setCrop({ ...initialCrop })
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

      const displayWidth = img.clientWidth || img.width
      const displayHeight = img.clientHeight || img.height

      if (!displayWidth || !displayHeight || !img.naturalWidth || !img.naturalHeight) {
        throw new Error('Image dimensions are unavailable')
      }

      // ReactCrop selection is over the element box. With object-fit: contain,
      // the visible bitmap may be letterboxed inside that box, so map via the
      // actual rendered bitmap rect instead of the full element size.
      const fitScale = Math.min(displayWidth / img.naturalWidth, displayHeight / img.naturalHeight)
      const renderedWidth = img.naturalWidth * fitScale
      const renderedHeight = img.naturalHeight * fitScale
      const offsetX = (displayWidth - renderedWidth) / 2
      const offsetY = (displayHeight - renderedHeight) / 2

      const effectiveScale = Math.max(0.0001, scale)
      const sourceX = (cropArea.x - panX - offsetX) / effectiveScale
      const sourceY = (cropArea.y - panY - offsetY) / effectiveScale
      const sourceW = cropArea.width / effectiveScale
      const sourceH = cropArea.height / effectiveScale

      const naturalScaleX = img.naturalWidth / Math.max(1, renderedWidth)
      const naturalScaleY = img.naturalHeight / Math.max(1, renderedHeight)

      const rawX = sourceX * naturalScaleX
      const rawY = sourceY * naturalScaleY
      const rawW = sourceW * naturalScaleX
      const rawH = sourceH * naturalScaleY

      const boundedX = clamp(rawX, 0, img.naturalWidth)
      const boundedY = clamp(rawY, 0, img.naturalHeight)
      const boundedW = clamp(rawW, 1, img.naturalWidth - boundedX)
      const boundedH = clamp(rawH, 1, img.naturalHeight - boundedY)

      const naturalCrop = {
        x: Math.round(boundedX),
        y: Math.round(boundedY),
        width: Math.round(boundedW),
        height: Math.round(boundedH),
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
  }, [completedCropPx, file, objectUrl, onConfirm, onUseOriginal, panX, panY, scale, workingFile])

  const doUseOriginal = useCallback(() => {
    if (!file) return
    onUseOriginal(file)
  }, [file, onUseOriginal])

  const resetFilters = useCallback(() => {
    setFilters({
      brightness: 0,
      contrast: 0,
      saturation: 0,
      temperature: 0,
      hue: 0,
    })
  }, [])

  const recenterCropSnapshot = useCallback((targetCrop: Crop | PixelCrop) => {
    const img = imgRef.current
    if (!img) return

    const displayWidth = img.clientWidth || img.width
    const displayHeight = img.clientHeight || img.height
    if (!displayWidth || !displayHeight) return

    const cropWidthPx = targetCrop.unit === '%' ? (displayWidth * targetCrop.width) / 100 : targetCrop.width
    const cropHeightPx = targetCrop.unit === '%' ? (displayHeight * targetCrop.height) / 100 : targetCrop.height
    if (!cropWidthPx || !cropHeightPx) return

    const cropXPx = targetCrop.unit === '%' ? (displayWidth * targetCrop.x) / 100 : targetCrop.x
    const cropYPx = targetCrop.unit === '%' ? (displayHeight * targetCrop.y) / 100 : targetCrop.y

    const nextCropXPx = (displayWidth - cropWidthPx) / 2
    const nextCropYPx = (displayHeight - cropHeightPx) / 2
    const deltaX = nextCropXPx - cropXPx
    const deltaY = nextCropYPx - cropYPx
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return

    const nextCrop = targetCrop.unit === '%'
      ? {
          ...targetCrop,
          x: (nextCropXPx / displayWidth) * 100,
          y: (nextCropYPx / displayHeight) * 100,
        }
      : {
          ...targetCrop,
          x: nextCropXPx,
          y: nextCropYPx,
        }

    setIsSettlingCrop(true)
    setCrop(nextCrop)
    setPanX((current) => current + deltaX)
    setPanY((current) => current + deltaY)

    if (typeof window !== 'undefined') {
      if (settleTimeoutRef.current !== null) {
        window.clearTimeout(settleTimeoutRef.current)
      }
      settleTimeoutRef.current = window.setTimeout(() => {
        settleTimeoutRef.current = null
        setIsSettlingCrop(false)
      }, 260)
    }
  }, [])

  const scheduleCropRecentering = useCallback((targetCrop: Crop | PixelCrop) => {
    if (typeof window === 'undefined') return
    if (recenterFrameRef.current !== null) {
      window.cancelAnimationFrame(recenterFrameRef.current)
    }
    recenterFrameRef.current = window.requestAnimationFrame(() => {
      recenterFrameRef.current = null
      recenterCropSnapshot(targetCrop)
    })
  }, [recenterCropSnapshot])

  const resetCropStage = useCallback(() => {
    setCrop({ ...initialCrop })
    setCompletedCropPx(null)
    setPanX(0)
    setPanY(0)
    setScale(1)
    setIsSettlingCrop(false)
  }, [initialCrop])

  const revertAllEdits = useCallback(() => {
    if (!file) return
    setWorkingFile(file)
    setRotation(0)
    resetCropStage()
    resetFilters()
    setFiltersOpen(false)
    setError(null)
  }, [file, resetCropStage, resetFilters])

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

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && recenterFrameRef.current !== null) {
        window.cancelAnimationFrame(recenterFrameRef.current)
      }
      if (typeof window !== 'undefined' && settleTimeoutRef.current !== null) {
        window.clearTimeout(settleTimeoutRef.current)
      }
    }
  }, [])

  if (!open) return null

  const editorActionClassName = 'inline-flex min-w-[4.35rem] flex-col items-center justify-center gap-1 rounded-[1.15rem] px-2 py-2 text-[0.72rem] font-medium text-white/72 transition active:scale-[0.98] disabled:opacity-45'
  const editorActionActiveClassName = 'bg-white/14 text-white shadow-[0_10px_22px_rgba(0,0,0,0.22)]'
  const editorActionIdleClassName = 'hover:bg-white/8'

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
        className="relative flex-1 overflow-hidden bg-[#05070c]"
      >
        {error ? (
          <div className="absolute left-3 right-3 top-3 z-10 rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        ) : null}
        {objectUrl ? (
          <>
            <div className="absolute inset-0 overflow-hidden">
              <img
                aria-hidden="true"
                alt=""
                src={objectUrl}
                className="h-full w-full scale-110 object-cover opacity-35 blur-3xl"
                draggable="false"
              />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.05)_0%,rgba(5,7,12,0.38)_52%,rgba(5,7,12,0.74)_100%)]" />
            </div>

            <div className="absolute inset-0 flex items-center justify-center px-4 py-5 sm:px-6 sm:py-6">
              <div className="relative max-h-full max-w-full">
                <div onMouseDownCapture={handleMouseDown} onTouchStartCapture={handleMouseDown}>
                  <ReactCrop
                    className={isSettlingCrop ? 'philani-image-crop philani-image-crop--settling' : 'philani-image-crop'}
                    crop={crop}
                    onChange={(_, percentCrop) => {
                      setCrop(percentCrop)
                    }}
                    onComplete={(px, percentCrop) => {
                      setCompletedCropPx(px)
                      if (settleCropOnCompleteRef.current) {
                        settleCropOnCompleteRef.current = false
                        scheduleCropRecentering(percentCrop)
                      }
                    }}
                    onDragEnd={() => {
                      settleCropOnCompleteRef.current = true
                    }}
                    keepSelection
                    aspect={aspectRatio}
                    circularCrop={circularCrop}
                  >
                    <img
                      ref={imgRef}
                      alt="Crop preview"
                      src={objectUrl}
                      style={{
                        display: 'block',
                        width: 'auto',
                        height: 'auto',
                        maxWidth: 'min(calc(100vw - 5.75rem), 48rem)',
                        maxHeight: 'calc(100dvh - 11.5rem)',
                        transformOrigin: 'top left',
                        transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
                        transition: isDragging ? 'none' : 'transform 0.24s cubic-bezier(0.22, 1, 0.36, 1)',
                        cursor: 'default',
                        ...getFilterStyle(),
                      }}
                      onLoad={() => {
                        setCrop({ ...initialCrop })
                        setCompletedCropPx(null)
                        setPanX(0)
                        setPanY(0)
                        setScale(1)
                        setIsSettlingCrop(false)
                      }}
                      draggable="false"
                    />
                  </ReactCrop>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm text-white/70">Loading image…</div>
        )}

        {/* Editor top bar */}
        <div
          className="absolute inset-x-0 top-0 z-20 pointer-events-none"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 4px)' }}
        >
          <div className="px-3 pb-4 sm:px-5 bg-gradient-to-b from-black/82 via-black/48 to-transparent">
            <div className="flex items-center justify-between gap-3">
              <div className="pointer-events-auto flex items-center gap-2">
                <button
                  type="button"
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-white/14 bg-white/10 text-white backdrop-blur-md transition hover:bg-white/18 disabled:opacity-50"
                  onClick={onCancel}
                  disabled={saving}
                  aria-label="Back"
                  title="Back"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                    <path d="M15 6 9 12l6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="rounded-full px-3 py-2 text-[0.78rem] font-semibold tracking-[0.01em] text-white/82 transition hover:bg-white/10 disabled:opacity-50"
                  onClick={revertAllEdits}
                  disabled={saving || !file}
                >
                  Revert
                </button>
              </div>

              <div className="min-w-0 text-center">
                <div className="text-[0.95rem] font-semibold text-white">{title || 'Edit photo'}</div>
                <div className="text-[0.7rem] text-white/58">Drag corners to crop</div>
              </div>

              <div className="pointer-events-auto flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-full bg-[#3b82f6] px-4 py-2 text-[0.8rem] font-semibold tracking-[0.01em] text-white shadow-[0_12px_28px_rgba(59,130,246,0.36)] transition hover:bg-[#2563eb] disabled:opacity-50"
                  onClick={() => void doConfirm()}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom overlays: Android-style tools rail */}
      <div
        className="absolute inset-x-0 bottom-0 z-30"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {filtersOpen ? (
          <div className="pointer-events-auto border-t border-white/12 bg-[linear-gradient(180deg,rgba(3,7,18,0.14),rgba(3,7,18,0.88)_22%,rgba(3,7,18,0.96)_100%)] px-4 pb-3 pt-4 backdrop-blur-xl sm:px-5">
            <div className="mx-auto max-w-xl space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-white/48">Adjust</div>
              <div className="mt-1 text-sm font-medium text-white/88">Tune the image before saving</div>
            </div>
            <button
              type="button"
              className="rounded-full border border-white/12 bg-white/6 px-3 py-1.5 text-[0.72rem] font-semibold text-white/76 transition hover:bg-white/10 disabled:opacity-50"
              onClick={resetFilters}
              disabled={saving || rotating}
            >
              Reset
            </button>
          </div>

          <div className="space-y-3">

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

          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="text-[0.72rem] text-white/52">Filters match the preview as you crop.</div>
            <button
              type="button"
              className="rounded-full border border-white/12 bg-white/6 px-3 py-1.5 text-[0.72rem] font-semibold text-white/76 transition hover:bg-white/10"
              onClick={() => setFiltersOpen(false)}
            >
              Done
            </button>
          </div>
            </div>
          </div>
        ) : null}

        <div className="pointer-events-auto border-t border-white/10 bg-[linear-gradient(180deg,rgba(5,7,12,0.18),rgba(5,7,12,0.86)_18%,rgba(5,7,12,0.96)_100%)] px-3 pb-3 pt-2 backdrop-blur-xl sm:px-5">
          <div className="mx-auto flex max-w-xl items-start justify-between gap-1">
            <button
              type="button"
              className={`${editorActionClassName} ${editorActionIdleClassName}`}
              onClick={resetCropStage}
              disabled={saving || rotating}
              aria-label="Reset crop"
              title="Crop"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                <path d="M8 4H6a2 2 0 0 0-2 2v2" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
                <path d="M16 4h2a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
                <path d="M20 16v2a2 2 0 0 1-2 2h-2" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
                <path d="M8 20H6a2 2 0 0 1-2-2v-2" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
              </svg>
              <span>Crop</span>
            </button>

            <button
              type="button"
              className={`${editorActionClassName} ${filtersOpen ? editorActionActiveClassName : editorActionIdleClassName}`}
              onClick={() => setFiltersOpen((prev) => !prev)}
              disabled={saving || rotating}
              aria-label="Adjust filters"
              title="Adjust"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                <path d="M4 7h10" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
                <path d="M18 7h2" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
                <path d="M4 12h4" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
                <path d="M12 12h8" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
                <path d="M4 17h8" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
                <path d="M16 17h4" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
                <circle cx="14" cy="7" r="2" fill="currentColor" />
                <circle cx="10" cy="12" r="2" fill="currentColor" />
                <circle cx="14" cy="17" r="2" fill="currentColor" />
              </svg>
              <span>Adjust</span>
            </button>

            <button
              type="button"
              className={`${editorActionClassName} ${editorActionIdleClassName}`}
              onClick={() => void rotateBy(-90)}
              disabled={saving || rotating}
              aria-label="Rotate left"
              title="Rotate left"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                <path d="M7 7H4v3" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 10a8 8 0 1 0 3-6" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
              </svg>
              <span>Rotate</span>
            </button>

            <button
              type="button"
              className={`${editorActionClassName} ${editorActionIdleClassName}`}
              onClick={() => void rotateBy(90)}
              disabled={saving || rotating}
              aria-label="Rotate right"
              title="Rotate right"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                <path d="M17 7h3v3" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M20 10a8 8 0 1 1-3-6" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
              </svg>
              <span>Rotate</span>
            </button>

            <button
              type="button"
              className={`${editorActionClassName} ${editorActionIdleClassName}`}
              onClick={doUseOriginal}
              disabled={saving}
              aria-label="Use original image"
              title="Original"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                <rect x="4" y="5" width="16" height="14" rx="3" stroke="currentColor" strokeWidth="2" />
                <path d="M8 15.5 11 12.5l2.2 2.2L16 11.9 18 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="9" cy="9" r="1.2" fill="currentColor" />
              </svg>
              <span>Original</span>
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between px-1 text-[0.68rem] text-white/42">
            <span>{rotating ? 'Applying rotation...' : 'Modern crop editor'}</span>
            <span>Crop frame and selected snapshot settle together</span>
          </div>
        </div>
      </div>
    </FullScreenGlassOverlay>
  )
}
