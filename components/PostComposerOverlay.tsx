import dynamic from 'next/dynamic'
import type { ChangeEvent, RefObject } from 'react'
import { useState } from 'react'
import FullScreenGlassOverlay from './FullScreenGlassOverlay'
import OverlayPortal from './OverlayPortal'

const ImageCropperModal = dynamic(() => import('./ImageCropperModal'), { ssr: false })

type Audience = 'public' | 'grade' | 'private'

type Props = {
  open: boolean
  editingPostId?: string | null
  viewerName: string
  viewerAvatarUrl?: string | null
  titleDraft: string
  promptDraft: string
  audienceDraft: Audience
  maxAttempts: string
  imageUrl: string | null
  imageSourceFile: File | null
  parseOnUpload: boolean
  parsedJsonText: string | null
  parsedOpen: boolean
  uploading: boolean
  posting: boolean
  uploadInputRef: RefObject<HTMLInputElement | null>
  imageEditOpen: boolean
  imageEditFile: File | null
  onClose: () => void
  onTitleChange: (value: string) => void
  onPromptChange: (value: string) => void
  onAudienceChange: (value: Audience) => void
  onMaxAttemptsChange: (value: string) => void
  onParseOnUploadChange: (checked: boolean) => void
  onToggleParsedOpen: () => void
  onFilePicked: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>
  onOpenImageEdit: () => void
  onClearImage: () => void
  onSubmit: () => void | Promise<void>
  onCancelImageEdit: () => void
  onConfirmImageEdit: (file: File) => void | Promise<void>
}

export default function PostComposerOverlay({
  open,
  editingPostId,
  viewerName,
  viewerAvatarUrl,
  titleDraft,
  promptDraft,
  audienceDraft,
  maxAttempts,
  imageUrl,
  imageSourceFile,
  parseOnUpload,
  parsedJsonText,
  parsedOpen,
  uploading,
  posting,
  uploadInputRef,
  imageEditOpen,
  imageEditFile,
  onClose,
  onTitleChange,
  onPromptChange,
  onAudienceChange,
  onMaxAttemptsChange,
  onParseOnUploadChange,
  onToggleParsedOpen,
  onFilePicked,
  onOpenImageEdit,
  onClearImage,
  onSubmit,
  onCancelImageEdit,
  onConfirmImageEdit,
}: Props) {
  const [audiencePickerOpen, setAudiencePickerOpen] = useState(false)

  if (!open) return null

  return (
    <>
      <OverlayPortal>
        <FullScreenGlassOverlay
          title="Post"
          onClose={onClose}
          onBackdropClick={onClose}
          zIndexClassName="z-[70]"
          variant="light"
          panelSize="full"
          position="absolute"
          forceHeaderSafeTop
          frameClassName="absolute inset-0 flex items-stretch justify-center p-0"
          panelClassName="!h-full !max-h-none !max-w-none !rounded-none border-none bg-white"
          className="[&>.philani-overlay-backdrop]:!bg-white [&>.philani-overlay-backdrop]:!backdrop-blur-none"
          contentClassName="flex flex-col overflow-hidden p-0"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white p-0 text-[#1c1e21]">
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => void onFilePicked(event)}
            />

            <div className="px-0 py-4 sm:px-1 sm:py-5">
              <div className="flex items-start gap-3">
                {viewerAvatarUrl ? (
                  <img src={viewerAvatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full border border-black/10 bg-white object-cover" />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/10 bg-white text-sm font-semibold text-[#1c1e21]">
                    {String(viewerName || 'P')[0]?.toUpperCase?.() || 'P'}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-700">{editingPostId ? 'Edit post' : 'Share a post'}</div>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3">
                <input
                  className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-[#1c1e21] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/25"
                  placeholder="Title (optional)"
                  value={titleDraft}
                  onChange={(event) => onTitleChange(event.target.value)}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-slate-600">
                      <path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <span className="text-xs text-slate-500">Mode</span>
                    <span className="text-sm text-[#1c1e21]">Post</span>
                  </div>

                  <div className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-slate-600">
                      <path d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.364-6.364-2.121 2.121M7.757 16.243l-2.121 2.121m12.728 0-2.121-2.121M7.757 7.757 5.636 5.636" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <span className="text-xs text-slate-500">Max attempts</span>
                    <select
                      className="bg-transparent text-sm text-[#1c1e21] focus:outline-none"
                      value={maxAttempts}
                      onChange={(event) => onMaxAttemptsChange(event.target.value)}
                    >
                      <option value="unlimited">Unlimited</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="5">5</option>
                      <option value="10">10</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-0">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-none border-t border-black/10 bg-white px-0 py-4 sm:px-1 sm:py-5">
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
                  <textarea
                    className="min-h-[160px] w-full resize-none bg-transparent text-[15px] leading-relaxed text-[#1c1e21] placeholder:text-slate-500 focus:outline-none"
                    placeholder="Share what you are working on, stuck on, or proud of... or attach a screenshot below"
                    value={promptDraft}
                    onChange={(event) => onPromptChange(event.target.value)}
                  />

                  {imageUrl ? (
                    <div
                      className="w-full cursor-pointer"
                      role="button"
                      tabIndex={0}
                      onClick={onOpenImageEdit}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        onOpenImageEdit()
                      }}
                      aria-label="Edit uploaded screenshot"
                      title={imageSourceFile ? 'Edit screenshot' : 'Screenshot'}
                    >
                      <img src={imageUrl} alt="Uploaded" className="max-h-[260px] w-full rounded-lg object-contain" />
                    </div>
                  ) : null}
                </div>
              </div>

              {parsedOpen && parsedJsonText ? (
                <div className="rounded-none border-t border-black/10 bg-[#eef2f7] px-0 py-3 sm:px-1 sm:py-4">
                  <pre className="whitespace-pre-wrap text-xs text-slate-700">{parsedJsonText}</pre>
                </div>
              ) : null}
            </div>

            <div className="flex min-w-0 items-center justify-between gap-3 border-t border-black/10 bg-white px-0 py-3 sm:px-1 sm:py-4">
              <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={uploading}
                  aria-label={uploading ? 'Uploading screenshot' : 'Upload screenshot'}
                  title={uploading ? 'Uploading...' : 'Upload screenshot'}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 7a2 2 0 0 1 2-2h2l1-1h6l1 1h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="2" />
                    <path d="M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </button>

                <label className="inline-flex select-none items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={parseOnUpload}
                    onChange={(event) => onParseOnUploadChange(event.target.checked)}
                  />
                  Parse
                </label>

                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  onClick={onToggleParsedOpen}
                  disabled={!parsedJsonText}
                  aria-label={parsedOpen ? 'Hide parsed content' : 'View parsed content'}
                  title={parsedOpen ? 'Hide parsed' : 'View parsed'}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M8 5H6a2 2 0 0 0-2 2v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M16 5h2a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M8 19H6a2 2 0 0 1-2-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M16 19h2a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M9 9h6M9 12h6M9 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>

                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  onClick={onClearImage}
                  disabled={!imageUrl || uploading}
                  aria-label="Clear screenshot"
                  title="Clear screenshot"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M3 6h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M8 6V4h8v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M7 6l1 16h8l1-16" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <div className="relative">
                  <button
                    type="button"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-slate-700 hover:bg-slate-50"
                    onClick={() => setAudiencePickerOpen((current) => !current)}
                    aria-label="Change audience"
                    title="Change audience"
                  >
                    {audienceDraft === 'public' ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" stroke="currentColor" strokeWidth="2" />
                        <path d="M2 12h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M12 2c3.5 3.2 3.5 16.8 0 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M12 2c-3.5 3.2-3.5 16.8 0 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    ) : audienceDraft === 'grade' ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M16 11c1.66 0 3-1.34 3-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3Z" stroke="currentColor" strokeWidth="2" />
                        <path d="M8 11c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Z" stroke="currentColor" strokeWidth="2" />
                        <path d="M8 13c-2.76 0-5 1.79-5 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M16 13c2.76 0 5 1.79 5 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4Z" stroke="currentColor" strokeWidth="2" />
                        <path d="M12 14c-3.31 0-6 2.01-6 4.5V21h12v-2.5c0-2.49-2.69-4.5-6-4.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M7 11V8a5 5 0 0 1 10 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M6 11h12v10H6V11Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                        <path d="M12 15v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    )}
                  </button>

                  {audiencePickerOpen ? (
                    <div className="absolute bottom-full right-0 mb-2 w-48 overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_20px_40px_rgba(15,23,42,0.15)]">
                      {([
                        ['public', 'Public'],
                        ['grade', 'My grade'],
                        ['private', 'Private'],
                      ] as Array<[Audience, string]>).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          className={`flex w-full items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50 ${audienceDraft === value ? 'bg-slate-50' : ''}`}
                          onClick={() => {
                            onAudienceChange(value)
                            setAudiencePickerOpen(false)
                          }}
                        >
                          <span className="text-slate-700">{label}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={posting || uploading}
                  onClick={() => void onSubmit()}
                >
                  {posting ? (editingPostId ? 'Saving...' : 'Posting...') : (editingPostId ? 'Save' : 'Post')}
                </button>
              </div>
            </div>
          </div>
        </FullScreenGlassOverlay>
      </OverlayPortal>

      <ImageCropperModal
        open={imageEditOpen}
        file={imageEditFile}
        title="Edit screenshot"
        onCancel={onCancelImageEdit}
        onUseOriginal={(file: File) => void onConfirmImageEdit(file)}
        onConfirm={(file: File) => void onConfirmImageEdit(file)}
        confirmLabel="Upload"
      />
    </>
  )
}