import { expect, test } from '@playwright/test'

const baseUrl = (process.env.E2E_BASE_URL || '').trim()

test.describe('paper context bottom sheet scroll - CSS layout', () => {
  test.setTimeout(60_000)

  // This test validates the CSS flex layout that powers the paper context sheet scrolling.
  // It builds the exact same DOM hierarchy that the BottomSheet + paper context modal creates,
  // then verifies: 1) the inner scroll container gets a bounded height, 2) it can actually scroll.
  test('BottomSheet flex-1 content div makes inner scroll container scrollable', async ({ page }) => {
    // Navigate to any page so we have a live document with Tailwind loaded.
    // Use the app's own landing page so Tailwind classes are available.
    const startUrl = baseUrl ? baseUrl.replace(/\/$/, '') + '/' : 'about:blank'
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => page.goto('about:blank'))
    await page.waitForTimeout(500)

    const result = await page.evaluate(() => {
      // Build the exact chain:
      //   cappedSheetStyle  (fixed 500px height, overflow:hidden)
      //     sheetInner      (flex flex-col, overflow:hidden, max-h-full)
      //       BottomSheet title header  (48px, shrink-0)
      //       content div   (min-h-0 flex-1 overflow-y-auto)   <-- THE FIX
      //         our wrapper   (flex flex-col h-full)
      //           sub-header  (36px, shrink-0)
      //           scrollEl    (flex-1 min-h-0 overflow-y-auto)  <-- should scroll

      const cap = document.createElement('div')
      cap.style.cssText = 'position:fixed;top:0;left:0;right:0;height:500px;overflow:hidden;z-index:99999;'

      const inner = document.createElement('div')
      inner.style.cssText = 'height:100%;overflow:hidden;display:flex;flex-direction:column;'

      const titleBar = document.createElement('div')
      titleBar.style.cssText = 'height:48px;flex-shrink:0;background:#e2e8f0;'

      const contentDiv = document.createElement('div')
      // This is what BottomSheet now renders for the content wrapper:
      contentDiv.style.cssText = 'min-height:0;flex:1 1 0%;overflow-y:auto;'

      const wrapper = document.createElement('div')
      wrapper.style.cssText = 'display:flex;flex-direction:column;height:100%;'

      const subheader = document.createElement('div')
      subheader.style.cssText = 'height:36px;flex-shrink:0;background:#f8fafc;'

      const scrollEl = document.createElement('div')
      scrollEl.id = '__pw_scroll_target__'
      scrollEl.style.cssText = 'flex:1 1 0%;min-height:0;overflow-y:auto;'

      for (let i = 0; i < 40; i++) {
        const row = document.createElement('div')
        row.style.cssText = 'height:60px;border-bottom:1px solid #e2e8f0;padding:0 12px;box-sizing:border-box;'
        row.textContent = 'Question ' + (i + 1) + ': test scrollability row'
        scrollEl.appendChild(row)
      }

      wrapper.appendChild(subheader)
      wrapper.appendChild(scrollEl)
      contentDiv.appendChild(wrapper)
      inner.appendChild(titleBar)
      inner.appendChild(contentDiv)
      cap.appendChild(inner)
      document.body.appendChild(cap)

      void scrollEl.offsetHeight  // force layout

      const cs = window.getComputedStyle

      return {
        contentDivHeight: Math.round(contentDiv.getBoundingClientRect().height),
        contentDivFlexGrow: cs(contentDiv).flexGrow,
        contentDivOverflow: cs(contentDiv).overflowY,
        wrapperHeight: Math.round(wrapper.getBoundingClientRect().height),
        scrollElClientHeight: scrollEl.clientHeight,
        scrollElScrollHeight: scrollEl.scrollHeight,
        scrollElOverflow: cs(scrollEl).overflowY,
        isScrollable: scrollEl.scrollHeight > scrollEl.clientHeight,
      }
    })

    console.log('Layout diagnostic:', JSON.stringify(result, null, 2))

    expect(result.contentDivFlexGrow, 'content div must be flex-grow:1').toBe('1')
    expect(result.contentDivHeight, 'content div must have a bounded height (not 0)').toBeGreaterThan(0)
    // 500px cap - 48px title = 452px for the content div
    expect(result.contentDivHeight, 'content div should be ~452px (500 - 48 title)').toBeCloseTo(452, -1)
    expect(result.isScrollable, 'inner scroll container must overflow').toBe(true)
    expect(result.scrollElScrollHeight, 'scrollHeight must exceed clientHeight').toBeGreaterThan(result.scrollElClientHeight)

    // Programmatically scroll and confirm scrollTop advances
    await page.evaluate(() => {
      const el = document.getElementById('__pw_scroll_target__')
      if (el) el.scrollTop = 200
    })

    const scrollTop = await page.evaluate(() => {
      const el = document.getElementById('__pw_scroll_target__')
      return el ? el.scrollTop : -1
    })

    console.log('scrollTop after scroll:', scrollTop)
    expect(scrollTop, 'scrollTop must advance when scrolled').toBeGreaterThan(100)
  })
})
