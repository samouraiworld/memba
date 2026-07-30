import { test, expect, type Page } from '@playwright/test'
import { fulfillOnchainReads, mockChainStatus } from './helpers/onchain'

// Live-RPC suite: runs serial (single worker) so its on-chain reads don't
// double-load the public test13 RPC under parallel workers. See playwright.config.ts.
test.describe.configure({ mode: 'serial' })

/**
 * Validators page E2E tests — verify the validator dashboard renders
 * and interactive elements work without backend authentication.
 *
 * Note: the desktop tests run against the live Tendermint RPC, so exact
 * values are not asserted — only structure — and they skip gracefully when
 * the RPC is unreachable. The mobile card-roster test instead fulfills its
 * reads offline (fulfillValidatorRoster): its assertion is the cards-vs-table
 * split, pure structure, and under public-RPC contention the live reads blew
 * its budget across unrelated PRs (2026-07-30 CI incident).
 */

/**
 * Fulfill the validators page's reads with a deterministic 3-validator
 * roster. The page renders once GET /validators (page 1) and GET /status
 * succeed — everything else degrades gracefully, but is fulfilled anyway so
 * nothing in the test touches the network:
 *  - /block (~100 calls for the signature window) — same body for any height,
 *    every validator signs → health "Healthy" and no abort-retry latency;
 *  - /net_info — one peer, so the 5-card stat grid keeps its Network card;
 *  - abci_query (valopers qrender) — empty → the on-chain moniker overlay
 *    just stays absent;
 *  - monitoring.gnolove.world (NOT a GNO_RPC_HOSTS host — layered route,
 *    registered first so fulfillOnchainReads' fallback() reaches it) — [] →
 *    cards simply carry no uptime enrichment.
 */
async function fulfillValidatorRoster(page: Page) {
    const validator = (n: number, power: string) => ({
        address: `g1mockval000000000000000000000000000000${n}`,
        pub_key: { '@type': '/tm.PubKeyEd25519', value: `bW9ja3B1YmtleTAwMDAwMDAwMDAwMDAwMDAwMDA${n}=` },
        voting_power: power,
        proposer_priority: '0',
    })
    const VALIDATORS = {
        block_height: '435604',
        validators: [validator(1, '30'), validator(2, '20'), validator(3, '10')],
    }
    const BLOCK = {
        block: {
            header: { chain_id: 'e2e-offline', height: '435594', time: '2026-07-30T11:59:40.000Z' },
            // tm2 commits carry `precommits`, not `signatures`.
            last_commit: {
                precommits: [1, 2, 3].map(n => ({
                    type: 2,
                    height: '435593',
                    round: '0',
                    validator_address: `g1mockval000000000000000000000000000000${n}`,
                    validator_index: String(n - 1),
                    timestamp: '2026-07-30T11:59:40.000Z',
                })),
            },
        },
    }
    const NET_INFO = {
        listening: true,
        listeners: ['Listener(@)'],
        n_peers: '1',
        peers: [{
            node_info: {
                net_address: 'g1mockpeer0000000000000000000000000000001@203.0.113.7:26656',
                network: 'e2e-offline',
                moniker: 'e2e-peer-01',
                other: { tx_index: 'off', rpc_address: 'tcp://203.0.113.7:26657' },
            },
            is_outbound: false,
            remote_ip: '203.0.113.7',
        }],
    }

    await page.route(/monitoring\.gnolove\.world/, route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await fulfillOnchainReads(page, ({ method }) => {
        if (method === 'validators') return VALIDATORS
        if (method === 'status') return mockChainStatus()
        if (method === 'block') return BLOCK
        if (method === 'net_info') return NET_INFO
        return null
    })
}

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

        // Should have 5 stat cards
        const cards = statsGrid.locator('.val-stat-card')
        await expect(cards).toHaveCount(5)

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
    test('roster renders as cards (not the dense table) on mobile viewport', async ({ page }) => {
        // Offline fixture (2026-07-30): the assertion is the cards-vs-table
        // split at a phone viewport — structure, not chain state — so the
        // roster is fulfilled deterministically and the old skip-on-unavailable
        // guard is gone: this test now always runs, and a failure means the
        // mobile split broke, not that the public RPC had a bad day.
        await fulfillValidatorRoster(page)
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/validators')

        // On a phone the roster is vertical cards, and the desktop table — which
        // forced horizontal scroll across 6-13 columns — is not rendered at all
        // (useIsMobile branches the DOM; the table isn't merely display:none).
        const cards = page.locator('[data-testid="validator-cards"]')
        await expect(cards).toBeVisible({ timeout: 20_000 })
        // Pin a real card, not just the container: an empty roster only fails
        // the container check because a bare .val-cards div happens to have
        // zero height — that's load-bearing CSS, not a guard. Rank 1 exists
        // deterministically under the 3-validator fixture.
        await expect(page.locator('[data-testid="validator-card-1"]')).toBeVisible()
        await expect(page.locator('[data-testid="validator-table"]')).toHaveCount(0)
        expect(await page.locator('.val-card').count()).toBeGreaterThan(0)
    })
})
