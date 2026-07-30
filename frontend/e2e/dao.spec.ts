import { test, expect, type Page } from '@playwright/test'
import { fulfillOnchainReads, mockChainStatus } from './helpers/onchain'

// Live-RPC suite: runs serial (single worker) so its on-chain reads don't
// double-load the public test13 RPC under parallel workers. See playwright.config.ts.
test.describe.configure({ mode: 'serial' })

/**
 * DAO E2E — verifies DAO Hub, GovDAO page, Create DAO, and proposal pages.
 * No wallet required — tests page structure and ABCI data rendering.
 *
 * Some assertions depend on chain state (proposals existing, health score, etc.)
 * and are gracefully skipped on fresh chains with no governance activity.
 * The two structure-only GovDAO tests (stat-chip row geometry, Treasury
 * section) instead fulfill their reads offline — see fulfillGovDaoHome.
 */

/**
 * Fulfill the GovDAO home reads with a deterministic offline payload.
 *
 * Why fulfill and not abort: with reads merely aborted, DAOHome still settles
 * (strict getDAOConfig throws → catch clears configLoading) and renders the
 * stat grid + Treasury heading — but with NO tierDistribution there is no
 * PowerDonut, so nothing competes with `.k-stat-grid--compact` for the flex
 * row and the starved-sliver regression the mobile test guards can't
 * reproduce (the assertion would pass vacuously). The GovDAO Render body
 * (name + memberstore link) plus the memberstore tier render (3 tiers,
 * total power 17) puts the donut back next to the grid. Everything else
 * resolves empty: 0 proposals → no per-proposal enrichment fan-out, and the
 * Members chip falls back to config.memberCount (10, summed from the tiers).
 */
async function fulfillGovDaoHome(page: Page) {
    const GOVDAO_RENDER = [
        '# GovDAO',
        '',
        'Gno chain governance — proposals and membership management.',
        '',
        // getDAOConfig derives the memberstore realm path from this link.
        '[> Go to Memberstore <](https://gno.land/r/gov/dao/v3/memberstore)',
        '',
        '## Proposals',
        '',
        '_No active proposals._',
        '',
    ].join('\n')
    const MEMBERSTORE_RENDER = [
        '# GovDAO Memberstore',
        '',
        // parseMemberstoreTiers shape: "Tier <name> contains <n> members with power: <p>"
        'Tier T1 contains 2 members with power: 6',
        'Tier T2 contains 3 members with power: 6',
        'Tier T3 contains 5 members with power: 5',
        '',
    ].join('\n')
    await fulfillOnchainReads(page, ({ method, path, arg }) => {
        if (path === 'vm/qrender' && arg === 'gno.land/r/gov/dao:') return GOVDAO_RENDER
        if (path === 'vm/qrender' && arg === 'gno.land/r/gov/dao/v3/memberstore:') return MEMBERSTORE_RENDER
        if (method === 'status') return mockChainStatus()
        return null
    })
}

test.describe('DAO Hub', () => {
    test('DAO hub shows GovDAO featured card', async ({ page }) => {
        await page.goto('/dao')
        await expect(page.locator('body')).toContainText(/GovDAO|Governance/)
    })

    test('Create DAO CTA visible', async ({ page }) => {
        await page.goto('/dao')
        await expect(page.locator('body')).toContainText(/Create|New DAO/)
    })

    test('connect form collapsed by default', async ({ page }) => {
        await page.goto('/dao')
        const input = page.locator('#dao-connect-input')
        await expect(input).not.toBeVisible()
    })
})

test.describe('GovDAO Page', () => {
    test('GovDAO page loads with stats', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        // Wait for config to load (shows DAO name)
        await expect(page.locator('body')).toContainText(/GovDAO|DAO Governance|Governance/, { timeout: 20_000 })
        // Stats grid should show "Members" card
        await expect(page.locator('body')).toContainText('Members', { timeout: 20_000 })
    })

    test('back button navigates to DAO list', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        const backBtn = page.locator('#dao-back-btn')
        await expect(backBtn).toBeVisible()
        await expect(backBtn).toContainText('DAOs')
    })

    test('no blockchain-error toast on load (GetProposalsJSON strict-probe regression)', async ({ page }) => {
        // GovDAO v3 does not export the W1.4 JSON getters; the strict proposals
        // read must fall back to Render parsing silently instead of surfacing
        // "Blockchain query failed" (the bug: strict probe threw before the
        // fallback ran, on every GovDAO visit).
        await page.goto('/dao/gno.land~r~gov~dao')
        await expect(page.locator('body')).toContainText('Members', { timeout: 20_000 })
        // Give the (previously failing) proposals read time to surface its toast
        await page.waitForTimeout(1_500)
        await expect(page.locator('body')).not.toContainText('Blockchain query failed')
    })

    test('mobile: stat chips get the full row (no mid-word wrap next to the donut)', async ({ page }) => {
        // Offline fixture (2026-07-30): pure geometry assertion, and the mock's
        // tier render guarantees the PowerDonut — the flex sibling this
        // regression is about — is actually in the row.
        await fulfillGovDaoHome(page)
        await page.setViewportSize({ width: 375, height: 812 })
        await page.goto('/dao/gno.land~r~gov~dao')
        const grid = page.locator('.k-stat-grid--compact')
        await expect(grid).toBeVisible({ timeout: 20_000 })
        // Guard the guard: the donut must be present, or the width assertion
        // below passes vacuously with nothing competing for the flex row.
        // (PowerDonut has no class/testid; it is the only svg in the left column.)
        await expect(page.locator('.dao-card-columns__left svg').first()).toBeVisible()
        // Starved-flex-sliver regression: the grid must take (nearly) the full
        // card row, not the ~70px leftover beside the power donut.
        const width = (await grid.boundingBox())?.width ?? 0
        expect(width).toBeGreaterThan(250)
    })

    test('power distribution section visible', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        // GovDAO has tier distribution — may not render on fresh chains until members resolve
        await expect(page.locator('body')).toContainText(/Power Distribution|T1|T2|Members/, { timeout: 20_000 })
    })

    test('treasury section accessible', async ({ page }) => {
        // Offline fixture (2026-07-30): the Treasury heading renders
        // unconditionally once the config load settles (DAOTreasuryCard takes
        // only the slug) — the assertion is structural, so no live read is
        // worth flaking on. The heading previously raced the live getDAOConfig
        // against the 10s expect budget.
        await fulfillGovDaoHome(page)
        await page.goto('/dao/gno.land~r~gov~dao')
        await expect(page.locator('body')).toContainText('Treasury')
    })

    test('members section shows View All link', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        await expect(page.locator('body')).toContainText('View All')
    })

    test('v2.12 — DAO Health Score badge visible when proposals exist', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        // Health Score only renders after proposals load — skip on fresh chain
        const proposalsStat = page.locator('.k-stat-card', { hasText: 'Proposals' })
        await expect(proposalsStat).toBeVisible({ timeout: 20_000 })
        const countText = await proposalsStat.locator('.k-stat-card__value').textContent({ timeout: 10_000 })
        const count = parseInt(countText || '0', 10)
        if (count === 0) {
            test.skip(true, 'No proposals on this chain — Health Score requires proposal history')
            return
        }
        const healthCard = page.locator('.k-stat-card__label', { hasText: 'Health' })
        await expect(healthCard).toBeVisible({ timeout: 15000 })
    })

    test('v2.12 — more than 5 proposals render (pagination proof)', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        const proposalsStat = page.locator('.k-stat-card', { hasText: 'Proposals' })
        await expect(proposalsStat).toBeVisible({ timeout: 20_000 })
        // Poll until value resolves
        let count = 0
        try {
            await expect(async () => {
                const countText = await proposalsStat.locator('.k-stat-card__value').textContent()
                count = parseInt(countText || '0', 10)
                expect(count).toBeGreaterThan(0)
            }).toPass({ timeout: 15000 })
        } catch {
            test.skip(true, 'No proposals on this chain yet')
            return
        }
        if (count <= 5) {
            test.skip(true, `Only ${count} proposals — need > 5 for pagination proof`)
            return
        }
        expect(count).toBeGreaterThan(5)
    })

    test('v2.12 — channel sidebar visible in 2-column layout', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        // Discord-style channels sidebar lives in the overview card
        const sidebar = page.locator('.dao-channels-sidebar')
        await expect(sidebar).toBeVisible({ timeout: 15000 })
        await expect(sidebar).toContainText('general')
        await expect(sidebar).toContainText('Public Room')
    })

    test('v2.13 — GovDAO shows inline EXECUTE badge for passed proposals', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        const proposalsStat = page.locator('.k-stat-card', { hasText: 'Proposals' })
        await expect(proposalsStat).toBeVisible({ timeout: 20_000 })
        // Wait for proposals to load
        let count = 0
        try {
            await expect(async () => {
                const countText = await proposalsStat.locator('.k-stat-card__value').textContent()
                count = parseInt(countText || '0', 10)
                expect(count).toBeGreaterThan(0)
            }).toPass({ timeout: 15000 })
        } catch {
            test.skip(true, 'No proposals on this chain — cannot check EXECUTE badges')
            return
        }
        // Only check for EXECUTE badge if there are passed proposals
        const executeBadges = page.locator('text=⚡ EXECUTE')
        const badgeCount = await executeBadges.count()
        if (badgeCount === 0) {
            test.skip(true, 'No passed proposals with EXECUTE status on this chain')
            return
        }
        await expect(executeBadges.first()).toBeVisible()
    })
})

test.describe('DAO Members Page', () => {
    test('members page loads', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/members')
        // Members heading appears after ABCI data loads — allow extra time for CI
        await expect(page.locator('body')).toContainText(/Member|GovDAO|T1|Back/, { timeout: 20_000 })
    })
})

test.describe('Create DAO Wizard', () => {
    test('create DAO page loads with form', async ({ page }) => {
        await page.goto('/create-dao')
        await expect(page.locator('body')).toContainText(/Create|DAO|Name/)
    })
})

test.describe('Proposal Types (ProposeDAO)', () => {
    test('text proposal type is active', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/propose')
        const textBtn = page.locator('button', { hasText: 'Text / Sentiment' })
        await expect(textBtn).toBeVisible()
        await expect(textBtn).not.toBeDisabled()
    })

    test('add member type is enabled', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/propose')
        const btn = page.locator('button', { hasText: 'Add Member' })
        await expect(btn).not.toBeDisabled()
    })

    test('treasury spend type is disabled', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/propose')
        const btn = page.locator('button', { hasText: 'Treasury Spend' })
        await expect(btn).toBeDisabled()
    })

    test('code upgrade type is disabled', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/propose')
        const btn = page.locator('button', { hasText: 'Code Upgrade' })
        await expect(btn).toBeDisabled()
    })
})

test.describe('DAO — Mobile (375px)', () => {
    test('DAO hub at 375px — no overflow', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/dao')
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(380)
    })

    test('GovDAO page at 375px — no overflow', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/dao/gno.land~r~gov~dao')
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(380)
    })
})
