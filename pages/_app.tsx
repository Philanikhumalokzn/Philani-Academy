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
  origin?: string
  raw?: string
  href: string
  timestamp: number
}

const serializeClientErrorValue = (value: unknown, maxChars = 20000): string => {
  if (value == null) return ''
  try {
    const seen = new WeakSet<object>()
    const text = typeof value === 'string'
      ? value
      : JSON.stringify(value, (_key, current) => {
          if (typeof current === 'function') return '[function]'
          if (current && typeof current === 'object') {
            if (typeof Element !== 'undefined' && current instanceof Element) {
              return `[element ${current.tagName.toLowerCase()}]`
            }
            if (typeof Window !== 'undefined' && current instanceof Window) {
              return '[window]'
            }
            if (seen.has(current)) return '[circular]'
            seen.add(current)
          }
          return current
        }, 2)
    if (!text) return ''
    if (text.length <= maxChars) return text
    return `${text.slice(0, maxChars)}\n...truncated...`
  } catch {
    try {
      return String(value)
    } catch {
      return ''
    }
  }
}

const collectClientErrorSources = (value: unknown): string[] => {
  if (!value || typeof value !== 'object') return []
  const anyValue = value as any
  const values = [
    anyValue?.filename,
    anyValue?.fileName,
    anyValue?.sourceURL,
    anyValue?.url,
    anyValue?.src,
    anyValue?.target?.src,
    anyValue?.target?.href,
    anyValue?.currentTarget?.src,
    anyValue?.currentTarget?.href,
  ]
  return Array.from(new Set(values.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)))
}

const formatClientErrorValue = (value: unknown): { name?: string; message: string; stack?: string; source?: string; origin?: string; raw?: string } => {
  const raw = serializeClientErrorValue(value) || undefined
  if (value instanceof Error) {
    return {
      name: value.name || 'Error',
      message: value.message || String(value),
      stack: value.stack || '',
      origin: value.constructor?.name || 'Error',
      raw,
    }
  }
  if (typeof value === 'object' && value) {
    const queue: unknown[] = [value]
    const seen = new WeakSet<object>()
    let name: string | undefined
    let message = ''
    let stack = ''
    let source = ''
    let origin = ''

    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) continue

      if (current instanceof Error) {
        name ||= current.name || 'Error'
        message ||= current.message || String(current)
        stack ||= current.stack || ''
        origin ||= current.constructor?.name || 'Error'
        continue
      }

      if (typeof current === 'string') {
        message ||= current
        continue
      }

      if (typeof current !== 'object') continue
      if (seen.has(current)) continue
      seen.add(current)

      const anyValue = current as any
      name ||= typeof anyValue?.name === 'string' ? anyValue.name : undefined
      message ||= [anyValue?.message, anyValue?.reason, anyValue?.statusText].find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) || ''
      stack ||= typeof anyValue?.stack === 'string' ? anyValue.stack : ''
      source ||= collectClientErrorSources(anyValue)[0] || ''
      origin ||= typeof anyValue?.constructor?.name === 'string' ? anyValue.constructor.name : ''

      if (anyValue?.error) queue.push(anyValue.error)
      if (anyValue?.reason) queue.push(anyValue.reason)
      if (anyValue?.detail) queue.push(anyValue.detail)
      if (anyValue?.cause) queue.push(anyValue.cause)
      if (anyValue?.data) queue.push(anyValue.data)
    }

    return {
      name,
      message: message || getChunkErrorText(value) || raw || 'Unknown client error',
      stack,
      source,
      origin: origin || undefined,
      raw,
    }
  }
  if (typeof value === 'string') {
    return { message: value, raw }
  }
  return { message: getChunkErrorText(value) || raw || 'Unknown client error', raw }
}

const isIgnorableNonFatalClientError = (value: unknown): boolean => {
  const details = formatClientErrorValue(value)
  const haystack = [
    details.name || '',
    details.message || '',
    details.stack || '',
    details.source || '',
    details.origin || '',
    details.raw || '',
  ].join(' ')
  const normalized = haystack.toLowerCase()

  const isIinkSymbolsSyncError = normalized.includes("cannot read properties of undefined (reading 'symbols')")
    && (
      normalized.includes('iink')
      || normalized.includes('interactiveinkssreditor')
      || normalized.includes('historymanager')
      || normalized.includes('customevent')
    )

  const isIinkActionBoundaryError = (
    normalized.includes('undo not allowed')
    || normalized.includes('redo not allowed')
    || normalized.includes('clear not allowed')
    || normalized.includes('convert not allowed')
    || normalized.includes('export not allowed')
    || normalized.includes('import not allowed')
  ) && (
    normalized.includes('iink')
    || normalized.includes('interactiveinkssreditor')
    || normalized.includes('historymanager')
    || normalized.includes('customevent')
    || normalized.includes('promise rejection')
  )

  const isBroadMyScriptCanvasError = normalized.includes('iink')
    || normalized.includes('interactiveinkssreditor')
    || normalized.includes('historymanager')
    || normalized.includes('myscript')
    || normalized.includes('webdemoapi.myscript.com')
    || normalized.includes('session closed due to no activity')
    || normalized.includes('inactive session')
    || normalized.includes('session too long')
    || normalized.includes('max session duration')

  return isIinkSymbolsSyncError || isIinkActionBoundaryError || isBroadMyScriptCanvasError
}

const isStackedCanvasSilentErrorMode = (): boolean => {
  if (typeof window === 'undefined') return false
  return Boolean((window as any).__philani_silence_stacked_canvas_errors)
}

const formatClientErrorDetails = (error: GlobalClientErrorState) => {
  const blocks = [
    `Kind:\n${error.kind}`,
    error.name ? `Name:\n${error.name}` : '',
    error.origin ? `Origin:\n${error.origin}` : '',
    `Message:\n${error.message}`,
    error.source ? `Source:\n${error.source}` : '',
    error.stack ? `Stack:\n${error.stack}` : '',
    error.raw ? `Raw payload:\n${error.raw}` : '',
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

      if (isStackedCanvasSilentErrorMode()) {
        event.preventDefault?.()
        try {
          ;(window as any).__philani_last_ignored_client_error = {
            kind: 'stacked-canvas-global-suppress',
            href: window.location.href,
            timestamp: Date.now(),
            details: formatClientErrorValue(event?.error || event || event?.message),
          }
        } catch {
          // ignore
        }
        return
      }

      if (isIgnorableNonFatalClientError(event) || isIgnorableNonFatalClientError(event?.error) || isIgnorableNonFatalClientError(event?.message)) {
        event.preventDefault?.()
        try {
          ;(window as any).__philani_last_ignored_client_error = {
            kind: 'iink-symbols-sync',
            href: window.location.href,
            timestamp: Date.now(),
            details: formatClientErrorValue(event?.error || event || event?.message),
          }
        } catch {
          // ignore
        }
        return
      }

      event.preventDefault?.()

      const details = formatClientErrorValue(event?.error || event || event?.message || 'Unknown window error')
      const locationSource = event?.filename ? `${event.filename}:${event.lineno || 0}:${event.colno || 0}` : ''
      const combinedSource = [details.source, locationSource].filter(Boolean).join('\n')
      const nextError: GlobalClientErrorState = {
        kind: 'error',
        name: details.name,
        message: details.message,
        stack: details.stack,
        source: combinedSource,
        origin: details.origin || 'ErrorEvent',
        raw: details.raw,
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

      if (isStackedCanvasSilentErrorMode()) {
        event.preventDefault?.()
        try {
          ;(window as any).__philani_last_ignored_client_error = {
            kind: 'stacked-canvas-global-suppress',
            href: window.location.href,
            timestamp: Date.now(),
            details: formatClientErrorValue(event?.reason || event),
          }
        } catch {
          // ignore
        }
        return
      }

      if (isIgnorableNonFatalClientError(event) || isIgnorableNonFatalClientError(event?.reason)) {
        event.preventDefault?.()
        try {
          ;(window as any).__philani_last_ignored_client_error = {
            kind: 'iink-symbols-sync',
            href: window.location.href,
            timestamp: Date.now(),
            details: formatClientErrorValue(event?.reason || event),
          }
        } catch {
          // ignore
        }
        return
      }

      event.preventDefault?.()

      const details = formatClientErrorValue(event?.reason)
      const nextError: GlobalClientErrorState = {
        kind: 'unhandledrejection',
        name: details.name,
        message: details.message,
        stack: details.stack,
        source: details.source || 'Promise rejection',
        origin: details.origin || 'PromiseRejectionEvent',
        raw: details.raw,
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

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const [{ Capacitor }, { StatusBar, Style }] = await Promise.all([
          import('@capacitor/core'),
          import('@capacitor/status-bar'),
        ])

        if (cancelled || !Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
          return
        }

        await StatusBar.setStyle({ style: Style.Light })
      } catch {
        // ignore native status bar failures outside Capacitor shells
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

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
        <meta name="theme-color" content="#ffffff" />

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
