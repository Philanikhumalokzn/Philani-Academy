import { useCallback, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

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
  const replyLongPressTimeoutRef = useRef<number | null>(null)
  const replyLongPressStateRef = useRef<null | { x: number; y: number; target: T }>(null)

  const clearReplyLongPress = useCallback(() => {
    if (replyLongPressTimeoutRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(replyLongPressTimeoutRef.current)
    }
    replyLongPressTimeoutRef.current = null
    replyLongPressStateRef.current = null
  }, [])

  const openReplyCrudOptions = useCallback((target: T) => {
    clearReplyLongPress()
    onOpenCrud(target)
  }, [clearReplyLongPress, onOpenCrud])

  const beginReplyLongPress = useCallback((event: ReactPointerEvent, target: T) => {
    const responseUserId = getResponseOwnerId(target?.response)
    if (!responseUserId || responseUserId !== String(currentUserId || '')) return
    if (typeof window === 'undefined') return
    if (event.button !== 0) return

    clearReplyLongPress()
    replyLongPressStateRef.current = { x: event.clientX, y: event.clientY, target }
    replyLongPressTimeoutRef.current = window.setTimeout(() => {
      openReplyCrudOptions(target)
    }, delayMs)
  }, [clearReplyLongPress, currentUserId, delayMs, openReplyCrudOptions])

  const moveReplyLongPress = useCallback((event: ReactPointerEvent) => {
    const state = replyLongPressStateRef.current
    if (!state) return
    const dx = event.clientX - state.x
    const dy = event.clientY - state.y
    if (Math.hypot(dx, dy) > maxMovePx) {
      clearReplyLongPress()
    }
  }, [clearReplyLongPress, maxMovePx])

  return {
    clearReplyLongPress,
    openReplyCrudOptions,
    beginReplyLongPress,
    moveReplyLongPress,
  }
}