import { test, expect, type Page } from '@playwright/test'
import { fulfillOnchainReads, mockChainStatus } from './helpers/onchain'
import { MOBILE_375, expectNoMobileOverflow } from './helpers/overflow'

/**
 * DAO E2E — verifies DAO Hub, GovDAO page, Create DAO, and proposal pages.
 * No wallet required — tests page structure and ABCI data rendering.
 *
 * Fully offline (2026-07-30): EVERY spec fulfills its on-chain reads via the
 * file-level beforeEach below. This file used to be a serial live-RPC suite
 * with only two specs fulfilled; the rest raced live topaz reads (~12s
 * healthy) against 10–20s expect budgets, and one loss cascaded "did not
 * run" through the whole serial chain — under concurrent CI suites (three
 * cycles at once, 2026-07-30, run 30566702351) that redded back-button /
 * View-All / Treasury on every overlapping run while each solo re-run stayed
 * green. With zero live reads the serial worker-cap is pointless too, so the
 * file runs fully parallel and a failure stays scoped to its own spec.
 *
 * The proposal-conditional probes (Health Score, pagination, EXECUTE badge)
 * see the fixture's 0-proposal chain and skip deterministically — same
 * outcome they already had on live topaz, which has no GovDAO proposals.
 * The live-resolution smoke stays in directory-live.spec.ts, alone by design.
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
 *
 * The empty default also serves the non-GovDAO pages this file visits: the
 * hub's per-DAO resolution reads and the members page's detail reads settle
 * as null/[] and render their deterministic fallbacks.
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

// Every spec in this file runs against the offline GovDAO fixture. Register
// before each test (routes are per-context) and before any goto.
test.beforeEach(async ({ page }) => {
    await fulfillGovDaoHome(page)
})

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
        // Pure geometry assertion; the fixture's tier render guarantees the
        // PowerDonut — the flex sibling this regression is about — is in the row.
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
        // The Treasury heading renders unconditionally once the config load
        // settles (DAOTreasuryCard takes only the slug) — structural assertion.
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
        await page.setViewportSize(MOBILE_375)
        await page.goto('/dao')
        await expect(page.getByRole('heading', { name: /DAO Governance/ })).toBeVisible()
        // Wait for a resolved card too, not just the heading: the cards arrive
        // after per-DAO config resolution, so measuring on the heading alone was
        // a coin flip — it passed solo and caught a real clip under parallel load.
        await expect(page.locator('.k-dao-card').first()).toBeVisible()
        await expectNoMobileOverflow(page)
    })

    test('GovDAO page at 375px — no overflow', async ({ page }) => {
        await page.setViewportSize(MOBILE_375)
        await page.goto('/dao/gno.land~r~gov~dao')
        // The stat grid + PowerDonut the file fixture exists to populate are what
        // compete for this row at 375px; wait for the page proper before measuring.
        await expect(page.getByRole('heading', { name: 'GovDAO' })).toBeVisible()
        await expectNoMobileOverflow(page)
    })
})
