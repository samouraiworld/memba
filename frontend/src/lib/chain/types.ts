/**
 * The shared vocabulary of the network seam. Kept small on purpose: a type is
 * added here only with its first consumer.
 *
 * @module lib/chain/types
 */

/** Which kind of chain a network is: gno.land networks, or EVM networks (Base). */
export type ChainFamily = "gno" | "evm"
