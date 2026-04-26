import { expect, test, type Page } from '@playwright/test'

const baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').trim()
const adminEmail = (process.env.E2E_ADMIN_EMAIL || '').trim()
const adminPassword = (process.env.E2E_ADMIN_PASSWORD || '').trim()

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

  await page.getByRole('button', { name: /^Sign in$/i }).click()
  await expect(page.getByRole('button', { name: /Sign out/i })).toBeVisible({ timeout: 30_000 })
}

test.describe('remix delete (grade 9)', () => {
  test.setTimeout(180_000)

  test('deleting from remix search results returns success and removes row', async ({ page }) => {
    test.skip(!adminEmail || !adminPassword, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD')

    await page.goto(toAbsoluteUrl('/auth/signin'), { waitUntil: 'domcontentloaded' })
    await fillSignIn(page)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(toAbsoluteUrl('/dashboard?grade=GRADE_9'), { waitUntil: 'domcontentloaded' })

    const learningHubButton = page.getByRole('button', { name: /Learning Hub/i }).first()
    await expect(learningHubButton).toBeVisible({ timeout: 30_000 })
    await learningHubButton.click()

    const remixTab = page.getByRole('button', { name: /^Remix$/i }).first()
    await expect(remixTab).toBeVisible({ timeout: 30_000 })
    await remixTab.click()

    const learningHubPanel = page.locator('div').filter({ hasText: /^Learning Hub/ }).first()
    const scopedRefresh = learningHubPanel.getByRole('button', { name: /^Refresh$/i }).first()
    if (await scopedRefresh.count()) {
      await scopedRefresh.click({ force: true })
    }

    const resultRows = page
      .locator('li.border-b')
      .filter({ hasText: /QUESTION/i })
      .filter({ has: page.getByRole('button', { name: /^Delete$/i }) })
    await expect.poll(async () => await resultRows.count(), { timeout: 60_000 }).toBeGreaterThan(0)

    const targetRow = resultRows.first()
    const rowTextBefore = ((await targetRow.textContent()) || '').trim()

    const deleteRequest = page.waitForResponse((response) => {
      const req = response.request()
      return req.method() === 'DELETE' && /\/api\/exam-questions\//i.test(response.url())
    }, { timeout: 30_000 })

    page.once('dialog', async (dialog) => {
      await dialog.accept()
    })

    await targetRow.getByRole('button', { name: /^Delete$/i }).click()

    const response = await deleteRequest
    const status = response.status()
    const bodyText = await response.text().catch(() => '')
    // eslint-disable-next-line no-console
    console.log(`DELETE ${response.url()} -> ${status} | ${bodyText}`)

    // Keep this assertion strict so the repro catches server-side failures.
    expect(status, `Delete API failed: ${bodyText}`).toBeLessThan(300)

    await expect.poll(async () => {
      const rows = page.locator('li').filter({ has: page.getByRole('button', { name: /^Delete$/i }) })
      const firstText = ((await rows.first().textContent()) || '').trim()
      return firstText === rowTextBefore
    }, { timeout: 20_000 }).toBe(false)
  })
})
