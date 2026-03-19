import { describe, it, expect } from 'vitest'
import {
    APP_VERSION,
    UGNOT_PER_GNOT,
    NETWORKS,
    DEFAULT_NETWORK,
    GNO_BECH32_PREFIX,
    GNOLOVE_API_URL,
    isTrustedRpcDomain,
    TRUSTED_RPC_DOMAINS,
    getTelemetryRpcUrl,
    GNO_RPC_URL,
    getUserRegistryPath,
} from './config'

describe('config constants', () => {
    it('APP_VERSION matches package.json', () => {
        expect(APP_VERSION).toBe('2.13.0')
    })

    it('UGNOT_PER_GNOT is 1 million', () => {
        expect(UGNOT_PER_GNOT).toBe(1_000_000)
    })

    it('NETWORKS has all 5 chain options', () => {
        expect(Object.keys(NETWORKS)).toContain('test12')
        expect(Object.keys(NETWORKS)).toContain('test11')
        expect(Object.keys(NETWORKS)).toContain('staging')
        expect(Object.keys(NETWORKS)).toContain('portal-loop')
        expect(Object.keys(NETWORKS)).toContain('gnoland1')
    })

    it('test12 has correct chain config', () => {
        const t12 = NETWORKS.test12
        expect(t12.chainId).toBe('test12')
        expect(t12.rpcUrl).toBe('https://rpc.testnet12.samourai.live:443')
        expect(t12.userRegistryPath).toBe('gno.land/r/sys/users')
        expect(t12.faucetUrl).toBe('https://faucet.gno.land')
    })

    it('test12 and gnoland1 use r/sys/users registry', () => {
        expect(NETWORKS.test12.userRegistryPath).toBe('gno.land/r/sys/users')
        expect(NETWORKS.gnoland1.userRegistryPath).toBe('gno.land/r/sys/users')
    })

    it('gnoland1 has correct chain config', () => {
        const g1 = NETWORKS.gnoland1
        expect(g1.chainId).toBe('gnoland1')
        expect(g1.rpcUrl).toBe('https://rpc.gnoland1.samourai.live:443')
        expect(g1.label).toBe('Betanet (gnoland1)')
        expect(g1.faucetUrl).toBe('')
    })

    it('DEFAULT_NETWORK is test12', () => {
        expect(DEFAULT_NETWORK).toBe('test12')
    })

    it('getUserRegistryPath returns r/sys/users for test12', () => {
        // Default active network is test12, so getUserRegistryPath should return r/sys/users
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

    it('GNOLOVE_API_URL defaults to gnolove.world', () => {
        expect(GNOLOVE_API_URL).toBe('https://gnolove.world')
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
    it('falls back to GNO_RPC_URL when no sentry is configured', () => {
        // In test environment, VITE_SAMOURAI_SENTRY_RPC_URL is not set
        // so getTelemetryRpcUrl() must equal GNO_RPC_URL
        const url = getTelemetryRpcUrl()
        expect(url).toBe(GNO_RPC_URL)
        expect(url).toBeTruthy()
    })

    it('GNO_RPC_URL is always a trusted domain', () => {
        expect(isTrustedRpcDomain(GNO_RPC_URL)).toBe(true)
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
