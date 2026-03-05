import { test, expect } from '@playwright/test'

/**
 * Treasury E2E — verifies treasury page loads and renders for GovDAO.
 * No wallet required.
 */

test.describe('Treasury Page', () => {
    test('treasury page loads for GovDAO', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/treasury')
        await expect(page.locator('body')).toContainText(/Treasury|Balance|Asset/)
    })

    test('treasury page has back navigation', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/treasury')
        await expect(page.locator('body')).toContainText(/Back|DAO/)
    })

    test('treasury at 375px — no overflow', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/dao/gno.land~r~gov~dao/treasury')
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(380)
    })
})
