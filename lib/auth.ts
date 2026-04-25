import { getToken } from 'next-auth/jwt'
import type { NextApiRequest } from 'next'
import { normalizeGradeInput } from './grades'

const ADMIN_SELECTED_GRADE_COOKIE = 'pa_admin_selected_grade'

export async function getUserRole(req: NextApiRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  return token?.role as string | undefined
}

export async function getUserGrade(req: NextApiRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  const tokenGrade = normalizeGradeInput(token?.grade as string | undefined)
  const role = String(token?.role || '').toLowerCase()
  if (role === 'admin') {
    const cookieGrade = normalizeGradeInput(req.cookies?.[ADMIN_SELECTED_GRADE_COOKIE])
    return cookieGrade || tokenGrade || undefined
  }
  return tokenGrade || undefined
}

export function requireRole(role: string, userRole?: string) {
  return userRole === role
}

export async function getUserIdFromReq(req: NextApiRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  return token?.sub as string | undefined
}
