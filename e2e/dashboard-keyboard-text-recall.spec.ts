import { expect, test, type Locator, type Page } from '@playwright/test'

const baseUrl = (process.env.E2E_BASE_URL || '').trim()
const email = (process.env.E2E_USER_A_EMAIL || '').trim()
const password = (process.env.E2E_USER_A_PASSWORD || '').trim()

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
  await emailInput.pressSequentially(email, { delay: 20 })
  await passwordInput.fill('')
  await passwordInput.pressSequentially(password, { delay: 20 })
  await page.getByRole('button', { name: /^sign in$/i }).click()

  await expect(page).toHaveURL(/\/dashboard|\/board/i, { timeout: 30_000 })
}

const tapKey = async (page: Page, locator: Locator) => {
  await locator.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true })
  await page.waitForTimeout(20)
  await locator.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true })
}

const clickToolbarButton = async (locator: Locator) => {
  await locator.evaluate((node) => {
    ;(node as HTMLButtonElement).click()
  })
}

const ensureDashboardKeyboardOverlayReady = async (page: Page) => {
  const keyboardField = page.locator('math-field.keyboard-mathlive-field').first()
  const textButton = page.locator('button[title="Text"]').first()

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await keyboardField.isVisible().catch(() => false)) {
      await expect(textButton).toBeVisible({ timeout: 20_000 })
      return
    }

    const gradePrompt = page.getByText(/Choose a grade to open the shared board\./i)
    if (await gradePrompt.isVisible().catch(() => false)) {
      const gradeSelect = page.getByRole('combobox', { name: /choose grade/i })
      if (await gradeSelect.isVisible().catch(() => false)) {
        await gradeSelect.selectOption({ index: 1 })
        await page.waitForTimeout(1500)
      }
    }

    const enterClassButtons = page.getByRole('button', { name: /enter class/i })
    const count = await enterClassButtons.count()
    for (let index = 0; index < count; index += 1) {
      const candidate = enterClassButtons.nth(index)
      if (!(await candidate.isVisible().catch(() => false))) continue
      await candidate.click({ force: true })
      await page.waitForTimeout(3500)
      if (await keyboardField.isVisible().catch(() => false)) {
        await expect(textButton).toBeVisible({ timeout: 20_000 })
        return
      }
    }

    await page.waitForTimeout(1200)
  }

  await expect(keyboardField).toBeVisible({ timeout: 30_000 })
  await expect(textButton).toBeVisible({ timeout: 20_000 })
}

const readMathfieldValue = async (page: Page) => {
  const field = page.locator('math-field.keyboard-mathlive-field').first()
  await expect(field).toBeVisible({ timeout: 20_000 })
  return field.evaluate((node) => String((node as HTMLElement & { value?: string }).value || ''))
}

test.describe('dashboard keyboard text recall', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test.setTimeout(180_000)

  test('Text enters recall mode for the real dashboard overlay keyboard', async ({ page }) => {
    test.skip(!baseUrl || !email || !password, 'Set E2E_BASE_URL, E2E_USER_A_EMAIL, E2E_USER_A_PASSWORD')

    await page.goto(toAbsoluteUrl('/auth/signin'), { waitUntil: 'domcontentloaded' })
    await fillSignIn(page)

    if (!/\/dashboard/i.test(page.url())) {
      await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'domcontentloaded' })
    }

    await ensureDashboardKeyboardOverlayReady(page)

    const sevenKey = page.locator('button[title="7"]').first()
    const plusKey = page.locator('button[title="plus"]').first()
    const fiveKey = page.locator('button[title="5"]').first()
    const textButton = page.locator('button[title="Text"]').first()
    const sendButton = page.locator('button[title="Send step"], button[title="Update step"]').first()

    await expect(sevenKey).toBeVisible({ timeout: 20_000 })
    await expect(plusKey).toBeVisible({ timeout: 20_000 })
    await expect(fiveKey).toBeVisible({ timeout: 20_000 })

    await tapKey(page, sevenKey)
    await tapKey(page, plusKey)
    await tapKey(page, fiveKey)

    await expect.poll(() => readMathfieldValue(page)).toContain('7+5')
    await expect(sendButton).toBeEnabled({ timeout: 20_000 })

    await clickToolbarButton(sendButton)

    await expect.poll(() => readMathfieldValue(page)).toBe('')

    await clickToolbarButton(textButton)
    await page.waitForTimeout(350)

    const firstStepButton = page.locator('[data-top-panel-step]').first()
    await expect(firstStepButton).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-top-panel-step-shell]')).toHaveCount(1)

    await clickToolbarButton(firstStepButton)

    await expect.poll(() => readMathfieldValue(page)).toContain('7+5')
    await expect(sendButton).toHaveAttribute('title', 'Update step')
  })
})