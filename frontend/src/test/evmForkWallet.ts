/**
 * Test support for the EVM fork tests (lib/chain/evm/safe/*.fork.test.ts): stands in for the EVM
 * adapter with a wagmi config whose only chain is an anvil fork of Base
 * Sepolia and whose wallet is wagmi's mock connector for one of anvil's
 * unlocked default accounts (anvil signs and sends for them). Memba's own
 * create / propose / sign / execute code then runs unchanged against the fork.
 *
 * Never imported by the app.
 *
 * @module test/evmForkWallet
 */
import { connect, createConfig, http, mock, type Config } from "@wagmi/core"
import { baseSepolia, type Chain } from "viem/chains"
import type { Hex } from "viem"

export const FORK = process.env.MEMBA_EVM_FORK_RPC ?? ""

/** anvil's default accounts 0-4 (public test keys, funded on every anvil fork). */
export const ANVIL: readonly Hex[] = [
    "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
    "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
    "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
    "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
]

const forkChain: Chain = { ...baseSepolia, rpcUrls: { default: { http: [FORK] } } }
let current: Config | null = null

/** Makes `account` the connected wallet. */
export async function connectWallet(account: Hex): Promise<void> {
    current = createConfig({
        chains: [forkChain as typeof baseSepolia],
        connectors: [mock({ accounts: [account] })],
        transports: { [baseSepolia.id]: http(FORK) },
        pollingInterval: 50,
    })
    await connect(current, { connector: current.connectors[0] })
}

/** What `vi.mock("../adapter", …)` returns in a fork test. */
export const forkAdapter = {
    chainFor: () => forkChain,
    get evmConfig() {
        if (!current) throw new Error("call connectWallet() first")
        return current
    },
}
