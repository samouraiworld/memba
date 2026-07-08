import { test, expect, type Page } from '@playwright/test'

/**
 * Explorer gating E2E. The realm Explorer is now a gated tab inside the Directory
 * (merged 2026-07-08). The committed root .env.e2e pins VITE_ENABLE_EXPLORER=false,
 * so this spec deterministically asserts the flag-off path:
 *   - the legacy /explorer/* route redirects into /directory?tab=explorer…
 *   - with the flag off the Directory collapses that to its default tab, so the
 *     read-only viewer never renders (no leak past the gate),
 *   - and there is no standalone "Explorer" nav entry anymore.
 *
 * Runs against the pinned-flags dev server on :5174 (npm run dev:e2e →
 * vite --mode e2e → reads .env.e2e), identical on any machine and in CI.
 */

test.use({ baseURL: 'http://localhost:5174' })

async function resolveNetwork(page: Page): Promise<string> {
    await page.goto('/')
    await page.waitForURL(/\/\w+\/$/, { timeout: 5000 })
    await expect(page.getByTestId('home-root')).toBeVisible({ timeout: 10_000 })
    const network = new URL(page.url()).pathname.match(/^\/(\w+)\//)?.[1]
    expect(network, 'app should redirect / to a network-prefixed URL').toBeTruthy()
    return network!
}

test.describe('Explorer gating (VITE_ENABLE_EXPLORER=false)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 })
    })

    test('legacy /explorer redirects into the Directory, and the viewer stays gated', async ({ page }) => {
        const network = await resolveNetwork(page)

        await page.goto(`/${network}/explorer`, { waitUntil: 'domcontentloaded' })

        // The redirect lands on the Directory…
        await page.waitForURL(/\/directory(\?|$)/, { timeout: 10_000 })
        await expect(page.getByTestId('global-search')).toBeVisible({ timeout: 10_000 })
        // …but with the flag off the Explorer tab collapses to the default tab —
        // the read-only viewer must not render.
        await expect(page.getByTestId('explorer-root')).toHaveCount(0)
    })

    test('a deep realm link is gated too (no leak past the merged tab)', async ({ page }) => {
        const network = await resolveNetwork(page)

        await page.goto(`/${network}/explorer/r/samcrew/memba_feed_v1`, { waitUntil: 'domcontentloaded' })

        await page.waitForURL(/\/directory\?tab=explorer/, { timeout: 10_000 })
        await expect(page.getByTestId('explorer-root')).toHaveCount(0)
    })

    test('there is no standalone Explorer nav entry (it lives inside the Directory)', async ({ page }) => {
        const network = await resolveNetwork(page)
        await page.goto(`/${network}/`, { waitUntil: 'domcontentloaded' })

        // The former /explorer nav link is gone; Directory is the single entry.
        await expect(page.locator('a[href$="/explorer"]')).toHaveCount(0)
        await expect(page.locator('a[href$="/directory"]').first()).toBeVisible({ timeout: 10_000 })
    })
})
