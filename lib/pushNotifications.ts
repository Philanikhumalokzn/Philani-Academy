import { getMessaging } from 'firebase-admin/messaging'
import prisma from './prisma'
import { getFirebaseAdminApp, isFirebaseAdminConfigured } from './firebaseAdmin'

type PushPayload = {
  title: string
  body: string
  data?: Record<string, string | number | boolean | null | undefined>
}

function normalizeDataValue(value: string | number | boolean | null | undefined) {
  if (value == null) return ''
  return String(value)
}

function normalizePushData(data?: PushPayload['data']) {
  if (!data) return undefined
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, normalizeDataValue(value)])
  )
}

function isInvalidTokenCode(code?: string) {
  return code === 'messaging/registration-token-not-registered'
    || code === 'messaging/invalid-registration-token'
    || code === 'messaging/invalid-argument'
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  if (!userId || !isFirebaseAdminConfigured()) {
    return { deliveredCount: 0, skipped: true }
  }

  const devices = await prisma.pushDevice.findMany({
    where: { userId, enabled: true },
    select: { id: true, token: true },
  })

  if (devices.length === 0) {
    return { deliveredCount: 0, skipped: true }
  }

  try {
    const messaging = getMessaging(getFirebaseAdminApp())
    const response = await messaging.sendEachForMulticast({
      tokens: devices.map((device) => device.token),
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: normalizePushData(payload.data),
      android: {
        priority: 'high',
        notification: {
          channelId: 'default',
          sound: 'default',
        },
      },
    })

    const invalidDeviceIds = response.responses
      .map((result, index) => ({ result, device: devices[index] }))
      .filter(({ result }) => !result.success && isInvalidTokenCode(result.error?.code))
      .map(({ device }) => device.id)

    if (invalidDeviceIds.length > 0) {
      await prisma.pushDevice.updateMany({
        where: { id: { in: invalidDeviceIds } },
        data: { enabled: false },
      })
    }

    return {
      deliveredCount: response.successCount,
      skipped: false,
    }
  } catch (err) {
    if (process.env.DEBUG === '1') console.error('sendPushToUser failed', err)
    return { deliveredCount: 0, skipped: true, error: err }
  }
}