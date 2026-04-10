import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import BottomSheet from './BottomSheet'
import PostComposerBlocksPreview from './PostComposerBlocksPreview'
import { PublicSolveCanvasViewer, PublicSolveComposer, PublicSolveOpacityWorkspace, type PublicSolveScene } from './PublicSolveCanvas'
import type { ComposerBlockCrudTarget, ComposerBlockEditTarget, PostReplyBlock, PostSolveOverlayState } from '../lib/postReplyComposer'
import { composePostSolveBlocksWithDraftText } from '../lib/postReplyComposer'
import { renderKatexDisplayHtml } from '../lib/latexRender'
import { renderTextWithKatex } from '../lib/renderTextWithKatex'
import useViewportBottomOffset from '../lib/useViewportBottomOffset'

const StackedCanvasWindow = dynamic(() => import('./StackedCanvasWindow'), { ssr: false })
const ImageCropperModal = dynamic(() => import('./ImageCropperModal'), { ssr: false })

const OverlayPortal = ({ children }: { children: React.ReactNode }) => {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted || typeof document === 'undefined') return null
  return createPortal(children, document.body)
}

type Props = {
  modeOverlay: PostSolveOverlayState | null
  canvasOverlay: PostSolveOverlayState | null
  typedOverlay: PostSolveOverlayState | null
  blocks: PostReplyBlock[]
  draftText: string
  editingTarget: ComposerBlockEditTarget | null
  crudTarget: ComposerBlockCrudTarget | null
  typedLatex: string
  typedChromeVisible: boolean
  isMobile: boolean
  viewerId: string
  viewerName: string
  gradeLabel?: string | null
  roleProfile: any
  submitting: boolean
  imageUploading: boolean
  imageSourceSheetOpen: boolean
  imageEditOpen: boolean
  imageEditFile: File | null
  error: string | null
  cameraInputRef: React.RefObject<HTMLInputElement | null>
  galleryInputRef: React.RefObject<HTMLInputElement | null>
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  onDraftTextChange: (value: string) => void
  onTypedLatexChange: (value: string) => void
  onCloseModeOverlay: () => void
  onCloseBlockCrud: () => void
  onOpenTyped: () => void
  onOpenHandwritten: () => void
  onOpenImagePicker: () => void
  onSubmitText: () => void
  onImagePicked: (event: React.ChangeEvent<HTMLInputElement>) => void
  onCloseImageSourceSheet: () => void
  onOpenCameraPicker: () => void
  onOpenGalleryPicker: () => void
  onCancelImageEdit: () => void
  onConfirmImageEdit: (file: File) => void
  onCanvasCancel: () => void
  onCanvasSubmit: (scene: PublicSolveScene) => void
  onTypedClose: () => void
  onSubmitTyped: () => void
  onTypedChromeVisibilityChange: (visible: boolean) => void
  onEditBlock: (block: PostReplyBlock, index: number) => void
  onDeleteBlock: (blockId: string) => void
  onBeginBlockLongPress: (event: React.PointerEvent, target: ComposerBlockCrudTarget) => void
  onMoveBlockLongPress: (event: React.PointerEvent) => void
  onClearBlockLongPress: () => void
  onOpenBlockCrudOptions: (target: ComposerBlockCrudTarget) => void
}

export default function PostReplyComposerOverlays({
  modeOverlay,
  canvasOverlay,
  typedOverlay,
  blocks,
  draftText,
  editingTarget,
  crudTarget,
  typedLatex,
  typedChromeVisible,
  isMobile,
  viewerId,
  viewerName,
  gradeLabel,
  roleProfile,
  submitting,
  imageUploading,
  imageSourceSheetOpen,
  imageEditOpen,
  imageEditFile,
  error,
  cameraInputRef,
  galleryInputRef,
  textareaRef,
  onDraftTextChange,
  onTypedLatexChange,
  onCloseModeOverlay,
  onCloseBlockCrud,
  onOpenTyped,
  onOpenHandwritten,
  onOpenImagePicker,
  onSubmitText,
  onImagePicked,
  onCloseImageSourceSheet,
  onOpenCameraPicker,
  onOpenGalleryPicker,
  onCancelImageEdit,
  onConfirmImageEdit,
  onCanvasCancel,
  onCanvasSubmit,
  onTypedClose,
  onSubmitTyped,
  onTypedChromeVisibilityChange,
  onEditBlock,
  onDeleteBlock,
  onBeginBlockLongPress,
  onMoveBlockLongPress,
  onClearBlockLongPress,
  onOpenBlockCrudOptions,
}: Props) {
  const viewportBottomOffsetPx = useViewportBottomOffset({ requireEditableFocus: true })
  const replyActionButtonClassName = 'philani-gradient-outline [--philani-outline-fill:#ffffff] inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-700 transition hover:-translate-y-[1px] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50'
  const replyFxClassName = 'philani-gradient-text text-[1.18rem] font-semibold italic leading-none tracking-[-0.05em] drop-shadow-[0_6px_10px_rgba(14,165,233,0.16)]'

  return (
    <>
      {crudTarget ? (
        <OverlayPortal>
          <BottomSheet
            open
            backdrop
            title="Block options"
            subtitle="Press and hold a reply block to edit or remove it"
            onClose={onCloseBlockCrud}
            zIndexClassName="z-[69]"
            className="bottom-0"
            sheetClassName="rounded-t-[28px] rounded-b-none border-x-0 border-b-0 border-t border-slate-200 bg-[linear-gradient(180deg,#fbfcff_0%,#f0f6ff_100%)] shadow-[0_-18px_40px_rgba(15,23,42,0.14)]"
            contentClassName="px-4 pb-[calc(var(--app-safe-bottom)+1rem)] pt-2 sm:px-5 sm:pb-5"
          >
            <div className="space-y-2">
              <button
                type="button"
                className="philani-gradient-outline-soft [--philani-outline-fill:#f8fafc] flex w-full items-center justify-between rounded-2xl px-4 py-4 text-left text-slate-800 transition hover:brightness-[1.02]"
                onClick={() => onEditBlock(crudTarget.block, crudTarget.index)}
              >
                <span>
                  <span className="block text-sm font-semibold">{crudTarget.block.type === 'image' ? 'Open image' : 'Edit block'}</span>
                  <span className="block text-xs text-slate-500">
                    {crudTarget.block.type === 'text'
                      ? 'Load this text back into the composer for editing.'
                      : crudTarget.block.type === 'latex'
                        ? 'Reopen this math block in the keyboard editor.'
                        : crudTarget.block.type === 'canvas'
                          ? 'Reopen this handwritten block in the solve canvas.'
                          : 'Open this image in the zoomable viewer.'}
                  </span>
                </span>
                <span className="text-slate-400">{`>`}</span>
              </button>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-left text-rose-700 transition hover:border-rose-300 hover:bg-rose-100"
                onClick={() => onDeleteBlock(crudTarget.block.id)}
              >
                <span>
                  <span className="block text-sm font-semibold">Delete block</span>
                  <span className="block text-xs text-rose-500">Remove this item from your reply draft.</span>
                </span>
                <span className="text-rose-300">{`>`}</span>
              </button>
            </div>
          </BottomSheet>
        </OverlayPortal>
      ) : null}

      {modeOverlay ? (
        <OverlayPortal>
          <BottomSheet
            open
            backdrop
            title="Post reply composer"
            hideHeader
            edgeToEdge
            onClose={onCloseModeOverlay}
            zIndexClassName="z-[68]"
            className="bottom-0"
            sheetClassName="rounded-t-[32px] rounded-b-none border-x-0 border-b-0 border-t border-slate-200 bg-[linear-gradient(180deg,#fbfcff_0%,#f0f6ff_100%)] shadow-[0_-18px_40px_rgba(15,23,42,0.14)]"
            contentClassName="flex max-h-[min(32rem,68dvh)] flex-col overflow-hidden px-4 pt-3 sm:max-h-[min(36rem,72dvh)] sm:px-5 sm:pt-4"
          >
            {(() => {
              const composerVisibleBlocks = blocks.filter((block) => !(editingTarget?.type === 'text' && editingTarget.blockId === block.id))
              const canSubmitReply = composePostSolveBlocksWithDraftText(blocks, draftText, editingTarget).length > 0

              return (
                <div className="flex min-h-0 flex-col">
                  {submitting ? (
                    <div className="flex justify-end px-1 pb-4">
                      <span className="text-[11px] font-medium text-slate-500">Sending...</span>
                    </div>
                  ) : imageUploading ? (
                    <div className="flex justify-end px-1 pb-4">
                      <span className="text-[11px] font-medium text-slate-500">Uploading image...</span>
                    </div>
                  ) : null}

                  <div className="min-h-0 overflow-y-auto overscroll-contain pb-4">
                    <div className="philani-gradient-outline-soft [--philani-outline-fill:#ffffff] min-w-0 rounded-[28px] px-4 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.08)]">
                      {composerVisibleBlocks.length > 0 ? (
                        <div className="mb-2 space-y-2">
                          {composerVisibleBlocks.map((block, index) => {
                            const blockTarget: ComposerBlockCrudTarget = { block, index }
                            const blockHandlers = {
                              onPointerDown: (event: React.PointerEvent) => onBeginBlockLongPress(event, blockTarget),
                              onPointerMove: onMoveBlockLongPress,
                              onPointerUp: onClearBlockLongPress,
                              onPointerCancel: onClearBlockLongPress,
                              onPointerLeave: onClearBlockLongPress,
                              onContextMenu: (event: React.MouseEvent) => {
                                event.preventDefault()
                                onOpenBlockCrudOptions(blockTarget)
                              },
                            }

                            if (block.type === 'text') {
                              return (
                                <div
                                  key={block.id}
                                  role="button"
                                  tabIndex={0}
                                  className="philani-gradient-outline-soft [--philani-outline-fill:#f8fafc] rounded-2xl px-3 py-2 text-sm leading-6 whitespace-pre-wrap break-words text-slate-700"
                                  onClick={() => onEditBlock(block, index)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                      event.preventDefault()
                                      onEditBlock(block, index)
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
                                  className="philani-gradient-outline-soft [--philani-outline-fill:#f8fafc] overflow-x-auto rounded-2xl px-3 py-2 text-slate-800"
                                  onClick={() => onEditBlock(block, index)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                      event.preventDefault()
                                      onEditBlock(block, index)
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

                            if (block.type === 'canvas') {
                              return (
                                <div
                                  key={block.id}
                                  role="button"
                                  tabIndex={0}
                                  className="pt-1"
                                  onClick={() => onEditBlock(block, index)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                      event.preventDefault()
                                      onEditBlock(block, index)
                                    }
                                  }}
                                  {...blockHandlers}
                                >
                                  <div className="philani-gradient-outline-soft [--philani-outline-fill:#ffffff] overflow-hidden rounded-[24px] p-1 shadow-sm">
                                    <PublicSolveCanvasViewer scene={block.scene} className="pointer-events-none" viewerHeightPx={220} />
                                  </div>
                                </div>
                              )
                            }

                            return (
                              <div
                                key={block.id}
                                role="button"
                                tabIndex={0}
                                className="inline-flex max-w-full"
                                onClick={() => onEditBlock(block, index)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    onEditBlock(block, index)
                                  }
                                }}
                                {...blockHandlers}
                              >
                                <div className="philani-gradient-outline-soft [--philani-outline-fill:#ffffff] relative inline-flex overflow-hidden rounded-[24px] p-1 shadow-sm">
                                  <img src={block.imageUrl} alt="Reply attachment" className="h-24 w-24 rounded-[18px] object-cover sm:h-28 sm:w-28" />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : null}
                      <textarea
                        ref={textareaRef}
                        value={draftText}
                        onChange={(event) => onDraftTextChange(event.target.value)}
                        placeholder={`Comment as ${viewerName}`}
                        rows={1}
                        className="max-h-28 min-h-[1.5rem] w-full resize-none bg-transparent text-[15px] leading-relaxed text-[#1c1e21] outline-none placeholder:text-slate-400"
                        style={{ overflowY: 'hidden' }}
                      />
                    </div>
                  </div>

                  <div
                    className="philani-gradient-divider-top shrink-0 -mx-4 mt-auto bg-white/95 px-5 pb-[calc(var(--app-safe-bottom)+0.75rem)] pt-3 backdrop-blur-xl transition-[padding-bottom] duration-150 sm:-mx-5 sm:px-6 sm:pb-5"
                    style={viewportBottomOffsetPx > 0
                      ? {
                          paddingBottom: `calc(max(var(--app-safe-bottom, 0px), env(safe-area-inset-bottom, 0px)) + ${viewportBottomOffsetPx}px + 0.75rem)`,
                        }
                      : undefined}
                  >
                    <div className="flex items-center justify-between gap-3 px-1">
                      <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
                        <button type="button" className={replyActionButtonClassName} onClick={onOpenTyped} disabled={submitting} aria-label="Math input" title="Math input">
                          <span className={replyFxClassName} style={{ fontFamily: 'KaTeX_Main, Times New Roman, serif' }}>fx</span>
                        </button>
                        <button type="button" className={replyActionButtonClassName} onClick={onOpenHandwritten} disabled={submitting} aria-label="Handwriting" title="Handwriting">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="m4.5 19.5 4.2-.8 9.9-9.9a2.1 2.1 0 0 0 0-3l-.4-.4a2.1 2.1 0 0 0-3 0l-9.9 9.9-.8 4.2Z" />
                            <path d="m13.8 6.2 4 4" />
                            <path d="M4.5 19.5 8 16" />
                          </svg>
                        </button>
                        <button type="button" className={replyActionButtonClassName} onClick={onOpenImagePicker} disabled={submitting || imageUploading} aria-label="Camera" title="Camera">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.3-1.7A2 2 0 0 1 10.9 3.5h2.2a2 2 0 0 1 1.6.8L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z" />
                            <circle cx="12" cy="12.5" r="3.5" />
                          </svg>
                        </button>
                      </div>
                      <button
                        type="button"
                        className="philani-gradient-outline [--philani-outline-fill:#ffffff] inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-slate-700 transition hover:-translate-y-[1px] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={onSubmitText}
                        disabled={submitting || imageUploading || !canSubmitReply}
                        aria-label="Send reply"
                        title="Send reply"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M21 3 10 14" />
                          <path d="m21 3-7 18-4-7-7-4 18-7Z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              )
            })()}
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onImagePicked} />
            <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={onImagePicked} />
          </BottomSheet>
        </OverlayPortal>
      ) : null}

      {modeOverlay && imageSourceSheetOpen ? (
        <OverlayPortal>
          <BottomSheet
            open
            backdrop
            title="Add photo"
            onClose={onCloseImageSourceSheet}
            zIndexClassName="z-[69]"
            className="bottom-0"
            sheetClassName="rounded-t-[28px] rounded-b-none border-x-0 border-b-0 border-t border-slate-200 bg-[linear-gradient(180deg,#fbfcff_0%,#f0f6ff_100%)] shadow-[0_-18px_40px_rgba(15,23,42,0.14)]"
            contentClassName="px-4 pb-[calc(var(--app-safe-bottom)+1rem)] pt-2 sm:px-5 sm:pb-5"
          >
            <div className="space-y-2">
              <button type="button" className="philani-gradient-outline-soft [--philani-outline-fill:#f8fafc] flex w-full items-center justify-between rounded-2xl px-4 py-4 text-left text-slate-800 transition hover:brightness-[1.02]" onClick={onOpenCameraPicker} disabled={imageUploading}>
                <span className="block text-sm font-semibold">Take photo</span>
                <span className="philani-gradient-icon flex h-10 w-10 items-center justify-center rounded-full text-slate-600" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.3-1.7A2 2 0 0 1 10.9 3.5h2.2a2 2 0 0 1 1.6.8L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z" />
                    <circle cx="12" cy="12.5" r="3.5" />
                  </svg>
                </span>
              </button>
              <button type="button" className="philani-gradient-outline-soft [--philani-outline-fill:#f8fafc] flex w-full items-center justify-between rounded-2xl px-4 py-4 text-left text-slate-800 transition hover:brightness-[1.02]" onClick={onOpenGalleryPicker} disabled={imageUploading}>
                <span className="block text-sm font-semibold">Choose from gallery</span>
                <span className="philani-gradient-icon flex h-10 w-10 items-center justify-center rounded-full text-slate-600" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <circle cx="8.5" cy="10" r="1.5" />
                    <path d="m21 15-4.5-4.5L11 16l-2.5-2.5L3 19" />
                  </svg>
                </span>
              </button>
            </div>
          </BottomSheet>
        </OverlayPortal>
      ) : null}

      {modeOverlay ? (
        <OverlayPortal>
          <ImageCropperModal open={imageEditOpen} file={imageEditFile} title="Add reply photo" onCancel={onCancelImageEdit} onUseOriginal={onConfirmImageEdit} onConfirm={onConfirmImageEdit} confirmLabel="Add" />
        </OverlayPortal>
      ) : null}

      {canvasOverlay ? (
        <OverlayPortal>
          <div className="fixed inset-0 z-[68] bg-[rgba(2,6,23,0.58)] backdrop-blur-sm p-0" role="dialog" aria-modal="true" aria-label="Post solve canvas">
            <div className="mx-auto flex h-full w-full max-w-none flex-col overflow-hidden rounded-none border-0 bg-white shadow-none">
              <PublicSolveComposer
                title={canvasOverlay.title}
                prompt={canvasOverlay.prompt}
                imageUrl={canvasOverlay.imageUrl || null}
                authorName={canvasOverlay.authorName || null}
                authorAvatarUrl={canvasOverlay.authorAvatarUrl || null}
                referenceBody={canvasOverlay.postContentBlocks?.length ? <PostComposerBlocksPreview blocks={canvasOverlay.postContentBlocks} /> : undefined}
                initialScene={canvasOverlay.initialScene || null}
                cancelLabel="Cancel"
                submitLabel="Finish"
                submitting={submitting}
                fullscreenCanvas
                hideMainMenu
                referencePresentation="background"
                onCancel={onCanvasCancel}
                onSubmit={onCanvasSubmit}
              />
            </div>
            {error ? (
              <div className="pointer-events-none absolute left-4 right-4 top-4 z-[69] mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50/95 px-4 py-3 text-sm font-medium text-red-700 shadow-[0_18px_40px_rgba(220,38,38,0.12)] backdrop-blur-xl">
                {error}
              </div>
            ) : null}
          </div>
        </OverlayPortal>
      ) : null}

      {typedOverlay ? (
        <OverlayPortal>
          <div className="fixed inset-0 z-[68] bg-[rgba(2,6,23,0.7)] backdrop-blur-sm p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Typed post response">
            {(() => {
              const typedPostActionsVisible = !isMobile || typedChromeVisible
              return (
                <div className="relative mx-auto flex h-full w-full max-w-none sm:max-w-7xl flex-col overflow-hidden rounded-none sm:rounded-[32px] border-0 sm:border sm:border-white/15 bg-transparent sm:bg-[#030712] shadow-none sm:shadow-[0_30px_80px_rgba(2,6,23,0.36)]">
                  <div className={`pointer-events-none absolute inset-0 z-[5] live-window--canvas ${typedPostActionsVisible ? 'live-window--chrome-visible' : ''}`}>
                    <div className="live-window__header" style={{ top: 'calc(10px + max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px)))', left: 'calc(12px + max(var(--app-safe-left, 0px), env(safe-area-inset-left, 0px)))', right: 'calc(12px + max(var(--app-safe-right, 0px), env(safe-area-inset-right, 0px)))' }}>
                      <button type="button" className="pointer-events-auto rounded-full border border-white/15 bg-white/6 px-3 py-1.5 text-[0.85rem] font-semibold leading-none text-white transition hover:bg-white/10 disabled:opacity-50" onClick={onSubmitTyped} disabled={submitting || !String(typedLatex || '').trim()}>
                        Add to reply
                      </button>
                      <div className="live-window__header-controls pointer-events-auto">
                        <button type="button" title="Close typed response" aria-label="Close typed response" onClick={onTypedClose}>
                          ×
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1">
                    <PublicSolveOpacityWorkspace
                      title={typedOverlay.title || 'Post'}
                      prompt={typedOverlay.prompt || ''}
                      imageUrl={typedOverlay.imageUrl || null}
                      authorName={typedOverlay.authorName || null}
                      authorAvatarUrl={typedOverlay.authorAvatarUrl || null}
                      referenceBody={typedOverlay.postContentBlocks?.length ? <PostComposerBlocksPreview blocks={typedOverlay.postContentBlocks} /> : undefined}
                      referencePresentation="background"
                      resetKey={typedOverlay.postId}
                      outerClassName="bg-transparent"
                      contentPaddingClassName="relative flex-1 min-h-0 px-0 py-0 sm:px-6 sm:py-4"
                      frameClassName="relative flex h-full min-h-0 flex-col overflow-hidden rounded-none sm:rounded-[28px] border-0 sm:border sm:border-white/10 bg-white shadow-none sm:shadow-[0_22px_60px_rgba(2,6,23,0.24)]"
                      canvasSurfaceClassName="flex h-full min-h-0 flex-col bg-white"
                    >
                      <div className="h-full min-h-0 bg-white">
                        <StackedCanvasWindow
                          isVisible
                          gradeLabel={gradeLabel || null}
                          roomId={`post-compose:${typedOverlay.postId}:${viewerId || 'anon'}`}
                          userId={viewerId || 'anon'}
                          userDisplayName={viewerName}
                          canOrchestrateLesson={false}
                          roleProfile={roleProfile}
                          forceEditable
                          compactEdgeToEdge
                          onOverlayChromeVisibilityChange={onTypedChromeVisibilityChange}
                          initialComposedLatex={typedOverlay.initialLatex || ''}
                          initialRecognitionEngine={typedOverlay.preferredRecognitionEngine || 'keyboard'}
                          onComposedLatexChange={onTypedLatexChange}
                        />
                      </div>
                    </PublicSolveOpacityWorkspace>
                  </div>
                </div>
              )
            })()}
            {error ? (
              <div className="pointer-events-none absolute left-4 right-4 top-4 z-[69] mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50/95 px-4 py-3 text-sm font-medium text-red-700 shadow-[0_18px_40px_rgba(220,38,38,0.12)] backdrop-blur-xl">
                {error}
              </div>
            ) : null}
          </div>
        </OverlayPortal>
      ) : null}
    </>
  )
}