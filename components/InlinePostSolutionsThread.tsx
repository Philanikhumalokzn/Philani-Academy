import React from 'react'
import UserLink from './UserLink'
import { PublicSolveCanvasViewer, type PublicSolveScene } from './PublicSolveCanvas'
import { normalizePostReplyBlocks } from '../lib/postReplyComposer'
import { renderKatexDisplayHtml } from '../lib/latexRender'
import { renderTextWithKatex } from '../lib/renderTextWithKatex'

type ResponseRenderArgs = {
  responseId: string
  responseUserId: string
  responseUserName: string
  responseAvatar: string
  isMine: boolean
}

type Props = {
  loading: boolean
  error: string | null
  responses: any[]
  currentUserId: string
  threadUnlocked?: boolean
  lockedMessage?: string
  noSolutionsMessage?: string
  noContentMessage?: string
  getContainerProps?: (response: any, args: ResponseRenderArgs) => React.HTMLAttributes<HTMLDivElement>
  renderResponseStatus?: (response: any, args: ResponseRenderArgs) => React.ReactNode
  renderResponseFooter?: (response: any, args: ResponseRenderArgs) => React.ReactNode
  renderTextBlock?: (text: string, key: string) => React.ReactNode
  onOpenImageBlock?: (imageUrl: string, args: ResponseRenderArgs) => void
  onCanvasViewportChange?: (response: any, responseId: string, scene: PublicSolveScene) => void
}

export default function InlinePostSolutionsThread({
  loading,
  error,
  responses,
  currentUserId,
  threadUnlocked = true,
  lockedMessage = 'Submit your own solution first, then this thread will expand with your solution pinned on top and everyone else below.',
  noSolutionsMessage = 'No solutions yet.',
  noContentMessage = 'No solution content.',
  getContainerProps,
  renderResponseStatus,
  renderResponseFooter,
  renderTextBlock,
  onOpenImageBlock,
  onCanvasViewportChange,
}: Props) {
  const replyCardClassName = 'philani-gradient-outline-soft [--philani-outline-fill:#ffffff] rounded-[28px] px-4 py-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)] sm:px-5'

  return (
    <div className="mt-1 pt-1">
      {loading ? <div className="text-sm text-[#65676b]">Loading solutions...</div> : null}
      {!loading && error ? <div className="text-sm text-red-500">{error}</div> : null}
      {!loading && !error && !threadUnlocked ? (
        <div className="philani-gradient-outline-soft [--philani-outline-fill:#f8fafc] rounded-2xl px-4 py-3 text-sm text-slate-500">{lockedMessage}</div>
      ) : null}
      {!loading && !error && threadUnlocked && responses.length === 0 ? (
        <div className="philani-gradient-outline-soft [--philani-outline-fill:#f8fafc] rounded-2xl px-4 py-3 text-sm text-slate-500">{noSolutionsMessage}</div>
      ) : null}
      {!loading && !error && threadUnlocked && responses.length > 0 ? (
        <div className="space-y-4">
          {responses.map((response: any, idx: number) => {
            const responseId = String(response?.id || idx)
            const responseUserId = String(response?.userId || response?.user?.id || '')
            const responseUserName = String(response?.user?.name || response?.userName || response?.user?.email || 'Learner')
            const responseAvatar = String(response?.user?.avatar || response?.userAvatar || '').trim()
            const isMine = responseUserId === currentUserId
            const args: ResponseRenderArgs = { responseId, responseUserId, responseUserName, responseAvatar, isMine }
            const containerProps = getContainerProps?.(response, args) || {}
            const postReplyBlocks = normalizePostReplyBlocks(response)
            const fallbackStudentText = String(response?.studentText || '').trim()
            const fallbackLatex = String(response?.latex || '').trim()
            const fallbackLatexHtml = fallbackLatex ? renderKatexDisplayHtml(fallbackLatex) : ''

            return (
              <div key={responseId} className="py-1" {...containerProps}>
                <div className={replyCardClassName}>
                  <div className="flex items-start gap-3">
                    <UserLink userId={responseUserId || null} className="shrink-0" title="View profile">
                      <div className="philani-gradient-outline-soft [--philani-outline-fill:#ffffff] flex h-9 w-9 items-center justify-center overflow-hidden rounded-full text-[#1c1e21]">
                        {responseAvatar ? (
                          <img src={responseAvatar} alt={responseUserName} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-[11px] font-semibold">{responseUserName.slice(0, 1).toUpperCase()}</span>
                        )}
                      </div>
                    </UserLink>
                    <div className="min-w-0 flex-1">
                      <UserLink userId={responseUserId || null} className="text-[13px] font-semibold text-[#1c1e21] hover:underline" title="View profile">
                        {responseUserName}
                      </UserLink>
                      {renderResponseStatus ? renderResponseStatus(response, args) : null}
                      <div className="mt-3 min-w-0 rounded-[20px]">
                      {postReplyBlocks.length > 0 ? (
                        <div className="space-y-3">
                          {postReplyBlocks.map((block, blockIndex) => {
                            const blockKey = `inline-post-reply-${responseId}-${block.id}-${blockIndex}`
                            if (block.type === 'text') {
                              return renderTextBlock
                                ? renderTextBlock(block.text, blockKey)
                                : <div key={blockKey} className="philani-gradient-outline-soft [--philani-outline-fill:#f8fafc] rounded-2xl px-3 py-2 text-[14px] leading-6 whitespace-pre-wrap break-words text-[#1c1e21]">{block.text}</div>
                            }
                            if (block.type === 'latex') {
                              const latexHtml = renderKatexDisplayHtml(block.latex)
                              if (latexHtml) {
                                return <div key={blockKey} className="philani-gradient-outline-soft [--philani-outline-fill:#f8fafc] overflow-x-auto rounded-2xl px-3 py-2 leading-relaxed text-[#1c1e21]" dangerouslySetInnerHTML={{ __html: latexHtml }} />
                              }
                              return <div key={blockKey} className="philani-gradient-outline-soft [--philani-outline-fill:#f8fafc] rounded-2xl px-3 py-2 text-[14px] leading-6 whitespace-pre-wrap break-words text-[#1c1e21]">{renderTextWithKatex(block.latex)}</div>
                            }
                            if (block.type === 'image') {
                              return (
                                <div key={blockKey}>
                                  <button type="button" className="block w-full text-left" onClick={() => onOpenImageBlock?.(block.imageUrl, args)}>
                                    <div className="philani-gradient-outline-soft [--philani-outline-fill:#ffffff] overflow-hidden rounded-[24px] p-1">
                                      <img src={block.imageUrl} alt="Reply attachment" className="max-h-[320px] w-full rounded-[18px] bg-white object-contain" />
                                    </div>
                                  </button>
                                </div>
                              )
                            }
                            return (
                              <div key={blockKey}>
                                <div className="philani-gradient-outline-soft [--philani-outline-fill:#ffffff] overflow-hidden rounded-[24px] p-1">
                                  <PublicSolveCanvasViewer
                                    scene={block.scene}
                                    onViewportChange={onCanvasViewportChange
                                      ? (scene) => onCanvasViewportChange(response, responseId, scene)
                                      : undefined}
                                  />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <>
                          {fallbackStudentText ? (
                            renderTextBlock
                              ? renderTextBlock(fallbackStudentText, `inline-post-fallback-text-${responseId}`)
                              : <div className="philani-gradient-outline-soft [--philani-outline-fill:#f8fafc] rounded-2xl px-3 py-2 text-[14px] leading-6 whitespace-pre-wrap break-words text-[#1c1e21]">{fallbackStudentText}</div>
                          ) : null}
                          {fallbackLatex ? (
                            fallbackLatexHtml ? (
                              <div className="philani-gradient-outline-soft [--philani-outline-fill:#f8fafc] overflow-x-auto rounded-2xl px-3 py-2 leading-relaxed text-[#1c1e21]" dangerouslySetInnerHTML={{ __html: fallbackLatexHtml }} />
                            ) : (
                              <div className="philani-gradient-outline-soft [--philani-outline-fill:#f8fafc] rounded-2xl px-3 py-2 text-[14px] leading-6 whitespace-pre-wrap break-words text-[#1c1e21]">{renderTextWithKatex(fallbackLatex)}</div>
                            )
                          ) : null}
                          {response?.excalidrawScene ? (
                            <div>
                              <div className="philani-gradient-outline-soft [--philani-outline-fill:#ffffff] overflow-hidden rounded-[24px] p-1">
                                <PublicSolveCanvasViewer
                                  scene={response.excalidrawScene}
                                  onViewportChange={onCanvasViewportChange
                                    ? (scene) => onCanvasViewportChange(response, responseId, scene)
                                    : undefined}
                                />
                              </div>
                            </div>
                          ) : null}
                          {!fallbackStudentText && !fallbackLatex && !response?.excalidrawScene ? (
                            <div className="philani-gradient-outline-soft [--philani-outline-fill:#f8fafc] rounded-xl px-3 py-2 text-sm text-slate-500">{noContentMessage}</div>
                          ) : null}
                        </>
                      )}
                      </div>
                    </div>
                  </div>
                  {renderResponseFooter ? <div className="mt-3">{renderResponseFooter(response, args)}</div> : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}