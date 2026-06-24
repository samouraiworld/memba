import { test, expect } from '@playwright/test'

/**
 * Multisig E2E — verifies multisig creation, import, and view pages.
 * No wallet required — tests page structure, form validation, and routing.
 */

test.describe('Create Multisig Page', () => {
    test('create multisig form loads', async ({ page }) => {
        await page.goto('/create')
        await expect(page.locator('body')).toContainText(/Create|Multisig|Name/)
    })

    test('name field shows default placeholder', async ({ page }) => {
        await page.goto('/create')
        const nameInput = page.locator('input[placeholder*="our-super-cool-dao"]')
        await expect(nameInput).toBeVisible()
    })

    test('owner fields visible', async ({ page }) => {
        await page.goto('/create')
        // Should have at least one owner input
        await expect(page.locator('body')).toContainText(/Owner|Member|Address/)
    })

    test('threshold selector visible', async ({ page }) => {
        await page.goto('/create')
        await expect(page.locator('body')).toContainText(/Threshold|required/)
    })

    test('mobile: create page at 375px — no overflow', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/create')
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(380)
    })
})

test.describe('Import Multisig Page', () => {
    test('import multisig form loads', async ({ page }) => {
        await page.goto('/import')
        await expect(page.locator('body')).toContainText(/Import|Multisig|Address/)
    })

    test('address field visible', async ({ page }) => {
        await page.goto('/import')
        const input = page.locator('input[placeholder*="g1"]')
        await expect(input).toBeVisible()
    })
})

test.describe('Multisig — Route Guards', () => {
    test('/multisig redirects disconnected users to home', async ({ page }) => {
        await page.goto('/multisig')
        // Home rework: /:network/dashboard no longer exists as a routed page;
        // disconnected users are sent to /:network/ (the Control Room home).
        await page.waitForURL(/\/\w+\/$/, { timeout: 5000 })
        await expect(page.getByTestId('home-root')).toBeVisible()
    })
})
