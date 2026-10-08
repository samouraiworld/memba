/**
 * Is this RPC the chain we asked for, and where is it? Kept free of any EVM
 * library so it can be tested with plain fakes. An RPC that answers is not
 * proof of the chain: `eth_chainId` is checked before anything is trusted.
 *
 * @module lib/chain/evm/chainCheck
 */
import type { Read } from "../types"

export interface ChainStatus {
    blockNumber: bigint
}

/** The two RPC calls the check needs (a viem public client has both). */
export interface ChainReader {
    getChainId: () => Promise<number>
    getBlockNumber: () => Promise<bigint>
}

const NO_ANSWER = { kind: "unavailable", reason: "the RPC did not answer" } as const

export async function readChainStatus(expectedChainId: number, reader: ChainReader): Promise<Read<ChainStatus>> {
    let chainId: number
    try {
        chainId = await reader.getChainId()
    } catch {
        return NO_ANSWER
    }
    if (chainId !== expectedChainId) return { kind: "unavailable", reason: `the RPC answered as chain ${chainId}, not ${expectedChainId}` }
    try {
        return { kind: "ok", value: { blockNumber: await reader.getBlockNumber() } }
    } catch {
        return NO_ANSWER
    }
}

/** The code at an address, read only from an RPC that proves it serves the expected chain. */
export async function readCode(expectedChainId: number, reader: Pick<ChainReader, "getChainId"> & { getCode: (a: { address: `0x${string}` }) => Promise<string | undefined> }, address: `0x${string}`): Promise<Read<string>> {
    let chainId: number
    try {
        chainId = await reader.getChainId()
    } catch {
        return NO_ANSWER
    }
    if (chainId !== expectedChainId) return { kind: "unavailable", reason: `the RPC answered as chain ${chainId}, not ${expectedChainId}` }
    try {
        return { kind: "ok", value: (await reader.getCode({ address })) ?? "0x" }
    } catch {
        return NO_ANSWER
    }
}
