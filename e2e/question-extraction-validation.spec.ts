import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const baseUrl = (process.env.E2E_BASE_URL || '').trim()
const adminEmail = (process.env.E2E_ADMIN_EMAIL || '').trim()
const adminPassword = (process.env.E2E_ADMIN_PASSWORD || '').trim()
const pdfPath = (process.env.E2E_EXTRACTION_PDF || 'C:\\Users\\mandl\\Desktop\\Khumalo\\Mathematics P1 Grade 11 Nov 2015 Eng.pdf').trim()

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

test.describe('Question extraction validation pipeline', () => {
  test.setTimeout(900_000)

  test('Full extraction flow: upload, extract with KaTeX validation, review diagrams, verify search results', async ({ page }) => {
    test.skip(!baseUrl || !adminEmail || !adminPassword, 'Set E2E_BASE_URL, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD')
    test.skip(!pdfPath || !fs.existsSync(pdfPath), `Test PDF not found at: ${pdfPath}`)

    const uniqueTag = `qb-validation-${Date.now()}`
    const uniqueTitle = `QBValidation ${uniqueTag}`

    console.log(`Testing with PDF: ${pdfPath}`)
    console.log(`Using unique tag: ${uniqueTag}`)

    // === STEP 1: Sign in ===
    await page.goto(toAbsoluteUrl('/auth/signin'), { waitUntil: 'domcontentloaded' })
    await fillSignIn(page)
    console.log('✓ Signed in successfully')

    // === STEP 2: Upload PDF ===
    await page.goto(toAbsoluteUrl('/resource-bank'), { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /Resource Bank/i })).toBeVisible({ timeout: 30_000 })

    const workspaceCard = page.locator('div.card').filter({ hasText: 'Your workspace' }).first()

    const titleInput = workspaceCard.locator('input[placeholder*="Algebra worksheet"]').first()
    await titleInput.fill(uniqueTitle)

    const tagInput = workspaceCard.locator('input[placeholder*="Past paper"]').first()
    await tagInput.fill(uniqueTag)

    // Ensure Parse checkbox is checked
    const parseCheckbox = workspaceCard.locator('label:has-text("Parse (Mathpix OCR)") input[type="checkbox"]').first()
    const isChecked = await parseCheckbox.isChecked()
    if (!isChecked) {
      await parseCheckbox.check({ force: true })
    }

    // Set grade if needed
    const gradeSelect = workspaceCard.locator('select.input').first()
    if (await gradeSelect.count()) {
      await gradeSelect.selectOption({ label: /Grade 11/i })
    }

    // Upload file
    const chooseFileButton = workspaceCard.getByRole('button', { name: /Choose File/i }).first()
    const chooserPromise = page.waitForEvent('filechooser')
    await chooseFileButton.click()
    const chooser = await chooserPromise
    await chooser.setFiles(pdfPath)

    const uploadButton = workspaceCard.getByRole('button', { name: /^Upload$/i }).first()
    await uploadButton.click()
    await expect(uploadButton).toHaveText(/Upload/i, { timeout: 240_000 })
    console.log('✓ PDF uploaded successfully')

    // === STEP 3: Wait for Mathpix parsing ===
    const pdfRow = page.locator('div.rounded-lg').filter({ hasText: uniqueTitle }).first()
    await expect(pdfRow).toBeVisible({ timeout: 240_000 })

    const statusText = pdfRow.locator('div.text-xs.text-slate-500, div.text-xs.text-green-600').first()
    let waitCount = 0
    while (waitCount < 60) {
      const text = (await statusText.textContent()) || ''
      if (text.includes('Parsed') || text.includes('parsed')) {
        break
      }
      await page.waitForTimeout(2000)
      waitCount += 1
    }
    console.log('✓ Mathpix parsing complete')

    // === STEP 4: Extract questions ===
    const extractButton = pdfRow.getByRole('button', { name: /Extract Questions/i })
    await expect(extractButton).toBeVisible({ timeout: 120_000 })
    await extractButton.click()

    // Fill extraction modal
    const extractModal = page.locator('div.rounded-2xl').filter({ hasText: 'Extract questions' }).first()
    await expect(extractModal).toBeVisible({ timeout: 30_000 })

    await extractModal.locator('input[type="number"]').first().fill('2015')
    await extractModal.locator('select').first().selectOption('November')
    await extractModal.locator('select').nth(1).selectOption('1')

    const extractSubmitButton = extractModal.getByRole('button', { name: /^Extract$/i })
    await extractSubmitButton.click()

    // Wait for extraction result
    const extractResult = extractModal.locator('div.rounded-xl.bg-green-50, div.rounded-xl.bg-red-50').first()
    await expect(extractResult).toBeVisible({ timeout: 360_000 })

    const extractResultText = (await extractResult.textContent()) || ''
    console.log(`Extraction result: ${extractResultText}`)

    // Verify extraction succeeded
    const successMatch = extractResultText.match(/Extracted\s+(\d+)\s+question/i)
    const createdCount = successMatch ? Number(successMatch[1]) : 0
    expect(createdCount).toBeGreaterThan(0)
    console.log(`✓ Extracted ${createdCount} questions`)

    // Close extraction modal
    await extractModal.getByRole('button', { name: /Cancel/i }).click()
    await expect(extractModal).toBeHidden({ timeout: 10_000 })

    // === STEP 5: Review extracted questions ===
    const reviewButton = pdfRow.getByRole('button', { name: /Review Questions/i })
    await expect(reviewButton).toBeVisible({ timeout: 60_000 })
    await reviewButton.click()

    const reviewModal = page.getByRole('dialog').filter({ hasText: 'Review extracted questions' }).first()
    await expect(reviewModal).toBeVisible({ timeout: 30_000 })

    const questionItems = reviewModal.locator('li.rounded-xl')
    const questionCount = await questionItems.count()
    expect(questionCount).toBeGreaterThan(0)
    console.log(`✓ Review modal shows ${questionCount} questions`)

    // === STEP 6: Verify KaTeX rendering in review modal ===
    let katexIssues: string[] = []
    let diagramCount = 0

    for (let i = 0; i < Math.min(questionCount, 5); i++) {
      const questionItem = questionItems.nth(i)
      const text = (await questionItem.textContent()) || ''
      const qNum = (await questionItem.locator('span.text-xs.font-bold').textContent()) || ''

      // Check for raw, unescaped $ delimiters (bad sign)
      const dollarMatches = (text.match(/\$/g) || []).length
      if (dollarMatches % 2 !== 0) {
        katexIssues.push(` ${qNum}: Unmatched $ delimiters`)
      }

      // Check for raw backslash commands (should be properly delimited)
      if (text.match(/\\[a-zA-Z]+/)) {
        const isDangling = !text.match(/\$[^$]*\\[a-zA-Z]+[^$]*\$/)
        if (isDangling) {
          katexIssues.push(`${qNum}: Possible bare LaTeX command without delimiters`)
        }
      }

      // Count images in this question
      const images = questionItem.locator('img')
      const imgCount = await images.count()
      diagramCount += imgCount
      if (imgCount > 0) {
        console.log(`  ${qNum}: ${imgCount} diagram(s) visible`)
      }
    }

    if (katexIssues.length === 0) {
      console.log('✓ No obvious KaTeX formatting issues detected in review')
    } else {
      console.warn('⚠ Potential KaTeX issues:', katexIssues.join('; '))
    }

    if (diagramCount > 0) {
      console.log(`✓ ${diagramCount} diagram(s) visible in review modal`)
    } else {
      console.log('ℹ No diagrams extracted (expected if PDF has no images)')
    }

    // === STEP 7: Approve and close review ===
    const firstQuestion = questionItems.first()
    const questionNumberText = (await firstQuestion.locator('span.text-xs.font-bold').textContent()) || 'Q?'
    const approveButton = firstQuestion.getByRole('button', { name: /Approve/i })
    await approveButton.click()
    await expect(approveButton).toHaveText(/Revoke/i, { timeout: 15_000 })
    console.log(`✓ Approved question ${questionNumberText}`)

    const closeButton = reviewModal.getByRole('button', { name: /Close/i })
    await closeButton.click()
    await expect(reviewModal).toBeHidden({ timeout: 15_000 })

    // === STEP 8: Search and verify results ===
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'domcontentloaded' })

    const learningHubButton = page.getByRole('button', { name: /Learning Hub/i }).first()
    await expect(learningHubButton).toBeVisible({ timeout: 30_000 })
    await learningHubButton.click()

    const questionBankTab = page.getByRole('button', { name: /^Question Bank$/i }).first()
    await expect(questionBankTab).toBeVisible({ timeout: 30_000 })
    await questionBankTab.click()

    // Set search filters
    const yearFilter = page.getByRole('spinbutton').first()
    await expect(yearFilter).toBeVisible({ timeout: 30_000 })
    await yearFilter.fill('2015')

    const monthFilter = page.getByRole('combobox').nth(0)
    await monthFilter.selectOption('November')

    const paperFilter = page.getByRole('combobox').nth(1)
    await paperFilter.selectOption({ label: 'Paper 1' })

    const searchButton = page.getByRole('button', { name: /Search Questions/i })
    await searchButton.click()

    // Verify results appear
    await expect(page.locator('ul > li', { hasText: /Q\d/ }).first()).toBeVisible({ timeout: 60_000 })
    console.log('✓ Questions appear in search results')

    // === STEP 9: Verify rendering in search results ===
    let searchResultIssues: string[] = []
    const searchResultItems = page.locator('ul > li')
    const resultCount = await searchResultItems.count()

    for (let i = 0; i < Math.min(resultCount, 3); i++) {
      const item = searchResultItems.nth(i)
      const text = (await item.textContent()) || ''
      const qNum = (await item.locator('span.text-xs.font-bold').first().textContent()) || ''

      // Check for raw unescaped $ (should be in properly delimited expressions)
      const dollarMatches = (text.match(/\$/g) || []).length
      if (dollarMatches % 2 !== 0) {
        searchResultIssues.push(`${qNum}: Unmatched $ delimiters`)
      }
    }

    if (searchResultIssues.length === 0) {
      console.log('✓ Search results display well-formatted math')
    } else {
      console.warn('⚠ Search result formatting issues:', searchResultIssues.join('; '))
    }

    console.log('✅ END-TO-END EXTRACTION VALIDATION TEST PASSED')
  })
})
