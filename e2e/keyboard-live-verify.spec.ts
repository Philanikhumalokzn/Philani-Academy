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

test.describe('live keyboard verification', () => {
  test.setTimeout(180_000)

  test('current lesson supports single tap, double tap, and long press on representative keys', async ({ page }) => {
    test.skip(!baseUrl || !email || !password, 'Set E2E_BASE_URL, E2E_USER_A_EMAIL, E2E_USER_A_PASSWORD')

    page.on('dialog', async (dialog) => {
      try {
        await dialog.accept()
      } catch {}
    })

    await page.goto(toAbsoluteUrl('/auth/signin'), { waitUntil: 'domcontentloaded' })
    await fillSignIn(page)

    if (!/\/dashboard/i.test(page.url())) {
      await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'domcontentloaded' })
    }

    const enterClassButton = page.getByRole('button', { name: /enter class/i }).first()
    await expect(enterClassButton).toBeVisible({ timeout: 30_000 })
    await enterClassButton.click()

    await page.waitForTimeout(8_000)

    const editorSurface = page.locator('.ms-editor').last()
    await expect(editorSurface).toBeVisible({ timeout: 30_000 })

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

    await dispatchElementClick(closeButton)
    await expect(qKey).toBeHidden()
    await expect(oneKey).toBeHidden()

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
})