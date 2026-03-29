import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

const baseUrl = (process.env.E2E_BASE_URL || '').trim()
const email = (process.env.E2E_USER_A_EMAIL || '').trim()
const password = (process.env.E2E_USER_A_PASSWORD || '').trim()

const toAbsoluteUrl = (value: string) => {
  if (/^https?:\/\//i.test(value)) return value
  const normalizedBase = baseUrl.replace(/\/$/, '')
  const normalizedPath = value.startsWith('/') ? value : `/${value}`
  return `${normalizedBase}${normalizedPath}`
}

const fillSignIn = async (page: Parameters<typeof test>[0]['page']) => {
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

const triggerRepresentativeTap = async (page: Page, locator: Locator) => {
  await locator.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true })
  await page.waitForTimeout(20)
  await locator.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true })
}

const triggerRepresentativeDoubleTap = async (page: Page, locator: Locator) => {
  await triggerRepresentativeTap(page, locator)
  await page.waitForTimeout(80)
  await triggerRepresentativeTap(page, locator)
}

const triggerRepresentativeLongPress = async (page: Page, locator: Locator, holdMs = 650) => {
  await locator.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true })
  await page.waitForTimeout(holdMs)
  await locator.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true })
}

const dispatchElementClick = async (locator: Locator) => {
  await locator.dispatchEvent('click', { bubbles: true })
}

const ensureBoardCanvasReady = async (page: Page) => {
  const gradePrompt = page.getByText(/Choose a grade to open the shared board\./i)
  if (await gradePrompt.isVisible().catch(() => false)) {
    const gradeSelect = page.getByRole('combobox', { name: /choose grade/i })
    await expect(gradeSelect).toBeVisible({ timeout: 15_000 })
    // Default to Grade 8 for E2E bootstrap when no active grade is selected yet.
    await gradeSelect.selectOption({ label: 'Grade 8' })
    await expect(gradePrompt).toBeHidden({ timeout: 20_000 })
  }

  const editorSurface = page.locator('.ms-editor').last()
  await expect(editorSurface).toBeVisible({ timeout: 30_000 })
  return editorSurface
}

test.describe('live keyboard verification', () => {
  test.setTimeout(180_000)

  test('current lesson supports recursive single tap, double tap, and long press on representative keys', async ({ page }) => {
    test.skip(!baseUrl || !email || !password, 'Set E2E_BASE_URL, E2E_USER_A_EMAIL, E2E_USER_A_PASSWORD')

    page.on('dialog', async (dialog) => {
      try {
        await dialog.accept()
      } catch {}
    })

    await page.goto(toAbsoluteUrl('/auth/signin'), { waitUntil: 'domcontentloaded' })
    await fillSignIn(page)

    await page.goto(toAbsoluteUrl('/board'), { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4_000)

    const editorSurface = await ensureBoardCanvasReady(page)

    const readKeyboardButtons = async () => page.locator('button[title]').evaluateAll((nodes) =>
      nodes.map((node) => {
        const el = node as HTMLButtonElement
        const rect = el.getBoundingClientRect()
        return {
          title: el.getAttribute('title'),
          text: (el.textContent || '').trim(),
          visible: rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).opacity !== '0',
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        }
      })
    )

    const xKey = page.locator('button[title="x"]').first()
    const plusKey = page.locator('button[title="plus"]').first()
    const equalsKey = page.locator('button[title="equals"]').first()
    const deleteKey = page.locator('button[title="delete"]').first()
    const fractionKey = page.locator('button[title="fraction"]').first()
    const qKey = page.locator('button[title="q"]').first()
    const oneKey = page.locator('button[title="1"]').first()
    const closeButton = page.getByRole('button', { name: /^close$/i }).first()
    const familySummary = page.getByText(/Full family for /i).first()

    if (!(await xKey.isVisible().catch(() => false))) {
      await editorSurface.click({ position: { x: 120, y: 120 } })
    }

    await expect(xKey).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button[title="plus"]').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button[title="equals"]').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button[title="delete"]').first()).toBeVisible({ timeout: 10_000 })
    await expect(fractionKey).toBeHidden()

    const initialKeyboardButtons = await readKeyboardButtons()
    expect(initialKeyboardButtons.some((entry) => entry.title === 'x' && entry.visible)).toBeTruthy()
    expect(initialKeyboardButtons.some((entry) => entry.title === 'plus' && entry.visible)).toBeTruthy()
    expect(initialKeyboardButtons.some((entry) => entry.title === 'equals' && entry.visible)).toBeTruthy()
    expect(initialKeyboardButtons.some((entry) => entry.title === 'delete' && entry.visible)).toBeTruthy()

    await triggerRepresentativeTap(page, xKey)

    await page.waitForTimeout(350)
    await expect(qKey).toBeHidden()
    await expect(fractionKey).toBeHidden()

    await triggerRepresentativeDoubleTap(page, xKey)

    await expect(qKey).toBeVisible({ timeout: 10_000 })
    await expect(oneKey).toBeVisible({ timeout: 10_000 })
    await expect(familySummary).toContainText('Full family for x')

    await triggerRepresentativeLongPress(page, qKey)

    await expect(fractionKey).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button[title="fraction"]').first()).toContainText('q')

    await triggerRepresentativeDoubleTap(page, qKey)

    await expect(qKey).toBeVisible({ timeout: 10_000 })
    await expect(oneKey).toBeVisible({ timeout: 10_000 })
    await expect(familySummary).toContainText('Full family for q')

    await triggerRepresentativeTap(page, qKey)

    await page.waitForTimeout(350)
    await expect(qKey).toBeHidden()

    if (!(await xKey.isVisible().catch(() => false))) {
      await editorSurface.click({ position: { x: 120, y: 120 } })
    }

    await triggerRepresentativeLongPress(page, xKey)

    await expect(fractionKey).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button[title="square"]').first()).toBeVisible({ timeout: 10_000 })

    const stageKeyboardButtons = await readKeyboardButtons()
    expect(stageKeyboardButtons.some((entry) => entry.title === 'fraction' && entry.visible)).toBeTruthy()
    expect(stageKeyboardButtons.some((entry) => entry.title === 'square' && entry.visible)).toBeTruthy()

    const viewportMetrics = await page.locator('div.relative.flex-1.min-h-0.overflow-auto').evaluateAll((nodes) =>
      nodes.map((node) => {
        const el = node as HTMLElement
        const rect = el.getBoundingClientRect()
        return {
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          scrollLeft: Math.round(el.scrollLeft),
          scrollTop: Math.round(el.scrollTop),
          scrollWidth: Math.round(el.scrollWidth),
          scrollHeight: Math.round(el.scrollHeight),
        }
      })
    )

    console.log('INITIAL_KEYBOARD_BUTTONS', JSON.stringify(initialKeyboardButtons, null, 2))
    console.log('STAGE_KEYBOARD_BUTTONS', JSON.stringify(stageKeyboardButtons, null, 2))
    console.log('VIEWPORT_METRICS', JSON.stringify(viewportMetrics, null, 2))

    await page.screenshot({ path: 'test-results/keyboard-live-verify.png', fullPage: true })
  })

  test('keyboard mode top panel tap updates caret for a six-term expression', async ({ page }) => {
    test.skip(!baseUrl || !email || !password, 'Set E2E_BASE_URL, E2E_USER_A_EMAIL, E2E_USER_A_PASSWORD')

    await page.goto(toAbsoluteUrl('/auth/signin'), { waitUntil: 'domcontentloaded' })
    await fillSignIn(page)

    await page.goto(toAbsoluteUrl('/board'), { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4_000)

    const editorSurface = await ensureBoardCanvasReady(page)

    const xKey = page.locator('button[title="x"]').first()
    const plusKey = page.locator('button[title="plus"]').first()

    if (!(await xKey.isVisible().catch(() => false))) {
      await editorSurface.click({ position: { x: 120, y: 120 } })
    }

    await expect(xKey).toBeVisible({ timeout: 10_000 })
    await expect(plusKey).toBeVisible({ timeout: 10_000 })

    for (let i = 0; i < 6; i += 1) {
      await triggerRepresentativeTap(page, xKey)
      if (i < 5) await triggerRepresentativeTap(page, plusKey)
    }

    const topPanel = page.locator('math-field.keyboard-mathlive-field').first()
    await expect(topPanel).toBeVisible({ timeout: 10_000 })

    const readTopLatex = async () => {
      const value = await topPanel.evaluate((node) => {
        const field = node as HTMLElement & { value?: string }
        return String(field.value || '')
      })
      return value.trim()
    }

    const beforeTapLatex = await readTopLatex()
    expect(beforeTapLatex).toContain('x')

    const box = await topPanel.boundingBox()
    expect(box).toBeTruthy()
    if (!box) return

    await topPanel.click({ position: { x: Math.max(8, box.width - 12), y: Math.max(8, box.height * 0.5) } })
    await triggerRepresentativeTap(page, plusKey)
    const rightTapLatex = await readTopLatex()
    expect(rightTapLatex).toMatch(/\+$/)

    await topPanel.click({ position: { x: 8, y: Math.max(8, box.height * 0.5) } })
    await triggerRepresentativeTap(page, plusKey)
    const leftTapLatex = await readTopLatex()
    expect(leftTapLatex.trimStart().startsWith('+')).toBeTruthy()
  })
})