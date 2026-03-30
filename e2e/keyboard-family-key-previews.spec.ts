import { expect, test, type Page } from '@playwright/test'

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
      return
    }
    if (await keyboardField.isVisible().catch(() => false)) {
      return
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
      await candidate.click({ force: true })
      await page.waitForTimeout(3500)
      if (await editorSurface.isVisible().catch(() => false)) {
        return
      }
      if (await keyboardField.isVisible().catch(() => false)) {
        return
      }
    }

    await page.waitForTimeout(1000)
  }

  if (await keyboardField.isVisible().catch(() => false)) {
    return
  }
  await expect(editorSurface).toBeVisible({ timeout: 30_000 })
}

test.describe('keyboard family key previews', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test.setTimeout(180_000)

  test('logs and enclosure family keys render boxes instead of raw placeholder text', async ({ page }) => {
    test.skip(!baseUrl || !email || !password, 'Set E2E_BASE_URL, E2E_USER_A_EMAIL, E2E_USER_A_PASSWORD')

    await page.goto(toAbsoluteUrl('/auth/signin'), { waitUntil: 'domcontentloaded' })
    await fillSignIn(page)

    if (!/\/dashboard/i.test(page.url())) {
      await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'domcontentloaded' })
    }

    await ensureBoardCanvasReady(page)

    const logsFamilyButton = page.locator('button[data-keyboard-representative="logs"]').last()
    const enclosuresFamilyButton = page.locator('button[data-keyboard-representative="enclosures"]').last()
    const calculusFamilyButton = page.locator('button[data-keyboard-representative="calculus"]').last()
    const greekFamilyButton = page.locator('button[data-keyboard-representative="greek"]').last()
    const relationsFamilyButton = page.locator('button[data-keyboard-representative="relations"]').last()
    const clusterButtons = page.locator('div.grid.grid-cols-3.gap-2').nth(2).locator('button')
    const topLeftClusterButton = clusterButtons.nth(0)
    const topMiddleClusterButton = clusterButtons.nth(1)
    const topRightClusterButton = clusterButtons.nth(2)

    await expect(logsFamilyButton).toBeVisible({ timeout: 20_000 })
    await expect(enclosuresFamilyButton).toBeVisible({ timeout: 20_000 })
    await expect(calculusFamilyButton).toBeVisible({ timeout: 20_000 })
    await expect(greekFamilyButton).toBeVisible({ timeout: 20_000 })
    await expect(relationsFamilyButton).toBeVisible({ timeout: 20_000 })
    await expect(topLeftClusterButton).toBeVisible({ timeout: 20_000 })
    await expect(topMiddleClusterButton).toBeVisible({ timeout: 20_000 })
    await expect(topRightClusterButton).toBeVisible({ timeout: 20_000 })

    const logsHtml = await logsFamilyButton.innerHTML()
    const enclosuresHtml = await enclosuresFamilyButton.innerHTML()
    const logsText = ((await logsFamilyButton.innerText().catch(() => '')) || '').toLowerCase()
    const enclosuresText = ((await enclosuresFamilyButton.innerText().catch(() => '')) || '').toLowerCase()

    expect(logsHtml).toContain('katex')
    expect(enclosuresHtml).toContain('katex')
    expect(logsHtml).not.toMatch(/placeholder/i)
    expect(enclosuresHtml).not.toMatch(/placeholder/i)
    expect(logsText).not.toContain('placeholder')
    expect(enclosuresText).not.toContain('placeholder')

    await expect(topLeftClusterButton).toHaveAttribute('data-keyboard-action', 'nth-root')
    await expect(topMiddleClusterButton).toHaveAttribute('data-keyboard-action', 'fraction')
    await expect(topRightClusterButton).toHaveAttribute('data-keyboard-action', 'power2')

    const topLeftHtml = await topLeftClusterButton.innerHTML()
    const topMiddleHtml = await topMiddleClusterButton.innerHTML()
    expect(topLeftHtml).toContain('katex')
    expect(topMiddleHtml).toContain('katex')
    expect(topLeftHtml).not.toMatch(/placeholder/i)
    expect(topMiddleHtml).not.toMatch(/placeholder/i)

    const calculusBox = await calculusFamilyButton.boundingBox()
    const greekBox = await greekFamilyButton.boundingBox()
    const relationsBox = await relationsFamilyButton.boundingBox()

    expect(calculusBox).not.toBeNull()
    expect(greekBox).not.toBeNull()
    expect(relationsBox).not.toBeNull()

    if (!calculusBox || !greekBox || !relationsBox) {
      throw new Error('Expected calculus, greek, and relations family buttons to have visible layout boxes.')
    }

    expect(Math.abs(calculusBox.y - greekBox.y)).toBeLessThan(12)
    expect(Math.abs(greekBox.y - relationsBox.y)).toBeLessThan(12)
    expect(calculusBox.x).toBeLessThan(greekBox.x)
    expect(greekBox.x).toBeLessThan(relationsBox.x)

    await logsFamilyButton.screenshot({ path: 'test-results/keyboard-family-logs-preview.png' })
    await enclosuresFamilyButton.screenshot({ path: 'test-results/keyboard-family-enclosures-preview.png' })
    await topLeftClusterButton.screenshot({ path: 'test-results/keyboard-cluster-nth-root-preview.png' })
    await topMiddleClusterButton.screenshot({ path: 'test-results/keyboard-cluster-fraction-preview.png' })
    await page.locator('div.grid.grid-cols-3.gap-2').nth(2).screenshot({ path: 'test-results/keyboard-cluster-middle-row-layout.png' })
  })
})