/**
 * The shared vocabulary of the network seam. Kept small on purpose: a type is
 * added here only with its first consumer.
 *
 * @module lib/chain/types
 */

/** Which kind of chain a network is: gno.land networks, or EVM networks (Base). */
export type ChainFamily = "gno" | "evm"

/**
 * A read from a chain. "unavailable" means the read failed (the RPC did not
 * answer, or answered as another chain): it never stands for "empty" or
 * "absent", which only a read that succeeded can say (outage ≠ absent).
 */
export type Read<T> = { kind: "ok"; value: T } | { kind: "unavailable"; reason: string }

/**
 * How a transaction ended, in the OS signer's terms (os/sign/signer.ts SignResult):
 * sent (and confirmed), failed or cancelled with nothing sent, refused (final: for
 * EVM, included and reverted, with its hash), or unknown (sent, outcome not seen).
 */
export type TxResult =
    | { outcome: "sent"; hash: string; result?: unknown }
    | { outcome: "failed" | "cancelled"; error: string }
    | { outcome: "refused"; error: string; hash?: string }
    /** `hash` when the transaction is known to exist; without it, the wallet may or may not have sent it. */
    | { outcome: "unknown"; error: string; hash?: string }
