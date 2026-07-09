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
 * The test13 primary + fallback gno RPC hosts — i.e. GNO_RPC_URL and
 * GNO_FALLBACK_RPC_URLS for the default (test13) network in
 * frontend/src/lib/config.ts. This is deliberately test13-scoped and RPC-only:
 * it does NOT cover the gnoland1 RPC/telemetry hosts (samourai.live, p2p.team,
 * aeddi.org) or the browser-proxied indexer (config.ts getIndexerUrl routes it
 * through `${API_BASE_URL}/api/indexer`, so it's never hit at one of these hosts).
 * Sufficient for treasury/test13 reads; EXTEND this list before reusing
 * abortOnchainReads on a spec that reads a gnoland1 or indexer-backed surface.
 */
export const GNO_RPC_HOSTS = [/\.gno\.land/, /testnets\.gno\.land/, /gnoland\.network/, /\.onbloc\.xyz/]

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
