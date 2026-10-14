import type { AminoMsg } from '../../grc20'
import type { NotesReadClient } from './client'
import { blob, check, NOTES_REALM, NotesChainError } from './schema'
import { boundedNotesQuote } from './quote'

/**
 * Calibrated on keeper receipts for the merged Notes realm at 100 ugnot/byte (__fixtures__/comment-economics.json):
 * - AddComment stores its anchor and body plus ~20,500 bytes of comment, index and author records
 *   (a fresh author's one-line comment measured up to 2,010,900 ugnot; the largest, 4,600 bytes, 2,508,500);
 * - Hide/Resolve/DeleteComment store at most ~5,000 bytes (440,200 / 436,000 / 409,500 measured).
 * The signed cap is 1.2x the expected deposit, rounded up to 0.1 GNOT: at least 20% above every measured receipt,
 * also after ~410 comments on a note (growth run: worst one-line 2,032,800, largest 2,519,600).
 * No refund is assumed. Gas: keeper gas grows with the comments already on a note (a largest comment used
 * 80.7M after ~43 comments and 92.8M after ~410, a one-line one 45.4M after 30 and 56.8M by 400), so the limit is
 * 80M + 10,000 per stored byte for a post (81M one-line, 126M largest: 1.5x the samples up to ~43 comments,
 * 1.35x after ~410) and 60M for the other actions (29.6M measured).
 */
const ADD_OVERHEAD_BYTES = 20_500
const ACTION_OVERHEAD_BYTES = 5_000
const STORAGE_PRICE_UGNOT = 100
const CAP_STEP_UGNOT = 100_000
export function publicCommentBudget(message: AminoMsg) {
    check(message.type === 'vm/MsgCall' && message.value.pkg_path === NOTES_REALM)
    const { func, args } = message.value
    check(Array.isArray(args))
    let bytes = 0, overhead = ACTION_OVERHEAD_BYTES, gasWanted = 60_000_000
    if (func === 'AddComment') {
        check(args.length === 8); bytes = blob(args[5], 600).length + blob(args[6], 4000).length
        overhead = ADD_OVERHEAD_BYTES; gasWanted = Math.ceil((80_000_000 + bytes * 10_000) / 1_000_000) * 1_000_000
    }
    else if (func === 'DeleteComment') check(args.length === 4)
    else if (func === 'HideComment' || func === 'ResolveComment') check(args.length === 5)
    else throw new NotesChainError('format')
    const estimate = (bytes + overhead) * STORAGE_PRICE_UGNOT
    // Integer arithmetic: 1.2x, rounded up to the cap step.
    const cap = Math.ceil(estimate * 12 / (10 * CAP_STEP_UGNOT)) * CAP_STEP_UGNOT
    return { gasWanted, estimatedDepositUgnot: String(estimate), suggestedCapUgnot: String(cap) }
}
export const publicCommentQuote = (client: NotesReadClient, cap: string) => boundedNotesQuote(client, cap, publicCommentBudget)
