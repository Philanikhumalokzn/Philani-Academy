import { expect, test, type Locator, type Page } from '@playwright/test'

const localBaseUrl = (process.env.LOCAL_E2E_BASE_URL || 'http://127.0.0.1:3000').trim()

const longPressKey = async (page: Page, locator: Locator, holdMs = 650) => {
  await locator.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true })
  await page.waitForTimeout(holdMs)
  await locator.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true })
}

const closeFamilyOverlay = async (page: Page) => {
  await page.locator('body').click({ position: { x: 8, y: 8 }, force: true })
  await page.waitForTimeout(120)
}

const goToKeyboardSwipeLab = async (page: Page) => {
  await page.goto(`${localBaseUrl}/keyboard-swipe-lab`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('math-field.keyboard-mathlive-field').first()).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('button[data-keyboard-action="plus"][data-keyboard-representative="plus-operators"]').first()).toBeVisible({ timeout: 60_000 })
}

test.describe('keyboard operator families', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test.setTimeout(120_000)

  test('top-row operator keys expose extended families on long press', async ({ page }) => {
    await goToKeyboardSwipeLab(page)

    const plusKey = page.locator('button[data-keyboard-action="plus"][data-keyboard-representative="plus-operators"]').first()
    const minusKey = page.locator('button[data-keyboard-action="minus"][data-keyboard-representative="minus-operators"]').first()
    const timesKey = page.locator('button[data-keyboard-action="times"][data-keyboard-representative="times-operators"]').first()
    const divideKey = page.locator('button[data-keyboard-action="divide"][data-keyboard-representative="divide-operators"]').first()

    await longPressKey(page, plusKey)
    await expect(page.locator('button[title="summation"]').last()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button[title="plus or minus"]').last()).toBeVisible({ timeout: 10_000 })

    await closeFamilyOverlay(page)

    await longPressKey(page, minusKey)
    await expect(page.locator('button[title="minus or plus"]').last()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button[title="set difference"]').last()).toBeVisible({ timeout: 10_000 })

    await closeFamilyOverlay(page)

    await longPressKey(page, timesKey)
    await expect(page.locator('button[title="dot operator"]').last()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button[title="product"]').last()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button[title="asterisk multiplication"]').last()).toBeVisible({ timeout: 10_000 })

    await closeFamilyOverlay(page)

    await longPressKey(page, divideKey)
    await expect(page.locator('button[title="slash division"]').last()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button[title="ratio"]').last()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button[title="fraction"]').last()).toBeVisible({ timeout: 10_000 })
  })

  test('greek family includes the degree symbol', async ({ page }) => {
    await goToKeyboardSwipeLab(page)

    const greekKey = page.locator('button[data-keyboard-action="theta"][data-keyboard-representative="greek"]').first()

    await longPressKey(page, greekKey)
    await expect(page.locator('button[title="degree"]').last()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button[title="degree"]').last()).toContainText('°')
  })
})