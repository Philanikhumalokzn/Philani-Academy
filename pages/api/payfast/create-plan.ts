import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserRole } from '../../../lib/auth'
import { generatePayfastSignature, getPayfastUrl } from '../../../lib/payfast'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const role = await getUserRole(req as any)
  if (role !== 'admin') return res.status(403).json({ message: 'Forbidden' })

  const { name, amount, currency } = req.body || {}
  if (!name || !amount) return res.status(400).json({ message: 'Missing fields' })

  try {
    // Create local plan record. For PayFast we store plan metadata locally and
    // use the merchant_id/key to create a signed redirect for checkout.
    const plan = await (prisma as any).subscriptionPlan.create({ data: { name, amount, currency: currency || 'ZAR', active: true } })

    const merchant_id = process.env.PAYFAST_MERCHANT_ID || ''
    const merchant_key = process.env.PAYFAST_MERCHANT_KEY || ''
    if (!merchant_id || !merchant_key) return res.status(500).json({ message: 'PayFast not configured' })

    const payload: any = {
      merchant_id,
      merchant_key,
      amount: (amount / 100).toFixed(2), // PayFast expects decimal amount in currency units
      item_name: name,
      return_url: `${process.env.NEXTAUTH_URL}/dashboard`,
      cancel_url: `${process.env.NEXTAUTH_URL}/dashboard`,
      notify_url: `${process.env.NEXTAUTH_URL}/api/payfast/notify`,
      custom_str1: plan.id // store plan id to reconcile in notify webhook
    }

    const signature = generatePayfastSignature(payload)
    const action = getPayfastUrl(process.env.PAYFAST_SANDBOX !== 'false')

    return res.status(201).json({ plan, action, payload, signature })
  } catch (err: any) {
    console.error('POST /api/payfast/create-plan error', err)
    return res.status(500).json({ message: err.message || 'Server error' })
  }
}
