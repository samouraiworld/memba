import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.use({ baseURL: 'http://localhost:5174' })

async function gameURL(page: Page) {
  await page.goto('/')
  await page.waitForURL(/\/\w+\/$/)
  const network = new URL(page.url()).pathname.match(/^\/(\w+)\//)?.[1]
  expect(network).toBeTruthy()
  return `/${network}/game/barricade`
}

test('focuses the playfield, moves by keyboard, and pauses without advancing play', async ({ page }) => {
  await page.goto(await gameURL(page))
  await page.getByRole('button', { name: 'Daily run' }).click()
  const stage = page.getByRole('group', { name: 'Barricade playfield' })
  await expect(stage).toBeFocused()
  await stage.press('ArrowRight')
  await expect(page.locator('.bar-sr-only[role="status"]')).toContainText('Lane 2')
  await stage.press('m')
  await expect(page.getByText(/Keyboard: lane 2/)).toBeVisible()
  await stage.press('ArrowRight')
  await expect(page.getByText(/Keyboard: lane 3/)).toBeVisible()
  await stage.press('ArrowUp')
  await expect(page.getByText(/range 40%/)).toBeVisible()
  await stage.press('Enter')
  await expect(page.getByText(/Keyboard: lane 3/)).toBeHidden()

  await stage.press('p')
  await expect(page.getByText('Run paused')).toBeVisible()
  const before = await page.locator('.bar-canvas').screenshot()
  await page.waitForTimeout(350)
  const after = await page.locator('.bar-canvas').screenshot()
  expect(after.equals(before)).toBe(true)

  await stage.press('p')
  await expect(page.getByText('Run paused')).toBeHidden()
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(page.getByText('Run paused')).toBeVisible()
  await page.getByRole('button', { name: 'Resume run' }).click()
  await expect(stage).toBeFocused()
})

test('has no serious or critical accessibility findings in the ready game', async ({ page }) => {
  await page.goto(await gameURL(page))
  await expect(page.getByRole('button', { name: 'Daily run' })).toBeVisible()
  const results = await new AxeBuilder({ page })
    .include('.bar-shell')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const blocking = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
  expect(blocking, blocking.map(v => `${v.id}: ${v.help}`).join('\n')).toHaveLength(0)
})

test('keeps every between-wave choice on the battlefield above phone navigation', async ({ page }) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/pearl/game/barricade')
  await page.getByRole('button', { name: 'Daily run' }).click()
  const shop = page.getByRole('group', { name: 'Between-wave shop' })
  await expect(shop).toBeVisible({ timeout: 60000 })
  const shopAxe = await new AxeBuilder({ page })
    .include('.bar-shell')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(shopAxe.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')).toHaveLength(0)
  const layout = await page.evaluate(() => ({
    shopTop: document.querySelector('.bar-shop')!.getBoundingClientRect().top,
    tabTop: document.querySelector('.k-mobile-tabbar')!.getBoundingClientRect().top,
    buttons: [...document.querySelectorAll('.bar-shop button')].map(button => {
      const box = button.getBoundingClientRect()
      return { top: box.top, bottom: box.bottom, height: box.height }
    }),
  }))
  expect(layout.shopTop).toBeGreaterThan(0)
  expect(layout.buttons).toHaveLength(6)
  for (const button of layout.buttons) {
    expect(button.top).toBeGreaterThanOrEqual(layout.shopTop)
    expect(button.bottom).toBeLessThan(layout.tabTop)
    expect(button.height).toBeGreaterThanOrEqual(44)
  }
  await shop.getByRole('button', { name: /Patch/ }).click()
  await expect(shop.getByRole('button', { name: /Patch/ })).toBeHidden()
  await shop.getByRole('button', { name: /To the wall/ }).click()
  await expect(shop).toBeHidden()

  const deadline = Date.now() + 100000
  while (!(await page.locator('.bar-poster').isVisible()) && Date.now() < deadline) {
    const continueButton = shop.getByRole('button', { name: /To the wall/ })
    if (await continueButton.isVisible()) await continueButton.click()
    await page.waitForTimeout(500)
  }
  const poster = page.locator('.bar-poster')
  await expect(poster).toBeVisible()
  await expect(poster.getByRole('heading', { name: /THE LINE/ })).toBeFocused()
  const resultAxe = await new AxeBuilder({ page })
    .include('.bar-shell')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(resultAxe.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')).toHaveLength(0)
  const resultLayout = await page.evaluate(() => ({
    stageVisible: document.querySelector('.bar-stage')!.getBoundingClientRect().height > 0,
    posterBottom: document.querySelector('.bar-poster')!.getBoundingClientRect().bottom,
    tabTop: document.querySelector('.k-mobile-tabbar')!.getBoundingClientRect().top,
  }))
  expect(resultLayout.stageVisible).toBe(false)
  expect(resultLayout.posterBottom).toBeLessThan(resultLayout.tabTop)
})

test('fits the shop on compact portrait and landscape screens', async ({ page }) => {
  test.setTimeout(120000)
  for (const [width, height] of [[320, 568], [667, 375], [667, 500]]) {
    await page.setViewportSize({ width, height })
    await page.goto('/pearl/game/barricade')
    await page.getByRole('button', { name: 'Daily run' }).click()
    await expect(page.getByRole('group', { name: 'Between-wave shop' })).toBeVisible({ timeout: 60000 })
    const layout = await page.evaluate(() => {
      const shop = document.querySelector('.bar-shop')!.getBoundingClientRect()
      const stage = document.querySelector('.bar-stage')!.getBoundingClientRect()
      return {
        shop: { left: shop.left, right: shop.right, top: shop.top, bottom: shop.bottom },
        stageRight: stage.right,
        buttons: [...document.querySelectorAll('.bar-shop button')].map(button => {
          const box = button.getBoundingClientRect()
          return { width: box.width, height: box.height }
        }),
        scrollWidth: document.documentElement.scrollWidth,
      }
    })
    expect(layout.shop.left).toBeGreaterThanOrEqual(0)
    expect(layout.shop.right).toBeLessThanOrEqual(width)
    expect(layout.shop.top).toBeGreaterThanOrEqual(0)
    expect(layout.shop.bottom).toBeLessThanOrEqual(height)
    expect(layout.scrollWidth).toBeLessThanOrEqual(width + 1)
    expect(layout.buttons).toHaveLength(6)
    for (const button of layout.buttons) {
      expect(button.width).toBeGreaterThanOrEqual(44)
      expect(button.height).toBeGreaterThanOrEqual(44)
    }
    if (width > height) expect(layout.shop.left).toBeGreaterThan(layout.stageRight)
  }
})
