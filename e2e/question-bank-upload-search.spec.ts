import fs from 'node:fs'
import { expect, test } from '@playwright/test'

const baseUrl = (process.env.E2E_BASE_URL || '').trim()
const adminEmail = (process.env.E2E_ADMIN_EMAIL || '').trim()
const adminPassword = (process.env.E2E_ADMIN_PASSWORD || '').trim()
const pdfPath = (process.env.E2E_QUESTION_BANK_PDF || 'C:\\Users\\mandl\\Desktop\\Khumalo\\Mathematics P1 Nov 2024 Eng.pdf').trim()

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

  await emailInput.fill(adminEmail)
  await passwordInput.fill(adminPassword)
  await page.getByRole('button', { name: /^Sign in$/i }).click()

  await page.waitForTimeout(10_000)
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 })

  let redirected = false
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await expect(page).toHaveURL(/\/dashboard|\/board/i, { timeout: 6_000 })
      redirected = true
      break
    } catch {
      const errText = await page.locator('.bg-red-100').first().textContent().catch(() => null)
      if (errText && errText.trim()) {
        throw new Error(`Sign-in failed: ${errText.trim()}`)
      }
      await page.waitForTimeout(1500)
    }
  }

  if (!redirected) {
    throw new Error(`Sign-in did not redirect. Final URL: ${page.url()}`)
  }
}

test.describe('question bank upload extract and search', () => {
  test.setTimeout(900_000)

  test('admin uploads PDF, extracts questions, and can search them', async ({ page }) => {
    test.skip(!baseUrl || !adminEmail || !adminPassword, 'Set E2E_BASE_URL, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD')
    test.skip(!pdfPath || !fs.existsSync(pdfPath), `Test PDF not found at: ${pdfPath}`)

    const uniqueTag = `qb-e2e-${Date.now()}`
    const uniqueTitle = `QB E2E ${uniqueTag}`

    await page.goto(toAbsoluteUrl('/auth/signin'), { waitUntil: 'domcontentloaded' })
    await fillSignIn(page)

    await page.goto(toAbsoluteUrl('/resource-bank'), { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /Resource Bank/i })).toBeVisible({ timeout: 30_000 })

    const workspaceCard = page.locator('div.card').filter({ hasText: 'Your workspace' }).first()

    const titleInput = workspaceCard.locator('input[placeholder*="Algebra worksheet"]').first()
    await titleInput.fill(uniqueTitle)

    const tagInput = workspaceCard.locator('input[placeholder*="Past paper"]').first()
    await tagInput.fill(uniqueTag)

    const parseCheckbox = workspaceCard.locator('label:has-text("Parse (Mathpix OCR)") input[type="checkbox"]').first()
    await parseCheckbox.check({ force: true })

    const fileInput = workspaceCard.locator('input[type="file"]').first()
    await fileInput.setInputFiles(pdfPath)
    const attachedCount = await fileInput.evaluate((el) => {
      const input = el as HTMLInputElement
      return input.files?.length || 0
    })
    expect(attachedCount).toBeGreaterThan(0)

    const uploadButton = page.getByRole('button', { name: /^Upload$/i }).first()

    if (await uploadButton.isDisabled()) {
      const gradeSelect = page.locator('select.input').first()
      if (await gradeSelect.count()) {
        await gradeSelect.selectOption({ index: 1 })
      }
    }

    await uploadButton.click()

    const resourceRow = page.locator('li', {
      has: page.locator('div', { hasText: uniqueTitle }),
    }).first()

    await expect(resourceRow).toBeVisible({ timeout: 240_000 })

    const extractButton = resourceRow.getByRole('button', { name: /Extract Questions/i })
    await expect(extractButton).toBeVisible({ timeout: 120_000 })
    await extractButton.click()

    const yearInput = page.locator('input[type="number"]').first()
    await yearInput.fill('2024')

    const monthSelect = page.locator('select').filter({ has: page.locator('option[value="November"]') }).first()
    await monthSelect.selectOption('November')

    const paperSelect = page.locator('select').filter({ has: page.locator('option[value="3"]') }).first()
    await paperSelect.selectOption('1')

    const extractNowButton = page.getByRole('button', { name: /^Extract$/i }).first()
    await extractNowButton.click()

    const extractResult = page.locator('div', { hasText: /^✓ Extracted\s+\d+\s+question/i }).first()
    await expect(extractResult).toBeVisible({ timeout: 360_000 })

    const extractText = (await extractResult.textContent()) || ''
    const createdMatch = extractText.match(/Extracted\s+(\d+)\s+question/i)
    const createdCount = createdMatch ? Number(createdMatch[1]) : 0
    expect(createdCount).toBeGreaterThan(0)

    const apiResponse = await page.request.get(toAbsoluteUrl('/api/exam-questions?year=2024&month=November&paper=1&take=10'))
    expect(apiResponse.ok()).toBe(true)
    const apiData = (await apiResponse.json()) as {
      items?: Array<{ id: string; questionNumber?: string; sourceId?: string; year?: number; month?: string; paper?: number }>
    }

    const items = Array.isArray(apiData?.items) ? apiData.items : []
    expect(items.length).toBeGreaterThan(0)

    const picked = items.find((item) => String(item?.sourceId || '').length > 0) || items[0]
    const targetQuestionNumber = String(picked?.questionNumber || '').trim()
    expect(targetQuestionNumber.length).toBeGreaterThan(0)

    await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'domcontentloaded' })

    const learningButton = page.getByRole('button', { name: /^Learning$/i }).first()
    if (await learningButton.isVisible().catch(() => false)) {
      await learningButton.click()
    }

    const questionBankTab = page.getByRole('button', { name: /^Question Bank$/i }).first()
    await expect(questionBankTab).toBeVisible({ timeout: 30_000 })
    await questionBankTab.click()

    const yearFilter = page.locator('input[type="number"][placeholder*="2024"]').first()
    await yearFilter.fill('2024')

    const monthFilter = page.locator('section').filter({ hasText: 'Question Bank' }).locator('select').first()
    await monthFilter.selectOption('November')

    const paperFilter = page.locator('section').filter({ hasText: 'Question Bank' }).locator('select').nth(1)
    await paperFilter.selectOption('1')

    const qNumberInput = page.locator('input[placeholder*="1.1.5"]').first()
    await qNumberInput.fill(targetQuestionNumber)

    await page.getByRole('button', { name: /Search Questions/i }).click()

    await expect(page.getByText(new RegExp(`Q${targetQuestionNumber.replace('.', '\\.')}`)).first()).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText(/result/i).first()).toBeVisible({ timeout: 60_000 })
  })
})
