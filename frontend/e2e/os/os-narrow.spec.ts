import { expect, test, type Page } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'
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
        body.querySelectorAll<HTMLElement>('.os-classic *').forEach((el) => {
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
    ['feed', 'Feed', '.coming-soon-gate', 'grid'],
    ['store', 'App Store', '.ecosystem-directory__grid', 'grid'],
    ['arcade', 'Arcade', '.coming-soon-gate', 'grid'],
    ['validators', 'Validators', '.val-stats-grid', 'grid'],
    ['quests', 'Quests', '.k-questhub-hero', 'flex'],
    ['dev-report', 'Dev Report', '.gl-subnav', 'flex'],
] as const

test.describe('Memba OS pages in a narrow window', () => {
    for (const [app, name, sentinel, display] of PAGES) {
        test(`${name} fits a 360 px window`, async ({ page }) => {
            // Only other hosts are refused: the dev server's own modules must load.
            await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (r) => {
                const u = new URL(r.request().url())
                return u.hostname === '127.0.0.1' && !/memba\.v1\./.test(u.pathname) ? r.continue() : r.abort()
            })
            await fulfillGovernance(page)
            await page.addInitScript((app) => {
                localStorage.setItem('memba_os_seen', '1')
                localStorage.setItem('memba_os_windows', JSON.stringify([{ token: `app.${app}`, x: 40, y: 20, width: 360, height: 640, z: 1, min: false, max: false }]))
            }, app)
            await page.setViewportSize({ width: 1280, height: 800 })
            await page.goto(`${OS_ON}/os`)
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
