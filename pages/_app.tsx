import '../styles/globals.css'
import 'katex/dist/katex.min.css'
import 'react-image-crop/dist/ReactCrop.css'
import '@excalidraw/excalidraw/index.css'
import type { AppProps } from 'next/app'
import { SessionProvider } from 'next-auth/react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import AppErrorBoundary from '../components/AppErrorBoundary'
import { OverlayRestoreProvider } from '../lib/overlayRestore'

const CHUNK_RECOVERY_RELOAD_KEY = 'pa:chunk-recovery-reload:v1'
const CHUNK_RECOVERY_RELOAD_WINDOW_MS = 60_000

const getChunkErrorText = (value: unknown): string => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (value instanceof Error) return `${value.name || ''} ${value.message || ''}`.trim()
  if (typeof value === 'object') {
    const anyValue = value as any
    const name = typeof anyValue?.name === 'string' ? anyValue.name : ''
    const message = typeof anyValue?.message === 'string' ? anyValue.message : ''
    const reason = typeof anyValue?.reason === 'string' ? anyValue.reason : ''
    const text = `${name} ${message} ${reason}`.trim()
    if (text) return text
  }
  try {
    return String(value)
  } catch {
    return ''
  }
}

const isRecoverableChunkLoadError = (value: unknown): boolean => {
  const text = getChunkErrorText(value).toLowerCase()
  if (!text) return false
  return (
    text.includes('chunkloaderror')
    || text.includes('loading chunk')
    || text.includes('failed to fetch dynamically imported module')
    || text.includes('dynamically imported module')
    || text.includes('importing a module script failed')
    || text.includes('/_next/static/')
  )
}

const reloadForChunkRecoveryOnce = () => {
  if (typeof window === 'undefined') return
  try {
    const raw = window.sessionStorage.getItem(CHUNK_RECOVERY_RELOAD_KEY)
    const lastTs = raw ? Number(raw) : 0
    const tooSoon = Number.isFinite(lastTs) && lastTs > 0 && (Date.now() - lastTs) < CHUNK_RECOVERY_RELOAD_WINDOW_MS
    if (tooSoon) return
    window.sessionStorage.setItem(CHUNK_RECOVERY_RELOAD_KEY, String(Date.now()))
  } catch {
    // ignore storage failures
  }
  window.location.reload()
}

type GlobalClientErrorState = {
  kind: 'error' | 'unhandledrejection'
  name?: string
  message: string
  stack?: string
  source?: string
  href: string
  timestamp: number
}

const formatClientErrorValue = (value: unknown): { name?: string; message: string; stack?: string } => {
  if (value instanceof Error) {
    return {
      name: value.name || 'Error',
      message: value.message || String(value),
      stack: value.stack || '',
    }
  }
  if (typeof value === 'object' && value) {
    const anyValue = value as any
    const name = typeof anyValue?.name === 'string' ? anyValue.name : undefined
    const message = typeof anyValue?.message === 'string'
      ? anyValue.message
      : getChunkErrorText(value) || 'Unknown client error'
    const stack = typeof anyValue?.stack === 'string' ? anyValue.stack : ''
    return { name, message, stack }
  }
  if (typeof value === 'string') {
    return { message: value }
  }
  return { message: getChunkErrorText(value) || 'Unknown client error' }
}

const formatClientErrorDetails = (error: GlobalClientErrorState) => {
  const blocks = [
    `Kind:\n${error.kind}`,
    error.name ? `Name:\n${error.name}` : '',
    `Message:\n${error.message}`,
    error.source ? `Source:\n${error.source}` : '',
    error.stack ? `Stack:\n${error.stack}` : '',
    `Route:\n${error.href}`,
    `Timestamp:\n${new Date(error.timestamp).toISOString()}`,
  ].filter(Boolean)
  return blocks.join('\n\n')
}

function GlobalClientErrorOverlay({ error, onDismiss }: { error: GlobalClientErrorState; onDismiss: () => void }) {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-white/5 p-5 shadow-2xl">
        <div className="text-lg font-semibold">Client runtime error</div>
        <div className="mt-1 text-sm text-white/70">
          An unhandled client-side error occurred. The details below are from the actual browser exception instead of the generic production error page.
        </div>

        <div className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          {error.name ? `${error.name}: ` : ''}{error.message}
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
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        </div>

        <details className="mt-4" open>
          <summary className="cursor-pointer text-sm text-white/70">Details</summary>
          <pre className="mt-2 text-xs whitespace-pre-wrap break-words text-white/70">
            {formatClientErrorDetails(error)}
          </pre>
        </details>
      </div>
    </div>
  )
}

export default function App({ Component, pageProps: { session, ...pageProps } }: AppProps) {
  const router = useRouter()
  const [clientError, setClientError] = useState<GlobalClientErrorState | null>(null)
  const hideNavBar = router.pathname === '/board'
    || router.pathname === '/diagram'
    || router.pathname === '/jaas-demo'
    || router.pathname === '/sessions/[sessionId]/assignments/[assignmentId]/q/[questionId]'
    || router.pathname === '/sessions/[sessionId]/assignments/[assignmentId]/solution/[questionId]'
    || router.pathname === '/challenges/[id]'

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // ignore
      })
    }
    window.addEventListener('load', onLoad)
    return () => window.removeEventListener('load', onLoad)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const onWindowError = (event: ErrorEvent) => {
      if (isRecoverableChunkLoadError(event?.error) || isRecoverableChunkLoadError(event?.message) || isRecoverableChunkLoadError(event?.filename)) {
        reloadForChunkRecoveryOnce()
        return
      }

      const details = formatClientErrorValue(event?.error || event?.message || 'Unknown window error')
      const nextError: GlobalClientErrorState = {
        kind: 'error',
        name: details.name,
        message: details.message,
        stack: details.stack,
        source: event?.filename ? `${event.filename}:${event.lineno || 0}:${event.colno || 0}` : '',
        href: window.location.href,
        timestamp: Date.now(),
      }
      try {
        ;(window as any).__philani_last_client_error = nextError
      } catch {
        // ignore
      }
      setClientError(nextError)
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isRecoverableChunkLoadError(event?.reason)) {
        reloadForChunkRecoveryOnce()
        return
      }

      const details = formatClientErrorValue(event?.reason)
      const nextError: GlobalClientErrorState = {
        kind: 'unhandledrejection',
        name: details.name,
        message: details.message,
        stack: details.stack,
        source: 'Promise rejection',
        href: window.location.href,
        timestamp: Date.now(),
      }
      try {
        ;(window as any).__philani_last_client_error = nextError
      } catch {
        // ignore
      }
      setClientError(nextError)
    }

    window.addEventListener('error', onWindowError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)

    return () => {
      window.removeEventListener('error', onWindowError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

  useEffect(() => {
    setClientError(null)
  }, [router.asPath])

  if (clientError) {
    return (
      <SessionProvider session={session}>
        <Head>
          <title>Philani Academy</title>
        </Head>
        <GlobalClientErrorOverlay error={clientError} onDismiss={() => setClientError(null)} />
      </SessionProvider>
    )
  }

  return (
    <SessionProvider session={session}>
      <Head>
        <title>Philani Academy</title>
        <meta name="description" content="Philani Academy — online sessions and learning for your community." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/philani-logo.png" type="image/png" />
        <link rel="apple-touch-icon" href="/philani-logo.png" />
        <meta name="theme-color" content="#000000" />

        {/* Open Graph */}
        <meta property="og:title" content="Philani Academy" />
        <meta property="og:description" content="Philani Academy — online sessions and learning for your community." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://philani-academy.vercel.app" />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Philani Academy" />
        <meta name="twitter:description" content="Philani Academy — online sessions and learning for your community." />
      </Head>
      <AppErrorBoundary key={router.asPath}>
        <div className="app-shell">
          {!hideNavBar && <NavBar />}
          <OverlayRestoreProvider>
            <Component {...pageProps} />
          </OverlayRestoreProvider>
        </div>
      </AppErrorBoundary>
    </SessionProvider>
  )
}
