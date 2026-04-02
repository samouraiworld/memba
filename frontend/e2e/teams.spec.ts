import { test, expect } from '@playwright/test'

/**
 * Teams E2E — verifies organizations page renders.
 * Tests logged-out behavior and feature flag gate.
 */

test.describe('Teams Page', () => {
    test('organizations page loads without crash', async ({ page }) => {
        await page.goto('/organizations')
        await expect(page.locator('body')).not.toBeEmpty()
    })

    test('shows wallet connect or coming soon gate', async ({ page }) => {
        await page.goto('/organizations')
        // Without wallet: either shows "Connect" prompt, "Coming Soon" gate,
        // or the Teams page content depending on feature flag
        await expect(page.locator('body')).toContainText(/Connect|Coming Soon|Teams|Organizations|wallet/)
    })

    test('teams page has correct title', async ({ page }) => {
        await page.goto('/organizations')
        await expect(page).toHaveTitle(/Memba/)
    })
})

test.describe('Teams — Mobile', () => {
    test('organizations page at 375px — no horizontal scroll', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/organizations')
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(380)
    })
})
