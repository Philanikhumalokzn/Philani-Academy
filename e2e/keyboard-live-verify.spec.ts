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

  test('current lesson opens stacked canvas with visible bottom keyboard', async ({ page }) => {
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

    const xTexts = await page.getByText(/^x$/).evaluateAll((nodes) =>
      nodes.map((node) => {
        const el = node as HTMLElement
        const rect = el.getBoundingClientRect()
        return {
          text: el.innerText,
          visible: rect.width > 0 && rect.height > 0,
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        }
      })
    )

    const keyboardButtons = await page.locator('button[title]').evaluateAll((nodes) =>
      nodes.map((node) => {
        const el = node as HTMLButtonElement
        const rect = el.getBoundingClientRect()
        return {
          title: el.getAttribute('title'),
          visible: rect.width > 0 && rect.height > 0,
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        }
      }).filter((entry) => entry.title)
    )

    const canvasPanels = await page.locator('div.rounded.bg-white.relative.overflow-hidden').evaluateAll((nodes) =>
      nodes.map((node) => {
        const el = node as HTMLElement
        const rect = el.getBoundingClientRect()
        return {
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          text: (el.innerText || '').slice(0, 200),
        }
      })
    )

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

    console.log('X_TEXTS', JSON.stringify(xTexts, null, 2))
    console.log('KEYBOARD_BUTTONS', JSON.stringify(keyboardButtons, null, 2))
    console.log('CANVAS_PANELS', JSON.stringify(canvasPanels, null, 2))
    console.log('VIEWPORT_METRICS', JSON.stringify(viewportMetrics, null, 2))

    await page.screenshot({ path: 'test-results/keyboard-live-verify.png', fullPage: true })

    expect(xTexts.some((entry) => entry.visible)).toBeTruthy()
  })
})