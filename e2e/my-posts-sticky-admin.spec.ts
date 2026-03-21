import { expect, test } from '@playwright/test'

const baseUrl = (process.env.E2E_BASE_URL || '').trim()
const adminEmail = (process.env.E2E_ADMIN_EMAIL || '').trim()
const adminPassword = (process.env.E2E_ADMIN_PASSWORD || '').trim()

const cfg = {
  baseUrl,
  adminEmail,
  adminPassword,
}

const toAbsoluteUrl = (value: string) => {
  if (/^https?:\/\//i.test(value)) return value
  const normalizedBase = cfg.baseUrl.replace(/\/$/, '')
  const normalizedPath = value.startsWith('/') ? value : `/${value}`
  return `${normalizedBase}${normalizedPath}`
}

const fillSignIn = async (page: Parameters<typeof test>[0]['page']) => {
  const emailInput = page.locator('#email')
  const passwordInput = page.locator('#password')
  await expect(emailInput).toBeVisible({ timeout: 15_000 })
  await expect(passwordInput).toBeVisible({ timeout: 15_000 })

  await emailInput.click()
  await emailInput.fill('')
  await emailInput.pressSequentially(cfg.adminEmail, { delay: 20 })
  await expect(emailInput).toHaveValue(cfg.adminEmail)

  await passwordInput.click()
  await passwordInput.fill('')
  await passwordInput.pressSequentially(cfg.adminPassword, { delay: 20 })
  await expect(passwordInput).toHaveValue(cfg.adminPassword)

  await page.getByRole('button', { name: /^Sign in$/i }).click()
  await page.waitForTimeout(10_000)
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 })

  let redirected = false
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await expect(page).toHaveURL(/\/dashboard|\/board/i, { timeout: 6_000 })
      redirected = true
      break
    } catch {
      const errText = await page.locator('.bg-red-100').first().textContent().catch(() => null)
      if (errText && errText.trim()) {
        throw new Error(`Sign-in failed: ${errText.trim()}`)
      }
      await page.waitForTimeout(1500)
    }
  }

  if (!redirected) {
    throw new Error(`Sign-in did not redirect. Final URL: ${page.url()}`)
  }

  const cookies = await page.context().cookies()
  const hasSessionCookie = cookies.some((cookie) => /next-auth.*session-token/i.test(cookie.name))
  if (!hasSessionCookie) {
    throw new Error(`Sign-in did not create a NextAuth session cookie. Final URL: ${page.url()}`)
  }
}

test.describe('admin my-posts sticky behavior', () => {
  test.setTimeout(180_000)

  test('my posts header stays available while scrolling posts', async ({ page }) => {
    test.skip(!cfg.baseUrl || !cfg.adminEmail || !cfg.adminPassword, 'Set E2E_BASE_URL, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD')

    page.on('dialog', async (dialog) => {
      try {
        await dialog.accept()
      } catch {
        // ignore
      }
    })

    await page.goto(toAbsoluteUrl('/auth/signin'), { waitUntil: 'domcontentloaded' })
    await fillSignIn(page)

    if (!/\/dashboard/i.test(page.url())) {
      await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'domcontentloaded' })
    }

    const composerButton = page.getByRole('button', { name: /What's on your mind/i })
    await expect(composerButton).toBeVisible({ timeout: 20_000 })

    // Ensure there is enough content under My posts to scroll.
    const myPostsHeader = page.locator('button[aria-controls="dashboard-my-posts-section"]').first()
    await myPostsHeader.click()

    const myPostsSection = page.locator('#dashboard-my-posts-section')
    await expect(myPostsSection).toBeVisible({ timeout: 10_000 })

    let myPostItems = page.locator('#dashboard-my-posts-section li[data-post-id]')
    let count = await myPostItems.count()

    for (let i = count; i < 4; i += 1) {
      await composerButton.click()
      const textArea = page.locator('textarea[placeholder*="Share what you are working on"]').first()
      await expect(textArea).toBeVisible({ timeout: 10_000 })
      await textArea.fill(`Playwright sticky test post ${Date.now()}-${i}`)
      await page.getByRole('button', { name: /^Post$/i }).click()
      await expect(textArea).toBeHidden({ timeout: 15_000 })

      if (!(await myPostsSection.isVisible().catch(() => false))) {
        await myPostsHeader.click()
        await expect(myPostsSection).toBeVisible({ timeout: 10_000 })
      }

      myPostItems = page.locator('#dashboard-my-posts-section li[data-post-id]')
      count = await myPostItems.count()
    }

    expect(count).toBeGreaterThanOrEqual(1)

    await expect(myPostItems.first()).toBeVisible({ timeout: 10_000 })

    const before = await myPostsHeader.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom }
    })

    // Phase 1: normal scroll, header should move up toward the top.
    await page.mouse.wheel(0, 260)
    await page.waitForTimeout(250)

    const mid = await myPostsHeader.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom }
    })

    // Phase 2: continue scrolling until header pins at top; post cards should keep moving underneath.
    const firstItemBeforePin = await myPostItems.first().evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom }
    })

    for (let i = 0; i < 14; i += 1) {
      await page.mouse.wheel(0, 220)
      await page.waitForTimeout(120)
      const pinnedTop = await myPostsHeader.evaluate((el) => Math.round(el.getBoundingClientRect().top))
      if (pinnedTop <= 2) break
    }

    const after = await myPostsHeader.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return {
        top: r.top,
        bottom: r.bottom,
        classes: (el as HTMLButtonElement).className,
      }
    })

    const firstItemAfterPin = await myPostItems.first().evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom }
    })

    await expect(myPostsHeader).toBeVisible()
    expect(before.top).toBeGreaterThanOrEqual(0)
    expect(mid.top).toBeLessThan(before.top)
    expect(after.top).toBeLessThanOrEqual(2)
    expect(after.bottom).toBeGreaterThan(0)
    expect(after.classes.includes('sticky')).toBeTruthy()
    expect(firstItemAfterPin.top).toBeLessThan(firstItemBeforePin.top)
  })
})
