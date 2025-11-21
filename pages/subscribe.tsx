import { useCallback, useEffect, useState } from 'react'

type Plan = { id: string; name: string; amount: number; currency: string; active?: boolean }

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
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white shadow p-8 rounded">
        <h2 className="text-xl font-bold mb-4">Subscribe to Philani Academy</h2>
        {plans.length > 0 ? (
          <>
            <div className="mb-4">
              {plans.map(p => (
                <label key={p.id} className="block mb-2">
                  <input
                    type="radio"
                    name="plan"
                    value={p.id}
                    checked={selectedPlanId === p.id}
                    onChange={() => setSelectedPlanId(p.id)}
                    className="mr-2"
                  />
                  {p.name} - {(p.amount / 100).toFixed(2)} {(p.currency || 'zar').toUpperCase()} {p.active ? '(active)' : ''}
                </label>
              ))}
            </div>
            <button onClick={startCheckout} disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded w-full">
              {loading ? 'Preparing…' : 'Subscribe with PayFast'}
            </button>
            {statusMessage && <p className="mt-3 text-sm text-slate-600">{statusMessage}</p>}
          </>
        ) : (
          <p>No subscription plans available. Contact admin.</p>
        )}
      </div>
    </main>
  )
}
