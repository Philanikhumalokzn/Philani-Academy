import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from 'firebase-admin/app'

function normalizePrivateKey(value: string) {
  return value.replace(/\\n/g, '\n')
}

function getServiceAccountConfig() {
  const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim()
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim()
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').trim()

  if (!projectId || !clientEmail || !privateKey) return null

  return {
    projectId,
    clientEmail,
    privateKey: normalizePrivateKey(privateKey),
  } satisfies ServiceAccount
}

export function isFirebaseAdminConfigured() {
  return Boolean(getServiceAccountConfig() || String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim())
}

export function getFirebaseAdminApp() {
  const existing = getApps()[0]
  if (existing) return existing

  const serviceAccount = getServiceAccountConfig()
  if (serviceAccount) {
    return initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.projectId,
    })
  }

  return initializeApp({
    credential: applicationDefault(),
  })
}