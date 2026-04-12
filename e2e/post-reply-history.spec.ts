import { expect, test, type Browser, type Page } from '@playwright/test'

const baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').trim()
const learnerEmail = (process.env.E2E_USER_EMAIL || 'philanikhumalo111@gmail.com').trim()
const learnerPassword = (process.env.E2E_USER_PASSWORD || 'Mbo199Pc').trim()

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

test.describe('post reply history', () => {
  test.setTimeout(180_000)

  test('same learner keeps multiple replies in one post thread', async ({ browser }) => {
    const uniqueToken = `${Date.now()}`
    const uniqueTitle = `Playwright reply history ${uniqueToken}`
    const uniquePrompt = `Keep both replies for ${uniqueToken}`
    const firstReply = `First reply ${uniqueToken}`
    const secondReply = `Second reply ${uniqueToken}`

    const storageState = await createSignedInStorageState(browser)
    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      storageState,
    })
    const page = await context.newPage()
    let createdPostId = ''
    let threadKey = ''

    try {
      await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'domcontentloaded' })
      await ensureOnDashboard(page)

      createdPostId = await page.evaluate(async ({ title, prompt }) => {
        const createRes = await fetch('/api/posts', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            prompt,
            contentBlocks: [
              {
                id: 'post-text-block',
                type: 'text',
                text: prompt,
              },
            ],
            audience: 'public',
            maxAttempts: 3,
          }),
        })
        const createData = await createRes.json().catch(() => ({}))
        if (!createRes.ok) {
          throw new Error(createData?.message || `Failed to create post (${createRes.status})`)
        }
        return String(createData?.id || '')
      }, { title: uniqueTitle, prompt: uniquePrompt })

      expect(createdPostId).toBeTruthy()
      threadKey = `post:${createdPostId}`

      const created = await page.evaluate(async ({ activeThreadKey, firstText, secondText }) => {
        const submitReply = async (text: string) => {
          const res = await fetch(`/api/threads/${encodeURIComponent(activeThreadKey)}/responses`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              studentText: text,
              contentBlocks: [
                {
                  id: `text-${text}`,
                  type: 'text',
                  text,
                },
              ],
              quizId: activeThreadKey,
              quizLabel: 'Playwright reply history',
              prompt: 'Playwright reply history',
            }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) {
            throw new Error(data?.message || `Failed to submit reply (${res.status})`)
          }
          return data
        }

        const first = await submitReply(firstText)
        const second = await submitReply(secondText)

        const threadRes = await fetch(`/api/threads/${encodeURIComponent(activeThreadKey)}/responses`, {
          credentials: 'same-origin',
          cache: 'no-store',
        })
        const threadData = await threadRes.json().catch(() => ({}))
        if (!threadRes.ok) {
          throw new Error(threadData?.message || `Failed to load thread (${threadRes.status})`)
        }

        const responses = Array.isArray(threadData?.responses) ? threadData.responses : []
        return {
          firstId: String(first?.id || ''),
          secondId: String(second?.id || ''),
          responseIds: responses.map((response: any) => String(response?.id || '')),
          replyTexts: responses.map((response: any) => String(response?.studentText || '').trim()).filter(Boolean),
        }
      }, { activeThreadKey: threadKey, firstText: firstReply, secondText: secondReply })

      expect(created.firstId).toBeTruthy()
      expect(created.secondId).toBeTruthy()
      expect(created.secondId).not.toBe(created.firstId)
      expect(created.responseIds).toHaveLength(2)
      expect(created.replyTexts).toEqual(expect.arrayContaining([firstReply, secondReply]))

      await page.reload({ waitUntil: 'domcontentloaded' })
      await ensureOnDashboard(page)

      const openProfileButton = page.getByRole('button', { name: /open your profile/i }).first()
      await expect(openProfileButton).toBeVisible({ timeout: 20_000 })
      await openProfileButton.click()

      const profilePost = page.locator(`article[data-post-id="${createdPostId}"]`).first()
      await expect(profilePost).toBeVisible({ timeout: 30_000 })

      const profileBody = profilePost.getByTestId('public-feed-post-body')
      await expect(profileBody).toHaveAttribute('aria-expanded', 'false')
      await profileBody.click()
      await expect(profileBody).toHaveAttribute('aria-expanded', 'true')
      await expect(profilePost).toContainText(firstReply)
      await expect(profilePost).toContainText(secondReply)
    } finally {
      if (createdPostId) {
        await page.evaluate(async ({ postId }) => {
          await fetch(`/api/posts/${encodeURIComponent(postId)}`, {
            method: 'DELETE',
            credentials: 'same-origin',
          }).catch(() => null)
        }, { postId: createdPostId }).catch(() => null)
      }
      await context.close().catch(() => null)
    }
  })
})