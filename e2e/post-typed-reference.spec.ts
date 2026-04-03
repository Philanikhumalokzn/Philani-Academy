import { expect, test, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').trim()
const adminEmail = (process.env.E2E_ADMIN_EMAIL || 'admin@philani.test').trim()
const adminPassword = (process.env.E2E_ADMIN_PASSWORD || 'admin').trim()
const prismaPool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(prismaPool) })

const toAbsoluteUrl = (value: string) => {
  if (/^https?:\/\//i.test(value)) return value
  const normalizedBase = baseUrl.replace(/\/$/, '')
  const normalizedPath = value.startsWith('/') ? value : `/${value}`
  return `${normalizedBase}${normalizedPath}`
}

const fillSignIn = async (page: Page, email: string, password: string) => {
  const emailInput = page.locator('#email')
  const passwordInput = page.locator('#password')

  await expect(emailInput).toBeVisible({ timeout: 20_000 })
  await expect(passwordInput).toBeVisible({ timeout: 20_000 })

  await emailInput.fill('')
  await emailInput.pressSequentially(email, { delay: 20 })
  await expect(emailInput).toHaveValue(email)
  await passwordInput.fill('')
  await passwordInput.pressSequentially(password, { delay: 20 })
  await expect(passwordInput).toHaveValue(password)
  await page.getByRole('button', { name: /^sign in$/i }).click()
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

  const cookies = await page.context().cookies()
  const hasSessionCookie = cookies.some((cookie) => /next-auth.*session-token/i.test(cookie.name))
  if (!hasSessionCookie) {
    throw new Error(`Sign-in did not create a NextAuth session cookie. Final URL: ${page.url()}`)
  }
}

const ensureOnDashboard = async (page: Page) => {
  if (!/\/dashboard/i.test(page.url())) {
    await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'domcontentloaded' })
  }
}

const seedPublicPostForAdminSolve = async (title: string, prompt: string) => {
  const author = await prisma.user.upsert({
    where: { email: 'playwright.author@philani.test' },
    update: {
      name: 'Playwright Author',
      firstName: 'Playwright',
      lastName: 'Author',
      role: 'student',
    },
    create: {
      email: 'playwright.author@philani.test',
      password: 'seeded-for-e2e',
      name: 'Playwright Author',
      firstName: 'Playwright',
      lastName: 'Author',
      role: 'student',
    },
    select: { id: true },
  })

  return prisma.socialPost.create({
    data: {
      createdById: author.id,
      title,
      prompt,
      audience: 'public',
      maxAttempts: 3,
      attemptsOpen: true,
    },
    select: { id: true },
  })
}

test.afterAll(async () => {
  await prisma.$disconnect()
  await prismaPool.end()
})

test.describe('typed post reply reference layer', () => {
  test.setTimeout(240_000)

  test('admin can see the original post behind the full-height typed workspace', async ({ browser }) => {
    const uniqueTitle = `Playwright typed reference ${Date.now()}`
    const uniquePrompt = `Solve this and keep referring back to it. ${Date.now()}`
    const seededPost = await seedPublicPostForAdminSolve(uniqueTitle, uniquePrompt)

    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
    const adminPage = await adminContext.newPage()
    await adminPage.goto(toAbsoluteUrl('/auth/signin'), { waitUntil: 'domcontentloaded' })
    await fillSignIn(adminPage, adminEmail, adminPassword)
    await ensureOnDashboard(adminPage)

    await adminPage.reload({ waitUntil: 'domcontentloaded' })

    const targetPost = adminPage.locator(`li[data-post-id="${seededPost.id}"]`).first()
    await expect(targetPost).toBeVisible({ timeout: 30_000 })
    await targetPost.getByRole('button', { name: /^Solve$/i }).first().click()

    await expect(adminPage.getByText(/Solve This Post/i)).toBeVisible({ timeout: 15_000 })
    await adminPage.getByRole('button', { name: /Typed/i }).click()

    const referenceCard = adminPage.getByTestId('public-solve-reference-card')
    const opacitySlider = adminPage.getByLabel('Canvas opacity')
    const keyboardField = adminPage.locator('math-field.keyboard-mathlive-field').first()

    await expect(referenceCard).toBeVisible({ timeout: 20_000 })
    await expect(referenceCard).toContainText(uniquePrompt)
    await expect(opacitySlider).toBeVisible({ timeout: 20_000 })
    await expect(keyboardField).toBeVisible({ timeout: 30_000 })

    await opacitySlider.fill('35')
    await expect(opacitySlider).toHaveValue('35')
    await expect(keyboardField).toBeVisible({ timeout: 20_000 })

    await adminContext.close()
    await prisma.socialPost.delete({ where: { id: seededPost.id } })
  })
})
