import React, { useMemo } from 'react'
import UserLink from './UserLink'
import { PublicSolveCanvasViewer, type PublicSolveScene } from './PublicSolveCanvas'
import { getPostReplyThreadMeta, normalizePostReplyBlocks } from '../lib/postReplyComposer'
import { renderKatexDisplayHtml } from '../lib/latexRender'
import { renderTextWithKatex } from '../lib/renderTextWithKatex'

export type ResponseRenderArgs = {
  responseId: string
  responseUserId: string
  responseUserName: string
  responseAvatar: string
  isMine: boolean
}

export type InlinePostResponseAction = {
  label: string
  statusLabel?: string
  active?: boolean
  onClick: () => void
  icon: React.ReactNode
  disabled?: boolean
}

type ThreadNode = {
  response: any
  children: ThreadNode[]
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
  getResponseActions?: (response: any, args: ResponseRenderArgs) => InlinePostResponseAction[]
  onOpenImageBlock?: (imageUrl: string, args: ResponseRenderArgs) => void
  onCanvasViewportChange?: (response: any, responseId: string, scene: PublicSolveScene) => void
  theme?: 'light' | 'dark'
}

const getResponseTimestamp = (response: any) => {
  const updated = response?.updatedAt ? new Date(response.updatedAt).getTime() : 0
  const created = response?.createdAt ? new Date(response.createdAt).getTime() : 0
  return Math.max(updated, created)
}

const buildThreadTree = (responses: any[]) => {
  const orderedResponses = Array.isArray(responses)
    ? responses.slice().sort((a, b) => getResponseTimestamp(b) - getResponseTimestamp(a))
    : []

  const nodesById = new Map<string, ThreadNode>()
  for (const response of orderedResponses) {
    const responseId = String(response?.id || '').trim()
    if (!responseId) continue
    nodesById.set(responseId, { response, children: [] })
  }

  const roots: ThreadNode[] = []
  for (const response of orderedResponses) {
    const responseId = String(response?.id || '').trim()
    if (!responseId) continue

    const node = nodesById.get(responseId)
    if (!node) continue

    const threadMeta = getPostReplyThreadMeta(response)
    const parentResponseId = String(threadMeta?.parentResponseId || '').trim()
    if (parentResponseId && parentResponseId !== responseId) {
      const parentNode = nodesById.get(parentResponseId)
      if (parentNode) {
        parentNode.children.push(node)
        continue
      }
    }

    roots.push(node)
  }

  const sortChildren = (nodes: ThreadNode[]) => {
    nodes.sort((a, b) => getResponseTimestamp(b.response) - getResponseTimestamp(a.response))
    nodes.forEach((node) => sortChildren(node.children))
  }

  sortChildren(roots)
  return roots
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
  getResponseActions,
  onOpenImageBlock,
  onCanvasViewportChange,
  theme = 'light',
}: Props) {
  const responseTree = useMemo(() => buildThreadTree(responses), [responses])

  const palette = theme === 'dark'
    ? {
        mutedText: 'text-sm text-white/70',
        errorText: 'text-sm text-red-300',
        infoCard: 'rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70',
        rail: 'bg-white/14',
        avatarShell: 'flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/10 text-white',
        nameClass: 'text-sm font-semibold text-white hover:underline',
        replyMetaClass: 'mt-1 text-[11px] font-medium text-white/45',
        textBlockClass: 'text-sm leading-6 whitespace-pre-wrap break-words text-white/85',
        mathBlockClass: 'leading-relaxed text-white/95',
        mediaButtonClass: 'block max-w-full overflow-hidden rounded-[24px] border border-white/10 bg-white/5 text-left',
        mediaImageClass: 'max-h-[320px] w-full object-contain',
        canvasShellClass: 'overflow-hidden rounded-[24px] border border-white/10 bg-white shadow-sm',
        actionButtonClass: 'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white/70 transition hover:bg-white/10 hover:text-white',
        activeActionButtonClass: 'bg-white/12 text-white',
        disabledActionButtonClass: 'cursor-not-allowed opacity-50',
        noContentClass: 'rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-sm text-white/70',
      }
    : {
        mutedText: 'text-sm text-[#65676b]',
        errorText: 'text-sm text-red-500',
        infoCard: 'philani-gradient-outline-soft [--philani-outline-fill:#f8fafc] rounded-2xl px-4 py-3 text-sm text-slate-500',
        rail: 'bg-[#d7dde6]',
        avatarShell: 'flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-black/10 bg-[#f0f2f5] text-[#1c1e21]',
        nameClass: 'text-[13px] font-semibold text-[#1c1e21] hover:underline',
        replyMetaClass: 'mt-1 text-[11px] font-medium text-[#65676b]',
        textBlockClass: 'text-[14px] leading-6 whitespace-pre-wrap break-words text-[#1c1e21]',
        mathBlockClass: 'leading-relaxed text-[#1c1e21]',
        mediaButtonClass: 'block max-w-full overflow-hidden rounded-[24px] border border-black/10 bg-white text-left',
        mediaImageClass: 'max-h-[320px] w-full object-contain',
        canvasShellClass: 'overflow-hidden rounded-[24px] border border-black/10 bg-white shadow-sm',
        actionButtonClass: 'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-[#65676b] transition hover:bg-[#f0f2f5] hover:text-[#1c1e21]',
        activeActionButtonClass: 'bg-[#e7f3ff] text-[#1877f2]',
        disabledActionButtonClass: 'cursor-not-allowed opacity-50',
        noContentClass: 'rounded-xl bg-[#f0f2f5] px-3 py-2 text-sm text-slate-500',
      }

  const renderActionButton = (action: InlinePostResponseAction) => (
    <button
      key={`${action.label}-${action.statusLabel || 'default'}`}
      type="button"
      className={`${palette.actionButtonClass} ${action.active ? palette.activeActionButtonClass : ''} ${action.disabled ? palette.disabledActionButtonClass : ''}`.trim()}
      onClick={action.onClick}
      disabled={action.disabled}
    >
      <span className="shrink-0">{action.icon}</span>
      <span>{action.statusLabel || action.label}</span>
    </button>
  )

  const renderReplyBody = (response: any, args: ResponseRenderArgs) => {
    const postReplyBlocks = normalizePostReplyBlocks(response)
    const fallbackStudentText = String(response?.studentText || '').trim()
    const fallbackLatex = String(response?.latex || '').trim()
    const fallbackLatexHtml = fallbackLatex ? renderKatexDisplayHtml(fallbackLatex) : ''

    if (postReplyBlocks.length > 0) {
      return (
        <div className="mt-2 min-w-0 space-y-3">
          {postReplyBlocks.map((block, blockIndex) => {
            const blockKey = `inline-post-reply-${args.responseId}-${block.id}-${blockIndex}`

            if (block.type === 'text') {
              return renderTextBlock
                ? renderTextBlock(block.text, blockKey)
                : <div key={blockKey} className={palette.textBlockClass}>{block.text}</div>
            }

            if (block.type === 'latex') {
              const latexHtml = renderKatexDisplayHtml(block.latex)
              if (latexHtml) {
                return <div key={blockKey} className={palette.mathBlockClass} dangerouslySetInnerHTML={{ __html: latexHtml }} />
              }
              return <div key={blockKey} className={palette.textBlockClass}>{renderTextWithKatex(block.latex)}</div>
            }

            if (block.type === 'image') {
              return (
                <button
                  key={blockKey}
                  type="button"
                  className={palette.mediaButtonClass}
                  onClick={() => onOpenImageBlock?.(block.imageUrl, args)}
                >
                  <img src={block.imageUrl} alt="Reply attachment" className={palette.mediaImageClass} />
                </button>
              )
            }

            return (
              <div key={blockKey} className={palette.canvasShellClass}>
                <PublicSolveCanvasViewer
                  scene={block.scene}
                  onViewportChange={onCanvasViewportChange
                    ? (scene) => onCanvasViewportChange(response, args.responseId, scene)
                    : undefined}
                />
              </div>
            )
          })}
        </div>
      )
    }

    return (
      <div className="mt-2 min-w-0 space-y-3">
        {fallbackStudentText ? (
          renderTextBlock
            ? renderTextBlock(fallbackStudentText, `inline-post-fallback-text-${args.responseId}`)
            : <div className={palette.textBlockClass}>{fallbackStudentText}</div>
        ) : null}

        {fallbackLatex ? (
          fallbackLatexHtml ? (
            <div className={palette.mathBlockClass} dangerouslySetInnerHTML={{ __html: fallbackLatexHtml }} />
          ) : (
            <div className={palette.textBlockClass}>{renderTextWithKatex(fallbackLatex)}</div>
          )
        ) : null}

        {response?.excalidrawScene ? (
          <div className={palette.canvasShellClass}>
            <PublicSolveCanvasViewer
              scene={response.excalidrawScene}
              onViewportChange={onCanvasViewportChange
                ? (scene) => onCanvasViewportChange(response, args.responseId, scene)
                : undefined}
            />
          </div>
        ) : null}

        {!fallbackStudentText && !fallbackLatex && !response?.excalidrawScene ? (
          <div className={palette.noContentClass}>{noContentMessage}</div>
        ) : null}
      </div>
    )
  }

  const renderResponseNode = (node: ThreadNode, depth: number, isLastSibling: boolean): React.ReactNode => {
    const response = node.response
    const responseId = String(response?.id || `${depth}-${Math.random().toString(36).slice(2, 8)}`)
    const responseUserId = String(response?.userId || response?.user?.id || '')
    const responseUserName = String(response?.user?.name || response?.userName || response?.user?.email || 'Learner')
    const responseAvatar = String(response?.user?.avatar || response?.userAvatar || '').trim()
    const isMine = responseUserId === currentUserId
    const args: ResponseRenderArgs = { responseId, responseUserId, responseUserName, responseAvatar, isMine }
    const containerProps = getContainerProps?.(response, args) || {}
    const threadMeta = getPostReplyThreadMeta(response)
    const actions = getResponseActions?.(response, args) || []
    const showRail = node.children.length > 0 || !isLastSibling

    return (
      <div key={responseId} className={depth === 0 ? 'py-1' : 'pt-4'} {...containerProps}>
        <div className={depth > 0 ? 'pl-2 sm:pl-4' : ''}>
          <div className="flex items-start gap-3">
            <div className="relative flex w-10 shrink-0 justify-center self-stretch">
              <UserLink userId={responseUserId || null} className="shrink-0" title="View profile">
                <div className={palette.avatarShell}>
                  {responseAvatar ? (
                    <img src={responseAvatar} alt={responseUserName} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-[11px] font-semibold">{responseUserName.slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
              </UserLink>
              {showRail ? <div className={`absolute left-1/2 top-11 bottom-0 w-px -translate-x-1/2 ${palette.rail}`} aria-hidden="true" /> : null}
            </div>

            <div className="min-w-0 flex-1 pb-1">
              <UserLink userId={responseUserId || null} className={palette.nameClass} title="View profile">
                {responseUserName}
              </UserLink>

              {threadMeta?.parentResponseId && threadMeta.replyToUserName ? (
                <div className={palette.replyMetaClass}>Replying to {threadMeta.replyToUserName}</div>
              ) : null}

              {renderResponseStatus ? renderResponseStatus(response, args) : null}
              {renderReplyBody(response, args)}

              {actions.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {actions.map(renderActionButton)}
                </div>
              ) : null}

              {renderResponseFooter ? <div className="mt-3">{renderResponseFooter(response, args)}</div> : null}

              {node.children.length > 0 ? (
                <div className="mt-4 space-y-4">
                  {node.children.map((childNode, index) => renderResponseNode(childNode, depth + 1, index === node.children.length - 1))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-1 pt-1">
      {loading ? <div className={palette.mutedText}>Loading solutions...</div> : null}
      {!loading && error ? <div className={palette.errorText}>{error}</div> : null}
      {!loading && !error && !threadUnlocked ? (
        <div className={palette.infoCard}>{lockedMessage}</div>
      ) : null}
      {!loading && !error && threadUnlocked && responseTree.length === 0 ? (
        <div className={palette.infoCard}>{noSolutionsMessage}</div>
      ) : null}
      {!loading && !error && threadUnlocked && responseTree.length > 0 ? (
        <div className="space-y-4">
          {responseTree.map((node, index) => renderResponseNode(node, 0, index === responseTree.length - 1))}
        </div>
      ) : null}
    </div>
  )
}