import { expect, test, type Browser, type Page } from '@playwright/test'
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

test.afterAll(async () => {
  await prisma.$disconnect()
  await prismaPool.end()
})

test.describe('rich social post round-trip', () => {
  test.setTimeout(180_000)

  test('my posts preserves text, math, image, and canvas blocks', async ({ browser }) => {
    const storageState = await createSignedInStorageState(browser)
    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      storageState,
    })
    const page = await context.newPage()

    const uniqueToken = `${Date.now()}`
    const uniqueTitle = `Rich post regression ${uniqueToken}`
    const uniqueText = `Structured rich content ${uniqueToken}`
    const uniqueLatex = `x^2 + y^2 = ${uniqueToken}`
    const imageUrl = '/philani-logo.png'

    let createdPostId = ''

    try {
      await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'domcontentloaded' })
      await ensureOnDashboard(page)

      const created = await page.evaluate(async ({ title, text, latex, imageUrl: nextImageUrl }) => {
        const profileRes = await fetch('/api/profile', { credentials: 'same-origin', cache: 'no-store' })
        const profileData = await profileRes.json().catch(() => ({}))
        const userId = typeof profileData?.id === 'string' ? profileData.id : ''
        if (!profileRes.ok || !userId) {
          throw new Error(profileData?.message || `Failed to load active profile (${profileRes.status})`)
        }

        const blocks = [
          { id: 'text-block', type: 'text', text },
          { id: 'latex-block', type: 'latex', latex },
          { id: 'image-block', type: 'image', imageUrl: nextImageUrl },
          {
            id: 'canvas-block',
            type: 'canvas',
            scene: {
              elements: [],
              appState: { viewBackgroundColor: '#ffffff' },
              files: {},
              updatedAt: new Date().toISOString(),
            },
          },
        ]

        const prompt = JSON.stringify({
          kind: 'social-post-composer-v1',
          version: 1,
          blocks,
        })

        const createRes = await fetch('/api/posts', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            prompt,
            imageUrl: nextImageUrl,
            contentBlocks: blocks,
            audience: 'public',
          }),
        })
        const createData = await createRes.json().catch(() => ({}))
        if (!createRes.ok) {
          throw new Error(createData?.message || `Failed to create post (${createRes.status})`)
        }

        const ownPostsRes = await fetch(`/api/profile/view/${encodeURIComponent(userId)}/posts`, { credentials: 'same-origin', cache: 'no-store' })
        const ownPostsData = await ownPostsRes.json().catch(() => ({}))
        if (!ownPostsRes.ok) {
          throw new Error(ownPostsData?.message || `Failed to load own posts (${ownPostsRes.status})`)
        }

        const createdPost = Array.isArray(ownPostsData?.posts)
          ? ownPostsData.posts.find((item: any) => String(item?.id || '') === String(createData?.id || ''))
          : null

        return {
          createdId: String(createData?.id || ''),
          createdPrompt: String(createData?.prompt || ''),
          ownPost: createdPost,
        }
      }, { title: uniqueTitle, text: uniqueText, latex: uniqueLatex, imageUrl })

      createdPostId = created.createdId
      expect(createdPostId).toBeTruthy()
      expect(created.createdPrompt).toContain('social-post-composer-v1')

      const ownPost = created.ownPost as any
      expect(ownPost).toBeTruthy()
      expect(ownPost?.title).toBe(uniqueTitle)
      expect(Array.isArray(ownPost?.contentBlocks)).toBeTruthy()
      expect(ownPost.contentBlocks.map((block: any) => String(block?.type || ''))).toEqual(['text', 'latex', 'image', 'canvas'])
      expect(String(ownPost?.prompt || '')).toContain(uniqueText)
      expect(String(ownPost?.imageUrl || '')).toContain('philani-logo.png')

      await page.reload({ waitUntil: 'domcontentloaded' })
      await ensureOnDashboard(page)

      const myPostsToggle = page.getByRole('button', { name: /your posts\s+my posts/i })
      await expect(myPostsToggle).toBeVisible({ timeout: 20_000 })
      await myPostsToggle.click()

      const myPostsSection = page.locator('#dashboard-my-posts-section')
      await expect(myPostsSection).toBeVisible({ timeout: 20_000 })

      const targetPost = myPostsSection.locator(`li[data-post-id="${createdPostId}"]`).first()
      await expect(targetPost).toBeVisible({ timeout: 30_000 })
      await expect(targetPost).toContainText(uniqueTitle)
      await expect(targetPost).toContainText(uniqueText)
      await expect(targetPost.locator('.katex').first()).toBeVisible({ timeout: 20_000 })
      await expect(targetPost.locator('img[src*="philani-logo.png"]').first()).toBeVisible({ timeout: 20_000 })
      await expect(targetPost).toContainText('No canvas submitted yet.')
    } finally {
      if (createdPostId) {
        await prisma.socialPost.delete({ where: { id: createdPostId } }).catch(() => null)
      }
      await context.close().catch(() => null)
    }
  })
})