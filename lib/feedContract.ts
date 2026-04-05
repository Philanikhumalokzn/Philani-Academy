export type FeedScope = 'public' | 'user-timeline'

export type FeedPost = {
  id: string
  kind: 'post'
  title?: string | null
  prompt?: string | null
  imageUrl?: string | null
  grade?: string | null
  audience?: string | null
  attemptsOpen?: boolean | null
  solutionsVisible?: boolean | null
  maxAttempts?: number | null
  closedAt?: string | null
  revealedAt?: string | null
  createdAt?: string | null
  createdById?: string | null
  createdBy?: {
    id?: string | null
    name?: string | null
    avatar?: string | null
    grade?: string | null
    role?: string | null
  } | null
  ownResponse?: any
  hasOwnResponse?: boolean
  myAttemptCount?: number
  usesAttemptRules?: boolean
  solutionCount?: number
  threadKey: string
}

export type FeedPostActionState = {
  usesAttemptRules: boolean
  hasAttempted: boolean
  canAttempt: boolean
  solveLabel: string
  solveAction: 'solve' | 'solutions' | 'closed'
}

export const FEED_POST_SELECT = {
  id: true,
  title: true,
  prompt: true,
  imageUrl: true,
  grade: true,
  audience: true,
  attemptsOpen: true,
  solutionsVisible: true,
  maxAttempts: true,
  closedAt: true,
  revealedAt: true,
  createdAt: true,
  createdById: true,
  createdBy: {
    select: {
      id: true,
      name: true,
      avatar: true,
      grade: true,
      role: true,
    },
  },
} as const

export function isAttemptScopedFeedPost(item: any) {
  return item?.attemptsOpen === false || item?.solutionsVisible === true || typeof item?.maxAttempts === 'number'
}

export function buildFeedPostActionState(item: Partial<FeedPost> | null | undefined): FeedPostActionState {
  const myAttemptCount = typeof item?.myAttemptCount === 'number' ? item.myAttemptCount : 0
  const maxAttempts = typeof item?.maxAttempts === 'number' ? item.maxAttempts : null
  const attemptsOpen = item?.attemptsOpen !== false
  const usesAttemptRules = Boolean(item?.usesAttemptRules || maxAttempts !== null || item?.attemptsOpen === false || item?.solutionsVisible === true)
  const hasAttempted = myAttemptCount > 0
  const canAttempt = attemptsOpen && (maxAttempts === null || myAttemptCount < maxAttempts)
  const solutionCount = typeof item?.solutionCount === 'number' ? item.solutionCount : 0
  const solveLabel = usesAttemptRules
    ? (hasAttempted ? formatSolutionsLabel(solutionCount) : (canAttempt ? 'Solve' : 'Closed'))
    : (item?.hasOwnResponse ? formatSolutionsLabel(solutionCount) : 'Solve')

  return {
    usesAttemptRules,
    hasAttempted,
    canAttempt,
    solveLabel,
    solveAction: usesAttemptRules
      ? (hasAttempted ? 'solutions' : (canAttempt ? 'solve' : 'closed'))
      : (item?.hasOwnResponse ? 'solutions' : 'solve'),
  }
}

export function enrichFeedPosts(items: any[], ownResponseByKey: Map<string, any>, attemptCountByKey: Map<string, number>, solutionCounts: Map<string, number>): FeedPost[] {
  return items.map((item: any) => ({
    ...item,
    kind: 'post',
    threadKey: `post:${item.id}`,
    ownResponse: ownResponseByKey.get(`post:${item.id}`) || null,
    hasOwnResponse: ownResponseByKey.has(`post:${item.id}`),
    myAttemptCount: attemptCountByKey.get(`post:${item.id}`) || 0,
    usesAttemptRules: isAttemptScopedFeedPost(item),
    solutionCount: solutionCounts.get(`post:${item.id}`) || 0,
  }))
}

export function applyOwnFeedPostResponse<T extends Partial<FeedPost>>(item: T, postId: string, responseData: any): T {
  if (String(item?.id || '') !== String(postId || '')) return item

  const previousOwnResponseId = String(item?.ownResponse?.id || '')
  const nextOwnResponseId = String(responseData?.id || '')
  const isNewResponseRecord = !previousOwnResponseId || (nextOwnResponseId && nextOwnResponseId !== previousOwnResponseId)
  const previousAttemptCount = typeof item?.myAttemptCount === 'number' ? item.myAttemptCount : 0
  const previousSolutionCount = Number(item?.solutionCount || 0)

  return {
    ...item,
    hasOwnResponse: true,
    ownResponse: responseData || item?.ownResponse || null,
    myAttemptCount: isNewResponseRecord ? previousAttemptCount + 1 : Math.max(previousAttemptCount, 1),
    solutionCount: isNewResponseRecord ? Math.max(1, previousSolutionCount + 1) : Math.max(1, previousSolutionCount),
  }
}

export function syncFeedPostThreadState<T extends Partial<FeedPost>>(item: T, postId: string, responses: any[], currentUserId: string): T {
  if (String(item?.id || '') !== String(postId || '')) return item

  const safeResponses = Array.isArray(responses) ? responses : []
  const effectiveCurrentUserId = String(currentUserId || '')
  const ownResponse = safeResponses.find((response: any) => String(response?.userId || response?.user?.id || '') === effectiveCurrentUserId) || null
  const ownAttemptCount = safeResponses.filter((response: any) => String(response?.userId || response?.user?.id || '') === effectiveCurrentUserId).length

  return {
    ...item,
    hasOwnResponse: Boolean(ownResponse),
    ownResponse,
    myAttemptCount: ownAttemptCount,
    solutionCount: safeResponses.length,
  }
}

function formatSolutionsLabel(count: number) {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
  if (safeCount <= 0) return 'Solutions'
  if (safeCount === 1) return '1 solution'
  return `${safeCount} Solutions`
}