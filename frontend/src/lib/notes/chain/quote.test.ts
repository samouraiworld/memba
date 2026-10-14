import { describe, expect, it, vi } from 'vitest'
import { publicNoteBudget, publicNoteQuote, gnotAmount, parseGnotCap } from './quote'
import { encode64 } from './schema'
import { NOTES_REALM } from './__fixtures__/deployment'
import type { NotesReadClient } from './client'
import type { AminoMsg } from '../../grc20'
import { publicCommentBudget } from './commentQuote'
import earlier from './__fixtures__/history-economics.json'
import comments from './__fixtures__/comment-economics.json'
import layout from './__fixtures__/notes-storage-363.json'
const io = vi.hoisted(() => ({ price: vi.fn(async () => '"100ugnot"'), fee: vi.fn(async () => 100000) }))
vi.mock('../../dao/packageStatus', () => ({ abciQueryText: io.price }))
vi.mock('../../grc20', () => ({ freshFeeForGasWanted: io.fee }))
vi.mock('../../rpcFallback', () => ({ getRpcUrlsInOrder: () => ['https://rpc.example'] }))
const create = (size: number): AminoMsg => ({ type: 'vm/MsgCall', value: { caller: '', send: '', pkg_path: NOTES_REALM, func: 'CreateNote', args: ['', '3', encode64(new TextEncoder().encode('Field guide')), encode64(new Uint8Array(size)), '', '', '', ''], max_deposit: '20000000ugnot' } })
type Measured = { func: string; titleOrAnchorBytes: number; bodyBytes: number; args?: string[] }
function measuredMessage(row: Measured): AminoMsg {
    const first = encode64(new Uint8Array(row.titleOrAnchorBytes)), body = encode64(new Uint8Array(row.bodyBytes)), flag = row.args?.[0] ?? 'true'
    const args: Record<string, string[]> = {
        CreateNote: ['', '4', first, body, '', '', '', ''],
        Commit: ['', '1', '0', String((row.titleOrAnchorBytes ? 1 : 0) | (row.bodyBytes ? 2 : 0)), first, body, ''],
        Rename: ['', '1', '0', first, ''], Delete: ['', '1', ''], SetPublicWrites: ['', '1', flag, ''], SetCommentMode: ['', '1', flag, ''],
        AddComment: ['', '', '1', '0', '', first, body, ''], DeleteComment: ['', '', '1', ''],
        HideComment: ['', '', '1', 'true', ''], ResolveComment: ['', '', '1', 'true', ''],
    }
    if (!args[row.func]) throw new Error('Unsupported measurement')
    return { type: 'vm/MsgCall', value: { pkg_path: NOTES_REALM, func: row.func, args: args[row.func] } }
}
const budgetOf = (message: AminoMsg) => /^(Add|Delete|Hide|Resolve)Comment$/.test(message.value.func) ? publicCommentBudget(message) : publicNoteBudget(message)
describe('product-calibrated public estimates', () => {
    // The deployed layout (#363, notes-storage-363.json): the shown figure is never below a steady-state receipt and
    // within 3% of the largest receipt of the same operation; the signed cap keeps at least 20% above it and the gas
    // limit 1.5x the keeper gas.
    const operation = (row: Measured) => `${row.func}(${row.args?.join() ?? ''})`
    it.each(layout.rows)('prices the #363 receipt $case closely, with a safe cap and gas', row => {
        const budget = budgetOf(measuredMessage(row)), deposit = row.storageDepositDeltaUgnot
        const largest = Math.max(...layout.rows.filter(other => operation(other) === operation(row)).map(other => other.storageDepositDeltaUgnot))
        expect(Number(budget.estimatedDepositUgnot)).toBeGreaterThanOrEqual(deposit)
        expect(Number(budget.estimatedDepositUgnot)).toBeLessThanOrEqual(Math.ceil(largest * 1.03))
        expect(Number(budget.suggestedCapUgnot)).toBeGreaterThanOrEqual(deposit * 1.2)
        expect(budget.gasWanted).toBeGreaterThanOrEqual(row.keeperGas * 1.5)
        expect(budget.gasWanted).toBeLessThanOrEqual(500000000)
    })
    // F2/F14 of the rc1 canary: the old profile showed 2.41 GNOT for a creation that cost 1.64 in all. What the sheet
    // shows (expected deposit plus create fee) now stays within 35% of what the account spent, and the cap above it.
    // A comment is shown at the dearest case (a new author's reply), so the canary's first comment, the cheapest case, gets 50%.
    it.each(layout.onyxCanary.rows)('stays close to the Onyx canary charge for $case', row => {
        const budget = budgetOf(measuredMessage(row)), shown = Number(budget.estimatedDepositUgnot) + row.createFeeUgnot
        expect(shown).toBeLessThanOrEqual(row.totalSpentUgnot * (row.func === 'AddComment' ? 1.5 : 1.35))
        expect(Number(budget.suggestedCapUgnot)).toBeGreaterThanOrEqual(row.totalSpentUgnot)
    })
    // Large bodies were not sampled on #363. The earlier layout (history-economics.json, c20e8e6c) stored more for
    // every operation (#363 evidence: 11-65% less), so its large-body receipts bound the cap from above.
    it.each(earlier.rows.filter(row => row.bodyBytes >= 100_000))('keeps the cap above the earlier layout\'s large-body receipt $case', row => {
        const budget = budgetOf(measuredMessage(row))
        expect(BigInt(budget.suggestedCapUgnot)).toBeGreaterThan(BigInt(row.storageDepositDeltaUgnot))
        expect(budget.gasWanted).toBeGreaterThan(row.keeperGas)
    })
    it.each([
        ['create, 1,291 B (the canary note shape)', { func: 'CreateNote', titleOrAnchorBytes: 19, bodyBytes: 1272 }, 2_054_300, 4_000_000],
        ['create, 2 KiB', { func: 'CreateNote', titleOrAnchorBytes: 160, bodyBytes: 2048 }, 2_149_700, 4_100_000],
        ['create, 128 KiB', { func: 'CreateNote', titleOrAnchorBytes: 160, bodyBytes: 131072 }, 15_568_200, 18_200_000],
        ['body edit, 1,300 B', { func: 'Commit', titleOrAnchorBytes: 0, bodyBytes: 1300 }, 810_000, 1_500_000],
        ['rename, 32 B', { func: 'Rename', titleOrAnchorBytes: 32, bodyBytes: 0 }, 683_200, 1_400_000],
        ['title and body', { func: 'Commit', titleOrAnchorBytes: 19, bodyBytes: 1310 }, 922_900, 1_800_000],
        ['open editing', { func: 'SetPublicWrites', titleOrAnchorBytes: 0, bodyBytes: 0, args: ['true'] }, 670_000, 1_400_000],
        ['close editing', { func: 'SetPublicWrites', titleOrAnchorBytes: 0, bodyBytes: 0, args: ['false'] }, 460_000, 1_000_000],
        ['delete', { func: 'Delete', titleOrAnchorBytes: 0, bodyBytes: 0 }, 290_000, 600_000],
    ] as const)('prices a %s from the #363 receipts with a separate safe cap', (_name, row, expected, cap) => {
        expect(publicNoteBudget(measuredMessage(row))).toMatchObject({ estimatedDepositUgnot: String(expected), suggestedCapUgnot: String(cap) })
    })
    function commentMessage(func: string, anchorBytes: number, bodyBytes: number): AminoMsg {
        const args = func === 'AddComment' ? ['', '', '1', '0', '', encode64(new Uint8Array(anchorBytes)), encode64(new Uint8Array(bodyBytes)), '']
            : func === 'DeleteComment' ? ['', '', '1', ''] : ['', '', '1', 'true', '']
        return { type: 'vm/MsgCall', value: { pkg_path: NOTES_REALM, func, args } }
    }
    // Earlier-layout comment receipts (comment-economics.json): #363 stores 11-16% less per comment, so these bound it from
    // above. Gas did not change with #363: the limit keeps 1.5x every receipt, also after ~410 comments on one note (growth run).
    it.each([...comments.rows, ...comments.growth.rows])('keeps cap and gas above earlier-layout comment receipt $case', row => {
        const budget = publicCommentBudget(commentMessage(row.func, row.anchorBytes, row.bodyBytes))
        expect(Number(budget.suggestedCapUgnot)).toBeGreaterThanOrEqual(row.storageDepositDeltaUgnot)
        expect(budget.gasWanted).toBeGreaterThanOrEqual(row.keeperGas * 1.5)
        expect(budget.gasWanted).toBeLessThanOrEqual(500000000)
    })
    it('keeps cap and gas above the worst one-line receipt of the growth run', () => {
        const worst = comments.growth.oneLineMax, budget = publicCommentBudget(commentMessage('AddComment', worst.anchorBytes, worst.bodyBytes))
        expect(Number(budget.suggestedCapUgnot)).toBeGreaterThanOrEqual(worst.storageDepositDeltaUgnot)
        expect(budget.gasWanted).toBeGreaterThanOrEqual(worst.keeperGas * 1.5)
    })
    it.each([
        ['one-line comment', 'AddComment', 0, 37, 1_933_700, 2_400_000, 87_000_000],
        ['one-line comment with a 120 B quote', 'AddComment', 120, 37, 1_945_700, 2_400_000, 88_000_000],
        ['largest comment', 'AddComment', 600, 4000, 2_390_000, 2_900_000, 142_000_000],
        ['hide', 'HideComment', 0, 0, 390_000, 500_000, 60_000_000],
        ['resolve', 'ResolveComment', 0, 0, 390_000, 500_000, 60_000_000],
        ['delete', 'DeleteComment', 0, 0, 390_000, 500_000, 60_000_000],
    ] as const)('prices a %s from the #363 receipts', (_name, func, anchor, body, expected, cap, gas) => {
        expect(publicCommentBudget(commentMessage(func, anchor, body))).toEqual({ estimatedDepositUgnot: String(expected), suggestedCapUgnot: String(cap), gasWanted: gas })
    })
    it('prices opening comments at its projected cost, and closing them from its own receipt', () => {
        const message = create(0); message.value.func = 'SetCommentMode'; message.value.args = ['', '1', 'true', '']
        expect(publicNoteBudget(message)).toMatchObject({ estimatedDepositUgnot: '770000', suggestedCapUgnot: '1600000' })
        message.value.args = ['', '1', 'false', '']
        expect(publicNoteBudget(message)).toMatchObject({ estimatedDepositUgnot: '560000', suggestedCapUgnot: '1200000' })
        message.value.args = ['', '1', 'maybe', '']
        expect(() => publicNoteBudget(message)).toThrow()
    })
    it('refuses a signed cap below the expected deposit, even for a small public note', async () => {
        const client = { realm: NOTES_REALM, chainId: 'gnoland-1', assertCurrent: vi.fn() } as unknown as NotesReadClient
        // 2 KiB with an 11 B title is expected at 2.1342 GNOT.
        const message = create(2048); message.value.max_deposit = '2100000ugnot'
        await expect(publicNoteQuote(client, '2100000')({ chainId: client.chainId, message, requestDigest: 'a'.repeat(64), height: '42' })).rejects.toThrow()
    })
    it('does not claim the note/comment profiles cover publication, policy or purge operations', () => {
        for (const func of ['Publish', 'SetPolicy', 'Purge']) {
            const message = create(0); message.value.func = func
            expect(() => publicNoteBudget(message)).toThrow()
            expect(() => publicCommentBudget(message)).toThrow()
        }
    })
    it('binds estimates to messages, cap, chain and fresh network price', async () => {
        const client = { realm: NOTES_REALM, chainId: 'gnoland-1', assertCurrent: vi.fn() } as unknown as NotesReadClient
        const input = { chainId: client.chainId, message: create(2048), requestDigest: 'a'.repeat(64), height: '42' }
        const provider = publicNoteQuote(client, '20000000')
        expect(await provider(input)).toMatchObject({ source: 'bounded-estimate', requestDigest: input.requestDigest, expiresAtHeight: '62', maxDepositUgnot: '20000000', networkFeeUgnot: 100000 })
        await expect(provider({ ...input, chainId: 'onyx-1' })).rejects.toThrow()
        // A message for another realm path than the client's deployment is never priced.
        await expect(publicNoteQuote({ ...client, realm: 'gno.land/r/samcrew/memba_notes_rehearsal' } as NotesReadClient, '20000000')(input)).rejects.toThrow('format')
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
