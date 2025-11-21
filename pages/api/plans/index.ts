import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserRole } from '../../../lib/auth'
import Stripe from 'stripe'

// Prefer STRIPE_SECRET_KEY (used in DEPLOY_TO_VERCEL.md) but fall back to
// the older STRIPE_SECRET for backward compatibility.
const stripeSecret = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET || ''
const stripe = stripeSecret ? new Stripe(stripeSecret, { apiVersion: '2022-11-15' }) : null

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
    if (!stripe) {
      return res.status(501).json({ message: 'Stripe is not configured for plan creation. Enable PayFast or set STRIPE_SECRET_KEY.' })
    }
    try {
      const product = await stripe.products.create({ name })
      const price = await stripe.prices.create({ unit_amount: amount, currency: currency || 'usd', recurring: { interval: 'month' }, product: product.id })
      const plan = await (prisma as any).subscriptionPlan.create({ data: { name, amount, currency: currency || 'usd', stripePriceId: price.id, active: true } })
      return res.status(201).json(plan)
    } catch (err: any) {
      console.error('POST /api/plans error', err)
      return res.status(500).json({ message: err.message || 'Server error' })
    }
  }

  // admin-only delete by id in body { id }
  if (method === 'DELETE') {
    const role = await getUserRole(req as any)
    if (role !== 'admin') return res.status(403).json({ message: 'Forbidden' })
    const { id } = req.body || {}
    if (!id) return res.status(400).json({ message: 'Missing id' })
    try {
      await (prisma as any).subscriptionPlan.delete({ where: { id } })
      return res.status(200).json({ message: 'Deleted' })
    } catch (err: any) {
      console.error('DELETE /api/plans error', err)
      return res.status(500).json({ message: err.message || 'Server error' })
    }
  }

  res.setHeader('Allow', ['GET','POST','DELETE'])
  return res.status(405).end()
}
