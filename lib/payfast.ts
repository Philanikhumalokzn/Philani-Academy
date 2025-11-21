type SignatureParts = {
  encoded: string
  stringToSign: string
}

function buildSignatureParts(params: Record<string, any>): SignatureParts {
  const keys = Object.keys(params)
    .filter(key => typeof params[key] !== 'undefined' && params[key] !== null && key.toLowerCase() !== 'signature')
    .sort()

  const encoded = keys.map(k => `${k}=${encodeURIComponent(params[k])}`).join('&')
  const passphrase = process.env.PAYFAST_PASSPHRASE || ''
  const stringToSign = passphrase ? `${encoded}&passphrase=${encodeURIComponent(passphrase)}` : encoded
  return { encoded, stringToSign }
}

export function getPayfastSignatureDebug(params: Record<string, any>): SignatureParts {
  return buildSignatureParts(params)
}

const MERCHANT_FIELDS = [
  'merchant_id',
  'merchant_key',
  'return_url',
  'cancel_url',
  'notify_url',
  'fica_id'
] as const

const CUSTOMER_FIELDS = [
  'name_first',
  'name_last',
  'email_address',
  'cell_number'
] as const

const TRANSACTION_FIELDS = [
  'm_payment_id',
  'amount',
  'item_name',
  'item_description',
  'custom_int1',
  'custom_int2',
  'custom_int3',
  'custom_int4',
  'custom_int5',
  'custom_str1',
  'custom_str2',
  'custom_str3',
  'custom_str4',
  'custom_str5'
] as const

const TRANSACTION_OPTIONS = [
  'email_confirmation',
  'confirmation_address'
] as const

const PAYMENT_METHOD_FIELDS = ['payment_method'] as const

const SUBSCRIPTION_FIELDS = [
  'subscription_type',
  'billing_date',
  'recurring_amount',
  'frequency',
  'cycles',
  'subscription_notify_email',
  'subscription_notify_webhook',
  'subscription_notify_buyer'
] as const

const ALL_FIELD_SEQUENCE = [
  ...MERCHANT_FIELDS,
  ...CUSTOMER_FIELDS,
  ...TRANSACTION_FIELDS,
  ...TRANSACTION_OPTIONS,
  ...PAYMENT_METHOD_FIELDS,
  ...SUBSCRIPTION_FIELDS
]

type PayfastValue = string | number | boolean | null | undefined

function normaliseValue(value: PayfastValue): string {
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return Number.isFinite(value) ? value.toString() : ''
  if (typeof value === 'string') return value
  if (value === null || typeof value === 'undefined') return ''
  return String(value)
}

function encodePayfastValue(value: PayfastValue) {
  const trimmed = normaliseValue(value).trim()
  if (trimmed === '') return ''
  // encodeURIComponent uses upper-case hex already, but we enforce it and replace spaces with + as per docs
  const encoded = encodeURIComponent(trimmed)
    .replace(/%20/g, '+')
    .replace(/%[0-9a-f]{2}/gi, match => match.toUpperCase())
  return encoded
}

function buildParameterString(params: Record<string, PayfastValue>, fieldOrder = ALL_FIELD_SEQUENCE) {
  const pairs: string[] = []

  for (const field of fieldOrder) {
    if (Object.prototype.hasOwnProperty.call(params, field)) {
      const encodedValue = encodePayfastValue(params[field])
      if (encodedValue !== '') {
        pairs.push(`${field}=${encodedValue}`)
      }
    }
  }

  // Append any additional fields that were not part of the official order at the end, preserving original key order.
  Object.keys(params).forEach(key => {
    if (fieldOrder.includes(key as any)) return
    if (key.toLowerCase() === 'signature') return
    const encodedValue = encodePayfastValue(params[key])
    if (encodedValue !== '') {
      pairs.push(`${key}=${encodedValue}`)
    }
  })

  return pairs.join('&')
}

export function generatePayfastSignature(params: Record<string, PayfastValue>, passphrase?: string) {
  const parameterString = buildParameterString(params)
  const stringToHash = passphrase
    ? `${parameterString}&passphrase=${encodePayfastValue(passphrase)}`
    : parameterString

  const crypto = require('crypto')
  return crypto.createHash('md5').update(stringToHash).digest('hex')
}

export function buildSubscriptionPayload(input: Record<string, PayfastValue>) {
  const payload: Record<string, string> = {}
  ALL_FIELD_SEQUENCE.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      const normalised = normaliseValue(input[field]).trim()
      if (normalised !== '') payload[field] = normalised
    }
  })
  // Include any extra keys (e.g. setup for split payments)
  Object.keys(input).forEach(key => {
    if (key.toLowerCase() === 'signature') return
    if (ALL_FIELD_SEQUENCE.includes(key as any)) return
    const normalised = normaliseValue(input[key]).trim()
    if (normalised !== '') payload[key] = normalised
  })
  return payload
}

export function createSignedSubscriptionPayload(params: Record<string, PayfastValue>, passphrase?: string) {
  const payload = buildSubscriptionPayload(params)
  const signature = generatePayfastSignature(payload, passphrase)
  return { payload: { ...payload, signature }, signature }
}

export function formatAmountCents(amountInCents: number) {
  const cents = Math.round(amountInCents)
  return (cents / 100).toFixed(2)
}

export const PAYFAST_ENDPOINTS = {
  liveProcess: 'https://www.payfast.co.za/eng/process',
  sandboxProcess: 'https://sandbox.payfast.co.za/eng/process',
  liveOnsite: 'https://www.payfast.co.za/onsite/process',
  sandboxOnsite: 'https://sandbox.payfast.co.za/onsite/process',
  liveValidate: 'https://www.payfast.co.za/eng/query/validate',
  sandboxValidate: 'https://sandbox.payfast.co.za/eng/query/validate'
}

export function getPayfastProcessUrl(isSandbox: boolean) {
  return isSandbox ? PAYFAST_ENDPOINTS.sandboxProcess : PAYFAST_ENDPOINTS.liveProcess
}

export function getPayfastValidateUrl(isSandbox: boolean) {
  return isSandbox ? PAYFAST_ENDPOINTS.sandboxValidate : PAYFAST_ENDPOINTS.liveValidate
}

export function getPayfastOnsiteUrl(isSandbox = true) {
  return isSandbox ? PAYFAST_ENDPOINTS.sandboxOnsite : PAYFAST_ENDPOINTS.liveOnsite
}

export function getPayfastUrl(sandbox = true) {
  return sandbox ? 'https://sandbox.payfast.co.za/eng/process' : 'https://www.payfast.co.za/eng/process'
}

export function getPayfastOnsiteUrl(sandbox = true) {
  return sandbox ? 'https://sandbox.payfast.co.za/onsite/process' : 'https://www.payfast.co.za/onsite/process'
}

export function getPayfastOnsiteScriptUrl(sandbox = true) {
  return sandbox ? 'https://sandbox.payfast.co.za/onsite/engine.js' : 'https://www.payfast.co.za/onsite/engine.js'
}
