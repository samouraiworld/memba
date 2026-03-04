import { describe, it, expect } from 'vitest'
import {
    APP_VERSION,
    UGNOT_PER_GNOT,
    NETWORKS,
    GNO_BECH32_PREFIX,
    GNOLOVE_API_URL,
    isTrustedRpcDomain,
    TRUSTED_RPC_DOMAINS,
} from './config'

describe('config constants', () => {
    it('APP_VERSION matches v1.5.0', () => {
        expect(APP_VERSION).toBe('1.5.0')
    })

    it('UGNOT_PER_GNOT is 1 million', () => {
        expect(UGNOT_PER_GNOT).toBe(1_000_000)
    })

    it('NETWORKS has all 3 chain options', () => {
        expect(Object.keys(NETWORKS)).toContain('test11')
        expect(Object.keys(NETWORKS)).toContain('staging')
        expect(Object.keys(NETWORKS)).toContain('portal-loop')
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
        expect(isTrustedRpcDomain('https://rpc.gno.land:443')).toBe(true)
        expect(isTrustedRpcDomain('https://rpc.gno.land')).toBe(true)
    })

    it('trusts subdomains of gno.land', () => {
        expect(isTrustedRpcDomain('https://new-rpc.gno.land:443')).toBe(true)
        expect(isTrustedRpcDomain('https://staging.testnets.gno.land')).toBe(true)
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
