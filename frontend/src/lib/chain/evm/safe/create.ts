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
import { getConnectorClient, getPublicClient, sendTransaction, waitForTransactionReceipt } from "@wagmi/core"
import { decodeFunctionData, keccak256, parseAbi, type Hex } from "viem"
import Safe, { type Eip1193Provider, type PredictedSafeProps } from "@safe-global/protocol-kit"
import { chainFor, evmConfig } from "../adapter"
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
    | { code: "reverted"; hash: Hex }
    | { code: "not-the-safe"; hash: Hex }
    // Sent, but the network didn't confirm it yet: the hash is kept to check again.
    | { code: "unconfirmed"; hash: Hex }
    // Confirmed, but the chain couldn't be read to check the result: check again.
    | { code: "unverified"; hash: Hex }
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
/** keccak256("ProxyCreation(address,address)"): SafeProxyFactory 1.5.0's event, the proxy indexed. */
const PROXY_CREATION: Hex = "0x4f51faf6c4561ff95f067657e43439f0f856d97c04d9ec9070a6199ad418e235"

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

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
    return { chainId, predicted, owners: [...owners], threshold, saltNonce, tx: { to: deployment.to as Hex, data: deployment.data as Hex, value: BigInt(deployment.value) } }
}

/**
 * Checks a sent creation: waits for its receipt, then reads the predicted
 * address on chain, which must hold exactly the planned Safe. Safe to call
 * again with the same hash ("check again") while the network or the RPC is
 * slow: an outage is never reported as a wrong Safe.
 */
export async function confirmNewSafe(networkKey: string, plan: NewSafePlan, hash: Hex): Promise<Extract<SafeInspection, { kind: "safe" }>> {
    const chainId = chainIdOf(networkKey)
    if (chainId !== plan.chainId) throw new SafeActionError({ code: "wrong-chain" })
    let receipt
    try {
        receipt = await waitForTransactionReceipt(evmConfig, { chainId, hash })
    } catch {
        throw new SafeActionError({ code: "unconfirmed", hash })
    }
    if (receipt.status !== "success") throw new SafeActionError({ code: "reverted", hash })
    // The factory says which proxy it created: it must be the predicted address.
    const created = receipt.logs.some((log) => same(log.address, SAFE_PROXY_FACTORY_1_5_0) && log.topics[0] === PROXY_CREATION
        && !!log.topics[1] && same(`0x${log.topics[1].slice(26)}`, plan.predicted))
    if (!created) throw new SafeActionError({ code: "not-the-safe", hash })
    const inspection = await inspectSafe(safeReader(networkKey), keccak256, chainId, plan.predicted)
    if (inspection.kind === "unavailable") throw new SafeActionError({ code: "unverified", hash })
    const safe = inspection.value.kind === "safe" ? inspection.value : null
    const owners = new Set(plan.owners.map((o) => o.toLowerCase()))
    if (!safe || safe.version !== "1.5.0" || !safe.l2 || safe.threshold !== plan.threshold
        || safe.owners.length !== owners.size || safe.owners.some((o) => !owners.has(o)) || safe.modules.length > 0) {
        throw new SafeActionError({ code: "not-the-safe", hash })
    }
    return safe
}

/**
 * Sends the planned deployment from the connected wallet (it pays the gas) on
 * the plan's chain, then confirms it (confirmNewSafe). `onSent` gets the
 * transaction hash as soon as the wallet returns it: from then on, a failure
 * carries the hash and is never a reason to plan (and pay for) a second Safe.
 */
export async function deployNewSafe(networkKey: string, plan: NewSafePlan, onSent?: (hash: Hex) => void): Promise<{ hash: Hex; safe: Extract<SafeInspection, { kind: "safe" }> }> {
    assertDeployment(plan.tx, plan.owners, plan.threshold, plan.saltNonce)
    const chainId = chainIdOf(networkKey)
    if (chainId !== plan.chainId) throw new SafeActionError({ code: "wrong-chain" })
    let hash: Hex
    try {
        hash = await sendTransaction(evmConfig, { chainId, to: plan.tx.to, data: plan.tx.data, value: plan.tx.value })
    } catch (err) {
        walletError(err)
    }
    onSent?.(hash)
    return { hash, safe: await confirmNewSafe(networkKey, plan, hash) }
}
