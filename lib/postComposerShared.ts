import type { FeedPost } from './feedContract'
import { hydrateSocialPostRecord } from './postComposerContent'

export type PostComposerAudience = 'public' | 'grade' | 'private'

export function sortFeedPostsByCreatedAt<T extends { createdAt?: string | null }>(items: T[]) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const leftTs = left?.createdAt ? new Date(left.createdAt).getTime() : 0
    const rightTs = right?.createdAt ? new Date(right.createdAt).getTime() : 0
    return rightTs - leftTs
  })
}

export function buildHydratedCreatedPost(data: any, session: any, viewerId: string, selectedGrade?: string | null): FeedPost {
  const safeViewerId = String((data as any)?.createdById || (session as any)?.user?.id || viewerId || '')
  return {
    ...hydrateSocialPostRecord(data || {}),
    kind: 'post',
    createdById: safeViewerId,
    threadKey: `post:${String((data as any)?.id || '')}`,
    createdBy: {
      id: safeViewerId,
      name: String(session?.user?.name || session?.user?.email || 'You'),
      avatar: String((session as any)?.user?.avatar || (session as any)?.user?.image || ''),
      role: String((session as any)?.user?.role || ''),
      grade: selectedGrade || null,
    },
  }
}

export function patchFeedPost<T extends Partial<FeedPost>>(item: T, postId: string, patch: Partial<FeedPost>): T {
  if (String(item?.id || '') !== String(postId || '')) return item
  return hydrateSocialPostRecord({
    ...item,
    ...patch,
  }) as T
}

export function removeFeedPost<T extends Partial<FeedPost>>(items: T[], postId: string) {
  return (Array.isArray(items) ? items : []).filter((item) => String(item?.id || '') !== String(postId || ''))
}