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

function parseBooleanSetting(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'y', 'on', 'enabled'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off', 'disabled'].includes(normalized)) return false
  return null
}

/**
 * Global kill-switch for subscription gating.
 *
 * Default behavior is to keep gating enabled (fail-closed) unless explicitly disabled
 * via DB setting `AppSetting(key='subscriptionGatingEnabled')`.
 */
export async function isSubscriptionGatingEnabled(): Promise<boolean> {
  const envDefault = parseBooleanSetting(process.env.SUBSCRIPTION_GATING_ENABLED)

  try {
    const row = await (prisma as any).appSetting?.findUnique?.({
      where: { key: 'subscriptionGatingEnabled' },
      select: { value: true }
    })

    const dbValue = parseBooleanSetting(row?.value)
    if (dbValue !== null) return dbValue
  } catch {
    // ignore: migrations may not be applied yet
  }

  // default to enabled for safety
  return envDefault ?? true
}

export async function setSubscriptionGatingEnabled(enabled: boolean): Promise<void> {
  if (!(prisma as any).appSetting?.upsert) {
    throw new Error('AppSetting model unavailable (run Prisma migrations)')
  }

  await (prisma as any).appSetting.upsert({
    where: { key: 'subscriptionGatingEnabled' },
    create: { key: 'subscriptionGatingEnabled', value: enabled ? 'true' : 'false' },
    update: { value: enabled ? 'true' : 'false' }
  })
}

export function subscriptionRequiredResponse() {
  return { status: 402, body: { message: 'Subscription required' } }
}
