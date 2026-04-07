import { useCallback, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

type UseOwnedLongPressCrudOptions<T> = {
  currentUserId: string
  onOpenCrud: (target: T) => void
  getOwnerId: (target: T) => string
  getTargetKey?: (target: T) => string
  delayMs?: number
  maxMovePx?: number
}

export function useOwnedLongPressCrud<T>({
  currentUserId,
  onOpenCrud,
  getOwnerId,
  getTargetKey,
  delayMs = 420,
  maxMovePx = 10,
}: UseOwnedLongPressCrudOptions<T>) {
  const longPressTimeoutRef = useRef<number | null>(null)
  const longPressStateRef = useRef<null | { x: number; y: number; target: T }>(null)
  const pendingLongPressOpenRef = useRef(false)
  const pendingLongPressTargetKeyRef = useRef<string | null>(null)

  const resolveTargetKey = useCallback((target: T | null | undefined) => {
    if (!target || !getTargetKey) return null
    const nextKey = String(getTargetKey(target) || '').trim()
    return nextKey || null
  }, [getTargetKey])

  const isOwnedByCurrentUser = useCallback((target: T) => {
    const ownerId = String(getOwnerId(target) || '').trim()
    return Boolean(ownerId) && ownerId === String(currentUserId || '').trim()
  }, [currentUserId, getOwnerId])

  const clearLongPress = useCallback(() => {
    if (longPressTimeoutRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(longPressTimeoutRef.current)
    }
    longPressTimeoutRef.current = null
    longPressStateRef.current = null
  }, [])

  const openCrudOptions = useCallback((target: T) => {
    clearLongPress()
    pendingLongPressOpenRef.current = false
    pendingLongPressTargetKeyRef.current = null
    onOpenCrud(target)
  }, [clearLongPress, onOpenCrud])

  const openCrudOptionsFromLongPress = useCallback((target: T) => {
    clearLongPress()
    pendingLongPressOpenRef.current = true
    pendingLongPressTargetKeyRef.current = resolveTargetKey(target)
    onOpenCrud(target)
  }, [clearLongPress, onOpenCrud, resolveTargetKey])

  const beginLongPress = useCallback((event: ReactPointerEvent, target: T) => {
    if (!isOwnedByCurrentUser(target)) return
    if (typeof window === 'undefined') return
    if (event.button !== 0) return

    clearLongPress()
    pendingLongPressOpenRef.current = false
    pendingLongPressTargetKeyRef.current = null
    longPressStateRef.current = { x: event.clientX, y: event.clientY, target }
    longPressTimeoutRef.current = window.setTimeout(() => {
      openCrudOptionsFromLongPress(target)
    }, delayMs)
  }, [clearLongPress, delayMs, isOwnedByCurrentUser, openCrudOptionsFromLongPress])

  const moveLongPress = useCallback((event: ReactPointerEvent) => {
    const state = longPressStateRef.current
    if (!state) return
    const dx = event.clientX - state.x
    const dy = event.clientY - state.y
    if (Math.hypot(dx, dy) > maxMovePx) {
      clearLongPress()
    }
  }, [clearLongPress, maxMovePx])

  const consumeLongPressOpen = useCallback((target?: T) => {
    if (!pendingLongPressOpenRef.current) return false
    const pendingTargetKey = pendingLongPressTargetKeyRef.current
    if (target && pendingTargetKey) {
      const nextTargetKey = resolveTargetKey(target)
      if (nextTargetKey && nextTargetKey !== pendingTargetKey) return false
    }
    pendingLongPressOpenRef.current = false
    pendingLongPressTargetKeyRef.current = null
    return true
  }, [resolveTargetKey])

  return {
    clearLongPress,
    openCrudOptions,
    beginLongPress,
    moveLongPress,
    consumeLongPressOpen,
    isOwnedByCurrentUser,
  }
}