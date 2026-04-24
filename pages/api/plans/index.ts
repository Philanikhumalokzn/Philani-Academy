import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserRole } from '../../../lib/auth'

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
      const plan = await (prisma as any).subscriptionPlan.create({ data: { name, amount, currency: currency || 'zar', active: true } })
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
