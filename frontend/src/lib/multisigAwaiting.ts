/**
 * The one definition of a multisig proposal waiting for a member's signature,
 * shared by Home and Memba OS: native (legacy proposals are read-only history),
 * unsent, short of its threshold, and not yet signed by them.
 *
 * Anyone holding a member's public key can register a multisig with it, and a
 * member reads its proposals without joining. Outside the account page, a
 * multisig the member has not joined is therefore shown only as a count, never
 * with the proposer's memo.
 *
 * @module lib/multisigAwaiting
 */
import type { Transaction } from "../gen/memba/v1/memba_pb"
import { isNativeMultisig } from "./nativeMultisig"

export function waitsForSignature(tx: Transaction, me: string): boolean {
    return !!me && isNativeMultisig(tx.multisigPubkeyJson) && !tx.finalHash
        && tx.signatures.length < tx.threshold && !tx.signatures.some((s) => s.userAddress === me)
}

/** The proposals waiting for this member's signature, counted per multisig address. */
export function countAwaiting(txs: readonly Transaction[], me: string): Map<string, number> {
    const counts = new Map<string, number>()
    for (const tx of txs) if (waitsForSignature(tx, me)) counts.set(tx.multisigAddress, (counts.get(tx.multisigAddress) ?? 0) + 1)
    return counts
}

const proposals = (n: number) => `${n} proposal${n === 1 ? " waits" : "s wait"}`

/** "1 proposal waits" / "2 proposals wait" for your signature. */
export function awaitingText(n: number): string {
    return `${proposals(n)} for your signature`
}

/** The neutral count for a multisig the member has not joined. */
export function sharedAwaitingText(n: number): string {
    return `${proposals(n)} in a multisig shared with you`
}
