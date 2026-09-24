import { expect, test, type Page } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'

// Day 3: the window manager, URL sync both ways, the saved session and
// desktop items. Guest sessions past the lock screen; no chain involved.

async function offline(page: Page) {
    await page.route(/memba\.v1\.|\.gno\.land|samourai\.live|onbloc\.xyz|gnolove|plausible\.io|sentry\.|clerk[.-]/, (route) => {
        const url = route.request().url()
        const host = new URL(url).hostname
        if ((host === '127.0.0.1' || host === 'localhost') && !/memba\.v1\./.test(url)) return route.continue()
        return route.abort()
    })
}

const win = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const dock = (page: Page) => page.getByRole('navigation', { name: 'Dock' })
const bar = (page: Page) => page.getByRole('banner', { name: 'Menu bar' })
const path = (page: Page) => new URL(page.url()).pathname + new URL(page.url()).search
/** Windows pop in with a short scale animation; measure after it. */
const settled = async (page: Page, name: string) => {
    const w = win(page, name)
    await w.waitFor()
    await w.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    return w
}

test.describe('Memba OS windows', () => {
    test.beforeEach(async ({ page }) => {
        await offline(page)
        await page.addInitScript(() => localStorage.setItem('memba_os_seen', '1'))
        await page.setViewportSize({ width: 1280, height: 800 })
    })

    test('done-when: reloading a link with ?w= restores both windows, the linked one in front', async ({ page }) => {
        await page.goto(`${OS_ON}/os/dao/memba_dao/proposals/12?w=app.feed`)
        await expect(win(page, 'memba_dao · Proposal #12')).toBeVisible()
        await expect(win(page, 'Feed')).toBeVisible()
        await page.reload()
        await expect(win(page, 'memba_dao · Proposal #12')).not.toHaveClass(/os-inactive/)
        await expect(win(page, 'Feed')).toHaveClass(/os-inactive/)
        expect(path(page)).toBe('/os/dao/memba_dao/proposals/12?w=app.feed')
    })

    test('the address bar follows the windows; ⌥W closes, ⌥` cycles', async ({ page }) => {
        await page.goto(`${OS_ON}/os`)
        await dock(page).getByRole('button', { name: 'Wallet' }).click()
        await expect.poll(() => path(page)).toBe('/os/wallet')
        await dock(page).getByRole('button', { name: 'Feed' }).click()
        await expect.poll(() => path(page)).toBe('/os/feed?w=app.wallet')
        await page.keyboard.press('Alt+Backquote')
        await expect.poll(() => path(page)).toBe('/os/wallet?w=app.feed')
        await page.keyboard.press('Alt+KeyW')
        await expect(win(page, 'Wallet')).toHaveCount(0)
        await expect.poll(() => path(page)).toBe('/os/feed')
    })

    test('back and forward return to exactly the windows each URL lists', async ({ page }) => {
        await page.goto(`${OS_ON}/os/feed`)
        await expect(win(page, 'Feed')).toBeVisible()
        await page.goto(`${OS_ON}/os/validators`)
        await expect(win(page, 'Validators')).toBeVisible()
        // Back: a real history pop (a new document would restore from storage instead).
        await page.evaluate(() => {
            window.history.pushState({}, '', '/os/arcade')
            window.dispatchEvent(new PopStateEvent('popstate'))
        })
        await expect(win(page, 'Arcade')).toBeVisible()
        await expect(win(page, 'Validators')).toHaveCount(0)
        await expect.poll(() => path(page)).toBe('/os/arcade')
    })

    test('drag by the title bar moves; the corner resizes', async ({ page }) => {
        await page.goto(`${OS_ON}/os/feed`)
        const w = await settled(page, 'Feed')
        const before = (await w.boundingBox())!
        // Grab the title bar left of its centred title: the guest toast sits over the middle of the desk's top.
        const title = w.getByRole('heading', { name: 'Feed', exact: true })
        const t = (await title.boundingBox())!
        const gx = before.x + 120
        await page.mouse.move(gx, t.y + t.height / 2)
        await page.mouse.down()
        await page.mouse.move(gx + 150, t.y + t.height / 2 + 60, { steps: 6 })
        await page.mouse.up()
        await expect.poll(async () => Math.round((await w.boundingBox())!.x - before.x)).toBe(150)
        const moved = (await w.boundingBox())!
        expect(Math.round(moved.y - before.y)).toBe(60)

        const corner = (await w.getByTestId('resize').boundingBox())!
        await page.mouse.move(corner.x + 8, corner.y + 8)
        await page.mouse.down()
        // Shrink: a page window is wide, so there may be no room to grow it.
        await page.mouse.move(corner.x - 92, corner.y - 42, { steps: 6 })
        await page.mouse.up()
        await expect.poll(async () => Math.round((await w.boundingBox())!.width - moved.width)).toBe(-100)

        // A reload of the same link keeps this browser's layout.
        await page.reload()
        const again = await settled(page, 'Feed')
        const box = (await again.boundingBox())!
        expect(Math.round(box.x - before.x)).toBe(150)
        expect(Math.round(box.width - moved.width)).toBe(-100)
    })

    test('minimise to the dock and back; maximise fills the desk', async ({ page }) => {
        await page.goto(`${OS_ON}/os/feed`)
        await win(page, 'Feed').getByRole('button', { name: 'Minimise Feed' }).click()
        await expect(win(page, 'Feed')).toHaveCount(0)
        await expect.poll(() => path(page)).toBe('/os')
        await dock(page).getByRole('button', { name: 'Restore Feed' }).click()
        await expect(win(page, 'Feed')).toBeVisible()
        await win(page, 'Feed').getByRole('button', { name: 'Maximise Feed' }).click()
        await expect.poll(async () => Math.round((await win(page, 'Feed').boundingBox())!.width)).toBe(1280 - 16)
        await win(page, 'Feed').getByRole('button', { name: 'Restore Feed' }).click()
        await expect.poll(async () => Math.round((await win(page, 'Feed').boundingBox())!.width)).toBe(960) // page windows open at 960
    })

    test('Window menu: tile the two front windows, minimise all, next', async ({ page }) => {
        await page.goto(`${OS_ON}/os/feed?w=app.wallet`)
        await settled(page, 'Wallet')
        await bar(page).getByRole('button', { name: 'Window' }).click()
        await page.getByRole('menuitem', { name: 'Tile two front windows' }).click()
        await expect.poll(async () => Math.round((await win(page, 'Feed').boundingBox())!.width)).toBe(640 - 16)
        const a = (await win(page, 'Feed').boundingBox())!
        const b = (await win(page, 'Wallet').boundingBox())!
        expect(Math.round(a.width)).toBe(640 - 16)
        expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(600)
        await bar(page).getByRole('button', { name: 'Window' }).click()
        await page.getByRole('menuitem', { name: 'Minimise all' }).click()
        await expect(page.locator('.os-win')).toHaveCount(0)
        await expect(dock(page).getByRole('button', { name: /^Restore / })).toHaveCount(2)
    })

    test('a plain /os visit restores the last windows of this browser', async ({ page }) => {
        await page.goto(`${OS_ON}/os`)
        await dock(page).getByRole('button', { name: 'Arcade' }).click()
        await dock(page).getByRole('button', { name: 'Validators' }).click()
        await expect.poll(() => path(page)).toBe('/os/validators?w=app.arcade')
        await page.goto(`${OS_ON}/os`)
        await expect(win(page, 'Arcade')).toBeVisible()
        await expect(win(page, 'Validators')).not.toHaveClass(/os-inactive/)
    })
})

test.describe('Memba OS desktop items', () => {
    test.beforeEach(async ({ page }) => {
        await offline(page)
        await page.addInitScript(() => localStorage.setItem('memba_os_seen', '1'))
        await page.setViewportSize({ width: 1280, height: 800 })
    })

    const item = (page: Page, key: string) => page.locator(`[data-item="${key}"]`)

    test('guests start from the featured desk; one click opens', async ({ page }) => {
        await page.goto(`${OS_ON}/os`)
        await expect(item(page, 'dao:govdao')).toBeVisible()
        await expect(item(page, 'dao:memba_dao')).toBeVisible()
        await expect(item(page, 'app:arcade')).toBeVisible()
        await item(page, 'dao:memba_dao').click()
        await expect(win(page, 'memba_dao')).toBeVisible()
        await expect.poll(() => path(page)).toBe('/os/dao/memba_dao')
    })

    test('pin from the start menu and the app menu, remove with right-click; it persists', async ({ page }) => {
        await page.goto(`${OS_ON}/os/dao/memba_dao/proposals/12`)
        await bar(page).getByRole('button', { name: 'Memba menu' }).click()
        await page.getByRole('button', { name: 'Add Feed to desktop' }).click()
        await expect(item(page, 'app:feed')).toBeVisible()
        await page.keyboard.press('Escape')
        await bar(page).getByRole('button', { name: 'DAOs' }).click()
        await page.getByRole('menuitem', { name: 'Bookmark to desktop' }).click()
        await expect(item(page, 'prop:memba_dao:12')).toBeVisible()

        await item(page, 'app:arcade').click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Remove from desktop' }).click()
        await expect(item(page, 'app:arcade')).toHaveCount(0)

        await page.reload()
        await expect(item(page, 'app:feed')).toBeVisible()
        await expect(item(page, 'prop:memba_dao:12')).toBeVisible()
        await expect(item(page, 'app:arcade')).toHaveCount(0)
    })

    test('drag snaps to the grid and swaps with the item already there', async ({ page }) => {
        await page.goto(`${OS_ON}/os`)
        const gov = item(page, 'dao:govdao')
        const arcade = item(page, 'app:arcade')
        const g0 = (await gov.boundingBox())!
        const a0 = (await arcade.boundingBox())!
        await page.mouse.move(g0.x + g0.width / 2, g0.y + 20)
        await page.mouse.down()
        await page.mouse.move(a0.x + a0.width / 2 + 10, a0.y + 26, { steps: 8 })
        await page.mouse.up()
        await expect.poll(async () => Math.round((await gov.boundingBox())!.y)).toBe(Math.round(a0.y))
        expect(Math.round((await arcade.boundingBox())!.y)).toBe(Math.round(g0.y))
        await expect(win(page, 'govdao')).toHaveCount(0) // a drag isn't a click
        await page.reload()
        expect(Math.round((await item(page, 'dao:govdao').boundingBox())!.y)).toBe(Math.round(a0.y))
    })

    test('desktop menu: show desktop minimises everything', async ({ page }) => {
        await page.goto(`${OS_ON}/os/feed`)
        await settled(page, 'Feed')
        await page.mouse.click(1200, 650, { button: 'right' }) // empty desk, right of the window
        await page.getByRole('menuitem', { name: 'Show desktop' }).click()
        await expect(page.locator('.os-win')).toHaveCount(0)
    })
})
