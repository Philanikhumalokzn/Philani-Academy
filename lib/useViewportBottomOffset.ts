import { useEffect, useState } from 'react'

type Options = {
  requireEditableFocus?: boolean
}

const isKeyboardEditableElement = (element: Element | null) => {
  if (!(element instanceof HTMLElement)) return false
  if (element.isContentEditable) return true
  const tagName = element.tagName.toLowerCase()
  if (tagName === 'textarea') return true
  if (tagName !== 'input') return false
  const inputType = ((element as HTMLInputElement).type || 'text').toLowerCase()
  return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(inputType)
}

export default function useViewportBottomOffset({ requireEditableFocus = false }: Options = {}) {
  const [viewportBottomOffsetPx, setViewportBottomOffsetPx] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const compute = () => {
      const vv = (window as any).visualViewport as VisualViewport | undefined
      let nextOffset = 0
      if (vv) {
        const bottomGap = window.innerHeight - (vv.height + vv.offsetTop)
        nextOffset = Math.max(0, Math.round(bottomGap))
      }
      if (requireEditableFocus && !isKeyboardEditableElement(document.activeElement)) {
        nextOffset = 0
      }
      setViewportBottomOffsetPx((current) => (current === nextOffset ? current : nextOffset))
    }

    compute()
    window.addEventListener('resize', compute)
    document.addEventListener('focusin', compute)
    document.addEventListener('focusout', compute)

    const vv = (window as any).visualViewport as VisualViewport | undefined
    vv?.addEventListener('resize', compute)
    vv?.addEventListener('scroll', compute)

    return () => {
      window.removeEventListener('resize', compute)
      document.removeEventListener('focusin', compute)
      document.removeEventListener('focusout', compute)
      vv?.removeEventListener('resize', compute)
      vv?.removeEventListener('scroll', compute)
    }
  }, [requireEditableFocus])

  return viewportBottomOffsetPx
}