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

const getMathfieldRawPrefixLatex = async (page: Page) => {
  const field = page.locator('math-field.keyboard-mathlive-field').first()
  return field.evaluate((node) => {
    const position = typeof node.position === 'number' ? node.position : 0
    try {
      return node.getValue?.(0, Math.max(0, position), 'latex') || ''
    } catch {
      return ''
    }
  })
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

const getMathfieldTokenEdgePoint = async (
  page: Page,
  tokenLatex: string,
  edge: 'before' | 'after' | 'inside',
  occurrence: 'first' | 'last' = 'first',
) => {
  const field = page.locator('math-field.keyboard-mathlive-field').first()
  const point = await field.evaluate((node, payload) => {
    const { tokenLatexInner, edgeInner, occurrenceInner } = payload
    const matches: Array<{ left: number; right: number; top: number; bottom: number }> = []
    const maxOffset = Math.min(200, typeof node.lastOffset === 'number' ? node.lastOffset : 200)

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
  if (!point) {
    throw new Error(`Expected to resolve a point for token ${tokenLatex}`)
  }
  return point
}

const resetMathfieldViewportToStart = async (page: Page) => {
  const field = page.locator('math-field.keyboard-mathlive-field').first()
  await field.evaluate((node) => {
    node.executeCommand?.('moveToMathfieldStart')

    let current = node.parentElement as HTMLElement | null
    while (current) {
      if (current.scrollWidth > current.clientWidth + 1 || current.scrollHeight > current.clientHeight + 1) {
        current.scrollLeft = 0
        current.scrollTop = 0
        break
      }
      current = current.parentElement
    }
  })
}

const getMathfieldViewportBox = async (page: Page) => {
  const field = page.locator('math-field.keyboard-mathlive-field').first()
  const box = await field.evaluate((node) => {
    let current = node.parentElement as HTMLElement | null
    while (current) {
      if (current.scrollWidth > current.clientWidth + 1 || current.scrollHeight > current.clientHeight + 1) {
        const rect = current.getBoundingClientRect()
        return {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          scrollWidth: current.scrollWidth,
          clientWidth: current.clientWidth,
        }
      }
      current = current.parentElement
    }

    const rect = node.getBoundingClientRect()
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      scrollWidth: rect.width,
      clientWidth: rect.width,
    }
  })

  expect(box.width).toBeGreaterThan(0)
  return box
}

const readMathfieldSelectionState = async (page: Page) => {
  const field = page.locator('math-field.keyboard-mathlive-field').first()
  await expect(field).toBeVisible({ timeout: 20_000 })
  return field.evaluate((node) => {
    const mathfield = node as HTMLElement & {
      value?: string
      selection?: { ranges?: [number, number][]; direction?: 'forward' | 'backward' | 'none' }
      selectionIsCollapsed?: boolean
      getValue?: (selection?: { ranges: [number, number][]; direction?: 'forward' | 'backward' | 'none' }, format?: 'latex') => string
    }
    const selection = mathfield.selection?.ranges || []
    const selectionDescriptor = {
      ranges: selection,
      direction: mathfield.selection?.direction || 'none',
    }
    return {
      value: String(mathfield.value || ''),
      selection,
      selectionIsCollapsed: Boolean(mathfield.selectionIsCollapsed),
      selectedLatex: selection.length ? (mathfield.getValue?.(selectionDescriptor, 'latex') || '') : '',
    }
  })
}

const touchDragAcrossMathfield = async (
  page: Page,
  startPoint: { x: number; y: number },
  endPoint: { x: number; y: number },
  options?: { holdBeforeDragMs?: number; holdAfterDragMs?: number; moveSteps?: number },
) => {
  const holdBeforeDragMs = options?.holdBeforeDragMs ?? 0
  const holdAfterDragMs = options?.holdAfterDragMs ?? 100
  const moveSteps = options?.moveSteps ?? 12
  const client = await page.context().newCDPSession(page)

  const sendTouch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', point?: { x: number; y: number }) => {
    await client.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: point ? [{
        x: point.x,
        y: point.y,
        id: 1,
        radiusX: 4,
        radiusY: 4,
        force: 1,
      }] : [],
    })
  }

  await sendTouch('touchStart', startPoint)
  if (holdBeforeDragMs > 0) {
    await page.waitForTimeout(holdBeforeDragMs)
  }

  for (let index = 1; index <= moveSteps; index += 1) {
    const progress = index / moveSteps
    await sendTouch('touchMove', {
      x: startPoint.x + ((endPoint.x - startPoint.x) * progress),
      y: startPoint.y + ((endPoint.y - startPoint.y) * progress),
    })
    await page.waitForTimeout(28)
  }

  await sendTouch('touchEnd')
  if (holdAfterDragMs > 0) {
    await page.waitForTimeout(holdAfterDragMs)
  }
}

const dispatchSyntheticPinchOnMathfield = async (
  page: Page,
  options?: { moveSteps?: number; stepDistancePx?: number },
) => {
  const field = page.locator('math-field.keyboard-mathlive-field').first()
  return field.evaluate((node, config) => {
    let viewport = node.parentElement as HTMLElement | null
    while (viewport) {
      if (String(viewport.className || '').includes('overflow-auto')) break
      viewport = viewport.parentElement
    }
    if (!viewport) {
      throw new Error('Expected to find the keyboard mathfield viewport')
    }

    const zoomSurface = viewport.firstElementChild
    if (!(zoomSurface instanceof HTMLElement)) {
      throw new Error('Expected to find the keyboard mathfield zoom surface')
    }

    const rect = viewport.getBoundingClientRect()
    const centerX = rect.left + (rect.width / 2)
    const centerY = rect.top + 24
    const moveSteps = config?.moveSteps ?? 3
    const stepDistancePx = config?.stepDistancePx ?? 20

    const makeTouch = (identifier: number, x: number, y: number) => new Touch({
      identifier,
      target: viewport,
      clientX: x,
      clientY: y,
      pageX: x,
      pageY: y,
      screenX: x,
      screenY: y,
      radiusX: 5,
      radiusY: 5,
      rotationAngle: 0,
      force: 1,
    })

    const fire = (type: string, touches: Touch[], changedTouches: Touch[]) => {
      const event = new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches,
        targetTouches: touches,
        changedTouches,
      })
      viewport.dispatchEvent(event)
    }

    const beforeZoom = Number(zoomSurface.style.zoom || '1')
    const start1 = makeTouch(1, centerX - 50, centerY)
    const start2 = makeTouch(2, centerX + 50, centerY)

    fire('touchstart', [start1], [start1])
    fire('touchstart', [start1, start2], [start2])

    for (let step = 1; step <= moveSteps; step += 1) {
      const touch1 = makeTouch(1, (centerX - 50) - (step * stepDistancePx), centerY)
      const touch2 = makeTouch(2, (centerX + 50) + (step * stepDistancePx), centerY)
      fire('touchmove', [touch1, touch2], [touch1, touch2])
    }

    const end1 = makeTouch(1, (centerX - 50) - (moveSteps * stepDistancePx), centerY)
    const end2 = makeTouch(2, (centerX + 50) + (moveSteps * stepDistancePx), centerY)
    fire('touchend', [], [end1, end2])

    return {
      beforeZoom,
      afterZoom: Number(zoomSurface.style.zoom || '1'),
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    }
  }, { moveSteps: options?.moveSteps, stepDistancePx: options?.stepDistancePx })
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

const seedLongNthRootBranch = async (page: Page, branch: 'radicand' | 'index') => {
  const field = page.locator('math-field.keyboard-mathlive-field').first()

  await insertNthRoot(page)
  if (branch === 'index') {
    await field.evaluate((node) => node.executeCommand('moveToPreviousPlaceholder'))
  }

  for (const digit of ['1', '2', '3', '4', '5', '6', '7']) {
    await tapKeyboardAction(page, `digit-${digit}`)
  }
  await clickBetweenMathfieldTokens(page, '4', '5')

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
    expectedLatex: '\\sqrt[\\placeholder[kbd-rad-i-1]{}]{1+923}',
    expectedPlainLatex: '\\sqrt[]{1+923}',
  },
  {
    actionId: 'minus',
    branch: 'radicand',
    expectedLatex: '\\sqrt[\\placeholder[kbd-rad-i-1]{}]{1-923}',
    expectedPlainLatex: '\\sqrt[]{1-923}',
  },
  {
    actionId: 'times',
    branch: 'radicand',
    expectedLatex: '\\sqrt[\\placeholder[kbd-rad-i-1]{}]{1\\times923}',
    expectedPlainLatex: '\\sqrt[]{1\\times923}',
  },
  {
    actionId: 'divide',
    branch: 'radicand',
    expectedLatex: '\\sqrt[\\placeholder[kbd-rad-i-1]{}]{1\\div923}',
    expectedPlainLatex: '\\sqrt[]{1\\div923}',
  },
  {
    actionId: 'plus',
    branch: 'index',
    expectedLatex: '\\sqrt[1+923]{\\placeholder[kbd-rad-r-1]{}}',
    expectedPlainLatex: '\\sqrt[1+923]{}',
  },
  {
    actionId: 'minus',
    branch: 'index',
    expectedLatex: '\\sqrt[1-923]{\\placeholder[kbd-rad-r-1]{}}',
    expectedPlainLatex: '\\sqrt[1-923]{}',
  },
  {
    actionId: 'times',
    branch: 'index',
    expectedLatex: '\\sqrt[1\\times923]{\\placeholder[kbd-rad-r-1]{}}',
    expectedPlainLatex: '\\sqrt[1\\times923]{}',
  },
  {
    actionId: 'divide',
    branch: 'index',
    expectedLatex: '\\sqrt[1\\div923]{\\placeholder[kbd-rad-r-1]{}}',
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

  test('nth root preserves the visual caret through empty-index collapse, radicand insert, and backspace', async ({ page }) => {
    await goToKeyboardSwipeLab(page)

    await insertNthRoot(page)
    await tapKeyboardAction(page, 'digit-1')
    await tapKeyboardAction(page, 'digit-2')
    await tapKeyboardAction(page, 'digit-3')
    await tapKeyboardAction(page, 'digit-4')
    await tapKeyboardAction(page, 'digit-5')

    await page.waitForTimeout(2500)
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt{12345}')
    await expect.poll(() => getMathfieldRawPrefixLatex(page)).toBe('12345')

    await clickBetweenMathfieldTokens(page, '1', '2')
    await expect.poll(() => getMathfieldRawPrefixLatex(page)).toBe('1')

    await tapKeyboardAction(page, 'digit-9')
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[\\placeholder[kbd-rad-i-1]{}]{192345}')
    await expect.poll(() => getMathfieldRawPrefixLatex(page)).toBe('19')

    await page.waitForTimeout(2500)
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt{192345}')
    await expect.poll(() => getMathfieldRawPrefixLatex(page)).toBe('19')

    await tapKeyboardAction(page, 'backspace')
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[\\placeholder[kbd-rad-i-1]{}]{12345}')
    await expect.poll(() => getMathfieldRawPrefixLatex(page)).toBe('1')

    await page.waitForTimeout(2500)
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt{12345}')
    await expect.poll(() => getMathfieldRawPrefixLatex(page)).toBe('1')
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

  test('nth root keeps the visual caret immediately after plus in a long radicand', async ({ page }) => {
    await goToKeyboardSwipeLab(page)

    await seedLongNthRootBranch(page, 'radicand')
    await tapKeyboardAction(page, 'plus')

    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[\\placeholder[kbd-rad-i-1]{}]{1234+567}')
    await expect.poll(() => getMathfieldRawPrefixLatex(page)).toBe('1234+')

    await tapKeyboardAction(page, 'digit-9')
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[\\placeholder[kbd-rad-i-1]{}]{1234+9567}')
  })

  test('nth root keeps the visual caret immediately after plus in a long index', async ({ page }) => {
    await goToKeyboardSwipeLab(page)

    await seedLongNthRootBranch(page, 'index')
    await tapKeyboardAction(page, 'plus')

    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[1234+567]{\\placeholder[kbd-rad-r-1]{}}')
    await expect.poll(() => getMathfieldRawPrefixLatex(page)).toBe('1234+')

    await tapKeyboardAction(page, 'digit-9')
    await expect.poll(() => getMathfieldLatex(page)).toBe('\\sqrt[1234+9567]{\\placeholder[kbd-rad-r-1]{}}')
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

  test.describe('touch selection', () => {
    test.use({ hasTouch: true, viewport: { width: 500, height: 900 } })

    test('native swipe selection spans multiple visible tokens in an overflowed expression', async ({ page }) => {
      await goToKeyboardSwipeLab(page)

      const expression = '123456789+123456789+123456789+123456789'
      for (const symbol of expression) {
        if (symbol === '+') {
          await tapKeyboardAction(page, 'plus')
          continue
        }
        await tapKeyboardAction(page, `digit-${symbol}`)
      }

      await expect.poll(() => getMathfieldLatex(page)).toBe(expression)
      await resetMathfieldViewportToStart(page)

      const viewportBox = await getMathfieldViewportBox(page)
      expect(viewportBox.scrollWidth).toBeGreaterThan(viewportBox.clientWidth + 8)

      const startPoint = await getMathfieldTokenEdgePoint(page, '1', 'inside', 'first')
      const endPoint = {
        x: viewportBox.x + viewportBox.width - 12,
        y: startPoint.y,
      }

      await touchDragAcrossMathfield(page, startPoint, endPoint)

      const selectionState = await readMathfieldSelectionState(page)
      expect(selectionState.selectionIsCollapsed).toBe(false)
      expect(selectionState.selection.length).toBeGreaterThan(0)
      const [selectionStart, selectionEnd] = selectionState.selection[0]
      expect(selectionEnd - selectionStart).toBeGreaterThan(18)
      expect(selectionState.selectedLatex).toContain('+')
    })

    test('synthetic pinch zoom updates the live overflowed viewport', async ({ page }) => {
      await goToKeyboardSwipeLab(page)

      const expression = '123456789+123456789+123456789+123456789'
      for (const symbol of expression) {
        if (symbol === '+') {
          await tapKeyboardAction(page, 'plus')
          continue
        }
        await tapKeyboardAction(page, `digit-${symbol}`)
      }

      await expect.poll(() => getMathfieldLatex(page)).toBe(expression)
      await resetMathfieldViewportToStart(page)

      const viewportBox = await getMathfieldViewportBox(page)
      expect(viewportBox.scrollWidth).toBeGreaterThan(viewportBox.clientWidth + 8)

      const pinchState = await dispatchSyntheticPinchOnMathfield(page)
      expect(pinchState.beforeZoom).toBe(1)
      expect(pinchState.afterZoom).toBeGreaterThan(1.2)
      expect(pinchState.scrollLeft).toBeGreaterThan(0)
    })
  })
})