import { useCallback, useEffect, useRef, useState } from 'react'

export function useJaasToken(room?: string) {
  const [token, setToken] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const refreshing = useRef(false)
  const timer = useRef<any>(null)

  const fetchToken = useCallback(async () => {
    if (refreshing.current) return
    refreshing.current = true
    try {
      const res = await fetch('/api/jaas/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room }),
      })
      if (!res.ok) throw new Error('Failed to fetch token')
      const data = await res.json()
      setToken(data.token)
      setExpiresAt(data.expiresAt)
    } catch (err) {
      console.error('token fetch error', err)
      setToken(null)
      setExpiresAt(null)
    } finally {
      refreshing.current = false
    }
  }, [room])

  useEffect(() => {
    fetchToken()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [fetchToken])

  useEffect(() => {
    if (!expiresAt) return
    const now = Date.now()
    const refreshAt = expiresAt - 60_000
    const ms = Math.max(0, refreshAt - now)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      fetchToken()
    }, ms)
    return () => clearTimeout(timer.current)
  }, [expiresAt, fetchToken])

  return { token, expiresAt, refresh: fetchToken }
}
