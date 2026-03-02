import { test, expect } from '@playwright/test'

/**
 * Smoke tests — verify all core routes render without crash.
 * No backend required — these only check that pages load and show content.
 */

test.describe('Smoke Tests', () => {
    test('homepage loads', async ({ page }) => {
        await page.goto('/')
        await expect(page).toHaveTitle(/Memba/)
    })

    test('DAO hub loads', async ({ page }) => {
        await page.goto('/dao')
        await expect(page.locator('body')).toContainText(/DAO|Governance|Connect/)
    })

    test('tokens page loads', async ({ page }) => {
        await page.goto('/tokens')
        await expect(page.locator('body')).toContainText(/Token|Launchpad|Create/)
    })

    test('create token page loads', async ({ page }) => {
        await page.goto('/create-token')
        await expect(page.locator('body')).toContainText(/Create|Token|Name/)
    })

    test('404 page handles unknown routes', async ({ page }) => {
        await page.goto('/nonexistent-route-12345')
        // Should not crash — either shows 404 or redirects to home
        await expect(page.locator('body')).toBeVisible()
    })
})
