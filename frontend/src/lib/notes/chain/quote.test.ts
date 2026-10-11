import { describe, expect, it, vi } from 'vitest'
import { publicNoteBudget, publicNoteQuote, gnotAmount, parseGnotCap } from './quote'
import { encode64, NOTES_REALM } from './schema'
import type { NotesReadClient } from './client'
import type { AminoMsg } from '../../grc20'
import { publicCommentBudget } from './commentQuote'
import measured from './__fixtures__/history-economics.json'
const io = vi.hoisted(() => ({ price: vi.fn(async () => '"100ugnot"'), fee: vi.fn(async () => 100000) }))
vi.mock('../../dao/packageStatus', () => ({ abciQueryText: io.price }))
vi.mock('../../grc20', () => ({ freshFeeForGasWanted: io.fee }))
vi.mock('../../rpcFallback', () => ({ getRpcUrlsInOrder: () => ['https://rpc.example'] }))
const create = (size: number): AminoMsg => ({ type: 'vm/MsgCall', value: { caller: '', send: '', pkg_path: NOTES_REALM, func: 'CreateNote', args: ['', '3', encode64(new TextEncoder().encode('Whitepaper')), encode64(new Uint8Array(size)), '', '', '', ''], max_deposit: '20000000ugnot' } })
function measuredMessage(row: typeof measured.rows[number]): AminoMsg {
    const first = encode64(new Uint8Array(row.titleOrAnchorBytes)), body = encode64(new Uint8Array(row.bodyBytes))
    const args: Record<string, string[]> = {
        CreateNote: ['', '4', first, body, '', '', '', ''],
        Commit: ['', '1', '0', String((row.titleOrAnchorBytes ? 1 : 0) | (row.bodyBytes ? 2 : 0)), first, body, ''],
        Rename: ['', '1', '0', first, ''], Delete: ['', '1', ''], SetPublicWrites: ['', '1', 'true', ''],
        AddComment: ['', '', '1', '0', '', first, body, ''], DeleteComment: ['', '', '1', ''],
        HideComment: ['', '', '1', 'true', ''], ResolveComment: ['', '', '1', 'true', ''],
    }
    if (!args[row.func]) throw new Error('Unsupported measurement')
    return { type: 'vm/MsgCall', value: { pkg_path: NOTES_REALM, func: row.func, args: args[row.func] } }
}
describe('product-calibrated public estimates', () => {
    it.each(measured.rows)('covers history keeper sample $case without claiming simulation', row => {
        const message = measuredMessage(row)
        const budget = row.func.includes('Comment') ? publicCommentBudget(message) : publicNoteBudget(message)
        expect(budget.gasWanted).toBeGreaterThan(row.keeperGas)
        expect(budget.gasWanted).toBeLessThanOrEqual(500000000)
        // The cap is the transaction's max_deposit: it must cover every measured sample, including 32 writers and fresh authors.
        expect(BigInt(budget.suggestedCapUgnot)).toBeGreaterThan(BigInt(Math.max(0, row.storageDepositDeltaUgnot)))
        expect(BigInt(budget.suggestedCapUgnot)).toBeGreaterThan(BigInt(budget.estimatedDepositUgnot))
        // The expected deposit covers samples without writer lists.
        if (!row.case.includes('writers')) expect(BigInt(budget.estimatedDepositUgnot)).toBeGreaterThanOrEqual(BigInt(Math.max(0, row.storageDepositDeltaUgnot)))
    })
    // Pinned to the merged-realm keeper receipts (history-economics.json); the Onyx canary's
    // SetPublicWrites(true) cost 1,153,100 ugnot on chain, identical to the keeper sample.
    it.each([
        ['public_create_2048_title160', 2_629_700, 5_100_000],
        ['public_create_131072_title160', 16_048_200, 19_200_000],
        ['collective_enable', 1_200_000, 2_400_000],
        ['collective_disable', 1_200_000, 2_400_000],
        ['collective_title_only160', 1_416_000, 2_900_000],
        ['collective_grow_2048_to_131072', 14_507_200, 16_600_000],
        ['collective_shrink_131072_to2048', 1_604_800, 3_100_000],
        ['collective_mask3_title160_body131072', 14_873_200, 17_300_000],
        ['public_delete_after_shrink', 850_000, 1_700_000],
    ])('prices %s close to its measured receipt with a separate safe cap', (name, expected, cap) => {
        const row = measured.rows.find(item => item.case === name)!
        const budget = publicNoteBudget(measuredMessage(row))
        expect(budget).toMatchObject({ estimatedDepositUgnot: String(expected), suggestedCapUgnot: String(cap) })
        expect(expected - row.storageDepositDeltaUgnot).toBeLessThanOrEqual(Math.max(row.storageDepositDeltaUgnot * 0.05, 300_000))
    })
    it('prices the comment-mode switch like the measured public-writes switch', () => {
        const message = create(0); message.value.func = 'SetCommentMode'; message.value.args = ['', '1', 'true', '']
        expect(publicNoteBudget(message)).toMatchObject({ estimatedDepositUgnot: '1200000', suggestedCapUgnot: '2400000' })
    })
    it('rejects the obsolete pre-history cap even for a small public note', async () => {
        const client = { chainId: 'gnoland-1', assertCurrent: vi.fn() } as unknown as NotesReadClient
        const message = create(2048); message.value.max_deposit = '2260000ugnot'
        await expect(publicNoteQuote(client, '2260000')({ chainId: client.chainId, message, requestDigest: 'a'.repeat(64), height: '42' })).rejects.toThrow()
    })
    it('does not claim the note/comment profiles cover publication, policy or purge operations', () => {
        for (const func of ['Publish', 'SetPolicy', 'Purge']) {
            const message = create(0); message.value.func = func
            expect(() => publicNoteBudget(message)).toThrow()
            expect(() => publicCommentBudget(message)).toThrow()
        }
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
