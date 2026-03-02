import { describe, it, expect } from 'vitest'
import {
    APP_VERSION,
    UGNOT_PER_GNOT,
    NETWORKS,
    GNO_BECH32_PREFIX,
    GNOLOVE_API_URL,
} from './config'

describe('config constants', () => {
    it('APP_VERSION matches v6.0.0', () => {
        expect(APP_VERSION).toBe('6.0.0')
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
