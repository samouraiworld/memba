import { test, expect, type Page } from '@playwright/test'

/**
 * Feed gating E2E (W7.2 P1). The /feed route is wrapped in <FeedGate>, which
 * renders the ComingSoonGate when VITE_ENABLE_FEED is off. The committed root
 * .env.e2e pins VITE_ENABLE_FEED=false (the feed realm isn't deployed on the
 * e2e target), so this spec deterministically asserts the flag-off path:
 * direct-navigating to /feed shows the coming-soon gate, never the live feed.
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

test.describe('Feed gating (VITE_ENABLE_FEED=false)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 })
    })

    test('direct-navigating to /feed when gated shows the coming-soon gate, not the feed', async ({ page }) => {
        const network = await resolveNetwork(page)

        await page.goto(`/${network}/feed`, { waitUntil: 'domcontentloaded' })

        // The route-level FeedGate renders the coming-soon surface…
        await expect(page.getByTestId('coming-soon-gate')).toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('coming-soon-gate')).toContainText('Social Feed')
        // …and the live feed page must NOT be present.
        await expect(page.getByTestId('feed-page')).toHaveCount(0)
        await expect(page.getByTestId('feed-composer-input')).toHaveCount(0)
    })

    test('the thread + profile sub-routes are gated too (no leak past FeedGate)', async ({ page }) => {
        const network = await resolveNetwork(page)

        for (const path of ['feed/post/1', 'feed/user/g1abcdefghijklmnop']) {
            await page.goto(`/${network}/${path}`, { waitUntil: 'domcontentloaded' })
            await expect(page.getByTestId('coming-soon-gate')).toBeVisible({ timeout: 10_000 })
            await expect(page.getByTestId('feed-thread')).toHaveCount(0)
            await expect(page.getByTestId('feed-profile')).toHaveCount(0)
        }
    })

    test('the Feed nav entry is present but badged "soon" when gated', async ({ page }) => {
        const network = await resolveNetwork(page)
        await page.goto(`/${network}/`, { waitUntil: 'domcontentloaded' })

        // The sidebar renders a gated entry as a link with a "soon" pill (it does
        // not hide it), so the feature is discoverable pre-launch.
        const feedLink = page.locator(`a[href$="/feed"]`).first()
        await expect(feedLink).toBeVisible({ timeout: 10_000 })
        await expect(feedLink).toContainText(/soon/i)
    })
})
