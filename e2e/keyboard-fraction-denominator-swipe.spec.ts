import { expect, test, type Locator, type Page } from '@playwright/test'

const baseUrl = (process.env.E2E_BASE_URL || '').trim()
const email = (process.env.E2E_USER_A_EMAIL || '').trim()
const password = (process.env.E2E_USER_A_PASSWORD || '').trim()
const localBaseUrl = (process.env.LOCAL_E2E_BASE_URL || 'http://127.0.0.1:3000').trim()

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
  const gradePrompt = page.getByText(/Choose a grade to open the shared board\./i)
  if (await gradePrompt.isVisible().catch(() => false)) {
    const gradeSelect = page.getByRole('combobox', { name: /choose grade/i })
    await expect(gradeSelect).toBeVisible({ timeout: 15_000 })
    await gradeSelect.selectOption({ label: 'Grade 8' })
    await expect(gradePrompt).toBeHidden({ timeout: 20_000 })
  }

  const editorSurface = page.locator('.ms-editor').last()
  await expect(editorSurface).toBeVisible({ timeout: 30_000 })
  return editorSurface
}

const tapKey = async (page: Page, locator: Locator) => {
  await locator.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true })
  await page.waitForTimeout(20)
  await locator.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true })
}

const swipeKey = async (page: Page, locator: Locator, dx: number, dy: number) => {
  const box = await locator.boundingBox()
  expect(box).toBeTruthy()
  if (!box) throw new Error('Expected swipe target to have a bounding box')

  const startX = box.x + (box.width / 2)
  const startY = box.y + (box.height / 2)
  const endX = startX + dx
  const endY = startY + dy

  await locator.dispatchEvent('pointerdown', {
    pointerId: 7,
    pointerType: 'mouse',
    button: 0,
    bubbles: true,
    clientX: startX,
    clientY: startY,
  })
  await page.waitForTimeout(16)
  await locator.dispatchEvent('pointermove', {
    pointerId: 7,
    pointerType: 'mouse',
    button: 0,
    bubbles: true,
    clientX: endX,
    clientY: endY,
  })
  await page.waitForTimeout(16)
  await locator.dispatchEvent('pointerup', {
    pointerId: 7,
    pointerType: 'mouse',
    button: 0,
    bubbles: true,
    clientX: endX,
    clientY: endY,
  })
}

const readMathfieldState = async (page: Page) => {
  const field = page.locator('math-field.keyboard-mathlive-field').first()
  await expect(field).toBeVisible({ timeout: 20_000 })
  return field.evaluate((node) => {
    const mathfield = node as HTMLElement & {
      value?: string
      position?: number
      selection?: { ranges?: [number, number][]; direction?: string }
      selectionIsCollapsed?: boolean
    }
    return {
      value: String(mathfield.value || ''),
      position: typeof mathfield.position === 'number' ? mathfield.position : null,
      selection: mathfield.selection?.ranges || [],
      selectionIsCollapsed: Boolean(mathfield.selectionIsCollapsed),
    }
  })
}

const readMathfieldSlices = async (page: Page) => {
  const field = page.locator('math-field.keyboard-mathlive-field').first()
  await expect(field).toBeVisible({ timeout: 20_000 })
  return field.evaluate((node) => {
    const mathfield = node as HTMLElement & {
      position?: number
      getValue?: (start?: number | string, end?: number | string, format?: 'latex') => string
    }
    const position = typeof mathfield.position === 'number' ? mathfield.position : 0
    const getSlice = (start: number, end: number) => {
      try {
        return mathfield.getValue?.(start, end, 'latex') ?? null
      } catch {
        return null
      }
    }
    return {
      position,
      prev1: getSlice(Math.max(0, position - 1), position),
      prev2: getSlice(Math.max(0, position - 2), position),
      prev3: getSlice(Math.max(0, position - 3), position),
      next1: getSlice(position, position + 1),
      next2: getSlice(position, position + 2),
    }
  })
}

test.describe('keyboard fraction denominator swipe', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test.setTimeout(180_000)

  test('second downward swipe stacks inside the filled denominator', async ({ page }) => {
    const useBoardFlow = Boolean(baseUrl && email && password)

    let editorSurface: Locator
    if (useBoardFlow) {
      await page.goto(toAbsoluteUrl('/auth/signin'), { waitUntil: 'domcontentloaded' })
      await fillSignIn(page)
      await page.goto(toAbsoluteUrl('/board'), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(4_000)
      editorSurface = await ensureBoardCanvasReady(page)
    } else {
      await page.goto(`${localBaseUrl}/keyboard-swipe-lab`, { waitUntil: 'domcontentloaded' })
      editorSurface = page.locator('math-field.keyboard-mathlive-field').first()
      await expect(editorSurface).toBeVisible({ timeout: 30_000 })
    }

    const eightKey = page.locator('button[title="8"]').first()
    const fourKey = page.locator('button[title="4"]').first()
    const debugInput = page.getByRole('textbox', { name: /Keyboard latex input/i }).first()

    if (!(await eightKey.isVisible().catch(() => false))) {
      await editorSurface.click({ position: { x: 120, y: 120 } })
    }

    await expect(eightKey).toBeVisible({ timeout: 10_000 })
    await expect(fourKey).toBeVisible({ timeout: 10_000 })

    await tapKey(page, eightKey)
    await page.waitForTimeout(150)
    const afterEight = await readMathfieldState(page)

    await swipeKey(page, eightKey, 0, 70)
    await page.waitForTimeout(250)
    const afterFirstSwipe = await readMathfieldState(page)

    await tapKey(page, fourKey)
    await page.waitForTimeout(200)
    const afterFour = await readMathfieldState(page)
    const afterFourSlices = await readMathfieldSlices(page)

    await swipeKey(page, fourKey, 0, 70)
    await page.waitForTimeout(250)
    const afterSecondSwipe = await readMathfieldState(page)
    const finalDebugLatex = (await debugInput.inputValue().catch(() => '')).trim()

    console.log('AFTER_EIGHT', JSON.stringify(afterEight, null, 2))
    console.log('AFTER_FIRST_SWIPE', JSON.stringify(afterFirstSwipe, null, 2))
    console.log('AFTER_FOUR', JSON.stringify(afterFour, null, 2))
    console.log('AFTER_FOUR_SLICES', JSON.stringify(afterFourSlices, null, 2))
    console.log('AFTER_SECOND_SWIPE', JSON.stringify(afterSecondSwipe, null, 2))
    console.log('FINAL_DEBUG_LATEX', finalDebugLatex)

    expect(afterFirstSwipe.value).toContain('\\frac')
    expect(afterFour.value).toContain('4')
    expect(finalDebugLatex).not.toContain('84')
    expect(finalDebugLatex).toMatch(/\\frac\{8\}\{\\frac\{4\}\{.*\}\}/)
  })

  test('downward swipe inside denominator targets the term at the caret', async ({ page }) => {
    const useBoardFlow = Boolean(baseUrl && email && password)

    let editorSurface: Locator
    if (useBoardFlow) {
      await page.goto(toAbsoluteUrl('/auth/signin'), { waitUntil: 'domcontentloaded' })
      await fillSignIn(page)
      await page.goto(toAbsoluteUrl('/board'), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(4_000)
      editorSurface = await ensureBoardCanvasReady(page)
    } else {
      await page.goto(`${localBaseUrl}/keyboard-swipe-lab`, { waitUntil: 'domcontentloaded' })
      editorSurface = page.locator('math-field.keyboard-mathlive-field').first()
      await expect(editorSurface).toBeVisible({ timeout: 30_000 })
    }

    const eightKey = page.locator('button[title="8"]').first()
    const fourKey = page.locator('button[title="4"]').first()
    const sixKey = page.locator('button[title="6"]').first()
    const plusKey = page.locator('button[title="plus"]').first()
    const debugInput = page.getByRole('textbox', { name: /Keyboard latex input/i }).first()

    if (!(await eightKey.isVisible().catch(() => false))) {
      await editorSurface.click({ position: { x: 120, y: 120 } })
    }

    await expect(eightKey).toBeVisible({ timeout: 10_000 })
    await expect(fourKey).toBeVisible({ timeout: 10_000 })
    await expect(sixKey).toBeVisible({ timeout: 10_000 })
    await expect(plusKey).toBeVisible({ timeout: 10_000 })

    await tapKey(page, eightKey)
    await swipeKey(page, eightKey, 0, 70)
    await page.waitForTimeout(200)
    await tapKey(page, fourKey)
    await tapKey(page, plusKey)
    await tapKey(page, sixKey)
    await page.waitForTimeout(250)

    const beforeSecondSwipeState = await readMathfieldState(page)
    const beforeSecondSwipeSlices = await readMathfieldSlices(page)
    const beforeSecondSwipe = (await debugInput.inputValue().catch(() => '')).trim()

    await swipeKey(page, sixKey, 0, 70)
    await page.waitForTimeout(300)

    const afterSecondSwipe = await readMathfieldState(page)
    const finalDebugLatex = (await debugInput.inputValue().catch(() => '')).trim()

    console.log('DENOM_TERM_BEFORE_SECOND_SWIPE', beforeSecondSwipe)
    console.log('DENOM_TERM_BEFORE_SECOND_SWIPE_STATE', JSON.stringify(beforeSecondSwipeState, null, 2))
    console.log('DENOM_TERM_BEFORE_SECOND_SWIPE_SLICES', JSON.stringify(beforeSecondSwipeSlices, null, 2))
    console.log('DENOM_TERM_AFTER_SECOND_SWIPE', JSON.stringify(afterSecondSwipe, null, 2))
    console.log('DENOM_TERM_FINAL_DEBUG_LATEX', finalDebugLatex)

    expect(beforeSecondSwipe).toContain('6')
    expect(finalDebugLatex).not.toContain('84')
    expect(finalDebugLatex).toContain('4+')
    expect(finalDebugLatex).toMatch(/\\frac\{8\}\{4\+\\frac\{6\}\{.*\}\}/)
  })
})