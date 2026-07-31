import { test, expect } from '@playwright/test'
import { MOBILE_375, expectNoMobileOverflow } from './helpers/overflow'

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
        await expect(page.locator('body')).toContainText(/v\d+/)
    })

    test('network section offers the active network and NOT Betanet', async ({ page }) => {
        await page.goto('/settings')
        // Network section is open by default.
        //
        // Was /Testnet/, which only ever passed because this picker listed the
        // FULL NETWORKS map — the string came from the HIDDEN test13 entry, so
        // the assertion silently depended on hidden networks being offered here
        // (F-28's third picker). Assert the contract instead: the network you are
        // actually on is offered, and Betanet is not.
        const active = page.locator('#settings-page button[id^="network-"]')
        await expect(active.first()).toBeVisible()
        await expect(page.locator('#network-gnoland1')).toHaveCount(0)
        const network = new URL(page.url()).pathname.split('/')[1]
        await expect(page.locator(`#network-${network}`)).toBeVisible()
    })

    test('gas section accessible via accordion', async ({ page }) => {
        await page.goto('/settings')
        // Click the Gas Defaults section header to expand it
        const gasHeader = page.locator('button', { hasText: 'Gas Defaults' })
        await expect(gasHeader).toBeVisible()
        await gasHeader.click()
        await expect(page.locator('#settings-gas-wanted')).toBeVisible()
    })

    test('advanced section has clear cache button', async ({ page }) => {
        await page.goto('/settings')
        // Click the Advanced section header to expand it
        const advancedHeader = page.locator('button', { hasText: 'Advanced' })
        await expect(advancedHeader).toBeVisible()
        await advancedHeader.click()
        // Now the clear cache button should be visible
        await expect(page.locator('#settings-clear-cache')).toBeVisible()
        await expect(page.locator('#settings-clear-cache')).toContainText('Clear Cache')
    })

    test('settings at 375px — no overflow', async ({ page }) => {
        await page.setViewportSize(MOBILE_375)
        await page.goto('/settings')
        await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
        await expectNoMobileOverflow(page)
    })
})
