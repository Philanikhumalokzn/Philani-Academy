import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

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

const fillSignIn = async (page: Page) => {
  const emailInput = page.locator('#email')
  const passwordInput = page.locator('#password')

  await expect(emailInput).toBeVisible({ timeout: 20_000 })
  await expect(passwordInput).toBeVisible({ timeout: 20_000 })

  await emailInput.click()
  await emailInput.fill('')
  await emailInput.pressSequentially(adminEmail, { delay: 20 })
  await expect(emailInput).toHaveValue(adminEmail)

  await passwordInput.click()
  await passwordInput.fill('')
  await passwordInput.pressSequentially(adminPassword, { delay: 20 })
  await expect(passwordInput).toHaveValue(adminPassword)

  await page.getByRole('button', { name: /^Sign in$/i }).click()
  await expect(page).toHaveURL(/\/dashboard|\/board/i, { timeout: 30_000 })
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

    const chooseFileButton = workspaceCard.getByRole('button', { name: /Choose File/i }).first()
    const chooserPromise = page.waitForEvent('filechooser')
    await chooseFileButton.click()
    const chooser = await chooserPromise
    await chooser.setFiles(pdfPath)

    const uploadButton = workspaceCard.getByRole('button', { name: /^Upload$/i }).first()

    if (await uploadButton.isDisabled()) {
      const gradeSelect = page.locator('select.input').first()
      if (await gradeSelect.count()) {
        await gradeSelect.selectOption({ index: 1 })
      }
    }

    await uploadButton.click()
    await expect(uploadButton).toHaveText(/Upload/i, { timeout: 240_000 })
    await expect(page.getByText(/Failed to upload resource/i)).toHaveCount(0)

    const pdfRow = page.getByRole('listitem').filter({
      has: page.locator('a[href*="Mathematics_P1_Nov_2024_Eng.pdf"]'),
    }).first()

    await expect(pdfRow).toBeVisible({ timeout: 240_000 })

    const extractButton = pdfRow.getByRole('button', { name: /Extract Questions/i })
    await expect(extractButton).toBeVisible({ timeout: 120_000 })
    await extractButton.click()

    const extractModal = page.locator('div.rounded-2xl').filter({ hasText: 'Gemini will read the parsed OCR text' }).first()
    await expect(extractModal).toBeVisible({ timeout: 30_000 })

    await extractModal.locator('input[type="number"]').first().fill('2024')
    await extractModal.locator('select').first().selectOption('November')
    await extractModal.locator('select').nth(1).selectOption('1')
    await extractModal.getByRole('button', { name: /^Extract$/i }).click()

    const extractResult = extractModal.locator('div.rounded-xl.bg-green-50').first()
    await expect(extractResult).toBeVisible({ timeout: 360_000 })

    const extractText = (await extractResult.textContent()) || ''
    const counts = extractText.match(/Extracted\s+(\d+)\s+question.*?(\d+)\s+skipped/i)
    const createdCount = counts ? Number(counts[1]) : Number((extractText.match(/Extracted\s+(\d+)\s+question/i) || [])[1] || 0)
    const skippedCount = counts ? Number(counts[2]) : 0
    expect(createdCount + skippedCount).toBeGreaterThan(0)

    await extractModal.getByRole('button', { name: /Cancel/i }).click()

    const reviewButton = pdfRow.getByRole('button', { name: /Review Questions/i })
    await expect(reviewButton).toBeVisible({ timeout: 60_000 })
    await reviewButton.click()

    const reviewModal = page.getByRole('dialog').filter({ hasText: 'Review extracted questions' }).first()
    await expect(reviewModal).toBeVisible({ timeout: 30_000 })

    const firstReviewedQuestion = reviewModal.locator('li').first()
    await expect(firstReviewedQuestion).toBeVisible({ timeout: 120_000 })

    const reviewText = (await firstReviewedQuestion.textContent()) || ''
    const questionMatch = reviewText.match(/Q(\d+(?:\.\d+)*)/)
    const targetQuestionNumber = String(questionMatch?.[1] || '').trim()
    expect(targetQuestionNumber.length).toBeGreaterThan(0)

    await reviewModal.locator('button.btn.btn-ghost', { hasText: 'Close' }).first().click()
    await expect(reviewModal).toBeHidden({ timeout: 15_000 })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'domcontentloaded' })

    const learningHubButton = page.getByRole('button', { name: /Learning Hub/i }).first()
    await expect(learningHubButton).toBeVisible({ timeout: 30_000 })
    await learningHubButton.click()

    const questionBankTab = page.getByRole('button', { name: /^Question Bank$/i }).first()
    await expect(questionBankTab).toBeVisible({ timeout: 30_000 })
    await questionBankTab.click()

    const yearFilter = page.getByRole('spinbutton').first()
    await expect(yearFilter).toBeVisible({ timeout: 30_000 })
    await yearFilter.fill('2024')

    const monthFilter = page.getByRole('combobox').nth(0)
    await monthFilter.selectOption('November')

    const paperFilter = page.getByRole('combobox').nth(1)
    await paperFilter.selectOption({ label: 'Paper 1' })

    const qNumberInput = page.getByRole('textbox', { name: /Question number prefix/i }).first().or(page.getByPlaceholder('e.g. 1, 1.1, 1.1.5').first())
    await qNumberInput.fill(targetQuestionNumber)

    await page.getByRole('button', { name: /Search Questions/i }).click()

    await expect(page.getByText(new RegExp(`Q${targetQuestionNumber.replace('.', '\\.')}`)).first()).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText(/result/i).first()).toBeVisible({ timeout: 60_000 })
  })
})
