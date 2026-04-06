import dynamic from 'next/dynamic'
import type { ChangeEvent, RefObject } from 'react'
import { useMemo, useState } from 'react'
import BottomSheet from './BottomSheet'
import FullScreenGlassOverlay from './FullScreenGlassOverlay'
import OverlayPortal from './OverlayPortal'
import PostComposerBlocksPreview from './PostComposerBlocksPreview'
import { PublicSolveComposer, PublicSolveOpacityWorkspace, type PublicSolveScene } from './PublicSolveCanvas'
import type { ComposerBlockCrudTarget, ComposerBlockEditTarget, PostReplyBlock, PostSolveOverlayState } from '../lib/postReplyComposer'
import { composePostSolveBlocksWithDraftText } from '../lib/postReplyComposer'
import { renderKatexDisplayHtml } from '../lib/latexRender'
import { renderTextWithKatex } from '../lib/renderTextWithKatex'

const ImageCropperModal = dynamic(() => import('./ImageCropperModal'), { ssr: false })
const StackedCanvasWindow = dynamic(() => import('./StackedCanvasWindow'), { ssr: false })

type Audience = 'public' | 'grade' | 'private'

type Props = {
  open: boolean
  editingPostId?: string | null
  viewerName: string
  viewerAvatarUrl?: string | null
  titleDraft: string
  audienceDraft: Audience
  maxAttempts: string
  parseOnUpload: boolean
  parsedJsonText: string | null
  parsedOpen: boolean
  uploading: boolean
  posting: boolean
  imageEditOpen: boolean
  imageEditFile: File | null
  onClose: () => void
  onTitleChange: (value: string) => void
  onAudienceChange: (value: Audience) => void
  onMaxAttemptsChange: (value: string) => void
  onParseOnUploadChange: (checked: boolean) => void
  onToggleParsedOpen: () => void
  onSubmit: () => void | Promise<void>
  onCancelImageEdit: () => void
  onConfirmImageEdit: (file: File) => void | Promise<void>

  promptDraft?: string
  imageUrl?: string | null
  imageSourceFile?: File | null
  uploadInputRef?: RefObject<HTMLInputElement | null>
  onPromptChange?: (value: string) => void
  onFilePicked?: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>
  onOpenImageEdit?: () => void
  onClearImage?: () => void

  contentBlocks?: PostReplyBlock[]
  draftText?: string
  editingTarget?: ComposerBlockEditTarget | null
  crudTarget?: ComposerBlockCrudTarget | null
  typedOverlay?: PostSolveOverlayState | null
  canvasOverlay?: PostSolveOverlayState | null
  typedLatex?: string
  typedChromeVisible?: boolean
  isMobile?: boolean
  viewerId?: string
  gradeLabel?: string | null
  roleProfile?: any
  imageSourceSheetOpen?: boolean
  cameraInputRef?: RefObject<HTMLInputElement | null>
  galleryInputRef?: RefObject<HTMLInputElement | null>
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  onDraftTextChange?: (value: string) => void
  onTypedLatexChange?: (value: string) => void
  onCloseBlockCrud?: () => void
  onOpenTyped?: () => void
  onOpenHandwritten?: () => void
  onOpenImagePicker?: () => void
  onImagePicked?: (event: ChangeEvent<HTMLInputElement>) => void
  onCloseImageSourceSheet?: () => void
  onOpenCameraPicker?: () => void
  onOpenGalleryPicker?: () => void
  onCanvasCancel?: () => void
  onCanvasSubmit?: (scene: PublicSolveScene) => void | Promise<void>
  onTypedClose?: () => void
  onSubmitTyped?: () => void | Promise<void>
  onTypedChromeVisibilityChange?: (visible: boolean) => void
  onEditBlock?: (block: PostReplyBlock, index: number) => void
  onDeleteBlock?: (blockId: string) => void
  onBeginBlockLongPress?: (event: React.PointerEvent, target: ComposerBlockCrudTarget) => void
  onMoveBlockLongPress?: (event: React.PointerEvent) => void
  onClearBlockLongPress?: () => void
  onOpenBlockCrudOptions?: (target: ComposerBlockCrudTarget) => void
}

function AudiencePicker({
  audienceDraft,
  onAudienceChange,
}: {
  audienceDraft: Audience
  onAudienceChange: (value: Audience) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-slate-700 hover:bg-slate-50"
        onClick={() => setOpen((current) => !current)}
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

      {open ? (
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
                setOpen(false)
              }}
            >
              <span className="text-slate-700">{label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ComposerBlockList({
  blocks,
  editingTarget,
  onEditBlock,
  onBeginBlockLongPress,
  onMoveBlockLongPress,
  onClearBlockLongPress,
  onOpenBlockCrudOptions,
}: {
  blocks: PostReplyBlock[]
  editingTarget: ComposerBlockEditTarget | null | undefined
  onEditBlock?: (block: PostReplyBlock, index: number) => void
  onBeginBlockLongPress?: (event: React.PointerEvent, target: ComposerBlockCrudTarget) => void
  onMoveBlockLongPress?: (event: React.PointerEvent) => void
  onClearBlockLongPress?: () => void
  onOpenBlockCrudOptions?: (target: ComposerBlockCrudTarget) => void
}) {
  const visibleBlocks = blocks.filter((block) => !(editingTarget?.type === 'text' && editingTarget.blockId === block.id))
  if (visibleBlocks.length === 0) return null

  return (
    <div className="mb-2 space-y-2">
      {visibleBlocks.map((block, index) => {
        const blockTarget: ComposerBlockCrudTarget = { block, index }
        const blockHandlers = {
          onPointerDown: (event: React.PointerEvent) => onBeginBlockLongPress?.(event, blockTarget),
          onPointerMove: onMoveBlockLongPress,
          onPointerUp: onClearBlockLongPress,
          onPointerCancel: onClearBlockLongPress,
          onPointerLeave: onClearBlockLongPress,
          onContextMenu: (event: React.MouseEvent) => {
            event.preventDefault()
            onOpenBlockCrudOptions?.(blockTarget)
          },
        }

        if (block.type === 'text') {
          return (
            <div
              key={block.id}
              role="button"
              tabIndex={0}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 whitespace-pre-wrap break-words text-slate-700"
              onClick={() => onEditBlock?.(block, index)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onEditBlock?.(block, index)
                }
              }}
              {...blockHandlers}
            >
              {block.text}
            </div>
          )
        }

        if (block.type === 'latex') {
          const latexHtml = renderKatexDisplayHtml(block.latex)
          return (
            <div
              key={block.id}
              role="button"
              tabIndex={0}
              className="overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800"
              onClick={() => onEditBlock?.(block, index)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onEditBlock?.(block, index)
                }
              }}
              {...blockHandlers}
            >
              {latexHtml ? (
                <div className="leading-relaxed" dangerouslySetInnerHTML={{ __html: latexHtml }} />
              ) : (
                <div className="text-sm leading-6 whitespace-pre-wrap break-words">{renderTextWithKatex(block.latex)}</div>
              )}
            </div>
          )
        }

        return (
          <div
            key={block.id}
            role="button"
            tabIndex={0}
            className={block.type === 'image' ? 'inline-flex max-w-full' : 'pt-1'}
            onClick={() => onEditBlock?.(block, index)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onEditBlock?.(block, index)
              }
            }}
            {...blockHandlers}
          >
            <PostComposerBlocksPreview blocks={[block]} compact />
          </div>
        )
      })}
    </div>
  )
}

export default function PostComposerOverlay(props: Props) {
  const {
    open,
    editingPostId,
    viewerName,
    viewerAvatarUrl,
    titleDraft,
    audienceDraft,
    maxAttempts,
    parseOnUpload,
    parsedJsonText,
    parsedOpen,
    uploading,
    posting,
    imageEditOpen,
    imageEditFile,
    onClose,
    onTitleChange,
    onAudienceChange,
    onMaxAttemptsChange,
    onParseOnUploadChange,
    onToggleParsedOpen,
    onSubmit,
    onCancelImageEdit,
    onConfirmImageEdit,
  } = props

  const usesUniversalComposer = Array.isArray(props.contentBlocks)
  const composedBlocks = useMemo(() => {
    if (!usesUniversalComposer) return []
    return composePostSolveBlocksWithDraftText(props.contentBlocks || [], String(props.draftText || ''), props.editingTarget || null)
  }, [props.contentBlocks, props.draftText, props.editingTarget, usesUniversalComposer])

  if (!open) return null

  const renderHeader = () => (
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
            <span className="text-sm text-[#1c1e21]">{usesUniversalComposer ? 'Composer' : 'Post'}</span>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-slate-600">
              <path d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.364-6.364-2.121 2.121M7.757 16.243l-2.121 2.121m12.728 0-2.121-2.121M7.757 7.757 5.636 5.636" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="text-xs text-slate-500">Max attempts</span>
            <select className="bg-transparent text-sm text-[#1c1e21] focus:outline-none" value={maxAttempts} onChange={(event) => onMaxAttemptsChange(event.target.value)}>
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
  )

  const renderUniversalComposer = () => {
    const iconButtonClassName = 'inline-flex h-10 items-center justify-center text-slate-700 transition hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50'

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
              {renderHeader()}

              <div className="flex min-h-0 flex-1 flex-col gap-0">
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-none border-t border-black/10 bg-white px-0 py-4 sm:px-1 sm:py-5">
                  <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
                    <div className="min-w-0 rounded-[24px] border border-slate-200 bg-white px-4 py-3 shadow-[0_12px_28px_rgba(15,23,42,0.08)]">
                      <ComposerBlockList
                        blocks={props.contentBlocks || []}
                        editingTarget={props.editingTarget}
                        onEditBlock={props.onEditBlock}
                        onBeginBlockLongPress={props.onBeginBlockLongPress}
                        onMoveBlockLongPress={props.onMoveBlockLongPress}
                        onClearBlockLongPress={props.onClearBlockLongPress}
                        onOpenBlockCrudOptions={props.onOpenBlockCrudOptions}
                      />

                      <textarea
                        ref={props.textareaRef}
                        value={String(props.draftText || '')}
                        onChange={(event) => props.onDraftTextChange?.(event.target.value)}
                        placeholder={`Post as ${viewerName}`}
                        rows={1}
                        className="max-h-28 min-h-[1.5rem] w-full resize-none bg-transparent text-sm leading-6 text-slate-700 outline-none placeholder:text-slate-400"
                        style={{ overflowY: 'hidden' }}
                      />
                    </div>
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
                  <button type="button" className={iconButtonClassName} onClick={props.onOpenTyped} disabled={posting} aria-label="Math input" title="Math input">
                    <span className="text-[1.18rem] font-semibold italic leading-none tracking-[-0.05em]" style={{ fontFamily: 'KaTeX_Main, Times New Roman, serif' }}>fx</span>
                  </button>
                  <button type="button" className={iconButtonClassName} onClick={props.onOpenHandwritten} disabled={posting} aria-label="Handwriting" title="Handwriting">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m4.5 19.5 4.2-.8 9.9-9.9a2.1 2.1 0 0 0 0-3l-.4-.4a2.1 2.1 0 0 0-3 0l-9.9 9.9-.8 4.2Z" />
                      <path d="m13.8 6.2 4 4" />
                      <path d="M4.5 19.5 8 16" />
                    </svg>
                  </button>
                  <button type="button" className={iconButtonClassName} onClick={props.onOpenImagePicker} disabled={posting || uploading} aria-label="Camera" title="Camera">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.3-1.7A2 2 0 0 1 10.9 3.5h2.2a2 2 0 0 1 1.6.8L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z" />
                      <circle cx="12" cy="12.5" r="3.5" />
                    </svg>
                  </button>
                  <label className="inline-flex select-none items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-sm text-slate-700">
                    <input type="checkbox" checked={parseOnUpload} onChange={(event) => onParseOnUploadChange(event.target.checked)} />
                    Parse
                  </label>
                  <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50" onClick={onToggleParsedOpen} disabled={!parsedJsonText} aria-label={parsedOpen ? 'Hide parsed content' : 'View parsed content'} title={parsedOpen ? 'Hide parsed' : 'View parsed'}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M8 5H6a2 2 0 0 0-2 2v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M16 5h2a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M8 19H6a2 2 0 0 1-2-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M16 19h2a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M9 9h6M9 12h6M9 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <AudiencePicker audienceDraft={audienceDraft} onAudienceChange={onAudienceChange} />
                  <button type="button" className="btn btn-primary" disabled={posting || uploading || composedBlocks.length === 0} onClick={() => void onSubmit()}>
                    {posting ? (editingPostId ? 'Saving...' : 'Posting...') : (editingPostId ? 'Save' : 'Post')}
                  </button>
                </div>
              </div>
            </div>
          </FullScreenGlassOverlay>
        </OverlayPortal>

        {props.crudTarget ? (
          <OverlayPortal>
            <BottomSheet open backdrop title="Block options" subtitle="Press and hold a composer block to edit or remove it" onClose={props.onCloseBlockCrud} zIndexClassName="z-[71]" className="bottom-0" sheetClassName="rounded-t-[28px] rounded-b-none border-x-0 border-b-0 border-t border-slate-200 bg-white shadow-[0_-18px_40px_rgba(15,23,42,0.14)]" contentClassName="px-4 pb-[calc(var(--app-safe-bottom)+1rem)] pt-2 sm:px-5 sm:pb-5">
              <div className="space-y-2">
                <button type="button" className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left text-slate-800 transition hover:border-slate-300 hover:bg-slate-100" onClick={() => props.onEditBlock?.(props.crudTarget!.block, props.crudTarget!.index)}>
                  <span>
                    <span className="block text-sm font-semibold">{props.crudTarget.block.type === 'image' ? 'Open image' : 'Edit block'}</span>
                    <span className="block text-xs text-slate-500">Return this composer item to its editor.</span>
                  </span>
                  <span className="text-slate-400">{`>`}</span>
                </button>
                <button type="button" className="flex w-full items-center justify-between rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-left text-red-700 transition hover:border-red-300 hover:bg-red-100" onClick={() => props.onDeleteBlock?.(props.crudTarget!.block.id)}>
                  <span>
                    <span className="block text-sm font-semibold">Delete block</span>
                    <span className="block text-xs text-red-500">Remove this item from your post draft.</span>
                  </span>
                  <span className="text-red-300">{`>`}</span>
                </button>
              </div>
            </BottomSheet>
          </OverlayPortal>
        ) : null}

        {props.imageSourceSheetOpen ? (
          <OverlayPortal>
            <BottomSheet open backdrop title="Add photo" subtitle="Choose how to attach your working" onClose={props.onCloseImageSourceSheet} zIndexClassName="z-[71]" className="bottom-0" sheetClassName="rounded-t-[28px] rounded-b-none border-x-0 border-b-0 border-t border-slate-200 bg-white shadow-[0_-18px_40px_rgba(15,23,42,0.14)]" contentClassName="px-4 pb-[calc(var(--app-safe-bottom)+1rem)] pt-2 sm:px-5 sm:pb-5">
              <div className="space-y-2">
                <button type="button" className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left text-slate-800 transition hover:border-slate-300 hover:bg-slate-100" onClick={props.onOpenCameraPicker} disabled={uploading}>
                  <span>
                    <span className="block text-sm font-semibold">Take photo</span>
                    <span className="block text-xs text-slate-500">Open the camera and shoot your paper working.</span>
                  </span>
                  <span className="text-slate-400">{`>`}</span>
                </button>
                <button type="button" className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left text-slate-800 transition hover:border-slate-300 hover:bg-slate-100" onClick={props.onOpenGalleryPicker} disabled={uploading}>
                  <span>
                    <span className="block text-sm font-semibold">Choose from gallery</span>
                    <span className="block text-xs text-slate-500">Pick an existing photo or screenshot from your device.</span>
                  </span>
                  <span className="text-slate-400">{`>`}</span>
                </button>
              </div>
            </BottomSheet>
          </OverlayPortal>
        ) : null}

        <ImageCropperModal open={imageEditOpen} file={imageEditFile} title="Add post photo" onCancel={onCancelImageEdit} onUseOriginal={onConfirmImageEdit} onConfirm={onConfirmImageEdit} confirmLabel="Add" />

        {props.cameraInputRef ? <input ref={props.cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={props.onImagePicked} /> : null}
        {props.galleryInputRef ? <input ref={props.galleryInputRef} type="file" accept="image/*" className="hidden" onChange={props.onImagePicked} /> : null}

        {props.canvasOverlay ? (
          <OverlayPortal>
            <div className="fixed inset-0 z-[72] bg-[rgba(2,6,23,0.58)] backdrop-blur-sm p-0" role="dialog" aria-modal="true" aria-label="Post composer canvas">
              <div className="mx-auto flex h-full w-full max-w-none flex-col overflow-hidden rounded-none border-0 bg-white shadow-none">
                <PublicSolveComposer
                  title={props.canvasOverlay.title}
                  prompt={props.canvasOverlay.prompt}
                  imageUrl={props.canvasOverlay.imageUrl || null}
                  referenceBody={props.canvasOverlay.postContentBlocks?.length ? <PostComposerBlocksPreview blocks={props.canvasOverlay.postContentBlocks} /> : undefined}
                  authorName={props.canvasOverlay.authorName || null}
                  authorAvatarUrl={props.canvasOverlay.authorAvatarUrl || null}
                  initialScene={props.canvasOverlay.initialScene || null}
                  cancelLabel="Cancel"
                  submitLabel="Finish"
                  submitting={posting}
                  fullscreenCanvas
                  hideMainMenu
                  referencePresentation="background"
                  onCancel={props.onCanvasCancel}
                  onSubmit={(scene) => props.onCanvasSubmit?.(scene)}
                />
              </div>
            </div>
          </OverlayPortal>
        ) : null}

        {props.typedOverlay ? (
          <OverlayPortal>
            <div className="fixed inset-0 z-[72] bg-[rgba(2,6,23,0.7)] backdrop-blur-sm p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Typed post content">
              {(() => {
                const typedActionsVisible = !props.isMobile || props.typedChromeVisible
                return (
                  <div className="relative mx-auto flex h-full w-full max-w-none sm:max-w-7xl flex-col overflow-hidden rounded-none sm:rounded-[32px] border-0 sm:border sm:border-white/15 bg-transparent sm:bg-[#030712] shadow-none sm:shadow-[0_30px_80px_rgba(2,6,23,0.36)]">
                    <div className={`pointer-events-none absolute inset-0 z-[5] live-window--canvas ${typedActionsVisible ? 'live-window--chrome-visible' : ''}`}>
                      <div className="live-window__header" style={{ top: 'calc(10px + max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px)))', left: 'calc(12px + max(var(--app-safe-left, 0px), env(safe-area-inset-left, 0px)))', right: 'calc(12px + max(var(--app-safe-right, 0px), env(safe-area-inset-right, 0px)))' }}>
                        <button type="button" className="pointer-events-auto rounded-full border border-white/15 bg-white/6 px-3 py-1.5 text-[0.85rem] font-semibold leading-none text-white transition hover:bg-white/10 disabled:opacity-50" onClick={() => void props.onSubmitTyped?.()} disabled={posting || !String(props.typedLatex || '').trim()}>
                          Add to post
                        </button>
                        <div className="live-window__header-controls pointer-events-auto">
                          <button type="button" title="Close typed response" aria-label="Close typed response" onClick={props.onTypedClose}>
                            ×
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1">
                      <PublicSolveOpacityWorkspace
                        title={props.typedOverlay.title || 'Post'}
                        prompt={props.typedOverlay.prompt || ''}
                        imageUrl={props.typedOverlay.imageUrl || null}
                        referenceBody={props.typedOverlay.postContentBlocks?.length ? <PostComposerBlocksPreview blocks={props.typedOverlay.postContentBlocks} /> : undefined}
                        authorName={props.typedOverlay.authorName || null}
                        authorAvatarUrl={props.typedOverlay.authorAvatarUrl || null}
                        referencePresentation="background"
                        resetKey={props.typedOverlay.postId}
                        outerClassName="bg-transparent"
                        contentPaddingClassName="relative flex-1 min-h-0 px-0 py-0 sm:px-6 sm:py-4"
                        frameClassName="relative flex h-full min-h-0 flex-col overflow-hidden rounded-none sm:rounded-[28px] border-0 sm:border sm:border-white/10 bg-white shadow-none sm:shadow-[0_22px_60px_rgba(2,6,23,0.24)]"
                        canvasSurfaceClassName="flex h-full min-h-0 flex-col bg-white"
                      >
                        <div className="h-full min-h-0 bg-white">
                          <StackedCanvasWindow
                            isVisible
                            gradeLabel={props.gradeLabel || null}
                            roomId={`post-compose:${props.typedOverlay.postId}:${props.viewerId || 'anon'}`}
                            userId={props.viewerId || 'anon'}
                            userDisplayName={viewerName}
                            canOrchestrateLesson={false}
                            roleProfile={props.roleProfile}
                            forceEditable
                            compactEdgeToEdge
                            onOverlayChromeVisibilityChange={props.onTypedChromeVisibilityChange}
                            initialComposedLatex={props.typedOverlay.initialLatex || ''}
                            initialRecognitionEngine={props.typedOverlay.preferredRecognitionEngine || 'keyboard'}
                            onComposedLatexChange={props.onTypedLatexChange}
                          />
                        </div>
                      </PublicSolveOpacityWorkspace>
                    </div>
                  </div>
                )
              })()}
            </div>
          </OverlayPortal>
        ) : null}
      </>
    )
  }

  return (
    <>
      {usesUniversalComposer ? renderUniversalComposer() : (
        <>
          <OverlayPortal>
            <FullScreenGlassOverlay title="Post" onClose={onClose} onBackdropClick={onClose} zIndexClassName="z-[70]" variant="light" panelSize="full" position="absolute" forceHeaderSafeTop frameClassName="absolute inset-0 flex items-stretch justify-center p-0" panelClassName="!h-full !max-h-none !max-w-none !rounded-none border-none bg-white" className="[&>.philani-overlay-backdrop]:!bg-white [&>.philani-overlay-backdrop]:!backdrop-blur-none" contentClassName="flex flex-col overflow-hidden p-0">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white p-0 text-[#1c1e21]">
                <input ref={props.uploadInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => void props.onFilePicked?.(event)} />
                {renderHeader()}
                <div className="flex min-h-0 flex-1 flex-col gap-0">
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-none border-t border-black/10 bg-white px-0 py-4 sm:px-1 sm:py-5">
                    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
                      <textarea className="min-h-[160px] w-full resize-none bg-transparent text-[15px] leading-relaxed text-[#1c1e21] placeholder:text-slate-500 focus:outline-none" placeholder="Share what you are working on, stuck on, or proud of... or attach a screenshot below" value={props.promptDraft || ''} onChange={(event) => props.onPromptChange?.(event.target.value)} />
                      {props.imageUrl ? (
                        <div className="w-full cursor-pointer" role="button" tabIndex={0} onClick={props.onOpenImageEdit} onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          props.onOpenImageEdit?.()
                        }} aria-label="Edit uploaded screenshot" title={props.imageSourceFile ? 'Edit screenshot' : 'Screenshot'}>
                          <img src={props.imageUrl} alt="Uploaded" className="max-h-[260px] w-full rounded-lg object-contain" />
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {parsedOpen && parsedJsonText ? <div className="rounded-none border-t border-black/10 bg-[#eef2f7] px-0 py-3 sm:px-1 sm:py-4"><pre className="whitespace-pre-wrap text-xs text-slate-700">{parsedJsonText}</pre></div> : null}
                </div>
                <div className="flex min-w-0 items-center justify-between gap-3 border-t border-black/10 bg-white px-0 py-3 sm:px-1 sm:py-4">
                  <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
                    <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50" onClick={() => props.uploadInputRef?.current?.click()} disabled={uploading} aria-label={uploading ? 'Uploading screenshot' : 'Upload screenshot'} title={uploading ? 'Uploading...' : 'Upload screenshot'}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7a2 2 0 0 1 2-2h2l1-1h6l1 1h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="2" /><path d="M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="2" /></svg>
                    </button>
                    <label className="inline-flex select-none items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-sm text-slate-700"><input type="checkbox" checked={parseOnUpload} onChange={(event) => onParseOnUploadChange(event.target.checked)} />Parse</label>
                    <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50" onClick={onToggleParsedOpen} disabled={!parsedJsonText} aria-label={parsedOpen ? 'Hide parsed content' : 'View parsed content'} title={parsedOpen ? 'Hide parsed' : 'View parsed'}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 5H6a2 2 0 0 0-2 2v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M16 5h2a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M8 19H6a2 2 0 0 1-2-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M16 19h2a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M9 9h6M9 12h6M9 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                    </button>
                    <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50" onClick={props.onClearImage} disabled={!props.imageUrl || uploading} aria-label="Clear screenshot" title="Clear screenshot">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 6h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M8 6V4h8v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M7 6l1 16h8l1-16" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
                    </button>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <AudiencePicker audienceDraft={audienceDraft} onAudienceChange={onAudienceChange} />
                    <button type="button" className="btn btn-primary" disabled={posting || uploading} onClick={() => void onSubmit()}>{posting ? (editingPostId ? 'Saving...' : 'Posting...') : (editingPostId ? 'Save' : 'Post')}</button>
                  </div>
                </div>
              </div>
            </FullScreenGlassOverlay>
          </OverlayPortal>

          <ImageCropperModal open={imageEditOpen} file={imageEditFile} title="Edit screenshot" onCancel={onCancelImageEdit} onUseOriginal={onConfirmImageEdit} onConfirm={onConfirmImageEdit} confirmLabel="Upload" />
        </>
      )}
    </>
  )
}
