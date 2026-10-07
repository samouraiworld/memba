import { beforeEach, describe, expect, it, vi } from "vitest"
import { encodeFunctionData, parseAbi, type Hex } from "viem"
import type { SendOptions } from "../send"
import { confirmNewSafe, deployNewSafe, planNewSafe, SafeActionError, type NewSafePlan } from "./create"

const mocks = vi.hoisted(() => ({ send: vi.fn(), receipt: vi.fn(), inspect: vi.fn(), getCode: vi.fn(), kit: { getAddress: vi.fn(), createSafeDeploymentTransaction: vi.fn() }, init: vi.fn() }))
vi.mock("@wagmi/core", async (orig) => ({
    ...(await orig<typeof import("@wagmi/core")>()),
    getConnectorClient: async () => ({ account: { address: "0xa11ce00000000000000000000000000000000001" } }),
    getPublicClient: () => ({ getCode: mocks.getCode, waitForTransactionReceipt: mocks.receipt }),
}))
vi.mock("../adapter", async (orig) => ({ ...(await orig<typeof import("../adapter")>()), sendEvmWrite: mocks.send }))
vi.mock("@safe-global/protocol-kit", () => ({ default: { init: mocks.init } }))
vi.mock("./inspect", () => ({ inspectSafe: mocks.inspect }))
vi.mock("./reader", () => ({ safeReader: () => ({}) }))

const A: Hex = "0xa11ce00000000000000000000000000000000001"
const B: Hex = "0xb0b0000000000000000000000000000000000002"
const PREDICTED: Hex = "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe"
const HASH: Hex = `0x${"ab".repeat(32)}`
const REPRICED: Hex = `0x${"cd".repeat(32)}`
const RECEIPT = { status: "success", logs: [] }

// A deployment assertDeployment accepts (built like protocol-kit does; see create.test.ts).
const abi = parseAbi([
    "function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
    "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
])
const ZERO: Hex = "0x0000000000000000000000000000000000000000"
const setup = encodeFunctionData({ abi, functionName: "setup", args: [[A, B], 2n, ZERO, "0x", "0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4", ZERO, 0n, ZERO] })
const plan: NewSafePlan = {
    chainId: 84532, deployer: A, predicted: PREDICTED, owners: [A, B], threshold: 2, saltNonce: 7n,
    tx: { to: "0x14F2982D601c9458F93bd70B218933A6f8165e7b", value: 0n, data: encodeFunctionData({ abi, functionName: "createProxyWithNonce", args: ["0xEdd160fEBBD92E350D4D398fb636302fccd67C7e", setup, 7n] }) },
}
const theSafe = { kind: "ok", value: { kind: "safe", version: "1.5.0", l2: true, threshold: 2, owners: [A, B], modules: [] } }

/** sendEvmWrite as it behaves: it hands the wallet's hash over (onSent) before it awaits the receipt and reports. */
function sends(result: Record<string, unknown>, handed: Hex | null = (result.hash as Hex | undefined) ?? null) {
    mocks.send.mockImplementationOnce(async (_write: unknown, opts?: SendOptions) => {
        if (handed) opts?.onSent?.(handed)
        return result
    })
}

async function reason(p: Promise<unknown>): Promise<unknown> {
    return p.then(() => "ok", (err) => (err instanceof SafeActionError ? err.reason : String(err)))
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.send.mockImplementation(async (_write: unknown, opts?: SendOptions) => {
        opts?.onSent?.(HASH)
        return { outcome: "sent", hash: HASH, result: RECEIPT }
    })
    mocks.receipt.mockResolvedValue({ status: "success", logs: [] })
    mocks.inspect.mockResolvedValue(theSafe)
    mocks.getCode.mockResolvedValue(undefined)
    mocks.init.mockResolvedValue(mocks.kit)
    mocks.kit.getAddress.mockResolvedValue(PREDICTED)
    mocks.kit.createSafeDeploymentTransaction.mockResolvedValue({ to: plan.tx.to, value: "0", data: plan.tx.data })
})

describe("planning a Safe creation", () => {
    it("plans for the network's chain with the predicted address, sending nothing", async () => {
        const p = await planNewSafe("base-sepolia", [A, B], 2, 7n)
        expect(p).toEqual({ ...plan, predicted: PREDICTED })
        expect(mocks.init).toHaveBeenCalledWith(expect.objectContaining({ isL1SafeSingleton: false, predictedSafe: expect.objectContaining({ safeDeploymentConfig: expect.objectContaining({ safeVersion: "1.5.0", saltNonce: "7" }) }) }))
        expect(mocks.send).not.toHaveBeenCalled()
    })

    it("refuses an address that already holds code, and a deployment that isn't the asked Safe", async () => {
        mocks.getCode.mockResolvedValueOnce("0x6080")
        expect(await reason(planNewSafe("base-sepolia", [A, B], 2, 7n))).toEqual({ code: "address-taken" })
        mocks.kit.createSafeDeploymentTransaction.mockResolvedValueOnce({ to: plan.tx.to, value: "0", data: plan.tx.data })
        expect(await reason(planNewSafe("base-sepolia", [A, B], 1, 7n))).toMatchObject({ code: "unexpected-deployment", detail: "another threshold" })
    })
})

describe("sending and confirming a Safe creation", () => {
    it("sends on the plan's chain, hands the hash over before the wait, and confirms the Safe on the send path's own receipt", async () => {
        const sent = vi.fn()
        expect(await deployNewSafe("base-sepolia", plan, sent)).toMatchObject({ hash: HASH, safe: { kind: "safe" } })
        expect(mocks.send).toHaveBeenCalledWith({ chainId: 84532, from: A, to: plan.tx.to, data: plan.tx.data, value: 0n }, { onSent: expect.any(Function) })
        expect(mocks.send.mock.calls[0][1]).not.toHaveProperty("receiptTimeoutMs")
        expect(sent).toHaveBeenCalledWith(HASH)
        // sendEvmWrite waited (replacements included): no second wait here.
        expect(mocks.receipt).not.toHaveBeenCalled()
    })

    it("returns the mined hash of a repriced send, and keeps the first one for an unconfirmed or replaced send", async () => {
        sends({ outcome: "sent", hash: REPRICED, result: RECEIPT }, HASH)
        expect(await deployNewSafe("base-sepolia", plan)).toMatchObject({ hash: REPRICED })
        sends({ outcome: "unknown", hash: REPRICED, error: "Your wallet replaced this transaction with a different one." }, HASH)
        mocks.inspect.mockResolvedValueOnce({ kind: "ok", value: { kind: "not-a-safe", reason: "no-contract" } })
        expect(await reason(deployNewSafe("base-sepolia", plan))).toEqual({ code: "unconfirmed", hash: HASH, detail: "Your wallet replaced this transaction with a different one." })
    })

    it("checks the address after a confirmed send: unreadable is unverified, anything else there is not the Safe", async () => {
        mocks.inspect.mockResolvedValueOnce({ kind: "unavailable", reason: "down" })
        expect(await reason(deployNewSafe("base-sepolia", plan))).toEqual({ code: "unverified", hash: HASH })
        mocks.inspect.mockResolvedValueOnce({ kind: "ok", value: { ...theSafe.value, threshold: 1 } })
        expect(await reason(deployNewSafe("base-sepolia", plan))).toEqual({ code: "not-the-safe", hash: HASH })
        mocks.inspect.mockRejectedValueOnce(new Error("down"))
        expect(await reason(deployNewSafe("base-sepolia", plan))).toEqual({ code: "unverified", hash: HASH })
    })

    it("says a reverted or cancelled send reverted, in the send path's words, unless the address can't be read", async () => {
        const reverted = "The transaction was included but reverted: it changed nothing, and the network fee was paid."
        sends({ outcome: "refused", hash: HASH, error: reverted })
        mocks.inspect.mockResolvedValueOnce({ kind: "ok", value: { kind: "not-a-safe", reason: "no-contract" } })
        expect(await reason(deployNewSafe("base-sepolia", plan))).toEqual({ code: "reverted", hash: HASH, detail: reverted })
        sends({ outcome: "refused", hash: HASH, error: reverted })
        mocks.inspect.mockResolvedValueOnce({ kind: "unavailable", reason: "down" })
        expect(await reason(deployNewSafe("base-sepolia", plan))).toEqual({ code: "unverified", hash: HASH })
    })

    it("checks the planned deployment again before sending it", async () => {
        const tampered = { ...plan, tx: { ...plan.tx, to: B } }
        expect(await reason(deployNewSafe("base-sepolia", tampered))).toMatchObject({ code: "unexpected-deployment" })
        expect(mocks.send).not.toHaveBeenCalled()
    })

    it("refuses a plan made for another chain before anything is sent", async () => {
        expect(await reason(deployNewSafe("base-sepolia", { ...plan, chainId: 8453 }))).toEqual({ code: "wrong-chain" })
        expect(mocks.send).not.toHaveBeenCalled()
        expect(await reason(confirmNewSafe("base-sepolia", { ...plan, chainId: 8453 }, HASH))).toEqual({ code: "wrong-chain" })
    })

    it("keeps the hash when the network hasn't confirmed it yet, and when the chain can't be read", async () => {
        sends({ outcome: "unknown", hash: HASH, error: "not seen yet" })
        mocks.inspect.mockResolvedValueOnce({ kind: "ok", value: { kind: "not-a-safe", reason: "no-contract" } })
        expect(await reason(deployNewSafe("base-sepolia", plan))).toEqual({ code: "unconfirmed", hash: HASH, detail: "not seen yet" })
        mocks.inspect.mockResolvedValueOnce({ kind: "unavailable", reason: "the RPC did not answer" })
        expect(await reason(confirmNewSafe("base-sepolia", plan, HASH))).toEqual({ code: "unverified", hash: HASH })
        // Checking again with the same hash succeeds once the chain answers; nothing is sent again.
        expect(await reason(confirmNewSafe("base-sepolia", plan, HASH))).toBe("ok")
        expect(mocks.send).toHaveBeenCalledTimes(1)
    })

    it("says a reverted creation reverted, and a wrong Safe is a wrong Safe", async () => {
        mocks.receipt.mockResolvedValueOnce({ status: "reverted" })
        mocks.inspect.mockResolvedValueOnce({ kind: "ok", value: { kind: "not-a-safe", reason: "no-contract" } })
        expect(await reason(confirmNewSafe("base-sepolia", plan, HASH))).toEqual({ code: "reverted", hash: HASH })
        mocks.inspect.mockResolvedValueOnce({ kind: "ok", value: { ...theSafe.value, threshold: 1 } })
        expect(await reason(confirmNewSafe("base-sepolia", plan, HASH))).toEqual({ code: "not-the-safe", hash: HASH })
        mocks.inspect.mockResolvedValueOnce({ kind: "ok", value: { kind: "not-a-safe", reason: "no-contract" } })
        expect(await reason(confirmNewSafe("base-sepolia", plan, HASH))).toEqual({ code: "not-the-safe", hash: HASH })
        for (const other of [{ version: "1.4.1" }, { l2: false }, { owners: [A] }, { owners: [A, "0xc0ffee0000000000000000000000000000000003"] }]) {
            mocks.inspect.mockResolvedValueOnce({ kind: "ok", value: { ...theSafe.value, ...other } })
            expect(await reason(confirmNewSafe("base-sepolia", plan, HASH))).toEqual({ code: "not-the-safe", hash: HASH })
        }
        mocks.inspect.mockResolvedValueOnce({ kind: "ok", value: { ...theSafe.value, modules: [B] } })
        expect(await reason(confirmNewSafe("base-sepolia", plan, HASH))).toEqual({ code: "not-the-safe", hash: HASH })
    })

    it("reads the address before saying a creation failed: a front-run with the same arguments created the planned Safe", async () => {
        // Reverted (someone created it first), replaced or never seen: the planned Safe is there, so it is created.
        mocks.receipt.mockResolvedValueOnce({ status: "reverted", logs: [] })
        expect(await reason(confirmNewSafe("base-sepolia", plan, HASH))).toBe("ok")
        mocks.receipt.mockRejectedValueOnce(new Error("replaced"))
        expect(await reason(confirmNewSafe("base-sepolia", plan, HASH))).toBe("ok")
        mocks.receipt.mockResolvedValueOnce({ status: "success", logs: [] })
        expect(await reason(confirmNewSafe("base-sepolia", plan, HASH))).toBe("ok")
        // Reverted and nothing there: reverted. Not seen and nothing there (or the chain unreadable): unconfirmed.
        mocks.receipt.mockResolvedValueOnce({ status: "reverted", logs: [] })
        mocks.inspect.mockResolvedValueOnce({ kind: "ok", value: { kind: "not-a-safe", reason: "no-contract" } })
        expect(await reason(confirmNewSafe("base-sepolia", plan, HASH))).toEqual({ code: "reverted", hash: HASH })
        mocks.receipt.mockRejectedValueOnce(new Error("replaced"))
        mocks.inspect.mockResolvedValueOnce({ kind: "unavailable", reason: "down" })
        expect(await reason(confirmNewSafe("base-sepolia", plan, HASH))).toEqual({ code: "unconfirmed", hash: HASH })
        mocks.receipt.mockRejectedValueOnce(new Error("replaced"))
        mocks.inspect.mockRejectedValueOnce(new Error("down"))
        expect(await reason(confirmNewSafe("base-sepolia", plan, HASH))).toEqual({ code: "unconfirmed", hash: HASH })
    })

    it("maps the send path's outcomes: cancelled, failed with nothing sent, and any outcome with a hash checked at the address", async () => {
        mocks.send.mockResolvedValueOnce({ outcome: "cancelled", error: "You rejected it. Nothing was sent." })
        expect(await reason(deployNewSafe("base-sepolia", plan))).toEqual({ code: "declined" })
        mocks.send.mockResolvedValueOnce({ outcome: "failed", error: "Your wallet is on chain 1, but this transaction is for Base Sepolia (84532). Switch the wallet, then try again. Nothing was sent." })
        expect(await reason(deployNewSafe("base-sepolia", plan))).toEqual({ code: "failed", detail: "Your wallet is on chain 1, but this transaction is for Base Sepolia (84532). Switch the wallet, then try again" })
        // No hash, but maybe sent: the address decides; nothing there means "check your wallet".
        sends({ outcome: "unknown", error: "Check your wallet's activity before retrying" })
        mocks.inspect.mockResolvedValueOnce({ kind: "ok", value: { kind: "not-a-safe", reason: "no-contract" } })
        expect(await reason(deployNewSafe("base-sepolia", plan))).toEqual({ code: "failed", detail: "Check your wallet's activity before retrying" })
        sends({ outcome: "unknown", error: "Check your wallet's activity before retrying" })
        expect(await deployNewSafe("base-sepolia", plan)).toMatchObject({ hash: "0x" })
        // Failed and cancelled are known to have sent nothing: the address isn't read.
        mocks.inspect.mockClear()
        mocks.send.mockResolvedValueOnce({ outcome: "failed", error: "Nope. Nothing was sent." })
        expect(await reason(deployNewSafe("base-sepolia", plan))).toEqual({ code: "failed", detail: "Nope" })
        mocks.send.mockResolvedValueOnce({ outcome: "cancelled", error: "You rejected it. Nothing was sent." })
        expect(await reason(deployNewSafe("base-sepolia", plan))).toEqual({ code: "declined" })
        expect(mocks.inspect).not.toHaveBeenCalled()
        // A revert (someone created the same Safe first), a replacement or no confirmation: the planned Safe is there, so it is created.
        for (const outcome of ["sent", "refused", "unknown"]) {
            const onSent = vi.fn()
            sends({ outcome, hash: HASH, error: "x", result: RECEIPT })
            expect(await reason(deployNewSafe("base-sepolia", plan, onSent))).toBe("ok")
            expect(onSent).toHaveBeenCalledWith(HASH)
        }
        expect(mocks.receipt).not.toHaveBeenCalled()
    })
})
