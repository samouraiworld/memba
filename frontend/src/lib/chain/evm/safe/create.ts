/**
 * Creating a Safe from the connected wallet: SafeL2 v1.5.0 through the
 * canonical SafeProxyFactory 1.5.0, owners and threshold only (no module, no
 * setup call, no payment), the version's fallback handler.
 *
 * protocol-kit builds the deployment, and Memba reads it back before the
 * wallet sees it: the factory, the singleton and every field of the Safe's
 * `setup` call must be exactly what the owner asked for. After the
 * transaction, the new address is inspected on chain (./inspect.ts) and must
 * hold that Safe. Part of the lazy Safe SDK chunk (imported by ./sdk.ts only).
 *
 * @module lib/chain/evm/safe/create
 */
import { getConnectorClient, getPublicClient } from "@wagmi/core"
import { decodeFunctionData, keccak256, parseAbi, type Hex } from "viem"
import Safe, { type Eip1193Provider, type PredictedSafeProps } from "@safe-global/protocol-kit"
import type { TxResult } from "../../types"
import { chainFor, evmConfig, sendEvmWrite } from "../adapter"
import { CREATE_SINGLETON, SAFE_FALLBACK_HANDLERS, SAFE_PROXY_FACTORY_1_5_0 } from "./known"
import { inspectSafe, type SafeInspection } from "./inspect"
import { safeReader } from "./reader"

type ChainId = (typeof evmConfig.chains)[number]["id"]

/** The version Memba creates Safes with (docs/evm/PHASE0.md). */
export const NEW_SAFE_VERSION = "1.5.0" as const

/** A Safe that does not exist yet: SafeL2 v1.5.0, canonical deployment, the version's fallback handler. */
export function newSafeConfig(owners: readonly string[], threshold: number, saltNonce: bigint): PredictedSafeProps {
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > owners.length) throw new Error("The threshold must be between 1 and the number of owners.")
    if (saltNonce < 0n) throw new Error("The salt nonce must not be negative.")
    return {
        safeAccountConfig: { owners: [...owners], threshold },
        safeDeploymentConfig: { safeVersion: NEW_SAFE_VERSION, deploymentType: "canonical", saltNonce: saltNonce.toString() },
    }
}

/** protocol-kit for a Safe to create; the L2 singleton is forced, whatever the chain. */
export function initNewSafe(provider: Eip1193Provider, signer: string, config: PredictedSafeProps): Promise<Safe> {
    return Safe.init({ provider, signer, predictedSafe: config, isL1SafeSingleton: false })
}


export interface NewSafePlan {
    /** The chain the plan was built and checked for: the factory and the predicted address are the same on every chain. */
    chainId: number
    /** The account that sends the deployment (lowercase): the plan is sent from it only. */
    deployer: Hex
    predicted: Hex
    owners: Hex[]
    threshold: number
    saltNonce: bigint
    tx: { to: Hex; data: Hex; value: bigint }
}

export type SafeActionReason =
    | { code: "not-connected" }
    | { code: "wrong-chain" }
    | { code: "declined" }
    | { code: "address-taken" }
    | { code: "unexpected-deployment"; detail: string }
    // Included and reverted, or cancelled by a replacement; `detail` is the send path's own account of it.
    | { code: "reverted"; hash: Hex; detail?: string }
    | { code: "not-the-safe"; hash: Hex }
    // Sent, but the network didn't confirm it yet (or it was replaced): the hash is kept to check again.
    | { code: "unconfirmed"; hash: Hex; detail?: string }
    // Confirmed, but the chain couldn't be read to check the result: check again.
    | { code: "unverified"; hash: Hex }
    // Proposing, signing and executing (./transact.ts)
    | { code: "unexpected-transaction"; detail: string }
    | { code: "hash-mismatch" }
    | { code: "not-owner" }
    | { code: "not-ready"; detail: string }
    | { code: "contract-signer" }
    | { code: "service"; detail: string }
    | { code: "failed"; detail: string }

/** Why creating a Safe or acting on one stopped. */
export class SafeActionError extends Error {
    constructor(readonly reason: SafeActionReason) {
        super(reason.code)
    }
}

const ZERO: Hex = "0x0000000000000000000000000000000000000000"
const FACTORY_ABI = parseAbi(["function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)"])
const SETUP_ABI = parseAbi(["function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)"])
const HANDLER_1_5_0 = SAFE_FALLBACK_HANDLERS.find((h) => h.version === "1.5.0")!.address

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** How long "Check again" awaits a creation's receipt (sendEvmWrite waits as long on the send itself). */
const RECEIPT_TIMEOUT_MS = 120_000

/** Throws unless the deployment creates exactly the requested SafeL2 v1.5.0. */
export function assertDeployment(tx: { to: string; data: string; value: string | bigint }, owners: readonly string[], threshold: number, saltNonce: bigint): void {
    const fail = (detail: string) => { throw new SafeActionError({ code: "unexpected-deployment", detail }) }
    if (!same(tx.to, SAFE_PROXY_FACTORY_1_5_0)) fail("not the Safe proxy factory 1.5.0")
    if (BigInt(tx.value) !== 0n) fail("the deployment sends value")
    let call
    try { call = decodeFunctionData({ abi: FACTORY_ABI, data: tx.data as Hex }) } catch { return fail("not a createProxyWithNonce call") }
    const [singleton, initializer, salt] = call.args
    if (!same(singleton, CREATE_SINGLETON.address)) fail("not the SafeL2 1.5.0 singleton")
    if (salt !== saltNonce) fail("another salt")
    let setup
    try { setup = decodeFunctionData({ abi: SETUP_ABI, data: initializer }) } catch { return fail("not a Safe setup call") }
    const [setupOwners, setupThreshold, to, data, handler, paymentToken, payment, paymentReceiver] = setup.args
    if (setupOwners.length !== owners.length || setupOwners.some((o, i) => !same(o, owners[i]))) fail("other owners")
    if (setupThreshold !== BigInt(threshold)) fail("another threshold")
    if (!same(to, ZERO) || data !== "0x") fail("a setup call (modules) is included")
    if (!same(handler, HANDLER_1_5_0)) fail("another fallback handler")
    if (!same(paymentToken, ZERO) || payment !== 0n || !same(paymentReceiver, ZERO)) fail("a payment is included")
}

function chainIdOf(networkKey: string): ChainId {
    return chainFor(networkKey).id as ChainId
}

/** A wallet failure as a SafeActionError: not connected, wrong chain, declined, or failed. */
export function walletError(err: unknown): never {
    if (err instanceof SafeActionError) throw err
    // Wallet and library errors wrap each other: read the whole cause chain (as viem's BaseError.walk does).
    const names = new Set<string>()
    const codes = new Set<number>()
    let e: unknown = err
    for (let depth = 0; e && typeof e === "object" && depth < 10; depth++) {
        const { name, code, cause } = e as { name?: unknown; code?: unknown; cause?: unknown }
        if (typeof name === "string") names.add(name)
        if (typeof code === "number") codes.add(code)
        e = cause
    }
    if (names.has("ConnectorNotConnectedError") || names.has("ConnectorAccountNotFoundError")) throw new SafeActionError({ code: "not-connected" })
    if (names.has("ConnectorChainMismatchError") || names.has("ChainMismatchError")) throw new SafeActionError({ code: "wrong-chain" })
    if (codes.has(4001) || names.has("UserRejectedRequestError")) throw new SafeActionError({ code: "declined" })
    throw new SafeActionError({ code: "failed", detail: err instanceof Error ? err.message.split("\n")[0] : "unknown error" })
}

/** A fresh 256-bit salt: a new address for every creation. */
export function randomSalt(): bigint {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    return BigInt(`0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`)
}

/** Builds and checks the deployment, and the address the Safe will have. Nothing is sent. */
export async function planNewSafe(networkKey: string, owners: readonly Hex[], threshold: number, saltNonce: bigint = randomSalt()): Promise<NewSafePlan> {
    const chainId = chainIdOf(networkKey)
    let client
    try { client = await getConnectorClient(evmConfig, { chainId }) } catch (err) { walletError(err) }
    const kit = await initNewSafe(client as unknown as Eip1193Provider, client.account.address, newSafeConfig(owners, threshold, saltNonce))
    const predicted = (await kit.getAddress()).toLowerCase() as Hex
    const code = await getPublicClient(evmConfig, { chainId }).getCode({ address: predicted })
    if (code && code !== "0x") throw new SafeActionError({ code: "address-taken" })
    const deployment = await kit.createSafeDeploymentTransaction()
    assertDeployment(deployment, owners, threshold, saltNonce)
    return { chainId, deployer: client.account.address.toLowerCase() as Hex, predicted, owners: [...owners], threshold, saltNonce, tx: { to: deployment.to as Hex, data: deployment.data as Hex, value: BigInt(deployment.value) } }
}

/**
 * Whether the predicted address holds exactly the planned Safe, read on chain:
 * SafeL2 1.5.0, the planned owners and threshold, no module. Its address
 * commits to the owners, threshold and salt, so a Safe there that matches is
 * the planned one, whichever transaction created it. null: the chain couldn't
 * be read.
 */
async function plannedSafeAt(networkKey: string, plan: NewSafePlan): Promise<Extract<SafeInspection, { kind: "safe" }> | false | null> {
    const inspection = await inspectSafe(safeReader(networkKey), keccak256, plan.chainId, plan.predicted)
    if (inspection.kind === "unavailable") return null
    const safe = inspection.value.kind === "safe" ? inspection.value : null
    const owners = new Set(plan.owners.map((o) => o.toLowerCase()))
    if (!safe || safe.version !== "1.5.0" || !safe.l2 || safe.threshold !== plan.threshold
        || safe.owners.length !== owners.size || safe.owners.some((o) => !owners.has(o)) || safe.modules.length > 0) return false
    return safe
}

/** Throws for a send that certainly sent nothing (declined, or refused before the wallet sent it). */
export function assertSomethingSent(result: TxResult): asserts result is Exclude<TxResult, { outcome: "failed" | "cancelled" }> {
    if (result.outcome === "cancelled") throw new SafeActionError({ code: "declined" })
    if (result.outcome === "failed") throw new SafeActionError({ code: "failed", detail: result.error.replace(/\. Nothing was sent\.$/, "") })
}

/**
 * Checks a sent creation: waits for its receipt, then reads the predicted
 * address on chain, which must hold exactly the planned Safe. Safe to call
 * again with the same hash ("check again") while the network or the RPC is
 * slow: an outage is never reported as a wrong Safe.
 *
 * A creation that reverted, was replaced, or never confirmed may still have
 * its Safe: someone can create the same Safe first with the same arguments
 * (the address is public), which makes this one revert. So the address is
 * read before anything is said to have failed.
 */
export async function confirmNewSafe(networkKey: string, plan: NewSafePlan, hash: Hex): Promise<Extract<SafeInspection, { kind: "safe" }>> {
    const chainId = chainIdOf(networkKey)
    if (chainId !== plan.chainId) throw new SafeActionError({ code: "wrong-chain" })
    let receipt
    try {
        // viem's own wait: a revert is a status (wagmi's throws on it), a replacement is followed.
        receipt = await getPublicClient(evmConfig, { chainId }).waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS })
    } catch {
        const there = await plannedSafeAt(networkKey, plan).catch(() => null)
        if (there) return there
        throw new SafeActionError({ code: "unconfirmed", hash })
    }
    const there = await plannedSafeAt(networkKey, plan)
    if (there === null) throw new SafeActionError({ code: "unverified", hash })
    if (there) return there
    throw new SafeActionError({ code: receipt.status !== "success" ? "reverted" : "not-the-safe", hash })
}

/**
 * Sends the planned deployment from the connected wallet (it pays the gas) on
 * the plan's chain, through sendEvmWrite, which awaits the receipt (replacements
 * included). `onSent` gets the transaction hash as soon as the wallet returns
 * it, before that wait: from then on, a failure carries the hash and is never a
 * reason to plan (and pay for) a second Safe.
 *
 * Whatever the outcome once something may have been sent, the predicted address
 * decides: someone can create the same Safe first with the same arguments (the
 * address is public), which makes this transaction revert with the Safe there.
 */
export async function deployNewSafe(networkKey: string, plan: NewSafePlan, onSent?: (hash: Hex) => void): Promise<{ hash: Hex; safe: Extract<SafeInspection, { kind: "safe" }> }> {
    assertDeployment(plan.tx, plan.owners, plan.threshold, plan.saltNonce)
    const chainId = chainIdOf(networkKey)
    if (chainId !== plan.chainId) throw new SafeActionError({ code: "wrong-chain" })
    const handed: { hash?: Hex } = {}
    // The one send path: chain and account re-checked, code at the factory, the wallet's live chain.
    const result = await sendEvmWrite({ chainId, from: plan.deployer, to: plan.tx.to, data: plan.tx.data, value: plan.tx.value }, {
        onSent: (hash) => { handed.hash = hash; onSent?.(hash) },
    })
    assertSomethingSent(result)
    const there = await plannedSafeAt(networkKey, plan).catch(() => null)
    // sent and refused carry the mined hash (a repriced send's differs from the one handed over).
    const mined = (result.hash as Hex | undefined) ?? null
    if (there) return { hash: mined ?? handed.hash ?? "0x", safe: there }
    switch (result.outcome) {
        case "sent": throw new SafeActionError({ code: there === null ? "unverified" : "not-the-safe", hash: mined! })
        case "refused": throw new SafeActionError(there === null ? { code: "unverified", hash: mined! } : { code: "reverted", hash: mined!, detail: result.error })
        case "unknown": {
            // Not seen confirmed, or replaced: check again with the hash the wallet first returned.
            const hash = handed.hash ?? mined
            if (!hash) throw new SafeActionError({ code: "failed", detail: result.error })
            throw new SafeActionError({ code: "unconfirmed", hash, detail: result.error })
        }
    }
}
