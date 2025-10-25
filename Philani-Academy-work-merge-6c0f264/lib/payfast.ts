export function generatePayfastSignature(params: Record<string, any>) {
  // PayFast requires a URL-encoded query string sorted by parameter name
  const keys = Object.keys(params).sort()
  const encoded = keys.map(k => `${k}=${encodeURIComponent(params[k])}`).join('&')
  // If passphrase is set, append it to the string for signature generation
  const passphrase = process.env.PAYFAST_PASSPHRASE || ''
  const stringToSign = passphrase ? `${encoded}&passphrase=${encodeURIComponent(passphrase)}` : encoded
  // MD5 hash for signature
  const crypto = require('crypto')
  return crypto.createHash('md5').update(stringToSign).digest('hex')
}

export function getPayfastUrl(sandbox = true) {
  return sandbox ? 'https://sandbox.payfast.co.za/eng/process' : 'https://www.payfast.co.za/eng/process'
}
