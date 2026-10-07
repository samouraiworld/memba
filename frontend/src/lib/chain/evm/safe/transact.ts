/**
 * Proposing, signing and executing Safe transactions from the connected
 * wallet. Owners sign off chain (EIP-712, `eth_signTypedData_v4`) and the
 * signatures are kept by the Safe Transaction Service, reached through
 * Memba's proxy; whoever executes pays the gas.
 *
 * Nothing is signed on the word of protocol-kit or the Transaction Service
 * alone:
 * - a proposal is read back before signing: one call exactly as asked, or a
 *   MultiSendCallOnly batch of exactly the asked calls, with no gas refund;
 * - every safeTxHash is recomputed here (./verify.ts) and must match;
 * - execution needs the on-chain nonce and enough signatures recovered to
 *   owners here (the executor's own counts when it is an owner).
 *
 * Part of the lazy Safe SDK chunk (re-exported by ./sdk.ts).
 *
 * @module lib/chain/evm/safe/transact
 */
import type SafeApiKit from "@safe-global/api-kit"
import Safe, { type Eip1193Provider } from "@safe-global/protocol-kit"
import { getConnectorClient, waitForTransactionReceipt } from "@wagmi/core"
import { getAddress, type Hex } from "viem"
import { chainFor, evmConfig } from "../adapter"
import { SafeActionError, walletError } from "./create"
import { multiSendCalls, type SafeTxFields } from "./decode"
import { multiSendAt } from "./known"
import { safeApiKit } from "./txService"
import { checkQueuedTx, safeTxHash, type QueuedSafeTx } from "./verify"

export interface SafeCall {
    to: Hex
    value: bigint
    data: Hex
}

/** The fields of a Safe transaction as protocol-kit and the Transaction Service carry them. */
interface SafeTxData {
    to: string
    value: string
    data: string
    operation: number
    safeTxGas: string | number
    baseGas: string | number
    gasPrice: string | number
    gasToken: string
    refundReceiver: string
    nonce: string | number
}

const SIGNING = "eth_signTypedData_v4"
const ZERO = "0x0000000000000000000000000000000000000000"
type ChainId = (typeof evmConfig.chains)[number]["id"]

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const unexpected = (detail: string): never => { throw new SafeActionError({ code: "unexpected-transaction", detail }) }

function sameCall(f: SafeTxFields, c: SafeCall): boolean {
    return f.operation === 0 && same(f.to, c.to) && BigInt(f.value) === c.value && (f.data || "0x").toLowerCase() === c.data.toLowerCase()
}

/** Throws unless `tx` runs exactly `calls`, in order, with no gas refund to anyone. */
export function assertBuilt(tx: SafeTxData, calls: readonly SafeCall[]): void {
    if (calls.length === 0) unexpected("no call")
    if (BigInt(tx.safeTxGas) !== 0n || BigInt(tx.baseGas) !== 0n || BigInt(tx.gasPrice) !== 0n || !same(tx.gasToken, ZERO) || !same(tx.refundReceiver || ZERO, ZERO)) unexpected("a gas refund is included")
    if (calls.length === 1) {
        if (!sameCall({ to: tx.to, value: tx.value, data: tx.data, operation: tx.operation }, calls[0])) unexpected("not the call asked for")
        return
    }
    if (tx.operation !== 1 || multiSendAt(tx.to)?.kind !== "multiSendCallOnly" || BigInt(tx.value) !== 0n) unexpected("not a call-only batch")
    let inner: SafeTxFields[] = []
    try { inner = multiSendCalls(tx.data) } catch { unexpected("an unreadable batch") }
    if (inner.length !== calls.length || inner.some((f, i) => !sameCall(f, calls[i]))) unexpected("not the calls asked for")
}

async function wallet(networkKey: string) {
    const chainId = chainFor(networkKey).id as ChainId
    let client
    try { client = await getConnectorClient(evmConfig, { chainId }) } catch (err) { walletError(err) }
    return { client, chainId, signer: client.account.address.toLowerCase() as Hex }
}

/** The Transaction Service refused: its reason, for the member. */
function service(err: unknown): never {
    if (err instanceof SafeActionError) throw err
    throw new SafeActionError({ code: "service", detail: err instanceof Error ? err.message.split("\n")[0].slice(0, 200) : "no answer" })
}

function localHash(chainId: number, safe: string, tx: SafeTxData): Hex {
    return safeTxHash(chainId, { ...tx, safe, safeTxHash: "" })
}

async function signedBy(kit: Safe, safeTx: Awaited<ReturnType<Safe["createTransaction"]>>, signer: Hex): Promise<string> {
    let signed
    try { signed = await kit.signTransaction(safeTx, SIGNING) } catch (err) { walletError(err) }
    const sig = signed.getSignature(signer)?.data
    if (!sig) throw new SafeActionError({ code: "failed", detail: "the wallet returned no signature" })
    return sig
}

/** Builds, checks, signs and proposes `calls` from `safe` at the next free nonce. Returns its safeTxHash. */
export async function proposeSafeTx(networkKey: string, apiBase: string, safe: Hex, owners: readonly string[], calls: readonly SafeCall[]): Promise<Hex> {
    const { client, chainId, signer } = await wallet(networkKey)
    if (!owners.some((o) => same(o, signer))) throw new SafeActionError({ code: "not-owner" })
    const service_ = safeApiKit(apiBase, chainId)
    let nonce: number
    try { nonce = Number(await service_.getNextNonce(safe)) } catch (err) { service(err) }
    const kit = await Safe.init({ provider: client as unknown as Eip1193Provider, signer, safeAddress: safe })
    const safeTx = await kit.createTransaction({
        transactions: calls.map((c) => ({ to: c.to, value: c.value.toString(), data: c.data, operation: 0 })),
        onlyCalls: true,
        options: { nonce },
    })
    assertBuilt(safeTx.data, calls)
    const hash = (await kit.getTransactionHash(safeTx)).toLowerCase() as Hex
    if (hash !== localHash(chainId, safe, safeTx.data)) throw new SafeActionError({ code: "hash-mismatch" })
    const signature = await signedBy(kit, safeTx, signer)
    try {
        await service_.proposeTransaction({ safeAddress: getAddress(safe), safeTransactionData: safeTx.data, safeTxHash: hash, senderAddress: getAddress(signer), senderSignature: signature, origin: "Memba" })
    } catch (err) { service(err) }
    return hash
}

/** The queued transaction, checked: it is this Safe's, its hash matches, and its signers are recovered here. */
async function queued(service_: SafeApiKit, chainId: number, safe: Hex, owners: readonly string[], hash: Hex) {
    let tx
    try { tx = await service_.getTransaction(hash) } catch (err) { service(err) }
    if (!same(tx.safe, safe) || !same(tx.safeTxHash, hash)) throw new SafeActionError({ code: "hash-mismatch" })
    const check = await checkQueuedTx(chainId, owners, tx as unknown as QueuedSafeTx)
    if (!check.hashMatches) throw new SafeActionError({ code: "hash-mismatch" })
    return { tx, check }
}

/** Signs the queued transaction `hash` as the connected owner. */
export async function confirmSafeTx(networkKey: string, apiBase: string, safe: Hex, owners: readonly string[], hash: Hex): Promise<void> {
    const { client, chainId, signer } = await wallet(networkKey)
    if (!owners.some((o) => same(o, signer))) throw new SafeActionError({ code: "not-owner" })
    const service_ = safeApiKit(apiBase, chainId)
    const { tx, check } = await queued(service_, chainId, safe, owners, hash)
    if (check.submitted.has(signer)) throw new SafeActionError({ code: "not-ready", detail: "you already signed it" })
    const kit = await Safe.init({ provider: client as unknown as Eip1193Provider, signer, safeAddress: safe })
    const safeTx = await kit.toSafeTransactionType(tx)
    if ((await kit.getTransactionHash(safeTx)).toLowerCase() !== hash) throw new SafeActionError({ code: "hash-mismatch" })
    const signature = await signedBy(kit, safeTx, signer)
    try { await service_.confirmTransaction(hash, signature) } catch (err) { service(err) }
}

/**
 * Executes the queued transaction `hash` from the connected wallet (it pays
 * the gas), once it is the Safe's next nonce and enough owners signed. An
 * executor who is an owner and has not signed counts as one signature.
 */
export async function executeSafeTx(networkKey: string, apiBase: string, safe: Hex, facts: { owners: readonly string[]; threshold: number; nonce: bigint }, hash: Hex, onSent?: (tx: Hex) => void): Promise<Hex> {
    const { client, chainId, signer } = await wallet(networkKey)
    const service_ = safeApiKit(apiBase, chainId)
    const { tx, check } = await queued(service_, chainId, safe, facts.owners, hash)
    if (BigInt(tx.nonce) !== facts.nonce) throw new SafeActionError({ code: "not-ready", detail: `the Safe's next nonce is ${facts.nonce}, this transaction's is ${tx.nonce}` })
    const executorCounts = facts.owners.some((o) => same(o, signer)) && !check.submitted.has(signer) ? 1 : 0
    if (check.verified.size + executorCounts < facts.threshold) throw new SafeActionError({ code: "not-ready", detail: `${check.verified.size} of ${facts.threshold} signatures` })
    const kit = await Safe.init({ provider: client as unknown as Eip1193Provider, signer, safeAddress: safe })
    let sent: Hex
    try { sent = (await kit.executeTransaction(tx)).hash as Hex } catch (err) { walletError(err) }
    onSent?.(sent)
    const receipt = await waitForTransactionReceipt(evmConfig, { chainId: chainId as ChainId, hash: sent })
    if (receipt.status !== "success") throw new SafeActionError({ code: "reverted", hash: sent })
    return sent
}
