import { useState } from 'react'

export default function Subscribe() {
  const [loading, setLoading] = useState(false)

  async function startCheckout() {
    setLoading(true)
    const res = await fetch('/api/stripe/create-checkout-session', { method: 'POST' })
    const data = await res.json()
    if (data.url) window.location.href = data.url
    else alert('Error creating checkout session')
    setLoading(false)
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white shadow p-8 rounded">
        <h2 className="text-xl font-bold mb-4">Subscribe to Philani Academy</h2>
        <p className="mb-4">This will take you to Stripe checkout (test mode).</p>
        <button onClick={startCheckout} disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded">
          {loading ? 'Starting...' : 'Subscribe (test)'}
        </button>
      </div>
    </main>
  )
}
