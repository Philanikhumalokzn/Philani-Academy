import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'

const SUCCESS_STATUSES = new Set(['COMPLETE', 'COMPLETED', 'PAID', 'SUCCESS'])

export const config = {
  api: { bodyParser: false }
}

async function getRawBody(req: NextApiRequest) {
  return new Promise<string>((resolve, reject) => {
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', err => reject(err))
  })
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const raw = await getRawBody(req)

    const validateUrl = process.env.PAYFAST_SANDBOX !== 'false'
      ? 'https://sandbox.payfast.co.za/eng/query/validate'
      : 'https://www.payfast.co.za/eng/query/validate'

    // Post the raw body back to PayFast for validation
    const fetchRes = await fetch(validateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: raw
    })

    const text = await fetchRes.text()
    if (!text.includes('VALID')) {
      console.warn('PayFast IPN invalid', text)
      return res.status(400).end()
    }

    // Parse params
    const params = new URLSearchParams(raw)
    const custom = params.get('custom_str1')
    const subscriberId = params.get('custom_str2')
    const pfPaymentId = params.get('pf_payment_id') || params.get('payment_id') || null
    const paymentStatus = params.get('payment_status') || params.get('status') || 'UNKNOWN'

    if (custom) {
      // custom_str1 contains our plan id in create-plan flow
      try {
        await (prisma as any).subscriptionPlan.update({ where: { id: custom }, data: { payfastPlanId: pfPaymentId, active: true } })
      } catch (err) {
        console.error('Failed to update plan from PayFast notify', err)
      }
    }

    // You should store the full notification in a payments table for auditing.
    console.log('PayFast IPN validated, status=', paymentStatus, 'user=', subscriberId, 'pf_id=', pfPaymentId)

    // Subscription activation (minimal): for successful recurring payments, grant 31 days access.
    // PayFast frequency is configured as monthly in our checkout (frequency=3).
    const planId = params.get('custom_str1')
    if (subscriberId && SUCCESS_STATUSES.has(paymentStatus.toUpperCase())) {
      const activeUntil = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000)
      try {
        await (prisma as any).userSubscription.upsert({
          where: { userId: subscriberId },
          create: {
            userId: subscriberId,
            provider: 'payfast',
            planId: planId || null,
            status: 'active',
            activeUntil
          },
          update: {
            provider: 'payfast',
            planId: planId || null,
            status: 'active',
            activeUntil
          }
        })
      } catch (err) {
        console.error('Failed to upsert user subscription from PayFast notify', err)
      }
    }
    res.status(200).end()
  } catch (err: any) {
    console.error('Error in PayFast notify handler', err)
    res.status(500).end()
  }
}
