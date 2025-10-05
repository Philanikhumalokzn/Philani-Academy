import type { NextApiRequest, NextApiResponse } from 'next'
import Stripe from 'stripe'
import prisma from '../../../lib/prisma'

const stripe = new Stripe(process.env.STRIPE_SECRET || '', { apiVersion: '2022-11-15' })

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
