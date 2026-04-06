import type { PostReplyBlock } from './postReplyComposer'
import { buildPostReplyPayloadFromBlocks, createPostReplyBlockId, normalizePostReplyBlocks } from './postReplyComposer'

export const SOCIAL_POST_COMPOSER_KIND = 'social-post-composer-v1'

type SocialPostComposerEnvelope = {
  kind: typeof SOCIAL_POST_COMPOSER_KIND
  version: 1
  blocks: PostReplyBlock[]
}

export type DecodedSocialPostContent = {
  displayPrompt: string | null
  primaryImageUrl: string | null
  contentBlocks: PostReplyBlock[]
  studentText: string | null
  latex: string
  excalidrawScene: any | null
  hasStructuredContent: boolean
}

function appendPrimaryImageBlock(blocks: PostReplyBlock[], imageUrl: string | null | undefined): PostReplyBlock[] {
  const safeImageUrl = typeof imageUrl === 'string' ? imageUrl.trim() : ''
  if (!safeImageUrl) return blocks
  if (blocks.some((block) => block.type === 'image' && block.imageUrl === safeImageUrl)) return blocks
  return [...blocks, { id: createPostReplyBlockId(), type: 'image', imageUrl: safeImageUrl } as PostReplyBlock]
}

function stringifyStructuredPrompt(envelope: SocialPostComposerEnvelope) {
  try {
    return JSON.stringify(envelope)
  } catch {
    return ''
  }
}

export function buildSocialPostComposerFields(blocks: PostReplyBlock[]) {
  const payload = buildPostReplyPayloadFromBlocks(blocks)
  const primaryImageUrl = payload.contentBlocks.find((block) => block.type === 'image')?.imageUrl || null
  const envelope: SocialPostComposerEnvelope = {
    kind: SOCIAL_POST_COMPOSER_KIND,
    version: 1,
    blocks: payload.contentBlocks,
  }
  const storedPrompt = stringifyStructuredPrompt(envelope)

  return {
    storedPrompt,
    displayPrompt: payload.studentText,
    primaryImageUrl,
    contentBlocks: payload.contentBlocks,
    studentText: payload.studentText,
    latex: payload.latex,
    excalidrawScene: payload.excalidrawScene,
    gradingJson: payload.gradingJson,
  }
}

export function decodeSocialPostContent(prompt: unknown, imageUrl?: unknown): DecodedSocialPostContent {
  const rawPrompt = typeof prompt === 'string' ? prompt.trim() : ''
  const rawImageUrl = typeof imageUrl === 'string' ? imageUrl.trim() : ''

  if (rawPrompt) {
    try {
      const parsed = JSON.parse(rawPrompt) as Partial<SocialPostComposerEnvelope> | null
      if (parsed?.kind === SOCIAL_POST_COMPOSER_KIND) {
        const contentBlocks = appendPrimaryImageBlock(normalizePostReplyBlocks(parsed.blocks), rawImageUrl)
        const payload = buildPostReplyPayloadFromBlocks(contentBlocks)
        return {
          displayPrompt: payload.studentText,
          primaryImageUrl: contentBlocks.find((block) => block.type === 'image')?.imageUrl || null,
          contentBlocks,
          studentText: payload.studentText,
          latex: payload.latex,
          excalidrawScene: payload.excalidrawScene,
          hasStructuredContent: true,
        }
      }
    } catch {
      // Treat legacy plain-text prompt as unstructured content.
    }
  }

  const fallbackBlocks = appendPrimaryImageBlock(normalizePostReplyBlocks({ studentText: rawPrompt }), rawImageUrl)
  const payload = buildPostReplyPayloadFromBlocks(fallbackBlocks)

  return {
    displayPrompt: rawPrompt || payload.studentText,
    primaryImageUrl: fallbackBlocks.find((block) => block.type === 'image')?.imageUrl || null,
    contentBlocks: fallbackBlocks,
    studentText: payload.studentText,
    latex: payload.latex,
    excalidrawScene: payload.excalidrawScene,
    hasStructuredContent: false,
  }
}

export function hydrateSocialPostRecord<T extends { prompt?: unknown; imageUrl?: unknown }>(item: T) {
  const decoded = decodeSocialPostContent(item?.prompt, item?.imageUrl)
  return {
    ...item,
    prompt: decoded.displayPrompt,
    imageUrl: decoded.primaryImageUrl,
    contentBlocks: decoded.contentBlocks,
  }
}