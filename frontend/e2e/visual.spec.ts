import { test, expect } from '@playwright/test'
import { stubNetwork } from './helpers/stubNetwork'

/**
 * Desktop visual-regression baselines.
 *
 * Network is fully stubbed (backend/RPC/indexer/3p calls aborted) so pages
 * render deterministic static/loading/error shells. Dynamic regions that still
 * vary (StatusStrip live-dot state, GovDAO spotlight proposal counts from seed
 * data) are masked.
 *
 * Routes baselined:
 *   /              → home (redirects to /:network/, captures VisitorHero + sidebar)
 *   /test13/directory → Directory DAOs tab (seed list, no network needed)
 *   /test13/validators → Validators page (RPC stubbed → shows loading/error shell)
 *
 * Masking strategy:
 *   - [data-testid="status-strip"] — live block-height, validator count, dot state
 *   - .contributors-door__avatar--img — GitHub avatar images (may not load when stubbed)
 *   - [data-testid="govdao-spotlight"] — proposal counts vary by seed data timing
 *   - [data-testid="eco-tokens-loading"], [data-testid="eco-validators-loading"] — skeleton spinners
 */

const ROUTES = ['/', '/test13/directory', '/test13/validators']

for (const path of ROUTES) {
    test(`desktop visual: ${path}`, async ({ page }) => {
        // Snapshot baselines are committed as *-chromium-darwin.png only.
        // CI runs Linux, where Playwright looks for *-chromium-linux.png and
        // would fail with "missing baseline". Skip in CI until Linux baselines
        // are generated (tracked as a follow-up); run locally on macOS only.
        test.skip(!!process.env.CI, 'visual baselines are darwin-only; run locally only')

        await page.setViewportSize({ width: 1280, height: 900 })
        await stubNetwork(page)
        await page.goto(path)
        await page.waitForLoadState('networkidle').catch(() => {})

        // Wait for a REAL rendered element, not a fixed timer. The persistent
        // desktop Sidebar is the deterministic shell present on every route
        // (DesktopShell) — its visibility proves React actually mounted (the old
        // 300ms timer fired whether or not the app painted, which is how blank
        // captures slipped through against blank baselines). toHaveScreenshot's
        // own stabilization (retries until two consecutive shots match) then
        // settles any remaining synchronous paint.
        await expect(page.locator('[data-testid="sidebar"]')).toBeVisible()

        await expect(page).toHaveScreenshot(
            // NOTE: the `|| '_home'` branch is dead (for '/', replace() yields
            // the truthy string '_'), but it stays — the committed baseline
            // filenames derive from this exact formula, so changing it would
            // orphan the existing PNGs and force a full regen.
            `desktop${path.replace(/\//g, '_') || '_home'}.png`,
            {
                fullPage: true,
                maxDiffPixelRatio: 0.02,
                animations: 'disabled',
                mask: [
                    // StatusStrip: live dot, block height, validator count — all network-dependent
                    page.locator('[data-testid="status-strip"]'),
                    // GovDAO spotlight — proposal/member counts from seed data timing
                    page.locator('[data-testid="govdao-spotlight"]'),
                    // Ecosystem band loading spinners — async state
                    page.locator('[data-testid="eco-tokens-loading"]'),
                    page.locator('[data-testid="eco-validators-loading"]'),
                    // Contributor door — avatar images from GitHub (aborted), score data
                    page.locator('.contributors-door'),
                ],
            },
        )
    })
}
