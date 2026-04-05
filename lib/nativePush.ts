import { signOut } from 'next-auth/react'

export const NATIVE_PUSH_TOKEN_STORAGE_KEY = 'pa:native-push-token:v1'

export function getStoredNativePushToken() {
  if (typeof window === 'undefined') return ''
  try {
    return String(window.localStorage.getItem(NATIVE_PUSH_TOKEN_STORAGE_KEY) || '').trim()
  } catch {
    return ''
  }
}

export function storeNativePushToken(token: string) {
  if (typeof window === 'undefined') return
  try {
    if (token) window.localStorage.setItem(NATIVE_PUSH_TOKEN_STORAGE_KEY, token)
    else window.localStorage.removeItem(NATIVE_PUSH_TOKEN_STORAGE_KEY)
  } catch {
    // ignore storage failures
  }
}

export async function unregisterStoredNativePushToken() {
  const token = getStoredNativePushToken()
  if (!token) return

  try {
    await fetch('/api/push/unregister', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
  } catch {
    // ignore best-effort cleanup failures
  }

  storeNativePushToken('')
}

export async function signOutWithPushCleanup(options?: Parameters<typeof signOut>[0]) {
  await unregisterStoredNativePushToken()
  return signOut(options)
}