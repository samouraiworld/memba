import { test, expect, type Page } from '@playwright/test'

/**
 * "My Listings" marketplace surface (W7.1 PR1). Deterministic, wallet-free
 * structure coverage — the connected-with-listings path needs a real Adena
 * wallet + on-chain listings (same limit as marketplace-gating.spec), so this
 * asserts what renders without a wallet:
 *   - the My Listings tab is HIDDEN when no wallet is connected (connected-only),
 *   - direct-navigating to /marketplace/my-listings mounts the view and shows a
 *     connect-wallet prompt (a shared/bookmarked URL still works).
 *
 * Runs against the pinned-flags :5174 dev server (.env.e2e: NFT + Services live).
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

test.describe('Marketplace My Listings (W7.1)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 })
    })

    test('the My Listings tab is hidden when no wallet is connected', async ({ page }) => {
        const network = await resolveNetwork(page)
        await page.goto(`/${network}/marketplace/nfts`, { waitUntil: 'domcontentloaded' })

        // Live lane tabs render; the connected-only My Listings tab does not.
        await expect(page.locator('.um-tabs[role="tablist"]')).toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('my-listings-tab')).toHaveCount(0)
    })

    test('direct-navigating to /marketplace/my-listings shows the connect prompt', async ({ page }) => {
        const network = await resolveNetwork(page)
        await page.goto(`/${network}/marketplace/my-listings`, { waitUntil: 'domcontentloaded' })

        const view = page.getByTestId('my-listings-view')
        await expect(view).toBeVisible({ timeout: 10_000 })
        await expect(view).toContainText('Connect your wallet')
        // No listing rows render without a connected wallet.
        await expect(page.locator('[data-testid^="listing-card-"]')).toHaveCount(0)
    })
})
