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

const getSendStepButton = (page: Page) =>
  page.locator('button[title="Send step"], button[title="Update step"]').first()

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

const attachToolbarEventCapture = async (page: Page) => {
  await page.evaluate(() => {
    ;(window as any).__keyboardToolbarEvents = {
      textToggle: 0,
      diagramToggle: 0,
      diagramOpenGrid: 0,
    }

    window.addEventListener('philani-text:toggle-tray', () => {
      ;(window as any).__keyboardToolbarEvents.textToggle += 1
    })
    window.addEventListener('philani-diagrams:toggle-tray', () => {
      ;(window as any).__keyboardToolbarEvents.diagramToggle += 1
    })
    window.addEventListener('philani-diagrams:open-grid', () => {
      ;(window as any).__keyboardToolbarEvents.diagramOpenGrid += 1
    })
  })
}

const readToolbarEventCapture = async (page: Page) => {
  return page.evaluate(() => (window as any).__keyboardToolbarEvents)
}

const goToKeyboardToolbarLab = async (page: Page) => {
  await page.route('**/api/sessions/keyboard-swipe-lab-board/latex-saves**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        shared: [],
        mine: [],
      }),
    })
  })

  await page.goto(`${localBaseUrl}/keyboard-swipe-lab`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('button[title="7"]').first()).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('math-field.keyboard-mathlive-field').first()).toBeVisible({ timeout: 60_000 })
  await attachToolbarEventCapture(page)
}

test.describe('keyboard toolbar actions', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test.setTimeout(120_000)

  test('Notes opens the keyboard session notes modal', async ({ page }) => {
    await goToKeyboardToolbarLab(page)

    const notesButton = page.getByRole('button', { name: /open notes/i })
    await expect(notesButton).toBeVisible()
    await expect(notesButton).toBeEnabled()

    await clickToolbarButton(notesButton)

    await expect(page.getByText('Saved questions for this session')).toBeVisible()
    await expect(page.getByText('No saved questions yet.')).toBeVisible()

    await clickToolbarButton(page.getByRole('button', { name: 'Close' }))
    await expect(page.getByText('Saved questions for this session')).toBeHidden()
  })

  test('Undo, Redo, and Clear operate on the keyboard draft', async ({ page }) => {
    await goToKeyboardToolbarLab(page)

    const nineKey = page.locator('button[title="9"]').first()
    const undoButton = page.locator('button[title="Undo"]').first()
    const redoButton = page.locator('button[title="Redo"]').first()
    const clearButton = page.locator('button[title="Clear"]').first()

    await expect(clearButton).toBeDisabled()

    await tapKey(page, nineKey)
    await expect.poll(() => readMathfieldValue(page)).toContain('9')

    await expect(undoButton).toBeEnabled()
    await expect(clearButton).toBeEnabled()

    await clickToolbarButton(undoButton)
    await expect.poll(() => readMathfieldValue(page)).toBe('')

    await expect(redoButton).toBeEnabled()
    await clickToolbarButton(redoButton)
    await expect.poll(() => readMathfieldValue(page)).toContain('9')

    await clickToolbarButton(clearButton)
    await expect.poll(() => readMathfieldValue(page)).toBe('')
  })

  test('Send step commits the keyboard draft as a top-panel step', async ({ page }) => {
    await goToKeyboardToolbarLab(page)

    const sevenKey = page.locator('button[title="7"]').first()
    const plusKey = page.locator('button[title="plus"]').first()
    const fiveKey = page.locator('button[title="5"]').first()
    const sendButton = getSendStepButton(page)

    await expect(sendButton).toBeDisabled()

    await tapKey(page, sevenKey)
    await tapKey(page, plusKey)
    await tapKey(page, fiveKey)

    await openKeyboardEditingMode(page)

    await expect.poll(() => readMathfieldValue(page)).toContain('7+5')
    await expect(sendButton).toBeEnabled()

    await clickToolbarButton(sendButton)

    await expect.poll(() => readMathfieldValue(page)).toBe('')
    await expect(page.locator('[data-top-panel-step-shell]')).toHaveCount(1)
    await expect(page.locator('[data-top-panel-step-shell]').first()).toContainText('Step 1')
  })

  test('Compute appends a new keyboard step from the last committed expression', async ({ page }) => {
    await goToKeyboardToolbarLab(page)

    const sevenKey = page.locator('button[title="7"]').first()
    const plusKey = page.locator('button[title="plus"]').first()
    const fiveKey = page.locator('button[title="5"]').first()
    const sendButton = getSendStepButton(page)
    const computeButton = page.locator('button[title="Compute answer"]').first()

    await tapKey(page, sevenKey)
    await tapKey(page, plusKey)
    await tapKey(page, fiveKey)
    await openKeyboardEditingMode(page)
    await clickToolbarButton(sendButton)

    await expect(page.locator('[data-top-panel-step-shell]')).toHaveCount(1)

    await clickToolbarButton(computeButton)

    await expect(page.locator('[data-top-panel-step-shell]')).toHaveCount(2)
    await expect(page.locator('[data-top-panel-step-shell]').nth(1)).toContainText('12')
  })

  test('Send step updates an existing keyboard step when a top-panel step is selected', async ({ page }) => {
    await goToKeyboardToolbarLab(page)

    const sevenKey = page.locator('button[title="7"]').first()
    const plusKey = page.locator('button[title="plus"]').first()
    const fiveKey = page.locator('button[title="5"]').first()
    const oneKey = page.locator('button[title="1"]').first()
    const sendButton = getSendStepButton(page)

    await tapKey(page, sevenKey)
    await tapKey(page, plusKey)
    await tapKey(page, fiveKey)
    await openKeyboardEditingMode(page)
    await clickToolbarButton(sendButton)

    const firstStepButton = page.locator('[data-top-panel-step]').first()
    await clickToolbarButton(firstStepButton)
    await expect.poll(() => readMathfieldValue(page)).toContain('7+5')
    await expect(sendButton).toBeEnabled()
    await expect(sendButton).toHaveAttribute('title', 'Update step')

    await tapKey(page, plusKey)
    await tapKey(page, oneKey)
    await clickToolbarButton(sendButton)

    await expect(page.locator('[data-top-panel-step-shell]')).toHaveCount(1)
    await clickToolbarButton(firstStepButton)
    await expect.poll(() => readMathfieldValue(page)).toContain('7+5+1')
  })

  test('Empty send opens the finish-question flow for committed keyboard steps', async ({ page }) => {
    await goToKeyboardToolbarLab(page)

    const sevenKey = page.locator('button[title="7"]').first()
    const plusKey = page.locator('button[title="plus"]').first()
    const fiveKey = page.locator('button[title="5"]').first()
    const sendButton = getSendStepButton(page)

    await tapKey(page, sevenKey)
    await tapKey(page, plusKey)
    await tapKey(page, fiveKey)
    await openKeyboardEditingMode(page)
    await clickToolbarButton(sendButton)

    await expect.poll(() => readMathfieldValue(page)).toBe('')
    await expect(sendButton).toBeEnabled()

    await clickToolbarButton(sendButton)

    await expect(page.getByText('Save As', { exact: true })).toBeVisible()
    await expect(page.locator('input[placeholder="e.g. Solve for x"]')).toHaveValue(/.+/)
    await expect(page.getByText('1 step')).toBeVisible()
    await clickToolbarButton(page.getByRole('button', { name: 'Close' }))
    await expect(page.getByText('Save As')).toBeHidden()
  })

  test('Text enters keyboard recall mode and Diagrams keep their tray actions', async ({ page }) => {
    await goToKeyboardToolbarLab(page)

    const sevenKey = page.locator('button[title="7"]').first()
    const plusKey = page.locator('button[title="plus"]').first()
    const fiveKey = page.locator('button[title="5"]').first()
    const sendButton = getSendStepButton(page)
    const textButton = page.locator('button[title="Text"]').first()
    const diagramsButton = page.locator('button[title="Diagrams"]').first()
    const firstStepButton = page.locator('[data-top-panel-step]').first()

    await tapKey(page, sevenKey)
    await tapKey(page, plusKey)
    await tapKey(page, fiveKey)
    await openKeyboardEditingMode(page)
    await clickToolbarButton(sendButton)

    await expect(page.locator('[data-top-panel-step-shell]')).toHaveCount(1)
    await expect.poll(() => readMathfieldValue(page)).toBe('')

    await clickToolbarButton(textButton)
    await page.waitForTimeout(350)

    await expect(firstStepButton).toBeVisible()
    await expect.poll(() => readToolbarEventCapture(page)).toMatchObject({
      textToggle: 0,
    })

    await clickToolbarButton(firstStepButton)
    await expect.poll(() => readMathfieldValue(page)).toContain('7+5')
    await expect(sendButton).toHaveAttribute('title', 'Update step')

    await clickToolbarButton(diagramsButton)
    await page.waitForTimeout(350)
    await clickToolbarButton(diagramsButton)
    await page.waitForTimeout(80)
    await clickToolbarButton(diagramsButton)
    await page.waitForTimeout(120)

    await expect.poll(() => readToolbarEventCapture(page)).toMatchObject({
      diagramToggle: 1,
      diagramOpenGrid: 1,
    })
  })
})
