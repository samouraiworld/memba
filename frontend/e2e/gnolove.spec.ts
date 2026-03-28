import { test, expect } from '@playwright/test'

/**
 * Gnolove section E2E tests — verify the contributor analytics section
 * renders correctly and sub-navigation works.
 *
 * Note: Data comes from the gnolove Go API (backend.gnolove.world).
 * Tests are structured to skip gracefully if the API is unreachable.
 *
 * Routes tested:
 *   /gnolove          → GnoloveHome (scoreboard)
 *   /gnolove/report   → GnoloveReport (weekly PRs)
 *   /gnolove/analytics → GnoloveAnalytics (charts)
 *   /gnolove/teams    → GnoloveTeams (team breakdown)
 */

test.describe('Gnolove Section', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/gnolove')
        // Wait for either content or loading state to resolve
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    })

    test('home page renders with title', async ({ page }) => {
        await expect(page.locator('.gl-title')).toContainText('Contributors', { timeout: 10_000 })
    })

    test('time filter buttons render', async ({ page }) => {
        const filterGroup = page.locator('.gl-filter-group').first()
        await expect(filterGroup).toBeVisible({ timeout: 10_000 })

        // Should have 4 time filter buttons (All Time, This Year, This Month, This Week)
        const buttons = filterGroup.locator('.gl-filter-btn')
        await expect(buttons).toHaveCount(4)
    })

    test('team filter buttons render', async ({ page }) => {
        // Second filter group is the team filter
        const filterGroups = page.locator('.gl-filter-group')
        const teamFilterGroup = filterGroups.nth(1)
        await expect(teamFilterGroup).toBeVisible({ timeout: 10_000 })

        // Should have 8 team buttons
        const buttons = teamFilterGroup.locator('.gl-filter-btn')
        const count = await buttons.count()
        expect(count).toBe(8)
    })

    test('leaderboard section renders', async ({ page }) => {
        const sectionTitle = page.locator('.gl-section-title', { hasText: 'Contributor Leaderboard' })
        await expect(sectionTitle).toBeVisible({ timeout: 15_000 })
    })

    test('navigates to report page', async ({ page }) => {
        // Click the "Report" link in sub-nav
        const reportLink = page.locator('a[href="/gnolove/report"]')
        await expect(reportLink).toBeVisible({ timeout: 10_000 })
        await reportLink.click()

        await expect(page).toHaveURL(/\/gnolove\/report/)
        // Report page should render without errors
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    })

    test('navigates to analytics page', async ({ page }) => {
        const analyticsLink = page.locator('a[href="/gnolove/analytics"]')
        await expect(analyticsLink).toBeVisible({ timeout: 10_000 })
        await analyticsLink.click()

        await expect(page).toHaveURL(/\/gnolove\/analytics/)
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    })

    test('navigates to teams page', async ({ page }) => {
        const teamsLink = page.locator('a[href="/gnolove/teams"]')
        await expect(teamsLink).toBeVisible({ timeout: 10_000 })
        await teamsLink.click()

        await expect(page).toHaveURL(/\/gnolove\/teams/)
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    })

    test('team filter toggles visually', async ({ page }) => {
        const filterGroups = page.locator('.gl-filter-group')
        const teamFilterGroup = filterGroups.nth(1)
        await expect(teamFilterGroup).toBeVisible({ timeout: 10_000 })

        // First team button should start with --active class (all teams included by default)
        const firstTeamBtn = teamFilterGroup.locator('.gl-filter-btn').first()
        await expect(firstTeamBtn).toHaveClass(/gl-filter-btn--active/, { timeout: 5_000 })

        // Click to toggle it off (exclude team)
        await firstTeamBtn.click()

        // After clicking, the --active class should be removed
        await expect(firstTeamBtn).not.toHaveClass(/gl-filter-btn--active/, { timeout: 5_000 })
    })

    test('activity feed section is collapsible', async ({ page }) => {
        // Activity feed may or may not be present (depends on live data)
        const activityToggle = page.locator('.gl-section-toggle', { hasText: 'Activity Feed' })
        const isVisible = await activityToggle.isVisible().catch(() => false)

        if (isVisible) {
            // Click to expand
            await activityToggle.click()
            const activityFeed = page.locator('.gl-activity-feed')
            await expect(activityFeed).toBeVisible({ timeout: 5_000 })

            // Click again to collapse
            await activityToggle.click()
            await expect(activityFeed).not.toBeVisible({ timeout: 5_000 })
        }
    })
})

test.describe('Gnolove Section — Mobile', () => {
    test('renders on mobile viewport', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/gnolove')
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})

        await expect(page.locator('.gl-title')).toContainText('Contributors', { timeout: 10_000 })
    })
})
