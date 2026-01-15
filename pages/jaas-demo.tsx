import dynamic from 'next/dynamic'
import React from 'react'
import Link from 'next/link'
import NavArrows from '../components/NavArrows'

const SimpleJitsiEmbed = dynamic(() => import('../components/SimpleJitsiEmbed'), { ssr: false })

export default function JaaSDemoPage() {
  const roomName = 'vpaas-magic-cookie-06c4cf69d5104db0a1814b907036bfa4/SampleAppAliveIntensitiesSurveyFerociously'
  return (
    <main className="deep-page min-h-screen overflow-hidden">
      <div className="h-[100svh] flex flex-col">
        <div className="px-4 py-3 border-b border-white/10 bg-white/5">
          <div className="mx-auto w-full max-w-6xl flex items-center justify-between gap-3">
            <NavArrows backHref="/dashboard" forwardHref={undefined} />
            <Link href="/dashboard" className="btn btn-ghost text-sm">Back</Link>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <SimpleJitsiEmbed roomName={roomName} height="100%" />
        </div>
      </div>
    </main>
  )
}
