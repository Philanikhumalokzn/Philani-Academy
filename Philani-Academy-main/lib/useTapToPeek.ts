import { useCallback, useEffect, useRef, useState } from 'react'

type TapToPeekOptions = {
  autoHideMs?: number
  defaultVisible?: boolean
  disabled?: boolean
  lockVisible?: boolean
}

type TapToPeekResult = {
  visible: boolean
  setVisible: (visible: boolean) => void
  peek: () => void
  hide: () => void
  scheduleHide: () => void
  clearTimer: () => void
}

export const useTapToPeek = (options: TapToPeekOptions = {}): TapToPeekResult => {
  const {
    autoHideMs = 2500,
    defaultVisible = false,
    disabled = false,
    lockVisible = false,
  } = options

  const [visible, setVisible] = useState(Boolean(defaultVisible))
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const hide = useCallback(() => {
    clearTimer()
    setVisible(false)
  }, [clearTimer])

  const scheduleHide = useCallback(() => {
    if (disabled || lockVisible) return
    clearTimer()
    timerRef.current = setTimeout(() => {
      setVisible(false)
      timerRef.current = null
    }, autoHideMs)
  }, [autoHideMs, clearTimer, disabled, lockVisible])

  const peek = useCallback(() => {
    if (disabled) return
    setVisible(true)
    scheduleHide()
  }, [disabled, scheduleHide])

  useEffect(() => {
    if (!lockVisible) return
    setVisible(true)
    clearTimer()
  }, [lockVisible, clearTimer])

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  return { visible, setVisible, peek, hide, scheduleHide, clearTimer }
}
