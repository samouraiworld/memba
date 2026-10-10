import { abciQueryText } from '../../dao/packageStatus'
import { freshFeeForGasWanted, type AminoMsg } from '../../grc20'
import { getRpcUrlsInOrder } from '../../rpcFallback'
import { blob, check, decimal, NOTES_REALM, NotesChainError } from './schema'
import type { NotesReadClient } from './client'
import type { NotesQuoteProvider } from './request'

/**
 * Estimates calibrated against public-history source 878cf4f on keeper e75fef82c,
 * at 100 ugnot/byte. These are estimates, not a simulation or a promised refund.
 * The transaction's fee and max_deposit remain the actual spending limits.
 * Samples do not bound arbitrary future index growth; ante fees are separate.
 * Deployment approval must repeat these measurements against the final source.
 */
export function publicNoteBudget(message: AminoMsg): { gasWanted: number; estimatedDepositUgnot: string; suggestedCapUgnot: string } {
    check(message.type === 'vm/MsgCall' && message.value.pkg_path === NOTES_REALM)
    const { func, args } = message.value
    check(Array.isArray(args))
    let bytes = 0
    switch (func) {
        case 'CreateNote': check(args.length === 8); bytes = blob(args[2], 160).length + blob(args[3], 131072).length; break
        case 'Commit': check(args.length === 7); bytes = blob(args[4], 160).length + blob(args[5], 131072).length; break
        case 'Rename': check(args.length === 5); bytes = blob(args[3], 160).length; break
        case 'Delete': check(args.length === 3); break
        case 'SetCommentMode': check(args.length === 4); break
        case 'SetPublicWrites': check(args.length === 4); break
        default: throw new NotesChainError('format')
    }
    // Current content plus immutable history, with room for metadata/index/receipt nodes.
    // No expected refund is deducted from this estimate.
    const estimate = (2 * bytes + 40_000) * 100
    return {
        gasWanted: Math.ceil((60_000_000 + bytes * 2_200) / 1_000_000) * 1_000_000,
        estimatedDepositUgnot: String(estimate),
        suggestedCapUgnot: String(Math.ceil(estimate * 1.2 / 100_000) * 100_000),
    }
}
export function publicNoteQuote(client: NotesReadClient, maxDepositUgnot: string): NotesQuoteProvider {
    return boundedNotesQuote(client, maxDepositUgnot, publicNoteBudget)
}
export function boundedNotesQuote(client: NotesReadClient, maxDepositUgnot: string, estimate: typeof publicNoteBudget): NotesQuoteProvider {
    const cap = decimal(maxDepositUgnot, 63)
    return async input => {
        client.assertCurrent(); check(input.chainId === client.chainId)
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
