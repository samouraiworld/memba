import { test, expect } from '@playwright/test'

/**
 * Validators page E2E tests — verify the validator dashboard renders
 * and interactive elements work without backend authentication.
 *
 * Note: These tests run against the dev server. Validator data comes from
 * live Tendermint RPC, so exact values are not asserted — only structure.
 */

test.describe('Validators Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/validators')
    })

    test('page renders with title', async ({ page }) => {
        await expect(page).toHaveTitle(/Validators/)
        await expect(page.locator('h1')).toContainText('Validators')
    })

    test('chain badge is visible', async ({ page }) => {
        const badge = page.locator('.val-chain-badge')
        await expect(badge).toBeVisible()
        await expect(badge).not.toBeEmpty()
    })

    test('network stats cards render', async ({ page }) => {
        const statsGrid = page.locator('[data-testid="network-stats"]')
        await expect(statsGrid).toBeVisible({ timeout: 15_000 })

        // Should have 4 stat cards
        const cards = statsGrid.locator('.val-stat-card')
        await expect(cards).toHaveCount(4)

        // Block height should be a number
        const blockHeight = cards.first().locator('.val-stat-value')
        await expect(blockHeight).not.toBeEmpty()
    })

    test('validator table renders with rows', async ({ page }) => {
        const table = page.locator('[data-testid="validator-table"]')
        await expect(table).toBeVisible({ timeout: 15_000 })

        // Should have at least 1 validator row
        const rows = table.locator('tbody tr')
        const count = await rows.count()
        expect(count).toBeGreaterThan(0)
    })

    test('power distribution bar renders', async ({ page }) => {
        const bar = page.locator('[data-testid="power-distribution"]')
        await expect(bar).toBeVisible({ timeout: 15_000 })

        // Should have segments
        const segments = bar.locator('.val-power-segment')
        const count = await segments.count()
        expect(count).toBeGreaterThan(0)
    })

    test('search filters validators', async ({ page }) => {
        const table = page.locator('[data-testid="validator-table"]')
        await expect(table).toBeVisible({ timeout: 15_000 })

        const initialCount = await table.locator('tbody tr').count()

        // Type a nonsense search to filter to 0
        const searchInput = page.locator('[data-testid="validator-search"]')
        await searchInput.fill('ZZZZNONEXISTENT')

        // Should have 0 rows now
        const filteredCount = await table.locator('tbody tr').count()
        expect(filteredCount).toBe(0)

        // Clear search should restore rows
        await searchInput.clear()
        const restoredCount = await table.locator('tbody tr').count()
        expect(restoredCount).toBe(initialCount)
    })

    test('page size selector changes page size', async ({ page }) => {
        const table = page.locator('[data-testid="validator-table"]')
        await expect(table).toBeVisible({ timeout: 15_000 })

        // Change page size to 25
        const pageSizeSelect = page.locator('[data-testid="validator-page-size"]')
        await pageSizeSelect.selectOption('25')

        // Should have at most 25 rows
        const count = await table.locator('tbody tr').count()
        expect(count).toBeLessThanOrEqual(25)
    })

    test('column headers are clickable for sorting', async ({ page }) => {
        const table = page.locator('[data-testid="validator-table"]')
        await expect(table).toBeVisible({ timeout: 15_000 })

        // Click "Voting Power" header
        const powerHeader = table.locator('th', { hasText: 'Voting Power' })
        await powerHeader.click()

        // Should show sort indicator
        await expect(powerHeader).toContainText(/[↑↓]/)
    })

    test('top 3 validators have gold badge', async ({ page }) => {
        const table = page.locator('[data-testid="validator-table"]')
        await expect(table).toBeVisible({ timeout: 15_000 })

        // First 3 rows should have the val-top3 class
        for (let i = 1; i <= 3; i++) {
            const badge = page.locator(`[data-testid="validator-row-${i}"] .val-top3`)
            await expect(badge).toBeVisible()
        }
    })
})

test.describe('Validators Page — Mobile', () => {
    test('table is scrollable on mobile viewport', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/validators')

        const table = page.locator('[data-testid="validator-table"]')
        await expect(table).toBeVisible({ timeout: 15_000 })

        // Table wrapper should allow horizontal scroll
        const wrapper = page.locator('.val-table-wrap')
        const overflowX = await wrapper.evaluate(el => getComputedStyle(el).overflowX)
        expect(overflowX).toBe('auto')
    })
})
