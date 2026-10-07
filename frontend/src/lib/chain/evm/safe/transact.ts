/**
 * Proposing, signing and executing Safe transactions from the connected
 * wallet. Owners sign off chain (EIP-712 typed data, `eth_signTypedData_v4`);
 * the Safe Transaction Service, reached only through Memba's proxy, keeps the
 * signatures; whoever executes pays the gas.
 *
 * Nothing is signed or executed on the word of protocol-kit or the
 * Transaction Service:
 * - the Safe's owners, threshold and nonce are read from the chain right
 *   before acting (./inspect.ts), never taken from a cache;
 * - every transaction must pay no gas refund (gasRefund) and run nothing Memba
 *   can't read or that runs another contract's code (refusedToRun); one Memba
 *   builds must be exactly the asked calls (assertBuilt);
 * - the safeTxHash is computed here and the owner signs exactly that typed
 *   data; the signature is recovered here before it is handed on;
 * - execution uses only the signatures recovered here to owners (plus the
 *   executor's own approval when it is an owner), encoded here, and checks the
 *   Safe's ExecutionSuccess event for this hash in the receipt.
 *
 * In this version owners sign with a key-holder wallet: a smart-account owner
 * (EIP-1271) is told so before anything is signed. Part of the lazy Safe SDK
 * chunk (re-exported by ./sdk.ts).
 *
 * @module lib/chain/evm/safe/transact
 */
import type SafeApiKit from "@safe-global/api-kit"
import Safe, { type Eip1193Provider } from "@safe-global/protocol-kit"
import { getConnectorClient, getPublicClient, signTypedData } from "@wagmi/core"
import { concat, encodeFunctionData, getAddress, keccak256, pad, parseAbi, toBytes, type Hex } from "viem"
import { chainFor, evmConfig, sendEvmWrite } from "../adapter"
import { SafeActionError, sentHash, walletError } from "./create"
import { decodeSafeTx, gasRefund, multiSendCalls, refusedToRun, type SafeTxFields } from "./decode"
import { inspectSafe, type SafeInspection } from "./inspect"
import { multiSendAt } from "./known"
import { safeReader } from "./reader"
import { safeApiKit } from "./txService"
import { checkQueuedTx, confirmationSigner, safeTxHash, safeTxTypedData, type QueuedSafeTx } from "./verify"

export interface SafeCall {
    to: Hex
    value: bigint
    data: Hex
}

/** The fields of a Safe transaction as protocol-kit and the Transaction Service carry them. */
export interface SafeTxData {
    to: string
    value: string
    data?: string | null
    operation: number
    safeTxGas: string | number
    baseGas: string | number
    gasPrice: string | number
    gasToken: string
    refundReceiver?: string | null
    nonce: string | number
}

type ChainId = (typeof evmConfig.chains)[number]["id"]
type SafeFacts = Extract<SafeInspection, { kind: "safe" }>

const ZERO = "0x0000000000000000000000000000000000000000"
/** How long an execution's receipt is awaited before "unconfirmed" (with its hash). */
const RECEIPT_TIMEOUT_MS = 120_000
/** sendEvmWrite waits for the receipt itself: this short wait makes it return the hash first. */
const HASH_FIRST_MS = 1
/** How far ahead of the Safe's on-chain nonce a queued proposal may sit. */
const MAX_NONCE_AHEAD = 50n
const EXEC_ABI = parseAbi(["function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)"])
const EXECUTION_SUCCESS = keccak256(toBytes("ExecutionSuccess(bytes32,uint256)"))
/** EIP-7702: an EOA delegating to code still signs with its own key. */
const DELEGATED_EOA = "0xef0100"

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const unexpected = (detail: string): never => { throw new SafeActionError({ code: "unexpected-transaction", detail }) }

function sameCall(f: SafeTxFields, c: SafeCall): boolean {
    return f.operation === 0 && same(f.to, c.to) && BigInt(f.value) === c.value && (f.data || "0x").toLowerCase() === c.data.toLowerCase()
}

/** Throws unless a queued transaction may be signed or executed: no gas refund, nothing unreadable, no delegatecall but a call-only batch. */
export function assertRunnable(safe: string, tx: SafeTxData): void {
    const refund = gasRefund(tx)
    if (refund) unexpected(refund)
    const refused = refusedToRun(decodeSafeTx(safe, { to: tx.to, value: tx.value, data: tx.data ?? null, operation: tx.operation }))
    if (refused) unexpected(refused)
}

/** Throws unless `tx` runs exactly `calls`, in order, with no gas refund to anyone. */
export function assertBuilt(tx: SafeTxData, calls: readonly SafeCall[]): void {
    if (calls.length === 0) unexpected("no call")
    const refund = gasRefund(tx)
    if (refund) unexpected(refund)
    if (calls.length === 1) {
        if (!sameCall({ to: tx.to, value: tx.value, data: tx.data ?? null, operation: tx.operation }, calls[0])) unexpected("not the call asked for")
        return
    }
    if (tx.operation !== 1 || multiSendAt(tx.to)?.kind !== "multiSendCallOnly" || BigInt(tx.value) !== 0n) unexpected("not a call-only batch")
    let inner: SafeTxFields[] = []
    try { inner = multiSendCalls(tx.data ?? "0x") } catch { unexpected("an unreadable batch") }
    if (inner.length !== calls.length || inner.some((f, i) => !sameCall(f, calls[i]))) unexpected("not the calls asked for")
}

/** The connected wallet on this network's chain, asked directly (never the cached connection). */
async function wallet(networkKey: string) {
    const chainId = chainFor(networkKey).id as ChainId
    let client
    try { client = await getConnectorClient(evmConfig, { chainId }) } catch (err) { walletError(err) }
    let walletChain: number
    try { walletChain = Number(await client.request({ method: "eth_chainId" })) } catch (err) { walletError(err) }
    if (walletChain !== chainId) throw new SafeActionError({ code: "wrong-chain" })
    return { client, chainId, signer: client.account.address.toLowerCase() as Hex }
}

/** What the chain says the Safe is now. An outage stops the action; it never falls back to a cache. */
async function freshSafe(networkKey: string, chainId: number, safe: Hex): Promise<SafeFacts> {
    const inspection = await inspectSafe(safeReader(networkKey), keccak256, chainId, safe)
    if (inspection.kind === "unavailable") throw new SafeActionError({ code: "failed", detail: `the Safe couldn't be read on chain (${inspection.reason})` })
    if (inspection.value.kind !== "safe") throw new SafeActionError({ code: "failed", detail: "this address is not a Safe Memba recognises" })
    return inspection.value
}

/** Owners sign with their own key in this version: a contract account (EIP-1271) can't sign here. */
async function assertKeyHolder(chainId: number, signer: Hex): Promise<void> {
    let code: string | undefined
    try { code = await getPublicClient(evmConfig, { chainId: chainId as ChainId }).getCode({ address: signer }) } catch {
        throw new SafeActionError({ code: "failed", detail: "your wallet's account couldn't be read on chain" })
    }
    if (code && code !== "0x" && !code.toLowerCase().startsWith(DELEGATED_EOA)) throw new SafeActionError({ code: "contract-signer" })
}

/** The Transaction Service refused: its reason, for the member. */
function service(err: unknown): never {
    if (err instanceof SafeActionError) throw err
    throw new SafeActionError({ code: "service", detail: err instanceof Error ? err.message.split("\n")[0].slice(0, 200) : "no answer" })
}

/** Signs the Safe transaction's typed data as `signer`, and checks the signature recovers to `signer`. */
async function sign(chainId: number, safe: Hex, tx: SafeTxData, signer: Hex): Promise<{ hash: Hex; signature: Hex }> {
    const typed = safeTxTypedData(chainId, { ...tx, data: tx.data ?? "0x", refundReceiver: tx.refundReceiver ?? ZERO, safe })
    const hash = safeTxHash(chainId, { ...tx, data: tx.data ?? "0x", refundReceiver: tx.refundReceiver ?? ZERO, safe })
    let signature: Hex
    try {
        signature = await signTypedData(evmConfig, { account: getAddress(signer), ...typed })
    } catch (err) {
        walletError(err)
    }
    // Some wallets return v as 0/1 for typed data: Safe reads 27/28 (protocol-kit normalises the same way).
    const v = parseInt(signature.slice(130, 132), 16)
    if (signature.length === 132 && (v === 0 || v === 1)) signature = `${signature.slice(0, 130)}${(v + 27).toString(16)}` as Hex
    if ((await confirmationSigner(hash, signature)) !== signer) throw new SafeActionError({ code: "failed", detail: "the wallet's signature is not this account's" })
    return { hash, signature }
}

/**
 * Builds, checks, signs and proposes `calls` from `safe`. The nonce is the
 * higher of the Transaction Service's next one and the Safe's on-chain nonce.
 * Returns the safeTxHash.
 */
export async function proposeSafeTx(networkKey: string, apiBase: string, safe: Hex, calls: readonly SafeCall[]): Promise<Hex> {
    const { client, chainId, signer } = await wallet(networkKey)
    const facts = await freshSafe(networkKey, chainId, safe)
    if (!facts.owners.includes(signer)) throw new SafeActionError({ code: "not-owner" })
    await assertKeyHolder(chainId, signer)
    const service_ = safeApiKit(apiBase, chainId)
    let serviceNonce: bigint
    try { serviceNonce = BigInt(await service_.getNextNonce(safe)) } catch (err) { service(err) }
    // The service's next nonce is used only when it is plausible: past the chain's, by at most MAX_NONCE_AHEAD.
    if (serviceNonce > facts.nonce + MAX_NONCE_AHEAD) {
        throw new SafeActionError({ code: "service", detail: `its next nonce (${serviceNonce}) is far ahead of the Safe's on-chain nonce (${facts.nonce})` })
    }
    const nonce = serviceNonce > facts.nonce ? serviceNonce : facts.nonce
    const kit = await Safe.init({ provider: client as unknown as Eip1193Provider, signer, safeAddress: safe })
    const safeTx = await kit.createTransaction({
        transactions: calls.map((c) => ({ to: c.to, value: c.value.toString(), data: c.data, operation: 0 })),
        onlyCalls: true,
        options: { nonce: Number(nonce) },
    })
    assertBuilt(safeTx.data, calls)
    const { hash, signature } = await sign(chainId, safe, safeTx.data, signer)
    try {
        await service_.proposeTransaction({ safeAddress: getAddress(safe), safeTransactionData: safeTx.data, safeTxHash: hash, senderAddress: getAddress(signer), senderSignature: signature, origin: "Memba" })
    } catch (err) { service(err) }
    return hash
}

/** The queued transaction, checked: this Safe's, its hash its own, runnable, and its signers recovered here against `owners`. */
async function queued(service_: SafeApiKit, chainId: number, safe: Hex, owners: readonly string[], hash: Hex) {
    let tx
    try { tx = await service_.getTransaction(hash) } catch (err) { service(err) }
    if (!same(tx.safe, safe) || !same(tx.safeTxHash, hash)) throw new SafeActionError({ code: "hash-mismatch" })
    const check = await checkQueuedTx(chainId, owners, tx as unknown as QueuedSafeTx)
    if (!check.hashMatches) throw new SafeActionError({ code: "hash-mismatch" })
    assertRunnable(safe, tx)
    return { tx, check }
}

/** Signs the queued transaction `hash` as the connected owner. */
export async function confirmSafeTx(networkKey: string, apiBase: string, safe: Hex, hash: Hex): Promise<void> {
    const { chainId, signer } = await wallet(networkKey)
    const facts = await freshSafe(networkKey, chainId, safe)
    if (!facts.owners.includes(signer)) throw new SafeActionError({ code: "not-owner" })
    await assertKeyHolder(chainId, signer)
    const service_ = safeApiKit(apiBase, chainId)
    const { tx, check } = await queued(service_, chainId, safe, facts.owners, hash)
    // Only a signature recovered to you counts as yours: a listed one that doesn't recover doesn't stop you signing.
    if (check.verified.has(signer)) throw new SafeActionError({ code: "not-ready", detail: "you already signed it" })
    // queued() proved the listing's hash is this Safe's hash of these fields: sign() signs exactly that.
    const signed = await sign(chainId, safe, tx, signer)
    try { await service_.confirmTransaction(hash, signed.signature) } catch (err) { service(err) }
}

/** The signatures execTransaction reads, sorted by owner: recovered ones, and the executor's own approval (v = 1) when it is an owner without one. */
export function encodeSignatures(signatures: ReadonlyMap<string, Hex>, executor: string | null): Hex {
    const all = new Map(signatures)
    if (executor && !all.has(executor)) all.set(executor, concat([pad(executor as Hex), pad("0x00"), "0x01"]))
    return concat([...all.entries()].sort(([a], [b]) => (BigInt(a) < BigInt(b) ? -1 : 1)).map(([, s]) => s))
}

/**
 * Executes the queued transaction `hash` from the connected wallet (it pays
 * the gas), once it is the Safe's on-chain nonce and enough owners' signatures
 * recover here; an executor who owns the Safe and hasn't signed approves it
 * by sending. `onSent` gets the hash as soon as the wallet returns it; after
 * that, an unconfirmed outcome keeps the hash (code "unconfirmed").
 */
export async function executeSafeTx(networkKey: string, apiBase: string, safe: Hex, hash: Hex, onSent?: (tx: Hex) => void): Promise<Hex> {
    const { chainId, signer } = await wallet(networkKey)
    const facts = await freshSafe(networkKey, chainId, safe)
    const service_ = safeApiKit(apiBase, chainId)
    const { tx, check } = await queued(service_, chainId, safe, facts.owners, hash)
    if (BigInt(tx.nonce) !== facts.nonce) throw new SafeActionError({ code: "not-ready", detail: `the Safe's next nonce is ${facts.nonce}, this transaction's is ${tx.nonce}` })
    const executorApproves = facts.owners.includes(signer) && !check.verified.has(signer)
    if (check.verified.size + (executorApproves ? 1 : 0) < facts.threshold) {
        throw new SafeActionError({ code: "not-ready", detail: `${check.verified.size} of ${facts.threshold} signatures` })
    }
    const data = encodeFunctionData({
        abi: EXEC_ABI, functionName: "execTransaction",
        args: [tx.to as Hex, BigInt(tx.value), (tx.data || "0x") as Hex, tx.operation, BigInt(tx.safeTxGas), BigInt(tx.baseGas), BigInt(tx.gasPrice), tx.gasToken as Hex, (tx.refundReceiver || ZERO) as Hex,
            encodeSignatures(check.signatures, executorApproves ? signer : null)],
    })
    // The one send path (chain, account and the Safe's code re-checked), returning the hash right away
    // so it is kept (onSent) before the wait, done here with viem: a revert is a status, a replacement followed.
    const result = sentHash(await sendEvmWrite({ chainId, from: signer, to: safe, data }, { receiptTimeoutMs: HASH_FIRST_MS }))
    if (!result.hash) {
        if (result.declined) throw new SafeActionError({ code: "declined" })
        throw new SafeActionError({ code: "failed", detail: result.maybeSent ? `${result.error} (it may have been sent: check your wallet before trying again)` : result.error })
    }
    const sent = result.hash
    onSent?.(sent)
    let receipt
    try { receipt = await getPublicClient(evmConfig, { chainId: chainId as ChainId }).waitForTransactionReceipt({ hash: sent, timeout: RECEIPT_TIMEOUT_MS }) } catch {
        throw new SafeActionError({ code: "unconfirmed", hash: sent })
    }
    if (receipt.status !== "success") throw new SafeActionError({ code: "reverted", hash: sent })
    // ExecutionSuccess(txHash, payment): txHash is indexed from Safe 1.4.1, in the data on 1.3.0.
    const executed = receipt.logs.some((log) => same(log.address, safe) && log.topics[0] === EXECUTION_SUCCESS
        && (same(log.topics[1] ?? "", hash) || same(log.data.slice(0, 66), hash)))
    if (!executed) throw new SafeActionError({ code: "reverted", hash: sent })
    return sent
}
