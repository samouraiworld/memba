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

// These stay pinned to /test13, where the factory realm has long been
// allowlist-valid so the real form renders (statically — no chain read gates it).
// The commerce ceremony (2026-07-31) has since made tokenfactory_v2 valid on the
// DEFAULT network too, which the last test in this block now asserts. Repointing
// these three to the default route is worthwhile follow-up cleanup — test13 is a
// retired chain — but it changes the redirect/document-load behaviour the mobile
// case below carefully pins, so it is deliberately not bundled into the
// allowlist change.
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
        await page.goto('/test13/create-token')
        // "Multisig Admin" is the admin-mode tab, which only the real form
        // renders. The old /Admin|Factory|grc20factory/ was satisfied by the
        // ComingSoonGate's own "Token Factory" heading — and CI hits that gate
        // for real: with no .env the app boots topaz, where the factory realm is
        // not allowlist-valid, so the FIRST document is the gate and only the
        // NetworkSync reload into test13 brings up the form (measured: 2 loads).
        // The old regex could therefore go green on the gate before the form
        // ever existed. This one cannot.
        await expect(page.locator('body')).toContainText('Multisig Admin')
    })

    test('form at 375px — no overflow', async ({ page }) => {
        // Boot straight onto test13 so this URL does NOT trigger a hard reload.
        // config.ts computes its network at module load; NetworkSync reloads the
        // whole document when the /:network param disagrees with it. CI has no
        // .env (only .env.example is tracked), so the app defaults to topaz while
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

    test('the DEFAULT network renders the real factory — tokenfactory_v2 is live on topaz', async ({ page }) => {
        // Was: "default network shows the coming-soon gate UNTIL the commerce
        // ceremony". That ceremony ran on 2026-07-31 — tokenfactory_v2 is live on
        // topaz-1 and now in REALM_ALLOWLIST.topaz, so isTokenFactoryValid() is
        // true and CreateToken renders the form instead of the gate. CI caught the
        // old assertion the moment the allowlist changed, which is the point of it.
        //
        // Assert the FORM, not merely the absence of the gate copy — absence alone
        // is satisfied by a blank page or a Suspense fallback.
        await page.goto('/create-token')
        await expect(page.locator('input[placeholder*="Token"]').first()).toBeVisible()
        await expect(page.locator('body')).not.toContainText(/isn't available on this network yet/)
    })
})
