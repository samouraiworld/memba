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
        // Boot straight onto test13 (same reason as the 375px case below): CI has
        // no .env, so the app defaults to topaz and this URL would render a topaz
        // document first, then NetworkSync-reload into test13.
        //
        // That two-document dance used to be HARMLESS here and is now a trap. The
        // previous comment argued 'Multisig Admin' could not go green early
        // "because the FIRST document is the ComingSoonGate" — true only while
        // tokenfactory_v2 was absent from REALM_ALLOWLIST.topaz. This PR adds it,
        // so the topaz document now renders the REAL form, 'Multisig Admin' and
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

    test('the DEFAULT network serves the factory — tokenfactory_v2 is live on pearl', async ({ page }) => {
        // Flipped back to the form assertion by the pearl §6 completion PR,
        // exactly as this test's sapphire-era comment instructed: the combined
        // pearl ceremony deploys + allowlists tokenfactory_v2 on the default
        // network, so isTokenFactoryValid() is true and CreateToken renders
        // the real form (the topaz 2026-07-31 precedent). CI catches this
        // assertion the moment REALM_ALLOWLIST for the default network drops
        // the factory again.
        await page.goto('/create-token')
        await expect(page.locator('input[placeholder*="Token"]').first()).toBeVisible()
    })
})
