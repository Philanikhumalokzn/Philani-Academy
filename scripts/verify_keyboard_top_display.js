const { chromium } = require('@playwright/test')

const baseUrl = (process.env.E2E_BASE_URL || '').trim()
const email = (process.env.E2E_USER_A_EMAIL || '').trim()
const password = (process.env.E2E_USER_A_PASSWORD || '').trim()

if (!baseUrl || !email || !password) {
  console.error('Missing E2E_BASE_URL / E2E_USER_A_EMAIL / E2E_USER_A_PASSWORD')
  process.exit(1)
}

const toAbsoluteUrl = (value) => {
  if (/^https?:\/\//i.test(value)) return value
  const normalizedBase = baseUrl.replace(/\/$/, '')
  const normalizedPath = value.startsWith('/') ? value : `/${value}`
  return `${normalizedBase}${normalizedPath}`
}

async function fillSignIn(page) {
  const emailInput = page.locator('#email')
  const passwordInput = page.locator('#password')
  await emailInput.waitFor({ state: 'visible', timeout: 20000 })
  await passwordInput.waitFor({ state: 'visible', timeout: 20000 })
  await emailInput.fill('')
  await emailInput.pressSequentially(email, { delay: 20 })
  await passwordInput.fill('')
  await passwordInput.pressSequentially(password, { delay: 20 })
  await page.getByRole('button', { name: /^sign in$/i }).click()
  await page.waitForURL(/\/dashboard|\/board/i, { timeout: 30000 })
}

async function ensureBoardCanvasReady(page) {
  const editorSurface = page.locator('.ms-editor').last()
  const keyboardField = page.locator('math-field.keyboard-mathlive-field').first()

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await editorSurface.isVisible().catch(() => false)) return
    if (await keyboardField.isVisible().catch(() => false)) return

    const gradePrompt = page.getByText(/Choose a grade to open the shared board\./i)
    if (await gradePrompt.isVisible().catch(() => false)) {
      const gradeSelect = page.getByRole('combobox', { name: /choose grade/i })
      if (await gradeSelect.isVisible().catch(() => false)) {
        await gradeSelect.selectOption({ index: 1 })
        await page.waitForTimeout(1200)
      }
    }

    const enterClassButtons = page.getByRole('button', { name: /enter class/i })
    const count = await enterClassButtons.count()
    for (let i = 0; i < count; i += 1) {
      const candidate = enterClassButtons.nth(i)
      if (!(await candidate.isVisible().catch(() => false))) continue
      await candidate.click({ force: true }).catch(() => {})
      await page.waitForTimeout(3500)
      if (await editorSurface.isVisible().catch(() => false)) return
      if (await keyboardField.isVisible().catch(() => false)) return
    }
  }

  throw new Error('Board canvas did not become ready')
}

async function clickBottomRightEnterKey(page) {
  const candidates = page.locator('button[data-enter-step-key="true"]')
  const count = await candidates.count()
  let bestIndex = -1
  let bestScore = -1

  for (let i = 0; i < count; i += 1) {
    const button = candidates.nth(i)
    if (!(await button.isVisible().catch(() => false))) continue
    const box = await button.boundingBox().catch(() => null)
    if (!box) continue
    const score = (box.y * 10000) + box.x
    if (score > bestScore) {
      bestScore = score
      bestIndex = i
    }
  }

  if (bestIndex < 0) throw new Error('No visible enter key found')
  const target = candidates.nth(bestIndex)
  await target.click({ force: true })
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  try {
    await page.goto(toAbsoluteUrl('/auth/signin'), { waitUntil: 'domcontentloaded' })
    await fillSignIn(page)
    if (!/\/dashboard/i.test(page.url())) {
      await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'domcontentloaded' })
    }

    await ensureBoardCanvasReady(page)

    const textButton = page.getByRole('button', { name: /^Text$/i }).first()
    await textButton.waitFor({ state: 'visible', timeout: 30000 })
    await textButton.click()
    await page.waitForTimeout(500)
    await textButton.click()
    await page.waitForTimeout(500)

    const xKey = page.locator('button[title="x"]').first()
    const yKey = page.locator('button[title="y"]').first()
    const plusKey = page.locator('button[title="plus"]').first()
    await xKey.waitFor({ state: 'visible', timeout: 10000 })
    await yKey.waitFor({ state: 'visible', timeout: 10000 })
    await plusKey.waitFor({ state: 'visible', timeout: 10000 })

    await xKey.click()
    await plusKey.click()
    await xKey.click()
    await page.waitForTimeout(500)
    await clickBottomRightEnterKey(page)
    await page.waitForTimeout(1200)

    await yKey.click()
    await plusKey.click()
    await yKey.click()
    await page.waitForTimeout(500)
    await clickBottomRightEnterKey(page)
    await page.waitForTimeout(1200)

    const topDisplay = page.locator('[data-top-panel-katex-display="true"]').first()
    await topDisplay.waitFor({ state: 'visible', timeout: 10000 })

    const topText = await topDisplay.innerText().catch(() => '')
    const screenshotPath = 'test-results/keyboard-top-display-after-second-enter.png'
    await topDisplay.screenshot({ path: screenshotPath })

    console.log('TOP_DISPLAY_TEXT_START')
    console.log(topText)
    console.log('TOP_DISPLAY_TEXT_END')
    console.log(`SCREENSHOT:${screenshotPath}`)
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
