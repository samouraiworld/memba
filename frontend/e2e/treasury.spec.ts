import { test, expect, type Page } from '@playwright/test'

/**
 * Treasury E2E — verifies the treasury page renders its shell for GovDAO.
 * No wallet, no live on-chain reads.
 *
 * History: the old body-text assertion (`toContainText(/Treasury|Balance|Asset/)`)
 * flaked in CI. That text only appears once the page leaves its loading state
 * (the loading branch is text-less <SkeletonCard>s), which requires the live
 * getDAOConfig + getDAOMembers reads against the public test13 RPC to settle.
 * On a slow/variable RPC (and with the backend proxy returning ECONNREFUSED) the
 * reads intermittently missed the 10s expect timeout across all 3 retries, and
 * which PR failed shifted run-to-run as public-RPC contention varied.
 *
 * Fix: abort just the gno RPC / indexer hosts so those reads reject instantly.
 * Treasury.tsx catches the failure and drops out of `loading`, rendering its
 * deterministic shell ("💰 Treasury" heading + back button) with zero RPC
 * dependency. We intentionally do NOT abort everything (the shared stubNetwork
 * helper's /sentry/ pattern also matches the app's own bundled @sentry_react
 * module and would blank the whole app), and we assert on stable elements
 * instead of racing body text.
 */
const GNO_RPC_HOSTS = [/\.gno\.land/, /testnets\.gno\.land/, /gnoland\.network/, /\.onbloc\.xyz/]

async function abortOnchainReads(page: Page) {
    await page.route('**/*', route => {
        if (GNO_RPC_HOSTS.some(re => re.test(route.request().url()))) return route.abort()
        return route.continue()
    })
}

test.describe('Treasury Page', () => {
    test.beforeEach(async ({ page }) => {
        await abortOnchainReads(page)
    })

    test('treasury page loads for GovDAO', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/treasury')
        await expect(page.getByRole('heading', { name: /Treasury/ })).toBeVisible()
    })

    test('treasury page has back navigation', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/treasury')
        await expect(page.locator('#treasury-back-btn')).toBeVisible()
    })

    test('treasury at 375px — no overflow', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/dao/gno.land~r~gov~dao/treasury')
        // Wait for the shell before measuring so we never sample a mid-loading frame.
        await expect(page.getByRole('heading', { name: /Treasury/ })).toBeVisible()
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(380)
    })
})
