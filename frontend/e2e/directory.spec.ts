import { test, expect, type Page } from '@playwright/test'
import { fulfillOnchainReads, mockChainStatus } from './helpers/onchain'

// Serial (single worker): the realm source view still ASSERTS on live public-
// RPC reads, and ChainMetricsBanner (mounted unconditionally on /directory)
// makes every non-fulfilled navigation in this file read /status +
// /validators + /block live — single-worker keeps that load off two parallel
// workers. The DAO-card blocks fulfill their reads offline, which removes the
// ASSERTION coupling to the RPC, not all RPC traffic. The live-resolution
// smoke lives in directory-live.spec.ts (its own file, so its failure can't
// cascade through this serial group). See playwright.config.ts.
test.describe.configure({ mode: 'serial' })

/**
 * Directory page E2E tests — verify the Organization Hub renders
 * correctly and interactive elements (tabs, search, cards) work.
 *
 * Note: since PR #549 (useResolvedDirectoryDaos), DAO cards are resolved
 * against the ACTIVE NETWORK — each seed/saved DAO is confirmed live via a
 * per-DAO Render("") and dropped if it doesn't resolve. The DAO-card blocks
 * below assert tab STRUCTURE (grid, search mechanism, badges), so they fulfill
 * that resolution offline (fulfillSeedDaoRenders) — under public-RPC
 * contention the live reads blew their 10s budgets across unrelated PRs
 * (2026-07-30: five concurrent CI suites vs the topaz RPC while the
 * samourai.live fallback served 503). The end-to-end proof that seed DAOs
 * really resolve on the live network is exactly one test, in
 * directory-live.spec.ts.
 */

/**
 * Fulfill the DAOs tab's per-DAO resolution reads — one vm/qrender Render("")
 * per seed/saved DAO (useResolvedDirectoryDaos) — so every seed DAO resolves
 * offline. Card name/category come from the static seed list and the render
 * body only feeds parseDAORender metadata (description, member/proposal
 * counts), so one generic body per pkgpath keeps the tab's structure
 * byte-deterministic. Everything else answers empty (null on the client).
 */
async function fulfillSeedDaoRenders(page: Page) {
    await fulfillOnchainReads(page, ({ method, path }) => {
        if (path === 'vm/qrender') {
            return '# DAO\n\nDeterministic e2e directory fixture — this realm resolves on every network.\n\nMembers: 12\nProposals: 3\n'
        }
        if (method === 'status') return mockChainStatus()
        return null
    })
}

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

    test('all tabs are visible (W5.2 order: Packages first)', async ({ page }) => {
        const tabs = page.locator('.dir-tab')
        await expect(tabs).toHaveCount(7)
        await expect(tabs.nth(0)).toContainText('Packages')
        await expect(tabs.nth(1)).toContainText('DAOs')
        await expect(tabs.nth(2)).toContainText('Realms')
        await expect(tabs.nth(3)).toContainText('Tokens')
        await expect(tabs.nth(4)).toContainText('Users')
        await expect(tabs.nth(5)).toContainText('GovDAO')
        await expect(tabs.nth(6)).toContainText('Leaderboard')
    })

    test('Packages tab is active by default (W5.2)', async ({ page }) => {
        const firstTab = page.locator('.dir-tab').first()
        await expect(firstTab).toContainText('Packages')
        await expect(firstTab).toHaveAttribute('data-active', 'true')
    })

    test('?tab=daos deep link still opens DAOs', async ({ page }) => {
        await page.goto('/directory?tab=daos')
        const daosTab = page.locator('.dir-tab', { hasText: 'DAOs' })
        await expect(daosTab).toHaveAttribute('data-active', 'true')
    })
})

test.describe('Directory — DAOs Tab', () => {
    test.beforeEach(async ({ page }) => {
        // Structure-only block: resolution is fulfilled offline (see header).
        await fulfillSeedDaoRenders(page)
        // W5.2: DAOs is no longer the landing tab — deep-link to it.
        await page.goto('/directory?tab=daos')
    })

    test('featured DAOs carousel renders', async ({ page }) => {
        const featured = page.locator('[data-testid="featured-daos"]')
        await expect(featured).toBeVisible({ timeout: 10_000 })

        const cards = featured.locator('[data-testid="featured-dao-card"]')
        const count = await cards.count()
        expect(count).toBeGreaterThanOrEqual(1)
    })

    test('resolved DAO cards render as a grid', async ({ page }) => {
        // Every seed DAO resolves under the fixture; assert the ≥1 floor (the
        // seed list's size is not this test's contract). The live-network
        // resolution proof is the smoke below, not this test.
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
    test.beforeEach(async ({ page }) => {
        // Badges come from the static seed list's category — structure-only,
        // so resolution is fulfilled offline like the DAOs Tab block.
        await fulfillSeedDaoRenders(page)
    })

    test('DAO cards display category badges', async ({ page }) => {
        // W5.2: DAO cards live behind the daos deep link now.
        await page.goto('/directory?tab=daos')
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
        await page.goto('/directory?tab=daos')
        await page.locator('[data-testid="dao-category"]').first().waitFor({ state: 'visible', timeout: 10_000 })

        const badge = page.locator('[data-testid="dao-category"]').first()
        const classes = await badge.getAttribute('class')
        expect(classes).toContain('dir-inline-badge')
        expect(classes).toContain('dir-category-badge')
    })
})

// W5.2: realm source view — the drawer must render Source + Info from the
// chain RPC (vm/qfile). Regression coverage for the CORS-caused
// "Source code not available" / "Source metadata not available" failures
// (gnoweb serves no CORS headers; the RPC path does).
test.describe('Directory — Realm Source View (W5.2)', () => {
    test('drawer shows source files and metadata for a known realm', async ({ page }) => {
        await page.goto('/directory?tab=realms')

        // Narrow to a seed realm known-good on topaz, the default network
        // (memba_dao only appears when saved in localStorage; the gno.land Blog
        // is in SEED_REALMS and ships in the topaz genesis — verified via
        // vm/qfile 2026-07-26). tokenfactory_v2 is NOT on topaz until the
        // commerce ceremony, so it can't be the live-read target anymore.
        const search = page.locator('[data-testid="realm-search"]')
        await search.fill('blog')
        const card = page.locator('[data-testid="realm-card"]').first()
        await card.waitFor({ state: 'visible', timeout: 10_000 })

        // Expand the card, open the detail drawer
        await card.locator('.dir-card__header').click()
        await page.locator('.dir-render-preview__link--primary', { hasText: 'View Details' })
            .click({ timeout: 15_000 })

        // Source tab: real file tabs + code, not the unavailable state
        await page.locator('.drawer-tab', { hasText: 'Source' }).click()
        await expect(page.locator('.source-view')).toBeVisible({ timeout: 20_000 })
        await expect(page.locator('.source-tab').first()).toContainText('.gno')
        await expect(page.locator('.drawer-empty')).toHaveCount(0)

        // Info tab: file tree + functions render (metadata available)
        await page.locator('.drawer-tab', { hasText: 'Info' }).click()
        await expect(page.getByText('Source metadata not available.')).toHaveCount(0)
    })
})
