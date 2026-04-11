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

const tapKeyboardTitleAction = async (page: Page, title: string) => {
  const key = page.locator(`button[title="${title}"]`).first()
  await key.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true })
  await key.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true })
}

const clickBetweenMathfieldTokens = async (page: Page, leftLatex: string, rightLatex: string) => {
  const field = page.locator('math-field.keyboard-mathlive-field').first()
  const point = await field.evaluate((node, tokens) => {
    const [leftLatexInner, rightLatexInner] = tokens
    const entries: Array<{ offset: number; info: { latex?: string; bounds?: DOMRect } | null }> = []
    const maxOffset = Math.min(40, typeof node.lastOffset === 'number' ? node.lastOffset : 40)

    for (let offset = 0; offset <= maxOffset; offset += 1) {
      let info = null
      try {
        info = typeof node.getElementInfo === 'function' ? node.getElementInfo(offset) : null
      } catch {
        info = null
      }
      entries.push({ offset, info })
    }

    const leftEntry = entries.find((entry) => entry.info?.latex === leftLatexInner)
    const rightEntry = entries.find((entry) => entry.offset > (leftEntry?.offset ?? -1) && entry.info?.latex === rightLatexInner)
    const leftBounds = leftEntry?.info?.bounds
    const rightBounds = rightEntry?.info?.bounds

    if (!leftBounds || !rightBounds) return null

    return {
      x: (leftBounds.right + rightBounds.left) / 2,
      y: (leftBounds.top + leftBounds.bottom) / 2,
    }
  }, [leftLatex, rightLatex])

  expect(point).not.toBeNull()
  if (!point) return
  await page.mouse.click(point.x, point.y)
}

const clickMathfieldTokenEdge = async (
  page: Page,
  tokenLatex: string,
  edge: 'before' | 'after' | 'inside',
  occurrence: 'first' | 'last' = 'first',
) => {
  const field = page.locator('math-field.keyboard-mathlive-field').first()
  const point = await field.evaluate((node, payload) => {
    const { tokenLatexInner, edgeInner, occurrenceInner } = payload
    const matches: Array<{ left: number; right: number; top: number; bottom: number }> = []
    const maxOffset = Math.min(160, typeof node.lastOffset === 'number' ? node.lastOffset : 160)

    for (let offset = 0; offset <= maxOffset; offset += 1) {
      let info = null
      try {
        info = typeof node.getElementInfo === 'function' ? node.getElementInfo(offset) : null
      } catch {
        info = null
      }
      if (info?.latex === tokenLatexInner && info?.bounds) {
        matches.push({
          left: info.bounds.left,
          right: info.bounds.right,
          top: info.bounds.top,
          bottom: info.bounds.bottom,
        })
      }
    }

    if (!matches.length) return null
    const bounds = occurrenceInner === 'last' ? matches[matches.length - 1] : matches[0]
    const y = (bounds.top + bounds.bottom) / 2

    if (edgeInner === 'before') return { x: bounds.left - 2, y }
    if (edgeInner === 'after') return { x: bounds.right + 2, y }
    return { x: (bounds.left + bounds.right) / 2, y }
  }, { tokenLatexInner: tokenLatex, edgeInner: edge, occurrenceInner: occurrence })

  expect(point).not.toBeNull()
  if (!point) return
  await page.mouse.click(point.x, point.y)
}

const seedNthRootMidpointCaret = async (page: Page, branch: 'radicand' | 'index') => {
  const field = page.locator('math-field.keyboard-mathlive-field').first()

  await insertNthRoot(page)
  if (branch === 'index') {
    await field.evaluate((node) => node.executeCommand('moveToPreviousPlaceholder'))
  }

  await tapKeyboardAction(page, 'digit-1')
  await tapKeyboardAction(page, 'digit-2')
  await tapKeyboardAction(page, 'digit-3')
  await clickBetweenMathfieldTokens(page, '1', '2')

  return field
}

const seedFilledNthRootBranches = async (page: Page) => {
  const field = page.locator('math-field.keyboard-mathlive-field').first()

  await insertNthRoot(page)
  await tapKeyboardAction(page, 'digit-5')
  await tapKeyboardAction(page, 'digit-6')
  await field.evaluate((node) => node.executeCommand('moveToPreviousPlaceholder'))
  await tapKeyboardAction(page, 'digit-3')
  await tapKeyboardAction(page, 'digit-4')
  await tapKeyboardAction(page, 'digit-5')

  await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[345]{56}')
  return field
}

const plainNthRootMidInsertCases: Array<{
  actionId: 'plus' | 'minus' | 'times' | 'divide'
  branch: 'radicand' | 'index'
  expectedLatex: string
  expectedPlainLatex: string
}> = [
  {
    actionId: 'plus',
    branch: 'radicand',
    expectedLatex: '\\sqrt[\\placeholder[kbd-rad-i-1]{}]{1 + 923}',
    expectedPlainLatex: '\\sqrt[]{1+923}',
  },
  {
    actionId: 'minus',
    branch: 'radicand',
    expectedLatex: '\\sqrt[\\placeholder[kbd-rad-i-1]{}]{1 - 923}',
    expectedPlainLatex: '\\sqrt[]{1-923}',
  },
  {
    actionId: 'times',
    branch: 'radicand',
    expectedLatex: '\\sqrt[\\placeholder[kbd-rad-i-1]{}]{1 \\times 923}',
    expectedPlainLatex: '\\sqrt[]{1\\times923}',
  },
  {
    actionId: 'divide',
    branch: 'radicand',
    expectedLatex: '\\sqrt[\\placeholder[kbd-rad-i-1]{}]{1 \\div 923}',
    expectedPlainLatex: '\\sqrt[]{1\\div923}',
  },
  {
    actionId: 'plus',
    branch: 'index',
    expectedLatex: '\\sqrt[1 + 923]{\\placeholder[kbd-rad-r-1]{}}',
    expectedPlainLatex: '\\sqrt[1+923]{}',
  },
  {
    actionId: 'minus',
    branch: 'index',
    expectedLatex: '\\sqrt[1 - 923]{\\placeholder[kbd-rad-r-1]{}}',
    expectedPlainLatex: '\\sqrt[1-923]{}',
  },
  {
    actionId: 'times',
    branch: 'index',
    expectedLatex: '\\sqrt[1 \\times 923]{\\placeholder[kbd-rad-r-1]{}}',
    expectedPlainLatex: '\\sqrt[1\\times923]{}',
  },
  {
    actionId: 'divide',
    branch: 'index',
    expectedLatex: '\\sqrt[1 \\div 923]{\\placeholder[kbd-rad-r-1]{}}',
    expectedPlainLatex: '\\sqrt[1\\div923]{}',
  },
]

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

  test('nth root button input respects an explicit move into the index box', async ({ page }) => {
    await goToKeyboardSwipeLab(page)

    const field = page.locator('math-field.keyboard-mathlive-field').first()

    await insertNthRoot(page)
    await field.evaluate((node) => node.executeCommand('moveToPreviousPlaceholder'))
    await tapKeyboardAction(page, 'digit-3')
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[3]{\\placeholder[kbd-rad-r-1]{}}')

    await field.evaluate((node) => node.executeCommand(['insert', '4']))
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[34]{\\placeholder[kbd-rad-r-1]{}}')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt[34]{}')
  })

  test('nth root button input inserts at the tapped caret position inside a multi-digit radicand', async ({ page }) => {
    await goToKeyboardSwipeLab(page)

    await insertNthRoot(page)
    await tapKeyboardAction(page, 'digit-1')
    await tapKeyboardAction(page, 'digit-2')
    await tapKeyboardAction(page, 'digit-3')
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[\\placeholder[kbd-rad-i-1]{}]{123}')

    await clickBetweenMathfieldTokens(page, '1', '2')
    await tapKeyboardAction(page, 'digit-9')

    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[\\placeholder[kbd-rad-i-1]{}]{1923}')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt[]{1923}')
  })

  test('nth root idle collapse preserves a tapped mid-radicand caret position', async ({ page }) => {
    await goToKeyboardSwipeLab(page)

    await insertNthRoot(page)
    await tapKeyboardAction(page, 'digit-1')
    await tapKeyboardAction(page, 'digit-2')
    await tapKeyboardAction(page, 'digit-3')
    await tapKeyboardAction(page, 'digit-4')
    await tapKeyboardAction(page, 'digit-5')
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[\\placeholder[kbd-rad-i-1]{}]{12345}')

    await clickBetweenMathfieldTokens(page, '2', '3')
    await page.waitForTimeout(2500)

    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt{12345}')
    await tapKeyboardAction(page, 'digit-9')

    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt{129345}')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt{129345}')
  })

  test('nth root button input inserts at the tapped caret position inside a multi-digit index', async ({ page }) => {
    await goToKeyboardSwipeLab(page)

    const field = page.locator('math-field.keyboard-mathlive-field').first()

    await insertNthRoot(page)
    await field.evaluate((node) => node.executeCommand('moveToPreviousPlaceholder'))
    await tapKeyboardAction(page, 'digit-1')
    await tapKeyboardAction(page, 'digit-2')
    await tapKeyboardAction(page, 'digit-3')
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[123]{\\placeholder[kbd-rad-r-1]{}}')

    await clickBetweenMathfieldTokens(page, '1', '2')
    await tapKeyboardAction(page, 'digit-9')

    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[1923]{\\placeholder[kbd-rad-r-1]{}}')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt[1923]{}')
  })

  test('nth root switches from the index to the radicand when the caret is tapped just before the radicand value', async ({ page }) => {
    await goToKeyboardSwipeLab(page)

    await seedFilledNthRootBranches(page)
    await clickMathfieldTokenEdge(page, '5', 'before', 'last')
    await tapKeyboardAction(page, 'digit-2')

    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[345]{256}')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt[345]{256}')
  })

  test('nth root switches from the radicand to the index when the caret is tapped just after the index value', async ({ page }) => {
    await goToKeyboardSwipeLab(page)

    await seedFilledNthRootBranches(page)
    await clickMathfieldTokenEdge(page, '6', 'inside')
    await clickMathfieldTokenEdge(page, '5', 'after', 'first')
    await tapKeyboardAction(page, 'digit-2')

    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[3452]{56}')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt[3452]{56}')
  })

  for (const { actionId, branch, expectedLatex, expectedPlainLatex } of plainNthRootMidInsertCases) {
    test(`nth root keeps ${actionId} insertion at the tapped midpoint in the ${branch}`, async ({ page }) => {
      await goToKeyboardSwipeLab(page)

      await seedNthRootMidpointCaret(page, branch)
      await tapKeyboardAction(page, actionId)
      await tapKeyboardAction(page, 'digit-9')

      await expect.poll(() => getMathfieldLatex(page)).toBe(expectedLatex)
      await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe(expectedPlainLatex)
    })
  }

  test('nth root keeps fraction insertion targeted inside the tapped radicand midpoint', async ({ page }) => {
    await goToKeyboardSwipeLab(page)

    await seedNthRootMidpointCaret(page, 'radicand')
    await tapKeyboardTitleAction(page, 'fraction')
    await tapKeyboardAction(page, 'digit-9')

    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[\\placeholder[kbd-rad-i-1]{}]{1\\frac{9}{\\placeholder{}}23}')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt[]{1\\frac{9}{}23}')
  })

  test('nth root keeps fraction insertion targeted inside the tapped index midpoint', async ({ page }) => {
    await goToKeyboardSwipeLab(page)

    await seedNthRootMidpointCaret(page, 'index')
    await tapKeyboardTitleAction(page, 'fraction')
    await tapKeyboardAction(page, 'digit-9')

    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[1\\frac{9}{\\placeholder{}}23]{\\placeholder[kbd-rad-r-1]{}}')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt[1\\frac{9}{}23]{}')
  })

  test('nth root keeps nested nth-root insertion targeted inside the tapped radicand midpoint', async ({ page }) => {
    await goToKeyboardSwipeLab(page)

    await seedNthRootMidpointCaret(page, 'radicand')
    await tapKeyboardTitleAction(page, 'nth root')
    await tapKeyboardAction(page, 'digit-9')

    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[\\placeholder[kbd-rad-i-1]{}]{1\\sqrt[\\placeholder[kbd-rad-i-2]{}]{\\placeholder[kbd-rad-r-2]{9}}23}')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt[]{1\\sqrt[]{9}23}')
  })

  test('nth root keeps nested nth-root insertion targeted inside the tapped index midpoint', async ({ page }) => {
    await goToKeyboardSwipeLab(page)

    await seedNthRootMidpointCaret(page, 'index')
    await tapKeyboardTitleAction(page, 'nth root')
    await tapKeyboardAction(page, 'digit-9')

    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[1\\sqrt[\\placeholder[kbd-rad-i-2]{}]{\\placeholder[kbd-rad-r-2]{9}}23]{\\placeholder[kbd-rad-r-1]{}}')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt[1\\sqrt[]{9}23]{}')
  })

  test('nth root keeps the filled index targeted when the user taps its area', async ({ page }) => {
    await goToKeyboardSwipeLab(page)

    const field = page.locator('math-field.keyboard-mathlive-field').first()

    await insertNthRoot(page)
    await field.evaluate((node) => node.executeCommand('moveToPreviousPlaceholder'))
    await tapKeyboardAction(page, 'digit-3')
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[3]{\\placeholder[kbd-rad-r-1]{}}')

    const box = await field.boundingBox()
    expect(box).not.toBeNull()
    if (!box) return

    await page.mouse.click(box.x + 24, box.y + 18)

    await field.evaluate((node) => node.executeCommand(['insert', '4']))
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[34]{\\placeholder[kbd-rad-r-1]{}}')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt[34]{}')
  })

  test('nth root lets the user re-show the hidden index by tapping its area', async ({ page }) => {
    await goToKeyboardSwipeLab(page)

    const field = page.locator('math-field.keyboard-mathlive-field').first()

    await insertNthRoot(page)
    await tapKeyboardAction(page, 'digit-7')
    await page.waitForTimeout(2500)
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt{7}')

    const box = await field.boundingBox()
    expect(box).not.toBeNull()
    if (!box) return

    await page.mouse.click(box.x + 18, box.y + 16)
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[\\placeholder[kbd-rad-i-1]{}]{7}')

    await tapKeyboardAction(page, 'digit-3')
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[3]{7}')
    await expect.poll(() => getMathfieldLatex(page, 'latex-without-placeholders')).toBe('\\sqrt[3]{7}')
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