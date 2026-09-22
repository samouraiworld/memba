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
