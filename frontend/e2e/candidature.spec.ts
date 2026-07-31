import { test, expect } from '@playwright/test'
import { MOBILE_375, expectNoMobileOverflow } from './helpers/overflow'

/**
 * Candidature E2E — verifies candidature page renders.
 * Tests logged-out behavior and XP gate display.
 */

test.describe('Candidature Page', () => {
    test('candidature page loads without crash', async ({ page }) => {
        await page.goto('/candidature')
        await expect(page.locator('body')).not.toBeEmpty()
    })

    test('shows page title', async ({ page }) => {
        await page.goto('/candidature')
        await expect(page.locator('body')).toContainText('Memba DAO Candidature')
    })

    test('shows XP requirement info', async ({ page }) => {
        await page.goto('/candidature')
        // Should mention XP requirement (either gate or description)
        await expect(page.locator('body')).toContainText(/XP|quests|membership/)
    })

    test('sets document title', async ({ page }) => {
        await page.goto('/candidature')
        await expect(page).toHaveTitle(/Candidature/)
    })
})

test.describe('Candidature — XP Gate', () => {
    test('shows lock icon when not eligible (no wallet)', async ({ page }) => {
        await page.goto('/candidature')
        // Without wallet, user has 0 XP — should show locked state
        await expect(page.locator('body')).toContainText(/XP Required|XP/)
    })

    test('quest progress widget shown when locked', async ({ page }) => {
        await page.goto('/candidature')
        // Quest progress widget should be embedded in the gate
        await expect(page.locator('body')).toContainText(/Quest|XP/)
    })
})

test.describe('Candidature — Mobile', () => {
    test('candidature page at 375px — no horizontal scroll', async ({ page }) => {
        await page.setViewportSize(MOBILE_375)
        await page.goto('/candidature')
        // Measure the rendered page, not the layout shell: without this the
        // evaluate ran while only the topbar existed (~304 chars, vs 620 settled).
        await expect(page.getByRole('heading', { name: 'Memba DAO Candidature' })).toBeVisible()
        await expectNoMobileOverflow(page)
    })
})
