import { expect, test } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'

test.beforeEach(async ({ page }) => {
    await page.route(/visio\.samourai\.app|plausible\.io|sentry\.|clerk[.-]|\.gno\.land/, (route) => route.abort())
    await page.addInitScript(() => localStorage.setItem('memba_os_seen', '1'))
})

async function startMeeting(page: import('@playwright/test').Page) {
    await page.goto(`${OS_ON}/os/meet`)
    await page.getByRole('button', { name: 'New meeting' }).click()
    const iframe = page.locator('.meet-stage iframe')
    await expect(iframe).toHaveAttribute('src', /^https:\/\/visio\.samourai\.app\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/)
    expect(page.url()).toBe(`${OS_ON}/os/meet`)
    const code = (await iframe.getAttribute('src'))!.split('/').at(-1)!
    expect(await page.evaluate(() => localStorage.getItem('memba_os_windows'))).not.toContain(code)
    return iframe
}

test('resizing across the phone breakpoint keeps the same meeting iframe', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 760 })
    const iframe = await startMeeting(page)
    await iframe.evaluate((element) => { (element as HTMLIFrameElement & { keep?: boolean }).keep = true })
    await page.setViewportSize({ width: 600, height: 760 })
    await expect(page.getByRole('region', { name: 'Meet' })).toBeVisible()
    expect(await iframe.evaluate((element) => (element as HTMLIFrameElement & { keep?: boolean }).keep)).toBe(true)
    await page.setViewportSize({ width: 1100, height: 760 })
    await expect(page.locator('.os-win[data-win="app:meet"]')).toBeVisible()
    expect(await iframe.evaluate((element) => (element as HTMLIFrameElement & { keep?: boolean }).keep)).toBe(true)
})

test('the meeting stage follows window animation without pointer movement', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 760 })
    await startMeeting(page)
    await page.waitForTimeout(350)
    await page.addStyleTag({ content: '@keyframes meet-test-shift { to { transform: translateX(80px) } } .meet-test-shift { animation: meet-test-shift 220ms forwards !important; }' })
    await page.locator('.os-win[data-win="app:meet"]').evaluate((element) => element.classList.add('meet-test-shift'))
    // Do not move the pointer: animation events must keep the fixed iframe aligned.
    await page.waitForTimeout(300)
    const slot = await page.locator('.meet-viewport').boundingBox()
    const stage = await page.locator('.meet-stage').boundingBox()
    expect(slot).not.toBeNull()
    expect(stage).not.toBeNull()
    expect(Math.abs(stage!.x - slot!.x)).toBeLessThan(2)
    expect(Math.abs(stage!.y - slot!.y)).toBeLessThan(2)
    expect(Math.abs(stage!.width - slot!.width)).toBeLessThan(2)
    expect(Math.abs(stage!.height - slot!.height)).toBeLessThan(2)
})

test('the Meet fullscreen shortcut shows the live iframe', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 760 })
    const iframe = await startMeeting(page)
    await expect(iframe).toBeVisible()
    await page.keyboard.press('Alt+f')
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe('IFRAME')
    await page.keyboard.press('Alt+f')
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
    await expect(iframe).toBeVisible()
})

test('scrolling a short phone sheet does not cover Home with the meeting iframe', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 600 })
    const iframe = await startMeeting(page)
    const scroller = page.locator('.os-ph-sheet-b')
    await expect(iframe).toBeVisible()
    await scroller.evaluate((element) => { element.scrollTop = 190 })
    await expect.poll(() => page.locator('.meet-stage').evaluate((element) => getComputedStyle(element).clipPath)).not.toBe('none')
    await page.getByRole('button', { name: '‹ Home' }).click()
    await expect(page.getByRole('main', { name: 'Home' })).toBeVisible()
    await expect(iframe).toBeVisible() // minimised meeting continues in PiP
})
