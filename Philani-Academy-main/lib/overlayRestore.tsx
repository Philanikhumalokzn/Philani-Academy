import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react'

type RestoreAction = () => void

type OverlayRestoreContextValue = {
  queueRestore: (restore: RestoreAction) => void
  popRestore: () => RestoreAction | null
  discardRestore: () => void
  clearRestores: () => void
  hasRestore: () => boolean
}

const OverlayRestoreContext = createContext<OverlayRestoreContextValue | null>(null)

export function OverlayRestoreProvider({ children }: { children: React.ReactNode }) {
  const stackRef = useRef<RestoreAction[]>([])

  const queueRestore = useCallback((restore: RestoreAction) => {
    if (typeof restore !== 'function') return
    stackRef.current.push(restore)
  }, [])

  const popRestore = useCallback(() => stackRef.current.pop() || null, [])

  const discardRestore = useCallback(() => {
    stackRef.current.pop()
  }, [])

  const clearRestores = useCallback(() => {
    stackRef.current = []
  }, [])

  const hasRestore = useCallback(() => stackRef.current.length > 0, [])

  const value = useMemo(
    () => ({ queueRestore, popRestore, discardRestore, clearRestores, hasRestore }),
    [queueRestore, popRestore, discardRestore, clearRestores, hasRestore]
  )

  return <OverlayRestoreContext.Provider value={value}>{children}</OverlayRestoreContext.Provider>
}

const fallbackValue: OverlayRestoreContextValue = {
  queueRestore: () => {},
  popRestore: () => null,
  discardRestore: () => {},
  clearRestores: () => {},
  hasRestore: () => false,
}

export function useOverlayRestore() {
  return useContext(OverlayRestoreContext) || fallbackValue
}
