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

const ensureBoardCanvasReady = async (page: Page) => {
  const editorSurface = page.locator('.ms-editor').last()
  const keyboardField = page.locator('math-field.keyboard-mathlive-field').first()

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await editorSurface.isVisible().catch(() => false)) {
      return editorSurface
    }
    if (await keyboardField.isVisible().catch(() => false)) {
      return editorSurface
    }

    const gradePrompt = page.getByText(/Choose a grade to open the shared board\./i)
    if (await gradePrompt.isVisible().catch(() => false)) {
      const gradeSelect = page.getByRole('combobox', { name: /choose grade/i })
      if (await gradeSelect.isVisible().catch(() => false)) {
        await gradeSelect.selectOption({ index: 1 })
        await page.waitForTimeout(1200)
      }
    }

    const enterClassButtons = page.getByRole('button', { name: /enter class/i })
    const count = await enterClassButtons.count()
    for (let i = 0; i < count; i += 1) {
      const candidate = enterClassButtons.nth(i)
      if (!(await candidate.isVisible().catch(() => false))) continue
      if (await keyboardField.isVisible().catch(() => false)) {
        return editorSurface
      }
      await candidate.click({ force: true })
      await page.waitForTimeout(3500)
      if (await editorSurface.isVisible().catch(() => false)) {
        return editorSurface
      }
      if (await keyboardField.isVisible().catch(() => false)) {
        return editorSurface
      }
    }

    await page.waitForTimeout(1000)
  }

  if (await keyboardField.isVisible().catch(() => false)) {
    return editorSurface
  }
  await expect(editorSurface).toBeVisible({ timeout: 30_000 })
  return editorSurface
}

const tapKey = async (page: Page, locator: Locator) => {
  await locator.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true })
  await page.waitForTimeout(20)
  await locator.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true })
}

const clickBottomRightEnterKey = async (page: Page) => {
  const candidates = page.locator('button[data-enter-step-key="true"]')
  const count = await candidates.count()
  let bestIndex = -1
  let bestScore = -1

  for (let i = 0; i < count; i += 1) {
    const button = candidates.nth(i)
    if (!(await button.isVisible().catch(() => false))) continue

    const box = await button.boundingBox().catch(() => null)
    if (!box) continue
    const score = (box.y * 10_000) + box.x
    if (score > bestScore) {
      bestScore = score
      bestIndex = i
    }
  }

  expect(bestIndex).toBeGreaterThanOrEqual(0)
  const target = candidates.nth(bestIndex)
  await target.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true })
  await target.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true })
  await target.click({ force: true })
}

const toggleEditingMode = async (page: Page) => {
  const textButton = page.getByRole('button', { name: /^Text$/i }).first()
  await expect(textButton).toBeVisible({ timeout: 30_000 })
  await textButton.click()
  await page.waitForTimeout(500)
}

const waitForEnterToBecomeStepCommit = async (page: Page) => {
  const timeoutMs = 45_000
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const candidates = page.locator('button[data-enter-step-key="true"]')
    const count = await candidates.count()

    let bestIndex = -1
    let bestScore = -1

    for (let i = 0; i < count; i += 1) {
      const button = candidates.nth(i)
      if (!(await button.isVisible().catch(() => false))) continue
      const box = await button.boundingBox().catch(() => null)
      if (!box) continue
      const score = (box.y * 10_000) + box.x
      if (score > bestScore) {
        bestScore = score
        bestIndex = i
      }
    }

    if (bestIndex >= 0) {
      return
    }

    const enterClassButtons = page.getByRole('button', { name: /enter class/i })
    const enterClassCount = await enterClassButtons.count()
    for (let i = 0; i < enterClassCount; i += 1) {
      const button = enterClassButtons.nth(i)
      if (!(await button.isVisible().catch(() => false))) continue
      await button.click({ force: true }).catch(() => {})
    }

    await page.waitForTimeout(1500)
  }

  throw new Error('Timed out waiting for any visible enter-like key.')
}

test.describe('keyboard enter-like key new-step flow', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test.setTimeout(180_000)

  test('pressing enter-like key commits current step and starts a new draft step', async ({ page }) => {
    test.skip(!baseUrl || !email || !password, 'Set E2E_BASE_URL, E2E_USER_A_EMAIL, E2E_USER_A_PASSWORD')

    await page.goto(toAbsoluteUrl('/auth/signin'), { waitUntil: 'domcontentloaded' })
    await fillSignIn(page)

    if (!/\/dashboard/i.test(page.url())) {
      await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'domcontentloaded' })
    }

    const editorSurface = await ensureBoardCanvasReady(page)

    await waitForEnterToBecomeStepCommit(page)

    // Read baseline committed step count from top-panel editing mode.
    await toggleEditingMode(page)
    const baselineCount = await page.locator('[data-top-panel-step]').count()
    await toggleEditingMode(page)

    const xKey = page.locator('button[title="x"]').first()
    const plusKey = page.locator('button[title="plus"]').first()
    const keyboardField = page.locator('math-field.keyboard-mathlive-field').first()

    if (!(await xKey.isVisible().catch(() => false))) {
      if (await editorSurface.isVisible().catch(() => false)) {
        await editorSurface.click({ position: { x: 120, y: 120 } })
      } else if (await keyboardField.isVisible().catch(() => false)) {
        await keyboardField.click({ position: { x: 80, y: 30 } })
      }
    }

    await expect(xKey).toBeVisible({ timeout: 10_000 })
    await expect(plusKey).toBeVisible({ timeout: 10_000 })

    // Compose a non-empty step.
    await xKey.click()
    await plusKey.click()
    await xKey.click()

    const keyboardDebugInput = page.getByRole('textbox', { name: /Keyboard latex input/i }).first()
    const beforeValue = (await keyboardDebugInput.inputValue().catch(() => '')).trim()
    expect(beforeValue.length).toBeGreaterThan(0)

    // Wait briefly to ensure keyboard state is synced to adminDraftLatex
    await page.waitForTimeout(500)

    // Enter-like key should use send/commit pipeline, not raw clear.
    await clickBottomRightEnterKey(page)
    await page.waitForTimeout(1200)

    const afterValue = (await keyboardDebugInput.inputValue().catch(() => '')).trim()
    expect(afterValue).toBe('')

    await toggleEditingMode(page)
    const afterCount = await page.locator('[data-top-panel-step]').count()

    expect(afterCount).toBeGreaterThan(baselineCount)

    // Sanity: latest committed step should expose visible math text.
    const latestStepText = await page.locator('[data-top-panel-step]').last().innerText().catch(() => '')
    expect((latestStepText || '').trim().length).toBeGreaterThan(0)
  })
})
