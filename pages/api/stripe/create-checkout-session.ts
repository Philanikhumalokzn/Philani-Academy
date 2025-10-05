import type { NextApiRequest, NextApiResponse } from 'next'
import Stripe from 'stripe'
import prisma from '../../../lib/prisma'

// Prefer STRIPE_SECRET_KEY (used in DEPLOY_TO_VERCEL.md) but fall back to
// the older STRIPE_SECRET for backward compatibility.
const stripeSecret = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET || ''
const stripe = new Stripe(stripeSecret, { apiVersion: '2022-11-15' })

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { planId } = req.body || {}
    let plan
    if (planId) {
      plan = await (prisma as any).subscriptionPlan.findUnique({ where: { id: planId } })
    } else {
      plan = await (prisma as any).subscriptionPlan.findFirst({ where: { active: true } })
    }

    if (!plan || !plan.stripePriceId) {
      // fallback to environment price id if configured
      const fallbackPrice = process.env.STRIPE_PRICE_ID
      if (!fallbackPrice) return res.status(400).json({ message: 'No plan configured' })
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: fallbackPrice, quantity: 1 }],
        success_url: `${process.env.NEXTAUTH_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.NEXTAUTH_URL}/dashboard`
      })
      return res.status(200).json({ url: session.url })
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${process.env.NEXTAUTH_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXTAUTH_URL}/dashboard`
    })
    res.status(200).json({ url: session.url })
  } catch (err: any) {
    res.status(500).json({ message: err.message })
  }
}
