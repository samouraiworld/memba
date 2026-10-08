/**
 * The one send path for every EVM write in Memba (Safe creation and execution,
 * token deployment, Basenames, wallet sends): nothing else may send one (an
 * eslint rule enforces it). Every write is bound to its chain:
 *
 *  1. the chain must be the network this page runs on, a visible one of Memba's
 *     (lib/chain/evm/networks.ts): a page writes only on its own network;
 *  2. the write itself must be well formed (addresses, calldata, value);
 *  3. a contract call (calldata) needs code at `to`, read from an RPC that
 *     proves it serves that chain (chainCheck.ts); a failed read refuses too,
 *     since an outage proves nothing;
 *  4. last before the send, the wallet's own provider is asked `eth_chainId`,
 *     never the cached connection state: a transaction sent on the other chain
 *     to an address with no code "succeeds" and loses its value. With `from`,
 *     its live `eth_accounts[0]` must be that account too: a wallet switched to
 *     another account after the review would otherwise pay, and act, as it;
 *  5. the chain and the account are passed to the send, so wagmi and viem check them again.
 *
 * Then the receipt is awaited, replacements included: a repriced transaction is
 * the same write, a cancelled or different one is not. Results map onto the OS
 * signer's outcomes (TxResult); "nothing was sent" is said only when it is known.
 *
 * @module lib/chain/evm/send
 */
import { getConnectorClient, getPublicClient, sendTransaction, type Config } from "@wagmi/core"
import { isAddress, isHex } from "viem"
import { waitForTransactionReceipt } from "viem/actions"
import type { TxResult } from "../types"
import { readCode } from "./chainCheck"
import { EVM_NETWORKS } from "./networks"

export interface EvmWrite {
    /** EIP-155 chain id the transaction is for. */
    chainId: number
    /** The account the write was prepared for (any letter case): the send refuses if the wallet is on another one. */
    from: `0x${string}`
    /** Required: a contract is created only through a factory or the CREATE2 deployer, never by a `to`-less transaction. */
    to: `0x${string}`
    /** Calldata; omitted or "0x" for a plain value transfer. */
    data?: `0x${string}`
    value?: bigint
}

export interface SendOptions {
    /** How long the receipt is awaited before the outcome is reported as unknown (default 120 s). */
    receiptTimeoutMs?: number
    /**
     * Called once, synchronously, with the transaction hash as soon as the wallet returns a
     * well-formed one, before the receipt is awaited: the caller can keep the hash while the
     * wait (and its replacement handling) stays here. Never called when nothing was sent; an
     * exception it throws is ignored and changes nothing.
     */
    onSent?: (hash: `0x${string}`) => void
}

/** How long the receipt is awaited before the outcome is reported as unknown. */
const RECEIPT_TIMEOUT_MS = 120_000

function networkLabel(chainId: number): string | null {
    return Object.values(EVM_NETWORKS).find((n) => n.chainId === chainId)?.label ?? null
}

/** The error, or one it wraps, matches. */
function anyCause(err: unknown, match: (e: { code?: unknown; name?: unknown }) => boolean): boolean {
    for (let e: unknown = err, depth = 0; e && depth < 8; e = (e as { cause?: unknown }).cause, depth++) {
        if (match(e as { code?: unknown; name?: unknown })) return true
    }
    return false
}

/** EIP-1193 4001: the person rejected it in the wallet. */
const rejectedInWallet = (err: unknown) => anyCause(err, (e) => e.code === 4001)
/** wagmi or viem refused because the wallet is not on the transaction's chain. */
const chainMismatch = (err: unknown) => anyCause(err, (e) => e.name === "ChainMismatchError" || e.name === "ConnectorChainMismatchError")
/** wagmi refused because the wallet no longer connects the account. */
const accountGone = (err: unknown) => anyCause(err, (e) => e.name === "ConnectorAccountNotFoundError")
/** Refused by wagmi or viem before anything was asked of the wallet. */
const PRE_REQUEST = new Set(["ConnectorNotConnectedError", "ConnectorUnavailableReconnectingError", "AccountNotFoundError", "InvalidAddressError", "ChainNotFoundError"])
const refusedBeforeRequest = (err: unknown) => anyCause(err, (e) => typeof e.name === "string" && PRE_REQUEST.has(e.name))

/** The first line of an error, without viem's appended details. */
function shortReason(err: unknown): string {
    const e = err as { shortMessage?: unknown; message?: unknown }
    const text = typeof e?.shortMessage === "string" ? e.shortMessage : typeof e?.message === "string" ? e.message : "unknown error"
    return text.split("\n")[0].replace(/[.\s]+$/, "")
}

/**
 * Sends `write` from the connected wallet on `config`. `activeChainId` is the EIP-155 id of the
 * network this page runs on (null on a gno.land page): a write for any other chain is refused.
 */
export async function sendEvmWriteWith(config: Config, activeChainId: number | null, write: EvmWrite, opts: SendOptions = {}): Promise<TxResult> {
    const nothingSent = (reason: string): TxResult => ({ outcome: "failed", error: `${reason}. Nothing was sent.` })
    const label = networkLabel(write.chainId)
    const chainId = write.chainId as Config["chains"][number]["id"]
    const chain = getPublicClient(config, { chainId })
    if (!label || !chain) return nothingSent(`Memba doesn't send transactions on chain ${write.chainId}`)
    if (write.chainId !== activeChainId) {
        const here = activeChainId === null ? "gno.land" : networkLabel(activeChainId) ?? `chain ${activeChainId}`
        return nothingSent(`This transaction is for ${label}, but this page runs on ${here}`)
    }

    if (!isAddress(write.to, { strict: false }) || !isAddress(write.from, { strict: false })) return nothingSent("The transaction names an invalid address")
    if (write.data !== undefined && !isHex(write.data, { strict: true })) return nothingSent("The transaction's data is not valid hex")
    if (write.value !== undefined && (typeof write.value !== "bigint" || write.value < 0n)) return nothingSent("The transaction's value is negative or not an amount")

    const isCall = !!write.data && write.data !== "0x"
    if (isCall) {
        const code = await readCode(write.chainId, chain, write.to)
        if (code.kind !== "ok") return nothingSent(`Memba couldn't read the contract on ${label} to check it (${code.reason})`)
        if (code.value === "0x") return nothingSent(`There is no contract at ${write.to} on ${label}`)
    }

    // Last before the send: what the wallet's own provider says now, not the cached connection.
    let wallet: Awaited<ReturnType<typeof getConnectorClient>>
    try {
        wallet = await getConnectorClient(config, { assertChainId: false })
    } catch (err) {
        if (rejectedInWallet(err)) return { outcome: "cancelled", error: "You rejected the request in your wallet. Nothing was sent." }
        return nothingSent("Connect your wallet first")
    }
    let walletChain = NaN
    try {
        const raw: unknown = await wallet.request({ method: "eth_chainId" })
        if (typeof raw === "string" && /^0x[0-9a-f]{1,13}$/i.test(raw)) walletChain = parseInt(raw, 16)
    } catch (err) {
        if (rejectedInWallet(err)) return { outcome: "cancelled", error: "You rejected the request in your wallet. Nothing was sent." }
    }
    if (!Number.isSafeInteger(walletChain)) return nothingSent("Your wallet didn't say which chain it is on")
    if (walletChain !== write.chainId) {
        return nothingSent(`Your wallet is on chain ${walletChain}, but this transaction is for ${label} (${write.chainId}). Switch the wallet, then try again`)
    }
    let walletAccount: unknown
    try {
        walletAccount = (await wallet.request({ method: "eth_accounts" }))[0]
    } catch (err) {
        if (rejectedInWallet(err)) return { outcome: "cancelled", error: "You rejected the request in your wallet. Nothing was sent." }
        return nothingSent("Your wallet didn't say which account it is using")
    }
    if (typeof walletAccount !== "string" || walletAccount.toLowerCase() !== write.from.toLowerCase()) {
        return nothingSent("Your wallet switched to another account")
    }

    let hash: `0x${string}`
    try {
        // The chain and the account go to the send too: wagmi and viem check them once more.
        hash = await sendTransaction(config, { chainId, account: write.from, to: write.to, data: isCall ? write.data : undefined, value: write.value })
    } catch (err) {
        if (rejectedInWallet(err)) return { outcome: "cancelled", error: "You rejected the transaction in your wallet. Nothing was sent." }
        if (chainMismatch(err)) return nothingSent(`Your wallet left ${label} before sending. Switch it back, then try again`)
        if (accountGone(err)) return nothingSent("Your wallet switched to another account")
        if (refusedBeforeRequest(err)) return nothingSent(`The wallet couldn't be asked: ${shortReason(err)}`)
        // Past this point the wallet had the request: an error does not prove it sent nothing.
        return { outcome: "unknown", error: `Your wallet reported an error (${shortReason(err)}). Check your wallet's activity before retrying: the transaction may have been sent.` }
    }
    if (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(hash)) {
        return { outcome: "unknown", error: "Your wallet answered without a valid transaction hash. Check your wallet's activity before retrying: the transaction may have been sent." }
    }
    try { opts.onSent?.(hash) } catch { /* the caller's bookkeeping cannot change what happened on chain */ }

    const replaced: { reason?: "replaced" | "repriced" | "cancelled" } = {}
    try {
        // viem's own wait: it reports a revert as a status (wagmi's throws on it), and follows a replacement.
        const receipt = await waitForTransactionReceipt(chain, {
            hash, timeout: opts.receiptTimeoutMs ?? RECEIPT_TIMEOUT_MS, onReplaced: (r) => { replaced.reason = r.reason },
        })
        const mined = receipt.transactionHash
        const sameWrite = mined.toLowerCase() === hash.toLowerCase() || replaced.reason === "repriced"
        if (!sameWrite) {
            return replaced.reason === "cancelled"
                ? { outcome: "refused", hash: mined, error: "Your wallet cancelled this transaction with a replacement: the write did not happen." }
                : { outcome: "unknown", hash: mined, error: "Your wallet replaced this transaction with a different one. Check your wallet's activity before retrying." }
        }
        if (receipt.status === "success") return { outcome: "sent", hash: mined, result: receipt }
        return { outcome: "refused", hash: mined, error: "The transaction was included but reverted: it changed nothing, and the network fee was paid." }
    } catch {
        return { outcome: "unknown", hash, error: `Sent, but Memba couldn't see it confirmed on ${label} yet. Check the transaction before trying again.` }
    }
}
