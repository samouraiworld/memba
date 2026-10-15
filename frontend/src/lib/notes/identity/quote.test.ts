import { describe, expect, it, vi } from 'vitest'
import type { NotesReadClient } from '../chain/client'
import type { AminoMsg } from '../../grc20'
import { IDENTITY_CAPS, IDENTITY_ESTIMATE_UGNOT, IDENTITY_GAS_WANTED, IDENTITY_MAX_DEPOSIT_UGNOT, identityQuote } from './quote'
import { NOTES_REGISTRY } from '../chain/schema'
import { NOTES_REALM } from '../chain/__fixtures__/deployment'
const io = vi.hoisted(() => ({ price: vi.fn(async () => '"100ugnot"'), fee: vi.fn(async () => 72000) }))
vi.mock('../../dao/packageStatus', () => ({ abciQueryText: io.price }))
vi.mock('../../grc20', () => ({ freshFeeForGasWanted: io.fee }))
vi.mock('../../rpcFallback', () => ({ getRpcUrlsInOrder: () => ['https://rpc.example'] }))
// M0 keeper rows (private-small-ops-m0-2026-10-15): key setup for every identity after the first, and the first one.
const M0 = { registry: 483_600n, backup: 928_800n, total: 1_412_400n, first: 1_004_100n, gas: [34_000_000, 39_700_000] }
describe('atomic identity budget', () => {
    it('quotes both independently capped calls and refuses price or cap drift', async () => {
        const client = { realm: NOTES_REALM, chainId: 'gnoland-1', assertCurrent: vi.fn() } as unknown as NotesReadClient
        const messages: AminoMsg[] = [
            { type: 'vm/MsgCall', value: { caller: '', send: '', pkg_path: NOTES_REGISTRY, func: 'RegisterKey', args: [], max_deposit: '600000ugnot' } },
            { type: 'vm/MsgCall', value: { caller: '', send: '', pkg_path: NOTES_REALM, func: 'SetSeedBackup', args: [], max_deposit: '1200000ugnot' } },
        ]
        const input = { chainId: client.chainId, messages, requestDigest: 'a'.repeat(64), height: '42' }
        const quote = identityQuote(client)
        expect(await quote(input)).toMatchObject({ source: 'bounded-estimate', gasWanted: 60000000, estimatedDepositUgnot: '1450000', maxDepositUgnot: '1800000', networkFeeUgnot: 72000 })
        expect(io.fee).toHaveBeenCalledWith(60000000)
        // The backup call must target the client's deployment realm path.
        await expect(identityQuote({ ...client, realm: 'gno.land/r/samcrew/memba_notes_rehearsal' } as NotesReadClient)(input)).rejects.toThrow('format')
        io.price.mockResolvedValueOnce('"101ugnot"'); await expect(quote(input)).rejects.toThrow()
        // Each call keeps its own exact cap: the old 1 GNOT caps, or caps swapped between the calls, are refused.
        for (const [registry, backup] of [['1000000', '1200000'], ['600000', '1000000'], ['1200000', '600000']]) {
            messages[0].value.max_deposit = `${registry}ugnot`; messages[1].value.max_deposit = `${backup}ugnot`
            await expect(quote(input)).rejects.toThrow('format')
        }
    })
    it('covers every M0 key setup with headroom on each call, and tells the member at least what was measured', () => {
        const registry = BigInt(IDENTITY_CAPS.registryUgnot), backup = BigInt(IDENTITY_CAPS.backupUgnot), estimate = BigInt(IDENTITY_ESTIMATE_UGNOT)
        // The realm refuses a call whose own deposit passes its own cap: the total alone proves nothing.
        expect(registry * 100n).toBeGreaterThanOrEqual(M0.registry * 120n)
        expect(backup * 100n).toBeGreaterThanOrEqual(M0.backup * 120n)
        expect(BigInt(IDENTITY_MAX_DEPOSIT_UGNOT)).toBe(registry + backup)
        // The estimate is never below a measured setup (1.2 GNOT was 0.21 low), and stays below the written maximum.
        expect(estimate).toBeGreaterThanOrEqual(M0.total); expect(estimate).toBeGreaterThan(M0.first)
        expect(estimate).toBeLessThan(BigInt(IDENTITY_MAX_DEPOSIT_UGNOT))
        expect(IDENTITY_GAS_WANTED).toBeGreaterThanOrEqual(Math.max(...M0.gas) * 1.5)
    })
})
