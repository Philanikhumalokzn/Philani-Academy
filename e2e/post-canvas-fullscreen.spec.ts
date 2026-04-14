import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'

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

const getWindowScrollY = async (page: Page) => {
  return page.evaluate(() => window.scrollY)
}

const wheelOverLocator = async (page: Page, target: Locator, deltaY: number) => {
  const box = await target.boundingBox()
  if (!box) throw new Error('Missing target bounding box for wheel interaction')
  await page.mouse.move(box.x + (box.width / 2), box.y + (box.height / 2))
  await page.mouse.wheel(0, deltaY)
}

const buildPersistedCanvasScene = (seed: number) => ({
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
    zoom: 1.25,
    scrollX: -100,
    scrollY: -75,
  },
  files: {},
  updatedAt: new Date(seed).toISOString(),
  sceneMeta: {
    version: 1,
    baselineSegmentId: null,
    activeSegmentId: null,
    guideSpacing: null,
    lastObservedZoom: 1.25,
    viewerViewportPersisted: true,
    viewerViewportCenterX: 168,
    viewerViewportCenterY: 148,
    viewerViewportZoom: 1.25,
    segments: [],
  },
})

test.describe('post canvas fullscreen overlay', () => {
  test.setTimeout(300_000)

  test('fullscreen post canvas viewer shows ink and keeps background scroll locked', async ({ browser }) => {
    const storageState = await createSignedInStorageState(browser)
    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      storageState,
    })
    const page = await context.newPage()

    const uniqueToken = `${Date.now()}`
    const uniqueTitle = `Fullscreen canvas ${uniqueToken}`
    const seededScene = buildPersistedCanvasScene(Date.now())

    let createdPostId = ''
    let activeProfileId = ''

    try {
      await page.goto(toAbsoluteUrl('/dashboard'), { waitUntil: 'domcontentloaded' })

      const created = await page.evaluate(async ({ title, scene }) => {
        const profileRes = await fetch('/api/profile', { credentials: 'same-origin', cache: 'no-store' })
        const profileData = await profileRes.json().catch(() => ({}))
        const userId = typeof profileData?.id === 'string' ? profileData.id : ''
        if (!profileRes.ok || !userId) {
          throw new Error(profileData?.message || `Failed to load active profile (${profileRes.status})`)
        }

        const blocks = [
          {
            id: 'canvas-block',
            type: 'canvas',
            scene,
          },
        ]

        const createRes = await fetch('/api/posts', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            prompt: '',
            imageUrl: null,
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
          userId,
        }
      }, { title: uniqueTitle, scene: seededScene })

      createdPostId = created.createdId
      activeProfileId = created.userId

      expect(createdPostId).toBeTruthy()
      expect(activeProfileId).toBeTruthy()

      await page.goto(toAbsoluteUrl(`/u/${encodeURIComponent(activeProfileId)}`), { waitUntil: 'domcontentloaded' })

      const targetPost = page.locator(`[data-post-id="${createdPostId}"]`).first()
      await expect(targetPost).toBeVisible({ timeout: 30_000 })
      await expect(targetPost).toContainText(uniqueTitle)

      const inlineViewer = targetPost.locator('.philani-solution-viewer').first()
      await expect(inlineViewer).toBeVisible({ timeout: 20_000 })

      const inlineBounds = await waitForViewerInkBounds(inlineViewer)
      assertViewerVisible(inlineBounds)

      const snapshotButton = inlineViewer.locator('xpath=ancestor::button[1]').first()
      await expect(snapshotButton).toBeVisible({ timeout: 20_000 })

      const scrollBeforeOverlayOpen = await getWindowScrollY(page)
      await snapshotButton.click()

      const fullscreenCanvasOverlay = page.getByTestId('zoomable-canvas-overlay')
      await expect(fullscreenCanvasOverlay).toBeVisible({ timeout: 20_000 })

      const fullscreenCanvasViewer = page.getByTestId('zoomable-canvas-viewer').locator('.philani-solution-viewer').first()
      await expect(fullscreenCanvasViewer).toBeVisible({ timeout: 20_000 })

      const fullscreenBounds = await waitForViewerInkBounds(fullscreenCanvasViewer)
      assertViewerVisible(fullscreenBounds)

      await wheelOverLocator(page, page.getByTestId('zoomable-canvas-surface'), 900)
      await expect.poll(async () => getWindowScrollY(page), { timeout: 10_000 }).toBe(scrollBeforeOverlayOpen)

      await page.getByRole('button', { name: 'Close canvas viewer' }).click()
      await expect(fullscreenCanvasOverlay).toBeHidden({ timeout: 20_000 })
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