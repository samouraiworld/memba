/**
 * The one send path for every EVM write in Memba (Safe creation and execution,
 * token deployment, Basenames, wallet sends). Every write is bound to its chain:
 *
 *  1. the chain must be one of Memba's (lib/chain/evm/networks.ts);
 *  2. the wallet's own provider is asked `eth_chainId` right before the send,
 *     never the cached connection state: a transaction sent on the other chain
 *     to an address with no code "succeeds" and loses its value;
 *  3. a contract call (calldata) needs code at `to`, read on that chain; a
 *     failed read refuses too, since an outage proves nothing;
 *  4. the chain is passed to the send, so viem checks it once more.
 *
 * Then the receipt is awaited. Results map onto the OS signer's outcomes (TxResult).
 *
 * @module lib/chain/evm/send
 */
import { getConnectorClient, getPublicClient, sendTransaction, type Config } from "@wagmi/core"
import type { TxResult } from "../types"
import { EVM_NETWORKS } from "./networks"

export interface EvmWrite {
    /** EIP-155 chain id the transaction is for. */
    chainId: number
    to: `0x${string}`
    /** Calldata; omitted or "0x" for a plain value transfer. */
    data?: `0x${string}`
    value?: bigint
}

/** How long the receipt is awaited before the outcome is reported as unknown. */
const RECEIPT_TIMEOUT_MS = 120_000

function networkLabel(chainId: number): string | null {
    return Object.values(EVM_NETWORKS).find((n) => n.chainId === chainId)?.label ?? null
}

/** EIP-1193 4001 (user rejected), wherever a wrapper put it. */
function rejectedInWallet(err: unknown): boolean {
    for (let e: unknown = err, depth = 0; e && depth < 6; e = (e as { cause?: unknown }).cause, depth++) {
        if ((e as { code?: unknown }).code === 4001) return true
    }
    return false
}

/** viem refused because the wallet is not on the transaction's chain (it checks again at the send). */
function chainMismatch(err: unknown): boolean {
    for (let e: unknown = err, depth = 0; e && depth < 6; e = (e as { cause?: unknown }).cause, depth++) {
        if ((e as { name?: unknown }).name === "ChainMismatchError") return true
    }
    return false
}

/** The first line of an error, without viem's appended details. */
function shortReason(err: unknown): string {
    const e = err as { shortMessage?: unknown; message?: unknown }
    const text = typeof e?.shortMessage === "string" ? e.shortMessage : typeof e?.message === "string" ? e.message : "unknown error"
    return text.split("\n")[0].replace(/[.\s]+$/, "")
}

export async function sendEvmWriteWith(config: Config, write: EvmWrite, opts: { receiptTimeoutMs?: number } = {}): Promise<TxResult> {
    const label = networkLabel(write.chainId)
    const chainId = write.chainId as Config["chains"][number]["id"]
    const chain = getPublicClient(config, { chainId })
    if (!label || !chain) {
        return { outcome: "failed", error: `Memba doesn't send transactions on chain ${write.chainId}. Nothing was sent.` }
    }
    const nothingSent = (reason: string): TxResult => ({ outcome: "failed", error: `${reason}. Nothing was sent.` })

    let walletChain: number
    try {
        const wallet = await getConnectorClient(config, { assertChainId: false })
        walletChain = Number(await wallet.request({ method: "eth_chainId" }))
    } catch (err) {
        return rejectedInWallet(err) ? { outcome: "cancelled", error: "You rejected the request in your wallet. Nothing was sent." } : nothingSent("Connect your wallet first")
    }
    if (walletChain !== write.chainId) {
        return nothingSent(`Your wallet is on chain ${walletChain}, but this transaction is for ${label} (${write.chainId}). Switch the wallet, then try again`)
    }

    const isCall = !!write.data && write.data !== "0x"
    if (isCall) {
        let code: string | undefined
        try {
            code = await chain.getCode({ address: write.to })
        } catch {
            return nothingSent(`Memba couldn't read the contract on ${label} to check it`)
        }
        if (!code || code === "0x") return nothingSent(`There is no contract at ${write.to} on ${label}`)
    }

    let hash: `0x${string}`
    try {
        hash = await sendTransaction(config, { chainId, to: write.to, data: isCall ? write.data : undefined, value: write.value })
    } catch (err) {
        if (rejectedInWallet(err)) return { outcome: "cancelled", error: "You rejected the transaction in your wallet. Nothing was sent." }
        if (chainMismatch(err)) return nothingSent(`Your wallet left ${label} before sending. Switch it back, then try again`)
        return nothingSent(`The wallet didn't send it: ${shortReason(err)}`)
    }

    try {
        // viem's own wait: it reports a revert as a status (wagmi's throws on it).
        const receipt = await chain.waitForTransactionReceipt({ hash, timeout: opts.receiptTimeoutMs ?? RECEIPT_TIMEOUT_MS })
        if (receipt.status === "success") return { outcome: "sent", hash, result: receipt }
        return { outcome: "refused", hash, error: "The transaction was included but reverted: it changed nothing, and the network fee was paid." }
    } catch {
        return { outcome: "unknown", hash, error: `Sent, but Memba couldn't see it confirmed on ${label} yet. Check the transaction before trying again.` }
    }
}
