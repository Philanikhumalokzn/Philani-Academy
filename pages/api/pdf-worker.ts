import type { NextApiRequest, NextApiResponse } from 'next'
import path from 'path'
import { createReadStream } from 'fs'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const workerPath = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs')
  res.setHeader('Content-Type', 'application/javascript')
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  const stream = createReadStream(workerPath)
  stream.on('error', () => {
    res.status(404).end('Worker not found')
  })
  stream.pipe(res)
}
