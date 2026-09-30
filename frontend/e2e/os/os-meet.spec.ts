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
    const savedWindows = await page.evaluate(() => Object.keys(localStorage)
        .filter((key) => key.startsWith('memba_os_windows'))
        .map((key) => localStorage.getItem(key) ?? '').join('\n'))
    expect(savedWindows).not.toContain(code)
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

test('Window › Full screen shows the live iframe when the room is in front', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 760 })
    const iframe = await startMeeting(page)
    await expect(iframe).toBeVisible()
    await page.getByRole('banner', { name: 'Menu bar' }).getByRole('button', { name: 'Window', exact: true }).click()
    await page.getByRole('menuitem', { name: /^Full screen/ }).click()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe('IFRAME')
    await page.evaluate(() => document.exitFullscreen())
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
    await expect(iframe).toBeVisible()
})

test('another window going full screen does not cover a live meeting', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 760 })
    const iframe = await startMeeting(page)
    await page.getByRole('navigation', { name: 'Dock' }).getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('region', { name: 'Settings', exact: true })).toBeVisible()
    const player = page.getByRole('region', { name: /^Meeting [a-z]{3}-[a-z]{4}-[a-z]{3} is still open$/ })
    await expect(player).toBeVisible()
    await page.evaluate(() => {
        const seen = window as Window & { fullscreenChanges?: number }
        seen.fullscreenChanges = 0
        document.addEventListener('fullscreenchange', () => { seen.fullscreenChanges = (seen.fullscreenChanges ?? 0) + 1 })
    })
    await page.getByRole('banner', { name: 'Menu bar' }).getByRole('button', { name: 'Window', exact: true }).click()
    await page.getByRole('menuitem', { name: /^Full screen/ }).click()
    // Settings did go full screen (without that the rest proves nothing), then the meeting took the screen back.
    await expect.poll(() => page.evaluate(() => (window as Window & { fullscreenChanges?: number }).fullscreenChanges)).toBeGreaterThan(0)
    await expect.poll(() => page.evaluate(() => {
        const element = document.fullscreenElement
        return element === null || element === document.querySelector('.meet-stage iframe')
    })).toBe(true)
    await expect(player).toBeVisible()
    await expect(iframe).toBeVisible()
})

test('a meeting that fills the screen stays visible when another window takes the front and a dialog opens', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 760 })
    const iframe = await startMeeting(page)
    await page.getByRole('navigation', { name: 'Dock' }).getByRole('button', { name: 'Settings' }).click()
    const player = page.getByRole('region', { name: /^Meeting [a-z]{3}-[a-z]{4}-[a-z]{3} is still open$/ })
    await player.getByRole('button', { name: 'Restore' }).click()
    await expect(player).toHaveCount(0)
    await page.keyboard.press('Alt+f')
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe('IFRAME')
    // The next window comes to the front behind the full-screen meeting, then search opens over it:
    // the player's compact form hides its video, but not a video that is the full-screen element.
    await page.keyboard.press('Alt+Backquote')
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog', { name: 'Search and commands' })).toBeAttached()
    expect(await page.evaluate(() => document.fullscreenElement?.tagName)).toBe('IFRAME')
    expect(await iframe.evaluate((element) => getComputedStyle(element).visibility)).toBe('visible')
    expect((await iframe.boundingBox())!.height).toBeGreaterThan(300)
})

test('full screen taken back from another window is explained, and Escape on Leave closes the dialog', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 760 })
    await startMeeting(page)
    await page.getByRole('navigation', { name: 'Dock' }).getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('region', { name: 'Settings', exact: true })).toBeVisible()
    await page.keyboard.press('Alt+f')
    await expect(page.getByText("Another window can't take full screen while a meeting is live here.")).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()

    // Search open: Leave is in its Tab cycle, and Escape pressed on Leave closes search.
    await page.keyboard.press('Control+k')
    const search = page.getByRole('dialog', { name: 'Search and commands' })
    await expect(search).toBeVisible()
    const leave = page.getByRole('region', { name: /^Meeting / }).getByRole('button', { name: 'Leave' })
    await page.keyboard.press('Shift+Tab')
    await expect(leave).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(search).toHaveCount(0)
    await expect(page.locator('.meet-stage iframe')).toHaveCount(1)
})

test('Restore brings a room that was pushed off the desk back where it can be seen', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 760 })
    const iframe = await startMeeting(page)
    // Moved with the keyboard until only its edge is left on the desk: too little of the room to count as shown.
    const title = page.locator('.os-win[data-win="app:meet"] .os-tb-title')
    await title.focus()
    for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight')
    const player = page.getByRole('region', { name: /^Meeting [a-z]{3}-[a-z]{4}-[a-z]{3} is still open$/ })
    await expect(player).toBeVisible()
    await player.getByRole('button', { name: 'Restore' }).click()
    await expect(player).toHaveCount(0)
    const room = (await page.locator('.meet-viewport').boundingBox())!
    expect(room.x).toBeGreaterThanOrEqual(0)
    expect(room.x + room.width).toBeLessThanOrEqual(1100)
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

test('a meeting behind another window stays on screen in the small player, and Leave ends it', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 760 })
    const iframe = await startMeeting(page)
    await iframe.evaluate((element) => { (element as HTMLIFrameElement & { keep?: boolean }).keep = true })
    await page.getByRole('navigation', { name: 'Dock' }).getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('region', { name: 'Settings', exact: true })).toBeVisible()
    const player = page.getByRole('region', { name: /^Meeting [a-z]{3}-[a-z]{4}-[a-z]{3} is still open$/ })
    await expect(player).toBeVisible()
    await expect(iframe).toBeVisible()
    expect(await iframe.evaluate((element) => (element as HTMLIFrameElement & { keep?: boolean }).keep)).toBe(true)
    // The player is not under the window that covers the room.
    const box = (await player.boundingBox())!
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.meet-stage') !== null, [box.x + box.width / 2, box.y + 10])).toBe(true)

    await player.getByRole('button', { name: 'Restore' }).click()
    await expect(player).toHaveCount(0)
    await expect(iframe).toBeVisible()

    await page.getByRole('navigation', { name: 'Dock' }).getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('region', { name: /^Meeting / }).getByRole('button', { name: 'Leave' }).click()
    await expect(page.locator('.meet-stage')).toHaveCount(0)
    await expect(page.locator('.os-win[data-win="app:meet"]')).toHaveCount(0)
})

test('under a dialog the player shrinks to a label and Leave, clear of the dialog', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await startMeeting(page)
    // The room sheet is in front; its own Connect button opens the dialog over it.
    await page.getByRole('region', { name: 'Meet' }).getByRole('button', { name: 'Connect', exact: true }).click()
    const player = page.getByRole('region', { name: /^Meeting [a-z]{3}-[a-z]{4}-[a-z]{3} is still open$/ })
    const dialog = page.getByRole('dialog', { name: 'Connect a wallet' })
    await expect(dialog).toBeVisible()
    await expect(player.getByRole('button', { name: 'Leave' })).toBeVisible()
    await expect(player.getByRole('button', { name: 'Restore' })).toBeHidden()
    const bar = (await player.boundingBox())!
    const box = (await dialog.boundingBox())!
    expect(bar.height).toBeLessThanOrEqual(40)
    // No overlap: the label sits above the dialog.
    expect(bar.y + bar.height).toBeLessThanOrEqual(box.y)
    // The call is still there: the same iframe, not removed.
    await expect(page.locator('.meet-stage iframe')).toHaveCount(1)

    // Keyboard: Leave follows the dialog's last control, and the dialog's first control follows Leave.
    const leave = player.getByRole('button', { name: 'Leave' })
    const first = dialog.getByRole('button', { name: /Adena/ })
    const last = dialog.getByRole('button', { name: 'Not now' })
    await last.focus()
    await page.keyboard.press('Tab')
    await expect(leave).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(first).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(leave).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(last).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(first).toBeFocused()
})

test('with the room in front the launcher turns the call into the small player, as Settings\' reset dialog does; Leave gives focus back to the dialog', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await startMeeting(page)
    const stage = page.locator('.meet-stage')
    await expect(stage).not.toHaveClass(/meet-stage-pip/)
    const player = page.getByRole('region', { name: /^Meeting [a-z]{3}-[a-z]{4}-[a-z]{3} is still open$/ })

    // The launcher over the room in front.
    await page.keyboard.press('ControlOrMeta+k')
    const search = page.getByRole('dialog', { name: 'Search and commands' })
    await expect(search).toBeVisible()
    await expect(stage).toHaveClass(/meet-stage-pip/)
    await expect(player.getByRole('button', { name: 'Leave' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(search).toHaveCount(0)
    await expect(stage).not.toHaveClass(/meet-stage-pip/)

    // Settings' reset dialog (a native modal one, opened from Settings in front): the player shrinks to the label too.
    await page.getByRole('button', { name: 'Search (⌘K)' }).click()
    await search.getByRole('combobox', { name: 'Search' }).fill('settings')
    await page.keyboard.press('Enter')
    const settings = page.getByRole('region', { name: 'Settings', exact: true })
    await settings.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Safety' }).click()
    await expect(player.getByRole('button', { name: 'Restore' })).toBeVisible()
    await settings.getByRole('button', { name: 'Reset local app data' }).click()
    await expect(page.getByRole('dialog', { name: 'Reset local app data' })).toBeVisible()
    await expect(player.getByRole('button', { name: 'Restore' })).toBeHidden()
    expect((await player.boundingBox())!.height).toBeLessThanOrEqual(40)
    await page.keyboard.press('Escape')
    await expect(player.getByRole('button', { name: 'Restore' })).toBeVisible()
    await player.getByRole('button', { name: 'Restore' }).click()
    await expect(stage).not.toHaveClass(/meet-stage-pip/)

    // Leave pressed over the launcher: the call ends and the launcher keeps the keyboard.
    await page.keyboard.press('ControlOrMeta+k')
    await expect(search).toBeVisible()
    await player.getByRole('button', { name: 'Leave' }).click()
    await expect(page.locator('.meet-stage iframe')).toHaveCount(0)
    await expect(search.getByRole('combobox', { name: 'Search' })).toBeFocused()
})

test('on a phone, Restore brings the room back over Notifications and All apps', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await startMeeting(page)
    const room = page.getByRole('region', { name: 'Meet', exact: true })
    const player = page.getByRole('region', { name: /^Meeting [a-z]{3}-[a-z]{4}-[a-z]{3} is still open$/ })
    await expect(room).toBeVisible()

    await page.getByRole('button', { name: /^Notifications/ }).click()
    await expect(page.getByRole('region', { name: 'Notifications' })).toBeVisible()
    await player.getByRole('button', { name: 'Restore' }).click()
    await expect(room).toBeVisible()
    await expect(player).toHaveCount(0)

    await page.getByRole('button', { name: '‹ Home' }).click()
    await page.getByRole('button', { name: /All apps/ }).click()
    await expect(page.getByRole('region', { name: 'All apps' })).toBeVisible()
    await player.getByRole('button', { name: 'Restore' }).click()
    await expect(room).toBeVisible()
    await expect(player).toHaveCount(0)
    await expect(page.locator('.meet-stage iframe')).toHaveCount(1)
})

test('locking Memba ends the meeting: no call survives behind the lock screen', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 760 })
    await startMeeting(page)
    await page.getByRole('button', { name: 'Memba menu' }).click()
    await page.getByRole('menuitem', { name: 'Lock screen' }).click()
    await expect(page.getByRole('dialog', { name: 'Welcome to Memba' })).toBeVisible()
    await expect(page.locator('.meet-stage')).toHaveCount(0)
    await expect(page.locator('iframe[src*="visio.samourai.app"]')).toHaveCount(0)
})

