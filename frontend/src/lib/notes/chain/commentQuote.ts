import type { AminoMsg } from '../../grc20'
import type { NotesReadClient } from './client'
import { blob, check, NOTES_REALM, NotesChainError } from './schema'
import { boundedNotesQuote } from './quote'

/** Conservative keeper profile; does not assume deletion refunds. */
export function publicCommentBudget(message: AminoMsg) {
    check(message.type === 'vm/MsgCall' && message.value.pkg_path === NOTES_REALM)
    const { func, args } = message.value
    check(Array.isArray(args))
    let bytes = 0
    if (func === 'AddComment') { check(args.length === 8); bytes = blob(args[5], 600).length + blob(args[6], 4000).length }
    else if (func === 'DeleteComment') check(args.length === 4)
    else if (func === 'HideComment' || func === 'ResolveComment') check(args.length === 5)
    else throw new NotesChainError('format')
    const estimate = (bytes + 18000) * 100
    return { gasWanted: 100_000_000, estimatedDepositUgnot: String(estimate), suggestedCapUgnot: String(Math.ceil(estimate * 1.2 / 100_000) * 100_000) }
}
export const publicCommentQuote = (client: NotesReadClient, cap: string) => boundedNotesQuote(client, cap, publicCommentBudget)
