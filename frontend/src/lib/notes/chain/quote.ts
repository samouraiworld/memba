import { abciQueryText } from '../../dao/packageStatus'
import { freshFeeForGasWanted, type AminoMsg } from '../../grc20'
import { getRpcUrlsInOrder } from '../../rpcFallback'
import { blob, check, decimal, NotesChainError, validNotesRealm } from './schema'
import type { NotesReadClient } from './client'
import type { NotesQuoteProvider } from './request'

/**
 * Storage beyond the stored title/body bytes (note state snapshot, history entry and
 * index nodes), in bytes, from the merged Notes realm (samcrew-deployer c20e8e6c,
 * single-copy history) on keeper e75fef82c at 100 ugnot/byte
 * (__fixtures__/history-economics.json). Each value is the largest sample for a note
 * without a writer list, rounded up; creation also adds ~3.9% of its content bytes.
 * The Onyx canary's SetPublicWrites(true) cost 1,153,100 ugnot, matching the sample.
 */
const OVERHEAD_BYTES = {
    create: 24_000, // 23,763 @ 2,208 B and 28,747 @ 131,232 B with the per-byte share below
    title: 14_000, // Rename / Commit field_mask 1: 13,842
    body: 14_000, // Commit field_mask 2: 13,821..13,839 at 2 KiB and 128 KiB
    both: 17_500, // Commit field_mask 3: 17,200
    setting: 12_000, // SetPublicWrites 11,531 / 9,403; SetCommentMode stores the same records (not sampled)
    delete: 8_500, // 8,037..8,268
} as const
const CREATE_PER_MILLE = 40
const STORAGE_PRICE_UGNOT = 100
const CAP_STEP_UGNOT = 100_000

/**
 * Two figures, never a simulation or a promised refund:
 * - estimatedDepositUgnot: the expected deposit for a typical note (no writer list).
 * - suggestedCapUgnot: the transaction's max_deposit, a safe upper bound. It allows
 *   twice the measured overhead (32 writers measured +28%, fresh comment authors +25%,
 *   index growth) and +5% on the content bytes, rounded up to 0.1 GNOT. An undersized
 *   max_deposit fails the transaction, so this margin stays generous.
 * Samples do not bound arbitrary future index growth; ante fees are separate.
 * Deployment approval must repeat these measurements against the final source.
 */
export function publicNoteBudget(message: AminoMsg): { gasWanted: number; estimatedDepositUgnot: string; suggestedCapUgnot: string } {
    check(message.type === 'vm/MsgCall' && validNotesRealm(message.value.pkg_path))
    const { func, args } = message.value
    check(Array.isArray(args))
    let bytes = 0, overhead: number
    switch (func) {
        case 'CreateNote': check(args.length === 8); bytes = blob(args[2], 160).length + blob(args[3], 131072).length; overhead = OVERHEAD_BYTES.create; break
        case 'Commit': {
            check(args.length === 7 && ['1', '2', '3'].includes(args[3]))
            bytes = blob(args[4], 160).length + blob(args[5], 131072).length
            overhead = args[3] === '1' ? OVERHEAD_BYTES.title : args[3] === '2' ? OVERHEAD_BYTES.body : OVERHEAD_BYTES.both; break
        }
        case 'Rename': check(args.length === 5); bytes = blob(args[3], 160).length; overhead = OVERHEAD_BYTES.title; break
        case 'Delete': check(args.length === 3); overhead = OVERHEAD_BYTES.delete; break
        case 'SetCommentMode': check(args.length === 4); overhead = OVERHEAD_BYTES.setting; break
        case 'SetPublicWrites': check(args.length === 4); overhead = OVERHEAD_BYTES.setting; break
        default: throw new NotesChainError('format')
    }
    // History shares the committed bytes, so content is stored once. No refund is deducted.
    const content = bytes + (func === 'CreateNote' ? Math.ceil(bytes * CREATE_PER_MILLE / 1000) : 0)
    const estimate = (content + overhead) * STORAGE_PRICE_UGNOT
    const bound = (Math.ceil(content * 105 / 100) + 2 * overhead) * STORAGE_PRICE_UGNOT
    return {
        gasWanted: Math.ceil((60_000_000 + bytes * 2_200) / 1_000_000) * 1_000_000,
        estimatedDepositUgnot: String(estimate),
        suggestedCapUgnot: String(Math.ceil(bound / CAP_STEP_UGNOT) * CAP_STEP_UGNOT),
    }
}
export function publicNoteQuote(client: NotesReadClient, maxDepositUgnot: string): NotesQuoteProvider {
    return boundedNotesQuote(client, maxDepositUgnot, publicNoteBudget)
}
export function boundedNotesQuote(client: NotesReadClient, maxDepositUgnot: string, estimate: typeof publicNoteBudget): NotesQuoteProvider {
    const cap = decimal(maxDepositUgnot, 63)
    return async input => {
        client.assertCurrent(); check(input.chainId === client.chainId && input.message.value.pkg_path === client.realm)
        check(input.message.value.max_deposit === `${cap}ugnot`)
        const budget = estimate(input.message)
        if (BigInt(cap) < BigInt(budget.estimatedDepositUgnot)) throw new NotesChainError('format')
        const urls = getRpcUrlsInOrder()
        const [price, networkFeeUgnot] = await Promise.all([
            abciQueryText({ chainId: client.chainId, rpcUrl: urls[0], rpcUrls: urls }, 'params/vm:p:storage_price', ''),
            freshFeeForGasWanted(budget.gasWanted),
        ])
        client.assertCurrent()
        // A changed network price invalidates this measured profile, rather than silently raising a budget.
        check(price.length < 64 && JSON.parse(price) === '100ugnot')
        return {
            requestDigest: input.requestDigest, chainId: input.chainId, atHeight: decimal(input.height, 63, true),
            expiresAtHeight: (BigInt(input.height) + 20n).toString(), expiresAtMs: Date.now() + 90_000,
            source: 'bounded-estimate', estimatedDepositUgnot: budget.estimatedDepositUgnot,
            maxDepositUgnot: cap, gasWanted: budget.gasWanted, networkFeeUgnot,
        }
    }
}
export function gnotAmount(ugnot: string | number): string {
    const n = BigInt(decimal(String(ugnot), 63)), fraction = (n % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
    return `${n / 1_000_000n}${fraction ? `.${fraction}` : ''} GNOT`
}
export function parseGnotCap(text: string): string | null {
    if (!/^(0|[1-9][0-9]{0,5})(\.[0-9]{1,6})?$/.test(text)) return null
    const [whole, fraction = ''] = text.split('.')
    return (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))).toString()
}
