import '../styles/globals.css'
import 'katex/dist/katex.min.css'
import 'react-image-crop/dist/ReactCrop.css'
import type { AppProps } from 'next/app'
import { SessionProvider } from 'next-auth/react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import NavBar from '../components/NavBar'
import MobileTopChrome from '../components/MobileTopChrome'
import AppErrorBoundary from '../components/AppErrorBoundary'
import { OverlayRestoreProvider } from '../lib/overlayRestore'

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
