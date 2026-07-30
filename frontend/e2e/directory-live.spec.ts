import { test, expect } from '@playwright/test'

/**
 * Live-chain smoke — the ONE directory test that keeps a genuine live-RPC
 * dependency: it proves seed DAOs actually resolve against the active network
 * end-to-end (per-DAO Render("") on the public RPC — PR #549's behavior).
 * Everything DAO-card-shaped in directory.spec.ts runs on the offline fixture
 * (fulfillSeedDaoRenders) instead.
 *
 * It lives in its own file so a bad-RPC day fails/retries THIS test alone:
 * inside directory.spec.ts's file-level serial group, a failure here would
 * skip every test after it and each retry would re-run the whole file —
 * multiplying live-RPC load exactly when the RPC is starving (2026-07-30
 * incident: five concurrent CI suites + a 503ing fallback starved the public
 * topaz RPC; 4/5 runs failed on 10s budgets, and a healthy unloaded
 * resolution already measures ~11.7s).
 *
 * Containment:
 *  - chromium-only — CI's full-suite job already runs chromium only, so this
 *    costs CI nothing; it keeps local chromium+firefox runs from doubling
 *    the live reads;
 *  - 30s resolution budget + 75s test budget — headroom for primary→fallback
 *    rotation (up to 8s per attempt, rpcFallback.ts RPC_TIMEOUT) plus the
 *    post-hoc probe, clear of the 45s config default;
 *  - on a miss, skip (not fail) ONLY when the RPC is provably unreachable
 *    (no URL answers the probing read within 5s) — an offline public testnet
 *    is not a frontend regression. The probe runs
 *    AFTER the failed wait, never before (a pre-flight probe that
 *    false-negatives under load would silently skip this smoke forever); it
 *    probes BOTH the primary and the fallback (the app fails over, so a miss
 *    with a live fallback is a real regression, not an outage); and it sends
 *    the same vm/qrender read the page failed on, not /health (a saturated
 *    node answers /health in ms while starving the vm reads).
 */

// Mirrors NETWORKS.topaz rpcUrl + fallbackRpcUrls in frontend/src/lib/config.ts
// (their ":443" suffix is the https default and normalizes away). CI runs
// env-less, so topaz is the active network there; a local root .env pointing
// elsewhere already breaks every live-chain spec in the suite.
const TOPAZ_RPC_URLS = [
    'https://rpc.topaz.testnets.gno.land',
    'https://rpc.topaz.samourai.live',
]

test.describe('Directory — live chain resolution (smoke)', () => {
    test('resolved DAO cards are visible', async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'live smoke runs on one browser to halve public-RPC load')
        test.setTimeout(75_000)

        // Since #1027 an unreachable chain no longer DROPS a DAO — it renders
        // a degraded card (same dao-card testid, plus a dao-degraded chip). A
        // bare dao-card wait would therefore pass with the RPC fully down;
        // live resolution is only proven by a card WITHOUT the degraded chip.
        const resolvedCard = page.locator('[data-testid="dao-card"]:not(:has([data-testid="dao-degraded"]))')

        await page.goto('/directory?tab=daos')
        try {
            // At least one seed DAO (e.g. GovDAO) resolves on the active
            // network. The exact count depends on live resolution, so assert
            // the floor.
            await resolvedCard.first().waitFor({ state: 'visible', timeout: 30_000 })
        } catch (err) {
            // The read shape the page just failed on, against every URL the
            // app's failover would try. ANY 200 proves the infra could have
            // served the resolution → rethrow the miss as a real failure.
            const answers = await Promise.all(TOPAZ_RPC_URLS.map(url =>
                page.request
                    .post(url, {
                        data: {
                            jsonrpc: '2.0',
                            id: 1,
                            method: 'abci_query',
                            params: { path: 'vm/qrender', data: Buffer.from('gno.land/r/gov/dao:', 'utf-8').toString('base64') },
                        },
                        timeout: 5_000,
                    })
                    .then(r => r.ok())
                    .catch(() => false),
            ))
            test.skip(!answers.some(Boolean), 'topaz RPC (primary + fallback) unreachable — live resolution cannot be smoked')
            throw err
        }
        expect(await resolvedCard.count()).toBeGreaterThanOrEqual(1)
    })
})
