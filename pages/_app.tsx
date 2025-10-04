import '../styles/globals.css'
import type { AppProps } from 'next/app'
import { SessionProvider } from 'next-auth/react'
import Head from 'next/head'
import NavBar from '../components/NavBar'

export default function App({ Component, pageProps: { session, ...pageProps } }: AppProps) {
  return (
    <SessionProvider session={session}>
      <Head>
        <title>Philani Academy</title>
        <meta name="description" content="Philani Academy — online sessions and learning for your community." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />

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
      <NavBar />
      <Component {...pageProps} />
    </SessionProvider>
  )
}
