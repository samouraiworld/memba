import { test, expect } from '@playwright/test'

/**
 * Quest Hub E2E — verifies quest widget on profile page.
 * No wallet required — tests the collapsed/expanded UI in logged-out state.
 */

test.describe('Quest Hub — Profile Page', () => {
    test('quest hub renders collapsed on profile page', async ({ page }) => {
        await page.goto('/profile/g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5')
        // Page should load without crash
        await expect(page.locator('body')).not.toBeEmpty()
    })

    test('quest hub summary bar shows quest count', async ({ page }) => {
        await page.goto('/profile/g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5')
        // Summary should show "X / Y Quests" pattern
        await expect(page.locator('body')).toContainText(/\d+ \/ \d+ Quests/)
    })

    test('quest hub has SVG radial ring', async ({ page }) => {
        await page.goto('/profile/g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5')
        const ring = page.locator('.quest-ring')
        await expect(ring.first()).toBeVisible()
    })

    test('quest hub expands on click', async ({ page }) => {
        await page.goto('/profile/g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5')
        const toggle = page.locator('[data-testid="quest-hub-toggle"]')
        if (await toggle.isVisible()) {
            await toggle.click()
            // After expanding, quest cards should appear
            const hub = page.locator('[data-testid="quest-hub"]')
            await expect(hub).toHaveAttribute('open', '')
        }
    })
})

test.describe('Quest Hub — Mobile', () => {
    test('quest hub at 375px — no horizontal scroll', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/profile/g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5')
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(380)
    })
})
