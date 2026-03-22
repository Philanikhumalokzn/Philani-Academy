/**
 * ScriptPhotosEditor — Camera/upload picker + crop for multi-page script evidence.
 *
 * Props:
 *   urls         — current array of uploaded photo URLs
 *   onChange     — called when the array changes (add/remove)
 *   disabled     — disables the add button
 *   darkMode     — switches to dark glass styling
 */

import React, { useCallback, useRef, useState } from 'react'
import ImageCropperModal from './ImageCropperModal'

type Props = {
  urls: string[]
  onChange: (urls: string[]) => void
  disabled?: boolean
  darkMode?: boolean
}

type PickerState =
  | { phase: 'idle' }
  | { phase: 'cropping'; file: File; captureMode: boolean }
  | { phase: 'uploading' }

export default function ScriptPhotosEditor({ urls, onChange, disabled, darkMode }: Props) {
  const [picker, setPicker] = useState<PickerState>({ phase: 'idle' })
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  // Two separate file inputs: one with capture="environment" for camera, one normal for gallery
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const galleryInputRef = useRef<HTMLInputElement | null>(null)

  const openMenu = useCallback(() => {
    if (disabled) return
    setUploadError(null)
    setMenuOpen(true)
  }, [disabled])

  const handleCameraClick = useCallback(() => {
    setMenuOpen(false)
    cameraInputRef.current?.click()
  }, [])

  const handleGalleryClick = useCallback(() => {
    setMenuOpen(false)
    galleryInputRef.current?.click()
  }, [])

  const handleFileChosen = useCallback((file: File, captureMode: boolean) => {
    setPicker({ phase: 'cropping', file, captureMode })
  }, [])

  const handleCropCancel = useCallback(() => {
    setPicker({ phase: 'idle' })
  }, [])

  const uploadFile = useCallback(async (file: File) => {
    setPicker({ phase: 'uploading' })
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/challenges/upload', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Upload failed (${res.status})`)
      const url = typeof data?.url === 'string' ? data.url.trim() : ''
      if (!url) throw new Error('Upload succeeded but returned no URL')
      onChange([...urls, url])
    } catch (err: any) {
      setUploadError(err?.message || 'Upload failed')
    } finally {
      setPicker({ phase: 'idle' })
    }
  }, [onChange, urls])

  const handleCropConfirm = useCallback((croppedFile: File) => {
    void uploadFile(croppedFile)
  }, [uploadFile])

  const handleUseOriginal = useCallback((originalFile: File) => {
    void uploadFile(originalFile)
  }, [uploadFile])

  const removePhoto = useCallback((index: number) => {
    onChange(urls.filter((_, i) => i !== index))
  }, [onChange, urls])

  const isUploading = picker.phase === 'uploading'
  const isCropping = picker.phase === 'cropping'

  const btnBase = darkMode
    ? 'inline-flex items-center justify-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-medium text-white/90 transition hover:bg-white/15 disabled:opacity-50'
    : 'inline-flex items-center justify-center gap-1.5 rounded-full border border-[#d5def0] bg-[#f7f8fa] px-3 py-1.5 text-[11px] font-medium text-[#1c1e21] transition hover:bg-[#edf2fb] disabled:opacity-50'

  return (
    <>
      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) handleFileChosen(file, true)
        }}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) handleFileChosen(file, false)
        }}
      />

      {/* Crop modal */}
      <ImageCropperModal
        open={isCropping}
        file={isCropping ? (picker as any).file : null}
        title="Crop script page"
        onCancel={handleCropCancel}
        onUseOriginal={handleUseOriginal}
        onConfirm={handleCropConfirm}
        confirmLabel="Use cropped"
      />

      {/* Add-photo button + inline menu */}
      <div className="relative">
        <button
          type="button"
          className={btnBase}
          onClick={openMenu}
          disabled={disabled || isUploading}
          aria-label="Add script photo"
        >
          {isUploading ? (
            <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
              <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="1.75" />
            </svg>
          )}
          <span>{isUploading ? 'Uploading…' : urls.length > 0 ? 'Add page' : 'Add script photo'}</span>
        </button>

        {menuOpen && !disabled && (
          <>
            {/* backdrop to close menu */}
            <div
              className="fixed inset-0 z-[88]"
              onClick={() => setMenuOpen(false)}
            />
            <div
              className={`absolute bottom-full left-0 z-[89] mb-1.5 min-w-[180px] overflow-hidden rounded-2xl border shadow-xl ${
                darkMode
                  ? 'border-white/15 bg-[#1a1f2e]'
                  : 'border-black/10 bg-white'
              }`}
            >
              <button
                type="button"
                className={`flex w-full items-center gap-3 px-4 py-3 text-sm transition ${
                  darkMode
                    ? 'text-white/90 hover:bg-white/8'
                    : 'text-[#1c1e21] hover:bg-[#f5f7fa]'
                }`}
                onClick={handleCameraClick}
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0" aria-hidden="true">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
                  <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="1.75" />
                </svg>
                Take photo
              </button>
              <div className={`mx-3 border-t ${darkMode ? 'border-white/8' : 'border-black/8'}`} />
              <button
                type="button"
                className={`flex w-full items-center gap-3 px-4 py-3 text-sm transition ${
                  darkMode
                    ? 'text-white/90 hover:bg-white/8'
                    : 'text-[#1c1e21] hover:bg-[#f5f7fa]'
                }`}
                onClick={handleGalleryClick}
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.75" />
                  <path d="M3 15l5-5 4 4 3-3 6 6" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
                  <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                </svg>
                Upload image
              </button>
            </div>
          </>
        )}
      </div>

      {uploadError ? (
        <div className={`mt-1 rounded-lg px-2 py-1 text-[11px] ${darkMode ? 'text-red-300' : 'text-red-600'}`}>
          {uploadError}
        </div>
      ) : null}

      {/* Photo strip */}
      {urls.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {urls.map((url, index) => (
            <div
              key={`${url}-${index}`}
              className={`group relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border ${
                darkMode ? 'border-white/15' : 'border-black/10'
              }`}
            >
              <img
                src={url}
                alt={`Script page ${index + 1}`}
                className="h-full w-full object-cover"
              />
              {/* Page number badge */}
              <div className="absolute left-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-black/60 px-1 text-[9px] font-bold text-white">
                {index + 1}
              </div>
              {/* Delete button */}
              <button
                type="button"
                className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                onClick={() => removePhoto(index)}
                aria-label={`Remove page ${index + 1}`}
              >
                <svg viewBox="0 0 20 20" fill="none" className="h-2.5 w-2.5" aria-hidden="true">
                  <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}
