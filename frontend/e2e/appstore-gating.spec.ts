import { test, expect, type Page } from '@playwright/test'

/**
 * App Store gating E2E (W9). The /apps/* route is wrapped in <AppStoreGate>, which
 * renders the ComingSoonGate when VITE_ENABLE_APPSTORE is off. The committed root
 * .env.e2e pins VITE_ENABLE_APPSTORE=false (it is SAFETY-gated until the realm's fee
 * path is verified), so this spec deterministically asserts the flag-off path:
 * /apps and a deep app link show the coming-soon gate, never the store.
 *
 * Runs against the pinned-flags dev server on :5174 (npm run dev:e2e).
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

test.describe('App Store gating (VITE_ENABLE_APPSTORE=false)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 })
    })

    test('direct-navigating to /apps when gated shows the coming-soon gate, not the store', async ({ page }) => {
        const network = await resolveNetwork(page)
        await page.goto(`/${network}/apps`, { waitUntil: 'domcontentloaded' })
        await expect(page.getByTestId('coming-soon-gate')).toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('coming-soon-gate')).toContainText('App Store')
        await expect(page.getByTestId('appstore-root')).toHaveCount(0)
    })

    test('a deep app link is gated too (no leak past AppStoreGate)', async ({ page }) => {
        const network = await resolveNetwork(page)
        await page.goto(`/${network}/apps/r/samcrew/block_party`, { waitUntil: 'domcontentloaded' })
        await expect(page.getByTestId('coming-soon-gate')).toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('appstore-root')).toHaveCount(0)
    })

    test('the App Store nav entry is present but badged "soon" when gated', async ({ page }) => {
        const network = await resolveNetwork(page)
        await page.goto(`/${network}/`, { waitUntil: 'domcontentloaded' })
        const link = page.locator(`a[href$="/apps"]`).first()
        await expect(link).toBeVisible({ timeout: 10_000 })
        await expect(link).toContainText('soon')
    })
})
