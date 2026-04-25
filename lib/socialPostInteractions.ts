import prisma from './prisma'

export type SocialPostInteractionState = {
  likeCount: number
  shareCount: number
  likedByMe: boolean
}

export async function getSocialPostInteractionState(postIds: string[], userId?: string | null) {
  const safePostIds = Array.from(new Set((postIds || []).map((id) => String(id || '').trim()).filter(Boolean)))
  const state = new Map<string, SocialPostInteractionState>()
  if (!safePostIds.length) return state

  const socialPostInteraction = (prisma as any).socialPostInteraction as any
  if (!socialPostInteraction) return state

  const grouped = await socialPostInteraction.groupBy({
    by: ['postId', 'kind'],
    where: { postId: { in: safePostIds } },
    _count: { id: true },
  }).catch(() => [])

  const likedRows = userId
    ? await socialPostInteraction.findMany({
        where: { postId: { in: safePostIds }, userId: String(userId), kind: 'LIKE' },
        select: { postId: true },
      }).catch(() => [])
    : []

  const likedPostIds = new Set(likedRows.map((row: any) => String(row?.postId || '')).filter(Boolean))

  for (const postId of safePostIds) {
    state.set(postId, {
      likeCount: 0,
      shareCount: 0,
      likedByMe: likedPostIds.has(postId),
    })
  }

  for (const row of grouped as any[]) {
    const postId = String(row?.postId || '')
    const kind = String(row?.kind || '').toUpperCase()
    const count = Number(row?._count?.id || 0)
    if (!postId || !state.has(postId)) continue
    const current = state.get(postId) || { likeCount: 0, shareCount: 0, likedByMe: false }
    if (kind === 'LIKE') current.likeCount = count
    if (kind === 'SHARE') current.shareCount = count
    state.set(postId, current)
  }

  return state
}
