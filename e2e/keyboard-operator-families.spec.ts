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

const getMathfieldLatex = async (page: Page, format: 'latex' | 'latex-without-placeholders' = 'latex') => {
  const field = page.locator('math-field.keyboard-mathlive-field').first()
  return field.evaluate((node, outputFormat) => node.getValue?.(outputFormat as 'latex' | 'latex-without-placeholders') || '', format)
}

const getTopPanelRenderedLatex = async (page: Page) => {
  const panel = page.locator('[data-top-panel-katex-display="true"]').first()
  return panel.evaluate((node) => node.querySelector('annotation[encoding="application/x-tex"]')?.textContent || '')
}

const insertNthRoot = async (page: Page) => {
  const rootKey = page.locator('button[title="nth root"]').first()
  await rootKey.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true })
  await rootKey.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true })
}

const tapKeyboardAction = async (page: Page, actionId: string) => {
  const key = page.locator(`button[data-keyboard-action="${actionId}"]`).first()
  await key.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true })
  await key.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true })
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

  test('nth root keeps a transient index box, collapses when idle, and re-expands on radicand input', async ({ page }) => {
    await goToKeyboardSwipeLab(page)

    const field = page.locator('math-field.keyboard-mathlive-field').first()
    const topPanel = page.locator('[data-top-panel-katex-display="true"]').first()

    await insertNthRoot(page)

    await expect.poll(() => getMathfieldLatex(page)).toContain('\\sqrt[\\placeholder[')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt[]{}')
    await expect(topPanel).toBeVisible()
    await expect.poll(() => getTopPanelRenderedLatex(page)).toContain('\\sqrt[\\square]{\\square}')
    await expect.poll(() => getTopPanelRenderedLatex(page)).not.toContain('kbd-rad-')

    await page.waitForTimeout(2500)
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt{\\placeholder[kbd-rad-r-1]{}}')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt{}')
    await expect.poll(() => getTopPanelRenderedLatex(page)).toContain('\\sqrt{\\square}')
    await expect.poll(() => getTopPanelRenderedLatex(page)).not.toContain('kbd-rad-')

    await field.evaluate((node) => node.executeCommand(['insert', '7']))

    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[\\placeholder[kbd-rad-i-1]{}]{7}')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt[]{7}')
    await expect.poll(() => getTopPanelRenderedLatex(page)).toContain('\\sqrt[\\square]{7}')
    await expect.poll(() => getTopPanelRenderedLatex(page)).not.toContain('kbd-rad-')
  })

  test('nth root hides each field box as soon as that field has content', async ({ page }) => {
    await goToKeyboardSwipeLab(page)

    let field = page.locator('math-field.keyboard-mathlive-field').first()

    await insertNthRoot(page)
    await field.evaluate((node) => node.executeCommand(['insert', '7']))
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[\\placeholder[kbd-rad-i-1]{}]{7}')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt[]{7}')

    await page.reload({ waitUntil: 'domcontentloaded' })
    await goToKeyboardSwipeLab(page)
    field = page.locator('math-field.keyboard-mathlive-field').first()
    await insertNthRoot(page)
    await field.evaluate((node) => node.executeCommand('moveToPreviousPlaceholder'))
    await field.evaluate((node) => node.executeCommand(['insert', '3']))
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[3]{\\placeholder[kbd-rad-r-1]{}}')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt[3]{}')
  })

  test('nth root button input refreshes the index timer and re-expands after collapse', async ({ page }) => {
    await goToKeyboardSwipeLab(page)

    await insertNthRoot(page)
    await tapKeyboardAction(page, 'digit-7')
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[\\placeholder[kbd-rad-i-1]{}]{7}')

    await page.waitForTimeout(1500)
    await tapKeyboardAction(page, 'digit-8')
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[\\placeholder[kbd-rad-i-1]{}]{78}')

    await page.waitForTimeout(1500)
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[\\placeholder[kbd-rad-i-1]{}]{78}')

    await page.waitForTimeout(1200)
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt{78}')

    await tapKeyboardAction(page, 'digit-9')
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[\\placeholder[kbd-rad-i-1]{}]{789}')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt[]{789}')
  })

  test('nth root folds stray characters around a field into that field', async ({ page }) => {
    await goToKeyboardSwipeLab(page)

    let field = page.locator('math-field.keyboard-mathlive-field').first()

    await insertNthRoot(page)
    await field.evaluate((node) => node.executeCommand('moveToPreviousChar'))
    await field.evaluate((node) => node.executeCommand(['insert', 'x']))
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[\\placeholder[kbd-rad-i-1]{}]{x}')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt[]{x}')

    await page.reload({ waitUntil: 'domcontentloaded' })
    await goToKeyboardSwipeLab(page)
    field = page.locator('math-field.keyboard-mathlive-field').first()
    await insertNthRoot(page)
    await field.evaluate((node) => node.executeCommand('moveToNextChar'))
    await field.evaluate((node) => node.executeCommand(['insert', 'y']))
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[\\placeholder[kbd-rad-i-1]{}]{y}')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt[]{y}')

    await page.reload({ waitUntil: 'domcontentloaded' })
    await goToKeyboardSwipeLab(page)
    field = page.locator('math-field.keyboard-mathlive-field').first()
    await insertNthRoot(page)
    await field.evaluate((node) => node.executeCommand('moveToPreviousPlaceholder'))
    await field.evaluate((node) => node.executeCommand('moveToPreviousChar'))
    await field.evaluate((node) => node.executeCommand(['insert', 'i']))
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[i]{\\placeholder[kbd-rad-r-1]{}}')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt[i]{}')

    await page.reload({ waitUntil: 'domcontentloaded' })
    await goToKeyboardSwipeLab(page)
    field = page.locator('math-field.keyboard-mathlive-field').first()
    await insertNthRoot(page)
    await field.evaluate((node) => node.executeCommand('moveToPreviousPlaceholder'))
    await field.evaluate((node) => node.executeCommand('moveToNextChar'))
    await field.evaluate((node) => node.executeCommand(['insert', 'j']))
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[j]{\\placeholder[kbd-rad-r-1]{}}')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt[j]{}')
  })
})