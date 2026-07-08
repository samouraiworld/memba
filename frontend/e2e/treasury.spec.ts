import { test, expect, type Page } from '@playwright/test'
import { GNO_RPC_HOSTS, abortOnchainReads } from './helpers/onchain'

/**
 * Treasury E2E — verifies the treasury page renders for GovDAO. No wallet, no
 * live on-chain reads.
 *
 * History: the old body-text assertion (`toContainText(/Treasury|Balance|Asset/)`)
 * flaked in CI. That text only appears once the page leaves its loading state
 * (the loading branch is text-less <SkeletonCard>s), which requires the live
 * getDAOConfig + getDAOMembers reads against the public test13 RPC to settle.
 * On a slow/variable RPC (and with the backend proxy returning ECONNREFUSED) the
 * reads intermittently missed the 10s expect timeout across all 3 retries, and
 * which PR failed shifted run-to-run as public-RPC contention varied.
 *
 * Fix: the shared `abortOnchainReads` fixture (e2e/helpers/onchain.ts) aborts the
 * gno RPC / indexer hosts so those reads reject instantly. Treasury.tsx catches
 * the failure and drops out of `loading`, rendering its deterministic shell
 * ("💰 Treasury" heading + back button) with zero RPC dependency, and we assert
 * on stable elements instead of racing body text. The populated-grid describe
 * below instead *fulfills* the reads to exercise the assets table.
 */
test.describe('Treasury Page', () => {
    test.beforeEach(async ({ page }) => {
        await abortOnchainReads(page)
    })

    test('treasury page loads for GovDAO', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/treasury')
        await expect(page.getByRole('heading', { name: /Treasury/ })).toBeVisible()
    })

    test('treasury page has back navigation', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/treasury')
        await expect(page.locator('#treasury-back-btn')).toBeVisible()
    })
})

// Mirrors GRC20_FACTORY_PATH in frontend/src/lib/config.ts.
const GRC20_FACTORY_PATH = 'gno.land/r/samcrew/tokenfactory_v2'

/**
 * Fulfill the treasury's on-chain reads with a deterministic, fully-offline
 * populated payload so the assets TABLE renders (not the empty-state shell).
 *
 * Why this exists (follow-up to the abort helper): aborting every gno RPC host
 * drops Treasury.tsx straight into its "No assets found" empty state, so the
 * `1fr 1fr 1fr` assets grid — with its long monospace GNOT/GRC20 balances, the
 * most plausible source of mobile horizontal overflow — was no longer exercised
 * by the ≤380px assertion. Rather than abort, we intercept the same hosts
 * (GNO_RPC_HOSTS) and *fulfill* the specific abci_query calls Treasury makes,
 * keeping the test 100% offline while restoring populated-grid coverage.
 *
 * The reads Treasury.tsx issues (see loadTreasury):
 *  - GNOT: a `bank/balances/<realm>` abci_query. The page reads
 *    ResponseBase.Value||Data, atob()s it, and matches /(\d+)ugnot/.
 *  - GRC20 list: listFactoryTokens → vm/qrender of the tokenfactory realm,
 *    parsed from markdown `- [Name \($SYMBOL\)](link)`.
 *  - GRC20 balance: getTokenBalance → vm/qeval `BalanceOf(...)`, parsed from
 *    `(<n> int64)`.
 *  - Everything else (getDAOConfig / getDAOMembers / username qrender+qeval) is
 *    replied EMPTY so those reads resolve to null/[] — the page still leaves
 *    `loading` (config name just falls back to "DAO"), no live dependency.
 */
async function fulfillPopulatedTreasury(page: Page) {
    const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64')
    const abci = (dataB64: string, id: unknown) => ({
        jsonrpc: '2.0',
        id,
        result: { response: { ResponseBase: { Error: null, Data: dataB64, Log: '', Info: '', Events: null } } },
    })

    // Deterministic populated treasury: one GNOT balance + one long-balance GRC20
    // token. Both balances are intentionally long so the grid's right-aligned
    // monospace balance column is a real overflow candidate at 375px.
    const GNOT_UGNOT = '123456789123456789'            // shown comma-grouped: 123,456,789,123,456,789
    const TOKEN_SYMBOL = 'MEMBATEST'
    const TOKEN_NAME = 'Memba Community Reserve'
    const TOKEN_BALANCE = '918273645091827364509182'   // 24-digit long monospace balance
    const TOKEN_LIST_MD = `# GRC20 Tokens (1)\n- [${TOKEN_NAME} \\($${TOKEN_SYMBOL}\\)](/r/samcrew/tokenfactory_v2:${TOKEN_SYMBOL})\n`

    await page.route('**/*', async route => {
        const req = route.request()
        if (!GNO_RPC_HOSTS.some(re => re.test(req.url()))) return route.continue()

        // Parse the JSON-RPC abci_query body so we can shape a matching reply.
        let body: { id?: unknown; params?: { path?: string; data?: string } } = {}
        try { body = JSON.parse(req.postData() || '{}') } catch { /* non-JSON hit on an RPC host */ }
        const id = body?.id
        const path = body?.params?.path ?? ''
        // For vm/qrender / vm/qeval the query arg is base64(text); bank/balances sends "".
        let arg = ''
        try { arg = body?.params?.data ? Buffer.from(body.params.data, 'base64').toString('utf-8') : '' } catch { /* not base64 */ }

        const reply = (dataB64: string) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(abci(dataB64, id)) })

        // 1. GNOT balance.
        if (path.startsWith('bank/balances/')) return reply(b64(`${GNOT_UGNOT}ugnot`))
        // 2. GRC20 balance (vm/qeval BalanceOf).
        if (path === 'vm/qeval' && arg.includes('BalanceOf(')) return reply(b64(`(${TOKEN_BALANCE} int64)\n`))
        // 3. GRC20 token list (vm/qrender of the factory realm's Render("")).
        if (path === 'vm/qrender' && arg.startsWith(`${GRC20_FACTORY_PATH}:`)) return reply(b64(TOKEN_LIST_MD))
        // Everything else (DAO config/members/username reads): reply empty →
        // null/[] on the client, page still leaves loading, stays fully offline.
        return reply('')
    })
}

test.describe('Treasury Page — populated assets grid', () => {
    test.beforeEach(async ({ page }) => {
        await fulfillPopulatedTreasury(page)
    })

    // Primary value: this deterministically exercises the POPULATED assets-table
    // render path (mock → listFactoryTokens/getTokenBalance/GNOT parse → the
    // `1fr 1fr 1fr` grid with long monospace balances). The abort variant only
    // ever rendered the empty-state shell, so a break in that render path — or a
    // parse regression on the balance columns — went uncaught by the ≤380 check.
    //
    // On the ≤380 assertion, be honest about what it does and does NOT prove: the
    // app clips horizontal overflow at the root (index.css `body{overflow-x:hidden;
    // max-width:100vw}`) and WRAPS long values (`.k-card{overflow-wrap:anywhere}`),
    // so document.body.scrollWidth is structurally clamped to the viewport. This is
    // therefore a page-level "no horizontal scroll at 375px, grid populated"
    // INVARIANT guard — it fails if a future change removes that root clip/wrap
    // safety net and a long balance starts pushing the page wide. It is NOT a
    // fine-grained probe that the grid cell itself can't overflow (the root clip
    // masks that); don't read a pass as "the columns provably fit".
    test('treasury at 375px — populated grid renders, no page h-scroll', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
        await page.goto('/dao/gno.land~r~gov~dao/treasury')
        // Wait for the POPULATED grid (not the empty-state shell) before measuring:
        // the GRC20 symbol + a long balance only render once the assets table is up.
        await expect(page.getByText('$MEMBATEST')).toBeVisible()
        await expect(page.getByText('918,273,645,091,827,364,509,182')).toBeVisible()
        // Guard: we must be exercising the grid, not the "No assets found" empty state.
        await expect(page.getByText('No assets found in treasury')).toHaveCount(0)
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
        expect(bodyWidth).toBeLessThanOrEqual(380)
    })
})
