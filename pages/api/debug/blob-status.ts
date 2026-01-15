import type { NextApiRequest, NextApiResponse } from 'next'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN
  const hasToken = Boolean(token && token.length > 10)
  return res.status(200).json({
    hasToken,
    message: hasToken ? 'Blob token detected' : 'Blob token missing – uploads will fall back to local filesystem'
  })
}
