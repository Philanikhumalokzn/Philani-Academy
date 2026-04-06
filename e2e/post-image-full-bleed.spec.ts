import { expect, test, type Page } from '@playwright/test'

const baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').trim()
const adminEmail = (process.env.E2E_ADMIN_EMAIL || 'admin@philani.test').trim()
const adminPassword = (process.env.E2E_ADMIN_PASSWORD || 'admin').trim()
const uploadImagePath = String(process.env.E2E_POST_IMAGE_PATH || 'C:/Users/ntand/OneDrive/Desktop/BLUETOOTH/Test_image.jpg').trim()

const toAbsoluteUrl = (value: string) => {
  if (/^https?:\/\//i.test(value)) return value
  const normalizedBase = baseUrl.replace(/\/$/, '')
  const normalizedPath = value.startsWith('/') ? value : `/${value}`
  return `${normalizedBase}${normalizedPath}`
}

const fillSignIn = async (page: Page) => {
  const emailInput = page.locator('#email')
  const passwordInput = page.locator('#password')
  await expect(emailInput).toBeVisible({ timeout: 20_000 })
  await expect(passwordInput).toBeVisible({ timeout: 20_000 })

  await emailInput.fill('')
  await emailInput.pressSequentially(adminEmail, { delay: 20 })
  await expect(emailInput).toHaveValue(adminEmail)
  await passwordInput.fill('')
  await passwordInput.pressSequentially(adminPassword, { delay: 20 })
  await expect(passwordInput).toHaveValue(adminPassword)
  await page.getByRole('button', { name: /^sign in$/i }).click()
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

const expectFullBleed = async (page: Page, testId: string) => {
  const result = await page.getByTestId(testId).first().evaluate((node) => {
    const rect = node.getBoundingClientRect()
    return {
      left: Math.round(rect.left),
      rightInset: Math.round(window.innerWidth - rect.right),
      width: Math.round(rect.width),
      viewportWidth: Math.round(window.innerWidth),
      scrollWidth: Math.round(document.documentElement.scrollWidth),
    }
  })

  expect(result.left).toBeLessThanOrEqual(1)
  expect(result.rightInset).toBeLessThanOrEqual(1)
  expect(Math.abs(result.width - result.viewportWidth)).toBeLessThanOrEqual(1)
  expect(result.scrollWidth).toBeLessThanOrEqual(result.viewportWidth + 1)
}

test.describe('post image full bleed', () => {
  test.setTimeout(240_000)

  test('uploaded post image is edge to edge in composer and feed', async ({ page }) => {
    const title = `Bleed ${Date.now()}`

    await page.setViewportSize({ width: 412, height: 915 })
    await page.goto(toAbsoluteUrl('/auth/signin'), { waitUntil: 'domcontentloaded' })
    await fillSignIn(page)
    await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: /what's on your mind/i }).click()
    await expect(page.getByPlaceholder('Title (optional)')).toBeVisible({ timeout: 20_000 })
    await page.getByPlaceholder('Title (optional)').fill(title)

    await page.getByRole('button', { name: /^Camera$/i }).click()
    await page.getByRole('button', { name: /Choose from gallery/i }).click()
    await page.locator('input[type="file"][accept="image/*"]:not([capture])').last().setInputFiles(uploadImagePath)
    await expect(page.getByRole('button', { name: /^Add$/i }).last()).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /^Add$/i }).last().click()

    await expect(page.getByTestId('post-composer-image-row')).toBeVisible({ timeout: 30_000 })
    await expectFullBleed(page, 'post-composer-image-row')

    await page.getByRole('button', { name: /^Post$/i }).click()
    await expect(page.getByPlaceholder('Title (optional)')).toBeHidden({ timeout: 30_000 })

    const createdPost = page.locator('li[data-post-id]').filter({ hasText: title }).first()
    await expect(createdPost).toBeVisible({ timeout: 30_000 })
    await expect(createdPost.getByTestId('public-feed-post-image-row')).toBeVisible({ timeout: 20_000 })
    await expectFullBleed(page, 'public-feed-post-image-row')
  })
})
