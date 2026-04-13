import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'

const baseUrl = (process.env.E2E_BASE_URL || 'http://localhost:3000').trim()
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

const getSceneZoom = (scene: any) => {
  const raw = scene?.appState?.zoom
  if (typeof raw === 'number') return raw
  if (raw && typeof raw === 'object' && typeof raw.value === 'number') return raw.value
  return 1
}

const buildCanvasScene = (seed: number) => ({
  elements: [
    {
      id: `rect-primary-${seed}`,
      type: 'rectangle',
      x: 80,
      y: 60,
      width: 120,
      height: 90,
      angle: 0,
      strokeColor: '#0f172a',
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 4,
      strokeStyle: 'solid',
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed,
      version: 1,
      versionNonce: seed + 11,
      isDeleted: false,
      boundElements: null,
      updated: seed,
      link: null,
      locked: false,
      index: 'a0',
    },
    {
      id: `rect-secondary-${seed}`,
      type: 'rectangle',
      x: 360,
      y: 210,
      width: 100,
      height: 70,
      angle: 0,
      strokeColor: '#0f172a',
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 4,
      strokeStyle: 'solid',
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: seed + 1,
      version: 1,
      versionNonce: seed + 13,
      isDeleted: false,
      boundElements: null,
      updated: seed + 1,
      link: null,
      locked: false,
      index: 'a1',
    },
  ],
  appState: {
    viewBackgroundColor: '#ffffff',
    zoom: 1,
    scrollX: 0,
    scrollY: 0,
  },
  files: {},
  updatedAt: new Date(seed).toISOString(),
  sceneMeta: {
    version: 1,
    baselineSegmentId: null,
    activeSegmentId: null,
    guideSpacing: null,
    lastObservedZoom: 1,
    viewerViewportPersisted: false,
    segments: [],
  },
})

const cloneScene = <T,>(scene: T): T => JSON.parse(JSON.stringify(scene)) as T

const getViewerInkBounds = async (viewer: Locator) => {
  return viewer.evaluate((element) => {
    const canvases = Array.from(element.querySelectorAll('canvas'))

    const measureCanvas = (canvas: HTMLCanvasElement) => {
      const width = canvas.width
      const height = canvas.height
      if (!width || !height) return null
      const context = canvas.getContext('2d')
      if (!context) return null
      const { data } = context.getImageData(0, 0, width, height)
      let minX = width
      let minY = height
      let maxX = -1
      let maxY = -1
      let count = 0
      let sumX = 0
      let sumY = 0

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const idx = ((y * width) + x) * 4
          const alpha = data[idx + 3]
          if (alpha < 20) continue
          const red = data[idx]
          const green = data[idx + 1]
          const blue = data[idx + 2]
          if (red > 245 && green > 245 && blue > 245) continue
          count += 1
          sumX += x
          sumY += y
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }

      if (!count || maxX < minX || maxY < minY) return null
      return {
        left: minX,
        top: minY,
        right: maxX,
        bottom: maxY,
        width: maxX - minX,
        height: maxY - minY,
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2,
        centroidX: sumX / count,
        centroidY: sumY / count,
        count,
        canvasWidth: width,
        canvasHeight: height,
      }
    }

    const candidates = canvases
      .map(measureCanvas)
      .filter((candidate): candidate is NonNullable<ReturnType<typeof measureCanvas>> => Boolean(candidate))
      .sort((left, right) => right.count - left.count)

    return candidates[0] || null
  })
}

const fetchResponseScene = async (page: Page, threadKey: string, responseId: string) => {
  return page.evaluate(async ({ activeThreadKey, activeResponseId }) => {
    const res = await fetch(`/api/threads/${encodeURIComponent(activeThreadKey)}/responses`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data?.message || `Failed to load thread (${res.status})`)
    }
    const responses = Array.isArray(data?.responses) ? data.responses : []
    const response = responses.find((entry: any) => String(entry?.id || '') === activeResponseId)
    if (!response) return null
    return response.excalidrawScene || null
  }, { activeThreadKey: threadKey, activeResponseId: responseId })
}

const patchResponseScene = async (page: Page, threadKey: string, responseId: string, scene: any) => {
  return page.evaluate(async ({ activeThreadKey, activeResponseId, nextScene }) => {
    const res = await fetch(`/api/threads/${encodeURIComponent(activeThreadKey)}/responses`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        responseId: activeResponseId,
        excalidrawScene: nextScene,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data?.message || `Failed to patch saved viewport (${res.status})`)
    }
    return data
  }, { activeThreadKey: threadKey, activeResponseId: responseId, nextScene: scene })
}

const waitForViewerInkBounds = async (viewer: Locator) => {
  let latestBounds: any = null
  await expect.poll(async () => {
    latestBounds = await getViewerInkBounds(viewer)
    return Number(latestBounds?.count || 0)
  }, { timeout: 30_000 }).toBeGreaterThan(80)
  return latestBounds
}

const assertViewerVisible = (bounds: any) => {
  expect(bounds).toBeTruthy()
  expect(Number(bounds?.count || 0)).toBeGreaterThan(80)
  expect(Number(bounds?.centerY || 0)).toBeGreaterThan(24)
  expect(Number(bounds?.centerY || 0)).toBeLessThan(Number(bounds?.canvasHeight || 0) - 24)
}

test.describe('post canvas viewport regression', () => {
  test.setTimeout(300_000)

  test('owned post reply canvases keep a stable saved viewport after zooming', async ({ browser }) => {
    const storageState = await createSignedInStorageState(browser)
    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      storageState,
    })
    const page = await context.newPage()

    const uniqueToken = `${Date.now()}`
    const uniqueTitle = `Canvas viewport regression ${uniqueToken}`
    const uniquePrompt = `Canvas viewport prompt ${uniqueToken}`
    const seedBase = Date.now()
    const rootBaseScene = buildCanvasScene(seedBase)
    const childBaseScene = buildCanvasScene(seedBase + 10)

    let createdPostId = ''
    let threadKey = ''
    let rootResponseId = ''
    let childResponseId = ''

    try {
      await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'domcontentloaded' })
      await ensureOnDashboard(page)

      const created = await page.evaluate(async ({ title, prompt, rootScene, childScene }) => {
        const profileRes = await fetch('/api/profile', { credentials: 'same-origin', cache: 'no-store' })
        const profileData = await profileRes.json().catch(() => ({}))
        const userId = typeof profileData?.id === 'string' ? profileData.id : ''
        const userName = typeof profileData?.name === 'string' && profileData.name.trim()
          ? profileData.name.trim()
          : (typeof profileData?.email === 'string' ? profileData.email.trim() : 'Learner')
        if (!profileRes.ok || !userId) {
          throw new Error(profileData?.message || `Failed to load active profile (${profileRes.status})`)
        }

        const createPostRes = await fetch('/api/posts', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            prompt,
            contentBlocks: [
              {
                id: 'text-block',
                type: 'text',
                text: prompt,
              },
            ],
            audience: 'public',
            maxAttempts: 3,
          }),
        })
        const createPostData = await createPostRes.json().catch(() => ({}))
        if (!createPostRes.ok) {
          throw new Error(createPostData?.message || `Failed to create post (${createPostRes.status})`)
        }

        const createdId = String(createPostData?.id || '')
        const nextThreadKey = `post:${createdId}`
        if (!createdId) {
          throw new Error('Missing created post id')
        }

        const submitReply = async (scene: any, replyThread?: { parentResponseId: string; rootResponseId: string; replyToUserId: string; replyToUserName: string }) => {
          const res = await fetch(`/api/threads/${encodeURIComponent(nextThreadKey)}/responses`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              quizId: nextThreadKey,
              quizLabel: 'Canvas viewport regression',
              prompt: 'Canvas viewport regression',
              excalidrawScene: scene,
              ...(replyThread || {}),
            }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) {
            throw new Error(data?.message || `Failed to submit reply (${res.status})`)
          }
          return data
        }

        const root = await submitReply(rootScene)
        const rootId = String(root?.id || '')
        if (!rootId) {
          throw new Error('Missing root response id')
        }

        const child = await submitReply(childScene, {
          parentResponseId: rootId,
          rootResponseId: rootId,
          replyToUserId: userId,
          replyToUserName: userName,
        })

        return {
          createdId,
          threadKey: nextThreadKey,
          rootResponseId: rootId,
          childResponseId: String(child?.id || ''),
        }
      }, { title: uniqueTitle, prompt: uniquePrompt, rootScene: rootBaseScene, childScene: childBaseScene })

      createdPostId = created.createdId
      threadKey = created.threadKey
      rootResponseId = created.rootResponseId
      childResponseId = created.childResponseId

      expect(createdPostId).toBeTruthy()
      expect(rootResponseId).toBeTruthy()
      expect(childResponseId).toBeTruthy()

      await page.reload({ waitUntil: 'domcontentloaded' })
      await ensureOnDashboard(page)

      const openProfileButton = page.getByRole('button', { name: /open your profile/i }).first()
      await expect(openProfileButton).toBeVisible({ timeout: 20_000 })
      await openProfileButton.click()

      const targetPost = page.locator(`article[data-post-id="${createdPostId}"]`).first()
      await expect(targetPost).toBeVisible({ timeout: 30_000 })

      const profileBody = targetPost.getByTestId('public-feed-post-body')
      await expect(profileBody).toHaveAttribute('aria-expanded', 'false')
      await profileBody.click()
      await expect(profileBody).toHaveAttribute('aria-expanded', 'true')

      const viewers = targetPost.locator('.philani-solution-viewer')
      await expect(viewers).toHaveCount(2, { timeout: 30_000 })

      const rootViewer = viewers.nth(0)
      const childViewer = viewers.nth(1)

      const rootBefore = await waitForViewerInkBounds(rootViewer)
      const childBefore = await waitForViewerInkBounds(childViewer)
      assertViewerVisible(rootBefore)
      assertViewerVisible(childBefore)

      const rootSavedScene = cloneScene(rootBaseScene)
      rootSavedScene.appState = {
        ...(rootSavedScene.appState || {}),
        zoom: 1.25,
        scrollX: -100,
        scrollY: -75,
      }
      rootSavedScene.updatedAt = new Date(seedBase + 100).toISOString()
      rootSavedScene.sceneMeta = {
        ...(rootSavedScene.sceneMeta || {}),
        lastObservedZoom: 1.25,
        viewerViewportPersisted: true,
      }

      const childSavedScene = cloneScene(childBaseScene)
      childSavedScene.appState = {
        ...(childSavedScene.appState || {}),
        zoom: 1.25,
        scrollX: -100,
        scrollY: -75,
      }
      childSavedScene.updatedAt = new Date(seedBase + 101).toISOString()
      childSavedScene.sceneMeta = {
        ...(childSavedScene.sceneMeta || {}),
        lastObservedZoom: 1.25,
        viewerViewportPersisted: true,
      }

      await patchResponseScene(page, threadKey, rootResponseId, rootSavedScene)
      await patchResponseScene(page, threadKey, childResponseId, childSavedScene)

      const savedRootScene = await fetchResponseScene(page, threadKey, rootResponseId)
      const savedChildScene = await fetchResponseScene(page, threadKey, childResponseId)
      expect(Boolean(savedRootScene?.sceneMeta?.viewerViewportPersisted)).toBe(true)
      expect(Boolean(savedChildScene?.sceneMeta?.viewerViewportPersisted)).toBe(true)
      expect(Number(getSceneZoom(savedRootScene).toFixed(2))).toBe(1.25)
      expect(Number(getSceneZoom(savedChildScene).toFixed(2))).toBe(1.25)

      await page.reload({ waitUntil: 'domcontentloaded' })
      await ensureOnDashboard(page)
      await expect(openProfileButton).toBeVisible({ timeout: 20_000 })
      await openProfileButton.click()
      await expect(targetPost).toBeVisible({ timeout: 30_000 })

      const reloadedBody = targetPost.getByTestId('public-feed-post-body')
      await expect(reloadedBody).toHaveAttribute('aria-expanded', 'false')
      await reloadedBody.click()
      await expect(reloadedBody).toHaveAttribute('aria-expanded', 'true')

      const reloadedViewers = targetPost.locator('.philani-solution-viewer')
      await expect(reloadedViewers).toHaveCount(2, { timeout: 30_000 })

      const rootReloaded = await waitForViewerInkBounds(reloadedViewers.nth(0))
      const childReloaded = await waitForViewerInkBounds(reloadedViewers.nth(1))

      assertViewerVisible(rootReloaded)
      assertViewerVisible(childReloaded)

      expect(Number(rootReloaded?.count || 0)).toBeLessThan(Number(rootBefore?.count || 0) * 0.95)
      expect(Number(childReloaded?.count || 0)).toBeLessThan(Number(childBefore?.count || 0) * 0.95)

      await page.reload({ waitUntil: 'domcontentloaded' })
      await ensureOnDashboard(page)
      await expect(openProfileButton).toBeVisible({ timeout: 20_000 })
      await openProfileButton.click()
      await expect(targetPost).toBeVisible({ timeout: 30_000 })

      const secondReloadBody = targetPost.getByTestId('public-feed-post-body')
      await expect(secondReloadBody).toHaveAttribute('aria-expanded', 'false')
      await secondReloadBody.click()
      await expect(secondReloadBody).toHaveAttribute('aria-expanded', 'true')

      const secondReloadedViewers = targetPost.locator('.philani-solution-viewer')
      await expect(secondReloadedViewers).toHaveCount(2, { timeout: 30_000 })

      const rootSecondReload = await waitForViewerInkBounds(secondReloadedViewers.nth(0))
      const childSecondReload = await waitForViewerInkBounds(secondReloadedViewers.nth(1))

      assertViewerVisible(rootSecondReload)
      assertViewerVisible(childSecondReload)
      expect(Math.abs(Number(rootSecondReload?.centroidX || 0) - Number(rootReloaded?.centroidX || 0))).toBeLessThan(Number(rootSecondReload?.canvasWidth || 0) * 0.04)
      expect(Math.abs(Number(childSecondReload?.centroidX || 0) - Number(childReloaded?.centroidX || 0))).toBeLessThan(Number(childSecondReload?.canvasWidth || 0) * 0.04)
      expect(Math.abs(Number(rootSecondReload?.centroidY || 0) - Number(rootReloaded?.centroidY || 0))).toBeLessThan(Number(rootSecondReload?.canvasHeight || 0) * 0.04)
      expect(Math.abs(Number(childSecondReload?.centroidY || 0) - Number(childReloaded?.centroidY || 0))).toBeLessThan(Number(childSecondReload?.canvasHeight || 0) * 0.04)
      expect(Math.abs(Number(rootSecondReload?.count || 0) - Number(rootReloaded?.count || 0))).toBeLessThan(Number(rootReloaded?.count || 0) * 0.08)
      expect(Math.abs(Number(childSecondReload?.count || 0) - Number(childReloaded?.count || 0))).toBeLessThan(Number(childReloaded?.count || 0) * 0.08)
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