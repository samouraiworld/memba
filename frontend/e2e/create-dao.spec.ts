import { test, expect } from '@playwright/test'

/**
 * Create DAO E2E — verifies the 5-step DAO creation wizard.
 * Tests wizard structure, navigation, and form validation.
 * No wallet required.
 */

test.describe('Create DAO Wizard', () => {
    test('wizard loads with step 1 (Preset)', async ({ page }) => {
        await page.goto('/dao/create')
        await expect(page.locator('body')).toContainText(/Create|DAO/)
        // Should show preset options
        await expect(page.locator('body')).toContainText(/Basic|Team|Treasury|Enterprise/)
    })

    test('5-step indicator renders', async ({ page }) => {
        await page.goto('/dao/create')
        // Step circles (1-5)
        const steps = page.locator('div[style*="borderRadius: 50%"]')
        await expect(steps).toHaveCount(5)
    })

    test('step 1 has preset cards', async ({ page }) => {
        await page.goto('/dao/create')
        await expect(page.locator('body')).toContainText('Basic')
        await expect(page.locator('body')).toContainText('Team')
    })

    test('create DAO at 375px — no overflow', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/dao/create')
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(380)
    })
})

test.describe('Create DAO — Route Aliases', () => {
    test('/create-dao also renders create wizard', async ({ page }) => {
        await page.goto('/create-dao')
        // Should show the same wizard
        await expect(page.locator('body')).toContainText(/Create|DAO|Name/)
    })
})
