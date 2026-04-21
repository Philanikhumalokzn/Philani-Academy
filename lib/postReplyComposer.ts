import { normalizePublicSolveScene, type PublicSolveScene } from '../components/PublicSolveCanvas'

export type PostReplyTextBlock = {
  id: string
  type: 'text'
  text: string
}

export type PostReplyLatexBlock = {
  id: string
  type: 'latex'
  latex: string
}

export type PostReplyTableBlock = {
  id: string
  type: 'table'
  markdown: string
}

export type PostReplyCanvasBlock = {
  id: string
  type: 'canvas'
  scene: PublicSolveScene
}

export type PostReplyImageBlock = {
  id: string
  type: 'image'
  imageUrl: string
}

export type PostReplyBlock = PostReplyTextBlock | PostReplyLatexBlock | PostReplyTableBlock | PostReplyCanvasBlock | PostReplyImageBlock

export type PostReplyThreadMeta = {
  parentResponseId?: string | null
  rootResponseId?: string | null
  replyToUserId?: string | null
  replyToUserName?: string | null
}

export type PostReplyThreadTarget = {
  responseId: string
  rootResponseId?: string | null
  userId?: string | null
  userName?: string | null
}

export type ComposerBlockEditTarget = {
  blockId: string
  type: PostReplyBlock['type']
  index: number
}

export type ComposerBlockCrudTarget = {
  block: PostReplyBlock
  index: number
}

export type PostSolveOverlayState = {
  postId: string
  threadKey: string
  title: string
  prompt: string
  imageUrl?: string | null
  postContentBlocks?: PostReplyBlock[] | null
  authorName?: string | null
  authorAvatarUrl?: string | null
  initialScene?: any | null
  initialLatex?: string | null
  initialStudentText?: string | null
  initialGradingJson?: any | null
  preferredRecognitionEngine?: 'keyboard' | 'myscript' | 'mathpix'
  postRecord?: any | null
  editingResponseId?: string | null
  replyTarget?: PostReplyThreadTarget | null
}

export const POST_REPLY_BLOCKS_KIND = 'post-reply-blocks-v1'

export const createPostReplyBlockId = () => `block_${Math.random().toString(36).slice(2, 10)}`

const normalizePostReplyThreadMeta = (value?: PostReplyThreadMeta | null): PostReplyThreadMeta | null => {
  const parentResponseId = typeof value?.parentResponseId === 'string' ? value.parentResponseId.trim() : ''
  const rootResponseIdRaw = typeof value?.rootResponseId === 'string' ? value.rootResponseId.trim() : ''
  const replyToUserId = typeof value?.replyToUserId === 'string' ? value.replyToUserId.trim() : ''
  const replyToUserName = typeof value?.replyToUserName === 'string' ? value.replyToUserName.trim() : ''

  const rootResponseId = rootResponseIdRaw || parentResponseId
  if (!parentResponseId && !rootResponseId && !replyToUserId && !replyToUserName) return null

  return {
    ...(parentResponseId ? { parentResponseId } : {}),
    ...(rootResponseId ? { rootResponseId } : {}),
    ...(replyToUserId ? { replyToUserId } : {}),
    ...(replyToUserName ? { replyToUserName } : {}),
  }
}

export const getPostReplyThreadMeta = (source: any): PostReplyThreadMeta | null => {
  const replyThread = source?.gradingJson?.kind === POST_REPLY_BLOCKS_KIND && source?.gradingJson?.replyThread && typeof source.gradingJson.replyThread === 'object'
    ? source.gradingJson.replyThread
    : null

  return normalizePostReplyThreadMeta({
    parentResponseId: source?.parentResponseId ?? replyThread?.parentResponseId,
    rootResponseId: source?.rootResponseId ?? replyThread?.rootResponseId,
    replyToUserId: source?.replyToUserId ?? replyThread?.replyToUserId,
    replyToUserName: source?.replyToUserName ?? replyThread?.replyToUserName,
  })
}

export const normalizePostReplyBlocks = (source: any): PostReplyBlock[] => {
  const rawBlocks = Array.isArray(source)
    ? source
    : (source?.gradingJson?.kind === POST_REPLY_BLOCKS_KIND && Array.isArray(source?.gradingJson?.contentBlocks)
      ? source.gradingJson.contentBlocks
      : [])

  const normalizedBlocks = rawBlocks.reduce((acc: PostReplyBlock[], rawBlock: any) => {
    const blockType = String(rawBlock?.type || '').trim().toLowerCase()
    const blockId = String(rawBlock?.id || createPostReplyBlockId()).trim() || createPostReplyBlockId()
    if (blockType === 'text') {
      const text = typeof rawBlock?.text === 'string' ? rawBlock.text : ''
      if (text.trim()) acc.push({ id: blockId, type: 'text', text })
      return acc
    }
    if (blockType === 'latex') {
      const latex = typeof rawBlock?.latex === 'string' ? rawBlock.latex : ''
      if (latex.trim()) acc.push({ id: blockId, type: 'latex', latex })
      return acc
    }
    if (blockType === 'table') {
      const markdown = typeof rawBlock?.markdown === 'string'
        ? rawBlock.markdown
        : (typeof rawBlock?.tableMarkdown === 'string' ? rawBlock.tableMarkdown : '')
      if (markdown.trim()) acc.push({ id: blockId, type: 'table', markdown })
      return acc
    }
    if (blockType === 'canvas') {
      const scene = normalizePublicSolveScene(rawBlock?.scene)
      if (scene) acc.push({ id: blockId, type: 'canvas', scene })
      return acc
    }
    if (blockType === 'image') {
      const imageUrl = typeof rawBlock?.imageUrl === 'string' ? rawBlock.imageUrl.trim() : ''
      if (imageUrl) acc.push({ id: blockId, type: 'image', imageUrl })
    }
    return acc
  }, [])

  if (normalizedBlocks.length > 0) return normalizedBlocks

  const fallbackBlocks: PostReplyBlock[] = []
  const studentText = typeof source?.studentText === 'string' ? source.studentText : ''
  const latex = typeof source?.latex === 'string' ? source.latex : ''
  const tableMarkdown = typeof source?.tableMarkdown === 'string' ? source.tableMarkdown : ''
  const scene = normalizePublicSolveScene(source?.excalidrawScene)

  if (studentText.trim()) {
    fallbackBlocks.push({ id: createPostReplyBlockId(), type: 'text', text: studentText })
  }
  if (latex.trim()) {
    fallbackBlocks.push({ id: createPostReplyBlockId(), type: 'latex', latex })
  }
  if (tableMarkdown.trim()) {
    fallbackBlocks.push({ id: createPostReplyBlockId(), type: 'table', markdown: tableMarkdown })
  }
  if (scene) {
    fallbackBlocks.push({ id: createPostReplyBlockId(), type: 'canvas', scene })
  }

  return fallbackBlocks
}

export const buildPostReplyPayloadFromBlocks = (blocks: PostReplyBlock[], threadMeta?: PostReplyThreadMeta | null) => {
  const normalizedBlocks = normalizePostReplyBlocks(blocks)
  const normalizedThreadMeta = normalizePostReplyThreadMeta(threadMeta)
  const studentText = normalizedBlocks
    .filter((block): block is PostReplyTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim() || null
  const latex = normalizedBlocks
    .filter((block): block is PostReplyLatexBlock => block.type === 'latex')
    .map((block) => block.latex)
    .join('\n\n')
    .trim()
  const canvasBlock = normalizedBlocks.find((block): block is PostReplyCanvasBlock => block.type === 'canvas') || null

  return {
    contentBlocks: normalizedBlocks,
    studentText,
    latex,
    excalidrawScene: canvasBlock?.scene || null,
    gradingJson: normalizedBlocks.length > 0
      ? {
          kind: POST_REPLY_BLOCKS_KIND,
          contentBlocks: normalizedBlocks,
          ...(normalizedThreadMeta ? { replyThread: normalizedThreadMeta } : {}),
        }
      : null,
  }
}

export const composePostSolveBlocksWithDraftText = (
  blocks: PostReplyBlock[],
  draftText: string,
  editingTarget: ComposerBlockEditTarget | null,
): PostReplyBlock[] => {
  const nextText = String(draftText || '')
  const trimmedText = nextText.trim()
  if (editingTarget?.type === 'text') {
    const filteredBlocks = blocks.filter((block) => block.id !== editingTarget.blockId)
    if (!trimmedText) return filteredBlocks
    const insertIndex = Math.max(0, Math.min(editingTarget.index, filteredBlocks.length))
    const nextBlocks = [...filteredBlocks]
    nextBlocks.splice(insertIndex, 0, { id: editingTarget.blockId, type: 'text', text: nextText } as PostReplyTextBlock)
    return nextBlocks
  }
  if (editingTarget?.type === 'table') {
    const filteredBlocks = blocks.filter((block) => block.id !== editingTarget.blockId)
    if (!trimmedText) return filteredBlocks
    const insertIndex = Math.max(0, Math.min(editingTarget.index, filteredBlocks.length))
    const nextBlocks = [...filteredBlocks]
    nextBlocks.splice(insertIndex, 0, { id: editingTarget.blockId, type: 'table', markdown: nextText } as PostReplyTableBlock)
    return nextBlocks
  }
  if (!trimmedText) return blocks
  return [...blocks, { id: createPostReplyBlockId(), type: 'text', text: nextText } as PostReplyTextBlock]
}

export const upsertPostReplyBlock = (
  blocks: PostReplyBlock[],
  nextBlock: PostReplyBlock,
  editingTarget: ComposerBlockEditTarget | null,
  acceptedType?: PostReplyBlock['type'],
): PostReplyBlock[] => {
  if (editingTarget && (!acceptedType || editingTarget.type === acceptedType)) {
    const filteredBlocks = blocks.filter((block) => block.id !== editingTarget.blockId)
    const insertIndex = Math.max(0, Math.min(editingTarget.index, filteredBlocks.length))
    const replacementBlock = { ...nextBlock, id: editingTarget.blockId } as PostReplyBlock
    const nextBlocks = [...filteredBlocks]
    nextBlocks.splice(insertIndex, 0, replacementBlock)
    return nextBlocks
  }
  return [...blocks, nextBlock]
}