import { test, expect } from '@playwright/test'

/**
 * Settings E2E — verifies settings page structure, collapsible sections,
 * and version display. No wallet required.
 */

test.describe('Settings Page', () => {
    test('settings page loads', async ({ page }) => {
        await page.goto('/settings')
        await expect(page.locator('body')).toContainText(/Settings/)
    })

    test('version displayed', async ({ page }) => {
        await page.goto('/settings')
        await expect(page.locator('body')).toContainText(/v\d+\.\d+/)
    })

    test('network section shows chain options', async ({ page }) => {
        await page.goto('/settings')
        // Network section is open by default
        await expect(page.locator('body')).toContainText(/Testnet/)
    })

    test('gas section accessible via accordion', async ({ page }) => {
        await page.goto('/settings')
        // Click the Gas Defaults section header to expand it
        const gasHeader = page.locator('button', { hasText: '⛽ Gas Defaults' })
        await expect(gasHeader).toBeVisible()
        await gasHeader.click()
        await expect(page.locator('#settings-gas-wanted')).toBeVisible()
    })

    test('advanced section has clear cache button', async ({ page }) => {
        await page.goto('/settings')
        // Click the Advanced section header to expand it
        const advancedHeader = page.locator('button', { hasText: '🔧 Advanced' })
        await expect(advancedHeader).toBeVisible()
        await advancedHeader.click()
        // Now the clear cache button should be visible
        await expect(page.locator('#settings-clear-cache')).toBeVisible()
        await expect(page.locator('#settings-clear-cache')).toContainText('Clear Cache')
    })

    test('settings at 375px — no overflow', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/settings')
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(380)
    })
})
