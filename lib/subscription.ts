import prisma from './prisma'

export type SubscriptionStatus = {
  active: boolean
  activeUntil: Date | null
}

export async function getUserSubscriptionStatus(userId: string): Promise<SubscriptionStatus> {
  if (!userId) return { active: false, activeUntil: null }

  const row = await (prisma as any).userSubscription?.findUnique?.({
    where: { userId },
    select: { status: true, activeUntil: true }
  })

  const status = (row?.status || 'inactive').toString().toLowerCase()
  const activeUntil = row?.activeUntil ? new Date(row.activeUntil) : null
  const active = status === 'active' && !!activeUntil && activeUntil.getTime() > Date.now()

  return { active, activeUntil }
}

export function subscriptionRequiredResponse() {
  return { status: 402, body: { message: 'Subscription required' } }
}
