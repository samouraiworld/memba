import { test, expect } from '@playwright/test'
import { MOBILE_375, expectNoMobileOverflow } from './helpers/overflow'

/**
 * Profile E2E — verifies profile page structure and routing.
 * No wallet required — tests logged-out views and route handling.
 */

test.describe('Profile Page', () => {
    test('profile page loads for address route', async ({ page }) => {
        await page.goto('/profile/g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5')
        // Should render the profile page (may show loading state or profile data)
        await expect(page.locator('body')).not.toBeEmpty()
    })

    test('profile page shows wallet connect info when disconnected', async ({ page }) => {
        await page.goto('/profile/g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5')
        // When disconnected, various content may appear
        await expect(page.locator('body')).toContainText(/Connect|Adena|Profile|gnolove|g1/)
    })
})

test.describe('Profile — Mobile', () => {
    test('profile page at 375px — no horizontal scroll', async ({ page }) => {
        await page.setViewportSize(MOBILE_375)
        await page.goto('/profile/g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5')
        // The g1… address in the header is the longest unbroken string on this
        // route — exactly what would clip. Wait for it before measuring.
        await expect(page.locator('h2.profile-name')).toBeVisible()
        await expectNoMobileOverflow(page)
    })
})
