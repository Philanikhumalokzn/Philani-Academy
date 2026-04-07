import { expect, test, type Browser, type Page } from '@playwright/test'

const baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').trim()
const learnerEmail = (process.env.E2E_USER_EMAIL || 'philanikhumalo111@gmail.com').trim()
const learnerPassword = (process.env.E2E_USER_PASSWORD || 'Mbo199Pc').trim()

const toAbsoluteUrl = (value: string) => {
  if (/^https?:\/\//i.test(value)) return value
  const normalizedBase = baseUrl.replace(/\/$/, '')
  const normalizedPath = value.startsWith('/') ? value : `/${value}`
  return `${normalizedBase}${normalizedPath}`
}

const ensureOnDashboard = async (page: Page) => {
  if (!/\/dashboard/i.test(page.url())) {
    await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'commit' }).catch(() => null)
  }
  await expect(page).toHaveURL(/\/dashboard|\/board/i, { timeout: 30_000 })
}

const createSignedInStorageState = async (browser: Browser) => {
  const authContext = await browser.newContext({ viewport: { width: 1365, height: 900 } })

  const csrfRes = await authContext.request.get(toAbsoluteUrl('/api/auth/csrf'))
  if (!csrfRes.ok()) {
    throw new Error(`Failed to fetch CSRF token (${csrfRes.status()})`)
  }
  const csrfData = await csrfRes.json().catch(() => ({}))
  const csrfToken = typeof csrfData?.csrfToken === 'string' ? csrfData.csrfToken : ''
  if (!csrfToken) {
    throw new Error('Missing NextAuth CSRF token')
  }

  const callbackRes = await authContext.request.post(toAbsoluteUrl('/api/auth/callback/credentials'), {
    form: {
      csrfToken,
      email: learnerEmail,
      password: learnerPassword,
      callbackUrl: toAbsoluteUrl('/dashboard'),
      json: 'true',
    },
  })

  if (!callbackRes.ok()) {
    throw new Error(`Credentials callback failed (${callbackRes.status()})`)
  }

  const sessionRes = await authContext.request.get(toAbsoluteUrl('/api/auth/session'))
  if (!sessionRes.ok()) {
    throw new Error(`Failed to fetch authenticated session (${sessionRes.status()})`)
  }
  const sessionData = await sessionRes.json().catch(() => ({}))
  const sessionEmail = typeof sessionData?.user?.email === 'string' ? sessionData.user.email.trim().toLowerCase() : ''
  if (sessionEmail !== learnerEmail.toLowerCase()) {
    throw new Error(`Authenticated session email mismatch: ${sessionEmail || 'missing'}`)
  }

  const storageState = await authContext.storageState()
  await authContext.close()
  return storageState
}

const closeSheetIfOpen = async (page: Page, name: RegExp) => {
  const dialog = page.getByRole('dialog', { name })
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => null)
    if (await dialog.isVisible().catch(() => false)) {
      await page.mouse.click(12, 12)
    }
    await expect(dialog).toBeHidden({ timeout: 10_000 })
  }
}

test.describe('mobile dashboard profile media actions', () => {
  test.setTimeout(180_000)

  test('edit profile, avatar, and background actions are reachable from My profile', async ({ browser }) => {
    const storageState = await createSignedInStorageState(browser)
    const context = await browser.newContext({
      viewport: { width: 430, height: 932 },
      isMobile: true,
      hasTouch: true,
      storageState,
    })
    const page = await context.newPage()

    await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'commit' }).catch(() => null)
    await ensureOnDashboard(page)
    await page.reload({ waitUntil: 'domcontentloaded' })

    const selfProfileState = await page.evaluate(async () => {
      const profileRes = await fetch('/api/profile', { credentials: 'same-origin', cache: 'no-store' })
      if (!profileRes.ok) {
        throw new Error(`Failed to load active profile (${profileRes.status})`)
      }
      const profileData = await profileRes.json().catch(() => ({}))
      const userId = typeof profileData?.id === 'string' ? profileData.id : ''
      if (!userId) {
        throw new Error('Authenticated user id is missing')
      }

      const viewRes = await fetch(`/api/profile/view/${encodeURIComponent(userId)}`, { credentials: 'same-origin', cache: 'no-store' })
      if (!viewRes.ok) {
        throw new Error(`Failed to warm self profile (${viewRes.status})`)
      }
      const viewData = await viewRes.json().catch(() => ({}))

      return {
        userId,
        hasAvatar: Boolean(String(viewData?.avatar || '').trim()),
        hasCover: Boolean(String(viewData?.profileCoverUrl || viewData?.profileThemeBgUrl || '').trim()),
      }
    })

    const profileTabButton = page.getByRole('button', { name: /my profile/i })
    await expect(profileTabButton).toBeVisible({ timeout: 20_000 })
    await profileTabButton.click()

    const editProfileButton = page.getByRole('button', { name: /^edit profile$/i })
    await expect(editProfileButton).toBeVisible({ timeout: 20_000 })
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }))

    await editProfileButton.click()
    const editProfileDialog = page.getByRole('dialog', { name: /^edit profile$/i })
    await expect(editProfileDialog).toBeVisible({ timeout: 10_000 })
    await closeSheetIfOpen(page, /^edit profile$/i)

    const avatarButton = page.getByRole('button', { name: /profile photo/i })
    await expect(avatarButton).toBeVisible({ timeout: 10_000 })
    await avatarButton.scrollIntoViewIfNeeded()

    if (selfProfileState.hasAvatar) {
      await avatarButton.click()
      await expect(page.getByRole('dialog', { name: /^profile photo$/i })).toBeVisible({ timeout: 10_000 })
      await closeSheetIfOpen(page, /^profile photo$/i)
    } else {
      const fileChooser = page.waitForEvent('filechooser', { timeout: 10_000 })
      await avatarButton.click()
      await fileChooser
    }

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }))
    const coverButton = page.getByRole('button', { name: /profile background image/i })
    await expect(coverButton).toBeVisible({ timeout: 10_000 })
    const coverBox = await coverButton.boundingBox()
    if (!coverBox) {
      throw new Error('Profile background button is missing a bounding box')
    }
    const coverClickX = coverBox.x + (coverBox.width / 2)
    const coverClickY = coverBox.y + Math.min(120, Math.max(72, coverBox.height * 0.35))

    if (selfProfileState.hasCover) {
      await page.mouse.click(coverClickX, coverClickY)
      await expect(page.getByRole('dialog', { name: /^profile background$/i })).toBeVisible({ timeout: 10_000 })
      await closeSheetIfOpen(page, /^profile background$/i)
    } else {
      const fileChooser = page.waitForEvent('filechooser', { timeout: 10_000 })
      await page.mouse.click(coverClickX, coverClickY)
      await fileChooser
    }

    const homeTabButton = page.getByRole('button', { name: /^home$/i })
    await expect(homeTabButton).toBeVisible({ timeout: 10_000 })
    await homeTabButton.click()

    await expect(page.locator('[role="dialog"]')).toHaveCount(0)
    const bodyOverflow = await page.evaluate(() => document.body.style.overflow || '')
    expect(bodyOverflow).not.toBe('hidden')
    await expect(page.getByRole('button', { name: /what's on your mind/i }).first()).toBeVisible({ timeout: 20_000 })

    await context.close()
  })
})