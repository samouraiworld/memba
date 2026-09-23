import { test, expect } from '@playwright/test'

/**
 * Token E2E — verifies Token Dashboard and Create Token pages.
 * No wallet required — tests page structure and form validation.
 */

test.describe('Token Dashboard', () => {
    test('token dashboard page loads', async ({ page }) => {
        await page.goto('/tokens')
        await expect(page.locator('body')).toContainText(/Token|Launchpad/)
    })

    test('create token CTA visible', async ({ page }) => {
        await page.goto('/tokens')
        await expect(page.locator('body')).toContainText(/Create|Token|Deploy/)
    })
})

// These stay pinned to /test13 as a deliberate retired-chain fixture: the
// factory realm has long been allowlist-valid there, so the real form renders
// (statically — no chain read gates it; test13's RPC refuses connections since
// its 2026-07-26 retirement, which is exactly why nothing here may depend on a
// live read). The DEFAULT network (gno.land) does NOT allowlist the factory,
// which the last test in this block asserts (pearl served it until its
// 2026-09-23 retirement; /pearl/ links now redirect to /mainnet/), so the form
// cases need a network whose allowlist carries it — test13.
test.describe('Create Token Page', () => {
    test('form fields present', async ({ page }) => {
        await page.goto('/test13/create-token')
        // Token name input
        const nameInput = page.locator('input[placeholder*="Token"]').first()
        await expect(nameInput).toBeVisible()
        // Symbol input
        const symbolInput = page.locator('input[placeholder*="$"]').first()
        await expect(symbolInput).toBeVisible()
    })

    test('admin field visible', async ({ page }) => {
        // config.ts initialises from the URL first, so /test13/create-token is a
        // single document on test13 — no storage seeding needed (the URL echo
        // `memba_network` this used to seed is no longer read at all). And the
        // default network (gno.land) does not allowlist tokenfactory_v2, so a
        // default-network document shows the gate, never 'Multisig Admin': this
        // cannot go green without test13 loading (the false-green class #1032
        // hardened against).
        await page.goto('/test13/create-token')
        await expect(page.locator('body')).toContainText('Multisig Admin')
    })

    test('form at 375px — no overflow', async ({ page }) => {
        // A single document: config.ts initialises from the URL first, so
        // NetworkSync has no mismatch to reload over and the bare evaluate()
        // below keeps its execution context.
        let documentLoads = 0
        page.on('load', () => { documentLoads++ })
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/test13/create-token')
        // Then wait for the form before measuring: the threshold (380) is above
        // the viewport (375), so an unrendered page — the coming-soon gate, or a
        // bare Suspense fallback — satisfies the assertion without ever
        // exercising the form. Measured 375 both before and after render.
        await expect(page.locator('input[placeholder*="Token"]').first()).toBeVisible()
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(380)
        expect(documentLoads).toBe(1)
    })

    test('a retired /pearl factory link lands on gno.land, which honestly gates it', async ({ page }) => {
        // Was 'pearl serves the factory, and the gno.land default honestly
        // gates it'. Pearl was retired on 2026-09-23 and /pearl/… now
        // redirects to the same route on mainnet with a one-time notice, so an
        // old factory bookmark must land on gno.land — where
        // REALM_ALLOWLIST.mainnet does not list tokenfactory_v2 — and gate
        // rather than offer a form that cannot broadcast. The factory FORM is
        // anchored by the test13 cases above.
        await page.goto('/pearl/create-token')
        await expect(page).toHaveURL(/\/mainnet\/create-token$/)
        await expect(page.getByTestId('retired-network-notice'))
            .toContainText("The Pearl testnet has been retired — you're now on gno.land mainnet.")
        await expect(page.locator('input[placeholder*="Token"]')).toHaveCount(0)

        // One-time: dismissed, it stays away on the next retired link.
        await page.getByRole('button', { name: 'Dismiss notice' }).click()
        await expect(page.getByTestId('retired-network-notice')).toHaveCount(0)
        await page.goto('/pearl/create-token')
        await expect(page).toHaveURL(/\/mainnet\/create-token$/)
        await expect(page.locator('input[placeholder*="Token"]')).toHaveCount(0)
        await expect(page.getByTestId('retired-network-notice')).toHaveCount(0)
    })
})
