import '../styles/globals.css'
import 'katex/dist/katex.min.css'
import 'react-image-crop/dist/ReactCrop.css'
import '@excalidraw/excalidraw/index.css'
import type { AppProps } from 'next/app'
import { SessionProvider } from 'next-auth/react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { useEffect } from 'react'
import NavBar from '../components/NavBar'
import MobileTopChrome from '../components/MobileTopChrome'
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

export default function App({ Component, pageProps: { session, ...pageProps } }: AppProps) {
  const router = useRouter()
  const hideNavBar = router.pathname === '/board'
    || router.pathname === '/diagram'
    || router.pathname === '/jaas-demo'
    || router.pathname === '/sessions/[sessionId]/assignments/[assignmentId]/q/[questionId]'
    || router.pathname === '/sessions/[sessionId]/assignments/[assignmentId]/solution/[questionId]'
    || router.pathname === '/challenges/[id]'

  const hideMobileTopChrome = router.pathname === '/board'
    || router.pathname === '/diagram'
    || router.pathname === '/jaas-demo'
    || router.pathname === '/sessions/[sessionId]/assignments/[assignmentId]/q/[questionId]'
    || router.pathname === '/sessions/[sessionId]/assignments/[assignmentId]/solution/[questionId]'

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
      }
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isRecoverableChunkLoadError(event?.reason)) {
        reloadForChunkRecoveryOnce()
      }
    }

    window.addEventListener('error', onWindowError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)

    return () => {
      window.removeEventListener('error', onWindowError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

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
      <div className="app-shell">
        {!hideNavBar && <NavBar />}
        {!hideMobileTopChrome && <MobileTopChrome />}
        <OverlayRestoreProvider>
          <AppErrorBoundary key={router.pathname}>
            <Component {...pageProps} />
          </AppErrorBoundary>
        </OverlayRestoreProvider>
      </div>
    </SessionProvider>
  )
}
