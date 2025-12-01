import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import NavArrows from '../components/NavArrows'

type Plan = { id: string; name: string; amount: number; currency: string; active?: boolean }

const formatAmount = (amount: number, currency?: string) => `${(amount / 100).toFixed(2)} ${(currency || 'zar').toUpperCase()}`

export default function Subscribe() {
  const [loading, setLoading] = useState(false)
  const [plans, setPlans] = useState<Array<Plan>>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

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
    <main className="deep-page min-h-screen px-4 py-8 md:py-12">
      <div className="mx-auto w-full max-w-4xl space-y-8">
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
            <p className="text-sm text-slate-200 md:text-base">
              Plans stay light, mobile-first, and aligned with the no-scroll classrooms. Select the plan that matches your grade bundle, then we hand you off to a POPIA-ready PayFast form.
            </p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/5 px-5 py-4 text-sm text-slate-100">
            Need to update billing details first? Visit your <Link className="text-blue-200 underline" href="/profile">profile</Link> or read the <Link className="text-blue-200 underline" href="/privacy">privacy notice</Link>.
          </div>
        </section>

        <section className="card p-6 space-y-5">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">Pick a plan to activate</h2>
            <p className="text-sm text-slate-300">
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
                      <p className="text-sm text-slate-300">
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
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
              No subscription plans are published yet. Ping an admin so they can flip one live from the dashboard.
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
