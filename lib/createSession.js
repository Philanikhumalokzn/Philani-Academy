const prisma = require('./prisma.cjs')

/**
 * Create a session record with the same authorization checks as the API route.
 * @param {{ token: any, body: any }} args
 * @returns {Promise<object>} created record
 * @throws {{status:number,message:string}} on auth/validation errors
 */
async function createSession({ token, body }){
  if (!token) throw { status: 401, message: 'Unauthorized: no session token' }

  const role = token.role
  if (!role || (role !== 'admin' && role !== 'teacher')) throw { status: 403, message: 'Forbidden' }

  const { title, joinUrl, startsAt } = body || {}
  if (!title || !joinUrl || !startsAt) throw { status: 400, message: 'Missing fields' }

  const rec = await prisma.sessionRecord.create({ data: {
    title,
    description: '',
    joinUrl,
    startsAt: new Date(startsAt),
    createdBy: (token?.email) || 'unknown'
  }})

  return rec
}

module.exports = createSession
