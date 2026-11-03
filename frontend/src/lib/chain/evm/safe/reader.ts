/**
 * The network's RPC (the adapter's transport) as the reader the Safe checks
 * need (./inspect.ts). Part of the lazy Safe SDK chunk.
 *
 * @module lib/chain/evm/safe/reader
 */
import { getPublicClient } from "@wagmi/core"
import { chainFor, evmConfig } from "../adapter"
import type { SafeReader } from "./inspect"

export function safeReader(networkKey: string): SafeReader {
    const chain = chainFor(networkKey)
    const client = getPublicClient(evmConfig, { chainId: chain.id as (typeof evmConfig.chains)[number]["id"] })
    return {
        getChainId: () => client.getChainId(),
        getCode: (address) => client.getCode({ address }),
        getStorageAt: (address, slot) => client.getStorageAt({ address, slot }),
        call: async (to, data) => (await client.call({ to, data })).data ?? "0x",
    }
}
