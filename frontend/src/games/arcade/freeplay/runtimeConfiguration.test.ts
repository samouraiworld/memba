import { describe, expect, it, vi } from 'vitest'
import { validateArcadeFreePlayConfiguration, type ArcadeFreePlayConfiguration } from './runtimeConfiguration'
const storage = { getItem: vi.fn(), setItem: vi.fn() }
const target = { chainId: 'gnoland-1', realm: 'gno.land/r/samcrew/memba_arcade_scores_v2' }
const remote = { origin: 'https://backend.example', target }
const configuration: ArcadeFreePlayConfiguration = { chainId: target.chainId, storage, games: {
    'block-party': { rules: 'bp-free-standard-undo-v1', simVersion: 1, remote },
    'space-invaders': { rules: 'si-free-standard-v1', simVersion: 1, remote },
    barricade: { rules: 'barricade-fps-c1', simVersion: 3, remote },
} }
describe('explicit OS Free play configuration contract', () => {
    it('accepts reviewed remote/local-only scopes without touching storage or constructing runtime', () => {
        expect(() => validateArcadeFreePlayConfiguration(configuration)).not.toThrow()
        expect(() => validateArcadeFreePlayConfiguration({ ...configuration, games: { 'block-party': { rules: 'bp-free-standard-undo-v1', simVersion: 1 } } })).not.toThrow()
        expect(() => validateArcadeFreePlayConfiguration({ ...configuration, games: {} })).not.toThrow()
        expect(storage.getItem).not.toHaveBeenCalled(); expect(storage.setItem).not.toHaveBeenCalled()
    })
    it('rejects wrong network/realm, unknown game and unsupported rules/version', () => {
        for (const game of [
            { rules: 'bp-free-standard-undo-v1', simVersion: 1, remote: { ...remote, target: { ...target, chainId: 'other-chain' } } },
            { rules: 'bp-free-standard-undo-v1', simVersion: 1, remote: { ...remote, target: { ...target, realm: 'gno.land/r/other' } } },
            { rules: 'bp-free-standard-undo-v1', simVersion: 2, remote },
            { rules: 'daily', simVersion: 1, remote },
        ]) expect(() => validateArcadeFreePlayConfiguration({ ...configuration, games: { 'block-party': game } })).toThrow('invalid_runtime_configuration')
        expect(() => validateArcadeFreePlayConfiguration({ ...configuration, games: { other: {} } } as unknown as ArcadeFreePlayConfiguration)).toThrow('invalid_runtime_configuration')
    })
    it('requires a bare explicit origin and never supplies a fallback', () => {
        for (const origin of ['', '/api', 'javascript:alert(1)', 'https://user:pass@backend.example', 'https://backend.example/api', 'https://backend.example?target=other', 'https://backend.example#realm']) {
            expect(() => validateArcadeFreePlayConfiguration({ ...configuration, games: { 'block-party': { rules: 'bp-free-standard-undo-v1', simVersion: 1, remote: { origin, target } } } })).toThrow('invalid_runtime_configuration')
        }
    })
})


it('requires HTTPS remotely and accepts only literal loopback HTTP origins', () => {
    const configured = (origin: string): ArcadeFreePlayConfiguration => ({ ...configuration, games: { 'block-party': { rules: 'bp-free-standard-undo-v1', simVersion: 1, remote: { origin, target } } } })
    for (const origin of ['https://backend.example', 'http://localhost:8080', 'http://127.0.0.1:8080/', 'http://[::1]:8080']) {
        expect(() => validateArcadeFreePlayConfiguration(configured(origin))).not.toThrow()
    }
    for (const origin of ['http://backend.example', 'http://192.168.1.10', 'http://localhost.example', 'http://sub.localhost', 'http://localhost.', 'http://127.0.0.1.example', 'http://localhost@backend.example', 'http://[::2]', 'http://[::ffff:127.0.0.1]', 'http://127.1', 'http://2130706433', 'http://0x7f000001']) {
        expect(() => validateArcadeFreePlayConfiguration(configured(origin))).toThrow('invalid_runtime_configuration')
    }
})
