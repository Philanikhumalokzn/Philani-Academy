import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserIdFromReq } from '../../../lib/auth'
import { generatePayfastSignature, getPayfastOnsiteUrl, getPayfastSignatureDebug } from '../../../lib/payfast'

const isSandbox = process.env.PAYFAST_SANDBOX !== 'false'
const onsiteUrl = getPayfastOnsiteUrl(isSandbox)

const pfRequiredEnv = ['PAYFAST_MERCHANT_ID', 'PAYFAST_MERCHANT_KEY'] as const

function resolveBaseUrl() {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return ''
}

type OnsiteSuccess = {
  uuid: string
  environment: 'sandbox' | 'live'
}

type OnsiteError = {
  message: string
  code?: number | string
}

function splitName(fullName?: string | null) {
  if (!fullName) {
    return { first: 'Philani', last: 'Learner' }
  }
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) {
    return { first: parts[0], last: 'Learner' }
  }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OnsiteSuccess | OnsiteError>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const missing = pfRequiredEnv.filter(key => !process.env[key])
  if (missing.length > 0) {
    return res.status(500).json({ message: `PayFast misconfigured: missing ${missing.join(', ')}` })
  }

  const baseUrl = resolveBaseUrl()
  if (!baseUrl) {
    return res.status(500).json({ message: 'Missing NEXTAUTH_URL or APP_BASE_URL for PayFast callbacks' })
  }

  const userId = await getUserIdFromReq(req)
  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' })
  }

  try {
    const { planId } = req.body || {}
    if (!planId) {
      return res.status(400).json({ message: 'planId is required' })
    }

    const [plan, user] = await Promise.all([
      (prisma as any).subscriptionPlan.findUnique({ where: { id: planId } }),
      prisma.user.findUnique({ where: { id: userId } } as any),
    ])

    if (!plan) {
      return res.status(404).json({ message: 'Plan not found' })
    }

    if (!user) {
      return res.status(404).json({ message: 'User profile not found' })
    }

    const merchant_id = process.env.PAYFAST_MERCHANT_ID as string
    const merchant_key = process.env.PAYFAST_MERCHANT_KEY as string
    const normalizedBaseUrl = baseUrl.replace(/\/$/, '')
    const returnUrl = `${normalizedBaseUrl}/subscribe?status=success`
    const cancelUrl = `${normalizedBaseUrl}/subscribe?status=cancelled`
    const notifyUrl = `${normalizedBaseUrl}/api/payfast/notify`

    const amount = typeof plan.amount === 'number' ? (plan.amount / 100).toFixed(2) : '0.00'

    const billingDate = new Date()
    const billingDateStr = billingDate.toISOString().split('T')[0]

    const { first, last } = splitName(user.name)

    const payload: Record<string, any> = {
      merchant_id,
      merchant_key,
      amount,
      item_name: plan.name,
      email_address: user.email,
      name_first: first,
      name_last: last,
      return_url: returnUrl,
      cancel_url: cancelUrl,
      notify_url: notifyUrl,
      custom_str1: plan.id,
      custom_str2: user.id,
      subscription_type: '1',
      billing_date: billingDateStr,
      recurring_amount: amount,
      frequency: '3',
      cycles: '0',
    }

    const signature = generatePayfastSignature(payload)

    if (process.env.DEBUG === '1') {
      const sigDebug = getPayfastSignatureDebug(payload)
      console.log('[payfast] payload', JSON.stringify(payload))
      console.log('[payfast] signature string', sigDebug.stringToSign)
      console.log('[payfast] signature md5', signature)
    }

    const response = await fetch(onsiteUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ ...payload, signature }),
    })

    const raw = await response.text()
    let data: any = null
    try {
      data = raw ? JSON.parse(raw) : null
    } catch (err) {
      if (process.env.DEBUG === '1') {
        console.log('[payfast] non-json response body', raw?.slice(0, 500) || '(empty)')
      }
    }

    if (!response.ok || !data || typeof data.uuid !== 'string') {
      const message = data?.message || data?.description || (raw ? raw.slice(0, 200) : 'Failed to initiate PayFast payment')
      if (process.env.DEBUG === '1') {
        console.error('[payfast] onsite error', response.status, raw)
      }
      return res.status(response.status || 500).json({ message, code: data?.code })
    }

    if (data.code !== 0) {
      return res.status(400).json({ message: data?.description || 'PayFast rejected payment', code: data.code })
    }

    return res.status(200).json({ uuid: data.uuid, environment: isSandbox ? 'sandbox' : 'live' })
  } catch (err: any) {
    console.error('PayFast onsite token error', err)
    return res.status(500).json({ message: err?.message || 'Unexpected error' })
  }
}
