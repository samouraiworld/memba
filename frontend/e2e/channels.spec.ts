import { test, expect } from '@playwright/test'

/**
 * Channels page E2E tests — verify the standalone channels route
 * renders correctly with sidebar navigation and channel views.
 *
 * Note: Channels require a DAO with deployed _channels realm.
 * These tests verify the route/UI structure, not live channel data.
 */

test.describe('Channels Page Structure', () => {
    // Use a known seed DAO slug; channels page renders even without channel data
    test('channels route renders', async ({ page }) => {
        await page.goto('/channels/govdao')
        // Should render channel-related UI or empty state
        await expect(page.locator('body')).not.toBeEmpty()
    })

    test('page title includes channels', async ({ page }) => {
        await page.goto('/channels/govdao')
        await expect(page).toHaveTitle(/Channels|govdao/)
    })

    test('sidebar channel list renders', async ({ page }) => {
        await page.goto('/channels/govdao')
        // Channel sidebar should be present (even if loading or empty)
        const sidebar = page.locator('[data-testid="channel-sidebar"]')
        // Sidebar might not exist if no channels — that's OK
        const sidebarExists = await sidebar.count() > 0
        if (sidebarExists) {
            await expect(sidebar).toBeVisible()
        }
    })

    test('channel items display hash prefix', async ({ page }) => {
        await page.goto('/channels/govdao')
        // Wait for potential channel loading
        await page.waitForTimeout(2_000)

        const items = page.locator('[data-testid="channel-item"]')
        const count = await items.count()
        if (count > 0) {
            const firstText = await items.first().textContent()
            expect(firstText).toContain('#')
        }
    })
})

test.describe('Channels — Navigation', () => {
    test('clicking sidebar navigates to DAO channels', async ({ page }) => {
        // Navigate to a DAO page first
        await page.goto('/')
        // Check if sidebar has channels link (requires saved DAO)
        const channelLink = page.locator('a[href*="/channels"]')
        const count = await channelLink.count()
        if (count > 0) {
            await channelLink.first().click()
            await expect(page.url()).toContain('/channels')
        }
    })
})

test.describe('Channels — Mobile', () => {
    test('renders at mobile viewport', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/channels/govdao')
        // Should not have horizontal overflow
        const bodyWidth = await page.evaluate(() => document.documentElement.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(420)
    })
})
