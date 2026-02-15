import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop'
import { cropAndRotateImageToFile, rotateImageFile } from '../lib/imageEdit'
import FullScreenGlassOverlay from './FullScreenGlassOverlay'

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

  const [workingFile, setWorkingFile] = useState<File | null>(null)

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
    setRotating(false)
    setSaving(false)
    setError(null)
  }, [open, file, initialCrop])

  const rotateBy = useCallback(async (deltaDeg: number) => {
    if (!workingFile) return
    setRotating(true)
    setError(null)
    try {
      const rotated = await rotateImageFile({ file: workingFile, rotation: deltaDeg })
      setWorkingFile(rotated)
      setCrop(initialCrop)
      setCompletedCropPx(null)
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
        x: Math.max(0, Math.round(cropArea.x * scaleX)),
        y: Math.max(0, Math.round(cropArea.y * scaleY)),
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
  }, [completedCropPx, file, objectUrl, onConfirm, onUseOriginal, workingFile])

  const doUseOriginal = useCallback(() => {
    if (!file) return
    onUseOriginal(file)
  }, [file, onUseOriginal])

  if (!open) return null

  return (
    <FullScreenGlassOverlay
      title={title || 'Edit screenshot'}
      subtitle="Crop and rotate before uploading."
      onClose={onCancel}
      onBackdropClick={onCancel}
      closeDisabled={saving}
      zIndexClassName="z-[90]"
      panelSize="full"
      frameClassName="absolute inset-0 flex items-end justify-center p-0"
      panelClassName="!rounded-none"
      contentClassName="relative p-0 overflow-hidden"
    >
      <div className="relative h-full w-full bg-black">
        {error ? (
          <div className="absolute left-3 right-3 top-3 z-10 rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        ) : null}

        <div className="absolute inset-0">
          {objectUrl ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <ReactCrop
                crop={crop}
                onChange={(_, percentCrop) => setCrop(percentCrop)}
                onComplete={(px) => setCompletedCropPx(px)}
                keepSelection
                aspect={aspectRatio}
                circularCrop={circularCrop}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imgRef}
                  alt="Crop preview"
                  src={objectUrl}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  onLoad={() => {
                    setCrop(initialCrop)
                    setCompletedCropPx(null)
                  }}
                />
              </ReactCrop>
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-sm text-white/70">No image</div>
          )}
        </div>

        <div className="absolute inset-x-0 z-10" style={{ bottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <div className="px-3 pb-3 pt-16 sm:px-5 sm:pb-5 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-ghost h-9 w-9 !px-0"
                  onClick={() => {
                    setCrop(initialCrop)
                    setCompletedCropPx(null)
                  }}
                  disabled={saving || rotating}
                  aria-label="Reset crop"
                  title="Reset crop"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" aria-hidden="true">
                    <path d="M4 12a8 8 0 1 0 2.343-5.657" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M4 4v5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                <button
                  type="button"
                  className="btn btn-ghost h-9 w-9 !px-0"
                  onClick={() => void rotateBy(-90)}
                  disabled={saving || rotating || !workingFile}
                  aria-label="Rotate left"
                  title="Rotate left"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" aria-hidden="true">
                    <path d="M7 7H4v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M4 10a8 8 0 1 0 3-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>

                <button
                  type="button"
                  className="btn btn-ghost h-9 w-9 !px-0"
                  onClick={() => void rotateBy(90)}
                  disabled={saving || rotating || !workingFile}
                  aria-label="Rotate right"
                  title="Rotate right"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" aria-hidden="true">
                    <path d="M17 7h3v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M20 10a8 8 0 1 1-3-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>

                {rotating ? <div className="text-xs text-white/70">Rotating…</div> : null}
              </div>

              <div className="flex items-center gap-2">
                <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
                  Cancel
                </button>
                <button type="button" className="btn" onClick={doUseOriginal} disabled={saving || !file}>
                  Upload original
                </button>
                <button type="button" className="btn btn-primary" onClick={() => void doConfirm()} disabled={saving || !file || !objectUrl}>
                  {saving ? 'Processing…' : (confirmLabel || 'Upload edited')}
                </button>
              </div>
            </div>

            <div className="mt-2 text-[11px] text-white/70">
              Drag to move. Drag handles to zoom.
            </div>
          </div>
        </div>
      </div>
    </FullScreenGlassOverlay>
  )
}
