import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop'
import { cropAndRotateImageToFile, rotateImageFile } from '../lib/imageEdit'
import FullScreenGlassOverlay from './FullScreenGlassOverlay'

export default function ImageCropperModal(props: {
  open: boolean
  file: File | null
  title?: string
  onCancel: () => void
  onUseOriginal: (file: File) => void
  onConfirm: (file: File) => void
  confirmLabel?: string
}) {
  const { open, file, title, onCancel, onUseOriginal, onConfirm, confirmLabel } = props

  const imgRef = useRef<HTMLImageElement | null>(null)

  const [workingFile, setWorkingFile] = useState<File | null>(null)

  const [crop, setCrop] = useState<Crop>({ unit: '%', x: 10, y: 10, width: 80, height: 80 })
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
    setCrop({ unit: '%', x: 10, y: 10, width: 80, height: 80 })
    setCompletedCropPx(null)
    setRotating(false)
    setSaving(false)
    setError(null)
  }, [open, file])

  const rotateBy = useCallback(async (deltaDeg: number) => {
    if (!workingFile) return
    setRotating(true)
    setError(null)
    try {
      const rotated = await rotateImageFile({ file: workingFile, rotation: deltaDeg })
      setWorkingFile(rotated)
      setCrop({ unit: '%', x: 10, y: 10, width: 80, height: 80 })
      setCompletedCropPx(null)
    } catch (e: any) {
      setError(e?.message || 'Failed to rotate image')
    } finally {
      setRotating(false)
    }
  }, [workingFile])

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
      zIndexClassName="z-[60]"
      contentClassName="space-y-3"
    >
      {error ? <div className="text-sm text-red-300">{error}</div> : null}

      <div className="relative w-full h-[50vh] rounded overflow-hidden border border-white/10 bg-black">
        {objectUrl ? (
          <div className="absolute inset-0">
            <ReactCrop
              crop={crop}
              onChange={(_, percentCrop) => setCrop(percentCrop)}
              onComplete={(px) => setCompletedCropPx(px)}
              keepSelection
              ruleOfThirds
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                alt="Crop preview"
                src={objectUrl}
                style={{ maxHeight: '50vh', width: '100%', objectFit: 'contain' }}
                onLoad={() => {
                  setCrop({ unit: '%', x: 10, y: 10, width: 80, height: 80 })
                  setCompletedCropPx(null)
                }}
              />
            </ReactCrop>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm text-white/70">No image</div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="text-xs muted">Crop</div>
          <div className="text-sm text-white/80">Drag to move. Drag handles to resize.</div>
          <button
            type="button"
            className="btn btn-ghost w-fit"
            onClick={() => {
              setCrop({ unit: '%', x: 10, y: 10, width: 80, height: 80 })
              setCompletedCropPx(null)
            }}
            disabled={saving || rotating}
          >
            Reset crop
          </button>
        </div>

        <div className="space-y-2">
          <div className="text-xs muted">Rotate</div>
          <div className="flex gap-2 flex-wrap">
            <button type="button" className="btn btn-ghost" onClick={() => void rotateBy(-90)} disabled={saving || rotating || !workingFile}>
              Rotate -90°
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void rotateBy(90)} disabled={saving || rotating || !workingFile}>
              Rotate +90°
            </button>
          </div>
          {rotating ? <div className="text-xs text-white/70">Rotating…</div> : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 justify-end">
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
    </FullScreenGlassOverlay>
  )
}
