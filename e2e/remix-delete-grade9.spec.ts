import { expect, test, type Page } from '@playwright/test'

const baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').trim()
const adminEmail = (process.env.E2E_ADMIN_EMAIL || '').trim()
const adminPassword = (process.env.E2E_ADMIN_PASSWORD || '').trim()

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

test.describe('remix delete (grade 9)', () => {
  test.setTimeout(180_000)

  test('deleting from remix search results returns success and removes row', async ({ page }) => {
    test.skip(!adminEmail || !adminPassword, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD')

    await page.goto(toAbsoluteUrl('/auth/signin'), { waitUntil: 'domcontentloaded' })
    await fillSignIn(page)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(toAbsoluteUrl('/dashboard?grade=GRADE_9'), { waitUntil: 'domcontentloaded' })

    let latestExamQuestionGet: { url: string; itemIds: string[]; total?: number } | null = null
    page.on('response', async (response) => {
      try {
        if (response.request().method() !== 'GET') return
        if (!/\/api\/exam-questions\?/i.test(response.url())) return
        const payload = await response.json().catch(() => null)
        const items = Array.isArray(payload?.items) ? payload.items : []
        latestExamQuestionGet = {
          url: response.url(),
          itemIds: items.map((item: any) => String(item?.id || '')).filter(Boolean),
          total: typeof payload?.total === 'number' ? payload.total : undefined,
        }
      } catch {
        // ignore observer failures
      }
    })

    const learningHubButton = page.getByRole('button', { name: /Learning Hub/i }).first()
    await expect(learningHubButton).toBeVisible({ timeout: 30_000 })
    await learningHubButton.click()

    const remixTab = page.getByRole('button', { name: /^Remix$/i }).first()
    await expect(remixTab).toBeVisible({ timeout: 30_000 })
    await remixTab.click()

    const learningHubPanel = page.locator('div').filter({ hasText: /^Learning Hub/ }).first()
    const scopedRefresh = learningHubPanel.getByRole('button', { name: /^Refresh$/i }).first()
    if (await scopedRefresh.count()) {
      await scopedRefresh.click({ force: true })
    }

    const resultRows = page
      .locator('li.border-b')
      .filter({ hasText: /QUESTION/i })
      .filter({ has: page.getByRole('button', { name: /^Delete$/i }) })
    await expect.poll(async () => await resultRows.count(), { timeout: 60_000 }).toBeGreaterThan(0)

    const targetRow = resultRows.first()
    const rowTextBefore = ((await targetRow.textContent()) || '').trim()

    const deleteRequest = page.waitForResponse((response) => {
      const req = response.request()
      return req.method() === 'DELETE' && /\/api\/exam-questions\//i.test(response.url())
    }, { timeout: 30_000 })

    page.once('dialog', async (dialog) => {
      await dialog.accept()
    })

    await targetRow.getByRole('button', { name: /^Delete$/i }).click()

    const response = await deleteRequest
    const status = response.status()
    const bodyText = await response.text().catch(() => '')
    const deleteUrl = response.url()
    const deleteIdMatch = deleteUrl.match(/\/api\/exam-questions\/([^/?#]+)/i)
    const deleteId = deleteIdMatch?.[1] ? decodeURIComponent(deleteIdMatch[1]) : ''

    let bulkDeleteStatus: number | null = null
    let bulkDeleteBody = ''
    if (deleteId) {
      const bulkResponse = await page.request.fetch(toAbsoluteUrl('/api/exam-questions'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        data: { ids: [deleteId] },
      })
      bulkDeleteStatus = bulkResponse.status()
      bulkDeleteBody = await bulkResponse.text().catch(() => '')
    }

    // eslint-disable-next-line no-console
    console.log(`GET exam-questions: ${latestExamQuestionGet?.url || 'none'} | total=${latestExamQuestionGet?.total ?? 'n/a'} | firstIds=${(latestExamQuestionGet?.itemIds || []).slice(0, 5).join(',')}`)
    // eslint-disable-next-line no-console
    console.log(`DELETE ${deleteUrl} -> ${status} | ${bodyText}`)
    if (bulkDeleteStatus != null) {
      // eslint-disable-next-line no-console
      console.log(`BULK DELETE /api/exam-questions [${deleteId}] -> ${bulkDeleteStatus} | ${bulkDeleteBody}`)
    }

    // Keep this assertion strict so the repro catches server-side failures.
    expect(status, `Delete API failed: ${bodyText}`).toBeLessThan(300)

    await expect.poll(async () => {
      const rows = page.locator('li').filter({ has: page.getByRole('button', { name: /^Delete$/i }) })
      const firstText = ((await rows.first().textContent()) || '').trim()
      return firstText === rowTextBefore
    }, { timeout: 20_000 }).toBe(false)
  })
})
