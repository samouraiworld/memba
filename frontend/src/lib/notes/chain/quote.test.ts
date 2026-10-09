import { describe, expect, it, vi } from 'vitest'
import { publicNoteBudget, publicNoteQuote, gnotAmount, parseGnotCap } from './quote'
import { encode64, NOTES_REALM } from './schema'
import type { NotesReadClient } from './client'
import type { AminoMsg } from '../../grc20'
const io = vi.hoisted(() => ({ price: vi.fn(async () => '"100ugnot"'), fee: vi.fn(async () => 100000) }))
vi.mock('../../dao/packageStatus', () => ({ abciQueryText: io.price }))
vi.mock('../../grc20', () => ({ freshFeeForGasWanted: io.fee }))
vi.mock('../../rpcFallback', () => ({ getRpcUrlsInOrder: () => ['https://rpc.example'] }))
const create = (size: number): AminoMsg => ({ type: 'vm/MsgCall', value: { caller: '', send: '', pkg_path: NOTES_REALM, func: 'CreateNote', args: ['', '3', encode64(new TextEncoder().encode('Whitepaper')), encode64(new Uint8Array(size)), '', '', '', ''], max_deposit: '20000000ugnot' } })
describe('product-calibrated public estimates', () => {
    it.each([[2048, 27081330, 956500], [40960, 95655915, 4942100], [65536, 139526684, 7398500], [131072, 255660598, 13950900]])('covers observed product create %i bytes without claiming simulation', (bytes, gas, deposit) => {
        const budget = publicNoteBudget(create(bytes))
        expect(budget.gasWanted).toBeGreaterThan(gas)
        expect(budget.gasWanted).toBeLessThanOrEqual(500000000)
        expect(BigInt(budget.estimatedDepositUgnot)).toBeGreaterThan(BigInt(deposit))
        expect(BigInt(budget.suggestedCapUgnot)).toBeGreaterThan(BigInt(budget.estimatedDepositUgnot))
    })
    it('binds estimates to messages, cap, chain and fresh network price', async () => {
        const client = { chainId: 'gnoland-1', assertCurrent: vi.fn() } as unknown as NotesReadClient
        const input = { chainId: client.chainId, message: create(2048), requestDigest: 'a'.repeat(64), height: '42' }
        const provider = publicNoteQuote(client, '20000000')
        expect(await provider(input)).toMatchObject({ source: 'bounded-estimate', requestDigest: input.requestDigest, expiresAtHeight: '62', maxDepositUgnot: '20000000', networkFeeUgnot: 100000 })
        await expect(provider({ ...input, chainId: 'onyx-1' })).rejects.toThrow()
        await expect(publicNoteQuote(client, '1')(input)).rejects.toThrow()
        io.price.mockResolvedValueOnce('"101ugnot"'); await expect(provider(input)).rejects.toThrow()
        io.fee.mockRejectedValueOnce(new Error('unavailable')); await expect(provider(input)).rejects.toThrow()
    })
    it('never uses floating-point arithmetic for user deposit caps', () => {
        expect(parseGnotCap('0.000001')).toBe('1'); expect(parseGnotCap('19.125')).toBe('19125000')
        expect(gnotAmount('19125001')).toBe('19.125001 GNOT')
        for (const invalid of ['-1', '1e3', 'NaN', '.1', '01', '0.0000001', '1,2', ' 1', '1000000']) expect(parseGnotCap(invalid)).toBeNull()
    })
})
