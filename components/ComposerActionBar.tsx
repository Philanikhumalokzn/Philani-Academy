import type { CSSProperties, ReactNode } from 'react'
import useViewportBottomOffset from '../lib/useViewportBottomOffset'

type Props = {
  tone?: 'bare' | 'outlined'
  showTypedAction?: boolean
  showHandwrittenAction?: boolean
  showImageAction?: boolean
  imageActionIcon?: 'camera' | 'upload'
  imageActionAriaLabel?: string
  imageActionTitle?: string
  imageActionDisabled?: boolean
  onOpenTyped?: () => void
  onOpenHandwritten?: () => void
  onOpenImage?: () => void
  posting?: boolean
  extraLeadingActions?: ReactNode
  trailingControls?: ReactNode
  submitLabel: string
  submitDisabled: boolean
  onSubmit: () => void | Promise<void>
}

export default function ComposerActionBar({
  tone = 'bare',
  showTypedAction = true,
  showHandwrittenAction = true,
  showImageAction = true,
  imageActionIcon = 'camera',
  imageActionAriaLabel,
  imageActionTitle,
  imageActionDisabled = false,
  onOpenTyped,
  onOpenHandwritten,
  onOpenImage,
  posting = false,
  extraLeadingActions,
  trailingControls,
  submitLabel,
  submitDisabled,
  onSubmit,
}: Props) {
  const viewportBottomOffsetPx = useViewportBottomOffset({ requireEditableFocus: true })
  const iconButtonClassName = tone === 'outlined'
    ? 'philani-gradient-outline [--philani-outline-fill:#ffffff] inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-700 transition hover:-translate-y-[1px] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50'
    : 'philani-gradient-outline-soft [--philani-outline-fill:#ffffff] inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-700 transition hover:-translate-y-[1px] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50'
  const shellClassName = tone === 'outlined'
    ? 'philani-gradient-divider-top mt-auto shrink-0 bg-white'
    : 'philani-gradient-divider-top mt-auto shrink-0 bg-white/95 backdrop-blur-xl'
  const fxClassName = 'philani-gradient-text text-[1.18rem] font-semibold italic leading-none tracking-[-0.05em] drop-shadow-[0_6px_10px_rgba(14,165,233,0.16)]'
  const shellStyle: CSSProperties | undefined = viewportBottomOffsetPx > 0
    ? {
        paddingBottom: `calc(max(var(--app-safe-bottom, 0px), env(safe-area-inset-bottom, 0px)) + ${viewportBottomOffsetPx}px)`,
      }
    : undefined

  return (
    <div className={`${shellClassName} transition-[padding-bottom] duration-150`} style={shellStyle}>
      <div className="flex min-w-0 items-center justify-between gap-3 px-0 py-3 sm:px-1 sm:py-4">
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
          {showTypedAction ? (
            <button type="button" className={iconButtonClassName} onClick={onOpenTyped} disabled={posting} aria-label="Math input" title="Math input">
              <span className={fxClassName} style={{ fontFamily: 'KaTeX_Main, Times New Roman, serif' }}>fx</span>
            </button>
          ) : null}

          {showHandwrittenAction ? (
            <button type="button" className={iconButtonClassName} onClick={onOpenHandwritten} disabled={posting} aria-label="Handwriting" title="Handwriting">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m4.5 19.5 4.2-.8 9.9-9.9a2.1 2.1 0 0 0 0-3l-.4-.4a2.1 2.1 0 0 0-3 0l-9.9 9.9-.8 4.2Z" />
                <path d="m13.8 6.2 4 4" />
                <path d="M4.5 19.5 8 16" />
              </svg>
            </button>
          ) : null}

          {showImageAction ? (
            <button
              type="button"
              className={iconButtonClassName}
              onClick={onOpenImage}
              disabled={imageActionDisabled}
              aria-label={imageActionAriaLabel || (imageActionIcon === 'camera' ? 'Camera' : 'Upload image')}
              title={imageActionTitle || (imageActionIcon === 'camera' ? 'Camera' : 'Upload image')}
            >
              {imageActionIcon === 'camera' ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.3-1.7A2 2 0 0 1 10.9 3.5h2.2a2 2 0 0 1 1.6.8L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z" />
                  <circle cx="12" cy="12.5" r="3.5" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M4 7a2 2 0 0 1 2-2h2l1-1h6l1 1h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="2" />
                </svg>
              )}
            </button>
          ) : null}

          {extraLeadingActions}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {trailingControls}
          <button type="button" className="btn btn-primary hover:translate-y-0" style={{ boxShadow: 'none', filter: 'none' }} disabled={submitDisabled} onClick={() => void onSubmit()}>
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}