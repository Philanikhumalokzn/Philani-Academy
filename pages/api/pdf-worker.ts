import type { NextApiRequest, NextApiResponse } from 'next'
import path from 'path'
import { createReadStream } from 'fs'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const workerPath = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs')
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  const stream = createReadStream(workerPath)
  stream.on('error', () => {
    res.status(404).end('Worker not found')
  })
  stream.pipe(res)
}
