import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type Credentials = { email: string; password: string }

type MultiUserEnv = {
  baseUrl: string
  admin: Credentials
  userA: Credentials
  userB: Credentials
  adminBoardPath: string
  userABoardPath: string
  userBBoardPath: string
  userADisplayName: string
}

const readEnvFileMap = (filePath: string) => {
  const map = new Map<string, string>()
  if (!fs.existsSync(filePath)) return map
  const raw = fs.readFileSync(filePath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim().replace(/^\uFEFF/, '')
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    map.set(key, value)
  }
  return map
}

const resolveE2EEnvMap = () => {
  const candidatePaths = new Set<string>()
  const cwd = process.cwd()
  candidatePaths.add(path.join(cwd, '.env.e2e.local'))
  candidatePaths.add(path.join(cwd, '..', '.env.e2e.local'))
  candidatePaths.add(path.join(cwd, '..', '..', '.env.e2e.local'))

  const initCwd = process.env.INIT_CWD
  if (typeof initCwd === 'string' && initCwd.trim()) {
    candidatePaths.add(path.join(initCwd.trim(), '.env.e2e.local'))
  }

  try {
    if (typeof __dirname === 'string' && __dirname) {
      candidatePaths.add(path.resolve(__dirname, '..', '.env.e2e.local'))
      candidatePaths.add(path.resolve(__dirname, '..', '..', '.env.e2e.local'))
    }
  } catch {}

  for (const candidate of candidatePaths) {
    const map = readEnvFileMap(candidate)
    if (map.size > 0) {
      console.log('[e2e] using env file:', candidate)
      return map
    }
  }

  console.log('[e2e] no .env.e2e.local file resolved; falling back to process env only')
  return new Map<string, string>()
}

const e2eEnvFileValues = resolveE2EEnvMap()
console.log('[e2e] parsed E2E_BASE_URL from file =', e2eEnvFileValues.get('E2E_BASE_URL') || '<missing>')
console.log('[e2e] env keys sample =', Array.from(e2eEnvFileValues.keys()).slice(0, 8).join(', '))

const getE2EValue = (key: string) => {
  const fileValue = e2eEnvFileValues.get(key)
  if (typeof fileValue === 'string' && fileValue.trim().length > 0) return fileValue.trim()
  const envValue = process.env[key]
  return typeof envValue === 'string' ? envValue.trim() : ''
}

const readMultiUserEnv = (): MultiUserEnv | null => {
  const isConfigured = (value: string) => {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return false
    if (normalized === 'replace-me') return false
    if (normalized === 'changeme') return false
    return true
  }

  const baseUrl = getE2EValue('E2E_BASE_URL')
  const adminEmail = getE2EValue('E2E_ADMIN_EMAIL')
  const adminPassword = getE2EValue('E2E_ADMIN_PASSWORD')
  const userAEmail = getE2EValue('E2E_USER_A_EMAIL')
  const userAPassword = getE2EValue('E2E_USER_A_PASSWORD')
  const userBEmail = getE2EValue('E2E_USER_B_EMAIL')
  const userBPassword = getE2EValue('E2E_USER_B_PASSWORD')

  if (!isConfigured(baseUrl) || !isConfigured(adminEmail) || !isConfigured(adminPassword) || !isConfigured(userAEmail) || !isConfigured(userAPassword) || !isConfigured(userBEmail) || !isConfigured(userBPassword)) {
    return null
  }

  const adminBoardPath = getE2EValue('E2E_ADMIN_BOARD_PATH') || '/board'
  const userABoardPath = getE2EValue('E2E_USER_A_BOARD_PATH') || adminBoardPath
  const userBBoardPath = getE2EValue('E2E_USER_B_BOARD_PATH') || adminBoardPath
  const userADisplayName = getE2EValue('E2E_USER_A_DISPLAY_NAME')

  return {
    baseUrl,
    admin: { email: adminEmail, password: adminPassword },
    userA: { email: userAEmail, password: userAPassword },
    userB: { email: userBEmail, password: userBPassword },
    adminBoardPath,
    userABoardPath,
    userBBoardPath,
    userADisplayName,
  }
}

const multiUserEnv = readMultiUserEnv()

const toAbsoluteUrl = (baseUrl: string, pathOrUrl: string) => {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  const normalizedBase = baseUrl.replace(/\/$/, '')
  const normalizedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`
  return `${normalizedBase}${normalizedPath}`
}

const fillSignInFormSafely = async (page: Page, creds: Credentials) => {
  const emailInput = page.locator('#email')
  const passwordInput = page.locator('#password')
  const submitButton = page.getByRole('button', { name: /^Sign in$/i })

  await expect(emailInput).toBeVisible({ timeout: 15_000 })
  await expect(passwordInput).toBeVisible({ timeout: 15_000 })
  await expect(submitButton).toBeVisible({ timeout: 15_000 })
  await expect(emailInput).toBeEditable({ timeout: 15_000 })
  await expect(passwordInput).toBeEditable({ timeout: 15_000 })

  await emailInput.click()
  await emailInput.fill('')
  await emailInput.pressSequentially(creds.email, { delay: 25 })
  await expect(emailInput).toHaveValue(creds.email)

  await passwordInput.click()
  await passwordInput.fill('')
  await passwordInput.pressSequentially(creds.password, { delay: 25 })
  await expect(passwordInput).toHaveValue(creds.password)

  await page.waitForTimeout(250)
  await expect(emailInput).toHaveValue(creds.email)
  await expect(passwordInput).toHaveValue(creds.password)
}

const collectAuthDiagnostics = async (page: Page) => {
  const currentUrl = page.url()
  const title = await page.title().catch(() => 'unknown')
  const errorText = await page.locator('.bg-red-100').first().textContent().catch(() => null)
  const bodyText = await page.locator('body').innerText().catch(() => '')
  const challengeSeen = /captcha|cloudflare|verify you are human|access denied|security check/i.test(bodyText)
  const bodyPreview = bodyText.slice(0, 220).replace(/\s+/g, ' ').trim()
  return {
    currentUrl,
    title,
    errorText: String(errorText || '').trim() || null,
    challengeSeen,
    bodyPreview,
  }
}

const recoverFromClientExceptionScreen = async (page: Page) => {
  const crashBanner = page.getByText(/Application error: a client-side exception has occurred while loading/i)
  const crashSeen = await crashBanner.first().isVisible().catch(() => false)
  if (!crashSeen) return false

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 8_000 })
  return true
}

const waitForAuthRedirect = async (page: Page, targetUrlPattern: RegExp, label: string) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    console.log(`[e2e][auth][${label}] loop-start attempt=${attempt + 1}`)
    const recovered = await recoverFromClientExceptionScreen(page)
    if (recovered) {
      console.log(`[e2e][auth][${label}] recovered from client exception screen`)
    }

    const matchesTarget = targetUrlPattern.test(page.url())
    if (matchesTarget) return true

    const before = await collectAuthDiagnostics(page)
    console.log(`[e2e][auth][${label}] attempt=${attempt + 1} url=${before.currentUrl} title=${before.title}`)

    let redirected = false
    try {
      console.log(`[e2e][auth][${label}] waiting for target URL...`)
      await expect(page).toHaveURL(targetUrlPattern, { timeout: 3000 })
      redirected = true
    } catch {
      redirected = false
    }

    if (redirected) return true

    const stillOnSignIn = /\/auth\/signin/i.test(page.url())
    if (stillOnSignIn) {
      const errorText = await page.locator('.bg-red-100').first().textContent().catch(() => null)
      if (errorText && errorText.trim()) {
        console.log(`[e2e][auth][${label}] sign-in error visible: ${errorText.trim()}`)
        return false
      }
      console.log(`[e2e][auth][${label}] still on sign-in without explicit error; waiting for auth settle...`)
      await page.waitForTimeout(2000)
      continue
    }

    const awayUrl = page.url()
    console.log(`[e2e][auth][${label}] left sign-in to ${awayUrl}; waiting for target without extra refresh`)
    await page.waitForTimeout(1200)
    if (targetUrlPattern.test(page.url())) {
      return true
    }
    continue
  }

  return targetUrlPattern.test(page.url())
}

const loginAndOpenBoard = async (page: Page, baseUrl: string, creds: Credentials, boardPath: string) => {
  const boardUrl = toAbsoluteUrl(baseUrl, boardPath)
  const signInUrl = toAbsoluteUrl(baseUrl, `/auth/signin?callbackUrl=${encodeURIComponent(boardUrl)}`)

  await page.goto(signInUrl, { waitUntil: 'domcontentloaded' })
  console.log(`[e2e][login+board][${creds.email}] open ${signInUrl}`)
  await fillSignInFormSafely(page, creds)
  await page.getByRole('button', { name: /^Sign in$/i }).click()
  await page.waitForTimeout(10_000)
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 })

  const boardUrlPattern = new RegExp(boardUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const redirectedToBoard = await waitForAuthRedirect(page, boardUrlPattern, creds.email)

  if (!redirectedToBoard) {
    const details = await collectAuthDiagnostics(page)
    throw new Error(`Sign-in did not redirect to board (${details.currentUrl}). title=${details.title}; error=${details.errorText || 'none'}; challenge=${details.challengeSeen}; preview=${details.bodyPreview}`)
  }

  await expect(page.getByText('Preparing collaborative canvas…')).toBeHidden({ timeout: 30_000 })
}

const loginOnly = async (page: Page, baseUrl: string, creds: Credentials) => {
  const signInUrl = toAbsoluteUrl(baseUrl, '/auth/signin')

  await page.goto(signInUrl, { waitUntil: 'domcontentloaded' })
  console.log(`[e2e][login-only][${creds.email}] open ${signInUrl}`)
  await fillSignInFormSafely(page, creds)
  await page.getByRole('button', { name: /^Sign in$/i }).click()
  await page.waitForTimeout(10_000)
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 })

  const signedIn = await waitForAuthRedirect(page, /\/dashboard|\/board/i, creds.email)

  if (!signedIn) {
    const details = await collectAuthDiagnostics(page)
    throw new Error(`Login failed for ${creds.email} at ${details.currentUrl}: title=${details.title}; error=${details.errorText || 'unknown sign-in error'}; challenge=${details.challengeSeen}; preview=${details.bodyPreview}`)
  }
}

const openAvatarRoster = async (adminPage: Page) => {
  const toggle = adminPage.getByRole('button', { name: 'Toggle session avatars' })
  await expect(toggle).toBeVisible({ timeout: 20_000 })
  await toggle.click()
}

const clickPresenterTarget = async (adminPage: Page, displayName?: string) => {
  if (displayName) {
    const candidate = adminPage.getByRole('button', { name: `Make ${displayName} the presenter` }).first()
    if (await candidate.count()) {
      await candidate.click()
      return
    }
  }

  const firstAttendee = adminPage.locator('button[aria-label^="Make "][aria-label$=" the presenter"]').first()
  await expect(firstAttendee).toBeVisible({ timeout: 10_000 })
  await firstAttendee.click()
}

test.describe('stacked handoff multi-user browser flow', () => {
  test.setTimeout(120_000)

  test('credentials preflight', async () => {
    test.skip(!multiUserEnv, 'Set E2E_BASE_URL + E2E_ADMIN_* + E2E_USER_A_* + E2E_USER_B_* env vars in .env.e2e.local to run multi-user handoff test.')
    const env = multiUserEnv!
    console.log('[e2e][preflight] baseUrl=', env.baseUrl)
    const checkAccount = async (label: string, creds: Credentials) => {
      let context: BrowserContext | null = null
      let userDataDir = ''
      try {
        const tag = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'user'
        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `philani-e2e-${tag}-`))
        context = await chromium.launchPersistentContext(userDataDir, {
          headless: false,
        })
        const page = context.pages()[0] || await context.newPage()
        await loginOnly(page, env.baseUrl, creds)
      } finally {
        try {
          await context?.close()
        } catch {}
        if (userDataDir) {
          try {
            fs.rmSync(userDataDir, { recursive: true, force: true })
          } catch {}
        }
      }
    }

    await checkAccount('admin', env.admin)
    await checkAccount('user-a', env.userA)
    await checkAccount('user-b', env.userB)
  })

  test('multi-user stacked handoff does not show realtime-unavailable error and admin recovers from preparing state', async () => {
    test.skip(!multiUserEnv, 'Set E2E_BASE_URL + E2E_ADMIN_* + E2E_USER_A_* + E2E_USER_B_* env vars in .env.e2e.local to run multi-user handoff test.')
    const env = multiUserEnv!
    console.log('[e2e][handoff] baseUrl=', env.baseUrl)
    const contexts: BrowserContext[] = []
    const profileDirs: string[] = []
    try {
      const createIsolatedContext = async () => {
        const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'philani-e2e-'))
        profileDirs.push(userDataDir)
        const context = await chromium.launchPersistentContext(userDataDir, {
          headless: false,
        })
        contexts.push(context)
        return context
      }

      const adminContext = await createIsolatedContext()
      const userAContext = await createIsolatedContext()
      const userBContext = await createIsolatedContext()

      const adminPage = adminContext.pages()[0] || await adminContext.newPage()
      const userAPage = userAContext.pages()[0] || await userAContext.newPage()
      const userBPage = userBContext.pages()[0] || await userBContext.newPage()

      await loginAndOpenBoard(adminPage, env.baseUrl, env.admin, env.adminBoardPath)
      await loginAndOpenBoard(userAPage, env.baseUrl, env.userA, env.userABoardPath)
      await loginAndOpenBoard(userBPage, env.baseUrl, env.userB, env.userBBoardPath)

      await openAvatarRoster(adminPage)
      await clickPresenterTarget(adminPage, env.userADisplayName)

      await expect(adminPage.getByText('Switch failed. Realtime channel unavailable.')).toBeHidden({ timeout: 12_000 })
      await expect(adminPage.getByText('Preparing collaborative canvas…')).toBeHidden({ timeout: 20_000 })

      await expect(userAPage.getByText(/locked the board\. You're in view-only mode\./i)).toHaveCount(0)
    } finally {
      await Promise.all(contexts.map(ctx => ctx.close()))
      for (const profileDir of profileDirs) {
        try {
          fs.rmSync(profileDir, { recursive: true, force: true })
        } catch {}
      }
    }
  })
})
