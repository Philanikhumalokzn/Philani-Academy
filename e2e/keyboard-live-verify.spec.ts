import { expect, test } from '@playwright/test'

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

test.describe('live keyboard verification', () => {
  test.setTimeout(180_000)

  test('current lesson shows a blank canvas, reveals representative keys, expands families, and hides the keyboard after inactivity', async ({ page }) => {
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

    const panels = page.locator('div.rounded.bg-white.relative.overflow-hidden')
    await expect(panels.first()).toBeVisible({ timeout: 30_000 })

    const panelCount = await panels.count()
    const topPanel = panelCount > 1 ? panels.first() : null
    const bottomPanel = panels.last()

    const readPanelText = async (locator: typeof topPanel) => locator.evaluate((node) => (node.textContent || '').trim())

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

    const initialTopText = topPanel ? await readPanelText(topPanel) : null
    const initialBottomText = await readPanelText(bottomPanel)
    const initialKeyboardButtons = await readKeyboardButtons()

    if (initialTopText != null) {
      expect(initialTopText).toBe('')
    }
    expect(initialBottomText).toBe('')
    expect(initialKeyboardButtons.some((entry) => entry.visible)).toBeFalsy()

    await bottomPanel.click({ position: { x: 120, y: 120 } })

    await expect(page.locator('button[title="x"]').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button[title="plus"]').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button[title="equals"]').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button[title="delete"]').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button[title="fraction"]').first()).toBeHidden()

    const visibleKeyboardButtons = await readKeyboardButtons()
    expect(visibleKeyboardButtons.some((entry) => entry.title === 'x' && entry.visible)).toBeTruthy()
    expect(visibleKeyboardButtons.some((entry) => entry.title === 'plus' && entry.visible)).toBeTruthy()
    expect(visibleKeyboardButtons.some((entry) => entry.title === 'equals' && entry.visible)).toBeTruthy()

    await page.locator('button[title="x"]').first().dblclick()

    await expect(page.locator('button[title="q"]').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button[title="1"]').first()).toBeVisible({ timeout: 10_000 })

    await page.locator('button[title="x"]').first().click()

    await page.waitForTimeout(3400)

    const finalTopText = topPanel ? await readPanelText(topPanel) : null
    const finalBottomText = await readPanelText(bottomPanel)
    const fadedKeyboardButtons = await readKeyboardButtons()

    expect(finalBottomText).toContain('x')
    expect(fadedKeyboardButtons.some((entry) => entry.visible)).toBeFalsy()

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

    console.log('INITIAL_TOP_TEXT', JSON.stringify(initialTopText))
    console.log('INITIAL_BOTTOM_TEXT', JSON.stringify(initialBottomText))
    console.log('INITIAL_KEYBOARD_BUTTONS', JSON.stringify(initialKeyboardButtons, null, 2))
    console.log('VISIBLE_KEYBOARD_BUTTONS', JSON.stringify(visibleKeyboardButtons, null, 2))
    console.log('FINAL_TOP_TEXT', JSON.stringify(finalTopText))
    console.log('FINAL_BOTTOM_TEXT', JSON.stringify(finalBottomText))
    console.log('FADED_KEYBOARD_BUTTONS', JSON.stringify(fadedKeyboardButtons, null, 2))
    console.log('VIEWPORT_METRICS', JSON.stringify(viewportMetrics, null, 2))

    await page.screenshot({ path: 'test-results/keyboard-live-verify.png', fullPage: true })
  })
})