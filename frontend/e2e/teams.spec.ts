import { test, expect } from '@playwright/test'
import { MOBILE_375, expectNoMobileOverflow } from './helpers/overflow'

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
        await page.setViewportSize(MOBILE_375)
        await page.goto('/organizations')
        // Both renderings of this route title their h1 "Teams" — the ComingSoonGate
        // (CI, where VITE_ENABLE_TEAMS is unset) and the real page (flag on). One
        // locator therefore anchors the measurement in either environment.
        await expect(page.getByRole('heading', { name: 'Teams', level: 1 })).toBeVisible()
        await expectNoMobileOverflow(page)
    })
})
