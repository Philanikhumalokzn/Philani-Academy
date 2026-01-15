import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserRole } from '../../../lib/auth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query
  if (!id || Array.isArray(id)) {
    return res.status(400).json({ message: 'Invalid plan id' })
  }

  if (req.method !== 'PATCH') {
    res.setHeader('Allow', ['PATCH'])
    return res.status(405).end()
  }

  const role = await getUserRole(req as any)
  if (role !== 'admin') return res.status(403).json({ message: 'Forbidden' })

  const { name, amount, currency, active } = req.body || {}
  const data: Record<string, any> = {}

  if (typeof name !== 'undefined') {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) return res.status(400).json({ message: 'Name is required' })
    data.name = trimmed
  }

  if (typeof amount !== 'undefined') {
    const parsed = typeof amount === 'string' ? parseInt(amount, 10) : amount
    if (!Number.isFinite(parsed)) return res.status(400).json({ message: 'Amount must be a number (cents)' })
    const intAmount = Math.round(Number(parsed))
    if (Number.isNaN(intAmount) || intAmount <= 0) {
      return res.status(400).json({ message: 'Amount must be greater than zero (in cents)' })
    }
    if (intAmount < 500) {
      return res.status(400).json({ message: 'PayFast subscriptions require at least 500 cents (R5.00)' })
    }
    data.amount = intAmount
  }

  if (typeof currency !== 'undefined') {
    if (typeof currency !== 'string' || !currency.trim()) {
      return res.status(400).json({ message: 'Currency must be a string' })
    }
    data.currency = currency.trim().toLowerCase()
  }

  if (typeof active !== 'undefined') {
    data.active = Boolean(active)
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ message: 'No changes supplied' })
  }

  try {
    const plan = await (prisma as any).subscriptionPlan.update({ where: { id }, data })
    return res.status(200).json(plan)
  } catch (err: any) {
    console.error('PATCH /api/plans/[id] error', err)
    return res.status(500).json({ message: err.message || 'Server error' })
  }
}
