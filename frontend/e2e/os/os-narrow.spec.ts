import { expect, test, type Page } from '@playwright/test'
import { OS_FLAGS_ON, OS_ON } from '../../playwright.os.config'
import { fulfillGovernance } from '../helpers/proGovernanceFixture'

// Memba pages in a narrow window on a desktop screen. Their phone layouts are
// viewport media queries, which a 360 px window on a 1280 px screen never
// triggers; the window body is the `os-window` container and the pages mirror
// those rules as container queries. A page that doesn't spills sideways out of
// its window (or clips its own content).

/** Content wider than the window body, outside any box that scrolls sideways on purpose. */
async function spill(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const body = document.querySelector('.os-win .os-wbody') as HTMLElement
        const edge = body.getBoundingClientRect().right
        const scrolls = (el: Element) => /auto|scroll/.test(getComputedStyle(el).overflowX)
        const out: string[] = []
        if (body.scrollWidth > body.clientWidth + 1) out.push(`window body scrolls sideways by ${body.scrollWidth - body.clientWidth}px`)
        body.querySelectorAll<HTMLElement>('.os-classic *, .os-store-home *, .os-store-detail *, .os-validators *, .os-explorer *, .os-quests *, .os-cinema *').forEach((el) => {
            if (el instanceof SVGElement) return
            for (let p = el.parentElement; p && p !== body; p = p.parentElement) if (scrolls(p)) return
            const r = el.getBoundingClientRect()
            if (r.width > 0 && r.right > edge + 1) out.push(`${el.tagName.toLowerCase()}.${el.className.split(' ')[0]} +${Math.round(r.right - edge)}`)
        })
        return [...new Set(out)].slice(0, 8)
    })
}

// [app, window, a box of the page styled by its own lazy stylesheet, and that style]:
// an unstyled page never spills, so the check waits for the sentinel first.
const PAGES = [
    ['feed', 'Feed', '.os-feed__stack', 'flex'],
    ['store', 'App Store', '.os-store-grid', 'grid'],
    ['validators', 'Validators', '.os-validators-head', 'flex'],
    ['quests', 'Quests', '.os-quests-head', 'flex'],
    ['dev-report', 'Dev Report', '.gl-subnav', 'flex'],
    ['explorer', 'Explorer', '.os-explorer-search', 'grid'],
] as const

test.describe('Memba OS pages in a narrow window', () => {
    test('Arcade lobby fits a 360 px window', async ({ page }) => {
        await fulfillGovernance(page)
        await page.addInitScript(() => {
            localStorage.setItem('memba_os_skip_intro', '1')
            localStorage.setItem('memba_os_windows:guest:gnoland-1', JSON.stringify([{ token: 'app.arcade', x: 40, y: 20, width: 360, height: 640, z: 1, min: false, max: false }]))
        })
        await page.setViewportSize({ width: 1280, height: 800 })
        await page.goto(`${OS_ON}/os`)
        const win = page.getByRole('region', { name: 'Arcade', exact: true })
        await expect(win.getByRole('navigation', { name: 'Arcade' })).toBeVisible()
        await expect(win.getByRole('button', { name: 'Details for BARRICADE' })).toBeVisible()
        // The storefront stylesheet is lazy: measure only once its container rules apply.
        await expect(win.locator('.os-cinema')).toBeVisible()
        await win.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
        expect(Math.round((await win.boundingBox())!.width)).toBe(360)
        // A narrow window swaps the hero picker for dots.
        await expect(win.getByRole('list', { name: 'Featured games: choose' })).toBeHidden()
        await expect(win.getByRole('button', { name: 'Show slide 1' })).toBeVisible()
        // The window is 360 px inside a 1280 px page, so "no horizontal scroll" is measured on the window, not the document.
        expect(await win.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(360)
        expect(await spill(page)).toEqual([])
    })

    for (const width of [360, 600]) {
        test(`an App Store page fits a ${width} px window`, async ({ page }) => {
            await page.route(/memba\.v1\.|https?:\/\/[^/]*gnolove|plausible\.io|sentry\.|clerk[.-]/, (r) => {
                const u = new URL(r.request().url())
                return u.hostname === '127.0.0.1' && !/memba\.v1\./.test(u.pathname) ? r.continue() : r.abort()
            })
            await fulfillGovernance(page)
            await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
            await page.setViewportSize({ width: 1280, height: 800 })
            await page.goto(`${OS_ON}/os/store/project/adena`)
            const win = page.getByRole('region', { name: 'App details · App Store', exact: true })
            await expect(win.getByRole('heading', { level: 1, name: 'Adena' })).toBeVisible()
            // Store details open maximised; restore through the title bar before resizing.
            await expect(win).toHaveClass(/os-max/)
            await win.getByRole('button', { name: 'Restore App details · App Store', exact: true }).click()
            await expect(win).not.toHaveClass(/os-max/)
            // The restored page is 1040 px wide; drag its corner to the target width.
            await win.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
            const box = (await win.boundingBox())!
            expect(Math.round(box.width)).toBe(1040)
            const corner = (await win.getByTestId('resize').boundingBox())!
            await page.mouse.move(corner.x + 8, corner.y + 8)
            await page.mouse.down()
            await page.mouse.move(corner.x + 8 - (box.width - width), corner.y + 8, { steps: 8 })
            await page.mouse.up()
            await expect.poll(async () => Math.round((await win.boundingBox())!.width)).toBe(width)
            await expect(win.getByRole('heading', { name: 'Community reviews' })).toBeVisible()
            await expect(win.locator('.os-cin-detail')).toHaveCSS('display', 'grid', { timeout: 20_000 })
            await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))))
            expect(await spill(page)).toEqual([])
            // The banner grows with its copy: a wrapped logo must not hang above the banner's top edge (it used to sit at -79px).
            const edges = await win.evaluate((el) => {
                const banner = el.querySelector('.os-cin-banner')!.getBoundingClientRect()
                const icon = el.querySelector('.os-cin-banner .os-cin-icon')!.getBoundingClientRect()
                return { banner: banner.top, icon: icon.top, offset: icon.top - banner.top }
            })
            expect(edges.offset, `icon top ${edges.icon} vs banner top ${edges.banner}`).toBeGreaterThanOrEqual(0)
        })
    }

    for (const [app, name, sentinel, display] of PAGES) {
        test(`${name} fits a 360 px window`, async ({ page }) => {
            // Only other hosts are refused: the dev server's own modules must load.
            await page.route(/memba\.v1\.|https?:\/\/[^/]*gnolove|plausible\.io|sentry\.|clerk[.-]/, (r) => {
                const u = new URL(r.request().url())
                return u.hostname === '127.0.0.1' && !/memba\.v1\./.test(u.pathname) ? r.continue() : r.abort()
            })
            await fulfillGovernance(page)
            await page.addInitScript((app) => {
                localStorage.setItem('memba_os_skip_intro', '1')
                localStorage.setItem('memba_os_windows:guest:gnoland-1', JSON.stringify([{ token: `app.${app}`, x: 40, y: 20, width: 360, height: 640, z: 1, min: false, max: false }]))
            }, app)
            await page.setViewportSize({ width: 1280, height: 800 })
            await page.goto(`${app === 'feed' ? OS_FLAGS_ON : OS_ON}/os`)
            const win = page.getByRole('region', { name, exact: true })
            await expect(win).toBeVisible()
            await win.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
            expect(Math.round((await win.boundingBox())!.width)).toBe(360)
            // The page itself, styled: not its loading frame, and not before its stylesheet applies.
            await expect(win.locator(sentinel).first()).toHaveCSS('display', display, { timeout: 20_000 })
            // Finite animations only: a live status pulse never finishes.
            await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))))
            expect(await spill(page)).toEqual([])
        })
    }
})
