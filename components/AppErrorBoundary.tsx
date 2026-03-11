import React from 'react'

type AppErrorBoundaryProps = {
  children: React.ReactNode
}

type AppErrorBoundaryState = {
  error: Error | null
  componentStack?: string
}

const formatErrorBlock = (label: string, value: string | undefined) => {
  const safeValue = String(value || '').trim()
  if (!safeValue) return ''
  return `${label}:\n${safeValue}`
}

export default class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const componentStack = info?.componentStack
    const safeMessage = String((error as any)?.message || error)
    const safeStack = String((error as any)?.stack || '')
    const href = typeof window !== 'undefined' ? window.location.href : ''
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
    // Keep a readable log in production; this is crucial when React throws minified errors.
    // eslint-disable-next-line no-console
    console.error('[AppErrorBoundary] Uncaught render error', {
      message: safeMessage,
      href,
      userAgent: ua,
    })
    if (safeStack) {
      // eslint-disable-next-line no-console
      console.error('[AppErrorBoundary] Error stack', safeStack)
    }
    if (componentStack) {
      // eslint-disable-next-line no-console
      console.error('[AppErrorBoundary] Component stack', componentStack)
    }

    try {
      if (typeof window !== 'undefined') {
        ;(window as any).__philani_last_render_error = {
          ts: Date.now(),
          message: safeMessage,
          stack: safeStack,
          componentStack,
          href,
        }
      }
    } catch {
      // ignore
    }

    this.setState({ componentStack })
  }

  private getIsHookMismatch(error: Error | null) {
    const msg = String((error as any)?.message || '')
    return msg.includes('Rendered more hooks than during the previous render') || msg.includes('Minified React error #310') || msg.includes('invariant=310')
  }

  render() {
    const { error, componentStack } = this.state
    if (!error) return this.props.children

    const isHookMismatch = this.getIsHookMismatch(error)
    const href = typeof window !== 'undefined' ? window.location.href : ''
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
    const details = [
      formatErrorBlock('Message', String((error as any)?.message || error)),
      formatErrorBlock('Stack', (error as any)?.stack ? String((error as any).stack) : ''),
      formatErrorBlock('Component stack', componentStack),
      formatErrorBlock('Route', href),
      formatErrorBlock('User agent', ua),
    ].filter(Boolean).join('\n\n')

    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-lg font-semibold">Client render error</div>
          <div className="mt-1 text-sm text-white/70">
            {isHookMismatch
              ? 'A client-side render error occurred. This is usually caused by a component calling React hooks conditionally.'
              : 'A client-side error occurred while rendering this page.'}
          </div>

          <div className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
            {String((error as any)?.message || error)}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (typeof window === 'undefined') return
                window.location.reload()
              }}
            >
              Reload
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                if (typeof window === 'undefined') return
                window.location.href = '/dashboard'
              }}
            >
              Go to dashboard
            </button>
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-white/70">Details</summary>
            <pre className="mt-2 text-xs whitespace-pre-wrap break-words text-white/70">
{details}
            </pre>
          </details>
        </div>
      </div>
    )
  }
}
