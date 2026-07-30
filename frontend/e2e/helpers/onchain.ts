import type { Page } from '@playwright/test'

/**
 * E2E on-chain network determinism — the "deterministic by default" primitive.
 *
 * Memba's on-chain-backed pages (treasury, DAO, validators, directory, …) render
 * a loading shell until a live read against the public test13 RPC settles. In CI
 * that RPC is slow/variable, so any spec that asserts on post-load content races
 * the read against its timeout and flakes — and because it's shared-infra
 * contention, the failure hops between unrelated PRs run-to-run. Aborting the
 * gno RPC hosts makes those reads reject instantly; the page drops out of loading
 * via its own catch/finally and renders its deterministic shell with zero
 * live-RPC dependency.
 *
 * Why a dedicated host list (rather than a blanket network stub): these patterns
 * are anchored to REMOTE gno RPC hosts only, so they can never match a
 * locally-served vite bundle (a blanket `/sentry/`-style pattern can match the
 * app's own `@sentry_react.js` dep and blank the whole app).
 */

/**
 * The default-network (topaz) primary + fallback gno RPC hosts — i.e. GNO_RPC_URL
 * and GNO_FALLBACK_RPC_URLS in frontend/src/lib/config.ts. samourai.live is in
 * the list because topaz's FALLBACK RPC lives there: aborting only the primary
 * made the app fail over to a LIVE samourai read and reintroduced exactly the
 * shared-infra race this helper exists to kill (found via CI flake on the topaz
 * cutover PR). Still RPC-only and not a blanket stub: it does NOT cover p2p.team /
 * aeddi.org (gnoland1 telemetry) or the browser-proxied indexer (config.ts
 * getIndexerUrl routes through `${API_BASE_URL}/api/indexer`, never these hosts).
 * EXTEND this list before reusing abortOnchainReads on a spec that reads a
 * surface backed by hosts outside it. That advice is even sharper for
 * fulfillOnchainReads: an out-of-list host isn't merely left flaky — it
 * silently escapes the fixture and is served LIVE (extend the list, or layer
 * a dedicated route the way validators.spec.ts does for monitoring.gnolove.world).
 */
export const GNO_RPC_HOSTS = [/\.gno\.land/, /testnets\.gno\.land/, /gnoland\.network/, /\.onbloc\.xyz/, /\.samourai\.live/]

/** True if the URL points at one of the gno RPC hosts in GNO_RPC_HOSTS. */
export function isOnchainRead(url: string): boolean {
    return GNO_RPC_HOSTS.some(re => re.test(url))
}

/**
 * Abort every gno RPC read on this page. On-chain-backed pages then resolve out
 * of their loading state immediately and render their deterministic shell. App
 * bundles are served from localhost and never match GNO_RPC_HOSTS, so boot is
 * unaffected. Register in a beforeEach before the first navigation.
 */
export async function abortOnchainReads(page: Page): Promise<void> {
    await page.route('**/*', route => {
        if (isOnchainRead(route.request().url())) return route.abort()
        return route.continue()
    })
}

/** One parsed call against a gno RPC host, as seen by fulfillOnchainReads. */
export interface GnoRpcCall {
    /** JSON-RPC request id (POST body) — echoed into the reply envelope; null for GET-style reads. */
    id: unknown
    /**
     * Call name: the JSON-RPC method for POSTs ('abci_query'), the pathname for
     * GET-style Tendermint reads ('status', 'validators', 'block', 'net_info', …) —
     * see rpcFallback.ts resilientRpcCall vs resilientAbciQuery.
     */
    method: string
    /** ABCI query path ('vm/qrender', 'vm/qeval', 'bank/balances/<addr>', …); '' unless the call is an abci_query. */
    path: string
    /** Decoded abci_query argument (qrender: 'pkgpath:renderpath', qeval: 'pkgpath.Expr(…)'); '' otherwise. */
    arg: string
    /** Query string of GET-style reads (height, per_page, page, …); empty for POSTs. */
    query: URLSearchParams
}

/**
 * Fulfill every gno RPC read on this page with a deterministic offline reply —
 * the populated-shell counterpart to abortOnchainReads (same GNO_RPC_HOSTS
 * scope, so it can never swallow a locally-served vite bundle). Aborting only
 * ever renders a page's EMPTY shell; a spec that asserts on post-load content
 * (cards, stat grids, rosters) needs the reads to SUCCEED with known data, so
 * it fulfills instead. Register in a beforeEach before the first navigation.
 *
 * The responder decides per call:
 *  - return a string  → a successful abci_query whose decoded
 *    ResponseBase.Data is that string (the helper base64-encodes it);
 *  - return an object → `{jsonrpc, id, result: <object>}` — for GET-style
 *    Tendermint reads (status, validators, …) whose result is plain JSON,
 *    not the ABCI envelope;
 *  - return null (or nothing) → an abci_query gets the empty-Data envelope
 *    (clients parse that as null/[] and settle — treasury.spec's proven
 *    fallback); any other method gets `{}`, which satisfies no real
 *    Tendermint parser — mock every non-abci method your page actually needs.
 *    undefined is handled like null AT RUNTIME on purpose: tsconfig.app.json
 *    excludes e2e/**, so tsc never checks these types — a responder arm that
 *    forgets its return must land on the documented empty path, not serve a
 *    result-less `{jsonrpc,id}` that clients degrade from silently.
 *
 * Non-RPC URLs are passed on with route.fallback(), so a spec can layer an
 * extra route (e.g. monitoring.gnolove.world, which is deliberately NOT in
 * GNO_RPC_HOSTS) by registering it BEFORE this one.
 */
export async function fulfillOnchainReads(
    page: Page,
    respond: (call: GnoRpcCall) => string | object | null | undefined,
): Promise<void> {
    const abciEnvelope = (id: unknown, dataB64: string) => ({
        jsonrpc: '2.0',
        id,
        result: { response: { ResponseBase: { Error: null, Data: dataB64, Log: '', Info: '', Events: null } } },
    })

    await page.route('**/*', async route => {
        const req = route.request()
        if (!isOnchainRead(req.url())) return route.fallback()

        let body: { id?: unknown; method?: string; params?: { path?: string; data?: string } } = {}
        try { body = JSON.parse(req.postData() || '{}') } catch { /* GET-style read or non-JSON body */ }
        const url = new URL(req.url())
        const id = body?.id ?? null
        const method = body?.method || url.pathname.replace(/^\/+|\/+$/g, '')
        const path = body?.params?.path ?? ''
        // For vm/qrender / vm/qeval the query arg is base64(text); bank/balances sends "".
        let arg = ''
        try { arg = body?.params?.data ? Buffer.from(body.params.data, 'base64').toString('utf-8') : '' } catch { /* not base64 */ }

        const json = (payload: object) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })

        const reply = respond({ id, method, path, arg, query: url.searchParams })
        // Runtime reply-shape contract (tsc never checks e2e/**): a string for
        // a GET-style method, or an object for an abci_query, would be served
        // 200 and then degraded to null/{} by the client parsers — the fixture
        // would impersonate an empty chain and tests could pass vacuously.
        // Fail the test loudly instead.
        if (typeof reply === 'string' && method !== 'abci_query') {
            throw new Error(`fulfillOnchainReads: string reply for non-abci method '${method}' — return a result object`)
        }
        if (reply !== null && reply !== undefined && typeof reply !== 'string' && method === 'abci_query') {
            throw new Error(`fulfillOnchainReads: object reply for abci_query ${path} '${arg}' — return the decoded Data string`)
        }
        if (typeof reply === 'string') return json(abciEnvelope(id, Buffer.from(reply, 'utf-8').toString('base64')))
        if (reply !== null && reply !== undefined) return json({ jsonrpc: '2.0', id, result: reply })
        if (method === 'abci_query') return json(abciEnvelope(id, ''))
        return json({ jsonrpc: '2.0', id, result: {} })
    })
}

/**
 * A healthy GET /status result. Layout's ChainHaltedBanner probes /status on
 * the same RPC hosts this helper intercepts (chainHealth.ts treats any 200
 * carrying result.sync_info.latest_block_height as reachable), so fulfilled
 * specs return this to keep the banner provably out of their shell. The
 * validators page parses the same three fields (network, height, block time).
 */
export function mockChainStatus(): object {
    return {
        node_info: { network: 'e2e-offline' },
        sync_info: {
            latest_block_height: '435604',
            latest_block_time: new Date().toISOString(),
            catching_up: false,
        },
    }
}
