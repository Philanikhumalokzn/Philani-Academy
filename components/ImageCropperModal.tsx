import { useCallback, useEffect, useMemo, useState } from 'react'
import Cropper from 'react-easy-crop'
import type { CropAreaPixels } from '../lib/imageEdit'
import { cropAndRotateImageToFile } from '../lib/imageEdit'

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

  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<CropAreaPixels | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const objectUrl = useMemo(() => {
    if (!open) return null
    if (!file) return null
    try {
      return URL.createObjectURL(file)
    } catch {
      return null
    }
  }, [file, open])

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
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setRotation(0)
    setCroppedAreaPixels(null)
    setSaving(false)
    setError(null)
  }, [open, file])

  const onCropComplete = useCallback((_croppedArea: any, croppedAreaPixels: any) => {
    if (!croppedAreaPixels) return
    setCroppedAreaPixels({
      x: Number(croppedAreaPixels.x) || 0,
      y: Number(croppedAreaPixels.y) || 0,
      width: Number(croppedAreaPixels.width) || 0,
      height: Number(croppedAreaPixels.height) || 0,
    })
  }, [])

  const doConfirm = useCallback(async () => {
    if (!file) return
    if (!objectUrl) return

    setSaving(true)
    setError(null)
    try {
      const cropArea = croppedAreaPixels
      if (!cropArea || cropArea.width <= 0 || cropArea.height <= 0) {
        // Fallback: if something went wrong, just upload original.
        onUseOriginal(file)
        return
      }

      const editedFile = await cropAndRotateImageToFile({
        imageUrl: objectUrl,
        crop: cropArea,
        rotation,
        mimeType: file.type,
        filenameHint: file.name,
      })
      onConfirm(editedFile)
    } catch (e: any) {
      setError(e?.message || 'Failed to process image')
      setSaving(false)
    }
  }, [croppedAreaPixels, file, objectUrl, onConfirm, onUseOriginal, rotation])

  const doUseOriginal = useCallback(() => {
    if (!file) return
    onUseOriginal(file)
  }, [file, onUseOriginal])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 philani-overlay-backdrop philani-overlay-backdrop-enter" onClick={saving ? undefined : onCancel} />

      <div className="absolute inset-x-0 bottom-0 px-2 sm:px-0 sm:inset-x-8 sm:inset-y-8" onClick={saving ? undefined : onCancel}>
        <div className="card philani-overlay-panel philani-overlay-enter h-full max-h-[92vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="p-3 border-b flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold break-words">{title || 'Edit screenshot'}</div>
              <div className="text-sm muted">Crop and rotate before uploading.</div>
            </div>
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {error ? <div className="text-sm text-red-300">{error}</div> : null}

            <div className="relative w-full h-[50vh] rounded overflow-hidden border border-white/10 bg-black">
              {objectUrl ? (
                <Cropper
                  image={objectUrl}
                  crop={crop}
                  zoom={zoom}
                  rotation={rotation}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onRotationChange={setRotation}
                  onCropComplete={onCropComplete}
                  objectFit="contain"
                  showGrid
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-sm text-white/70">No image</div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs muted mb-1">Zoom</div>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={0.01}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  disabled={saving}
                  className="w-full"
                />
              </div>

              <div>
                <div className="text-xs muted mb-1">Rotation</div>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={rotation}
                  onChange={(e) => setRotation(Number(e.target.value))}
                  disabled={saving}
                  className="w-full"
                />
                <div className="mt-2 flex gap-2">
                  <button type="button" className="btn btn-ghost" onClick={() => setRotation((r) => r - 90)} disabled={saving}>
                    -90°
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setRotation((r) => r + 90)} disabled={saving}>
                    +90°
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setRotation(0)} disabled={saving}>
                    Reset
                  </button>
                </div>
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
          </div>
        </div>
      </div>
    </div>
  )
}
