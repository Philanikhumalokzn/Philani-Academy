import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').trim()
const learnerEmail = (process.env.E2E_USER_EMAIL || 'philanikhumalo111@gmail.com').trim()
const learnerPassword = (process.env.E2E_USER_PASSWORD || 'Mbo199Pc').trim()

const prismaPool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(prismaPool) })

const toAbsoluteUrl = (value: string) => {
  if (/^https?:\/\//i.test(value)) return value
  const normalizedBase = baseUrl.replace(/\/$/, '')
  const normalizedPath = value.startsWith('/') ? value : `/${value}`
  return `${normalizedBase}${normalizedPath}`
}

const createSignedInStorageState = async (browser: Browser) => {
  const authContext = await browser.newContext({ viewport: { width: 1365, height: 900 } })

  const csrfRes = await authContext.request.get(toAbsoluteUrl('/api/auth/csrf'))
  if (!csrfRes.ok()) {
    throw new Error(`Failed to fetch CSRF token (${csrfRes.status()})`)
  }
  const csrfData = await csrfRes.json().catch(() => ({}))
  const csrfToken = typeof csrfData?.csrfToken === 'string' ? csrfData.csrfToken : ''
  if (!csrfToken) {
    throw new Error('Missing NextAuth CSRF token')
  }

  const callbackRes = await authContext.request.post(toAbsoluteUrl('/api/auth/callback/credentials'), {
    form: {
      csrfToken,
      email: learnerEmail,
      password: learnerPassword,
      callbackUrl: toAbsoluteUrl('/dashboard'),
      json: 'true',
    },
  })

  if (!callbackRes.ok()) {
    throw new Error(`Credentials callback failed (${callbackRes.status()})`)
  }

  const sessionRes = await authContext.request.get(toAbsoluteUrl('/api/auth/session'))
  if (!sessionRes.ok()) {
    throw new Error(`Failed to fetch authenticated session (${sessionRes.status()})`)
  }
  const sessionData = await sessionRes.json().catch(() => ({}))
  const sessionEmail = typeof sessionData?.user?.email === 'string' ? sessionData.user.email.trim().toLowerCase() : ''
  if (sessionEmail !== learnerEmail.toLowerCase()) {
    throw new Error(`Authenticated session email mismatch: ${sessionEmail || 'missing'}`)
  }

  const storageState = await authContext.storageState()
  await authContext.close()
  return storageState
}

const ensureOnDashboard = async (page: Page) => {
  if (!/\/dashboard/i.test(page.url())) {
    await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'domcontentloaded' })
  }
  await expect(page).toHaveURL(/\/dashboard|\/board/i, { timeout: 30_000 })
}

const triggerLongPress = async (page: Page, locator: Locator) => {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (!box) {
    throw new Error('Unable to compute long-press target bounds')
  }

  const pressX = box.x + Math.min(box.width / 2, Math.max(16, box.width - 16))
  const pressY = box.y + Math.min(box.height / 2, Math.max(16, box.height - 16))

  await page.mouse.move(pressX, pressY)
  await page.mouse.down()
  await page.waitForTimeout(750)
  await page.mouse.up()
}

const expectPostCrudSheet = async (page: Page) => {
  const dialog = page.getByRole('dialog', { name: /^post options$/i })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await expect(dialog.getByRole('button', { name: /edit post/i })).toBeVisible({ timeout: 10_000 })
  await expect(dialog.getByRole('button', { name: /delete post/i })).toBeVisible({ timeout: 10_000 })
  return dialog
}

const closeSheet = async (page: Page) => {
  const dialog = page.getByRole('dialog', { name: /^post options$/i })
  if (!(await dialog.isVisible().catch(() => false))) return
  await dialog.getByRole('button', { name: /^close$/i }).click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

test.afterAll(async () => {
  await prisma.$disconnect()
  await prismaPool.end()
})

test.describe('post long-press CRUD', () => {
  test.setTimeout(360_000)

  test('owned posts expose CRUD actions on dashboard and profile long press', async ({ browser }) => {
    const storageState = await createSignedInStorageState(browser)
    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      storageState,
    })
    const page = await context.newPage()

    const uniqueToken = `${Date.now()}`
    const uniqueTitle = `Long press post ${uniqueToken}`
    const uniqueText = `Owned long press body ${uniqueToken}`

    let createdPostId = ''
    try {
      await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'commit' }).catch(() => null)
      await ensureOnDashboard(page)
      await page.reload({ waitUntil: 'domcontentloaded' })

      const created = await page.evaluate(async ({ title, text }) => {
        const profileRes = await fetch('/api/profile', { credentials: 'same-origin', cache: 'no-store' })
        const profileData = await profileRes.json().catch(() => ({}))
        const activeUserId = typeof profileData?.id === 'string' ? profileData.id : ''
        if (!profileRes.ok || !activeUserId) {
          throw new Error(profileData?.message || `Failed to load active profile (${profileRes.status})`)
        }

        const blocks = [{ id: 'text-block', type: 'text', text }]

        const createRes = await fetch('/api/posts', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            prompt: text,
            contentBlocks: blocks,
            audience: 'public',
          }),
        })
        const createData = await createRes.json().catch(() => ({}))
        if (!createRes.ok) {
          throw new Error(createData?.message || `Failed to create post (${createRes.status})`)
        }

        return {
          createdId: String(createData?.id || ''),
          userId: activeUserId,
        }
      }, { title: uniqueTitle, text: uniqueText })

      createdPostId = created.createdId
      expect(createdPostId).toBeTruthy()
      expect(created.userId).toBeTruthy()

      await page.reload({ waitUntil: 'domcontentloaded' })
      await ensureOnDashboard(page)

      const myPostsToggle = page.getByRole('button', { name: /your posts\s+my posts/i })
      await expect(myPostsToggle).toBeVisible({ timeout: 20_000 })
      if ((await myPostsToggle.getAttribute('aria-expanded')) !== 'true') {
        await myPostsToggle.click()
      }

      const dashboardPost = page.locator(`#dashboard-my-posts-section li[data-post-id="${createdPostId}"]`).first()
      await expect(dashboardPost).toBeVisible({ timeout: 30_000 })
      await expect(dashboardPost).toContainText(uniqueTitle)

      const dashboardLongPressTarget = dashboardPost.locator('div.min-w-0').filter({ hasText: uniqueTitle }).first()
      await triggerLongPress(page, dashboardLongPressTarget)

      await expectPostCrudSheet(page)
      await closeSheet(page)

      const openProfileButton = page.getByRole('button', { name: /open your profile/i }).first()
      await expect(openProfileButton).toBeVisible({ timeout: 20_000 })
      await openProfileButton.click()

      const profilePost = page.locator(`article[data-post-id="${createdPostId}"]`).first()
      await expect(profilePost).toBeVisible({ timeout: 30_000 })

      const profileBody = profilePost.getByTestId('public-feed-post-body')
      await expect(profileBody).toHaveAttribute('aria-expanded', 'false')

      await triggerLongPress(page, profileBody)

      await expectPostCrudSheet(page)
      await expect(profileBody).toHaveAttribute('aria-expanded', 'false')
      await closeSheet(page)
    } finally {
      if (createdPostId) {
        await prisma.socialPost.delete({ where: { id: createdPostId } }).catch(() => null)
      }
      await context.close().catch(() => null)
    }
  })
})