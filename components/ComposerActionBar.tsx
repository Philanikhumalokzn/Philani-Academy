import type { ReactNode } from 'react'

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
  parseOnUpload: boolean
  onParseOnUploadChange: (checked: boolean) => void
  parsedJsonText?: string | null
  parsedOpen: boolean
  onToggleParsedOpen: () => void
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
  parseOnUpload,
  onParseOnUploadChange,
  parsedJsonText,
  parsedOpen,
  onToggleParsedOpen,
  posting = false,
  extraLeadingActions,
  trailingControls,
  submitLabel,
  submitDisabled,
  onSubmit,
}: Props) {
  const iconButtonClassName = tone === 'outlined'
    ? 'inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50'
    : 'inline-flex h-10 items-center justify-center text-slate-700 transition hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50'
  const shellClassName = tone === 'outlined'
    ? 'mt-auto shrink-0 border-t border-black/10 bg-white'
    : 'mt-auto shrink-0 border-t border-black/10 bg-white/95 backdrop-blur-xl'

  return (
    <div
      className={shellClassName}
      style={{ paddingBottom: 'max(var(--app-safe-bottom, 0px), env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="flex min-w-0 items-center justify-between gap-3 px-0 py-3 sm:px-1 sm:py-4">
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
          {showTypedAction ? (
            <button type="button" className={iconButtonClassName} onClick={onOpenTyped} disabled={posting} aria-label="Math input" title="Math input">
              <span className="text-[1.18rem] font-semibold italic leading-none tracking-[-0.05em]" style={{ fontFamily: 'KaTeX_Main, Times New Roman, serif' }}>fx</span>
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

          <label className="inline-flex select-none items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-sm text-slate-700">
            <input type="checkbox" checked={parseOnUpload} onChange={(event) => onParseOnUploadChange(event.target.checked)} />
            Parse
          </label>

          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            onClick={onToggleParsedOpen}
            disabled={!parsedJsonText}
            aria-label={parsedOpen ? 'Hide parsed content' : 'View parsed content'}
            title={parsedOpen ? 'Hide parsed' : 'View parsed'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M8 5H6a2 2 0 0 0-2 2v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M16 5h2a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M8 19H6a2 2 0 0 1-2-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M16 19h2a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M9 9h6M9 12h6M9 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>

          {extraLeadingActions}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {trailingControls}
          <button type="button" className="btn btn-primary" disabled={submitDisabled} onClick={() => void onSubmit()}>
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}