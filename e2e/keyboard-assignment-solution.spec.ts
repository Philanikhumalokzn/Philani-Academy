import { expect, test, type Locator, type Page } from '@playwright/test'

const localBaseUrl = (process.env.LOCAL_E2E_BASE_URL || 'http://127.0.0.1:3000').trim()

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

const getCommitButton = (page: Page) =>
  page.locator('button[title="Commit / Save"], button[title="Send step"], button[title="Update step"]').first()

const openKeyboardEditingMode = async (page: Page) => {
  const textButton = page.locator('button[title="Text"]').first()
  await clickToolbarButton(textButton)
  await page.waitForTimeout(320)
}

const readMathfieldValue = async (page: Page) => {
  const field = page.locator('math-field.keyboard-mathlive-field').first()
  await expect(field).toBeVisible({ timeout: 20_000 })
  return field.evaluate((node) => String((node as HTMLElement & { value?: string }).value || ''))
}

const goToAssignmentSolutionLab = async (page: Page) => {
  await page.goto(`${localBaseUrl}/keyboard-assignment-solution-lab`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('button[title="7"]').first()).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('math-field.keyboard-mathlive-field').first()).toBeVisible({ timeout: 60_000 })
}

test.describe('keyboard assignment solution send flow', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test.setTimeout(120_000)

  test('first send commits a keyboard step instead of saving immediately', async ({ page }) => {
    const saveBodies: Array<{ latex?: string | null }> = []
    await page.route('**/api/sessions/keyboard-assignment-solution-lab-board/assignments/keyboard-assignment-solution-lab-assignment/solutions', async (route) => {
      const payload = route.request().postDataJSON() as { latex?: string | null }
      saveBodies.push(payload)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })

    await goToAssignmentSolutionLab(page)

    await tapKey(page, page.locator('button[title="7"]').first())
    await tapKey(page, page.locator('button[title="plus"]').first())
    await tapKey(page, page.locator('button[title="5"]').first())
    await openKeyboardEditingMode(page)
    await clickToolbarButton(getCommitButton(page))

    await expect.poll(() => readMathfieldValue(page)).toBe('')
    await expect(page.locator('[data-top-panel-step-shell]')).toHaveCount(1)
    await expect(saveBodies).toHaveLength(0)
  })

  test('selected keyboard solution step updates in place', async ({ page }) => {
    await goToAssignmentSolutionLab(page)

    await tapKey(page, page.locator('button[title="7"]').first())
    await tapKey(page, page.locator('button[title="plus"]').first())
    await tapKey(page, page.locator('button[title="5"]').first())
    await openKeyboardEditingMode(page)
    await clickToolbarButton(getCommitButton(page))

    const firstStepButton = page.locator('[data-top-panel-step]').first()
    await clickToolbarButton(firstStepButton)
    await expect.poll(() => readMathfieldValue(page)).toContain('7+5')

    await tapKey(page, page.locator('button[title="plus"]').first())
    await tapKey(page, page.locator('button[title="1"]').first())
    await clickToolbarButton(getCommitButton(page))

    await expect(page.locator('[data-top-panel-step-shell]')).toHaveCount(1)
    await clickToolbarButton(firstStepButton)
    await expect.poll(() => readMathfieldValue(page)).toContain('7+5+1')
  })

  test('blank save after committed keyboard steps persists the solution', async ({ page }) => {
    const saveBodies: Array<{ latex?: string | null }> = []
    page.on('dialog', async (dialog) => {
      await dialog.accept()
    })
    await page.route('**/api/sessions/keyboard-assignment-solution-lab-board/assignments/keyboard-assignment-solution-lab-assignment/solutions', async (route) => {
      const payload = route.request().postDataJSON() as { latex?: string | null }
      saveBodies.push(payload)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })

    await goToAssignmentSolutionLab(page)

    await tapKey(page, page.locator('button[title="7"]').first())
    await tapKey(page, page.locator('button[title="plus"]').first())
    await tapKey(page, page.locator('button[title="5"]').first())
    await openKeyboardEditingMode(page)
    await clickToolbarButton(getCommitButton(page))
    await clickToolbarButton(getCommitButton(page))

    await expect.poll(() => saveBodies.length).toBe(1)
    await expect.poll(() => saveBodies[0]?.latex || '').toContain('7+5')
  })
})