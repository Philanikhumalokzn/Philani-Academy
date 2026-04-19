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
  await expect(page).toHaveURL(/\/dashboard|\/board/i, { timeout: 30_000 })
}

const ensureDashboard = async (page: Page) => {
  if (!/\/dashboard/i.test(page.url())) {
    await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'domcontentloaded' })
  }
  await expect(page.getByRole('button', { name: /Learning Hub/i }).first()).toBeVisible({ timeout: 30_000 })
}

test.describe('learning hub papers grade 12', () => {
  test.setTimeout(180_000)
  test.use({ viewport: { width: 390, height: 844 } })

  test('admin Grade 12 papers tab surfaces MMD-backed papers', async ({ page }) => {
    test.skip(!adminEmail || !adminPassword, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD')

    await page.goto(toAbsoluteUrl('/auth/signin'), { waitUntil: 'domcontentloaded' })
    await fillSignIn(page)
    await ensureDashboard(page)

    const gradeButton = page.getByRole('button', { name: 'Select grade workspace' }).first()
    await expect(gradeButton).toBeVisible({ timeout: 20_000 })
    await gradeButton.click()

    const gradePill = page.locator('.philani-grade-pill-selector [role="radio"]', { hasText: '12' }).first()
    await expect(gradePill).toBeVisible({ timeout: 10_000 })
    await gradePill.click()

    await expect(gradeButton).toContainText('12', { timeout: 10_000 })

    const learningHubButton = page.getByRole('button', { name: /Learning Hub/i }).first()
    await learningHubButton.click()

    const papersTab = page.getByRole('button', { name: /^Papers$/i }).first()
    await expect(papersTab).toBeVisible({ timeout: 20_000 })
    await papersTab.click()

    await page.waitForTimeout(1500)

    const apiData = await page.evaluate(async () => {
      const res = await fetch('/api/exam-questions/papers?grade=GRADE_12', { credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      return { ok: res.ok, status: res.status, data }
    })

    console.log('papers api data', JSON.stringify(apiData, null, 2))

    const emptyState = page.getByText('No MMD documents available for this grade yet.').first()
    const paperButtons = page.locator('button').filter({ has: page.locator('text=Open in document view') })
    const openDocumentHints = page.getByText('Open in document view')

    const emptyVisible = await emptyState.isVisible().catch(() => false)
    const hintCount = await openDocumentHints.count()
    const bodyText = await page.locator('body').innerText()

    console.log('papers ui diagnostic', JSON.stringify({
      emptyVisible,
      hintCount,
      gradeButtonText: await gradeButton.innerText(),
      bodySnippet: bodyText.slice(0, 2000),
    }, null, 2))

    expect(apiData.ok).toBe(true)
    expect(Array.isArray(apiData.data?.items)).toBe(true)
    expect(apiData.data.items.length).toBeGreaterThan(0)
    expect(emptyVisible).toBe(false)
    expect(hintCount).toBeGreaterThan(0)
  })
})