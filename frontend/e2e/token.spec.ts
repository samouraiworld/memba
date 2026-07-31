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

// Pinned to /test13: the factory realm is allowlist-valid there, so the real
// form renders (statically — no chain read gates it). On the default network
// (topaz) the page correctly shows the ComingSoonGate until the commerce
// ceremony deploys tokenfactory_v2 — repoint these to the default route then.
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

    test('default network shows the coming-soon gate until the commerce ceremony', async ({ page }) => {
        await page.goto('/create-token')
        await expect(page.locator('body')).toContainText(/isn't available on this network yet/)
    })
})
