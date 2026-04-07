import { useOwnedLongPressCrud } from './ownedLongPressCrud'

export type PostCrudTarget<TPost = any> = {
  post: TPost
}

type UsePostLongPressCrudOptions<T extends { post: any }> = {
  currentUserId: string
  onOpenCrud: (target: T) => void
  delayMs?: number
  maxMovePx?: number
}

export const getPostOwnerId = (post: any) => String(post?.createdById || post?.createdBy?.id || '')

export function usePostLongPressCrud<T extends { post: any }>({
  currentUserId,
  onOpenCrud,
  delayMs,
  maxMovePx,
}: UsePostLongPressCrudOptions<T>) {
  return useOwnedLongPressCrud<T>({
    currentUserId,
    onOpenCrud,
    delayMs,
    maxMovePx,
    getOwnerId: (target) => getPostOwnerId(target?.post),
    getTargetKey: (target) => String(target?.post?.id || ''),
  })
}