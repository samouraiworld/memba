import { test, expect } from '@playwright/test'

/**
 * Directory page E2E tests — verify the Organization Hub renders
 * correctly and interactive elements (tabs, search, cards) work.
 *
 * Note: since PR #549 (useResolvedDirectoryDaos), DAO cards are resolved
 * against the ACTIVE NETWORK — each seed/saved DAO is confirmed live via
 * getDAOConfig and dropped if it doesn't resolve. So the rendered DAO count
 * is environment-dependent (it depends on which realms answer on the live
 * chain at run time); these tests assert a `>= 1` floor and the search
 * MECHANISM rather than a fixed count. Token and User tabs require ABCI
 * queries to the network.
 */

test.describe('Directory Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/directory')
    })

    test('page renders with title', async ({ page }) => {
        await expect(page).toHaveTitle(/Directory/)
        await expect(page.locator('h1')).toContainText('Directory')
    })

    test('subtitle is visible', async ({ page }) => {
        await expect(page.locator('.dir-header p')).toContainText('Discover DAOs, tokens, packages, realms, and users')
    })

    test('all tabs are visible', async ({ page }) => {
        const tabs = page.locator('.dir-tab')
        await expect(tabs).toHaveCount(7)
        await expect(tabs.nth(0)).toContainText('DAOs')
        await expect(tabs.nth(1)).toContainText('Tokens')
        await expect(tabs.nth(2)).toContainText('Packages')
        await expect(tabs.nth(3)).toContainText('Realms')
        await expect(tabs.nth(4)).toContainText('Users')
        await expect(tabs.nth(5)).toContainText('GovDAO')
        await expect(tabs.nth(6)).toContainText('Leaderboard')
    })

    test('DAOs tab is active by default', async ({ page }) => {
        const daoTab = page.locator('.dir-tab').first()
        await expect(daoTab).toHaveAttribute('data-active', 'true')
    })
})

test.describe('Directory — DAOs Tab', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/directory')
    })

    test('featured DAOs carousel renders', async ({ page }) => {
        const featured = page.locator('[data-testid="featured-daos"]')
        await expect(featured).toBeVisible({ timeout: 10_000 })

        const cards = featured.locator('[data-testid="featured-dao-card"]')
        const count = await cards.count()
        expect(count).toBeGreaterThanOrEqual(1)
    })

    test('resolved DAO cards are visible', async ({ page }) => {
        // At least one seed DAO (e.g. GovDAO) resolves on the active network.
        // The exact count depends on live resolution (PR #549), so assert the
        // floor, not a fixed number.
        await page.locator('[data-testid="dao-card"]').first().waitFor({ state: 'visible', timeout: 10_000 })
        const cards = page.locator('[data-testid="dao-card"]')
        const count = await cards.count()
        expect(count).toBeGreaterThanOrEqual(1)
    })

    test('DAO search filters results', async ({ page }) => {
        // Cards resolve against the live network (PR #549), so the count is not
        // deterministic. Assert the filter MECHANISM instead: a non-matching
        // query narrows the list to zero, and clearing restores the original
        // resolved set.
        const cards = page.locator('[data-testid="dao-card"]')
        await cards.first().waitFor({ state: 'visible', timeout: 10_000 })
        const before = await cards.count()
        expect(before).toBeGreaterThanOrEqual(1)

        const search = page.locator('[data-testid="dao-search"]')
        await search.fill('ZZZNONEXISTENT_QUERY')
        // Allow useDeferredValue to settle on slow CI runners
        await page.waitForTimeout(500)
        await expect(cards).toHaveCount(0, { timeout: 10_000 })

        // Clear → the originally-resolved cards come back
        await search.clear()
        await page.waitForTimeout(500)
        await expect(cards).toHaveCount(before, { timeout: 10_000 })
    })

    test('non-matching search shows empty state', async ({ page }) => {
        const search = page.locator('[data-testid="dao-search"]')
        await search.fill('ZZZNONEXISTENT')
        await expect(page.locator('.dir-empty')).toBeVisible()
    })

    test('Create DAO button is visible', async ({ page }) => {
        await expect(page.locator('button', { hasText: 'Create DAO' })).toBeVisible()
    })
})

test.describe('Directory — Tab Switching', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/directory')
    })

    test('switching to Tokens tab shows token search', async ({ page }) => {
        await page.locator('.dir-tab', { hasText: 'Tokens' }).click()
        const search = page.locator('[data-testid="token-search"]')
        await expect(search).toBeVisible()
    })

    test('switching to Users tab shows user search', async ({ page }) => {
        await page.locator('.dir-tab', { hasText: 'Users' }).click()
        const search = page.locator('[data-testid="user-search"]')
        await expect(search).toBeVisible()
    })

    test('tab ARIA attributes update on switch', async ({ page }) => {
        const tokensTab = page.locator('.dir-tab', { hasText: 'Tokens' })
        await tokensTab.click()
        await expect(tokensTab).toHaveAttribute('aria-selected', 'true')

        const daosTab = page.locator('.dir-tab', { hasText: 'DAOs' })
        await expect(daosTab).toHaveAttribute('aria-selected', 'false')
    })
})

test.describe('Directory — Mobile', () => {
    test('renders without horizontal overflow at 375px', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/directory')

        await expect(page.locator('h1')).toContainText('Directory')
        // Use documentElement.scrollWidth — more reliable across browsers
        // Firefox may add scrollbar width, so tolerance is 420 (375 + scrollbar + margin)
        const bodyWidth = await page.evaluate(() => document.documentElement.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(420)
    })

    test('tabs are scrollable on mobile', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/directory')

        const tabs = page.locator('.dir-tabs')
        const overflow = await tabs.evaluate(el => getComputedStyle(el).overflowX)
        expect(overflow).toBe('auto')
    })
})

// M4 fix: E2E assertions for v2.2b badge features
test.describe('Directory — v2.2b Badges', () => {
    test('DAO cards display category badges', async ({ page }) => {
        await page.goto('/directory')
        // Wait for seed DAO cards to render
        await page.locator('[data-testid="dao-card"]').first().waitFor({ state: 'visible', timeout: 10_000 })

        // At least one card should have a category badge (GovDAO = governance)
        const badges = page.locator('[data-testid="dao-category"]')
        const count = await badges.count()
        expect(count).toBeGreaterThanOrEqual(1)

        // Verify badge contains a valid category label
        const firstBadge = badges.first()
        const text = await firstBadge.textContent()
        const validCategories = ['Governance', 'Community', 'Treasury', 'DeFi', 'Infra']
        expect(validCategories.some(c => text?.includes(c))).toBe(true)
    })

    test('category badge uses shared inline-badge base class', async ({ page }) => {
        await page.goto('/directory')
        await page.locator('[data-testid="dao-category"]').first().waitFor({ state: 'visible', timeout: 10_000 })

        const badge = page.locator('[data-testid="dao-category"]').first()
        const classes = await badge.getAttribute('class')
        expect(classes).toContain('dir-inline-badge')
        expect(classes).toContain('dir-category-badge')
    })
})
