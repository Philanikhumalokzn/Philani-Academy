import type { PostReplyBlock } from './postReplyComposer'
import { buildPostReplyPayloadFromBlocks, createPostReplyBlockId, normalizePostReplyBlocks } from './postReplyComposer'

export const SOCIAL_POST_COMPOSER_KIND = 'social-post-composer-v1'

export type SocialPostComposerMeta = {
  origin?: string
  sourceId?: string | null
  questionId?: string | null
  questionNumber?: string | null
  remixMmd?: string | null
  remixSelectedQuestionNumber?: string | null
  remixYear?: number | null
  remixMonth?: string | null
  remixPaper?: number | null
  remixTopic?: string | null
  remixCognitiveLevel?: number | null
  remixMarks?: number | null
}

type SocialPostComposerEnvelope = {
  kind: typeof SOCIAL_POST_COMPOSER_KIND
  version: 1
  blocks: PostReplyBlock[]
  meta?: SocialPostComposerMeta
}

export type DecodedSocialPostContent = {
  displayPrompt: string | null
  primaryImageUrl: string | null
  contentBlocks: PostReplyBlock[]
  composerMeta: SocialPostComposerMeta | null
  studentText: string | null
  latex: string
  excalidrawScene: any | null
  hasStructuredContent: boolean
}

function normalizeComposerMeta(meta: SocialPostComposerMeta | null | undefined): SocialPostComposerMeta | null {
  if (!meta || typeof meta !== 'object') return null
  const origin = typeof meta.origin === 'string' ? meta.origin.trim() : ''
  const sourceId = typeof meta.sourceId === 'string' ? meta.sourceId.trim() : ''
  const questionId = typeof meta.questionId === 'string' ? meta.questionId.trim() : ''
  const questionNumber = typeof meta.questionNumber === 'string' ? meta.questionNumber.trim() : ''
  const remixMmd = typeof meta.remixMmd === 'string' ? meta.remixMmd.trim() : ''
  const remixSelectedQuestionNumber = typeof meta.remixSelectedQuestionNumber === 'string' ? meta.remixSelectedQuestionNumber.trim() : ''
  const remixYearRaw = Number((meta as any).remixYear)
  const remixYear = Number.isFinite(remixYearRaw) ? Math.trunc(remixYearRaw) : null
  const remixMonth = typeof (meta as any).remixMonth === 'string' ? (meta as any).remixMonth.trim() : ''
  const remixPaperRaw = Number((meta as any).remixPaper)
  const remixPaper = Number.isFinite(remixPaperRaw) ? Math.trunc(remixPaperRaw) : null
  const remixTopic = typeof (meta as any).remixTopic === 'string' ? (meta as any).remixTopic.trim() : ''
  const remixCognitiveLevelRaw = Number((meta as any).remixCognitiveLevel)
  const remixCognitiveLevel = Number.isFinite(remixCognitiveLevelRaw) ? Math.trunc(remixCognitiveLevelRaw) : null
  const remixMarksRaw = Number((meta as any).remixMarks)
  const remixMarks = Number.isFinite(remixMarksRaw) ? Math.trunc(remixMarksRaw) : null
  if (!origin && !sourceId && !questionId && !questionNumber && !remixMmd && !remixSelectedQuestionNumber && remixYear === null && !remixMonth && remixPaper === null && !remixTopic && remixCognitiveLevel === null && remixMarks === null) return null
  return {
    ...(origin ? { origin } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(questionId ? { questionId } : {}),
    ...(questionNumber ? { questionNumber } : {}),
    ...(remixMmd ? { remixMmd } : {}),
    ...(remixSelectedQuestionNumber ? { remixSelectedQuestionNumber } : {}),
    ...(remixYear !== null ? { remixYear } : {}),
    ...(remixMonth ? { remixMonth } : {}),
    ...(remixPaper !== null ? { remixPaper } : {}),
    ...(remixTopic ? { remixTopic } : {}),
    ...(remixCognitiveLevel !== null ? { remixCognitiveLevel } : {}),
    ...(remixMarks !== null ? { remixMarks } : {}),
  }
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

export function buildSocialPostComposerFields(blocks: PostReplyBlock[], meta?: SocialPostComposerMeta | null) {
  const payload = buildPostReplyPayloadFromBlocks(blocks)
  const primaryImageUrl = payload.contentBlocks.find((block) => block.type === 'image')?.imageUrl || null
  const composerMeta = normalizeComposerMeta(meta)
  const envelope: SocialPostComposerEnvelope = {
    kind: SOCIAL_POST_COMPOSER_KIND,
    version: 1,
    blocks: payload.contentBlocks,
    ...(composerMeta ? { meta: composerMeta } : {}),
  }
  const storedPrompt = stringifyStructuredPrompt(envelope)

  return {
    storedPrompt,
    displayPrompt: payload.studentText,
    primaryImageUrl,
    contentBlocks: payload.contentBlocks,
    composerMeta,
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
        const composerMeta = normalizeComposerMeta(parsed.meta)
        return {
          displayPrompt: payload.studentText,
          primaryImageUrl: contentBlocks.find((block) => block.type === 'image')?.imageUrl || null,
          contentBlocks,
          composerMeta,
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
    composerMeta: null,
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
    composerMeta: decoded.composerMeta,
    hasStructuredContent: decoded.hasStructuredContent,
  }
}