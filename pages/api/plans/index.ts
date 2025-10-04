import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserRole } from '../../../lib/auth'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET || '', { apiVersion: '2022-11-15' })

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method
  if (method === 'GET') {
    const plans = await (prisma as any).subscriptionPlan.findMany({ where: {}, orderBy: { createdAt: 'asc' } })
    return res.status(200).json(plans)
  }

  // admin-only create
  if (method === 'POST') {
    const role = await getUserRole(req as any)
    if (role !== 'admin') return res.status(403).json({ message: 'Forbidden' })
    const { name, amount, currency } = req.body || {}
    if (!name || !amount) return res.status(400).json({ message: 'Missing fields' })
    try {
      // create Stripe product + price
      const product = await stripe.products.create({ name })
      const price = await stripe.prices.create({ unit_amount: amount, currency: currency || 'usd', recurring: { interval: 'month' }, product: product.id })
  const plan = await (prisma as any).subscriptionPlan.create({ data: { name, amount, currency: currency || 'usd', stripePriceId: price.id, active: true } })
      return res.status(201).json(plan)
    } catch (err: any) {
      console.error('POST /api/plans error', err)
      return res.status(500).json({ message: err.message || 'Server error' })
    }
  }

  res.setHeader('Allow', ['GET','POST'])
  return res.status(405).end()
}
