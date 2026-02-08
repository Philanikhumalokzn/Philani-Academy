import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useSession } from 'next-auth/react'

import NavArrows from '../components/NavArrows'
import FullScreenGlassOverlay from '../components/FullScreenGlassOverlay'

const defaultMobileHeroBg = (() => {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#020b35"/>
      <stop offset="0.55" stop-color="#041448"/>
      <stop offset="1" stop-color="#031641"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1d4ed8" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#60a5fa" stop-opacity="0.15"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#sky)"/>
  <circle cx="1540" cy="260" r="220" fill="url(#glow)"/>
  <path d="M0 850 L420 620 L720 760 L980 560 L1280 720 L1600 600 L1920 760 L1920 1080 L0 1080 Z" fill="#041a5a" opacity="0.9"/>
  <path d="M0 910 L360 740 L660 860 L920 720 L1220 860 L1500 760 L1920 900 L1920 1080 L0 1080 Z" fill="#052a7a" opacity="0.55"/>
  <path d="M0 980 L420 920 L860 1000 L1220 940 L1580 1010 L1920 960 L1920 1080 L0 1080 Z" fill="#00122f" opacity="0.65"/>
</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
})()

type Plan = { id: string; name: string; amount: number; currency: string; active?: boolean }

const formatAmount = (amount: number, currency?: string) => `${(amount / 100).toFixed(2)} ${(currency || 'zar').toUpperCase()}`

export default function Subscribe() {
  const router = useRouter()
  const { data: session } = useSession()
  const [loading, setLoading] = useState(false)
  const [plans, setPlans] = useState<Array<Plan>>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const [mobileHeroBgUrl, setMobileHeroBgUrl] = useState<string>(defaultMobileHeroBg)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const userKey = session?.user?.email || (session as any)?.user?.id || session?.user?.name || 'anon'
    const storageKey = `pa:mobileHeroBg:${userKey}`
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw && typeof raw === 'string') setMobileHeroBgUrl(raw)
    } catch {}
  }, [session])

  useEffect(() => {
    fetch('/api/plans')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setPlans(data)
          setSelectedPlanId((data.find((p: any) => p.active) || data[0]).id)
        }
      })
      .catch(() => setPlans([]))
  }, [])

  const startCheckout = useCallback(async () => {
    if (!selectedPlanId) {
      alert('Please select a plan')
      return
    }

    setLoading(true)
    setStatusMessage(null)

    try {
      const res = await fetch('/api/payfast/checkout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: selectedPlanId })
      })

      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.action || !data?.fields) {
        const message = data?.message || 'Could not prepare PayFast checkout. Please try again.'
        setStatusMessage(message)
        return
      }

      const form = document.createElement('form')
      form.method = 'POST'
      form.action = data.action
      form.style.display = 'none'

      Object.entries(data.fields as Record<string, string>).forEach(([key, value]) => {
        const input = document.createElement('input')
        input.type = 'hidden'
        input.name = key
        input.value = value
        form.appendChild(input)
      })

      document.body.appendChild(form)
      form.submit()
    } catch (err: any) {
      console.error('Subscribe checkout error', err)
      setStatusMessage(err?.message || 'Unexpected error while starting checkout.')
    } finally {
      setLoading(false)
    }
  }, [selectedPlanId])

  return (
    <>
      <main className="deep-page min-h-screen px-4 py-6 md:py-12 overflow-x-hidden hidden md:block">
        <div className="mx-auto w-full max-w-4xl space-y-6 md:space-y-8">
          <section className="hero flex-col gap-6">
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <NavArrows backHref="/dashboard" forwardHref={undefined} />
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="board-chip">PayFast secure checkout</span>
                <span className="board-chip">ZAR billing</span>
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-[12px] uppercase tracking-[0.35em] text-blue-200">Subscriptions</p>
              <h1 className="text-3xl font-semibold md:text-4xl">Choose your Philani Academy plan</h1>
              <p className="text-sm text-white md:text-base">
                Plans stay light, mobile-first, and aligned with the no-scroll classrooms. Select the plan that matches your grade bundle, then we hand you off to a POPIA-ready PayFast form.
              </p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/5 px-5 py-4 text-sm text-white">
              Need to update billing details first? Visit your <Link className="text-blue-200 underline" href="/profile">profile</Link> or read the <Link className="text-blue-200 underline" href="/privacy">privacy notice</Link>.
            </div>
          </section>

          <section className="card p-5 md:p-6 space-y-5">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold">Pick a plan to activate</h2>
              <p className="text-sm text-white">
                Active plans appear first. We surface the same cards learners see in the dashboard so everything feels consistent.
              </p>
            </div>

            {plans.length > 0 ? (
              <div className="space-y-4">
                <div className="space-y-3">
                  {plans.map(plan => (
                    <label
                      key={plan.id}
                      className={`flex flex-col gap-1 rounded-2xl border px-4 py-3 transition-colors sm:flex-row sm:items-center sm:justify-between ${
                        selectedPlanId === plan.id
                          ? 'border-blue-400 bg-white/10 shadow-lg'
                          : 'border-white/10 hover:border-white/30'
                      }`}
                    >
                      <div>
                        <p className="text-base font-semibold text-white">{plan.name}</p>
                        <p className="text-sm text-white">
                          {formatAmount(plan.amount, plan.currency)} {plan.active ? '• Currently active' : ''}
                        </p>
                      </div>
                      <input
                        type="radio"
                        name="plan"
                        value={plan.id}
                        checked={selectedPlanId === plan.id}
                        onChange={() => setSelectedPlanId(plan.id)}
                        className="h-5 w-5 accent-blue-500"
                      />
                    </label>
                  ))}
                </div>

                <button onClick={startCheckout} disabled={loading} className="btn btn-primary w-full">
                  {loading ? 'Preparing PayFast…' : 'Subscribe with PayFast'}
                </button>
                {statusMessage && <p className="text-sm text-amber-200">{statusMessage}</p>}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white">
                No subscription plans are published yet. Ping an admin so they can flip one live from the dashboard.
              </div>
            )}
          </section>
        </div>
      </main>

      <main className="mobile-dashboard-theme relative min-h-screen overflow-hidden text-white md:hidden">
        <div
          className="absolute inset-0"
          style={{ backgroundImage: `url(${mobileHeroBgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#020b35]/70 via-[#041448]/55 to-[#031641]/70" aria-hidden="true" />

        <FullScreenGlassOverlay
          title="Subscriptions"
          subtitle="Choose your Philani Academy plan"
          onClose={() => router.push('/dashboard')}
          onBackdropClick={() => router.push('/dashboard')}
          zIndexClassName="z-40"
          className="md:hidden"
          frameClassName="absolute inset-0 px-2 pt-3 pb-3"
          panelClassName="rounded-3xl bg-white/5"
          contentClassName="p-4"
        >
          <div className="mx-auto w-full max-w-4xl space-y-6">
                <section className="hero flex-col gap-6">
                  <div className="flex w-full flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="board-chip">PayFast secure checkout</span>
                      <span className="board-chip">ZAR billing</span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <p className="text-[12px] uppercase tracking-[0.35em] text-blue-200">Subscriptions</p>
                    <h1 className="text-3xl font-semibold">Choose your Philani Academy plan</h1>
                    <p className="text-sm text-white">
                      Select a plan that matches your grade bundle, then continue to secure PayFast checkout.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/15 bg-white/5 px-5 py-4 text-sm text-white">
                    Manage your details in your <Link className="text-blue-200 underline" href="/profile">profile</Link>. Read our{' '}
                    <Link className="text-blue-200 underline" href="/privacy">privacy notice</Link>.
                  </div>
                </section>

                <section className="card p-5 space-y-5">
                  <div className="space-y-1">
                    <h2 className="text-xl font-semibold">Pick a plan to activate</h2>
                    <p className="text-sm text-white">Pick a plan and continue to checkout.</p>
                  </div>

                  {plans.length > 0 ? (
                    <div className="space-y-4">
                      <div className="space-y-3">
                        {plans.map(plan => (
                          <label
                            key={plan.id}
                            className={`flex flex-col gap-1 rounded-2xl border px-4 py-3 transition-colors sm:flex-row sm:items-center sm:justify-between ${
                              selectedPlanId === plan.id
                                ? 'border-blue-400 bg-white/10 shadow-lg'
                                : 'border-white/10 hover:border-white/30'
                            }`}
                          >
                            <div>
                              <p className="text-base font-semibold text-white">{plan.name}</p>
                              <p className="text-sm text-white">
                                {formatAmount(plan.amount, plan.currency)} {plan.active ? '• Currently active' : ''}
                              </p>
                            </div>
                            <input
                              type="radio"
                              name="plan"
                              value={plan.id}
                              checked={selectedPlanId === plan.id}
                              onChange={() => setSelectedPlanId(plan.id)}
                              className="h-5 w-5 accent-blue-500"
                            />
                          </label>
                        ))}
                      </div>

                      <button onClick={startCheckout} disabled={loading} className="btn btn-primary w-full">
                        {loading ? 'Preparing PayFast…' : 'Subscribe with PayFast'}
                      </button>
                      {statusMessage && <p className="text-sm text-amber-200">{statusMessage}</p>}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white">
                      No subscription plans are available yet. Please check back soon.
                    </div>
                  )}
                </section>
          </div>
        </FullScreenGlassOverlay>
      </main>
    </>
  )
}
