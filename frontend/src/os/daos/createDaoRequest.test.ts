import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const chain = vi.hoisted(() => ({
    policy: "inert",
    replacesParked: false,
    outcome: { outcome: "live" } as { outcome: string; meta?: unknown; unconfirmed?: boolean; error?: string },
    wallet: vi.fn(async (): Promise<{ hash: string }> => ({ hash: "TXHASH" })),
    pendingAtWallet: null as unknown,
}))

vi.mock("../../lib/dao/namespace", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao/namespace")>()),
    assertCanDeployTo: vi.fn(async () => {}),
}))
vi.mock("../../lib/dao/packageStatus", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao/packageStatus")>()),
    assertPathAvailable: vi.fn(async () => ({ replacesParked: chain.replacesParked })),
    codeSubmissionPolicy: vi.fn(async () => chain.policy),
    waitForPackage: vi.fn(async () => chain.outcome),
}))
vi.mock("../../lib/grc20", async (orig) => ({
    ...(await orig<typeof import("../../lib/grc20")>()),
    // Stand-in for the broadcaster: beforeSign, then the wallet.
    doContractBroadcast: vi.fn(async (_msgs: unknown, _memo: string, opts: { beforeSign?: () => Promise<void> }) => {
        await opts.beforeSign?.()
        const { listPendingDAOs } = await import("../../lib/dao/packageStatus")
        chain.pendingAtWallet = listPendingDAOs("gnoland-1")[0] ?? null
        return chain.wallet()
    }),
}))
vi.mock("../../lib/config", async (orig) => ({ ...(await orig<typeof import("../../lib/config")>()), GNO_CHAIN_ID: "gnoland-1" }))

import { clearPendingMemory, listPendingDAOs } from "../../lib/dao/packageStatus"
import { getAllSavedDAOs } from "../../lib/daoSlug"
import { doContractBroadcast, FALLBACK_GAS_PRICE } from "../../lib/grc20"
import { executeSignature } from "../sign/signer"
import { daoConfig, emptyDaoDraft } from "./createDao"
import { createDaoRequest, runDeployChecks, type CreateDaoContext } from "./createDaoRequest"

const ME = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const config = daoConfig({ ...emptyDaoDraft(ME), name: "Gno Builders" }, ME)
const PATH = `gno.land/r/${ME}/gno_builders`

function ctx(over: Partial<CreateDaoContext> = {}): CreateDaoContext {
    return {
        wallet: ME, config, checks: { policy: "inert", replacesParked: false }, price: FALLBACK_GAS_PRICE, lines: [], warns: [],
        onSubmitted: vi.fn(), onResult: vi.fn(), ...over,
    }
}

beforeEach(() => {
    chain.policy = "inert"
    chain.replacesParked = false
    chain.outcome = { outcome: "live" }
    chain.wallet.mockImplementation(async () => ({ hash: "TXHASH" }))
    chain.pendingAtWallet = null
})
afterEach(() => { localStorage.clear(); clearPendingMemory(); vi.clearAllMocks() })

describe("createDaoRequest", () => {
    it("deploys the generated package with the deposit cap and the policy's gas budget", async () => {
        const req = createDaoRequest(ctx())
        const [msg] = req.prepare(undefined).msgs
        expect(msg.type).toBe("/vm.m_addpkg")
        expect(msg.value).toMatchObject({ creator: ME, package: { path: PATH }, max_deposit: expect.stringMatching(/^[0-9]+ugnot$/) })
        await req.send(undefined, async () => {})
        expect(vi.mocked(doContractBroadcast).mock.calls[0][2]).toMatchObject({ gas: "deploy", gasWanted: expect.any(Number) })
    })

    it("saves the pending intent before the wallet opens, and the hash after", async () => {
        const c = ctx()
        await createDaoRequest(c).send(undefined, async () => {})
        expect(chain.pendingAtWallet).toMatchObject({ path: PATH, phase: "intent", wallet: ME, txHash: "" })
        expect(listPendingDAOs("gnoland-1")[0]).toMatchObject({ path: PATH, phase: "submitted", txHash: "TXHASH" })
        expect(c.onSubmitted).toHaveBeenCalledWith("TXHASH")
    })

    it("drops the intent when nothing was sent, through the signer", async () => {
        const req = createDaoRequest(ctx())
        chain.policy = "permissionless" // the recheck sees a changed network
        const res = await executeSignature(req, undefined, req.prepare(undefined).msgs, () => {})
        expect(res).toMatchObject({ outcome: "failed", error: expect.stringContaining("rules for this address changed") })
        expect(chain.wallet).not.toHaveBeenCalled()
        expect(listPendingDAOs("gnoland-1")).toEqual([])
    })

    it("keeps the intent when the wallet outcome is unknown", async () => {
        chain.wallet.mockImplementation(async () => { throw new Error("network timeout") })
        const req = createDaoRequest(ctx())
        const res = await executeSignature(req, undefined, req.prepare(undefined).msgs, () => {})
        expect(res.outcome).toBe("unknown")
        expect(listPendingDAOs("gnoland-1")[0]).toMatchObject({ path: PATH, phase: "intent" })
    })

    it("a live package is saved to the DAO list and its pending record cleared", async () => {
        const c = ctx()
        const req = createDaoRequest(c)
        await req.send(undefined, async () => {})
        await expect(req.verify!(undefined, "TXHASH", undefined)).resolves.toBe(true)
        expect(getAllSavedDAOs().some((d) => d.realmPath === PATH)).toBe(true)
        expect(listPendingDAOs("gnoland-1")).toEqual([])
        expect(c.onResult).toHaveBeenCalledWith({ kind: "live" }, "TXHASH")
        expect(req.verifyAttempts).toBe(1)
    })

    it("a parked package waits for network approval and stays recorded", async () => {
        chain.outcome = { outcome: "pending", meta: { path: PATH, status: "inert", reason: "awaiting approval" }, unconfirmed: false }
        const c = ctx()
        const req = createDaoRequest(c)
        await req.send(undefined, async () => {})
        await expect(req.verify!(undefined, "TXHASH", undefined)).resolves.toBe(false)
        expect(c.onResult).toHaveBeenCalledWith({ kind: "pending", unconfirmed: false, reason: "awaiting approval" }, "TXHASH")
        expect(listPendingDAOs("gnoland-1")[0]).toMatchObject({ phase: "submitted", txHash: "TXHASH", reason: "awaiting approval" })
    })

    it("refuses a second deploy to the same address while one waits for Adena", async () => {
        let release!: (v: { hash: string }) => void
        chain.wallet.mockImplementation(() => new Promise((r) => { release = r }))
        const first = createDaoRequest(ctx()).send(undefined, async () => {})
        await vi.waitFor(() => expect(release).toBeTypeOf("function"))
        const second = createDaoRequest(ctx())
        await expect(second.send(undefined, async () => {})).rejects.toThrow(/already waiting/)
        second.onNothingSent!() // must not drop the first attempt's record
        expect(listPendingDAOs("gnoland-1")).toHaveLength(1)
        release({ hash: "H" })
        await first
    })
})

describe("runDeployChecks", () => {
    it("reports the policy and whether a parked submission is replaced", async () => {
        chain.replacesParked = true
        await expect(runDeployChecks(ME, PATH)).resolves.toEqual({ policy: "inert", replacesParked: true })
    })
})
