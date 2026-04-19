import { expect, test, type Locator, type Page } from '@playwright/test'

const baseUrl = (process.env.E2E_BASE_URL || '').trim()
const adminEmail = (process.env.E2E_ADMIN_EMAIL || '').trim()
const adminPassword = (process.env.E2E_ADMIN_PASSWORD || '').trim()

const QB_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const

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
  await emailInput.pressSequentially(adminEmail, { delay: 20 })
  await expect(emailInput).toHaveValue(adminEmail)

  await passwordInput.fill('')
  await passwordInput.pressSequentially(adminPassword, { delay: 20 })
  await expect(passwordInput).toHaveValue(adminPassword)

  await page.getByRole('button', { name: /^Sign in$/i }).click()
  await expect(page.getByRole('button', { name: /Sign out/i })).toBeVisible({ timeout: 30_000 })
}

const ensureOnDashboard = async (page: Page) => {
  if (!/\/dashboard|\/board/i.test(page.url())) {
    await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'domcontentloaded' })
  }
  await expect(page.getByRole('button', { name: /Learning Hub/i }).first()).toBeVisible({ timeout: 30_000 })
}

const openQuestionBank = async (page: Page) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await ensureOnDashboard(page)

  const learningHubButton = page.getByRole('button', { name: /Learning Hub/i }).first()
  await expect(learningHubButton).toBeVisible({ timeout: 30_000 })
  await learningHubButton.click()

  const questionBankTab = page.getByRole('button', { name: /^Question Bank$/i }).first()
  await expect(questionBankTab).toBeVisible({ timeout: 30_000 })
  await questionBankTab.click()
}

const getQbControls = (page: Page) => ({
  year: page.getByLabel('Question bank year filter'),
  month: page.getByLabel('Question bank month filter'),
  paper: page.getByLabel('Question bank paper filter'),
  topic: page.getByLabel('Question bank topic filter'),
  level: page.getByLabel('Question bank level filter'),
  number: page.getByLabel('Question bank number filter'),
})

const getQuestionRows = (page: Page) => page.locator('li:has(div.flex.flex-wrap.items-center.gap-2.mb-1 > button)')

const getRowBadgeTexts = async (row: Locator) => {
  const buttons = row.locator('div.flex.flex-wrap.items-center.gap-2.mb-1 > button')
  return (await buttons.allTextContents()).map((text) => text.trim()).filter(Boolean)
}

const isYearText = (value: string) => /^\d{4}$/.test(value)
const isMonthText = (value: string) => QB_MONTHS.includes(value as (typeof QB_MONTHS)[number])
const isPaperText = (value: string) => /^Paper\s+\d+$/i.test(value)
const isLevelText = (value: string) => /^Level\s+\d+$/i.test(value)
const isTopicText = (value: string) => Boolean(value) && !isYearText(value) && !isMonthText(value) && !isPaperText(value) && !isLevelText(value)

const findResultRow = async (page: Page, options?: { requireTopic?: boolean; requireLevel?: boolean }) => {
  const rows = getQuestionRows(page)
  const count = Math.min(await rows.count(), 15)
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index)
    const texts = await getRowBadgeTexts(row)
    if (!texts.some(isYearText) || !texts.some(isMonthText) || !texts.some(isPaperText)) continue
    if (options?.requireTopic && !texts.some(isTopicText)) continue
    if (options?.requireLevel && !texts.some(isLevelText)) continue
    return row
  }
  return null
}

const getBadgeButton = async (row: Locator, badge: 'year' | 'month' | 'paper' | 'topic' | 'level') => {
  const buttons = row.locator('div.flex.flex-wrap.items-center.gap-2.mb-1 > button')
  const texts = await buttons.allTextContents()
  for (let index = 0; index < texts.length; index += 1) {
    const text = texts[index]?.trim() || ''
    if (badge === 'year' && isYearText(text)) return buttons.nth(index)
    if (badge === 'month' && isMonthText(text)) return buttons.nth(index)
    if (badge === 'paper' && isPaperText(text)) return buttons.nth(index)
    if (badge === 'topic' && isTopicText(text)) return buttons.nth(index)
    if (badge === 'level' && isLevelText(text)) return buttons.nth(index)
  }
  return null
}

const openBadgeOverlay = async (page: Page, badgeButton: Locator, badge: 'year' | 'month' | 'paper' | 'topic' | 'level') => {
  const titles = {
    year: 'Year',
    month: 'Month',
    paper: 'Paper',
    topic: 'Topic',
    level: 'Level',
  } as const
  const titleLocator = page.getByText(new RegExp(`^Remix ${titles[badge]}$`)).first()

  await badgeButton.click()
  try {
    await expect(titleLocator).toBeVisible({ timeout: 1_500 })
  } catch {
    await badgeButton.evaluate((element: HTMLElement) => element.click())
    await expect(titleLocator).toBeVisible({ timeout: 10_000 })
  }
}

const chooseAnyForBadge = async (page: Page, badge: 'year' | 'month' | 'paper' | 'topic' | 'level') => {
  const titles = {
    year: 'Year',
    month: 'Month',
    paper: 'Paper',
    topic: 'Topic',
    level: 'Level',
  } as const
  const labels = {
    year: 'Any year',
    month: 'Any month',
    paper: 'Any paper',
    topic: 'Any topic',
    level: 'Any level',
  } as const

  await expect(page.getByText(new RegExp(`^Remix ${titles[badge]}$`)).first()).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: labels[badge], exact: true }).click()
}

test.describe('question bank remix any persistence', () => {
  test.setTimeout(180_000)

  test('clearing multiple remix badges keeps earlier badges unrestricted', async ({ page }) => {
    test.skip(!baseUrl || !adminEmail || !adminPassword, 'Set E2E_BASE_URL, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD')

    await page.goto(toAbsoluteUrl('/auth/signin'), { waitUntil: 'domcontentloaded' })
    await fillSignIn(page)
    await openQuestionBank(page)

    const controls = getQbControls(page)
    await page.getByRole('button', { name: /Search Questions/i }).click()

    await expect(page.getByRole('button', { name: /^Search Questions$/i })).toBeEnabled({ timeout: 60_000 })
    await expect.poll(async () => await getQuestionRows(page).count(), { timeout: 60_000 }).toBeGreaterThan(0)

    const rowWithTopicAndLevel = await findResultRow(page, { requireTopic: true, requireLevel: true })
    const targetRow = rowWithTopicAndLevel || await findResultRow(page, { requireLevel: true }) || await findResultRow(page)
    expect(targetRow, 'Expected at least one question-bank result row to remix').not.toBeNull()

    const yearButton = await getBadgeButton(targetRow!, 'year')
    expect(yearButton, 'Expected a year remix badge').not.toBeNull()
    await openBadgeOverlay(page, yearButton!, 'year')
    await chooseAnyForBadge(page, 'year')
    await expect.poll(async () => await controls.year.inputValue()).toBe('')

    const monthRow = await findResultRow(page)
    expect(monthRow, 'Expected a result row after clearing year').not.toBeNull()
    const monthButton = await getBadgeButton(monthRow!, 'month')
    expect(monthButton, 'Expected a month remix badge').not.toBeNull()
    await openBadgeOverlay(page, monthButton!, 'month')
    await chooseAnyForBadge(page, 'month')
    await expect.poll(async () => await controls.year.inputValue()).toBe('')
    await expect.poll(async () => await controls.month.inputValue()).toBe('')

    const paperRow = await findResultRow(page)
    expect(paperRow, 'Expected a result row after clearing month').not.toBeNull()
    const paperButton = await getBadgeButton(paperRow!, 'paper')
    expect(paperButton, 'Expected a paper remix badge').not.toBeNull()
    await openBadgeOverlay(page, paperButton!, 'paper')
    await chooseAnyForBadge(page, 'paper')
    await expect.poll(async () => await controls.year.inputValue()).toBe('')
    await expect.poll(async () => await controls.month.inputValue()).toBe('')
    await expect.poll(async () => await controls.paper.inputValue()).toBe('')

    const topicRow = await findResultRow(page, { requireTopic: true })
    expect(topicRow, 'Expected a result row with a topic remix badge').not.toBeNull()
    const topicButton = await getBadgeButton(topicRow!, 'topic')
    expect(topicButton, 'Expected a topic remix badge').not.toBeNull()
    await openBadgeOverlay(page, topicButton!, 'topic')
    await chooseAnyForBadge(page, 'topic')
    await expect.poll(async () => await controls.topic.inputValue()).toBe('')
    await expect.poll(async () => await controls.year.inputValue()).toBe('')
    await expect.poll(async () => await controls.month.inputValue()).toBe('')
    await expect.poll(async () => await controls.paper.inputValue()).toBe('')

    const levelRow = await findResultRow(page, { requireLevel: true })
    expect(levelRow, 'Expected a result row with a level remix badge').not.toBeNull()
    const levelButton = await getBadgeButton(levelRow!, 'level')
    expect(levelButton, 'Expected a level remix badge').not.toBeNull()
    await openBadgeOverlay(page, levelButton!, 'level')
    await chooseAnyForBadge(page, 'level')
    await expect.poll(async () => await controls.level.inputValue()).toBe('')
    await expect.poll(async () => await controls.year.inputValue()).toBe('')
    await expect.poll(async () => await controls.month.inputValue()).toBe('')
    await expect.poll(async () => await controls.paper.inputValue()).toBe('')
    await expect.poll(async () => await controls.topic.inputValue()).toBe('')

    await expect(page.getByText(/fully unrestricted across year, month, paper, topic, and level/i)).toBeVisible({ timeout: 30_000 })
  })
})