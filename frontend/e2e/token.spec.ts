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
// 2026-09-23 retirement; /pearl/ links now redirect to /mainnet/). Repointing
// these three to the default route is worthwhile follow-up cleanup, but it
// changes the redirect/document-load behaviour the mobile case below carefully
// pins, so it is deliberately not bundled into a comment-only change.
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
        // Boot straight onto test13 (same reason as the 375px case below): CI has
        // no .env, so the app defaults to pearl and this URL would render a pearl
        // document first, then NetworkSync-reload into test13.
        //
        // That two-document dance used to be HARMLESS here and is now a trap. The
        // previous comment argued 'Multisig Admin' could not go green early
        // "because the FIRST document is the ComingSoonGate" — true only while
        // tokenfactory_v2 was absent from the default network's REALM_ALLOWLIST.
        // It is present (topaz since 2026-07-31, pearl since 2026-08-31), so the
        // default-network document renders the REAL form, 'Multisig Admin' and
        // all, and the assertion would pass without test13 ever loading — the
        // exact false-green class #1032 hardened this test against. Seeding the
        // key the module-load resolver reads makes it a single, unambiguous load.
        await page.addInitScript(() => localStorage.setItem('memba_network', 'test13'))
        await page.goto('/test13/create-token')
        await expect(page.locator('body')).toContainText('Multisig Admin')
    })

    test('form at 375px — no overflow', async ({ page }) => {
        // Boot straight onto test13 so this URL does NOT trigger a hard reload.
        // config.ts computes its network at module load; NetworkSync reloads the
        // whole document when the /:network param disagrees with it. CI has no
        // .env (only .env.example is tracked), so the app defaults to pearl while
        // this URL asks for test13 — the reload then destroys the execution
        // context out from under a bare evaluate(). Seeding the key the same
        // resolver reads makes it a single load. Verified: 2 document loads
        // without this, 1 with it.
        await page.addInitScript(() => localStorage.setItem('memba_network', 'test13'))
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/test13/create-token')
        // Then wait for the form before measuring: the threshold (380) is above
        // the viewport (375), so an unrendered page — the coming-soon gate, or a
        // bare Suspense fallback — satisfies the assertion without ever
        // exercising the form. Measured 375 both before and after render.
        await expect(page.locator('input[placeholder*="Token"]').first()).toBeVisible()
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(380)
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
