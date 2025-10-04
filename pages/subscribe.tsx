import { useEffect, useState } from 'react'

export default function Subscribe() {
  const [loading, setLoading] = useState(false)
  const [plan, setPlan] = useState<{ name: string; amount: number; currency: string } | null>(null)

  useEffect(() => {
    fetch('/api/plans')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) setPlan(data[0])
      })
  }, [])

  async function startCheckout() {
    setLoading(true)
    const res = await fetch('/api/stripe/create-checkout-session', { method: 'POST' })
    const data = await res.json()
    if (data.url) window.location.href = data.url
    else alert(data.message || 'Error creating checkout session')
    setLoading(false)
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white shadow p-8 rounded">
        <h2 className="text-xl font-bold mb-4">Subscribe to Philani Academy</h2>
        {plan ? (
          <>
            <p className="mb-2">Plan: {plan.name}</p>
            <p className="mb-4">Price: {(plan.amount / 100).toFixed(2)} {plan.currency.toUpperCase()}</p>
            <button onClick={startCheckout} disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded">
              {loading ? 'Starting...' : `Subscribe - ${(plan.amount / 100).toFixed(2)} ${plan.currency.toUpperCase()}`}
            </button>
          </>
        ) : (
          <p>No active subscription plan. Contact admin.</p>
        )}
      </div>
    </main>
  )
}
