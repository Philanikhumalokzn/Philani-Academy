const FALLBACK_FROM = process.env.MAIL_FROM_ADDRESS || 'no-reply@philani.test'

function logFallback(email: string, verificationUrl: string) {
  console.info('[mail:dev] Email verification link issued', { email, verificationUrl })
}

export async function sendEmailVerification(email: string, verificationUrl: string) {
  if (!email || !verificationUrl) {
    throw new Error('Missing email verification payload')
  }

  const provider = (process.env.MAIL_PROVIDER || '').toLowerCase()

  if (!provider) {
    logFallback(email, verificationUrl)
    return
  }

  switch (provider) {
    default:
      logFallback(email, verificationUrl)
      return
  }
}

export function getDefaultFromAddress() {
  return FALLBACK_FROM
}
