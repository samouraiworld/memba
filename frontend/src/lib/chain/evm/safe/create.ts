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
    predicted: Hex
    owners: Hex[]
    threshold: number
    saltNonce: bigint
    tx: { to: Hex; data: Hex; value: bigint }
}

export type CreateError =
    | { code: "not-connected" }
    | { code: "wrong-chain" }
    | { code: "declined" }
    | { code: "address-taken" }
    | { code: "unexpected-deployment"; detail: string }
    | { code: "reverted"; hash: Hex }
    | { code: "not-the-safe"; hash: Hex }
    | { code: "failed"; detail: string }

export class SafeCreateError extends Error {
    constructor(readonly reason: CreateError) {
        super(reason.code)
    }
}

const ZERO: Hex = "0x0000000000000000000000000000000000000000"
const FACTORY_ABI = parseAbi(["function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)"])
const SETUP_ABI = parseAbi(["function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)"])
const HANDLER_1_5_0 = SAFE_FALLBACK_HANDLERS.find((h) => h.version === "1.5.0")!.address

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Throws unless the deployment creates exactly the requested SafeL2 v1.5.0. */
export function assertDeployment(tx: { to: string; data: string; value: string | bigint }, owners: readonly string[], threshold: number, saltNonce: bigint): void {
    const fail = (detail: string) => { throw new SafeCreateError({ code: "unexpected-deployment", detail }) }
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

function walletError(err: unknown): never {
    const name = (err as { name?: string })?.name ?? ""
    const code = (err as { code?: number; cause?: { code?: number } })?.code ?? (err as { cause?: { code?: number } })?.cause?.code
    if (name === "ConnectorNotConnectedError" || name === "ConnectorAccountNotFoundError") throw new SafeCreateError({ code: "not-connected" })
    if (name === "ConnectorChainMismatchError") throw new SafeCreateError({ code: "wrong-chain" })
    if (code === 4001 || name === "UserRejectedRequestError") throw new SafeCreateError({ code: "declined" })
    throw new SafeCreateError({ code: "failed", detail: err instanceof Error ? err.message.split("\n")[0] : "unknown error" })
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
    const deployment = await kit.createSafeDeploymentTransaction()
    assertDeployment(deployment, owners, threshold, saltNonce)
    const code = await getPublicClient(evmConfig, { chainId }).getCode({ address: predicted })
    if (code && code !== "0x") throw new SafeCreateError({ code: "address-taken" })
    return { predicted, owners: [...owners], threshold, saltNonce, tx: { to: deployment.to as Hex, data: deployment.data as Hex, value: BigInt(deployment.value) } }
}

/**
 * Sends the planned deployment from the connected wallet (it pays the gas),
 * waits for it, and checks the new address holds exactly the planned Safe.
 * `onSent` gets the transaction hash as soon as the wallet returns it.
 */
export async function deployNewSafe(networkKey: string, plan: NewSafePlan, onSent?: (hash: Hex) => void): Promise<{ hash: Hex; safe: Extract<SafeInspection, { kind: "safe" }> }> {
    assertDeployment(plan.tx, plan.owners, plan.threshold, plan.saltNonce)
    const chainId = chainIdOf(networkKey)
    let hash: Hex
    try {
        hash = await sendTransaction(evmConfig, { chainId, to: plan.tx.to, data: plan.tx.data, value: plan.tx.value })
    } catch (err) {
        walletError(err)
    }
    onSent?.(hash)
    const receipt = await waitForTransactionReceipt(evmConfig, { chainId, hash })
    if (receipt.status !== "success") throw new SafeCreateError({ code: "reverted", hash })
    const inspection = await inspectSafe(safeReader(networkKey), keccak256, chainId, plan.predicted)
    const safe = inspection.kind === "ok" && inspection.value.kind === "safe" ? inspection.value : null
    const owners = new Set(plan.owners.map((o) => o.toLowerCase()))
    if (!safe || safe.version !== "1.5.0" || !safe.l2 || safe.threshold !== plan.threshold
        || safe.owners.length !== owners.size || safe.owners.some((o) => !owners.has(o)) || safe.modules.length > 0) {
        throw new SafeCreateError({ code: "not-the-safe", hash })
    }
    return { hash, safe }
}
