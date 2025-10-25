import { getToken } from 'next-auth/jwt'
import type { NextApiRequest } from 'next'

export async function getUserRole(req: NextApiRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  return token?.role as string | undefined
}

export function requireRole(role: string, userRole?: string) {
  return userRole === role
}

export async function getUserIdFromReq(req: NextApiRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  return token?.sub as string | undefined
}
