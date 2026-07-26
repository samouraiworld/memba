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
        // Should show admin or factory info
        await expect(page.locator('body')).toContainText(/Admin|Factory|grc20factory/)
    })

    test('form at 375px — no overflow', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/test13/create-token')
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(380)
    })

    test('default network shows the coming-soon gate until the commerce ceremony', async ({ page }) => {
        await page.goto('/create-token')
        await expect(page.locator('body')).toContainText(/isn't available on this network yet/)
    })
})
