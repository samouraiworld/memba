import { test, expect, type Page } from '@playwright/test'

/**
 * Explorer gating E2E (W9 P0). The /explorer/* route is wrapped in
 * <ExplorerGate>, which renders the ComingSoonGate when VITE_ENABLE_EXPLORER is
 * off. The committed root .env.e2e pins VITE_ENABLE_EXPLORER=false, so this spec
 * deterministically asserts the flag-off path: direct-navigating to /explorer (or
 * a deep realm link) shows the coming-soon gate, never the live viewer.
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

    test('direct-navigating to /explorer when gated shows the coming-soon gate, not the viewer', async ({ page }) => {
        const network = await resolveNetwork(page)

        await page.goto(`/${network}/explorer`, { waitUntil: 'domcontentloaded' })

        await expect(page.getByTestId('coming-soon-gate')).toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('coming-soon-gate')).toContainText('Realm Explorer')
        await expect(page.getByTestId('explorer-root')).toHaveCount(0)
    })

    test('a deep realm link is gated too (no leak past ExplorerGate)', async ({ page }) => {
        const network = await resolveNetwork(page)

        await page.goto(`/${network}/explorer/r/samcrew/memba_feed_v1`, { waitUntil: 'domcontentloaded' })
        await expect(page.getByTestId('coming-soon-gate')).toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('explorer-root')).toHaveCount(0)
    })

    test('the Explorer nav entry is present but badged "soon" when gated', async ({ page }) => {
        const network = await resolveNetwork(page)
        await page.goto(`/${network}/`, { waitUntil: 'domcontentloaded' })

        const explorerLink = page.locator(`a[href$="/explorer"]`).first()
        await expect(explorerLink).toBeVisible({ timeout: 10_000 })
        await expect(explorerLink).toContainText('soon')
    })
})
