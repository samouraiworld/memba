import { test, expect } from '@playwright/test'

/**
 * Validators page E2E tests — verify the validator dashboard renders
 * and interactive elements work without backend authentication.
 *
 * Note: These tests run against the dev server. Validator data comes from
 * live Tendermint RPC, so exact values are not asserted — only structure.
 *
 * Some tests are skipped on fresh chains (no validator data yet).
 * They use a helper that checks if the table actually rendered.
 */

test.describe('Validators Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/validators')

        // Skip-on-unavailable: if the RPC is unreachable (common in CI),
        // the page stays on ConnectingLoader. Skip gracefully instead of timeout.
        const loaded = page.locator('[data-testid="validators-page"]')
        const error = page.locator('.val-error')

        await Promise.race([
            loaded.waitFor({ timeout: 25_000 }),
            error.waitFor({ timeout: 25_000 }),
        ]).catch(() => {})

        const loading = page.locator('text=Loading validator data')
        if (await loading.isVisible()) {
            test.skip(true, 'Validator RPC unavailable — page stuck on loading')
        }
        if (await error.isVisible()) {
            test.skip(true, 'Validator RPC returned error')
        }
    })

    test('page renders with title', async ({ page }) => {
        // Title may take a moment to render — use generous timeout
        await expect(page.locator('h1')).toContainText('Validators', { timeout: 10_000 })
    })

    test('chain badge is visible', async ({ page }) => {
        const badge = page.locator('.val-chain-badge')
        await expect(badge).toBeVisible({ timeout: 10_000 })
        await expect(badge).not.toBeEmpty()
    })

    test('network stats cards render', async ({ page }) => {
        const statsGrid = page.locator('[data-testid="network-stats"]')
        await expect(statsGrid).toBeVisible({ timeout: 20_000 })

        // Should have 4 stat cards
        const cards = statsGrid.locator('.val-stat-card')
        await expect(cards).toHaveCount(4)

        // Block height should be a number
        const blockHeight = cards.first().locator('.val-stat-value')
        await expect(blockHeight).not.toBeEmpty()
    })

    test('validator table renders with rows', async ({ page }) => {
        const table = page.locator('[data-testid="validator-table"]')
        await expect(table).toBeVisible({ timeout: 20_000 })

        // Should have at least 1 validator row
        const rows = table.locator('tbody tr')
        const count = await rows.count()
        expect(count).toBeGreaterThan(0)
    })

    test('power distribution bar renders', async ({ page }) => {
        const bar = page.locator('[data-testid="power-distribution"]')
        await expect(bar).toBeVisible({ timeout: 20_000 })

        // Should have segments
        const segments = bar.locator('.val-power-segment')
        const count = await segments.count()
        expect(count).toBeGreaterThan(0)
    })

    test('search filters validators', async ({ page }) => {
        const table = page.locator('[data-testid="validator-table"]')
        await expect(table).toBeVisible({ timeout: 20_000 })

        const initialCount = await table.locator('tbody tr').count()
        if (initialCount === 0) {
            test.skip(true, 'No validators on this chain yet')
            return
        }

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
        await expect(table).toBeVisible({ timeout: 20_000 })

        // Change page size to 25
        const pageSizeSelect = page.locator('[data-testid="validator-page-size"]')
        await pageSizeSelect.selectOption('25')

        // Should have at most 25 rows
        const count = await table.locator('tbody tr').count()
        expect(count).toBeLessThanOrEqual(25)
    })

    test('column headers are clickable for sorting', async ({ page }) => {
        const table = page.locator('[data-testid="validator-table"]')
        await expect(table).toBeVisible({ timeout: 20_000 })

        // Click "Voting Power" header
        const powerHeader = table.locator('th', { hasText: 'Voting Power' })
        await powerHeader.click()

        // Should show sort indicator
        await expect(powerHeader).toContainText(/[↑↓]/)
    })

    test('top 3 validators have gold badge', async ({ page }) => {
        const table = page.locator('[data-testid="validator-table"]')
        await expect(table).toBeVisible({ timeout: 20_000 })

        const rowCount = await table.locator('tbody tr').count()
        if (rowCount < 3) {
            test.skip(true, 'Less than 3 validators on this chain')
            return
        }

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

        // Skip-on-unavailable: same guard as desktop tests — if the RPC is
        // unreachable (test12 halted), the page stays on ConnectingLoader.
        const loaded = page.locator('[data-testid="validators-page"]')
        const error = page.locator('.val-error')

        await Promise.race([
            loaded.waitFor({ timeout: 25_000 }),
            error.waitFor({ timeout: 25_000 }),
        ]).catch(() => {})

        const loading = page.locator('text=Loading validator data')
        if (await loading.isVisible()) {
            test.skip(true, 'Validator RPC unavailable — page stuck on loading')
        }
        if (await error.isVisible()) {
            test.skip(true, 'Validator RPC returned error')
        }

        const table = page.locator('[data-testid="validator-table"]')
        await expect(table).toBeVisible({ timeout: 20_000 })

        // Table wrapper should allow horizontal scroll
        const wrapper = page.locator('.val-table-wrap')
        const overflowX = await wrapper.evaluate(el => getComputedStyle(el).overflowX)
        expect(overflowX).toBe('auto')
    })
})
