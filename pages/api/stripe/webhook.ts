import type { NextApiRequest, NextApiResponse } from 'next'

export const config = { api: { bodyParser: false } }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Placeholder: handle Stripe webhook events here
  res.status(200).json({ received: true })
}
