import type { AminoMsg } from '../../grc20'
import type { NotesReadClient } from './client'
import { boundedNotesQuote } from './quote'
import { check, validNotesRealm } from './schema'
/**
 * Delete of a private note, from the M0 keeper measurement (private-small-ops-m0-2026-10-15, rows 8): every Delete
 * returns deposit (−706,700 to −1,199,900 ugnot, 40-50 % of what the note locked) and used 24.1-26.5 M gas; the 10-08
 * 32-reader Delete used 72.7 M. So the estimate is 0 (a refund, never a deposit), the written cap is the smallest step
 * (0.1 GNOT; deleting frees storage), and gas 100 M (≥ 1.37× the 32-reader maximum).
 */
export function accessBudget(message: AminoMsg) {
  check(message.type === 'vm/MsgCall' && validNotesRealm(message.value.pkg_path))
  const { func, args } = message.value
  check(func === 'Delete' && Array.isArray(args) && args.length === 3)
  return { gasWanted: 100_000_000, estimatedDepositUgnot: '0', suggestedCapUgnot: '100000' }
}
export const accessQuote = (client: NotesReadClient, cap: string) => boundedNotesQuote(client, cap, accessBudget)
