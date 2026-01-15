import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserIdFromReq } from '../../../lib/auth'
import {
  createSignedSubscriptionPayload,
  formatAmountCents,
  getPayfastProcessUrl
} from '../../../lib/payfast'

function resolveBaseUrl() {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL.replace(/\/$/, '')
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return ''
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).end()
  }

  try {
    const userId = await getUserIdFromReq(req)
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    const { planId } = req.body || {}
    if (!planId || typeof planId !== 'string') {
      return res.status(400).json({ message: 'planId is required' })
    }

    const [plan, user] = await Promise.all([
      (prisma as any).subscriptionPlan.findUnique({ where: { id: planId } }),
      prisma.user.findUnique({ where: { id: userId } } as any)
    ])

    if (!plan) return res.status(404).json({ message: 'Plan not found' })
    if (!user) return res.status(404).json({ message: 'User not found' })

    if (!plan.active) {
      return res.status(400).json({ message: 'Selected plan is inactive' })
    }

    const merchantId = process.env.PAYFAST_MERCHANT_ID
    const merchantKey = process.env.PAYFAST_MERCHANT_KEY
    if (!merchantId || !merchantKey) {
      return res.status(500).json({ message: 'PayFast merchant settings missing' })
    }

    const passphrase = process.env.PAYFAST_PASSPHRASE || undefined

    const baseUrl = resolveBaseUrl()
    if (!baseUrl) {
      return res.status(500).json({ message: 'Missing NEXTAUTH_URL or APP_BASE_URL' })
    }

    const today = new Date()
    const billingDate = today.toISOString().split('T')[0]
    const amountDecimal = formatAmountCents(plan.amount)

    const [firstName, ...restName] = (user.name || 'Philani Learner').trim().split(/\s+/)
    const lastName = restName.length > 0 ? restName.join(' ') : 'Learner'

    const paramSource = {
      merchant_id: merchantId,
      merchant_key: merchantKey,
      return_url: `${baseUrl}/subscribe?status=success`,
      cancel_url: `${baseUrl}/subscribe?status=cancelled`,
      notify_url: `${baseUrl}/api/payfast/notify`,
      name_first: firstName,
      name_last: lastName,
      email_address: user.email,
      m_payment_id: `${plan.id}:${user.id}`,
      amount: amountDecimal,
      item_name: plan.name,
      item_description: plan.name,
      custom_int1: plan.amount,
      custom_str1: plan.id,
      custom_str2: user.id,
      subscription_type: '1',
      billing_date: billingDate,
      recurring_amount: amountDecimal,
      frequency: '3',
      cycles: '0',
      subscription_notify_email: '1',
      subscription_notify_buyer: '1'
    }

    const { payload } = createSignedSubscriptionPayload(paramSource, passphrase)

    const action = getPayfastProcessUrl(process.env.PAYFAST_SANDBOX !== 'false')

    return res.status(200).json({ action, fields: payload })
  } catch (err: any) {
    console.error('POST /api/payfast/checkout error', err)
    return res.status(500).json({ message: err?.message || 'Unexpected error' })
  }
}
