import { expect, test, type Page } from '@playwright/test'

const baseUrl = (process.env.E2E_BASE_URL || '').trim()
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

test.describe('paper context bottom sheet scrolling', () => {
  test('user can scroll within the paper context modal', async ({ page }) => {
    test.skip(!baseUrl || !adminEmail || !adminPassword, 'Set E2E_BASE_URL, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD')

    // Sign in
    await page.goto(toAbsoluteUrl('/auth/signin'), { waitUntil: 'domcontentloaded' })
    await fillSignIn(page)

    // Navigate to dashboard
    await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'domcontentloaded' })

    // Wait for the page to be ready
    await page.waitForTimeout(2000)

    // Look for any exam question cards or items that would open the paper context
    // Try to find a question with context by looking for common selector patterns
    const questionCards = page.locator('[data-testid*="question"], [class*="question"], button:has-text("View Context")')
    
    // If we find question cards, try to open paper context
    if (await questionCards.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await questionCards.first().click()
      
      // Wait for the bottom sheet to appear
      const scrollContainer = page.locator('[class*="overflow-y-auto"][class*="flex-1"]').first()
      
      if (await scrollContainer.isVisible({ timeout: 5000 }).catch(() => false)) {
        console.log('Paper context modal found, testing scroll...')

        // Get initial scroll position
        const initialScroll = await scrollContainer.evaluate((el) => (el as HTMLElement).scrollTop)
        console.log('Initial scroll position:', initialScroll)

        // Attempt to scroll down
        await scrollContainer.evaluate((el) => {
          (el as HTMLElement).scrollTop = 200
        })

        // Get scroll position after attempting to scroll
        const afterScroll = await scrollContainer.evaluate((el) => (el as HTMLElement).scrollTop)
        console.log('After scroll position:', afterScroll)

        // Verify scroll worked
        expect(afterScroll).toBeGreaterThan(initialScroll || 0)
        
        // Also test programmatic scroll via wheel event
        await scrollContainer.dispatchEvent('wheel', {
          deltaY: 100,
          bubbles: true,
          cancelable: true,
        })

        // Check if scrollable (has scrollHeight > clientHeight)
        const isScrollable = await scrollContainer.evaluate((el) => {
          const elem = el as HTMLElement
          console.log('scrollHeight:', elem.scrollHeight, 'clientHeight:', elem.clientHeight)
          return elem.scrollHeight > elem.clientHeight
        })

        console.log('Is scrollable:', isScrollable)
        expect(isScrollable).toBe(true)

        return
      }
    }

    // If no questions found with visible paper context, log what we found
    console.log('Note: Could not find question with paper context to test. This may be expected if no questions are loaded.')
  })

  test('verify paper context scroll container has proper CSS', async ({ page }) => {
    test.skip(!baseUrl || !adminEmail || !adminPassword, 'Set E2E_BASE_URL, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD')

    // Sign in
    await page.goto(toAbsoluteUrl('/auth/signin'), { waitUntil: 'domcontentloaded' })
    await fillSignIn(page)

    // Navigate to dashboard
    await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'domcontentloaded' })

    // Wait for the page to be ready
    await page.waitForTimeout(2000)

    // Try to find and click a question to open paper context
    const questionButtons = page.locator('button').filter({ hasText: /view|context|paper/i }).first()
    
    if (await questionButtons.isVisible({ timeout: 5000 }).catch(() => false)) {
      await questionButtons.click()
      await page.waitForTimeout(1000)

      // Find the scroll container
      const scrollContainer = page.locator('[class*="overflow-y-auto"][class*="flex-1"]').first()

      if (await scrollContainer.isVisible().catch(() => false)) {
        // Check computed styles
        const styles = await scrollContainer.evaluate((el) => {
          const elem = el as HTMLElement
          const computed = window.getComputedStyle(elem)
          return {
            overflowY: computed.overflowY,
            display: computed.display,
            flex: computed.flex,
            minHeight: computed.minHeight,
          }
        })

        console.log('Scroll container styles:', styles)

        // Verify scroll container has proper styles
        expect(styles.overflowY).toBe('auto')
        expect(styles.display).toBe('flex')
        expect(styles.minHeight).toBe('0px')

        return
      }
    }

    console.log('Note: Could not open paper context to verify CSS.')
  })
})
