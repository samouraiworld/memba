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
