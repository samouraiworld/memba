import { describe, it, expect, vi, afterEach } from 'vitest'
import pkg from '../../package.json'
import {
    APP_VERSION,
    UGNOT_PER_GNOT,
    NETWORKS,
    VISIBLE_NETWORKS,
    DEFAULT_NETWORK,
    resolveDefaultNetwork,
    GNO_BECH32_PREFIX,
    GNOLOVE_API_URL,
    isTrustedRpcDomain,
    networkHasRealms,
    isRealmValidOn,
    TRUSTED_RPC_DOMAINS,
    getTelemetryRpcUrl,
    getTelemetryRpcUrls,
    GNO_RPC_URL,
    getUserRegistryPath,
    isNftMarketValid,
    isNftMarketV3Valid,
    SNAPSHOT_NETWORK,
    FEED_INDEXED_NETWORK,
    getFeaturedDaoRealm,
    selectableNetworksFor,
} from './config'
import { SITEMAP_NETWORK } from './sitemap'
import { NFT_MARKETPLACE_V3_PATH, NFT_MARKETPLACE_PATH } from './nftConfig'

describe('config constants', () => {
    it('APP_VERSION matches package.json', () => {
        expect(APP_VERSION).toBe(pkg.version)
    })

    it('UGNOT_PER_GNOT is 1 million', () => {
        expect(UGNOT_PER_GNOT).toBe(1_000_000)
    })

    it('NETWORKS has exactly test13 and gnoland1', () => {
        expect(Object.keys(NETWORKS)).toContain('gnoland1')
        expect(Object.keys(NETWORKS)).toContain('test13')
        expect(Object.keys(NETWORKS)).not.toContain('test12')
        expect(Object.keys(NETWORKS)).not.toContain('staging')
        expect(Object.keys(NETWORKS)).not.toContain('portal-loop')
    })

    it('test11 is dropped (decommissioned official testnet)', () => {
        expect(Object.keys(NETWORKS)).not.toContain('test11')
    })

    it('test13 map key is identifier-safe but on-wire chainId is hyphenated', () => {
        // The chainId VALUE is signature-load-bearing (ADR-036 sign doc) and
        // MUST be "test-13"; the map KEY stays "test13".
        expect(NETWORKS.test13.chainId).toBe('test-13')
        expect(NETWORKS.test13.userRegistryPath).toBe('gno.land/r/sys/users')
    })

    it('test13 is hidden from the selector (retired 2026-07-26) but still resolvable', () => {
        expect(NETWORKS.test13.hidden).toBe(true)
        expect(Object.keys(VISIBLE_NETWORKS)).not.toContain('test13')
        // Still in NETWORKS so deep links / stored selections resolve instead of
        // crash-looping the /:network redirects.
        expect(NETWORKS.test13).toBeDefined()
    })

    it('topaz is visible in the selector (the official testnet after cutover)', () => {
        expect(NETWORKS.topaz.hidden).toBeFalsy()
        expect(Object.keys(VISIBLE_NETWORKS)).toContain('topaz')
    })

    it('test13 points at the official testnets.gno.land RPC', () => {
        expect(NETWORKS.test13.rpcUrl).toBe('https://rpc.test13.testnets.gno.land:443')
    })

    it('networkHasRealms reflects Memba contract deployment per network', () => {
        // Memba's realms are deployed on test13 (interrealm-v2, 2026-06-16).
        expect(networkHasRealms('test13')).toBe(true)
        // Unknown networks default to "has realms" (don't gate the UI on a typo).
        expect(networkHasRealms('nonexistent')).toBe(true)
    })

    it('isRealmValidOn gates only the test13 invalid realms', () => {
        // test13 (interrealm-v2): DAO realms are deployed & valid.
        expect(isRealmValidOn('test13', 'gno.land/r/samcrew/memba_dao')).toBe(true)
        expect(isRealmValidOn('test13', 'gno.land/r/samcrew/agent_registry')).toBe(true)
        // Commerce realms redeployed to interrealm-v2 _v2 paths are valid.
        expect(isRealmValidOn('test13', 'gno.land/r/samcrew/tokenfactory_v2')).toBe(true)
        expect(isRealmValidOn('test13', 'gno.land/r/samcrew/escrow_v2')).toBe(true)
        expect(isRealmValidOn('test13', 'gno.land/r/samcrew/gnobuilders_badges_v2')).toBe(true)
        expect(isRealmValidOn('test13', 'gno.land/r/samcrew/memba_feedback_v2')).toBe(true)
        // NFT realms deployed 2026-06-16 are now valid on test13.
        expect(isRealmValidOn('test13', 'gno.land/r/samcrew/memba_nft_v2')).toBe(true)
        expect(isRealmValidOn('test13', 'gno.land/r/samcrew/memba_nft_market_v2')).toBe(true)
        // The stale v1 paths stay invalid on test13.
        expect(isRealmValidOn('test13', 'gno.land/r/samcrew/tokenfactory')).toBe(false)
        expect(isRealmValidOn('test13', 'gno.land/r/samcrew/memba_feedback')).toBe(false)
        expect(isRealmValidOn('test13', 'gno.land/r/samcrew/nft_market')).toBe(false)
        // Networks with no allowlist entry now gate EVERYTHING (was: everything
        // valid). The old fail-open shipped a live bug: gnoland1 was selectable
        // and had no entry, so every commerce predicate returned true and
        // /gnoland1/marketplace/nfts rendered a live marketplace with a "Launch
        // a collection" CTA on a chain with no realms (F-28, verified on prod
        // 2026-07-31). gnoland1 now has an explicit empty list; an unknown key
        // gates by default, which is the true statement for a network we have
        // not provisioned.
        expect(isRealmValidOn('gnoland1', 'gno.land/r/samcrew/tokenfactory')).toBe(false)
        expect(isRealmValidOn('betanet', 'gno.land/r/samcrew/escrow')).toBe(false)
    })

    it('test13 and gnoland1 use r/sys/users registry', () => {
        expect(NETWORKS.test13.userRegistryPath).toBe('gno.land/r/sys/users')
        expect(NETWORKS.gnoland1.userRegistryPath).toBe('gno.land/r/sys/users')
    })

    it('gnoland1 has correct chain config', () => {
        const g1 = NETWORKS.gnoland1
        expect(g1.chainId).toBe('gnoland1')
        expect(g1.rpcUrl).toBe('https://rpc.gnoland1.samourai.live:443')
        expect(g1.label).toBe('Betanet (gnoland1)')
        expect(g1.faucetUrl).toBe('')
    })

    it('DEFAULT_NETWORK is topaz (post-topaz-cutover default)', () => {
        expect(DEFAULT_NETWORK).toBe('topaz')
    })

    it('getUserRegistryPath returns r/sys/users for the default network', () => {
        // Default active network is topaz, which uses r/sys/users
        expect(getUserRegistryPath()).toBe('gno.land/r/sys/users')
    })

    it('each network has required fields', () => {
        for (const net of Object.values(NETWORKS)) {
            expect(net).toHaveProperty('chainId')
            expect(net).toHaveProperty('rpcUrl')
            expect(net).toHaveProperty('label')
            expect(net.rpcUrl).toMatch(/^https:\/\//)
        }
    })

    it('GNO_BECH32_PREFIX defaults to "g"', () => {
        expect(GNO_BECH32_PREFIX).toBe('g')
    })

    it('GNOLOVE_API_URL defaults to backend.gnolove.world', () => {
        expect(GNOLOVE_API_URL).toBe('https://backend.gnolove.world')
    })
})

describe('NFT v3 market gating (gate the page on the engine it trades)', () => {
    // CollectionPublic trades source="v3" (NFT_MARKETPLACE_V3_PATH — memba_nft_market_v3_2
    // since the 2026-07-10 repoint), so it gates on the v3 market's validity — NOT the v2
    // predicate it used to use. The v3.2 engine is DEPLOYED + REGISTERED on test13
    // (2026-07-10 ceremony; v3.1 stays registered but paused in wind-down), so its path
    // is allowlisted and isNftMarketV3Valid() is true. The trade surface ALSO
    // requires VITE_ENABLE_NFT=true (isNftEnabled()), which is force-false in prod — so
    // prod stays dark until the deploy-preview G1 verify, even though the realm is valid.
    it('v3.2 market path IS allowlisted on test13 (deployed + registered)', () => {
        expect(isRealmValidOn('test13', NFT_MARKETPLACE_V3_PATH)).toBe(true)
    })

    it('v2 market path IS allowlisted (the old, mismatched gate)', () => {
        expect(isRealmValidOn('test13', NFT_MARKETPLACE_PATH)).toBe(true)
    })

    it('isNftMarketV3Valid() is false on the active (topaz) network until the commerce ceremony', () => {
        // Post-cutover the default active network is topaz, where the commerce
        // realms (incl. memba_nft_market_v3_2) are NOT yet deployed — the
        // allowlist self-gates the trade surface. Flips true after the topaz
        // commerce ceremony (P1-0).
        expect(isNftMarketV3Valid()).toBe(false)
    })

    it('v2 and v3 are distinct predicates (the bug was gating v3 trading on the v2 predicate)', () => {
        // Both remain allowlisted on (retired) test13; on active topaz both gate
        // off until the commerce ceremony. They stay separate functions keyed off
        // distinct paths — the v3-trading page must never depend on the v2 predicate.
        expect(isNftMarketValid()).toBe(false)
        expect(isNftMarketV3Valid()).toBe(false)
        expect(isRealmValidOn('test13', NFT_MARKETPLACE_PATH)).toBe(true)
        expect(isRealmValidOn('test13', NFT_MARKETPLACE_V3_PATH)).toBe(true)
    })
})

describe('isTrustedRpcDomain', () => {
    it('trusts official gno.land RPC URLs', () => {
        expect(isTrustedRpcDomain('https://rpc.test11.testnets.gno.land:443')).toBe(true)
        expect(isTrustedRpcDomain('https://rpc.test13.testnets.gno.land:443')).toBe(true)
        expect(isTrustedRpcDomain('https://rpc.gno.land:443')).toBe(true)
        expect(isTrustedRpcDomain('https://rpc.gno.land')).toBe(true)
    })

    it('trusts subdomains of gno.land', () => {
        expect(isTrustedRpcDomain('https://new-rpc.gno.land:443')).toBe(true)
        expect(isTrustedRpcDomain('https://staging.testnets.gno.land')).toBe(true)
    })

    it('trusts Samourai Coop RPC domains — convention: rpc.{chain}.samourai.live', () => {
        // gnoland1 (live)
        expect(isTrustedRpcDomain('https://rpc.gnoland1.samourai.live')).toBe(true)
        // testnet12 (coming soon)
        expect(isTrustedRpcDomain('https://rpc.testnet12.samourai.live')).toBe(true)
        // any subdomain of samourai.live
        expect(isTrustedRpcDomain('https://rpc.anychain.samourai.live:26657')).toBe(true)
    })

    it('rejects samourai.live lookalikes', () => {
        expect(isTrustedRpcDomain('https://evil.samourai.live.attacker.com')).toBe(false)
        expect(isTrustedRpcDomain('https://fakepsamourai.live')).toBe(false)
        expect(isTrustedRpcDomain('https://samourai.live.evil.com')).toBe(false)
    })

    it('trusts gnoland.network subdomains (test-13 indexer/gnoweb + gnoland1 fallbacks)', () => {
        expect(isTrustedRpcDomain('https://rpc.test-13-aeddi-1.gnoland.network')).toBe(true)
        expect(isTrustedRpcDomain('https://gnoland.network')).toBe(true)
    })

    it('rejects gnoland.network lookalikes', () => {
        expect(isTrustedRpcDomain('https://fakegnoland.network')).toBe(false)
        expect(isTrustedRpcDomain('https://gnoland.network.evil.com')).toBe(false)
    })

    it('trusts onbloc.xyz subdomains (test-13 canonical RPC — Adena v1.19.5 #856)', () => {
        expect(isTrustedRpcDomain('https://test13.rpc.onbloc.xyz:443')).toBe(true)
        expect(isTrustedRpcDomain('https://onbloc.xyz')).toBe(true)
    })

    it('rejects onbloc.xyz lookalikes', () => {
        expect(isTrustedRpcDomain('https://fakeonbloc.xyz')).toBe(false)
        expect(isTrustedRpcDomain('https://onbloc.xyz.evil.com')).toBe(false)
    })

    // D8.a-lite: every configured NETWORKS RPC + fallback URL must be trusted, so the
    // wallet-RPC trust gate never blocks a network we ship. Catches the exact drift
    // that broke test-13 when Adena moved its RPC to onbloc.xyz (#856).
    it('trusts every configured NETWORKS rpcUrl and fallbackRpcUrls', () => {
        for (const [key, net] of Object.entries(NETWORKS)) {
            expect(isTrustedRpcDomain(net.rpcUrl), `${key} rpcUrl ${net.rpcUrl} must be trusted`).toBe(true)
            for (const fb of net.fallbackRpcUrls) {
                expect(isTrustedRpcDomain(fb), `${key} fallback ${fb} must be trusted`).toBe(true)
            }
        }
    })

    it('trusts localhost for local devnet', () => {
        expect(isTrustedRpcDomain('http://localhost:26657')).toBe(true)
        expect(isTrustedRpcDomain('http://localhost')).toBe(true)
    })

    it('rejects malicious domains with matching chain keywords', () => {
        expect(isTrustedRpcDomain('https://test11.malicious.land:443')).toBe(false)
        expect(isTrustedRpcDomain('https://rpc.evil-gno.land:443')).toBe(false)
        expect(isTrustedRpcDomain('https://gno.land.attacker.com:443')).toBe(false)
    })

    it('rejects domains that look similar to gno.land', () => {
        expect(isTrustedRpcDomain('https://fakegno.land:443')).toBe(false)
        expect(isTrustedRpcDomain('https://notgno.land')).toBe(false)
        expect(isTrustedRpcDomain('https://xgno.land')).toBe(false)
    })

    it('rejects samourai.coop lookalikes', () => {
        expect(isTrustedRpcDomain('https://evil.samourai.coop.attacker.com')).toBe(false)
        expect(isTrustedRpcDomain('https://fakepsamourai.coop')).toBe(false)
    })

    it('rejects invalid URLs', () => {
        expect(isTrustedRpcDomain('')).toBe(false)
        expect(isTrustedRpcDomain('not-a-url')).toBe(false)
        expect(isTrustedRpcDomain('ftp://gno.land')).toBe(true) // protocol doesn't matter for domain check
    })

    it('handles case insensitivity', () => {
        expect(isTrustedRpcDomain('https://RPC.GNO.LAND:443')).toBe(true)
        expect(isTrustedRpcDomain('https://Rpc.Test11.Testnets.Gno.LAND')).toBe(true)
    })

    it('all hardcoded NETWORKS use trusted domains', () => {
        for (const [key, net] of Object.entries(NETWORKS)) {
            expect(isTrustedRpcDomain(net.rpcUrl), `Network "${key}" uses untrusted RPC: ${net.rpcUrl}`).toBe(true)
        }
    })

    it('TRUSTED_RPC_DOMAINS is non-empty', () => {
        expect(TRUSTED_RPC_DOMAINS.length).toBeGreaterThan(0)
    })

    // Bug report: tester's exact malicious URL was not caught by v1.2.0 fix
    it('rejects tester-reported malicious URLs', () => {
        expect(isTrustedRpcDomain('https://rpc.test11.testnets.malicious.land')).toBe(false)
        expect(isTrustedRpcDomain('https://rpc.test11.testnets.malicious.land:443')).toBe(false)
    })
})

describe('getTelemetryRpcUrl', () => {
    it('returns the network telemetry node when no sentry is configured', () => {
        // No VITE_SAMOURAI_SENTRY_RPC_URL in tests. The default network (test13)
        // defines telemetryRpcUrls, so getTelemetryRpcUrl() returns the first one
        // (networks without telemetryRpcUrls fall back to GNO_RPC_URL instead).
        const url = getTelemetryRpcUrl()
        expect(url).toBe(getTelemetryRpcUrls()[0])
        expect(url).toBeTruthy()
        expect(isTrustedRpcDomain(url)).toBe(true)
    })

    it('GNO_RPC_URL is always a trusted domain', () => {
        expect(isTrustedRpcDomain(GNO_RPC_URL)).toBe(true)
    })
})

describe('getTelemetryRpcUrls', () => {
    it('returns a non-empty list that includes the primary RPC', () => {
        const urls = getTelemetryRpcUrls()
        expect(urls.length).toBeGreaterThan(0)
        expect(urls).toContain(GNO_RPC_URL)
    })

    it('only contains trusted RPC domains', () => {
        for (const url of getTelemetryRpcUrls()) {
            expect(isTrustedRpcDomain(url)).toBe(true)
        }
    })

    it('contains no duplicates', () => {
        const urls = getTelemetryRpcUrls()
        expect(new Set(urls).size).toBe(urls.length)
    })

    it('getTelemetryRpcUrl() returns the first telemetry node', () => {
        expect(getTelemetryRpcUrl()).toBe(getTelemetryRpcUrls()[0])
    })

    it('test13 config declares well-connected telemetry nodes covering aeddi-1', () => {
        // The fix: test13's primary RPC sits behind sentries and sees a partial
        // peer set; aeddi-1 (gno-core) sees the full topology. It must be in the
        // declared telemetry set so getAggregatedNetPeers can reach it.
        const t13 = NETWORKS.test13.telemetryRpcUrls || []
        expect(t13.some((u) => u.includes('aeddi-1'))).toBe(true)
        for (const u of t13) expect(isTrustedRpcDomain(u)).toBe(true)
    })
})

describe('network reduction — test13 + topaz + gnoland1 + sapphire only', () => {
    it('exposes only test13, topaz, gnoland1, and sapphire', () => {
        const keys = Object.keys(NETWORKS).sort()
        // sapphire added 2026-08-11, DARK — see the sapphire dark-contract block
        // below and the entry's doc-comment. It is deliberately in NETWORKS (so
        // the cutover is a flag flip) and deliberately inert.
        expect(keys).toEqual(['gnoland1', 'sapphire', 'test13', 'topaz'])
    })
    it('defaults to topaz', () => {
        expect(DEFAULT_NETWORK).toBe('topaz')
    })
    it('no longer references test12 / staging / portal', () => {
        const keys = Object.keys(NETWORKS)
        expect(keys).not.toContain('test12')
        expect(keys).not.toContain('staging')
        expect(keys).not.toContain('portal-loop')
    })

    // Regression: a stale Netlify build var VITE_GNO_CHAIN_ID=test12 made
    // DEFAULT_NETWORK="test12" (removed from NETWORKS) → RootRedirect/LegacyRedirect
    // infinite-looped (/test12/test12/…) until the browser throttled replaceState and
    // the app crashed (mobile / private browsing, where localStorage can't override it).
    it('resolveDefaultNetwork falls back to a valid network for a removed env value', () => {
        expect(resolveDefaultNetwork('test12')).toBe('topaz')
        expect(NETWORKS[resolveDefaultNetwork('test12')]).toBeDefined()
    })
    it('resolveDefaultNetwork passes through a valid env network; falls back when empty', () => {
        // NOTE gnoland1 is `hidden` since 2026-07-31 and still passes through:
        // NETWORKS membership is the only requirement, deliberately. Pinning a
        // hidden network as the default is how the :5174/:5175 e2e servers run
        // (.env.e2e → test13). See resolveDefaultNetwork's doc before "fixing".
        expect(resolveDefaultNetwork('gnoland1')).toBe('gnoland1')
        expect(resolveDefaultNetwork('test13')).toBe('test13')
        expect(resolveDefaultNetwork(undefined)).toBe('topaz')
        expect(resolveDefaultNetwork('')).toBe('topaz')
    })
    it('DEFAULT_NETWORK is always a valid NETWORKS entry (never crash-loops)', () => {
        expect(NETWORKS[DEFAULT_NETWORK]).toBeDefined()
    })
})

// The sapphire entry exists so the eventual cutover is a small flag flip. Its
// entire value depends on it changing NOTHING until that flip, so each half of
// that claim is asserted here rather than left to review. If you are here
// because one of these failed while landing the cutover, that is the test
// working: flip it deliberately, in the PR that makes it true on-chain.
describe('sapphire is present but DARK (Adena v1.20.3 cutover prep, 2026-08-11)', () => {
    it('is reachable by URL/env but absent from the selector', () => {
        expect(NETWORKS.sapphire).toBeDefined()
        expect(NETWORKS.sapphire.chainId).toBe('sapphire-1')
        expect(NETWORKS.sapphire.hidden).toBe(true)
        expect(Object.keys(VISIBLE_NETWORKS)).not.toContain('sapphire')
        // Deep links must still RESOLVE rather than crash-loop the /:network
        // redirects — the test13 lesson.
        expect(resolveDefaultNetwork('sapphire')).toBe('sapphire')
    })

    it('gates EVERY realm — including every fund-custody lane', () => {
        // Explicit empty allowlist. Not one path is callable here yet.
        for (const path of [
            'gno.land/r/samcrew/memba_dao',
            'gno.land/r/samcrew/tokenfactory_v2',
            'gno.land/r/samcrew/escrow_v3',
            'gno.land/r/samcrew/memba_token_otc_v2',
            NFT_MARKETPLACE_PATH,
            NFT_MARKETPLACE_V3_PATH,
        ]) {
            expect(isRealmValidOn('sapphire', path)).toBe(false)
        }
        // NB: isNftMarketValid()/isNftMarketV3Valid() are deliberately NOT used
        // here. They take no arguments and resolve against the ACTIVE network,
        // so `isNftMarketValid('sapphire')` would silently ignore the argument
        // and assert something else entirely — a green vacuous test. The
        // network-scoped predicate is isRealmValidOn, used above.
    })

    it('tells the truth about having no realms, instead of rendering empty', () => {
        // Without realmsDeployed:false this defaults to TRUE and anyone on a
        // /sapphire/ deep link gets a normal-looking but silently empty app
        // rather than RealmsNotDeployedBanner. This is the F-28 failure shape.
        expect(networkHasRealms('sapphire')).toBe(false)
        expect(getFeaturedDaoRealm('sapphire')).toBeNull()
    })

    it('does not become the default, or a health-check fallback', () => {
        // DEFAULT_NETWORK itself is deliberately not asserted here: it derives
        // from VITE_GNO_CHAIN_ID, and the repo-root .env pins test13 for local
        // runs, so asserting it would fail locally and pass in CI. The
        // env-independent resolver logic is what matters for the dark contract.
        expect(resolveDefaultNetwork(undefined)).toBe('topaz')
        expect(resolveDefaultNetwork('')).toBe('topaz')
        // Hidden networks are never auto-selected as a fallback target
        // (chainHealth.ts:122 requires !hidden && networkHasRealms) — sapphire
        // fails both halves today.
        expect(NETWORKS.sapphire.hidden && !networkHasRealms('sapphire')).toBe(true)
    })

    it('leaves every PINNED cutover constant on topaz', () => {
        // These four do NOT derive from the env, so they are the actual flip.
        // Desynchronising them from their backend counterparts fails SILENTLY
        // (W3-6), which is why they are asserted as a set.
        expect(SNAPSHOT_NETWORK).toBe('topaz')
        expect(FEED_INDEXED_NETWORK).toBe('topaz')
        expect(SITEMAP_NETWORK).toBe('topaz')
    })

    it('is still escapable if a user does reach it', () => {
        // selectableNetworksFor always prepends the ACTIVE network, so a hidden
        // active network still has an option and can be left. Without this a
        // /sapphire/ visitor would be stranded with no way back to topaz.
        const selectable = Object.keys(selectableNetworksFor('sapphire'))
        expect(selectable).toContain('sapphire')
        expect(selectable).toContain('topaz')
    })

    it('points only at live, trusted sapphire-1 infrastructure', () => {
        // All four live-verified 2026-08-11; both RPCs reported sapphire-1 at
        // the same height with the indexer matching exactly.
        expect(NETWORKS.sapphire.rpcUrl).toBe('https://rpc.sapphire.testnets.gno.land:443')
        expect(NETWORKS.sapphire.fallbackRpcUrls).toEqual(['https://sapphire.rpc.onbloc.xyz:443'])
        expect(isTrustedRpcDomain(NETWORKS.sapphire.rpcUrl)).toBe(true)
        for (const url of NETWORKS.sapphire.fallbackRpcUrls) {
            expect(isTrustedRpcDomain(url)).toBe(true)
        }
        expect(isTrustedRpcDomain(NETWORKS.sapphire.indexerUrl!)).toBe(true)
        // Not the retired sentry host, and not topaz's chain id.
        expect(NETWORKS.sapphire.rpcUrl).not.toContain('samourai.live')
        expect(NETWORKS.sapphire.chainId).not.toBe('topaz-1')
    })
})

describe('doContractBroadcast RPC guard', () => {
    it('blocks transactions when wallet RPC is untrusted', async () => {
        const { setWalletRpcContext, doContractBroadcast } = await import('./grc20')
        setWalletRpcContext('https://rpc.test11.testnets.malicious.land', false)
        await expect(doContractBroadcast([], 'test')).rejects.toThrow('Transaction blocked')
    })

    it('blocks transactions when wallet RPC is unknown', async () => {
        const { setWalletRpcContext, doContractBroadcast } = await import('./grc20')
        setWalletRpcContext(null, false)
        await expect(doContractBroadcast([], 'test')).rejects.toThrow('Transaction blocked')
    })
})

describe('FEED_INDEXED_NETWORK — drift tripwire', () => {
    it('names a real network', async () => {
        const { NETWORKS, FEED_INDEXED_NETWORK } = await import('./config')
        expect(NETWORKS[FEED_INDEXED_NETWORK]).toBeDefined()
    })

    it('names a VISIBLE network — FeedComposer offers a one-click switch to it', async () => {
        // FeedComposer renders a "switch to <FEED_INDEXED_NETWORK>" button when the
        // active network can't write to the feed. That is a switch surface, and it
        // is the only one with no `hidden` check of its own — it is safe today
        // purely because this constant is a visible literal. Repointing it at a
        // hidden network would turn that button into a one-click path into a chain
        // the switcher no longer offers (F-28's whole failure mode).
        const { NETWORKS, FEED_INDEXED_NETWORK } = await import('./config')
        expect(NETWORKS[FEED_INDEXED_NETWORK].hidden).not.toBe(true)
    })

    it('matches DEFAULT_NETWORK, or the feed silently goes read-only for everyone', async () => {
        const { DEFAULT_NETWORK, FEED_INDEXED_NETWORK } = await import('./config')
        // isFeedWritable() compares the ACTIVE network to FEED_INDEXED_NETWORK.
        // DEFAULT_NETWORK comes from VITE_GNO_CHAIN_ID (a Netlify build var);
        // FEED_INDEXED_NETWORK is a source literal that must track the BACKEND's
        // FEED_RPC_URL. Moving the frontend default without moving the backend
        // indexer — precisely what a Topaz cutover does — would disable feed
        // posting for every user with no build error and no runtime warning.
        //
        // If you are INTENTIONALLY cutting over: move the backend's FEED_RPC_URL
        // in the same window, update FEED_INDEXED_NETWORK here, and reset the
        // indexer cursor. If you are not, this failure is the bug.
        expect(
            FEED_INDEXED_NETWORK,
            `FEED_INDEXED_NETWORK ("${FEED_INDEXED_NETWORK}") != DEFAULT_NETWORK ("${DEFAULT_NETWORK}") — ` +
            `feed posting is disabled for every user on the default network. See the comment above this assertion.`,
        ).toBe(DEFAULT_NETWORK)
    })
})

describe('explorerUrl — the host every "view on gnoweb" link is built from', () => {
    it('is declared by every network', async () => {
        const { NETWORKS } = await import('./config')
        const missing = Object.entries(NETWORKS)
            .filter(([, cfg]) => !cfg.explorerUrl)
            .map(([k]) => k)
        expect(missing, `networks with no explorerUrl: ${missing.join(', ')}`).toEqual([])
    })

    it('is never the chainId-derived host that broke topaz', async () => {
        const { NETWORKS } = await import('./config')
        // getExplorerBaseUrl used to return `https://${chainId}.testnets.gno.land`.
        // That is right only where the network KEY equals the chain id. On topaz
        // (key "topaz", chainId "topaz-1") it produced topaz-1.testnets.gno.land,
        // which does not resolve — so every explorer link in the app 404'd from
        // the cutover until 2026-07-31 and nothing failed.
        // Only assert it where key !== chainId. Where they coincide, that host may
        // legitimately BE the right one, and a blanket rule would fail a correct
        // future network while claiming the correct value is wrong.
        for (const [key, cfg] of Object.entries(NETWORKS)) {
            if (key === cfg.chainId) continue
            expect(
                cfg.explorerUrl,
                `${key}: explorerUrl is the chainId-derived host. That form is only ` +
                `valid when the network key equals the chain id ("${key}" vs "${cfg.chainId}").`,
            ).not.toBe(`https://${cfg.chainId}.testnets.gno.land`)
        }
    })

    it('resolves the active network to the topaz gnoweb host, by value', async () => {
        // Asserting against NETWORKS[DEFAULT_NETWORK].explorerUrl would be X === X
        // (tests clear localStorage, so _activeNetwork IS DEFAULT_NETWORK) and would
        // pass for any garbage value. Pin the literal instead: this is the host
        // live-verified to serve our own realm, and the one the bug got wrong.
        const { getExplorerBaseUrl } = await import('./config')
        expect(getExplorerBaseUrl()).toBe('https://topaz.testnets.gno.land')
    })

    it('still resolves retired test13, so old deep links degrade instead of crossing chains', async () => {
        const { getExplorerBaseUrlFor } = await import('./config')
        expect(getExplorerBaseUrlFor('test13')).toBe('https://test13.testnets.gno.land')
    })

    it('never yields undefined for an unknown key — that renders "https://undefined/r/..."', async () => {
        const { getExplorerBaseUrlFor, DEFAULT_NETWORK, NETWORKS } = await import('./config')
        expect(getExplorerBaseUrlFor('no-such-network')).toBe(NETWORKS[DEFAULT_NETWORK].explorerUrl)
        expect(`${getExplorerBaseUrlFor('no-such-network')}/r/x`).not.toContain('undefined')
    })
})

describe('isTestnetNetwork — drives the Team Hub mainnet-data disclosure', () => {
    it('is true for the test chains and false for betanet', async () => {
        const { isTestnetNetwork } = await import('./config')
        expect(isTestnetNetwork('topaz')).toBe(true)
        expect(isTestnetNetwork('test13')).toBe(true)
        // gnolove-team-hub e2e encodes "gnoland1 = real chain -> no chip".
        expect(isTestnetNetwork('gnoland1')).toBe(false)
    })

    it('is false for an unknown key rather than throwing', async () => {
        const { isTestnetNetwork } = await import('./config')
        expect(isTestnetNetwork('no-such-network')).toBe(false)
    })
})

describe('Betanet gating — fails CLOSED, not open (F-28)', () => {
    it('gnoland1 is not offered in the selector', async () => {
        const { VISIBLE_NETWORKS, NETWORKS } = await import('./config')
        expect(NETWORKS.gnoland1).toBeDefined()          // deep links still resolve
        expect(VISIBLE_NETWORKS.gnoland1).toBeUndefined() // but it is not offered
    })

    it('gnoland1 declares its realms are NOT deployed, so the banner fires', async () => {
        const { networkHasRealms } = await import('./config')
        expect(networkHasRealms('gnoland1')).toBe(false)
    })

    it('gates every commerce realm on gnoland1', async () => {
        const { isRealmValidOn, MEMBA_DAO, GRC20_FACTORY_PATH } = await import('./config')
        for (const path of [MEMBA_DAO.escrowPath, MEMBA_DAO.tokenOtcPath, MEMBA_DAO.nftMarketPath, GRC20_FACTORY_PATH]) {
            expect(isRealmValidOn('gnoland1', path), `${path} must be gated on Betanet`).toBe(false)
        }
    })

    it('an UNKNOWN network gates everything instead of allowing everything', async () => {
        const { isRealmValidOn, MEMBA_DAO } = await import('./config')
        // The old `!allow || ...` returned TRUE here, silently un-gating
        // fund-custody UI on any network without an allowlist entry.
        expect(isRealmValidOn('no-such-network', MEMBA_DAO.escrowPath)).toBe(false)
    })

    it('does not over-gate: topaz keeps its allowlisted realms valid', async () => {
        const { isRealmValidOn, MEMBA_DAO } = await import('./config')
        // REALM_ALLOWLIST is module-private, so assert through the predicate.
        expect(isRealmValidOn('topaz', MEMBA_DAO.realmPath)).toBe(true)
        expect(isRealmValidOn('topaz', MEMBA_DAO.channelsPath)).toBe(true)
    })
})

describe('topaz commerce-v2 allowlist — funds-free realms only', () => {
    // The 2026-07-31 ceremony put 13 artifacts live on topaz-1. Adding a path to
    // REALM_ALLOWLIST DE-GATES its lane (isRealmValidOn is the only gate most of
    // them have), so this PR lists ONLY the three that move no money. The rest
    // custody funds and are held to separate PRs — this pins that boundary so a
    // fund-custody realm cannot be slipped in without a failing test.

    it('de-gates the funds-free lanes on topaz', async () => {
        const { isRealmValidOn, GRC20_FACTORY_PATH, FEEDBACK_REALM_PATH, MEMBA_DAO } = await import('./config')
        expect(isRealmValidOn('topaz', GRC20_FACTORY_PATH), 'token factory').toBe(true)
        expect(isRealmValidOn('topaz', FEEDBACK_REALM_PATH), 'feedback').toBe(true)
        expect(isRealmValidOn('topaz', MEMBA_DAO.badgesPath), 'badges').toBe(true)
    })

    it('keeps every HELD-BACK commerce realm gated on topaz', async () => {
        const { isRealmValidOn, MEMBA_DAO } = await import('./config')
        const { NFT_MARKETPLACE_V3_PATH, NFT_COLLECTION_PATH, MEMBA_MARKET_CONFIG_PATH } = await import('./nftConfig')
        // Held back for TWO different reasons — do not conflate them:
        //   custodyFunds        — `unsafe.OriginSend()` in, `SendCoins` out in the
        //                         realm source. escrow_v3 + memba_token_otc_v2 are
        //                         additionally blocked on the unverified "old
        //                         realms paused + reconciliation-drained" ceremony
        //                         precondition.
        //   fundsFreeButCoupled — measurably ZERO fund primitives; held only
        //                         because the NFT stack must move as ONE unit
        //                         (listing them alone gives a half-wired launchpad).
        const custodyFunds: Record<string, string> = {
            escrow: MEMBA_DAO.escrowPath,
            tokenOtc: MEMBA_DAO.tokenOtcPath,
            nftMarketV2: MEMBA_DAO.nftMarketPath,
            nftMarketV3_2: NFT_MARKETPLACE_V3_PATH,
            nftCollections: MEMBA_DAO.nftCollectionsPath,
            // No exported constant for v3_1 (wind-down only), so this stays a
            // literal — the test13 anchor below is what makes a typo in it fail.
            nftMarketV3_1: 'gno.land/r/samcrew/memba_nft_market_v3_1',
        }
        const fundsFreeButCoupled: Record<string, string> = {
            nftCollectionV2: NFT_COLLECTION_PATH,
            // Same measurement as nftCollectionV2 (zero fund primitives); held for
            // the same reason. It is the one path listed on NEITHER network, so
            // the test13 anchor below cannot cover it — the shape guard does.
            marketConfig: MEMBA_MARKET_CONFIG_PATH,
        }

        // The ONE held-back path that test13 does not list, single-sourced so the
        // exclusion is stated exactly once. Everything else gets BOTH guards by
        // default — a new entry added above cannot silently miss the anchor.
        const notOnTest13 = new Set<string>([MEMBA_MARKET_CONFIG_PATH])

        for (const [name, path] of Object.entries({ ...custodyFunds, ...fundsFreeButCoupled })) {
            // GUARD 1 — SHAPE, checked first. Catches a mistyped CONSTANT name,
            // which a dynamic `await import()` destructure yields as `undefined`
            // rather than an error; `isRealmValidOn(x, undefined)` then quietly
            // returns false and the gating assertion goes green for the wrong
            // reason. An earlier version of this comment claimed TypeScript would
            // catch that — it does NOT: `tsconfig.app.json` excludes
            // `src/**/*.test.ts`, so `npm run build` never typechecks this file.
            expect(path, `${name}: must be a real realm path, not undefined`).toMatch(/^gno\.land\/r\/samcrew\/[a-z0-9_]+$/)

            expect(isRealmValidOn('topaz', path), `${name} (${path}) must stay gated on topaz`).toBe(false)

            // GUARD 2 — TWO-WAY ANCHOR. These are NOT redundant: they catch
            // disjoint mistakes. `isRealmValidOn` returns false for ANY unlisted
            // string, so the topaz assertion above passes just as happily on a
            // TYPO'D literal — asserting "this string is unknown" rather than
            // "this realm is gated", and unable to detect the real path being
            // added to topaz. Guard 1 does not help there: `…_v3_1_typooo` matches
            // the shape perfectly. Requiring the same literal to be VALID on
            // test13 is what makes a typo fail loudly.
            //
            // ⚠️ This borrows a guarantee from a RETIRED chain. If a path is
            // removed from REALM_ALLOWLIST.test13 — `config.ts` instructs exactly
            // that for memba_nft_market_v3_1 once its escrow drains — this reds
            // with a message that is then misleading (the path is real; only
            // test13's bookkeeping changed). Add it to `notOnTest13` above rather
            // than deleting the assertion.
            if (notOnTest13.has(path)) continue
            expect(isRealmValidOn('test13', path), `${name} (${path}) — typo guard: must be a real, test13-listed path`).toBe(true)
        }
    })

    it('leaves the commerce PREDICATES false on topaz', async () => {
        // HERMETIC: these read the module-load `_activeNetwork`, so without
        // stubbing they describe whatever VITE_GNO_CHAIN_ID the machine happens to
        // have. Under the repo's untracked .env (test13) every one of them is TRUE
        // and the assertions would be about the wrong network entirely.
        vi.stubEnv('VITE_GNO_CHAIN_ID', 'topaz')
        vi.resetModules()
        // The predicates are what the pages actually read — assert those directly,
        // not just the paths, so a predicate repointed at a listed path is caught.
        const cfg = await import('./config')
        expect(cfg.isEscrowValid()).toBe(false)
        expect(cfg.isTokenOtcValid()).toBe(false)
        expect(cfg.isNftMarketValid()).toBe(false)
        expect(cfg.isNftMarketV3Valid()).toBe(false)
        expect(cfg.isNftLaunchpadValid()).toBe(false)
        // …and the two this PR intentionally opens.
        expect(cfg.isTokenFactoryValid()).toBe(true)
        expect(cfg.isFeedbackValid()).toBe(true)
        vi.unstubAllEnvs()
        vi.resetModules()
    })

    it('does not touch the test13 allowlist', async () => {
        const { isRealmValidOn, MEMBA_DAO } = await import('./config')
        expect(isRealmValidOn('test13', MEMBA_DAO.escrowPath)).toBe(true)
        expect(isRealmValidOn('test13', MEMBA_DAO.tokenOtcPath)).toBe(true)
    })
})

describe('resolveStoredNetworkKey — hiding a network must not strand anyone', () => {
    // HERMETIC ON PURPOSE. DEFAULT_NETWORK is computed at module load from
    // VITE_GNO_CHAIN_ID, and the repo-root .env is untracked and pins test13 on
    // dev machines — so an un-stubbed assertion here passes in CI and fails
    // locally for reasons that have nothing to do with the code under test. Stub
    // the env and re-import so each case states which build it is describing.
    afterEach(() => {
        localStorage.removeItem('memba_network')
        vi.unstubAllEnvs()
        vi.resetModules()
    })

    /** config as a SHIPPED build sees it (prod, deploy previews, CI's :5173). */
    async function shippedBuild() {
        vi.stubEnv('VITE_GNO_CHAIN_ID', 'topaz')
        vi.resetModules()
        return await import('./config')
    }

    it('heals a stored hidden network to one the switcher actually OFFERS', async () => {
        const { resolveStoredNetworkKey, NETWORKS, VISIBLE_NETWORKS } = await shippedBuild()
        // Assert the PROPERTY, not the identity. `toBe(DEFAULT_NETWORK)` was
        // vacuous — it passes while returning a HIDDEN key, which is exactly the
        // failure mode it was meant to catch (healing one hidden network to
        // another leaves the user precisely where they started).
        for (const stored of ['gnoland1', 'test13']) {
            const healed = resolveStoredNetworkKey(stored)
            expect(NETWORKS[healed], `${stored} must heal to a real network`).toBeDefined()
            expect(NETWORKS[healed].hidden, `${stored} must heal to a VISIBLE network`).not.toBe(true)
            expect(VISIBLE_NETWORKS[healed], `${stored} must heal INTO the switcher`).toBeDefined()
        }
    })

    it('never restores Betanet, whatever the build default is', async () => {
        // Env-independent: holds in a shipped build AND on the pinned e2e servers.
        const { resolveStoredNetworkKey } = await import('./config')
        expect(resolveStoredNetworkKey('gnoland1')).not.toBe('gnoland1')
    })

    it('keeps a stored VISIBLE network', async () => {
        const { resolveStoredNetworkKey } = await shippedBuild()
        expect(resolveStoredNetworkKey('topaz')).toBe('topaz')
    })

    it('falls back for unknown/empty input rather than throwing', async () => {
        const { resolveStoredNetworkKey, DEFAULT_NETWORK } = await shippedBuild()
        for (const v of ['no-such-network', '', null, undefined]) {
            expect(resolveStoredNetworkKey(v)).toBe(DEFAULT_NETWORK)
        }
    })

    it('a build that PINS a hidden network keeps it as the default (.env.e2e contract)', async () => {
        // Locks behaviour a reviewer asked to invert. Root `.env.e2e` sets
        // VITE_GNO_CHAIN_ID=test13, and marketplace-gating.spec.ts (:5174) depends
        // on landing there: on topaz neither memba_nft_market_v3_2 nor escrow_v3
        // is allowlisted, so BOTH "live" lanes would gate and the spec's default
        // landing lane would vanish. Adding `!hidden` to resolveDefaultNetwork
        // would therefore red the e2e suite for no user-facing gain.
        vi.stubEnv('VITE_GNO_CHAIN_ID', 'test13')
        vi.resetModules()
        const { DEFAULT_NETWORK, NETWORKS, selectableNetworksFor, isRealmValidOn, MEMBA_DAO } = await import('./config')
        expect(DEFAULT_NETWORK).toBe('test13')
        expect(NETWORKS.test13.hidden).toBe(true)
        // The premise above, asserted rather than assumed.
        expect(isRealmValidOn('test13', MEMBA_DAO.escrowPath)).toBe(true)
        expect(isRealmValidOn('topaz', MEMBA_DAO.escrowPath)).toBe(false)
        // Safe because the ESCAPE HATCH — not the heal — is what prevents
        // stranding: the active hidden network is still offered, alongside topaz.
        const offered = selectableNetworksFor('test13')
        expect(offered.test13).toBeDefined()
        expect(Object.keys(offered).length).toBeGreaterThan(1)
    })

    it('the MODULE-LOAD key still honours a stored hidden network (deep links)', async () => {
        // Regression guard for the self-inflicted break CI caught: self-healing
        // getActiveNetworkKey too made config initialise on topaz while a
        // /test13/* URL said test13 — NetworkSync then reloaded and the
        // realm-gated UI rendered the wrong network's state. The CreateToken e2e
        // specs seed localStorage exactly this way (#1032). Self-healing belongs
        // in the NAVIGATION resolvers only.
        vi.stubEnv('VITE_GNO_CHAIN_ID', 'topaz')
        localStorage.setItem('memba_network', 'test13')
        vi.resetModules()
        const { ACTIVE_NETWORK_KEY, GNO_CHAIN_ID, resolveStoredNetworkKey } = await import('./config')
        // Module-load config initialises on the STORED hidden network…
        expect(ACTIVE_NETWORK_KEY).toBe('test13')
        expect(GNO_CHAIN_ID).toBe('test-13')
        // …while the navigation resolver heals away from it.
        expect(resolveStoredNetworkKey('test13')).not.toBe('test13')
    })

    it('every hidden network is still resolvable by explicit URL', async () => {
        const { NETWORKS } = await import('./config')
        // Self-healing applies to STORED keys only — deep links must still work.
        for (const k of ['test13', 'gnoland1']) {
            expect(NETWORKS[k], `${k} must stay in NETWORKS for deep links`).toBeDefined()
            expect(NETWORKS[k].hidden).toBe(true)
        }
    })
})

describe('selectableNetworksFor — the switcher escape hatch', () => {
    it('offers the ACTIVE network even when it is hidden', async () => {
        const { selectableNetworksFor } = await import('./config')
        for (const hidden of ['test13', 'gnoland1']) {
            const offered = selectableNetworksFor(hidden)
            expect(offered[hidden], `${hidden} must stay selectable while active`).toBeDefined()
            // A one-option <select> cannot fire onChange — there must be somewhere to go.
            expect(Object.keys(offered).length).toBeGreaterThan(1)
        }
    })

    it('is the plain visible set for a visible active network', async () => {
        const { selectableNetworksFor, VISIBLE_NETWORKS } = await import('./config')
        expect(selectableNetworksFor('topaz')).toBe(VISIBLE_NETWORKS)
    })

    it('does not invent an option for an unknown network', async () => {
        const { selectableNetworksFor, VISIBLE_NETWORKS } = await import('./config')
        expect(selectableNetworksFor('no-such-network')).toBe(VISIBLE_NETWORKS)
    })
})
