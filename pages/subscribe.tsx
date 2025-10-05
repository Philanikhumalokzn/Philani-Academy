import { useEffect, useState } from 'react'

export default function Subscribe() {
  const [loading, setLoading] = useState(false)
  const [plans, setPlans] = useState<Array<{ id: string; name: string; amount: number; currency: string; active?: boolean }>>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/plans')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setPlans(data)
          setSelectedPlanId((data.find((p: any) => p.active) || data[0]).id)
        }
      })
  }, [])

  async function startCheckout() {
    if (!selectedPlanId) return alert('Please select a plan')
    setLoading(true)
    const res = await fetch('/api/stripe/create-checkout-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: selectedPlanId }) })
    const data = await res.json()
    if (data.url) window.location.href = data.url
    else alert(data.message || 'Error creating checkout session')
    setLoading(false)
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white shadow p-8 rounded">
        <h2 className="text-xl font-bold mb-4">Subscribe to Philani Academy</h2>
        {plans.length > 0 ? (
          <>
            <div className="mb-4">
              {plans.map((p) => (
                <label key={p.id} className="block mb-2">
                  <input type="radio" name="plan" value={p.id} checked={selectedPlanId === p.id} onChange={() => setSelectedPlanId(p.id)} className="mr-2" />
                  {p.name} - {(p.amount / 100).toFixed(2)} {p.currency.toUpperCase()} {p.active ? '(active)' : ''}
                </label>
              ))}
            </div>
            <button onClick={startCheckout} disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded">
              {loading ? 'Starting...' : `Subscribe`}
            </button>
          </>
        ) : (
          <>
            <p>No subscription plans available. Contact admin.</p>
          </>
        )}
      </div>
    </main>
  )
}
