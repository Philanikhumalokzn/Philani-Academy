import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'

export default function VerifyEmailPage() {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('Preparing verification...')

  useEffect(() => {
    const tokenParam = router.query.token
    if (!router.isReady) return

    const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam
    if (!token) {
      setStatus('error')
      setMessage('Verification token missing. Please use the link from your email.')
      return
    }

    setStatus('loading')
    setMessage('Verifying your email address...')

    const verify = async () => {
      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        })
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data?.message || 'Verification failed')
        }
        const followUp = data?.phoneVerificationPending
          ? 'Email verified. Phone verification will be completed separately.'
          : 'Email verified. You can now sign in.'
        setStatus('success')
        setMessage(followUp)
      } catch (err: any) {
        setStatus('error')
        setMessage(err?.message || 'We could not verify your email. Please request a new link.')
      }
    }

    verify()
  }, [router])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
        <h1 className="text-2xl font-semibold mb-4">Email Verification</h1>
        <p className="text-gray-700 mb-6">{message}</p>
        {status === 'success' && (
          <button
            type="button"
            className="w-full py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700"
            onClick={() => router.push('/api/auth/signin')}
          >
            Continue to sign in
          </button>
        )}
        {status === 'error' && (
          <button
            type="button"
            className="w-full py-3 bg-gray-200 text-gray-900 font-medium rounded-md hover:bg-gray-300"
            onClick={() => router.push('/')}
          >
            Return home
          </button>
        )}
      </div>
    </div>
  )
}
