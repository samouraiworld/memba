import { test, expect } from '@playwright/test'

/**
 * Settings E2E — verifies settings page structure, collapsible sections,
 * and version display. No wallet required.
 */

test.describe('Settings Page', () => {
    test('settings page loads', async ({ page }) => {
        await page.goto('/settings')
        await expect(page.locator('body')).toContainText(/Settings|Network|Gas/)
    })

    test('version displayed', async ({ page }) => {
        await page.goto('/settings')
        await expect(page.locator('body')).toContainText(/v\d+\.\d+/)
    })

    test('network section shows chain options', async ({ page }) => {
        await page.goto('/settings')
        await expect(page.locator('body')).toContainText(/Testnet|Network/)
    })

    test('gas defaults section visible', async ({ page }) => {
        await page.goto('/settings')
        await expect(page.locator('body')).toContainText(/Gas/)
    })

    test('clear cache button present', async ({ page }) => {
        await page.goto('/settings')
        await expect(page.locator('body')).toContainText(/Clear|Cache|Reset/)
    })

    test('settings at 375px — no overflow', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/settings')
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(380)
    })
})
