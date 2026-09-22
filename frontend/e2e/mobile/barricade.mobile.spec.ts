import { expect, test, type Page } from '@playwright/test'

test.use({ baseURL: 'http://localhost:5174' })

const gameURL = '/pearl/game/barricade'

async function expectControlsInView(page: Page) {
  const layout = await page.evaluate(() => {
    const stage = document.querySelector('.bar-stage')!.getBoundingClientRect()
    const controls = document.querySelector('.bar-controls')!.getBoundingClientRect()
    const tabbar = document.querySelector('.k-mobile-tabbar')!.getBoundingClientRect()
    return {
      stageBottom: stage.bottom,
      controlsTop: controls.top,
      controlsBottom: controls.bottom,
      availableBottom: tabbar.height ? tabbar.top : innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    }
  })
  expect(layout.stageBottom).toBeLessThanOrEqual(layout.availableBottom)
  expect(layout.controlsTop).toBeGreaterThanOrEqual(0)
  expect(layout.controlsBottom).toBeLessThanOrEqual(layout.availableBottom)
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1)
}

test('keeps start and live controls alongside the battlefield on portrait phones', async ({ page }) => {
  for (const [width, height] of [[390, 844], [375, 667], [320, 568]]) {
    await page.setViewportSize({ width, height })
    await page.goto(gameURL, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: 'Daily run' })).toBeVisible()
    await expect(page.locator('.bar-shell')).toHaveAttribute('data-renderer', '2d')
    await expectControlsInView(page)

    await page.getByRole('button', { name: 'Daily run' }).click()
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
    await expectControlsInView(page)
    for (const button of await page.locator('.bar-controls--playing > button').all()) {
      const box = await button.boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
      expect(box!.width).toBeGreaterThanOrEqual(44)
    }
  }
})

test('keeps mainnet start controls clear of the notice and mobile navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/mainnet/game/barricade', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'Daily run' })).toBeVisible()
  await expectControlsInView(page)
})

test('keeps a short landscape game and its actions visible', async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 })
  await page.goto(gameURL, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('link', { name: 'Exit game' })).toBeVisible()
  await expectControlsInView(page)
  await page.getByRole('button', { name: 'Daily run' }).click()
  await expectControlsInView(page)
  await page.getByRole('link', { name: 'Exit game' }).click()
  await expect(page).toHaveURL(/\/pearl\/?$/)
})
