import { useCallback, useEffect, useState } from 'react'

declare global {
  interface Window {
    payfast_do_onsite_payment?: (payload: { uuid: string }) => void
    payfastCallback?: (status: any) => void
    payfastPaymentStatus?: (status: any) => void
  }
}

const PAYFAST_ENABLED = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.NEXT_PUBLIC_PAYFAST_ONSITE ?? '').toLowerCase()
)
const PAYFAST_SANDBOX = String(process.env.NEXT_PUBLIC_PAYFAST_SANDBOX ?? 'true').toLowerCase() !== 'false'
const PAYFAST_SCRIPT_URL =
  process.env.NEXT_PUBLIC_PAYFAST_SCRIPT_URL || (PAYFAST_SANDBOX ? 'https://sandbox.payfast.co.za/onsite/engine.js' : 'https://www.payfast.co.za/onsite/engine.js')

type Plan = { id: string; name: string; amount: number; currency: string; active?: boolean }

export default function Subscribe() {
  const [loading, setLoading] = useState(false)
  const [plans, setPlans] = useState<Array<Plan>>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [payfastReady, setPayfastReady] = useState(!PAYFAST_ENABLED)
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

  useEffect(() => {
    if (!PAYFAST_ENABLED) return
    if (document.querySelector('script[data-payfast-engine]')) {
      setPayfastReady(true)
      return
    }

    const script = document.createElement('script')
    script.src = PAYFAST_SCRIPT_URL
    script.async = true
    script.defer = true
    script.dataset.payfastEngine = 'true'
    script.onload = () => setPayfastReady(true)
    script.onerror = () => {
      setPayfastReady(false)
      setStatusMessage('Could not load PayFast Secure Checkout. Please refresh or contact support.')
    }
    document.body.appendChild(script)

    return () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script)
      }
    }
  }, [])

  useEffect(() => {
    if (!PAYFAST_ENABLED) return

    const handleStatus = (status: any) => {
      setLoading(false)
      if (!status) return
      const result = typeof status === 'string' ? { status } : status
      switch ((result.status || '').toUpperCase()) {
        case 'COMPLETE':
        case 'COMPLETED':
          setStatusMessage('Payment complete! We will confirm your subscription shortly.')
          break
        case 'CANCELLED':
        case 'CANCELED':
          setStatusMessage('Payment was cancelled before completion.')
          break
        case 'FAILED':
          setStatusMessage('Payment failed. Please try again or contact support.')
          break
        default:
          setStatusMessage('Payment update received. You can close the PayFast window if it is still open.')
          break
      }
    }

    window.payfastCallback = handleStatus
    window.payfastPaymentStatus = handleStatus

    return () => {
      delete window.payfastCallback
      delete window.payfastPaymentStatus
    }
  }, [])

  const startCheckout = useCallback(async () => {
    if (!selectedPlanId) {
      alert('Please select a plan')
      return
    }

    setLoading(true)
    setStatusMessage(null)

    try {
      if (PAYFAST_ENABLED) {
        if (!payfastReady || typeof window.payfast_do_onsite_payment !== 'function') {
          setStatusMessage('PayFast is still initialising. Please wait a moment and try again.')
          return
        }

        const res = await fetch('/api/payfast/onsite-token', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId: selectedPlanId }),
        })

        const data = await res.json().catch(() => null)

        if (!res.ok || !data?.uuid) {
          const message = data?.message || 'Could not start PayFast checkout.'
          setStatusMessage(message)
          return
        }

        setStatusMessage('Secure PayFast checkout opened. Complete the steps in the popup to finish subscribing.')
        window.payfast_do_onsite_payment?.({ uuid: data.uuid })
        return
      }

      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: selectedPlanId }),
      })

      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        alert(data.message || 'Error creating checkout session')
      }
    } catch (err: any) {
      console.error('Subscribe checkout error', err)
      setStatusMessage(err?.message || 'Unexpected error while starting checkout.')
    } finally {
      setLoading(false)
    }
  }, [selectedPlanId, payfastReady])

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
              {loading ? 'Starting…' : PAYFAST_ENABLED ? 'Subscribe with PayFast' : 'Subscribe'}
            </button>
            {statusMessage && <p className="mt-3 text-sm text-slate-600">{statusMessage}</p>}
            {PAYFAST_ENABLED && !payfastReady && (
              <p className="mt-2 text-xs text-slate-500">Loading secure PayFast checkout…</p>
            )}
          </>
        ) : (
          <p>No subscription plans available. Contact admin.</p>
        )}
      </div>
    </main>
  )
}
