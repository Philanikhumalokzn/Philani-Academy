import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserRole } from '../../../lib/auth'
import { formatAmountCents } from '../../../lib/payfast'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const role = await getUserRole(req as any)
  if (role !== 'admin') return res.status(403).json({ message: 'Forbidden' })

  const { name, amount } = req.body || {}
  if (!name || (typeof amount === 'undefined') || amount === null || amount === '') {
    return res.status(400).json({ message: 'Name and amount are required' })
  }

  const parsedAmount = typeof amount === 'string' ? parseInt(amount, 10) : Number(amount)
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ message: 'Amount must be a positive number (cents)' })
  }

  const intAmount = Math.round(parsedAmount)
  if (intAmount < 500) {
    return res.status(400).json({ message: 'PayFast subscriptions require at least R5.00 (500 cents)' })
  }

  const normalizedCurrency = 'zar'

  try {
    const plan = await (prisma as any).subscriptionPlan.create({
      data: {
        name: name.trim(),
        amount: intAmount,
        currency: normalizedCurrency,
        active: true
      }
    })

    return res.status(201).json({
      plan,
      displayAmount: formatAmountCents(plan.amount)
    })
  } catch (err: any) {
    console.error('POST /api/payfast/create-plan error', err)
    return res.status(500).json({ message: err.message || 'Server error' })
  }
}
