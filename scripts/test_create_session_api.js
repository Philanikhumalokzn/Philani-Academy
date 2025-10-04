const fetch = require('node-fetch')
const qs = require('querystring')

// Signs in using NextAuth credentials provider and then posts to /api/create-session
// Assumes dev server at http://localhost:3000 and an admin user exists with the password from scripts/create_admin.js

const base = process.env.BASE_URL || 'http://localhost:3000'

async function signin() {
  // NextAuth credentials uses the /api/auth/callback/credentials endpoint for credentials sign-in when using fetch
  const url = base + '/api/auth/callback/credentials'
  const body = qs.stringify({ email: 'admin@philani.test', password: 'AdminPass123!' })
  const res = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual' })
  if (res.status !== 302) {
    console.error('Sign-in unexpected status', res.status)
    console.error(await res.text())
    process.exit(1)
  }
  // After signin NextAuth sets a cookie; we need to follow cookies or extract the session by calling /api/auth/session
  // We'll call /api/auth/session which reads session from cookies; include the Set-Cookie header from the redirect response
  const cookies = res.headers.raw()['set-cookie']
  const cookieHeader = cookies ? cookies.map(c=>c.split(';')[0]).join('; ') : ''
  return cookieHeader
}

async function createSession(cookieHeader) {
  const url = base + '/api/create-session'
  const payload = { title: 'Test by script', joinUrl: 'https://meet.example/test', startsAt: new Date().toISOString() }
  const res = await fetch(url, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json', Cookie: cookieHeader } })
  console.log('create-session status', res.status)
  console.log(await res.text())
}

async function main(){
  const cookieHeader = await signin()
  await createSession(cookieHeader)
}

main().catch(e=>{ console.error(e); process.exit(1) })
