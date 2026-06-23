import { describe, it, expect } from 'vitest'
import pkg from '../../package.json'
import {
    APP_VERSION,
    UGNOT_PER_GNOT,
    NETWORKS,
    VISIBLE_NETWORKS,
    DEFAULT_NETWORK,
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
} from './config'

describe('config constants', () => {
    it('APP_VERSION matches package.json', () => {
        expect(APP_VERSION).toBe(pkg.version)
    })

    it('UGNOT_PER_GNOT is 1 million', () => {
        expect(UGNOT_PER_GNOT).toBe(1_000_000)
    })

    it('NETWORKS has the expected chain options', () => {
        // test12 retired from the network map at the test13 cutover.
        expect(Object.keys(NETWORKS)).not.toContain('test12')
        expect(Object.keys(NETWORKS)).toContain('staging')
        expect(Object.keys(NETWORKS)).toContain('portal-loop')
        expect(Object.keys(NETWORKS)).toContain('gnoland1')
        expect(Object.keys(NETWORKS)).toContain('test13')
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

    it('test13 is visible in the selector (now the official testnet)', () => {
        expect(NETWORKS.test13.hidden).toBeFalsy()
        expect(Object.keys(VISIBLE_NETWORKS)).toContain('test13')
    })

    it('test13 points at the official testnets.gno.land RPC', () => {
        expect(NETWORKS.test13.rpcUrl).toBe('https://rpc.test13.testnets.gno.land:443')
    })

    it('networkHasRealms reflects Memba contract deployment per network', () => {
        // Memba's realms are live on test13 (interrealm-v2, 2026-06-16).
        expect(networkHasRealms('test13')).toBe(true)
        // Unknown / retired networks (e.g. test12) default to "has realms"
        // (don't gate the UI on a typo).
        expect(networkHasRealms('test12')).toBe(true)
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
        // test12 (and unknown networks) have no allowlist → everything valid.
        expect(isRealmValidOn('test12', 'gno.land/r/samcrew/tokenfactory')).toBe(true)
        expect(isRealmValidOn('betanet', 'gno.land/r/samcrew/escrow')).toBe(true)
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

    it('DEFAULT_NETWORK is test13 (post-cutover default)', () => {
        expect(DEFAULT_NETWORK).toBe('test13')
    })

    it('getUserRegistryPath returns r/sys/users for the default network', () => {
        // Default active network is test13, which uses r/sys/users
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

describe('isTrustedRpcDomain', () => {
    it('trusts official gno.land RPC URLs', () => {
        expect(isTrustedRpcDomain('https://rpc.test11.testnets.gno.land:443')).toBe(true)
        expect(isTrustedRpcDomain('https://rpc.test12.gno.land:443')).toBe(true)
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
