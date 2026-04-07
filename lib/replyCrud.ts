import { useOwnedLongPressCrud } from './ownedLongPressCrud'

export type ReplyCrudTarget = {
  kind: 'post' | 'challenge'
  threadKey: string
  item: any
  response: any
  href?: string
}

type UseReplyLongPressCrudOptions<T extends { response: any }> = {
  currentUserId: string
  onOpenCrud: (target: T) => void
  delayMs?: number
  maxMovePx?: number
}

const getResponseOwnerId = (response: any) => String(response?.userId || response?.user?.id || '')

export function useReplyLongPressCrud<T extends { response: any }>({
  currentUserId,
  onOpenCrud,
  delayMs = 420,
  maxMovePx = 10,
}: UseReplyLongPressCrudOptions<T>) {
  return useOwnedLongPressCrud<T>({
    currentUserId,
    onOpenCrud,
    delayMs,
    maxMovePx,
    getOwnerId: (target) => getResponseOwnerId(target?.response),
    getTargetKey: (target) => String(target?.response?.id || ''),
  })
}